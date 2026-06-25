import { z } from 'zod';
import {
  CodeSystems,
  calculateNews2,
  isValidNhsNumber,
  type AllergyIntolerance,
  type Condition,
  type Encounter,
  type Observation,
  type Patient,
} from '@trustos/ontology';
import { ageFromBirthDate, ApiError, ref } from '@trustos/core';
import { defineModule } from '../types';

/**
 * Patient Administration System (PAS) — the reference module.
 * Demonstrates the conventions every module follows: typed routes over the
 * shared store, composite read endpoints, validation, and a seed contribution.
 */
export default defineModule({
  id: 'patients',
  name: 'Patient Administration (PAS)',
  description: 'Master patient index, registration, demographics and patient summary.',

  routes(app, { store }) {
    // Search the master patient index by name, NHS number or MRN.
    app.get<{ Querystring: { q?: string } }>('/search', async (req) => {
      const q = (req.query.q ?? '').trim().toLowerCase();
      const all = store.list<Patient>('Patient');
      const matches = !q
        ? all.slice(0, 25)
        : all.filter((p) => {
            const name = p.name?.[0];
            const full = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.toLowerCase();
            const ids = (p.identifier ?? []).map((i) => i.value.replace(/\s/g, '')).join(' ');
            return full.includes(q) || ids.includes(q.replace(/\s/g, ''));
          });
      return { total: matches.length, patients: matches.slice(0, 50) };
    });

    // Composite patient summary used by the EPR banner / chart.
    app.get<{ Params: { id: string } }>('/:id/summary', async (req) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.id);
      const patientRef = ref('Patient', patient.id);

      const conditions = store.query<Condition>(
        'Condition',
        (c) => c.subject?.reference === patientRef && c.clinicalStatus === 'active',
      );
      const allergies = store.query<AllergyIntolerance>(
        'AllergyIntolerance',
        (a) => a.patient?.reference === patientRef && a.clinicalStatus === 'active',
      );
      const encounters = store
        .query<Encounter>('Encounter', (e) => e.subject?.reference === patientRef)
        .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''));
      const vitals = latestVitals(store.query<Observation>('Observation', (o) => o.subject?.reference === patientRef));

      return {
        patient,
        age: ageFromBirthDate(patient.birthDate),
        nhsNumber: patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
        activeEncounter: encounters.find((e) => e.status === 'in-progress') ?? null,
        problems: conditions,
        allergies,
        encounters,
        vitals,
        news2: vitals.news2,
      };
    });

    // Active inpatients worklist with NEWS2.
    app.get('/worklist', async () => {
      const encounters = store.query<Encounter>(
        'Encounter',
        (e) => e.class === 'inpatient' && e.status === 'in-progress',
      );
      return {
        total: encounters.length,
        items: encounters.map((e) => {
          const patient = store.get<Patient>('Patient', e.subject.reference.split('/')[1] ?? '');
          const vitals = latestVitals(
            store.query<Observation>('Observation', (o) => o.encounter?.reference === ref('Encounter', e.id)),
          );
          return {
            encounterId: e.id,
            patient,
            specialty: e.specialty,
            reason: e.reasonText,
            news2: vitals.news2,
          };
        }),
      };
    });

    // Register a new patient (validates NHS number check digit).
    const RegisterBody = z.object({
      family: z.string().min(1),
      given: z.string().min(1),
      birthDate: z.string(),
      gender: z.enum(['male', 'female', 'other', 'unknown']).default('unknown'),
      nhsNumber: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/register', async (req, reply) => {
      const body = RegisterBody.parse(req.body);
      if (body.nhsNumber && !isValidNhsNumber(body.nhsNumber)) {
        throw new ApiError(400, 'Invalid NHS number (failed Modulus 11 check)', 'invalid_nhs_number');
      }
      const created = store.create<Patient>('Patient', {
        name: [{ family: body.family, given: [body.given], use: 'official' }],
        birthDate: body.birthDate,
        gender: body.gender,
        identifier: body.nhsNumber
          ? [{ system: CodeSystems.NHS_NUMBER, value: body.nhsNumber, use: 'official' }]
          : [],
        active: true,
      });
      reply.code(201);
      return created;
    });
  },
});

interface VitalSnapshot {
  heartRate?: number;
  respiratoryRate?: number;
  spo2?: number;
  temperature?: number;
  systolicBp?: number;
  news2?: ReturnType<typeof calculateNews2> | null;
  recordedAt?: string;
}

function latestVitals(observations: Observation[]): VitalSnapshot {
  const vitals = observations
    .filter((o) => o.category === 'vital-signs')
    .sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime));
  const byCode = (loinc: string) =>
    vitals.find((o) => o.code?.coding?.some((c) => c.code === loinc))?.valueQuantity?.value;

  const snap: VitalSnapshot = {
    heartRate: byCode('8867-4'),
    respiratoryRate: byCode('9279-1'),
    spo2: byCode('2708-6'),
    temperature: byCode('8310-5'),
    systolicBp: byCode('8480-6'),
    recordedAt: vitals[0]?.effectiveDateTime,
    news2: null,
  };

  if (
    snap.respiratoryRate !== undefined &&
    snap.spo2 !== undefined &&
    snap.systolicBp !== undefined &&
    snap.heartRate !== undefined &&
    snap.temperature !== undefined
  ) {
    snap.news2 = calculateNews2({
      respiratoryRate: snap.respiratoryRate,
      spo2: snap.spo2,
      onOxygen: false,
      systolicBp: snap.systolicBp,
      pulse: snap.heartRate,
      consciousness: 'A',
      temperature: snap.temperature,
    });
  }
  return snap;
}
