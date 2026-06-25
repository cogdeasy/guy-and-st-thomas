import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
} from '@trustos/ui';
import {
  PIPELINE,
  SPECIMEN_PRIORITIES,
  SPECIMEN_TYPES,
  STATUS_LABELS,
  TEST_CATALOGUE,
  formatHours,
  priorityTone,
  statusTone,
  type Metrics,
  type Specimen,
  type SpecimenPriority,
  type SpecimenStatus,
  type SpecimenType,
  type Worklist,
} from './types';

interface InpatientItem {
  patient: { id: string; name?: Array<{ given?: string[]; family?: string }> };
}

const LANE_ACCENT: Record<SpecimenStatus, string> = {
  collected: 'border-t-slate-400',
  'in-lab': 'border-t-nhs-blue',
  analysing: 'border-t-nhs-yellow',
  resulted: 'border-t-nhs-green',
  rejected: 'border-t-nhs-red',
};

export function LabWorklistPage() {
  const [statusFilter, setStatusFilter] = useState<SpecimenStatus | 'all'>('all');
  const worklist = useApiQuery<Worklist>('/api/pathology/worklist');
  const metrics = useApiQuery<Metrics>('/api/pathology/metrics');

  const items = worklist.data?.items ?? [];
  const filtered = useMemo(
    () => (statusFilter === 'all' ? items : items.filter((s) => s.status === statusFilter)),
    [items, statusFilter],
  );

  return (
    <div>
      <PageHeader
        title="Pathology / Laboratory"
        description="Specimen tracking, lab worklist and turnaround performance across GSTT."
      />

      {/* Turnaround & pending metrics */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Active specimens" value={metrics.data?.active ?? '—'} hint="Awaiting result" tone="info" />
        <Stat
          label="Urgent / STAT pending"
          value={metrics.data?.urgentPending ?? '—'}
          tone={metrics.data && metrics.data.urgentPending > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Median turnaround"
          value={formatHours(metrics.data?.turnaround.medianHours)}
          hint={`Avg ${formatHours(metrics.data?.turnaround.averageHours)}`}
          tone="success"
        />
        <Stat
          label="SLA breaches"
          value={metrics.data?.slaBreaches ?? '—'}
          tone={metrics.data && metrics.data.slaBreaches > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          label="Rejection rate"
          value={metrics.data ? `${Math.round(metrics.data.rejectionRate * 100)}%` : '—'}
          hint={`${metrics.data?.rejected ?? 0} rejected`}
          tone={metrics.data && metrics.data.rejectionRate > 0.1 ? 'danger' : 'neutral'}
        />
      </div>

      {/* Status pipeline */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {PIPELINE.map((status) => {
          const lane = worklist.data?.lanes.find((l) => l.status === status);
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter((cur) => (cur === status ? 'all' : status))}
              className={`rounded-xl border border-t-4 bg-white p-4 text-left shadow-sm transition-colors hover:bg-slate-50 ${
                LANE_ACCENT[status]
              } ${statusFilter === status ? 'ring-2 ring-nhs-blue/40' : 'border-slate-200'}`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {STATUS_LABELS[status]}
              </div>
              <div className="mt-1 text-3xl font-bold text-slate-900">{lane?.count ?? 0}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Worklist ({filtered.length})
            </h2>
            <div className="flex flex-wrap gap-1">
              <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                All
              </FilterChip>
              {(['collected', 'in-lab', 'analysing', 'resulted', 'rejected'] as SpecimenStatus[]).map((s) => (
                <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {STATUS_LABELS[s]}
                </FilterChip>
              ))}
            </div>
          </div>

          {worklist.isLoading ? (
            <Spinner className="m-10" />
          ) : (
            <DataTable
              rows={filtered}
              rowKey={(r) => r.id}
              empty="No specimens match this filter"
              columns={[
                {
                  header: 'Accession',
                  cell: (r) => (
                    <Link className="font-mono text-xs font-medium text-nhs-blue hover:underline" to={`/pathology/${r.id}`}>
                      {r.accession}
                    </Link>
                  ),
                },
                {
                  header: 'Patient',
                  cell: (r) => <span className="font-medium text-slate-800">{r.patientName}</span>,
                },
                {
                  header: 'Test',
                  cell: (r) => (
                    <div>
                      <div className="text-slate-800">{r.test}</div>
                      <div className="text-xs capitalize text-slate-400">{r.type}</div>
                    </div>
                  ),
                },
                {
                  header: 'Priority',
                  cell: (r) => (
                    <Badge tone={priorityTone(r.priority)} className="capitalize">
                      {r.priority}
                    </Badge>
                  ),
                },
                {
                  header: 'Status',
                  cell: (r) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status]}</Badge>,
                },
                {
                  header: 'Age / TAT',
                  cell: (r) =>
                    r.status === 'resulted' ? (
                      <span className="text-slate-600">{formatHours(r.turnaroundHours)} TAT</span>
                    ) : (
                      <span className={r.slaBreached ? 'font-medium text-nhs-red' : 'text-slate-600'}>
                        {formatHours(r.ageHours)}
                        {r.slaBreached ? ' ⚠' : ''}
                      </span>
                    ),
                },
              ]}
            />
          )}
        </div>

        <div className="lg:col-span-1">
          <CollectSpecimenCard
            onCollected={() => {
              worklist.refetch();
              metrics.refetch();
            }}
          />
        </div>
      </div>
    </div>
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
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-nhs-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function CollectSpecimenCard({ onCollected }: { onCollected: () => void }) {
  const inpatients = useApiQuery<{ items: InpatientItem[] }>('/api/patients/worklist');
  const [patientId, setPatientId] = useState('');
  const [type, setType] = useState<SpecimenType>('blood');
  const [test, setTest] = useState<string>(TEST_CATALOGUE.blood[0] ?? '');
  const [priority, setPriority] = useState<SpecimenPriority>('routine');

  const collect = useApiMutation<
    { patientId: string; type: SpecimenType; test: string; priority: SpecimenPriority },
    Specimen
  >('POST', () => '/api/pathology/collect');

  const patients = inpatients.data?.items ?? [];

  function patientName(p: InpatientItem): string {
    const n = p.patient.name?.[0];
    return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim() || p.patient.id;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!patientId) return;
    collect.mutate(
      { patientId, type, test, priority },
      {
        onSuccess: () => {
          setPatientId('');
          onCollected();
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Collect specimen</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Patient (admitted)">
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              <option value="">Select patient…</option>
              {patients.map((p) => (
                <option key={p.patient.id} value={p.patient.id}>
                  {patientName(p)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Specimen type">
            <select
              value={type}
              onChange={(e) => {
                const next = e.target.value as SpecimenType;
                setType(next);
                setTest(TEST_CATALOGUE[next][0] ?? '');
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize focus:border-nhs-blue focus:outline-none"
            >
              {SPECIMEN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Test">
            <select
              value={test}
              onChange={(e) => setTest(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              {TEST_CATALOGUE[type].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Priority">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as SpecimenPriority)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize focus:border-nhs-blue focus:outline-none"
            >
              {SPECIMEN_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Button type="submit" className="w-full" disabled={!patientId || collect.isPending}>
            {collect.isPending ? 'Collecting…' : 'Collect & send to lab'}
          </Button>
          {collect.isError && (
            <p className="text-xs text-nhs-red">{collect.error.message || 'Failed to collect specimen'}</p>
          )}
        </form>
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
