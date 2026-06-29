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
    // Scoped to currently admitted inpatients so discharged patients with
    // historical high scores never surface on the live worklist.
    app.get<{ Querystring: { threshold?: string } }>('/deteriorating', async (req) => {
      const threshold = Number(req.query.threshold ?? 5);
      const encounters = store.query<Encounter>(
        'Encounter',
        (e) => e.class === 'inpatient' && e.status === 'in-progress',
      );

      const rows = encounters
        .map((encounter) => {
          const patientRef = encounter.subject.reference;
          const patient = store.get<Patient>('Patient', patientRef.split('/')[1] ?? '');
          if (!patient) return null;
          const observations = store.query<Observation>('Observation', (o) => o.subject?.reference === patientRef);
          const latest = latestScoredSet(observations);
          if (!latest?.news2) return null;
          return {
            patient,
            encounterId: encounter.id,
            ward: encounter.location?.display ?? encounter.reasonText,
            specialty: encounter.specialty,
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
      const deteriorating = rng() < 0.24;
      // Each deteriorating patient peaks at a different severity, so the live
      // worklist spreads realistically across the medium and high bands rather
      // than everyone pinning at a peri-arrest NEWS2.
      const peak = 0.45 + rng() * 0.5; // 0.45 → 0.95
      // 2–3 sets ending "now"; oldest first so values can trend over the last 24h.
      const hoursAgo = rng() < 0.5 ? [16, 8, 0] : [10, 0];

      hoursAgo.forEach((hours, idx) => {
        const progress = hoursAgo.length > 1 ? idx / (hoursAgo.length - 1) : 1; // 0 → oldest, 1 → latest
        const reading = deteriorating ? deterioratingReading(rng, progress, peak) : stableReading(rng);
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
    .query<Encounter>(
      'Encounter',
      (e) => e.subject?.reference === patientRef && e.class === 'inpatient' && e.status === 'in-progress',
    )
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''))[0];
  return encounter ? { reference: ref('Encounter', encounter.id) } : undefined;
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
  if (score >= 5 || risk === 'medium') {
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

/**
 * A physiologically stable reading. Most parameters sit squarely normal, but
 * each is allowed to drift to a mildly abnormal value so the ward populates a
 * realistic NEWS2 low band (1–4) rather than every stable patient scoring 0.
 * Ranges are bounded so a stable patient never aggregates into the medium band.
 */
function stableReading(rng: () => number): VitalsReading {
  return {
    respiratoryRate: 12 + Math.floor(rng() * 8), // 12–19 (0 pts)
    spo2: 94 + Math.floor(rng() * 6), // 94–99 (0–1 pts)
    onOxygen: false,
    systolicBp: 108 + Math.floor(rng() * 44), // 108–151 (0–1 pts)
    heartRate: 58 + Math.floor(rng() * 48), // 58–105 (0–1 pts)
    consciousness: 'A',
    temperature: round1(36.0 + rng() * 1.9), // 36.0–37.9 (0–1 pts)
  };
}

/**
 * A deteriorating reading whose abnormality grows with `progress` (0 → 1) and
 * is capped by a per-patient `peak` severity (0.45 → 0.95). Lower-peak patients
 * settle in the NEWS2 medium band; higher-peak patients reach the high band —
 * giving a clinically realistic spread rather than everyone at the ceiling.
 */
function deterioratingReading(rng: () => number, progress: number, peak = 0.9): VitalsReading {
  const sev = peak * (0.55 + progress * 0.45); // ramps up toward the patient's peak
  return {
    respiratoryRate: Math.round(17 + sev * 9), // ~21 (mild) → ~26 (severe)
    spo2: Math.round(97 - sev * 6), // ~94 → ~91
    onOxygen: progress > 0.6 && peak > 0.7,
    systolicBp: Math.round(120 - sev * 20), // ~111 → ~101
    heartRate: Math.round(88 + sev * 32), // ~102 → ~118
    consciousness: progress > 0.8 && peak > 0.85 && rng() < 0.4 ? 'V' : 'A',
    temperature: round1(37.5 + sev * 1.5), // mildly → markedly febrile
  };
}
