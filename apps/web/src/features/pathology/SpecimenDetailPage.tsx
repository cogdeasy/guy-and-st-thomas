import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Spinner } from '@trustos/ui';
import {
  NEXT_STATUS,
  STATUS_LABELS,
  formatHours,
  priorityTone,
  statusTone,
  type Specimen,
  type SpecimenStatus,
} from './types';

export function SpecimenDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, refetch } = useApiQuery<Specimen>(id ? `/api/pathology/${id}` : null);
  const [rejectNote, setRejectNote] = useState('');

  const transition = useApiMutation<{ status: SpecimenStatus; note?: string }, Specimen>(
    'POST',
    () => `/api/pathology/${id}/status`,
  );

  if (isLoading || !data) return <Spinner className="m-10" />;

  const patientId = data.subject.reference.split('/')[1];
  const next = NEXT_STATUS[data.status];

  function advance(status: SpecimenStatus) {
    const note = status === 'rejected' ? rejectNote.trim() : undefined;
    if (status === 'rejected' && !note) return;
    transition.mutate({ status, note }, { onSuccess: () => refetch() });
  }

  return (
    <div>
      <Link to="/pathology" className="text-sm text-nhs-blue hover:underline">
        ← Back to Pathology worklist
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs text-sky-200">{data.accession}</div>
            <h1 className="text-2xl font-bold">{data.test}</h1>
            <div className="mt-1 text-sm text-sky-200">
              <Link to={`/patients/${patientId}`} className="underline-offset-2 hover:underline">
                {data.patientName}
              </Link>{' '}
              · <span className="capitalize">{data.type}</span> specimen
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={priorityTone(data.priority)} className="capitalize">
              {data.priority}
            </Badge>
            <Badge tone={statusTone(data.status)} className="text-base">
              {STATUS_LABELS[data.status]}
            </Badge>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Specimen detail</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Collected" value={new Date(data.collectedAt).toLocaleString('en-GB')} />
            <Row label="Received in lab" value={data.receivedAt ? new Date(data.receivedAt).toLocaleString('en-GB') : '—'} />
            <Row label="Resulted" value={data.resultedAt ? new Date(data.resultedAt).toLocaleString('en-GB') : '—'} />
            <Row
              label={data.status === 'resulted' ? 'Turnaround' : 'Age'}
              value={data.status === 'resulted' ? formatHours(data.turnaroundHours) : formatHours(data.ageHours)}
            />
            <Row label="SLA target" value={formatHours(data.slaHours)} />
            {data.slaBreached && (
              <p className="rounded-lg bg-red-50 p-2 text-xs font-medium text-nhs-red">⚠ SLA breached — overdue result</p>
            )}
            {data.rejectionReason && (
              <p className="rounded-lg bg-red-50 p-2 text-xs text-nhs-red">Rejected: {data.rejectionReason}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-3">
              {data.statusHistory.map((ev, i) => (
                <li key={`${ev.status}-${i}`} className="flex gap-3">
                  <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-nhs-blue" />
                  <div>
                    <div className="text-sm font-medium text-slate-800">{STATUS_LABELS[ev.status]}</div>
                    <div className="text-xs text-slate-400">{new Date(ev.at).toLocaleString('en-GB')}</div>
                    {ev.note && <div className="text-xs text-slate-500">{ev.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Advance specimen</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {next.length === 0 ? (
              <p className="text-sm text-slate-400">This specimen is in a terminal state.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {next
                    .filter((s) => s !== 'rejected')
                    .map((s) => (
                      <Button key={s} onClick={() => advance(s)} disabled={transition.isPending}>
                        Move to {STATUS_LABELS[s]}
                      </Button>
                    ))}
                </div>
                {next.includes('rejected') && (
                  <div className="border-t border-slate-100 pt-3">
                    <label className="mb-1 block text-xs font-medium text-slate-500">Reject specimen</label>
                    <input
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Reason (required)"
                      className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-red focus:outline-none"
                    />
                    <Button
                      variant="danger"
                      className="w-full"
                      disabled={!rejectNote.trim() || transition.isPending}
                      onClick={() => advance('rejected')}
                    >
                      Reject specimen
                    </Button>
                  </div>
                )}
              </>
            )}
            {transition.isError && (
              <p className="text-xs text-nhs-red">{transition.error.message || 'Transition failed'}</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}
