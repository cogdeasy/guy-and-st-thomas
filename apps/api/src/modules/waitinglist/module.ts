import { z } from 'zod';
import type { Patient } from '@trustos/ontology';
import { BadRequest, isoDaysAgo, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';

/**
 * Elective Waiting List / Patient Tracking List (PTL).
 *
 * Tracks patients on the elective surgical waiting list against the NHS 18-week
 * Referral-To-Treatment (RTT) access standard. The module owns a custom
 * `WaitingListEntry` collection (not part of the core ontology) and exposes
 * workflow endpoints — a sorted, breach-aware worklist, list management and a
 * metrics summary — rather than plain CRUD (generic CRUD already exists at
 * `/api/fhir/:type`).
 */

const COLLECTION = 'WaitingListEntry';

const PRIORITIES = ['routine', 'urgent'] as const;
const STATUSES = ['waiting', 'tci', 'admitted', 'removed'] as const;
type Priority = (typeof PRIORITIES)[number];
type Status = (typeof STATUSES)[number];

/** RTT target windows in weeks by clinical priority. */
const TARGET_WEEKS: Record<Priority, number> = { routine: 18, urgent: 4 };
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Surgical specialties and a representative elective procedure menu. */
const SURGICAL_PROCEDURES: Record<string, string[]> = {
  'General Surgery': ['Laparoscopic cholecystectomy', 'Inguinal hernia repair', 'Haemorrhoidectomy'],
  Orthopaedics: ['Total knee replacement', 'Total hip replacement', 'Arthroscopy of knee', 'Carpal tunnel decompression'],
  Urology: ['Transurethral resection of prostate', 'Cystoscopy', 'Circumcision'],
  Ophthalmology: ['Phacoemulsification (cataract)', 'Trabeculectomy'],
  'Vascular Surgery': ['Varicose vein surgery', 'Endovascular aneurysm repair'],
  'Cardiac Surgery': ['Coronary artery bypass graft', 'Aortic valve replacement'],
  'Obstetrics & Gynaecology': ['Hysteroscopy', 'Laparoscopic hysterectomy'],
};
const SURGICAL_SPECIALTIES = Object.keys(SURGICAL_PROCEDURES);

interface WaitingListEntry {
  id: string;
  resourceType?: string;
  patient: string;
  patientDisplay?: string;
  specialty: string;
  procedure: string;
  priority: Priority;
  listedDate: string;
  targetDate: string;
  status: Status;
  tciDate?: string;
  removalReason?: string;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Validator for the custom collection; tolerant of store-managed fields. */
const WaitingListEntrySchema = z
  .object({
    id: z.string(),
    patient: z.string().regex(/^Patient\//, 'patient must be a Patient reference'),
    patientDisplay: z.string().optional(),
    specialty: z.string().min(1),
    procedure: z.string().min(1),
    priority: z.enum(PRIORITIES),
    listedDate: z.string(),
    targetDate: z.string(),
    status: z.enum(STATUSES),
    tciDate: z.string().optional(),
    removalReason: z.string().optional(),
  })
  .passthrough();

function targetDateFor(listedDate: string, priority: Priority): string {
  const d = new Date(listedDate);
  d.setUTCDate(d.getUTCDate() + TARGET_WEEKS[priority] * 7);
  return d.toISOString();
}

/** Decorate a stored entry with computed RTT fields used by the worklist/UI. */
function decorate(entry: WaitingListEntry, now = Date.now()) {
  const listedMs = new Date(entry.listedDate).getTime();
  const targetMs = new Date(entry.targetDate).getTime();
  const weeksWaiting = Math.max(0, Math.floor((now - listedMs) / MS_PER_WEEK));
  const weeksToTarget = Math.round((targetMs - now) / MS_PER_WEEK);
  const isActive = entry.status === 'waiting' || entry.status === 'tci';
  const breached = isActive && now > targetMs;
  return {
    ...entry,
    weeksWaiting,
    weeksToTarget,
    breached,
    targetWeeks: TARGET_WEEKS[entry.priority],
  };
}

export default defineModule({
  id: 'waitinglist',
  name: 'Elective Waiting List (PTL)',
  description: 'Elective surgical Patient Tracking List with 18-week RTT breach tracking and TCI scheduling.',

  collections: [{ name: COLLECTION, validator: (input) => WaitingListEntrySchema.parse(input) }],

  routes(app, { store }) {
    const get = (id: string) => store.getOrThrow<WaitingListEntry>(COLLECTION, id);

    // Raw list of entries (convenience / debugging).
    app.get('/', async () => ({ items: store.list<WaitingListEntry>(COLLECTION) }));

    // PTL worklist: active entries sorted by longest wait, with breach flags.
    // Optional filters: ?specialty=...&priority=...&status=...
    app.get<{ Querystring: { specialty?: string; priority?: string; status?: string } }>(
      '/ptl',
      async (req) => {
        const { specialty, priority, status } = req.query;
        const now = Date.now();
        let entries = store.list<WaitingListEntry>(COLLECTION);
        if (specialty) entries = entries.filter((e) => e.specialty === specialty);
        if (priority) entries = entries.filter((e) => e.priority === priority);
        entries = status
          ? entries.filter((e) => e.status === status)
          : entries.filter((e) => e.status === 'waiting' || e.status === 'tci');

        const items = entries
          .map((e) => decorate(e, now))
          .sort((a, b) => b.weeksWaiting - a.weeksWaiting);

        return {
          total: items.length,
          breaches: items.filter((i) => i.breached).length,
          items,
        };
      },
    );

    // Aggregate metrics: longest waiters and breaches broken down by specialty.
    app.get('/metrics', async () => {
      const now = Date.now();
      const active = store
        .list<WaitingListEntry>(COLLECTION)
        .filter((e) => e.status === 'waiting' || e.status === 'tci')
        .map((e) => decorate(e, now));

      const bySpecialty = new Map<string, { specialty: string; total: number; breaches: number; longestWeeks: number }>();
      for (const e of active) {
        const row = bySpecialty.get(e.specialty) ?? {
          specialty: e.specialty,
          total: 0,
          breaches: 0,
          longestWeeks: 0,
        };
        row.total += 1;
        if (e.breached) row.breaches += 1;
        row.longestWeeks = Math.max(row.longestWeeks, e.weeksWaiting);
        bySpecialty.set(e.specialty, row);
      }

      const longestWaiters = [...active].sort((a, b) => b.weeksWaiting - a.weeksWaiting).slice(0, 5);

      return {
        totalWaiting: active.length,
        totalBreaches: active.filter((e) => e.breached).length,
        awaitingTci: active.filter((e) => e.status === 'waiting').length,
        scheduledTci: active.filter((e) => e.status === 'tci').length,
        longestWaitWeeks: longestWaiters[0]?.weeksWaiting ?? 0,
        bySpecialty: [...bySpecialty.values()].sort((a, b) => b.breaches - a.breaches || b.total - a.total),
        longestWaiters,
      };
    });

    // Add a patient to the waiting list.
    const AddBody = z.object({
      patientId: z.string().min(1),
      specialty: z.string().min(1),
      procedure: z.string().min(1),
      priority: z.enum(PRIORITIES).default('routine'),
      listedDate: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/add', async (req, reply) => {
      const body = AddBody.parse(req.body);
      const patient = store.get<Patient>('Patient', body.patientId);
      if (!patient) throw BadRequest(`Unknown patient ${body.patientId}`);
      const listedDate = body.listedDate ?? nowIso();
      const name = patient.name?.[0];
      const created = store.create<WaitingListEntry>(COLLECTION, {
        patient: ref('Patient', patient.id),
        patientDisplay: `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim(),
        specialty: body.specialty,
        procedure: body.procedure,
        priority: body.priority,
        listedDate,
        targetDate: targetDateFor(listedDate, body.priority),
        status: 'waiting',
      });
      reply.code(201);
      return decorate(created);
    });

    // Schedule a To-Come-In (TCI) admission date.
    const TciBody = z.object({ tciDate: z.string().min(1) });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/tci', async (req) => {
      const entry = get(req.params.id);
      if (entry.status === 'removed') throw BadRequest('Cannot schedule a removed entry');
      const { tciDate } = TciBody.parse(req.body);
      const updated = store.update<WaitingListEntry>(COLLECTION, entry.id, { status: 'tci', tciDate });
      return decorate(updated);
    });

    // Remove a patient from the list (treated, declined, deceased, etc.).
    const RemoveBody = z.object({ reason: z.string().min(1).default('Treated / admitted') });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/remove', async (req) => {
      const entry = get(req.params.id);
      const { reason } = RemoveBody.parse(req.body ?? {});
      const updated = store.update<WaitingListEntry>(COLLECTION, entry.id, {
        status: 'removed',
        removalReason: reason,
      });
      return decorate(updated);
    });
  },

  // ~20 reproducible entries listed 0-40 weeks ago across surgical specialties.
  seed({ store, rng }) {
    const patients = store.list<Patient>('Patient');
    if (patients.length === 0) return;

    const count = 20;
    for (let i = 0; i < count; i++) {
      const patient = pick(patients, rng);
      const specialty = pick(SURGICAL_SPECIALTIES, rng);
      const procedure = pick(SURGICAL_PROCEDURES[specialty] ?? ['Elective procedure'], rng);
      const priority: Priority = rng() < 0.25 ? 'urgent' : 'routine';
      const weeksAgo = randInt(0, 40, rng);
      const listedDate = isoDaysAgo(weeksAgo * 7);
      const targetDate = targetDateFor(listedDate, priority);

      // Most are still waiting; a few have a TCI scheduled.
      const roll = rng();
      let status: Status = 'waiting';
      let tciDate: string | undefined;
      if (roll < 0.25) {
        status = 'tci';
        tciDate = isoDaysAgo(-randInt(3, 28, rng)); // a future admission date
      }

      const name = patient.name?.[0];
      store.put<WaitingListEntry>(COLLECTION, {
        id: `wl-${i + 1}`,
        patient: ref('Patient', patient.id),
        patientDisplay: `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim(),
        specialty,
        procedure,
        priority,
        listedDate,
        targetDate,
        status,
        ...(tciDate ? { tciDate } : {}),
        meta: { lastUpdated: nowIso(), versionId: '1' },
      });
    }
  },
});
