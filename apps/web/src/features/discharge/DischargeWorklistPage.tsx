import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Card,
  CardBody,
  DataTable,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import {
  DISCHARGE_STATUSES,
  STATUS_LABELS,
  patientName,
  statusTone,
  type DischargeStatus,
  type WorklistItem,
  type WorklistResponse,
} from './types';
import { ChecklistProgress } from './components';

type Filter = 'all' | DischargeStatus;

export function DischargeWorklistPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const query = filter === 'all' ? '' : `?status=${filter}`;
  const { data, isLoading } = useApiQuery<WorklistResponse>(`/api/discharge/worklist${query}`);

  const filters: Filter[] = ['all', ...DISCHARGE_STATUSES];

  return (
    <div>
      <PageHeader
        title="Discharge & TTO"
        description="Plan discharges, reconcile to-take-out medicines and track readiness across the trust."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="In discharge pipeline" value={data?.total ?? 0} />
        <Stat
          label="Ready for discharge"
          value={data?.readyForDischarge ?? 0}
          tone="success"
          hint="All checklist items complete"
        />
        <Stat
          label="Pending pharmacy"
          value={data?.byStatus?.['pending-pharmacy'] ?? 0}
          tone="warning"
        />
        <Stat label="Completed" value={data?.byStatus?.completed ?? 0} tone="info" />
      </div>

      <Card>
        <CardBody>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-nhs-blue text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f === 'all' ? 'All' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>

          {isLoading ? (
            <Spinner className="m-10" />
          ) : (
            <DataTable<WorklistItem>
              rows={data?.items ?? []}
              rowKey={(r) => r.id}
              empty="No patients in the discharge pipeline"
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <Link className="font-medium text-nhs-blue hover:underline" to={`/discharge/${r.id}`}>
                      {patientName(r.patient)}
                    </Link>
                  ),
                },
                {
                  header: 'Specialty',
                  cell: (r) => r.encounter?.specialty ?? '—',
                },
                {
                  header: 'Diagnosis',
                  cell: (r) => (
                    <span className="text-slate-600">{r.diagnosis || <span className="text-slate-400">Not documented</span>}</span>
                  ),
                },
                {
                  header: 'TTOs',
                  cell: (r) => <span className="tabular-nums">{r.ttoCount}</span>,
                },
                {
                  header: 'GP letter',
                  cell: (r) =>
                    r.gpLetterGenerated ? (
                      <Badge tone="success">Generated</Badge>
                    ) : (
                      <Badge tone="neutral">Pending</Badge>
                    ),
                },
                {
                  header: 'Readiness',
                  cell: (r) => <ChecklistProgress checklist={r.checklist} />,
                },
                {
                  header: 'Status',
                  cell: (r) => <Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status]}</Badge>,
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
