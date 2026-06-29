import { z } from 'zod';
import type { Encounter, Patient } from '@trustos/ontology';
import { BadRequest, isoHoursFromNow, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';

/**
 * Dietetics, Nutrition & Fluid Balance.
 *
 * Two workflows for the inpatient nutrition pathway:
 *  - MUST (Malnutrition Universal Screening Tool) screening + an at-risk
 *    worklist of admitted patients.
 *  - 24-hour fluid balance charting (intake vs output) per patient.
 *
 * Backed by two custom collections (NutritionScreen, FluidBalanceEntry) so the
 * shared ontology is never touched. Core Patients/Encounters are read by
 * reference to attach this module's data to real admitted patients.
 */

const WeightLossRisk = z.enum(['low', 'medium', 'high']);
export type WeightLossRisk = z.infer<typeof WeightLossRisk>;

const FLUID_ROUTES = ['oral', 'iv', 'ng-tube', 'urine', 'drain', 'stool', 'vomit'] as const;
export type FluidRoute = (typeof FLUID_ROUTES)[number];

/** A completed MUST screening for a patient. */
const NutritionScreen = z
  .object({
    id: z.string(),
    meta: z.record(z.unknown()).optional(),
    patient: z.object({ reference: z.string(), display: z.string().optional() }),
    encounter: z.object({ reference: z.string() }).optional(),
    mustScore: z.number().int().min(0).max(6),
    bmi: z.number().min(8).max(80),
    weightLossRisk: WeightLossRisk,
    referralToDietitian: z.boolean(),
    screenedAt: z.string(),
  })
  .passthrough();

/** A single intake or output measurement on the fluid balance chart. */
const FluidBalanceEntry = z
  .object({
    id: z.string(),
    meta: z.record(z.unknown()).optional(),
    patient: z.object({ reference: z.string(), display: z.string().optional() }),
    timestamp: z.string(),
    intakeMl: z.number().min(0).max(5000),
    outputMl: z.number().min(0).max(5000),
    route: z.enum(FLUID_ROUTES),
    note: z.string().optional(),
  })
  .passthrough();

type NutritionScreen = z.infer<typeof NutritionScreen>;
type FluidBalanceEntry = z.infer<typeof FluidBalanceEntry>;

/** MUST risk band from the aggregate score (0 low, 1 medium, >=2 high). */
function mustRisk(score: number): 'low' | 'medium' | 'high' {
  if (score >= 2) return 'high';
  if (score === 1) return 'medium';
  return 'low';
}

const ScreenBody = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().optional(),
  bmi: z.number().min(8).max(80),
  weightLossRisk: WeightLossRisk,
  acutelyIllNoIntake: z.boolean().default(false),
});

const FluidBody = z.object({
  intakeMl: z.number().min(0).max(5000).default(0),
  outputMl: z.number().min(0).max(5000).default(0),
  route: z.enum(FLUID_ROUTES),
  timestamp: z.string().optional(),
  note: z.string().optional(),
});

/** Derive the 0-6 MUST score from its three components. */
function scoreMust(input: {
  bmi: number;
  weightLossRisk: WeightLossRisk;
  acutelyIllNoIntake: boolean;
}): number {
  const bmiScore = input.bmi >= 20 ? 0 : input.bmi >= 18.5 ? 1 : 2;
  const lossScore = input.weightLossRisk === 'high' ? 2 : input.weightLossRisk === 'medium' ? 1 : 0;
  const acuteScore = input.acutelyIllNoIntake ? 2 : 0;
  return Math.min(6, bmiScore + lossScore + acuteScore);
}

export default defineModule({
  id: 'nutrition',
  name: 'Dietetics, Nutrition & Fluid Balance',
  description: 'MUST malnutrition screening, dietitian referral and 24-hour fluid balance charting.',

  collections: [
    { name: 'NutritionScreen', validator: (input) => NutritionScreen.parse(input) },
    { name: 'FluidBalanceEntry', validator: (input) => FluidBalanceEntry.parse(input) },
  ],

  routes(app, { store }) {
    // Nutrition risk worklist: every admitted patient with their latest MUST
    // screen, score and at-risk flag. Drives the dietetics review round.
    app.get('/worklist', async () => {
      const admitted = store.query<Encounter>(
        'Encounter',
        (e) => e.class === 'inpatient' && e.status === 'in-progress',
      );
      const screens = store.list<NutritionScreen>('NutritionScreen');

      const items = admitted.map((e) => {
        const patientId = e.subject.reference.split('/')[1] ?? '';
        const patient = store.get<Patient>('Patient', patientId);
        const patientRef = ref('Patient', patientId);
        const latest = screens
          .filter((s) => s.patient.reference === patientRef)
          .sort((a, b) => b.screenedAt.localeCompare(a.screenedAt))[0];
        return {
          encounterId: e.id,
          patient,
          specialty: e.specialty,
          screen: latest ?? null,
          mustScore: latest?.mustScore ?? null,
          risk: latest ? mustRisk(latest.mustScore) : null,
          atRisk: latest ? latest.mustScore >= 2 : false,
          referralToDietitian: latest?.referralToDietitian ?? false,
        };
      });

      items.sort((a, b) => (b.mustScore ?? -1) - (a.mustScore ?? -1));

      return {
        total: items.length,
        atRisk: items.filter((i) => i.atRisk).length,
        awaitingScreen: items.filter((i) => i.screen === null).length,
        items,
      };
    });

    // Record a MUST screening. Auto-refers to dietetics when high risk.
    app.post<{ Body: unknown }>('/screen', async (req, reply) => {
      const body = ScreenBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      const mustScore = scoreMust(body);
      const created = store.create<NutritionScreen>('NutritionScreen', {
        patient: {
          reference: ref('Patient', patient.id),
          display: displayName(patient),
        },
        ...(body.encounterId ? { encounter: { reference: ref('Encounter', body.encounterId) } } : {}),
        mustScore,
        bmi: body.bmi,
        weightLossRisk: body.weightLossRisk,
        referralToDietitian: mustScore >= 2,
        screenedAt: nowIso(),
      });
      reply.code(201);
      return { screen: created, risk: mustRisk(mustScore) };
    });

    // 24-hour fluid balance chart for a patient: hourly buckets plus a running
    // cumulative net balance and totals.
    app.get<{ Params: { patientId: string } }>('/:patientId/fluid-balance', async (req) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
      const patientRef = ref('Patient', patient.id);
      const since = isoHoursFromNow(-24);
      const entries = store
        .query<FluidBalanceEntry>(
          'FluidBalanceEntry',
          (f) => f.patient.reference === patientRef && f.timestamp >= since,
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      let runningBalance = 0;
      let totalIntake = 0;
      let totalOutput = 0;
      const series = entries.map((e) => {
        runningBalance += e.intakeMl - e.outputMl;
        totalIntake += e.intakeMl;
        totalOutput += e.outputMl;
        return {
          id: e.id,
          timestamp: e.timestamp,
          intakeMl: e.intakeMl,
          outputMl: e.outputMl,
          route: e.route,
          balanceMl: runningBalance,
        };
      });

      return {
        patient,
        windowHours: 24,
        totalIntakeMl: totalIntake,
        totalOutputMl: totalOutput,
        netBalanceMl: totalIntake - totalOutput,
        entries: series,
      };
    });

    // Add a fluid balance entry for a patient.
    app.post<{ Params: { patientId: string }; Body: unknown }>(
      '/:patientId/fluid',
      async (req, reply) => {
        const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
        const body = FluidBody.parse(req.body);
        if (body.intakeMl === 0 && body.outputMl === 0) {
          throw BadRequest('A fluid entry must record a non-zero intake or output volume');
        }
        const created = store.create<FluidBalanceEntry>('FluidBalanceEntry', {
          patient: { reference: ref('Patient', patient.id), display: displayName(patient) },
          timestamp: body.timestamp ?? nowIso(),
          intakeMl: body.intakeMl,
          outputMl: body.outputMl,
          route: body.route,
          ...(body.note ? { note: body.note } : {}),
        });
        reply.code(201);
        return created;
      },
    );
  },

  // Deterministic demo data: one MUST screen per admitted patient and a day of
  // fluid balance entries. All randomness flows through the seeded rng.
  seed({ store, rng }) {
    const admitted = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );

    for (const enc of admitted) {
      const patientId = enc.subject.reference.split('/')[1] ?? '';
      const patient = store.get<Patient>('Patient', patientId);
      if (!patient) continue;
      const patientRef = ref('Patient', patientId);
      const display = displayName(patient);

      const bmi = Number((15 + rng() * 18).toFixed(1));
      const weightLossRisk: WeightLossRisk = pick(['low', 'low', 'medium', 'high'], rng);
      const acutelyIllNoIntake = rng() < 0.3;
      const mustScore = scoreMust({ bmi, weightLossRisk, acutelyIllNoIntake });

      store.create<NutritionScreen>('NutritionScreen', {
        patient: { reference: patientRef, display },
        encounter: { reference: ref('Encounter', enc.id) },
        mustScore,
        bmi,
        weightLossRisk,
        referralToDietitian: mustScore >= 2,
        screenedAt: isoHoursFromNow(-randInt(2, 20, rng)),
      });

      // ~6-10 fluid entries spread across the last 24h.
      const entryCount = randInt(6, 10, rng);
      for (let i = 0; i < entryCount; i++) {
        const route = pick(FLUID_ROUTES, rng);
        const isIntake = route === 'oral' || route === 'iv' || route === 'ng-tube';
        store.create<FluidBalanceEntry>('FluidBalanceEntry', {
          patient: { reference: patientRef, display },
          timestamp: isoHoursFromNow(-randInt(0, 23, rng)),
          intakeMl: isIntake ? randInt(50, 500, rng) : 0,
          outputMl: isIntake ? 0 : randInt(50, 450, rng),
          route,
        });
      }
    }
  },
});

function displayName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}
