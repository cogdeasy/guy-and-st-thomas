import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { Badge, Card, CardBody, DataTable, PageHeader, Spinner, Stat, type BadgeTone } from '@trustos/ui';
import {
  MODALITIES,
  MODALITY_LABELS,
  STATUSES,
  type ImagingRequest,
  type ImagingStatus,
  type Metrics,
  type Modality,
  type Priority,
  type Worklist,
} from './types';

const STATUS_TONE: Record<ImagingStatus, BadgeTone> = {
  requested: 'neutral',
  scheduled: 'info',
  acquired: 'warning',
  reported: 'success',
};

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  routine: 'neutral',
  urgent: 'warning',
  stat: 'danger',
};

export function RadiologyWorklistPage() {
  const [modality, setModality] = useState<Modality | ''>('');
  const [status, setStatus] = useState<ImagingStatus | ''>('');

  const query = new URLSearchParams();
  if (modality) query.set('modality', modality);
  if (status) query.set('status', status);
  const qs = query.toString();

  const worklist = useApiQuery<Worklist>(`/api/radiology/worklist${qs ? `?${qs}` : ''}`);
  const metrics = useApiQuery<Metrics>('/api/radiology/metrics');

  return (
    <div>
      <PageHeader
        title="Imaging / Radiology"
        description="Live radiology request worklist and reporting across all modalities."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open requests" value={metrics.data?.open ?? '—'} hint="Not yet reported" />
        <Stat
          label="Awaiting report"
          value={metrics.data?.awaitingReport ?? '—'}
          tone={(metrics.data?.awaitingReport ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Urgent / STAT outstanding"
          value={metrics.data?.urgentOutstanding ?? '—'}
          tone={(metrics.data?.urgentOutstanding ?? 0) > 0 ? 'danger' : 'success'}
        />
        <Stat
          label="Avg turnaround"
          value={metrics.data?.avgTurnaroundHours != null ? `${metrics.data.avgTurnaroundHours}h` : '—'}
          hint="Request to report"
          tone="info"
        />
      </div>

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Modality</span>
          <FilterChip label="All" active={modality === ''} onClick={() => setModality('')} />
          {MODALITIES.map((m) => (
            <FilterChip
              key={m}
              label={MODALITY_LABELS[m]}
              active={modality === m}
              onClick={() => setModality(m)}
            />
          ))}
          <span className="ml-4 mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</span>
          <FilterChip label="All" active={status === ''} onClick={() => setStatus('')} />
          {STATUSES.map((s) => (
            <FilterChip key={s} label={s} active={status === s} onClick={() => setStatus(s)} />
          ))}
        </CardBody>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Worklist ({worklist.data?.total ?? 0})
      </h2>

      {worklist.isLoading ? (
        <Spinner className="m-10" />
      ) : (
        <DataTable
          rows={worklist.data?.items ?? []}
          rowKey={(r) => r.id}
          empty="No imaging requests match these filters"
          columns={[
            {
              header: 'Patient',
              cell: (r: ImagingRequest) => (
                <Link className="font-medium text-nhs-blue hover:underline" to={`/radiology/${r.id}`}>
                  {r.patientSummary?.name ?? r.patient.display ?? 'Unknown'}
                </Link>
              ),
            },
            {
              header: 'Study',
              cell: (r) => (
                <span>
                  <Badge tone="info">{MODALITY_LABELS[r.modality]}</Badge>{' '}
                  <span className="text-slate-700">{r.bodyPart}</span>
                </span>
              ),
            },
            { header: 'Indication', cell: (r) => <span className="text-slate-600">{r.clinicalIndication}</span> },
            {
              header: 'Priority',
              cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge>,
            },
            {
              header: 'Status',
              cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>,
            },
            {
              header: 'Requested',
              cell: (r) => <span className="text-slate-500">{r.requestedAt.slice(0, 10)}</span>,
            },
          ]}
        />
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
        active
          ? 'border-nhs-blue bg-nhs-blue text-white'
          : 'border-slate-300 bg-white text-slate-600 hover:border-nhs-blue hover:text-nhs-blue',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
