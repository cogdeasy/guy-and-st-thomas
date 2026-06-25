import { z } from 'zod';
import type { Encounter, Patient, Practitioner, Task } from '@trustos/ontology';
import { CodeSystems, RequestPriority } from '@trustos/ontology';
import {
  BadRequest,
  NotFound,
  isoHoursFromNow,
  nowIso,
  pick,
  randInt,
  ref,
} from '@trustos/core';
import { defineModule } from '../types';
import type { Entity } from '../../store/store';

/**
 * Clinical Task Management — the electronic ward-jobs list.
 *
 * Models day-to-day ward work (review a result, rewrite a drug chart, site a
 * cannula, write a discharge letter, …) on top of the core FHIR `Task`
 * resource. Core `Task` has no place to record the owning clinical team or the
 * claim/complete timestamps, so each Task is paired with a lightweight
 * `TaskAssignment` document in this module's own collection — the Task stays
 * the canonical clinical record while routing/audit metadata lives alongside.
 */

const TEAMS = [
  'General Medicine',
  'General Surgery',
  'Cardiology',
  'Respiratory',
  'Care of the Elderly',
  'Orthopaedics',
] as const;
type Team = (typeof TEAMS)[number];

interface JobType {
  code: string;
  label: string;
  priority: RequestPriority;
}

const JOB_TYPES: JobType[] = [
  { code: 'review-result', label: 'Review result', priority: 'urgent' },
  { code: 'rewrite-drug-chart', label: 'Rewrite drug chart', priority: 'routine' },
  { code: 'cannula', label: 'Site cannula', priority: 'urgent' },
  { code: 'discharge-letter', label: 'Discharge letter / TTO', priority: 'routine' },
  { code: 'venous-bloods', label: 'Take bloods', priority: 'routine' },
  { code: 'medication-review', label: 'Pharmacist medication review', priority: 'routine' },
  { code: 'review-unwell', label: 'Review unwell patient', priority: 'stat' },
  { code: 'request-imaging', label: 'Request imaging', priority: 'asap' },
  { code: 'consent-form', label: 'Complete consent form', priority: 'urgent' },
  { code: 'update-family', label: 'Update family', priority: 'routine' },
];

const OPEN_STATUSES: Task['status'][] = ['requested', 'received', 'accepted', 'in-progress'];
const PRIORITY_ORDER: RequestPriority[] = ['stat', 'asap', 'urgent', 'routine'];

/** Module-owned routing/audit record paired 1:1 with a core `Task`. */
interface TaskAssignment extends Entity {
  task: string;
  team: Team;
  claimedAt?: string;
  completedAt?: string;
}

const AssignmentSchema = z.object({
  id: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  task: z.string(),
  team: z.enum(TEAMS),
  claimedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

interface EnrichedTask {
  id: string;
  code: string;
  label: string;
  description: string;
  status: Task['status'];
  priority: RequestPriority;
  team: Team;
  dueAt?: string;
  overdue: boolean;
  authoredOn?: string;
  patient: { id: string; name: string; nhsNumber?: string } | null;
  owner: { id: string; name: string; role?: string } | null;
}

export default defineModule({
  id: 'tasks',
  name: 'Clinical Task Management',
  description: 'Electronic ward-jobs list: triage, claim and complete clinical tasks by team.',

  collections: [{ name: 'TaskAssignment', validator: (i) => AssignmentSchema.parse(i) as Entity }],

  routes(app, { store }) {
    const labelFor = (code: string) => JOB_TYPES.find((j) => j.code === code)?.label ?? code;

    const practitionerName = (p?: Practitioner): string => {
      const n = p?.name?.[0];
      if (!n) return 'Unknown';
      const prefix = n.prefix?.join(' ');
      return `${prefix ? prefix + ' ' : ''}${n.given?.join(' ') ?? ''} ${n.family ?? ''}`.trim();
    };
    const patientName = (p?: Patient): string => {
      const n = p?.name?.[0];
      return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim();
    };

    const assignmentFor = (taskId: string): TaskAssignment | undefined =>
      store.query<TaskAssignment>('TaskAssignment', (a) => a.task === ref('Task', taskId))[0];

    const enrich = (task: Task): EnrichedTask => {
      const assignment = assignmentFor(task.id);
      const dueAt = task.executionPeriod?.end;
      const open = OPEN_STATUSES.includes(task.status);
      const patientId = task.for?.reference?.split('/')[1];
      const patient = patientId ? store.get<Patient>('Patient', patientId) : undefined;
      const ownerId = task.owner?.reference?.startsWith('Practitioner/')
        ? task.owner.reference.split('/')[1]
        : undefined;
      const owner = ownerId ? store.get<Practitioner>('Practitioner', ownerId) : undefined;
      return {
        id: task.id,
        code: task.code,
        label: labelFor(task.code),
        description: task.description,
        status: task.status,
        priority: task.priority,
        team: assignment?.team ?? 'General Medicine',
        dueAt,
        overdue: open && dueAt !== undefined && dueAt < nowIso(),
        authoredOn: task.authoredOn,
        patient: patient
          ? {
              id: patient.id,
              name: patientName(patient),
              nhsNumber: patient.identifier?.find((idf) => idf.system === CodeSystems.NHS_NUMBER)?.value,
            }
          : null,
        owner: owner ? { id: owner.id, name: practitionerName(owner), role: owner.role } : null,
      };
    };

    const getTaskOrThrow = (id: string): Task => {
      const task = store.get<Task>('Task', id);
      if (!task) throw NotFound(`Task/${id}`);
      return task;
    };

    // Reference data for the worklist filters and the create form.
    app.get('/teams', async () => ({ teams: TEAMS, jobTypes: JOB_TYPES }));

    // Ward-jobs board: open tasks grouped by priority and by team, with patient
    // context. Optional ?team= and ?owner= (practitioner id) filters.
    app.get<{ Querystring: { team?: string; owner?: string; includeDone?: string } }>(
      '/worklist',
      async (req) => {
        const { team, owner, includeDone } = req.query;
        let tasks = store.list<Task>('Task').map(enrich);
        if (!includeDone) tasks = tasks.filter((t) => OPEN_STATUSES.includes(t.status));
        if (team) tasks = tasks.filter((t) => t.team === team);
        if (owner) tasks = tasks.filter((t) => t.owner?.id === owner);
        tasks.sort(
          (a, b) =>
            PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
            (a.dueAt ?? '').localeCompare(b.dueAt ?? ''),
        );

        const byPriority = PRIORITY_ORDER.map((priority) => ({
          priority,
          tasks: tasks.filter((t) => t.priority === priority),
        }));
        const byTeam = TEAMS.map((t) => {
          const teamTasks = tasks.filter((x) => x.team === t);
          return {
            team: t,
            open: teamTasks.filter((x) => OPEN_STATUSES.includes(x.status)).length,
            overdue: teamTasks.filter((x) => x.overdue).length,
          };
        });

        return {
          total: tasks.length,
          open: tasks.filter((t) => OPEN_STATUSES.includes(t.status)).length,
          overdue: tasks.filter((t) => t.overdue).length,
          unassigned: tasks.filter((t) => OPEN_STATUSES.includes(t.status) && !t.owner).length,
          byPriority,
          byTeam,
        };
      },
    );

    // Open / overdue workload broken down by team and priority.
    app.get('/metrics', async () => {
      const tasks = store.list<Task>('Task').map(enrich);
      const open = tasks.filter((t) => OPEN_STATUSES.includes(t.status));
      const since = isoHoursFromNow(-24);
      const completedToday = store.query<TaskAssignment>(
        'TaskAssignment',
        (a) => a.completedAt !== undefined && a.completedAt >= since,
      ).length;

      return {
        totalOpen: open.length,
        totalOverdue: open.filter((t) => t.overdue).length,
        unassigned: open.filter((t) => !t.owner).length,
        completedToday,
        byTeam: TEAMS.map((team) => {
          const teamOpen = open.filter((t) => t.team === team);
          return {
            team,
            open: teamOpen.length,
            overdue: teamOpen.filter((t) => t.overdue).length,
          };
        }),
        byPriority: PRIORITY_ORDER.map((priority) => ({
          priority,
          open: open.filter((t) => t.priority === priority).length,
        })),
      };
    });

    // Single enriched task.
    app.get<{ Params: { id: string } }>('/:id', async (req) => enrich(getTaskOrThrow(req.params.id)));

    // Create a new ward job against an admitted patient.
    const CreateBody = z.object({
      patientId: z.string().min(1),
      code: z.string().min(1),
      description: z.string().min(1).optional(),
      priority: RequestPriority.optional(),
      team: z.enum(TEAMS),
      dueInHours: z.number().int().min(-72).max(336).default(4),
      ownerId: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/create', async (req, reply) => {
      const body = CreateBody.parse(req.body);
      const patient = store.get<Patient>('Patient', body.patientId);
      if (!patient) throw NotFound(`Patient/${body.patientId}`);
      const jobType = JOB_TYPES.find((j) => j.code === body.code);
      if (body.ownerId && !store.get<Practitioner>('Practitioner', body.ownerId)) {
        throw NotFound(`Practitioner/${body.ownerId}`);
      }

      const now = nowIso();
      const task = store.create<Task>('Task', {
        status: body.ownerId ? 'accepted' : 'requested',
        priority: body.priority ?? jobType?.priority ?? 'routine',
        intent: 'order',
        code: body.code,
        description: body.description ?? jobType?.label ?? body.code,
        for: { reference: ref('Patient', patient.id), display: patientName(patient) },
        owner: body.ownerId ? { reference: ref('Practitioner', body.ownerId) } : undefined,
        authoredOn: now,
        executionPeriod: { start: now, end: isoHoursFromNow(body.dueInHours) },
      });
      store.create<TaskAssignment>('TaskAssignment', {
        task: ref('Task', task.id),
        team: body.team,
        claimedAt: body.ownerId ? now : undefined,
      });

      reply.code(201);
      return enrich(task);
    });

    // Claim an open task — assign it to a named practitioner.
    const ClaimBody = z.object({ practitionerId: z.string().min(1) });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/claim', async (req) => {
      const body = ClaimBody.parse(req.body);
      const task = getTaskOrThrow(req.params.id);
      if (!OPEN_STATUSES.includes(task.status)) {
        throw BadRequest(`Task ${task.id} is ${task.status} and cannot be claimed`);
      }
      const practitioner = store.get<Practitioner>('Practitioner', body.practitionerId);
      if (!practitioner) throw NotFound(`Practitioner/${body.practitionerId}`);

      const updated = store.update<Task>('Task', task.id, {
        status: 'in-progress',
        owner: { reference: ref('Practitioner', practitioner.id), display: practitionerName(practitioner) },
      });
      const assignment = assignmentFor(task.id);
      if (assignment) store.update('TaskAssignment', assignment.id, { claimedAt: nowIso() });
      return enrich(updated);
    });

    // Complete a task.
    app.post<{ Params: { id: string } }>('/:id/complete', async (req) => {
      const task = getTaskOrThrow(req.params.id);
      if (task.status === 'completed') throw BadRequest(`Task ${task.id} is already completed`);
      if (task.status === 'cancelled') throw BadRequest(`Task ${task.id} is cancelled`);

      const updated = store.update<Task>('Task', task.id, { status: 'completed' });
      const assignment = assignmentFor(task.id);
      if (assignment) store.update('TaskAssignment', assignment.id, { completedAt: nowIso() });
      return enrich(updated);
    });
  },

  seed({ store, rng }) {
    // Attach jobs to currently-admitted patients (active inpatient encounters).
    const admittedEncounters = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );
    if (admittedEncounters.length === 0) return;

    const practitioners = store.list<Practitioner>('Practitioner');

    for (let i = 0; i < 20; i++) {
      const encounter = pick(admittedEncounters, rng);
      const patientId = encounter.subject.reference.split('/')[1];
      const patient = patientId ? store.get<Patient>('Patient', patientId) : undefined;
      if (!patient) continue;

      const jobType = pick(JOB_TYPES, rng);
      const team = pick(TEAMS, rng);
      const dueInHours = randInt(-6, 24, rng); // some already overdue, some upcoming
      const authoredOn = isoHoursFromNow(-randInt(1, 18, rng));

      // ~35% of jobs are already claimed and in progress; the rest sit open.
      const claimed = rng() < 0.35;
      const owner = claimed ? pick(practitioners, rng) : undefined;

      const fullName = `${patient.name?.[0]?.given?.join(' ') ?? ''} ${patient.name?.[0]?.family ?? ''}`.trim();
      const task = store.create<Task>('Task', {
        status: claimed ? 'in-progress' : 'requested',
        priority: jobType.priority,
        intent: 'order',
        code: jobType.code,
        description: `${jobType.label} — ${encounter.reasonText ?? 'inpatient'}`,
        for: { reference: ref('Patient', patient.id), display: fullName },
        owner: owner ? { reference: ref('Practitioner', owner.id) } : undefined,
        authoredOn,
        executionPeriod: { start: authoredOn, end: isoHoursFromNow(dueInHours) },
      });
      store.create<TaskAssignment>('TaskAssignment', {
        task: ref('Task', task.id),
        team,
        claimedAt: claimed ? authoredOn : undefined,
      });
    }
  },
});
