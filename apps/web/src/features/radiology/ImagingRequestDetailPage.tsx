import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  Spinner,
  type BadgeTone,
} from '@trustos/ui';
import { MODALITY_LABELS, type ImagingRequest, type ImagingStatus, type Priority } from './types';

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

export function ImagingRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<ImagingRequest>(id ? `/api/radiology/${id}` : null);

  const schedule = useApiMutation<{ scheduledFor: string }>('POST', () => `/api/radiology/${id}/schedule`);
  const acquire = useApiMutation<Record<string, never>>('POST', () => `/api/radiology/${id}/acquire`);
  const report = useApiMutation<{ findings: string; impression: string }>(
    'POST',
    () => `/api/radiology/${id}/report`,
  );

  const [scheduledFor, setScheduledFor] = useState('');
  const [findings, setFindings] = useState('');
  const [impression, setImpression] = useState('');

  if (isLoading || !data) return <Spinner className="m-10" />;

  const canSchedule = data.status === 'requested';
  const canAcquire = data.status === 'scheduled';
  const canReport = data.status === 'scheduled' || data.status === 'acquired';

  return (
    <div>
      <Link to="/radiology" className="text-sm text-nhs-blue hover:underline">
        ← Back to Imaging / Radiology
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {MODALITY_LABELS[data.modality]} — {data.bodyPart}
            </h1>
            <div className="mt-1 text-sm text-sky-200">
              {data.patientSummary?.name ?? data.patient.display ?? 'Unknown patient'}
              {data.patientSummary?.nhsNumber ? ` · NHS ${data.patientSummary.nhsNumber}` : ''}
              {data.patientSummary?.birthDate ? ` · DOB ${data.patientSummary.birthDate}` : ''}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={STATUS_TONE[data.status]} className="text-base">
              {data.status}
            </Badge>
            <Badge tone={PRIORITY_TONE[data.priority]}>{data.priority}</Badge>
          </div>
        </div>
      </div>

      <PageHeader title="" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Request details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Modality" value={MODALITY_LABELS[data.modality]} />
            <Row label="Body part" value={data.bodyPart} />
            <Row label="Indication" value={data.clinicalIndication} />
            <Row label="Priority" value={data.priority} />
            <Row label="Requested by" value={data.requestedBy?.display ?? '—'} />
            <Row label="Requested" value={data.requestedAt.slice(0, 16).replace('T', ' ')} />
            <Row label="Scheduled for" value={fmt(data.scheduledFor)} />
            <Row label="Acquired" value={fmt(data.acquiredAt)} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4 text-sm">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Schedule acquisition
              </label>
              <input
                type="datetime-local"
                value={scheduledFor}
                disabled={!canSchedule}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none disabled:bg-slate-50"
              />
              <Button
                variant="secondary"
                className="mt-2"
                disabled={!canSchedule || !scheduledFor || schedule.isPending}
                onClick={() => schedule.mutate({ scheduledFor: new Date(scheduledFor).toISOString() })}
              >
                {schedule.isPending ? 'Scheduling…' : 'Schedule'}
              </Button>
              {!canSchedule && data.status !== 'reported' && (
                <p className="mt-1 text-xs text-slate-400">Already scheduled.</p>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Acquisition
              </label>
              <Button
                variant="secondary"
                disabled={!canAcquire || acquire.isPending}
                onClick={() => acquire.mutate({})}
              >
                {acquire.isPending ? 'Recording…' : 'Mark images acquired'}
              </Button>
              {data.status === 'acquired' && (
                <p className="mt-1 text-xs text-slate-400">Images acquired — awaiting report.</p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Radiology report</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            {data.report ? (
              <div className="space-y-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Findings</div>
                  <p className="text-slate-700">{data.report.findings}</p>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Impression</div>
                  <p className="font-medium text-slate-800">{data.report.impression}</p>
                </div>
                <p className="text-xs text-slate-400">
                  Reported {fmt(data.report.reportedAt)}
                  {data.report.radiologist?.display ? ` by ${data.report.radiologist.display}` : ''}
                </p>
              </div>
            ) : (
              <>
                <textarea
                  value={findings}
                  disabled={!canReport}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder="Findings"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none disabled:bg-slate-50"
                />
                <textarea
                  value={impression}
                  disabled={!canReport}
                  onChange={(e) => setImpression(e.target.value)}
                  placeholder="Impression"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none disabled:bg-slate-50"
                />
                <Button
                  disabled={!canReport || !findings || !impression || report.isPending}
                  onClick={() => report.mutate({ findings, impression })}
                >
                  {report.isPending ? 'Saving…' : 'Sign off report'}
                </Button>
                {!canReport && (
                  <p className="text-xs text-slate-400">Acquisition must be scheduled before reporting.</p>
                )}
              </>
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

function fmt(iso?: string): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}
