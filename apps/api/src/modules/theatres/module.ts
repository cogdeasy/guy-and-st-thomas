import { z } from 'zod';
import {
  CodeSystems,
  GSTT_SITES,
  type Patient,
  type Practitioner,
} from '@trustos/ontology';
import { BadRequest, NotFound, nowIso, parseRef, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore, Entity } from '../../store/store';

/**
 * Theatre Scheduling & Coordination.
 *
 * Operating-theatre lists and live theatre status for GSTT. Owns two custom
 * collections — `TheatreList` (a surgeon's session in a theatre) and
 * `TheatreCase` (a patient booked onto a list) — and exposes workflow
 * endpoints to read today's lists, drive a live theatre board, and advance a
 * case through the perioperative pathway.
 */

/** Perioperative pathway — the order is the legal forward state machine. */
const CASE_STATUSES = [
  'scheduled',
  'sent-for',
  'anaesthetic',
  'in-theatre',
  'recovery',
  'complete',
] as const;
type CaseStatus = (typeof CASE_STATUSES)[number];

/** Statuses where the patient is actively in the perioperative process. */
const ACTIVE_STATUSES: CaseStatus[] = ['sent-for', 'anaesthetic', 'in-theatre', 'recovery'];

/** NCEPOD classification of intervention. */
const CASE_PRIORITIES = ['elective', 'expedited', 'urgent', 'immediate'] as const;
type CasePriority = (typeof CASE_PRIORITIES)[number];

const SESSIONS = ['AM', 'PM'] as const;

type TheatreList = Entity & {
  id: string;
  date: string;
  theatre: string;
  site: string;
  session: (typeof SESSIONS)[number];
  surgeon: string;
  surgeonName: string;
  specialty: string;
};

interface CaseStatusEvent {
  status: CaseStatus;
  at: string;
}

type TheatreCase = Entity & {
  id: string;
  list: string;
  patient: string;
  patientName: string;
  procedureCode?: string;
  procedureText: string;
  order: number;
  status: CaseStatus;
  priority: CasePriority;
  estimatedMinutes: number;
  statusHistory: CaseStatusEvent[];
  updatedAt: string;
};

const TheatreListSchema = z
  .object({
    id: z.string(),
    date: z.string(),
    theatre: z.string().min(1),
    site: z.string().min(1),
    session: z.enum(SESSIONS),
    surgeon: z.string().min(1),
    surgeonName: z.string().min(1),
    specialty: z.string().min(1),
  })
  .passthrough();

const TheatreCaseSchema = z
  .object({
    id: z.string(),
    list: z.string().min(1),
    patient: z.string().min(1),
    patientName: z.string().min(1),
    procedureCode: z.string().optional(),
    procedureText: z.string().min(1),
    order: z.number().int().positive(),
    status: z.enum(CASE_STATUSES),
    priority: z.enum(CASE_PRIORITIES),
    estimatedMinutes: z.number().int().positive(),
    statusHistory: z
      .array(z.object({ status: z.enum(CASE_STATUSES), at: z.string() }))
      .default([]),
    updatedAt: z.string(),
  })
  .passthrough();

const PROCEDURES: Array<{ code: string; text: string; specialty: string; minutes: number }> = [
  { code: '80146002', text: 'Appendicectomy', specialty: 'General Surgery', minutes: 60 },
  { code: '38102005', text: 'Laparoscopic cholecystectomy', specialty: 'General Surgery', minutes: 90 },
  { code: '112693004', text: 'Inguinal hernia repair', specialty: 'General Surgery', minutes: 75 },
  { code: '52734007', text: 'Total hip replacement', specialty: 'Orthopaedics', minutes: 120 },
  { code: '274330006', text: 'Total knee replacement', specialty: 'Orthopaedics', minutes: 110 },
  { code: '396487001', text: 'Hemiarthroplasty of hip', specialty: 'Orthopaedics', minutes: 90 },
  { code: '173171007', text: 'Coronary artery bypass graft', specialty: 'Cardiac Surgery', minutes: 240 },
  { code: '76601001', text: 'Phacoemulsification of cataract', specialty: 'Ophthalmology', minutes: 30 },
  { code: '236886002', text: 'Total abdominal hysterectomy', specialty: 'Obstetrics & Gynaecology', minutes: 120 },
  { code: '90470006', text: 'Radical prostatectomy', specialty: 'Urology', minutes: 150 },
];

const THEATRES: Array<{ theatre: string; site: string; specialty: string }> = [
  { theatre: 'Main Theatre 1', site: "Guy's Hospital", specialty: 'General Surgery' },
  { theatre: 'Orthopaedic Theatre 2', site: "St Thomas' Hospital", specialty: 'Orthopaedics' },
  { theatre: 'Cardiac Theatre 3', site: 'Royal Brompton Hospital', specialty: 'Cardiac Surgery' },
  { theatre: 'Day Surgery Unit 4', site: "Guy's Hospital", specialty: 'Ophthalmology' },
];

function nextStatus(current: CaseStatus): CaseStatus | null {
  const idx = CASE_STATUSES.indexOf(current);
  return idx >= 0 && idx < CASE_STATUSES.length - 1 ? (CASE_STATUSES[idx + 1] as CaseStatus) : null;
}

function fullName(person: { name?: Array<{ given?: string[]; family?: string; prefix?: string[] }> }): string {
  const n = person.name?.[0];
  if (!n) return 'Unknown';
  return [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ');
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Resolve a list's cases, sorted by their order on the list. */
function casesForList(store: DataStore, listId: string): TheatreCase[] {
  return store
    .query<TheatreCase>('TheatreCase', (c) => c.list === ref('TheatreList', listId))
    .sort((a, b) => a.order - b.order);
}

function enrichCase(store: DataStore, c: TheatreCase) {
  const patientId = parseRef(c.patient)?.id ?? '';
  const patient = store.get<Patient>('Patient', patientId);
  return {
    id: c.id,
    listId: parseRef(c.list)?.id ?? c.list,
    order: c.order,
    status: c.status,
    priority: c.priority,
    procedureCode: c.procedureCode,
    procedureText: c.procedureText,
    estimatedMinutes: c.estimatedMinutes,
    updatedAt: c.updatedAt,
    statusHistory: c.statusHistory,
    patient: {
      id: patientId,
      name: c.patientName,
      nhsNumber: patient?.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
      birthDate: patient?.birthDate,
    },
  };
}

export default defineModule({
  id: 'theatres',
  name: 'Theatre Scheduling & Coordination',
  description: 'Operating theatre lists, live theatre board and perioperative pathway tracking.',

  collections: [
    { name: 'TheatreList', validator: (input) => TheatreListSchema.parse(input) },
    { name: 'TheatreCase', validator: (input) => TheatreCaseSchema.parse(input) },
  ],

  routes(app, { store }) {
    // Today's theatre lists (optionally ?date=) with their ordered cases.
    app.get<{ Querystring: { date?: string } }>('/lists', async (req) => {
      const date = (req.query.date ?? todayIso()).trim();
      const lists = store
        .list<TheatreList>('TheatreList', { date })
        .sort((a, b) => a.theatre.localeCompare(b.theatre) || a.session.localeCompare(b.session));
      return {
        date,
        total: lists.length,
        lists: lists.map((list) => {
          const cases = casesForList(store, list.id);
          return {
            ...list,
            cases: cases.map((c) => enrichCase(store, c)),
            counts: countByStatus(cases),
          };
        }),
      };
    });

    // A single list with its cases.
    app.get<{ Params: { id: string } }>('/lists/:id', async (req) => {
      const list = store.getOrThrow<TheatreList>('TheatreList', req.params.id);
      const cases = casesForList(store, list.id);
      return { ...list, cases: cases.map((c) => enrichCase(store, c)), counts: countByStatus(cases) };
    });

    // Live theatre board — one tile per theatre with the in-progress case.
    app.get<{ Querystring: { date?: string } }>('/board', async (req) => {
      const date = (req.query.date ?? todayIso()).trim();
      const lists = store.list<TheatreList>('TheatreList', { date });
      const board = lists
        .map((list) => {
          const cases = casesForList(store, list.id);
          const current = cases.find((c) => ACTIVE_STATUSES.includes(c.status)) ?? null;
          const next = cases.find((c) => c.status === 'scheduled') ?? null;
          const completed = cases.filter((c) => c.status === 'complete').length;
          return {
            listId: list.id,
            theatre: list.theatre,
            site: list.site,
            session: list.session,
            specialty: list.specialty,
            surgeon: list.surgeonName,
            state: current ? current.status : completed === cases.length && cases.length > 0 ? 'complete' : 'idle',
            currentCase: current ? enrichCase(store, current) : null,
            nextCase: next ? enrichCase(store, next) : null,
            totalCases: cases.length,
            completed,
            counts: countByStatus(cases),
          };
        })
        .sort((a, b) => a.theatre.localeCompare(b.theatre));
      return { date, total: board.length, theatres: board };
    });

    // Create a theatre list.
    const ListBody = z.object({
      date: z.string().optional(),
      theatre: z.string().min(1),
      site: z.string().optional(),
      session: z.enum(SESSIONS),
      surgeonId: z.string().min(1),
      specialty: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/lists', async (req, reply) => {
      const body = ListBody.parse(req.body);
      const surgeon = store.get<Practitioner>('Practitioner', body.surgeonId);
      if (!surgeon) throw NotFound(`Practitioner/${body.surgeonId}`);
      const created = store.create<TheatreList>('TheatreList', {
        date: body.date ?? todayIso(),
        theatre: body.theatre,
        site: body.site ?? GSTT_SITES[0],
        session: body.session,
        surgeon: ref('Practitioner', surgeon.id),
        surgeonName: fullName(surgeon),
        specialty: body.specialty ?? surgeon.specialty ?? 'General Surgery',
      });
      reply.code(201);
      return created;
    });

    // Book a patient onto a list.
    const CaseBody = z.object({
      listId: z.string().min(1),
      patientId: z.string().min(1),
      procedureText: z.string().min(1),
      procedureCode: z.string().optional(),
      priority: z.enum(CASE_PRIORITIES).default('elective'),
      order: z.number().int().positive().optional(),
      estimatedMinutes: z.number().int().positive().default(60),
    });
    app.post<{ Body: unknown }>('/cases', async (req, reply) => {
      const body = CaseBody.parse(req.body);
      const list = store.get<TheatreList>('TheatreList', body.listId);
      if (!list) throw NotFound(`TheatreList/${body.listId}`);
      const patient = store.get<Patient>('Patient', body.patientId);
      if (!patient) throw NotFound(`Patient/${body.patientId}`);
      const existing = casesForList(store, list.id);
      const order = body.order ?? existing.length + 1;
      const now = nowIso();
      const created = store.create<TheatreCase>('TheatreCase', {
        list: ref('TheatreList', list.id),
        patient: ref('Patient', patient.id),
        patientName: fullName(patient),
        procedureText: body.procedureText,
        procedureCode: body.procedureCode,
        order,
        status: 'scheduled',
        priority: body.priority,
        estimatedMinutes: body.estimatedMinutes,
        statusHistory: [{ status: 'scheduled', at: now }],
        updatedAt: now,
      });
      reply.code(201);
      return enrichCase(store, created);
    });

    // Advance a case along the perioperative pathway.
    const StatusBody = z.object({ status: z.enum(CASE_STATUSES).optional() });
    app.post<{ Params: { id: string }; Body: unknown }>('/cases/:id/status', async (req) => {
      const c = store.getOrThrow<TheatreCase>('TheatreCase', req.params.id);
      const body = StatusBody.parse(req.body ?? {});
      const expected = nextStatus(c.status);
      if (!expected) {
        throw BadRequest(`Case is already '${c.status}' and cannot be advanced further`);
      }
      const target = body.status ?? expected;
      if (target !== expected) {
        throw BadRequest(
          `Illegal transition '${c.status}' → '${target}'. The next valid status is '${expected}'.`,
        );
      }
      const now = nowIso();
      const updated = store.update<TheatreCase>('TheatreCase', c.id, {
        status: target,
        updatedAt: now,
        statusHistory: [...c.statusHistory, { status: target, at: now }],
      });
      return enrichCase(store, updated);
    });
  },

  seed({ store, rng }) {
    const patients = store.list<Patient>('Patient');
    const practitioners = store.list<Practitioner>('Practitioner');
    if (patients.length === 0 || practitioners.length === 0) return;

    const consultants = practitioners.filter((p) => p.role === 'Consultant');
    const surgeons = consultants.length > 0 ? consultants : practitioners;
    const date = todayIso();
    const available = [...patients];

    const listCount = randInt(3, 4, rng);
    for (let i = 0; i < listCount; i++) {
      const theatre = THEATRES[i % THEATRES.length] as (typeof THEATRES)[number];
      const surgeon = pick(surgeons, rng);
      const list = store.create<TheatreList>('TheatreList', {
        date,
        theatre: theatre.theatre,
        site: theatre.site,
        session: pick(SESSIONS, rng),
        surgeon: ref('Practitioner', surgeon.id),
        surgeonName: fullName(surgeon),
        specialty: theatre.specialty,
      });

      const specialtyProcedures = PROCEDURES.filter((p) => p.specialty === theatre.specialty);
      const procedurePool = specialtyProcedures.length > 0 ? specialtyProcedures : PROCEDURES;

      const caseCount = randInt(3, 5, rng);
      for (let j = 0; j < caseCount; j++) {
        const patient =
          available.length > 0
            ? (available.splice(Math.floor(rng() * available.length), 1)[0] as Patient)
            : pick(patients, rng);
        const proc = pick(procedurePool, rng);
        const status = statusForPosition(j, caseCount, rng);
        const now = nowIso();
        const history: CaseStatusEvent[] = CASE_STATUSES.slice(
          0,
          CASE_STATUSES.indexOf(status) + 1,
        ).map((s) => ({ status: s, at: now }));
        store.create<TheatreCase>('TheatreCase', {
          list: ref('TheatreList', list.id),
          patient: ref('Patient', patient.id),
          patientName: fullName(patient),
          procedureText: proc.text,
          procedureCode: proc.code,
          order: j + 1,
          status,
          priority: pick(CASE_PRIORITIES, rng),
          estimatedMinutes: proc.minutes,
          statusHistory: history,
          updatedAt: now,
        });
      }
    }
  },
});

/** Earlier cases on a list have progressed further through the day. */
function statusForPosition(index: number, total: number, rng: () => number): CaseStatus {
  const ratio = total <= 1 ? 0 : index / (total - 1);
  if (ratio < 0.25) return 'complete';
  if (ratio < 0.5) return rng() < 0.5 ? 'recovery' : 'in-theatre';
  if (ratio < 0.75) return rng() < 0.5 ? 'anaesthetic' : 'sent-for';
  return 'scheduled';
}

function countByStatus(cases: TheatreCase[]): Record<CaseStatus, number> {
  const counts = Object.fromEntries(CASE_STATUSES.map((s) => [s, 0])) as Record<CaseStatus, number>;
  for (const c of cases) counts[c.status] += 1;
  return counts;
}
