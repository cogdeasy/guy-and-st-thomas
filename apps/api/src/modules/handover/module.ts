import { z } from 'zod';
import {
  type Condition,
  type Encounter,
  type Observation,
  type Patient,
  type Practitioner,
} from '@trustos/ontology';
import { BadRequest, nowIso, pick, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore, Entity } from '../../store/store';
import {
  PRIORITY_RANK,
  composeSbar,
  composeSbarSeed,
  latestNews2,
  patientIdFromRef,
  pickShift,
  priorityFromNews2,
  type News2Snapshot,
  type Shift,
} from './sbar';

/**
 * Clinical Handover (SBAR) — structured shift handover for inpatient wards.
 *
 * Owns a custom `HandoverEntry` collection (one SBAR record per admitted
 * patient) and exposes workflow endpoints on top of the core FHIR store:
 * a prioritised board, create/edit, and a one-click generator that drafts
 * entries for every admitted patient from their latest NEWS2 and problem list.
 */

const ReferenceSchema = z.object({ reference: z.string(), display: z.string().optional() });
const PrioritySchema = z.enum(['routine', 'urgent', 'high']);
const ShiftSchema = z.enum(['day', 'night']);
const StatusSchema = z.enum(['active', 'handed-over']);
const News2SnapshotSchema = z
  .object({
    score: z.number(),
    risk: z.string(),
    recommendation: z.string(),
    recordedAt: z.string().optional(),
  })
  .nullable();

const HandoverEntrySchema = z
  .object({
    id: z.string(),
    patient: ReferenceSchema,
    encounter: ReferenceSchema.optional(),
    ward: z.string().optional(),
    specialty: z.string().optional(),
    situation: z.string().min(1),
    background: z.string().min(1),
    assessment: z.string().min(1),
    recommendation: z.string().min(1),
    news2: News2SnapshotSchema.default(null),
    priority: PrioritySchema.default('routine'),
    author: ReferenceSchema.optional(),
    shift: ShiftSchema.default('day'),
    status: StatusSchema.default('active'),
    updatedAt: z.string(),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

type HandoverEntry = z.infer<typeof HandoverEntrySchema> & Entity;

const COLLECTION = 'HandoverEntry';

const CreateEntryBody = z.object({
  patientId: z.string().min(1),
  situation: z.string().min(1),
  background: z.string().min(1),
  assessment: z.string().min(1),
  recommendation: z.string().min(1),
  priority: PrioritySchema.optional(),
  shift: ShiftSchema.optional(),
  authorId: z.string().optional(),
});

const UpdateEntryBody = z
  .object({
    situation: z.string().min(1).optional(),
    background: z.string().min(1).optional(),
    assessment: z.string().min(1).optional(),
    recommendation: z.string().min(1).optional(),
    priority: PrioritySchema.optional(),
    shift: ShiftSchema.optional(),
    status: StatusSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' });

const GenerateBody = z
  .object({
    shift: ShiftSchema.optional(),
  })
  .optional();

export default defineModule({
  id: 'handover',
  name: 'Clinical Handover (SBAR)',
  description: 'Structured SBAR shift handover board for admitted patients, prioritised by NEWS2.',

  collections: [{ name: COLLECTION, validator: (input) => HandoverEntrySchema.parse(input) as Entity }],

  routes(app, { store }) {
    /** Prioritised current handover list. Optional `?shift=` and `?status=` filters. */
    app.get<{ Querystring: { shift?: Shift; status?: string } }>('/list', async (req) => {
      const { shift, status } = req.query;
      let items = store.list<HandoverEntry>(COLLECTION);
      if (shift) items = items.filter((e) => e.shift === shift);
      if (status) items = items.filter((e) => e.status === status);

      const enriched = items
        .map((entry) => {
          const patient = store.get<Patient>('Patient', patientIdFromRef(entry.patient.reference));
          const author = entry.author
            ? store.get<Practitioner>('Practitioner', patientIdFromRef(entry.author.reference))
            : undefined;
          return { ...entry, patient: patient ?? null, author: author ?? null };
        })
        .sort((a, b) => {
          const byPriority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
          if (byPriority !== 0) return byPriority;
          return (b.news2?.score ?? -1) - (a.news2?.score ?? -1);
        });

      const counts = {
        high: enriched.filter((e) => e.priority === 'high').length,
        urgent: enriched.filter((e) => e.priority === 'urgent').length,
        routine: enriched.filter((e) => e.priority === 'routine').length,
      };

      return { total: enriched.length, counts, items: enriched };
    });

    /** Create a single SBAR handover entry for a patient. */
    app.post<{ Body: unknown }>('/entries', async (req, reply) => {
      const body = CreateEntryBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      const author = body.authorId
        ? store.getOrThrow<Practitioner>('Practitioner', body.authorId)
        : undefined;

      const news2 = patientNews2(store, patient.id);
      const encounter = activeEncounter(store, patient.id);

      const created = store.create<HandoverEntry>(COLLECTION, {
        patient: { reference: ref('Patient', patient.id), display: displayName(patient) },
        encounter: encounter ? { reference: ref('Encounter', encounter.id) } : undefined,
        specialty: encounter?.specialty,
        situation: body.situation,
        background: body.background,
        assessment: body.assessment,
        recommendation: body.recommendation,
        news2,
        priority: body.priority ?? priorityFromNews2(news2),
        author: author
          ? { reference: ref('Practitioner', author.id), display: displayName(author) }
          : undefined,
        shift: body.shift ?? 'day',
        status: 'active',
        updatedAt: nowIso(),
      });

      reply.code(201);
      return created;
    });

    /** Edit an existing handover entry (SBAR fields, priority, shift, status). */
    app.put<{ Params: { id: string }; Body: unknown }>('/entries/:id', async (req) => {
      const patch = UpdateEntryBody.parse(req.body);
      store.getOrThrow<HandoverEntry>(COLLECTION, req.params.id);
      return store.update<HandoverEntry>(COLLECTION, req.params.id, { ...patch, updatedAt: nowIso() });
    });

    /**
     * Auto-generate handover entries for every admitted patient that does not
     * already have an active entry, drafting SBAR text from their latest NEWS2
     * and active problems.
     */
    app.post<{ Body: unknown }>('/generate', async (req, reply) => {
      const body = GenerateBody.parse(req.body) ?? {};
      const shift = body.shift ?? 'day';

      const admitted = store.query<Encounter>(
        'Encounter',
        (e) => e.class === 'inpatient' && e.status === 'in-progress',
      );
      if (admitted.length === 0) {
        throw BadRequest('No admitted patients to generate handover entries for.');
      }

      const existing = new Set(
        store
          .list<HandoverEntry>(COLLECTION)
          .filter((e) => e.status === 'active')
          .map((e) => e.patient.reference),
      );

      const created: HandoverEntry[] = [];
      for (const encounter of admitted) {
        const patientRef = encounter.subject.reference;
        if (existing.has(patientRef)) continue;
        const patient = store.get<Patient>('Patient', patientIdFromRef(patientRef));
        if (!patient) continue;
        // Guard against a patient with more than one active inpatient encounter.
        existing.add(patientRef);

        const news2 = patientNews2(store, patient.id);
        const problems = activeProblems(store, patient.id);
        const sbar = composeSbar({ patient, encounter, problems, news2 });

        created.push(
          store.create<HandoverEntry>(COLLECTION, {
            patient: { reference: patientRef, display: displayName(patient) },
            encounter: { reference: ref('Encounter', encounter.id) },
            specialty: encounter.specialty,
            ...sbar,
            news2,
            priority: priorityFromNews2(news2),
            shift,
            status: 'active',
            updatedAt: nowIso(),
          }),
        );
      }

      reply.code(201);
      return { generated: created.length, skipped: admitted.length - created.length, items: created };
    });
  },

  seed({ store, rng }) {
    const admitted = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );
    const practitioners = store.list<Practitioner>('Practitioner');

    for (const encounter of admitted) {
      const patient = store.get<Patient>('Patient', patientIdFromRef(encounter.subject.reference));
      if (!patient) continue;
      // Hand over roughly 4 in 5 admitted patients this shift.
      if (rng() < 0.2) continue;

      const news2 = patientNews2(store, patient.id);
      const problems = activeProblems(store, patient.id);
      const sbar = composeSbarSeed({ patient, encounter, problems, news2 }, rng);
      const author = practitioners.length > 0 ? pick(practitioners, rng) : undefined;

      store.create<HandoverEntry>(COLLECTION, {
        patient: { reference: encounter.subject.reference, display: displayName(patient) },
        encounter: { reference: ref('Encounter', encounter.id) },
        specialty: encounter.specialty,
        ...sbar,
        news2,
        priority: priorityFromNews2(news2),
        author: author
          ? { reference: ref('Practitioner', author.id), display: displayName(author) }
          : undefined,
        shift: pickShift(rng),
        status: 'active',
        updatedAt: nowIso(),
      });
    }
  },
});

function displayName(person: Patient | Practitioner): string {
  const name = person.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}

function activeEncounter(store: DataStore, patientId: string): Encounter | undefined {
  return store
    .query<Encounter>(
      'Encounter',
      (e) => e.subject.reference === ref('Patient', patientId) && e.status === 'in-progress',
    )
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''))[0];
}

function patientNews2(store: DataStore, patientId: string): News2Snapshot | null {
  const observations = store.query<Observation>(
    'Observation',
    (o) => o.subject.reference === ref('Patient', patientId),
  );
  return latestNews2(observations);
}

function activeProblems(store: DataStore, patientId: string): Condition[] {
  return store.query<Condition>(
    'Condition',
    (c) => c.subject.reference === ref('Patient', patientId) && c.clinicalStatus === 'active',
  );
}
