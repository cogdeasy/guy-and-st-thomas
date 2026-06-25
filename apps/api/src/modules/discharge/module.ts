import { z } from 'zod';
import type { Encounter, Patient, Practitioner } from '@trustos/ontology';
import { ApiError, BadRequest, nowIso, parseRef, pick, ref } from '@trustos/core';
import type { DataStore } from '../../store/store';
import { defineModule } from '../types';
import {
  DISCHARGE_STATUSES,
  DischargeSummarySchema,
  buildChecklist,
  type DischargeStatus,
  type DischargeSummary,
} from './model';
import { COMMON_TTOS, FOLLOW_UPS, PRIMARY_DIAGNOSES } from './data';

/**
 * Discharge & TTO — discharge planning and "to take out" medicines.
 *
 * Owns the custom `DischargeSummary` collection and exposes workflow endpoints
 * (a readiness worklist, a composite editor read, and state transitions) on top
 * of the core Patient/Encounter resources. Plain CRUD is intentionally avoided —
 * generic FHIR CRUD already exists at /api/fhir/:type.
 */
export default defineModule({
  id: 'discharge',
  name: 'Discharge & TTO',
  description: 'Discharge planning, to-take-out medications and GP letters.',

  collections: [
    {
      name: 'DischargeSummary',
      validator: (input) => DischargeSummarySchema.parse(input),
    },
  ],

  routes(app, { store }) {
    // Worklist of patients in the discharge pipeline with checklist completeness.
    app.get<{ Querystring: { status?: string } }>('/worklist', async (req) => {
      const filter = req.query.status?.trim();
      if (filter && !DISCHARGE_STATUSES.includes(filter as DischargeStatus)) {
        throw BadRequest(`Unknown status filter: ${filter}`);
      }

      // Aggregate stats always reflect the whole pipeline; only the rows are filtered.
      const all = store.list<DischargeSummary>('DischargeSummary').map((s) => toWorklistItem(store, s));
      const items = (filter ? all.filter((i) => i.status === filter) : all).sort(
        (a, b) => a.checklist.complete - b.checklist.complete,
      );

      const byStatus = Object.fromEntries(
        DISCHARGE_STATUSES.map((st) => [st, all.filter((i) => i.status === st).length]),
      ) as Record<DischargeStatus, number>;

      return {
        total: all.length,
        readyForDischarge: all.filter((i) => i.checklist.ready && i.status !== 'completed').length,
        byStatus,
        items,
      };
    });

    // Composite read backing the summary editor: summary + patient + encounter.
    app.get<{ Params: { id: string } }>('/:id', async (req) => {
      const summary = store.getOrThrow<DischargeSummary>('DischargeSummary', req.params.id);
      const patient = resolvePatient(store, summary);
      const encounter = resolveEncounter(store, summary);
      return {
        summary,
        patient,
        encounter,
        checklist: buildChecklist(summary),
      };
    });

    // Open a new discharge summary (defaults to draft) for an admitted patient.
    const DraftBody = z.object({
      patientId: z.string().min(1),
      encounterId: z.string().optional(),
      diagnosis: z.string().optional(),
      followUp: z.string().optional(),
      ttoMeds: DischargeSummarySchema.shape.ttoMeds.optional(),
    });
    app.post<{ Body: unknown }>('/draft', async (req, reply) => {
      const body = DraftBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);

      const encounter = body.encounterId
        ? store.getOrThrow<Encounter>('Encounter', body.encounterId)
        : activeInpatientEncounter(store, patient.id);
      if (!encounter) {
        throw BadRequest('Patient has no active inpatient encounter to discharge from');
      }

      const existing = store
        .list<DischargeSummary>('DischargeSummary')
        .find((s) => s.encounter === ref('Encounter', encounter.id) && s.status !== 'completed');
      if (existing) {
        throw new ApiError(409, 'An open discharge summary already exists for this encounter', 'conflict');
      }

      const created = store.create<DischargeSummary>('DischargeSummary', {
        patient: ref('Patient', patient.id),
        encounter: ref('Encounter', encounter.id),
        status: 'draft',
        diagnosis: body.diagnosis ?? '',
        ttoMeds: body.ttoMeds ?? [],
        followUp: body.followUp ?? '',
        gpLetterGenerated: false,
        updatedAt: nowIso(),
      });
      reply.code(201);
      return created;
    });

    // Edit an in-flight discharge summary (diagnosis, TTOs, follow-up, GP letter).
    const UpdateBody = z
      .object({
        status: z.enum(DISCHARGE_STATUSES),
        diagnosis: z.string(),
        followUp: z.string(),
        gpLetterGenerated: z.boolean(),
        ttoMeds: DischargeSummarySchema.shape.ttoMeds,
      })
      .partial();
    app.put<{ Params: { id: string }; Body: unknown }>('/:id', async (req) => {
      const existing = store.getOrThrow<DischargeSummary>('DischargeSummary', req.params.id);
      if (existing.status === 'completed') {
        throw BadRequest('Discharge summary is completed and can no longer be edited');
      }
      const patch = UpdateBody.parse(req.body);
      if (patch.status === 'completed') {
        throw BadRequest('Use POST /:id/complete to finalise a discharge — it enforces the readiness checklist');
      }
      return store.update<DischargeSummary>('DischargeSummary', existing.id, {
        ...patch,
        updatedAt: nowIso(),
      });
    });

    // Complete the discharge: requires a ready checklist and finishes the encounter.
    app.post<{ Params: { id: string } }>('/:id/complete', async (req) => {
      const summary = store.getOrThrow<DischargeSummary>('DischargeSummary', req.params.id);
      if (summary.status === 'completed') {
        throw BadRequest('Discharge summary is already completed');
      }
      const checklist = buildChecklist(summary);
      if (!checklist.ready) {
        const outstanding = checklist.items.filter((i) => !i.done).map((i) => i.label);
        throw new ApiError(
          422,
          `Discharge checklist incomplete: ${outstanding.join(', ')}`,
          'checklist_incomplete',
        );
      }

      const completed = store.update<DischargeSummary>('DischargeSummary', summary.id, {
        status: 'completed',
        completedAt: nowIso(),
        updatedAt: nowIso(),
      });

      const encounter = resolveEncounter(store, summary);
      let finishedEncounter: Encounter | undefined;
      if (encounter) {
        finishedEncounter = store.update<Encounter>('Encounter', encounter.id, {
          status: 'finished',
          period: { ...encounter.period, end: nowIso() },
        });
      }

      return { summary: completed, encounter: finishedEncounter ?? null };
    });
  },

  seed({ store, rng }) {
    // Attach discharge summaries at various stages to a few admitted patients.
    const admitted = store
      .query<Encounter>('Encounter', (e) => e.class === 'inpatient' && e.status === 'in-progress')
      .sort((a, b) => a.id.localeCompare(b.id));
    const pharmacists = store.query<Practitioner>('Practitioner', (p) => p.role === 'Pharmacist');

    const cohort = admitted.slice(0, Math.min(7, admitted.length));
    cohort.forEach((encounter, index) => {
      // Spread statuses deterministically across the cohort so the demo always
      // shows draft, pending-pharmacy and completed examples.
      const status: DischargeStatus =
        index % 3 === 0 ? 'draft' : index % 3 === 1 ? 'pending-pharmacy' : 'completed';
      const advanced = status !== 'draft';

      const ttoMeds = pickN(COMMON_TTOS, randIntFor(advanced ? 2 : 1, advanced ? 4 : 2, rng), rng);
      const diagnosis = advanced || rng() < 0.5 ? pick(PRIMARY_DIAGNOSES, rng) : '';
      const followUp = advanced ? pick(FOLLOW_UPS, rng) : rng() < 0.4 ? pick(FOLLOW_UPS, rng) : '';
      const gpLetterGenerated = status === 'completed';

      const created = store.create<DischargeSummary>('DischargeSummary', {
        patient: encounter.subject.reference,
        encounter: ref('Encounter', encounter.id),
        status,
        diagnosis,
        ttoMeds: advanced ? ttoMeds : status === 'draft' && rng() < 0.5 ? ttoMeds : [],
        followUp,
        gpLetterGenerated,
        pharmacist:
          status === 'pending-pharmacy' && pharmacists.length
            ? ref('Practitioner', pick(pharmacists, rng).id)
            : undefined,
        updatedAt: nowIso(),
      });

      // Completed discharges finish the underlying encounter, mirroring /complete.
      if (status === 'completed') {
        store.update<Encounter>('Encounter', encounter.id, {
          status: 'finished',
          period: { ...encounter.period, end: nowIso() },
          diagnosis: [{ reference: ref('DischargeSummary', created.id) }],
        });
      }
    });
  },
});

interface WorklistItem {
  id: string;
  status: DischargeStatus;
  patient: Patient | undefined;
  encounter: Encounter | undefined;
  diagnosis: string;
  ttoCount: number;
  gpLetterGenerated: boolean;
  updatedAt?: string;
  checklist: ReturnType<typeof buildChecklist>;
}

function toWorklistItem(store: DataStore, summary: DischargeSummary): WorklistItem {
  return {
    id: summary.id,
    status: summary.status,
    patient: resolvePatient(store, summary),
    encounter: resolveEncounter(store, summary),
    diagnosis: summary.diagnosis,
    ttoCount: summary.ttoMeds.length,
    gpLetterGenerated: summary.gpLetterGenerated,
    updatedAt: summary.updatedAt,
    checklist: buildChecklist(summary),
  };
}

function resolvePatient(store: DataStore, summary: DischargeSummary): Patient | undefined {
  const id = parseRef(summary.patient)?.id;
  return id ? store.get<Patient>('Patient', id) : undefined;
}

function resolveEncounter(store: DataStore, summary: DischargeSummary): Encounter | undefined {
  const id = parseRef(summary.encounter)?.id;
  return id ? store.get<Encounter>('Encounter', id) : undefined;
}

function activeInpatientEncounter(store: DataStore, patientId: string): Encounter | undefined {
  const patientRef = ref('Patient', patientId);
  return store
    .query<Encounter>(
      'Encounter',
      (e) => e.subject?.reference === patientRef && e.class === 'inpatient' && e.status === 'in-progress',
    )
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''))[0];
}

function randIntFor(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickN<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0] as T);
  }
  return out;
}
