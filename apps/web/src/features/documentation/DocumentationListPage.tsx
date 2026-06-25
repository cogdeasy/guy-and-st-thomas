import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { parseRef } from '@trustos/core';
import { Badge, Card, CardBody, DataTable, PageHeader, Spinner, Stat } from '@trustos/ui';
import {
  NOTE_TYPES,
  NOTE_TYPE_LABELS,
  type ClinicalNote,
  type ClinicalNoteType,
  type RecentNotesResponse,
  formatWhen,
  noteTone,
} from './types';

export function DocumentationListPage() {
  const [filter, setFilter] = useState<ClinicalNoteType | 'all'>('all');
  const query = filter === 'all' ? '' : `?type=${filter}`;
  const { data, isLoading } = useApiQuery<RecentNotesResponse>(`/api/documentation/recent${query}`);

  const patientLink = (note: ClinicalNote) => `/documentation/${parseRef(note.patient)?.id ?? ''}`;

  return (
    <div>
      <PageHeader
        title="Clinical Documentation"
        description="Ward-round and admission notes captured across Guy's and St Thomas'."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Total notes" value={data?.total ?? '—'} tone="info" />
        {NOTE_TYPES.map((t) => (
          <Stat key={t} label={NOTE_TYPE_LABELS[t]} value={data?.counts?.[t] ?? '—'} />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-500">Filter:</span>
        <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        {NOTE_TYPES.map((t) => (
          <FilterChip
            key={t}
            label={NOTE_TYPE_LABELS[t]}
            active={filter === t}
            onClick={() => setFilter(t)}
          />
        ))}
      </div>

      <Card>
        <CardBody>
          {isLoading ? (
            <Spinner className="m-6" />
          ) : (
            <DataTable
              rows={data?.notes ?? []}
              rowKey={(r) => r.id}
              empty="No clinical notes recorded yet"
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <Link className="font-medium text-nhs-blue hover:underline" to={patientLink(r)}>
                      {r.patientName}
                    </Link>
                  ),
                },
                {
                  header: 'Type',
                  cell: (r) => <Badge tone={noteTone(r.type)}>{NOTE_TYPE_LABELS[r.type]}</Badge>,
                },
                {
                  header: 'Author',
                  cell: (r) => (
                    <span>
                      {r.authorName}
                      {r.authorRole ? <span className="text-slate-400"> · {r.authorRole}</span> : null}
                    </span>
                  ),
                },
                {
                  header: 'Excerpt',
                  cell: (r) => (
                    <span className="line-clamp-1 max-w-md text-slate-500">
                      {r.body.split('\n')[0]}
                    </span>
                  ),
                },
                { header: 'When', cell: (r) => <span className="text-slate-500">{formatWhen(r.createdAt)}</span> },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full bg-nhs-blue px-3 py-1 text-xs font-medium text-white'
          : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
      }
    >
      {label}
    </button>
  );
}
