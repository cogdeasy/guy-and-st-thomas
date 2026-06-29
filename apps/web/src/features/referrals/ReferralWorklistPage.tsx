import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import {
  RTT_TARGET_WEEKS,
  breachTone,
  priorityLabel,
  priorityTone,
  statusTone,
  type Metrics,
  type RttView,
  type Worklist,
} from './types';
import { RttBar } from './RttBar';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'received', label: 'Received' },
  { value: 'triaged', label: 'Triaged' },
  { value: 'booked', label: 'Booked' },
  { value: 'treated', label: 'Treated' },
  { value: 'discharged', label: 'Discharged' },
];

const PRIORITY_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All priorities' },
  { value: 'routine', label: 'Routine' },
  { value: 'urgent', label: 'Urgent' },
  { value: '2ww', label: '2-week wait' },
];

export function ReferralWorklistPage() {
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (priority) qs.set('priority', priority);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  const worklist = useApiQuery<Worklist>(`/api/referrals/worklist${suffix}`);
  const metrics = useApiQuery<Metrics>('/api/referrals/metrics');

  const m = metrics.data;

  return (
    <div>
      <PageHeader
        title="Referrals & RTT (18-week)"
        description="Referral-To-Treatment worklist with elapsed-weeks tracking and breach risk against the 18-week standard."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open pathways" value={m?.openPathways ?? '—'} hint="On an active RTT clock" />
        <Stat
          label="Within 18 weeks"
          value={m ? `${m.performance}%` : '—'}
          hint="92% national standard"
          tone={!m ? 'neutral' : m.performance >= 92 ? 'success' : m.performance >= 85 ? 'warning' : 'danger'}
        />
        <Stat
          label="18-week breaches"
          value={m?.breaches ?? '—'}
          hint="Open pathways over target"
          tone={m && m.breaches > 0 ? 'danger' : 'success'}
        />
        <Stat
          label="2-week-wait"
          value={m?.twoWeekWait ?? '—'}
          hint={m ? `${m.twoWeekWaitBreaches} over 14 days` : undefined}
          tone={m && m.twoWeekWaitBreaches > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              RTT worklist ({worklist.data?.filtered ?? worklist.data?.total ?? 0})
            </h2>
            <div className="flex gap-2">
              <FilterSelect value={status} onChange={setStatus} options={STATUS_FILTERS} />
              <FilterSelect value={priority} onChange={setPriority} options={PRIORITY_FILTERS} />
            </div>
          </div>

          {worklist.isLoading ? (
            <Spinner className="m-10" />
          ) : (
            <DataTable<RttView>
              rows={worklist.data?.items ?? []}
              rowKey={(r) => r.id}
              empty="No referrals match these filters"
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <Link className="font-medium text-nhs-blue hover:underline" to={`/referrals/${r.id}`}>
                      {r.patient.display || r.patient.reference}
                    </Link>
                  ),
                },
                { header: 'Specialty', cell: (r) => r.toSpecialty },
                {
                  header: 'Priority',
                  cell: (r) => <Badge tone={priorityTone(r.priority)}>{priorityLabel(r.priority)}</Badge>,
                },
                {
                  header: 'Status',
                  cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
                },
                {
                  header: `RTT clock (wks / ${RTT_TARGET_WEEKS})`,
                  className: 'w-64',
                  cell: (r) => <RttBar view={r} />,
                },
                {
                  header: 'Breach',
                  cell: (r) =>
                    r.clockStopped ? (
                      <span className="text-xs text-slate-400">clock stopped</span>
                    ) : (
                      <Badge tone={breachTone(r.breachRisk)}>
                        {r.breached ? 'Breached' : `${r.daysToBreach}d left`}
                      </Badge>
                    ),
                },
              ]}
            />
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Performance by specialty</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {!m && <Spinner />}
            {m && m.bySpecialty.length === 0 && (
              <p className="text-sm text-slate-400">No open pathways.</p>
            )}
            {m?.bySpecialty.slice(0, 10).map((s) => {
              const pct = s.total ? Math.round(((s.total - s.breaches) / s.total) * 100) : 100;
              return (
                <div key={s.specialty}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{s.specialty}</span>
                    <span className="text-slate-500">
                      {s.total} open{s.breaches > 0 && <span className="text-nhs-red"> · {s.breaches} breach</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={pct >= 92 ? 'h-full bg-nhs-green' : pct >= 85 ? 'h-full bg-nhs-yellow' : 'h-full bg-nhs-red'}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-nhs-blue focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
