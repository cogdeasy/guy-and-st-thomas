import { z } from 'zod';
import {
  CodeSystems,
  type Encounter,
  type Observation,
  type Patient,
} from '@trustos/ontology';
import { BadRequest, NotFound, nowIso, ref } from '@trustos/core';
import type { DataStore } from '../../store/store';
import { defineModule } from '../types';
import {
  latestScoredSet,
  scoreReading,
  toVitalsSeries,
  VitalCodes,
  type VitalsReading,
} from './vitals';

/**
 * Vital Signs & NEWS2 Charting.
 *
 * Workflow endpoints on top of core `Observation` (category `vital-signs`):
 * a per-patient charting view with NEWS2 trend, a "record observations" action
 * that scores the reading and returns the escalation response, and a
 * trust-wide deteriorating-patient worklist (NEWS2 ≥ 5).
 */
export default defineModule({
  id: 'observations',
  name: 'Vital Signs & NEWS2 Charting',
  description: 'Bedside vital-signs charting with NEWS2 scoring, trends and deterioration escalation.',

  routes(app, { store }) {
    // Charting view: full time-series of a patient's vitals with NEWS2 trend.
    app.get<{ Params: { patientId: string } }>('/:patientId/chart', async (req) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
      const patientRef = ref('Patient', patient.id);
      const observations = store.query<Observation>(
        'Observation',
        (o) => o.subject?.reference === patientRef,
      );
      const series = toVitalsSeries(observations);
      const latest = series.at(-1) ?? null;

      return {
        patient,
        nhsNumber: patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
        encounter: activeInpatientEncounter(store, patientRef),
        total: series.length,
        latest,
        trend: series.map((s) => ({ recordedAt: s.recordedAt, news2: s.news2?.score ?? null, risk: s.news2?.risk ?? null })),
        series,
      };
    });

    // Record a full set of vitals; compute and return NEWS2 + escalation.
    const RecordBody = z.object({
      respiratoryRate: z.number().min(0).max(80),
      spo2: z.number().min(50).max(100),
      onOxygen: z.boolean().default(false),
      systolicBp: z.number().min(40).max(300),
      heartRate: z.number().min(20).max(300),
      consciousness: z.enum(['A', 'V', 'P', 'U']).default('A'),
      temperature: z.number().min(25).max(45),
      recordedAt: z.string().datetime({ offset: true }).optional(),
      encounterId: z.string().optional(),
      performerId: z.string().optional(),
    });

    app.post<{ Params: { patientId: string }; Body: unknown }>('/:patientId/record', async (req, reply) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
      const body = RecordBody.parse(req.body);

      const patientRef = ref('Patient', patient.id);
      let encounterRef: string | undefined;
      if (body.encounterId) {
        const encounter = store.get<Encounter>('Encounter', body.encounterId);
        if (!encounter) throw NotFound(`Encounter/${body.encounterId}`);
        if (encounter.subject?.reference !== patientRef) {
          throw BadRequest('Encounter does not belong to this patient');
        }
        encounterRef = ref('Encounter', encounter.id);
      } else {
        encounterRef = activeInpatientEncounter(store, patientRef)?.reference;
      }

      const recordedAt = body.recordedAt ?? nowIso();
      const reading: VitalsReading = {
        respiratoryRate: body.respiratoryRate,
        spo2: body.spo2,
        onOxygen: body.onOxygen,
        systolicBp: body.systolicBp,
        heartRate: body.heartRate,
        consciousness: body.consciousness,
        temperature: body.temperature,
      };
      const created = writeVitalsSet(store, {
        patientRef,
        encounterRef,
        performerRef: body.performerId ? ref('Practitioner', body.performerId) : undefined,
        recordedAt,
        reading,
      });
      const news2 = scoreReading(reading)!;

      reply.code(201);
      return {
        patientId: patient.id,
        recordedAt,
        reading,
        news2,
        escalation: escalationFor(news2.score, news2.risk),
        observations: created,
      };
    });

    // Observation round worklist: every admitted patient with their latest
    // NEWS2 (computed consistently with the chart), sickest first.
    app.get('/worklist', async () => {
      const encounters = store.query<Encounter>(
        'Encounter',
        (e) => e.class === 'inpatient' && e.status === 'in-progress',
      );
      const items = encounters
        .map((encounter) => {
          const patientRef = encounter.subject.reference;
          const patient = store.get<Patient>('Patient', patientRef.split('/')[1] ?? '');
          if (!patient) return null;
          const observations = store.query<Observation>('Observation', (o) => o.subject?.reference === patientRef);
          const latest = latestScoredSet(observations);
          return {
            patient,
            encounterId: encounter.id,
            specialty: encounter.specialty,
            reason: encounter.reasonText,
            news2: latest?.news2 ? { score: latest.news2.score, risk: latest.news2.risk } : null,
            recordedAt: latest?.recordedAt ?? null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) => (b.news2?.score ?? -1) - (a.news2?.score ?? -1));
      return { total: items.length, items };
    });

    // Trust-wide deteriorating patients (latest NEWS2 ≥ 5), highest first.
    app.get<{ Querystring: { threshold?: string } }>('/deteriorating', async (req) => {
      const threshold = Number(req.query.threshold ?? 5);
      const patients = store.list<Patient>('Patient');

      const rows = patients
        .map((patient) => {
          const patientRef = ref('Patient', patient.id);
          const observations = store.query<Observation>('Observation', (o) => o.subject?.reference === patientRef);
          const latest = latestScoredSet(observations);
          if (!latest?.news2) return null;
          const encounter = activeInpatientEncounter(store, patientRef);
          return {
            patient,
            encounterId: encounter?.reference?.split('/')[1],
            ward: encounterDisplay(store, encounter?.reference),
            specialty: specialtyFor(store, patientRef),
            news2: latest.news2.score,
            risk: latest.news2.risk,
            recommendation: latest.news2.recommendation,
            escalation: escalationFor(latest.news2.score, latest.news2.risk),
            recordedAt: latest.recordedAt,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null && row.news2 >= threshold)
        .sort((a, b) => b.news2 - a.news2 || b.recordedAt.localeCompare(a.recordedAt));

      return { threshold, total: rows.length, items: rows };
    });
  },

  // Add 2–3 historical vitals sets over the last 24h for each admitted patient
  // so trends render; drive a subset into the deteriorating band.
  seed({ store, rng }) {
    // Runs after core seed. `base` is captured now so our most recent set is
    // newer than the core-seeded "now" vitals it then supersedes.
    const base = Date.now();
    const encounters = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );

    for (const encounter of encounters) {
      const patientRef = encounter.subject.reference;
      const encounterRef = ref('Encounter', encounter.id);
      const deteriorating = rng() < 0.3;
      // 2–3 sets ending "now"; oldest first so values can trend over the last 24h.
      const hoursAgo = rng() < 0.5 ? [16, 8, 0] : [10, 0];

      hoursAgo.forEach((hours, idx) => {
        const progress = hoursAgo.length > 1 ? idx / (hoursAgo.length - 1) : 1; // 0 → oldest, 1 → latest
        const reading = deteriorating ? deterioratingReading(rng, progress) : stableReading(rng);
        writeVitalsSet(store, {
          patientRef,
          encounterRef,
          recordedAt: new Date(base - hours * 3_600_000).toISOString(),
          reading,
        });
      });
    }
  },
});

interface WriteVitalsArgs {
  patientRef: string;
  encounterRef?: string;
  performerRef?: string;
  recordedAt: string;
  reading: VitalsReading;
}

/** Persist one vitals set as individual FHIR Observations sharing an instant. */
function writeVitalsSet(
  store: DataStore,
  { patientRef, encounterRef, performerRef, recordedAt, reading }: WriteVitalsArgs,
): Observation[] {
  const subject = { reference: patientRef };
  const encounter = encounterRef ? { reference: encounterRef } : undefined;
  const performer = performerRef ? { reference: performerRef } : undefined;

  const make = (
    component: keyof typeof VitalCodes,
    value: { valueQuantity?: { value: number; unit: string }; valueString?: string },
  ) => {
    const def = VitalCodes[component];
    return store.create<Observation>('Observation', {
      status: 'final',
      category: 'vital-signs',
      code: { coding: [{ system: CodeSystems.LOINC, code: def.code, display: def.display }], text: def.display },
      subject,
      encounter,
      performer,
      effectiveDateTime: recordedAt,
      ...value,
    });
  };

  return [
    make('respiratoryRate', { valueQuantity: { value: reading.respiratoryRate, unit: VitalCodes.respiratoryRate.unit } }),
    make('spo2', { valueQuantity: { value: reading.spo2, unit: VitalCodes.spo2.unit } }),
    make('systolicBp', { valueQuantity: { value: reading.systolicBp, unit: VitalCodes.systolicBp.unit } }),
    make('heartRate', { valueQuantity: { value: reading.heartRate, unit: VitalCodes.heartRate.unit } }),
    make('temperature', { valueQuantity: { value: reading.temperature, unit: VitalCodes.temperature.unit } }),
    make('consciousness', { valueString: reading.consciousness }),
    make('onOxygen', { valueString: String(reading.onOxygen) }),
  ];
}

function activeInpatientEncounter(
  store: DataStore,
  patientRef: string,
): { reference: string } | undefined {
  const encounter = store
    .query<Encounter>('Encounter', (e) => e.subject?.reference === patientRef && e.status === 'in-progress')
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''))[0];
  return encounter ? { reference: ref('Encounter', encounter.id) } : undefined;
}

function specialtyFor(store: DataStore, patientRef: string): string | undefined {
  return store
    .query<Encounter>('Encounter', (e) => e.subject?.reference === patientRef && e.status === 'in-progress')
    .map((e) => e.specialty)
    .find(Boolean);
}

function encounterDisplay(store: DataStore, encounterRef?: string): string | undefined {
  if (!encounterRef) return undefined;
  const encounter = store.get<Encounter>('Encounter', encounterRef.split('/')[1] ?? '');
  return encounter?.location?.display ?? encounter?.reasonText;
}

/** Map a NEWS2 score to the RCP escalation/monitoring response. */
function escalationFor(score: number, risk: string): { band: string; monitoring: string; response: string } {
  if (score >= 7 || risk === 'high') {
    return {
      band: 'High',
      monitoring: 'Continuous monitoring of vital signs',
      response: 'Emergency assessment by a critical-care-competent team; consider transfer to higher level of care.',
    };
  }
  if (score >= 5) {
    return {
      band: 'Medium',
      monitoring: 'Minimum hourly observations',
      response: 'Urgent review by a clinician with competencies in acute illness; escalate to registered team.',
    };
  }
  if (score >= 1) {
    return {
      band: 'Low–Medium',
      monitoring: 'Minimum 4–6 hourly observations',
      response: 'Assessment by a registered nurse to decide on escalation and monitoring frequency.',
    };
  }
  return {
    band: 'Low',
    monitoring: 'Minimum 12 hourly observations',
    response: 'Continue routine NEWS2 monitoring.',
  };
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}

/** A physiologically normal reading (NEWS2 typically 0–2). */
function stableReading(rng: () => number): VitalsReading {
  return {
    respiratoryRate: 12 + Math.floor(rng() * 7), // 12–18
    spo2: 96 + Math.floor(rng() * 4), // 96–99
    onOxygen: false,
    systolicBp: 112 + Math.floor(rng() * 38), // 112–149
    heartRate: 60 + Math.floor(rng() * 30), // 60–89
    consciousness: 'A',
    temperature: round1(36.3 + rng() * 1.2), // 36.3–37.5
  };
}

/**
 * A deteriorating reading whose abnormality grows with `progress` (0 → 1),
 * producing a rising NEWS2 trend that reaches the medium/high band.
 */
function deterioratingReading(rng: () => number, progress: number): VitalsReading {
  const sev = 0.4 + progress * 0.6; // never fully normal, worsens over time
  return {
    respiratoryRate: Math.round(20 + sev * (8 + rng() * 4)), // up to ~30+
    spo2: Math.round(95 - sev * (7 + rng() * 4)), // down toward ~88
    onOxygen: progress > 0.5,
    systolicBp: Math.round(112 - sev * (24 + rng() * 12)), // down toward ~85
    heartRate: Math.round(95 + sev * (25 + rng() * 15)), // up toward ~130
    consciousness: progress > 0.75 && rng() < 0.5 ? 'V' : 'A',
    temperature: round1(38.2 + sev * (1 + rng())), // febrile
  };
}
