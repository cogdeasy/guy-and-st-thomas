import { z } from 'zod';
import type { Encounter, Patient, Practitioner } from '@trustos/ontology';
import { BadRequest, NotFound, ref } from '@trustos/core';
import { defineModule } from '../types';
import {
  BLEEDING_RISK_FACTORS,
  recommendProphylaxis,
  VTE_RISK_FACTORS,
  type Prophylaxis,
  type VteAssessment,
} from './vte';

/**
 * VTE Risk Assessment — NICE / Department of Health mandate that every adult
 * admission is risk-assessed for venous thromboembolism (VTE) within 24h.
 *
 * This module layers a compliance worklist, an assessment workflow and a
 * trust-level metrics endpoint on top of the core Encounter/Patient resources.
 * It owns a single custom collection, `VteAssessment`, so the shared ontology
 * stays untouched.
 */

const ProphylaxisEnum = z.enum(['mechanical', 'pharmacological', 'none']);

const AssessBody = z.object({
  encounterId: z.string().min(1),
  riskFactors: z.array(z.string()).default([]),
  bleedingRiskFactors: z.array(z.string()).default([]),
  /** Optional clinician override; otherwise derived from the risk factors. */
  prophylaxisRecommended: ProphylaxisEnum.optional(),
  assessedBy: z.string().optional(),
});

const ADMITTED = (e: Encounter) => e.class === 'inpatient' && e.status === 'in-progress';
const MS_PER_HOUR = 1000 * 60 * 60;

function hoursBetween(fromIso: string | undefined, toIso: string): number | undefined {
  if (!fromIso) return undefined;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return (to - from) / MS_PER_HOUR;
}

export default defineModule({
  id: 'vte',
  name: 'VTE Risk Assessment',
  description: 'NICE-mandated venous thromboembolism risk assessment and 24h compliance tracking.',

  collections: [{ name: 'VteAssessment' }],

  routes(app, { store }) {
    // Reference data for the assessment form (risk-factor catalogues).
    app.get('/catalog', async () => ({
      riskFactors: VTE_RISK_FACTORS,
      bleedingRiskFactors: BLEEDING_RISK_FACTORS,
      prophylaxisOptions: ProphylaxisEnum.options,
    }));

    // Compliance worklist: every admitted patient with assessment status and an
    // overdue flag once >24h have elapsed since admission without an assessment.
    app.get('/worklist', async () => {
      const now = new Date().toISOString();
      const encounters = store.query<Encounter>('Encounter', ADMITTED);
      const items = encounters
        .map((e) => {
          const patient = store.get<Patient>('Patient', e.subject.reference.split('/')[1] ?? '');
          const assessment = store.query<VteAssessment>(
            'VteAssessment',
            (a) => a.encounter?.reference === ref('Encounter', e.id),
          )[0];
          const admittedAt = e.period?.start;
          const hoursSinceAdmission = hoursBetween(admittedAt, now);
          const assessed = Boolean(assessment?.completed);
          const overdue =
            !assessed && hoursSinceAdmission !== undefined && hoursSinceAdmission > 24;
          return {
            encounterId: e.id,
            patient,
            specialty: e.specialty,
            reason: e.reasonText,
            admittedAt,
            hoursSinceAdmission:
              hoursSinceAdmission === undefined ? undefined : Math.round(hoursSinceAdmission),
            assessed,
            overdue,
            assessment: assessment ?? null,
          };
        })
        .sort((a, b) => Number(b.overdue) - Number(a.overdue));

      return {
        total: items.length,
        assessed: items.filter((i) => i.assessed).length,
        overdue: items.filter((i) => i.overdue).length,
        items,
      };
    });

    // Trust-level metrics: proportion of admissions assessed within 24h.
    app.get('/metrics', async () => {
      const encounters = store.query<Encounter>('Encounter', ADMITTED);
      const total = encounters.length;
      let assessed = 0;
      let withinTarget = 0;
      let overdue = 0;
      const byProphylaxis: Record<Prophylaxis, number> = {
        mechanical: 0,
        pharmacological: 0,
        none: 0,
      };

      for (const e of encounters) {
        const assessment = store.query<VteAssessment>(
          'VteAssessment',
          (a) => a.encounter?.reference === ref('Encounter', e.id),
        )[0];
        if (assessment?.completed) {
          assessed += 1;
          byProphylaxis[assessment.prophylaxisRecommended] += 1;
          const turnaround = hoursBetween(e.period?.start, assessment.assessedAt);
          if (turnaround !== undefined && turnaround <= 24) withinTarget += 1;
        } else {
          const elapsed = hoursBetween(e.period?.start, new Date().toISOString());
          if (elapsed !== undefined && elapsed > 24) overdue += 1;
        }
      }

      const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
      return {
        totalAdmitted: total,
        assessed,
        overdue,
        withinTarget,
        compliancePct: pct(withinTarget),
        assessedPct: pct(assessed),
        byProphylaxis,
      };
    });

    // Record (or update) a VTE risk assessment for an admitted encounter.
    app.post<{ Body: unknown }>('/assess', async (req, reply) => {
      const body = AssessBody.parse(req.body);
      const encounter = store.get<Encounter>('Encounter', body.encounterId);
      if (!encounter) throw NotFound(`Encounter/${body.encounterId}`);
      if (!ADMITTED(encounter)) {
        throw BadRequest('VTE assessment only applies to active inpatient encounters');
      }
      if (body.assessedBy && !store.get<Practitioner>('Practitioner', body.assessedBy)) {
        throw NotFound(`Practitioner/${body.assessedBy}`);
      }

      const prophylaxis: Prophylaxis =
        body.prophylaxisRecommended ??
        recommendProphylaxis(body.riskFactors, body.bleedingRiskFactors);

      const payload = {
        patient: { reference: encounter.subject.reference },
        encounter: { reference: ref('Encounter', encounter.id) },
        riskFactors: body.riskFactors,
        bleedingRiskFactors: body.bleedingRiskFactors,
        prophylaxisRecommended: prophylaxis,
        completed: true,
        assessedAt: new Date().toISOString(),
        assessedBy: body.assessedBy
          ? { reference: ref('Practitioner', body.assessedBy) }
          : undefined,
      };

      const existing = store.query<VteAssessment>(
        'VteAssessment',
        (a) => a.encounter?.reference === ref('Encounter', encounter.id),
      )[0];

      const saved = existing
        ? store.update<VteAssessment>('VteAssessment', existing.id, payload)
        : store.create<VteAssessment>('VteAssessment', payload);

      reply.code(existing ? 200 : 201);
      return saved;
    });
  },

  // Deterministic demo data: assess ~60% of admitted patients within 24h of
  // admission, deliberately leaving the remainder unassessed (and overdue).
  seed({ store, rng }) {
    const practitioners = store.list<Practitioner>('Practitioner');
    const encounters = store.query<Encounter>('Encounter', ADMITTED);

    for (const encounter of encounters) {
      if (rng() >= 0.6) continue; // ~40% left unassessed / overdue

      const riskFactors = sample(VTE_RISK_FACTORS, rng, 1, 3);
      const bleedingRiskFactors = rng() < 0.3 ? sample(BLEEDING_RISK_FACTORS, rng, 1, 2) : [];
      const assessor = practitioners[Math.floor(rng() * practitioners.length)];

      // Assessed within the first 24h of admission to count as compliant.
      const admittedAt = encounter.period?.start ?? new Date().toISOString();
      const assessedAt = new Date(
        new Date(admittedAt).getTime() + Math.floor(rng() * 20 * MS_PER_HOUR),
      ).toISOString();

      store.create<VteAssessment>('VteAssessment', {
        patient: { reference: encounter.subject.reference },
        encounter: { reference: ref('Encounter', encounter.id) },
        riskFactors,
        bleedingRiskFactors,
        prophylaxisRecommended: recommendProphylaxis(riskFactors, bleedingRiskFactors),
        completed: true,
        assessedAt,
        assessedBy: assessor ? { reference: ref('Practitioner', assessor.id) } : undefined,
      });
    }
  },
});

/** Pick between `min` and `max` distinct items using the seeded rng. */
function sample(items: readonly string[], rng: () => number, min: number, max: number): string[] {
  const count = Math.min(items.length, min + Math.floor(rng() * (max - min + 1)));
  const pool = [...items];
  const out: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}
