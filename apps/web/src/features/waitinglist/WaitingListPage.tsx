import { useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  PageHeader,
  Spinner,
  Stat,
  type BadgeTone,
} from '@trustos/ui';

interface PtlEntry {
  id: string;
  patient: string;
  patientDisplay?: string;
  specialty: string;
  procedure: string;
  priority: 'routine' | 'urgent';
  listedDate: string;
  targetDate: string;
  status: 'waiting' | 'tci' | 'admitted' | 'removed';
  tciDate?: string;
  weeksWaiting: number;
  weeksToTarget: number;
  breached: boolean;
  targetWeeks: number;
}

interface PtlResponse {
  total: number;
  breaches: number;
  items: PtlEntry[];
}

interface Metrics {
  totalWaiting: number;
  totalBreaches: number;
  awaitingTci: number;
  scheduledTci: number;
  longestWaitWeeks: number;
  bySpecialty: Array<{ specialty: string; total: number; breaches: number; longestWeeks: number }>;
}

const statusTone: Record<PtlEntry['status'], BadgeTone> = {
  waiting: 'info',
  tci: 'success',
  admitted: 'neutral',
  removed: 'neutral',
};

const statusLabel: Record<PtlEntry['status'], string> = {
  waiting: 'Waiting',
  tci: 'TCI booked',
  admitted: 'Admitted',
  removed: 'Removed',
};

export function WaitingListPage() {
  const [specialty, setSpecialty] = useState('');
  const [tciFor, setTciFor] = useState<PtlEntry | null>(null);

  const query = specialty ? `?specialty=${encodeURIComponent(specialty)}` : '';
  const ptl = useApiQuery<PtlResponse>(`/api/waitinglist/ptl${query}`);
  const metrics = useApiQuery<Metrics>('/api/waitinglist/metrics');

  const remove = useApiMutation<{ id: string; reason: string }>(
    'POST',
    (body) => `/api/waitinglist/${body.id}/remove`,
  );

  const specialties = useMemo(
    () => (metrics.data?.bySpecialty ?? []).map((s) => s.specialty),
    [metrics.data],
  );

  const items = ptl.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Elective Waiting List (PTL)"
        description="Patient Tracking List for elective surgery against the NHS 18-week RTT standard."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Patients waiting" value={metrics.data?.totalWaiting ?? '—'} />
        <Stat
          label="RTT breaches"
          value={metrics.data?.totalBreaches ?? '—'}
          tone={metrics.data && metrics.data.totalBreaches > 0 ? 'danger' : 'success'}
          hint="Past target (18w routine / 4w urgent)"
        />
        <Stat label="TCI booked" value={metrics.data?.scheduledTci ?? '—'} tone="info" hint="To-Come-In date set" />
        <Stat
          label="Longest wait"
          value={metrics.data ? `${metrics.data.longestWaitWeeks}w` : '—'}
          tone={metrics.data && metrics.data.totalBreaches > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Breaches by specialty</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {metrics.isLoading && <Spinner />}
            {(metrics.data?.bySpecialty ?? []).map((s) => (
              <div key={s.specialty} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{s.specialty}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{s.total} waiting</span>
                  <Badge tone={s.breaches > 0 ? 'danger' : 'success'}>{s.breaches} breach</Badge>
                </span>
              </div>
            ))}
            {metrics.data && metrics.data.bySpecialty.length === 0 && (
              <p className="text-sm text-slate-400">No patients currently waiting.</p>
            )}
          </CardBody>
        </Card>

        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Tracking list ({ptl.data?.total ?? 0})
            </h2>
            <select
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-nhs-blue focus:outline-none"
            >
              <option value="">All specialties</option>
              {specialties.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {ptl.isLoading ? (
            <Spinner className="m-6" />
          ) : (
            <DataTable
              rows={items}
              rowKey={(r) => r.id}
              empty="No patients on the waiting list"
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <div>
                      <div className="font-medium text-slate-800">{r.patientDisplay ?? r.patient}</div>
                      <div className="text-xs text-slate-400">{r.procedure}</div>
                    </div>
                  ),
                },
                { header: 'Specialty', cell: (r) => r.specialty },
                {
                  header: 'Priority',
                  cell: (r) => (
                    <Badge tone={r.priority === 'urgent' ? 'warning' : 'neutral'}>{r.priority}</Badge>
                  ),
                },
                {
                  header: 'Wait',
                  className: 'w-48',
                  cell: (r) => <WaitBar entry={r} />,
                },
                {
                  header: 'Status',
                  cell: (r) => <Badge tone={statusTone[r.status]}>{statusLabel[r.status]}</Badge>,
                },
                {
                  header: '',
                  cell: (r) => (
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setTciFor(r)}>
                        {r.status === 'tci' ? 'Re-book TCI' : 'Schedule TCI'}
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-3 py-1 text-xs text-red-600 hover:bg-red-50"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ id: r.id, reason: 'Treated / admitted' })}
                      >
                        Remove
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>

      {tciFor && <TciDialog entry={tciFor} onClose={() => setTciFor(null)} />}
    </div>
  );
}

/** Horizontal wait bar coloured against the RTT target. */
function WaitBar({ entry }: { entry: PtlEntry }) {
  const scale = Math.max(entry.targetWeeks, entry.weeksWaiting, 1);
  const pct = Math.min(100, Math.round((entry.weeksWaiting / scale) * 100));
  const color = entry.breached
    ? 'bg-nhs-red'
    : entry.weeksWaiting >= entry.targetWeeks * 0.8
      ? 'bg-nhs-yellow'
      : 'bg-nhs-green';
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700">{entry.weeksWaiting}w</span>
        {entry.breached ? (
          <span className="font-semibold text-nhs-red">breach</span>
        ) : (
          <span className="text-slate-400">{entry.weeksToTarget}w to target</span>
        )}
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TciDialog({ entry, onClose }: { entry: PtlEntry; onClose: () => void }) {
  const [tciDate, setTciDate] = useState(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const tci = useApiMutation<{ id: string; tciDate: string }>(
    'POST',
    (body) => `/api/waitinglist/${body.id}/tci`,
  );

  const submit = () => {
    tci.mutate(
      { id: entry.id, tciDate: new Date(tciDate).toISOString() },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>Schedule To-Come-In (TCI)</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="text-sm text-slate-600">
            <div className="font-medium text-slate-800">{entry.patientDisplay ?? entry.patient}</div>
            <div className="text-xs text-slate-400">
              {entry.specialty} · {entry.procedure}
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Admission date</span>
            <input
              type="date"
              value={tciDate}
              onChange={(e) => setTciDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            />
          </label>
          {tci.isError && <p className="text-sm text-nhs-red">Could not schedule. Please try again.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={tci.isPending}>
              {tci.isPending ? 'Saving…' : 'Confirm TCI'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
