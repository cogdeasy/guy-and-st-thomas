import {
  CodeSystems,
  SPECIALTIES,
  type Encounter,
  type Location,
  type Observation,
  type Patient,
} from '@trustos/ontology';
import { pick, randInt, ref } from '@trustos/core';
import type { ModuleContext } from '../types';

/**
 * Deterministic operational-history enrichment for the analytics demo.
 *
 * The analytics endpoints compute live and work with bare core data, but core
 * only seeds in-progress inpatient stays (no discharges, no ED attendances and
 * no site attribution). This seed layers realistic, reproducible flow on top —
 * admissions/discharges across the last 7 days and ED attendances with a mix of
 * four-hour breaches — so the executive dashboard is clinically credible. All
 * randomness flows through the injected seeded `rng`.
 */
export function seedAnalytics(ctx: ModuleContext): void {
  const { store, rng } = ctx;

  const patients = store.list<Patient>('Patient');
  const sites = store.list<Location>('Location').filter((l) => l.physicalType === 'site');
  if (patients.length === 0 || sites.length === 0) return;

  const ED_REASONS = [
    'Chest pain',
    'Shortness of breath',
    'Abdominal pain',
    'Head injury',
    'Collapse',
    'Sepsis',
    'Overdose',
    'Fracture',
  ];

  // --- Inpatient admissions/discharges across the last 7 days ---------------
  for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
    const admissionsForDay = randInt(3, 7, rng);
    for (let a = 0; a < admissionsForDay; a++) {
      const patient = pick(patients, rng);
      const site = pick(sites, rng);
      const admitMs =
        Date.now() - dayOffset * DAY_MS - randInt(0, 23, rng) * 60 * 60 * 1000;
      const losDays = randInt(0, 5, rng);
      const dischargeMs = admitMs + losDays * DAY_MS + randInt(1, 20, rng) * 60 * 60 * 1000;
      const discharged = dischargeMs < Date.now() && rng() < 0.7;

      const encounter = store.create<Encounter>('Encounter', {
        status: discharged ? 'finished' : 'in-progress',
        class: 'inpatient',
        subject: { reference: ref('Patient', patient.id), display: displayName(patient) },
        location: { reference: ref('Location', site.id), display: site.name },
        period: {
          start: new Date(admitMs).toISOString(),
          ...(discharged ? { end: new Date(dischargeMs).toISOString() } : {}),
        },
        specialty: pick(SPECIALTIES, rng),
        reasonText: pick(
          ['Elective surgery', 'Acute medical admission', 'Cardiology review', 'Pneumonia', 'Stroke'],
          rng,
        ),
      });

      // Give current inpatients observable vitals so NEWS2 / deterioration works.
      if (!discharged) seedVitals(ctx, patient, encounter);
    }
  }

  // --- ED attendances in the last 24h, with a realistic breach mix ----------
  const edCount = randInt(10, 16, rng);
  for (let i = 0; i < edCount; i++) {
    const patient = pick(patients, rng);
    const site = pick(sites, rng);
    const arrivalMs = Date.now() - randInt(0, 23, rng) * 60 * 60 * 1000 - randInt(0, 59, rng) * 60 * 1000;
    // ~75% are resolved within the four-hour standard; the rest breach.
    const durationMins = rng() < 0.75 ? randInt(40, 235, rng) : randInt(245, 600, rng);
    const departMs = arrivalMs + durationMins * 60 * 1000;
    const departed = departMs < Date.now();

    store.create<Encounter>('Encounter', {
      status: departed ? 'finished' : 'in-progress',
      class: 'emergency',
      subject: { reference: ref('Patient', patient.id), display: displayName(patient) },
      location: { reference: ref('Location', site.id), display: site.name },
      period: {
        start: new Date(arrivalMs).toISOString(),
        ...(departed ? { end: new Date(departMs).toISOString() } : {}),
      },
      specialty: 'Emergency Medicine',
      reasonText: pick(ED_REASONS, rng),
    });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function displayName(patient: Patient): string {
  const n = patient.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim();
}

function seedVitals(ctx: ModuleContext, patient: Patient, encounter: Encounter): void {
  const { store, rng } = ctx;
  const subject = { reference: ref('Patient', patient.id) };
  const enc = { reference: ref('Encounter', encounter.id) };
  const obs = (code: string, display: string, value: number, unit: string) =>
    store.create<Observation>('Observation', {
      status: 'final',
      category: 'vital-signs',
      code: { coding: [{ system: CodeSystems.LOINC, code, display }], text: display },
      subject,
      encounter: enc,
      effectiveDateTime: new Date().toISOString(),
      valueQuantity: { value, unit },
    });
  // Skew a minority towards deterioration so the watchlist is meaningful.
  const sick = rng() < 0.3;
  obs('8867-4', 'Heart rate', sick ? randInt(105, 135, rng) : randInt(60, 95, rng), 'bpm');
  obs('9279-1', 'Respiratory rate', sick ? randInt(22, 30, rng) : randInt(12, 19, rng), '/min');
  obs('2708-6', 'Oxygen saturation', sick ? randInt(89, 93, rng) : randInt(95, 100, rng), '%');
  obs('8310-5', 'Body temperature', Number((sick ? 38 + rng() * 1.8 : 36.3 + rng() * 1.2).toFixed(1)), 'Cel');
  obs('8480-6', 'Systolic blood pressure', sick ? randInt(85, 100, rng) : randInt(105, 145, rng), 'mmHg');
}
