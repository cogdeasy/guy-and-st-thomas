import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckSquare, Clock, Plus, UserPlus } from 'lucide-react';
import { useApiMutation, useApiQuery, useResourceList } from '@trustos/api-client';
import type { Patient, Practitioner } from '@trustos/ontology';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
  type BadgeTone,
} from '@trustos/ui';

type Priority = 'stat' | 'asap' | 'urgent' | 'routine';

interface EnrichedTask {
  id: string;
  code: string;
  label: string;
  description: string;
  status: string;
  priority: Priority;
  team: string;
  dueAt?: string;
  overdue: boolean;
  patient: { id: string; name: string; nhsNumber?: string } | null;
  owner: { id: string; name: string; role?: string } | null;
}

interface Worklist {
  total: number;
  open: number;
  overdue: number;
  unassigned: number;
  byPriority: Array<{ priority: Priority; tasks: EnrichedTask[] }>;
  byTeam: Array<{ team: string; open: number; overdue: number }>;
}

interface Metrics {
  totalOpen: number;
  totalOverdue: number;
  unassigned: number;
  completedToday: number;
  byTeam: Array<{ team: string; open: number; overdue: number }>;
}

interface JobType {
  code: string;
  label: string;
  priority: Priority;
}

interface Reference {
  teams: string[];
  jobTypes: JobType[];
}

const PRIORITY_LABEL: Record<Priority, string> = {
  stat: 'STAT',
  asap: 'ASAP',
  urgent: 'Urgent',
  routine: 'Routine',
};

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  stat: 'danger',
  asap: 'warning',
  urgent: 'info',
  routine: 'neutral',
};

const PRIORITY_ACCENT: Record<Priority, string> = {
  stat: 'border-t-nhs-red',
  asap: 'border-t-nhs-yellow',
  urgent: 'border-t-nhs-brightblue',
  routine: 'border-t-slate-300',
};

function formatDue(dueAt: string | undefined, overdue: boolean): string {
  if (!dueAt) return 'No due time';
  const diffMs = new Date(dueAt).getTime() - Date.now();
  const mins = Math.round(diffMs / 60000);
  const abs = Math.abs(mins);
  const rel = abs < 60 ? `${abs}m` : `${Math.round(abs / 60)}h`;
  return overdue ? `Overdue by ${rel}` : `Due in ${rel}`;
}

function patientLabel(p: Patient): string {
  const n = p.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim() || p.id;
}

function practitionerLabel(p: Practitioner): string {
  const n = p.name?.[0];
  const prefix = n?.prefix?.join(' ');
  return `${prefix ? prefix + ' ' : ''}${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim() || p.id;
}

export function TaskBoardPage() {
  const reference = useApiQuery<Reference>('/api/tasks/teams');
  const teams = reference.data?.teams ?? [];
  const jobTypes = reference.data?.jobTypes ?? [];

  const [teamFilter, setTeamFilter] = useState('');
  const [actingAs, setActingAs] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const worklistPath = `/api/tasks/worklist${teamFilter ? `?team=${encodeURIComponent(teamFilter)}` : ''}`;
  const worklist = useApiQuery<Worklist>(worklistPath);
  const metrics = useApiQuery<Metrics>('/api/tasks/metrics');
  const practitioners = useResourceList('Practitioner');

  const claim = useApiMutation<{ id: string; practitionerId: string }>(
    'POST',
    (b) => `/api/tasks/${b.id}/claim`,
  );
  const complete = useApiMutation<{ id: string }>('POST', (b) => `/api/tasks/${b.id}/complete`);

  const acting = useMemo(
    () => (practitioners.data ?? []).find((p) => p.id === actingAs),
    [practitioners.data, actingAs],
  );

  return (
    <div>
      <PageHeader
        title="Clinical Task Management"
        description="The electronic ward-jobs list — triage, claim and complete clinical tasks across teams."
        actions={
          <Button onClick={() => setShowCreate((s) => !s)}>
            <Plus className="h-4 w-4" /> New job
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open jobs" value={metrics.data?.totalOpen ?? '—'} hint="Across all teams" tone="info" />
        <Stat
          label="Overdue"
          value={metrics.data?.totalOverdue ?? '—'}
          hint="Past due time"
          tone="danger"
        />
        <Stat
          label="Unassigned"
          value={metrics.data?.unassigned ?? '—'}
          hint="Waiting to be claimed"
          tone="warning"
        />
        <Stat
          label="Completed today"
          value={metrics.data?.completedToday ?? '—'}
          hint="Last 24 hours"
          tone="success"
        />
      </div>

      {showCreate && (
        <CreateJobForm
          teams={teams}
          jobTypes={jobTypes}
          onClose={() => setShowCreate(false)}
        />
      )}

      <Card className="mb-6">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-500">Team</span>
            <FilterChip active={teamFilter === ''} onClick={() => setTeamFilter('')}>
              All
            </FilterChip>
            {teams.map((t) => (
              <FilterChip key={t} active={teamFilter === t} onClick={() => setTeamFilter(t)}>
                {t}
              </FilterChip>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Acting as
            <select
              value={actingAs}
              onChange={(e) => setActingAs(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-nhs-blue focus:outline-none"
            >
              <option value="">Select clinician…</option>
              {(practitioners.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {practitionerLabel(p)}
                  {p.role ? ` · ${p.role}` : ''}
                </option>
              ))}
            </select>
          </label>
        </CardBody>
      </Card>

      {worklist.isLoading ? (
        <Spinner className="m-10" />
      ) : (worklist.data?.open ?? 0) === 0 ? (
        <EmptyState title="No open jobs" description="Every ward job for this view is complete." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {(worklist.data?.byPriority ?? []).map((column) => (
            <div
              key={column.priority}
              className={`rounded-xl border border-t-4 border-slate-200 bg-slate-50/60 ${PRIORITY_ACCENT[column.priority]}`}
            >
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  {PRIORITY_LABEL[column.priority]}
                </span>
                <Badge tone={PRIORITY_TONE[column.priority]}>{column.tasks.length}</Badge>
              </div>
              <div className="space-y-3 px-3 pb-3">
                {column.tasks.length === 0 && (
                  <p className="px-1 pb-2 text-xs text-slate-400">No jobs</p>
                )}
                {column.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    actingAs={acting}
                    claiming={claim.isPending}
                    completing={complete.isPending}
                    onClaim={() =>
                      acting && claim.mutate({ id: task.id, practitionerId: acting.id })
                    }
                    onComplete={() => complete.mutate({ id: task.id })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Workload by team</CardTitle>
          </CardHeader>
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(metrics.data?.byTeam ?? []).map((t) => (
              <div key={t.team} className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-medium text-slate-500">{t.team}</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{t.open}</div>
                <div className="mt-0.5 text-xs">
                  {t.overdue > 0 ? (
                    <span className="font-medium text-nhs-red">{t.overdue} overdue</span>
                  ) : (
                    <span className="text-slate-400">on track</span>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  actingAs,
  claiming,
  completing,
  onClaim,
  onComplete,
}: {
  task: EnrichedTask;
  actingAs?: Practitioner;
  claiming: boolean;
  completing: boolean;
  onClaim: () => void;
  onComplete: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-slate-900">{task.label}</div>
        <Badge tone="neutral">{task.team}</Badge>
      </div>
      {task.patient && (
        <div className="mt-1 text-sm text-slate-600">
          {task.patient.name}
          {task.patient.nhsNumber && (
            <span className="text-slate-400"> · NHS {task.patient.nhsNumber}</span>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs">
        <span className={`inline-flex items-center gap-1 ${task.overdue ? 'font-medium text-nhs-red' : 'text-slate-500'}`}>
          {task.overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
          {formatDue(task.dueAt, task.overdue)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {task.owner ? (
            <span className="inline-flex items-center gap-1">
              <UserPlus className="h-3.5 w-3.5" /> {task.owner.name}
            </span>
          ) : (
            <span className="text-slate-400">Unassigned</span>
          )}
        </span>
        <div className="flex gap-2">
          {!task.owner && (
            <Button
              variant="secondary"
              className="px-2.5 py-1 text-xs"
              disabled={!actingAs || claiming}
              title={actingAs ? `Claim as ${practitionerLabel(actingAs)}` : 'Select a clinician above to claim'}
              onClick={onClaim}
            >
              Claim
            </Button>
          )}
          <Button
            className="px-2.5 py-1 text-xs"
            disabled={completing}
            onClick={onComplete}
          >
            <CheckSquare className="h-3.5 w-3.5" /> Complete
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateJobForm({
  teams,
  jobTypes,
  onClose,
}: {
  teams: string[];
  jobTypes: JobType[];
  onClose: () => void;
}) {
  const admitted = useApiQuery<{ items: Array<{ patient: Patient }> }>('/api/patients/worklist');
  const create = useApiMutation('POST', () => '/api/tasks/create');

  const [patientId, setPatientId] = useState('');
  const [code, setCode] = useState(jobTypes[0]?.code ?? '');
  const [team, setTeam] = useState(teams[0] ?? '');
  const [priority, setPriority] = useState<Priority>('routine');
  const [dueInHours, setDueInHours] = useState(4);

  const patients = (admitted.data?.items ?? []).map((i) => i.patient).filter(Boolean);
  const canSubmit = patientId && code && team && !create.isPending;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      { patientId, code, team, priority, dueInHours },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Card className="mb-6 border-nhs-blue/30">
      <CardHeader>
        <CardTitle>New ward job</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Patient (admitted)">
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              <option value="">Select patient…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientLabel(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Job type">
            <select
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                const jt = jobTypes.find((j) => j.code === e.target.value);
                if (jt) setPriority(jt.priority);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              {jobTypes.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Team">
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              {(['stat', 'asap', 'urgent', 'routine'] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due in (hours)">
            <input
              type="number"
              value={dueInHours}
              min={0}
              max={336}
              onChange={(e) => setDueInHours(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            />
          </Field>
        </div>
        {create.isError && (
          <p className="mt-3 text-sm text-nhs-red">Could not create job. Check the patient is selected.</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            Create job
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-nhs-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
