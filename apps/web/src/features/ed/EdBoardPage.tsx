import { useEffect, useMemo, useState } from 'react';
import { Siren, Timer, UserPlus } from 'lucide-react';
import { useApiMutation, useApiQuery, useResourceList } from '@trustos/api-client';
import type { Patient } from '@trustos/ontology';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import {
  acuityMeta,
  formatClock,
  statusLabel,
  statusTone,
  type EdStatus,
} from './acuity';

const FOUR_HOUR_MINUTES = 240;

interface BoardAttendance {
  id: string;
  patient: string;
  patientDisplay: string;
  chiefComplaint: string;
  acuity: number | null;
  status: EdStatus;
  cubicle?: string;
  arrivalTime: string;
  assignedClinicianName?: string;
}

interface BoardResponse {
  total: number;
  generatedAt: string;
  attendances: BoardAttendance[];
}

interface Metrics {
  totalInDepartment: number;
  totalAttendances: number;
  breaches: number;
  awaitingTriage: number;
  longestWaitMinutes: number;
  fourHourPerformance: number;
  byStatus: Record<EdStatus, number>;
}

const NEXT_STATUS: Partial<Record<EdStatus, EdStatus>> = {
  triaged: 'in-treatment',
  'in-treatment': 'awaiting-bed',
  'awaiting-bed': 'discharged',
};

export function EdBoardPage() {
  const board = useApiQuery<BoardResponse>('/api/ed/board', { refetchInterval: 15000 });
  const metrics = useApiQuery<Metrics>('/api/ed/metrics', { refetchInterval: 15000 });

  // Live clock so breach countdowns tick every second between refetches.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const triage = useApiMutation<{ id: string; acuity: number }>(
    'POST',
    (b) => `/api/ed/${b.id}/triage`,
  );
  const advance = useApiMutation<{ id: string; status: EdStatus }>(
    'POST',
    (b) => `/api/ed/${b.id}/status`,
  );

  const [showRegister, setShowRegister] = useState(false);

  return (
    <div>
      <PageHeader
        title="Emergency Department Tracker"
        description="Live A&E whiteboard — triage, patient flow and the 4-hour standard."
        actions={
          <Button onClick={() => setShowRegister((s) => !s)}>
            <UserPlus size={16} /> Register arrival
          </Button>
        }
      />

      <MetricsStrip metrics={metrics.data} loading={metrics.isLoading} />

      {showRegister && <RegisterArrival onDone={() => setShowRegister(false)} />}

      <Card className="mt-6">
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Siren size={18} className="text-nhs-red" />
            Department whiteboard
            {board.data && (
              <span className="text-sm font-normal text-slate-400">
                · {board.data.total} in department
              </span>
            )}
          </CardTitle>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <Timer size={14} /> Live · refreshed {board.data ? timeAgo(board.data.generatedAt, now) : '—'}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {board.isLoading ? (
            <div className="p-10">
              <Spinner />
            </div>
          ) : (board.data?.attendances.length ?? 0) === 0 ? (
            <div className="p-6">
              <EmptyState title="Department clear" description="No patients currently in the ED." />
            </div>
          ) : (
            <DataTable
              rows={board.data?.attendances ?? []}
              rowKey={(r) => r.id}
              columns={[
                {
                  header: 'Acuity',
                  cell: (r) => {
                    const m = acuityMeta(r.acuity);
                    return (
                      <span className="flex items-center gap-2">
                        <span className={`inline-block h-8 w-1.5 rounded-full ${m.bar}`} />
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${m.chip}`}>
                          {r.acuity ?? '—'}
                        </span>
                        <span className="hidden text-xs text-slate-500 lg:inline">{m.label}</span>
                      </span>
                    );
                  },
                },
                {
                  header: 'Patient',
                  cell: (r) => (
                    <div>
                      <div className="font-medium text-slate-800">{r.patientDisplay}</div>
                      <div className="text-xs text-slate-400">{r.chiefComplaint}</div>
                    </div>
                  ),
                },
                {
                  header: 'Status',
                  cell: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>,
                },
                { header: 'Cubicle', cell: (r) => r.cubicle ?? '—' },
                { header: 'Clinician', cell: (r) => r.assignedClinicianName ?? '—' },
                {
                  header: '4-hour clock',
                  cell: (r) => <BreachClock arrivalTime={r.arrivalTime} now={now} />,
                },
                {
                  header: '',
                  cell: (r) => (
                    <RowActions
                      attendance={r}
                      onTriage={(acuity) => triage.mutate({ id: r.id, acuity })}
                      onAdvance={(status) => advance.mutate({ id: r.id, status })}
                      busy={triage.isPending || advance.isPending}
                    />
                  ),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function MetricsStrip({ metrics, loading }: { metrics?: Metrics; loading: boolean }) {
  if (loading || !metrics) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const perfPct = Math.round(metrics.fourHourPerformance * 100);
  const perfTone = perfPct >= 95 ? 'success' : perfPct >= 76 ? 'warning' : 'danger';
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Stat label="In department" value={metrics.totalInDepartment} />
      <Stat label="Awaiting triage" value={metrics.awaitingTriage} tone={metrics.awaitingTriage > 0 ? 'warning' : 'neutral'} />
      <Stat
        label="4-hour performance"
        value={`${perfPct}%`}
        hint="Target 95%"
        tone={perfTone}
      />
      <Stat label="4-hour breaches" value={metrics.breaches} tone={metrics.breaches > 0 ? 'danger' : 'success'} />
      <Stat label="Longest wait" value={formatClock(metrics.longestWaitMinutes)} hint="hh:mm" />
    </div>
  );
}

function BreachClock({ arrivalTime, now }: { arrivalTime: string; now: number }) {
  const elapsedMin = Math.floor((now - Date.parse(arrivalTime)) / 60000);
  const remaining = FOUR_HOUR_MINUTES - elapsedMin;
  const breached = remaining < 0;
  const approaching = !breached && remaining <= 30;
  const tone = breached ? 'text-nhs-red' : approaching ? 'text-orange-600' : 'text-slate-700';
  const pct = Math.min(100, Math.max(0, (elapsedMin / FOUR_HOUR_MINUTES) * 100));
  const barColour = breached ? 'bg-nhs-red' : approaching ? 'bg-orange-500' : 'bg-nhs-green';
  return (
    <div className="min-w-[7rem]">
      <div className={`font-mono text-sm font-semibold ${tone}`}>{formatClock(remaining)}</div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColour}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">{elapsedMin}m in dept</div>
    </div>
  );
}

function RowActions({
  attendance,
  onTriage,
  onAdvance,
  busy,
}: {
  attendance: BoardAttendance;
  onTriage: (acuity: number) => void;
  onAdvance: (status: EdStatus) => void;
  busy: boolean;
}) {
  if (attendance.status === 'waiting' || attendance.acuity === null) {
    return (
      <div className="flex items-center gap-1">
        <span className="mr-1 text-xs text-slate-400">Triage</span>
        {[1, 2, 3, 4, 5].map((a) => {
          const m = acuityMeta(a);
          return (
            <button
              key={a}
              disabled={busy}
              onClick={() => onTriage(a)}
              className={`h-7 w-7 rounded text-xs font-semibold disabled:opacity-50 ${m.chip}`}
              title={`Acuity ${a} — ${m.label}`}
            >
              {a}
            </button>
          );
        })}
      </div>
    );
  }
  const next = NEXT_STATUS[attendance.status];
  if (!next) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => onAdvance(next)}>
        → {statusLabel(next)}
      </Button>
      {attendance.status !== 'awaiting-bed' && (
        <Button variant="ghost" disabled={busy} onClick={() => onAdvance('discharged')}>
          Discharge
        </Button>
      )}
    </div>
  );
}

function RegisterArrival({ onDone }: { onDone: () => void }) {
  const patients = useResourceList('Patient');
  const attend = useApiMutation<
    { patientId: string; chiefComplaint: string },
    { id: string }
  >('POST', () => '/api/ed/attend');

  const [patientId, setPatientId] = useState('');
  const [complaint, setComplaint] = useState('');

  const options = useMemo(
    () =>
      (patients.data ?? []).map((p: Patient) => ({
        id: p.id,
        name: `${p.name?.[0]?.given?.join(' ') ?? ''} ${p.name?.[0]?.family ?? ''}`.trim(),
      })),
    [patients.data],
  );

  const submit = () => {
    if (!patientId || !complaint.trim()) return;
    attend.mutate(
      { patientId, chiefComplaint: complaint.trim() },
      {
        onSuccess: () => {
          setPatientId('');
          setComplaint('');
          onDone();
        },
      },
    );
  };

  return (
    <Card className="mt-6 border-nhs-blue/30">
      <CardHeader>
        <CardTitle>Register a new arrival</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
          <select
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
          >
            <option value="">Select patient…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name || o.id}
              </option>
            ))}
          </select>
          <input
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="Presenting / chief complaint"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
          />
          <Button onClick={submit} disabled={attend.isPending || !patientId || !complaint.trim()}>
            {attend.isPending ? 'Registering…' : 'Register arrival'}
          </Button>
        </div>
        {attend.isError && (
          <p className="mt-2 text-sm text-nhs-red">Could not register arrival. Please try again.</p>
        )}
      </CardBody>
    </Card>
  );
}

function timeAgo(iso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}
