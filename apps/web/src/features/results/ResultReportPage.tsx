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
  DataTable,
  PageHeader,
  Spinner,
} from '@trustos/ui';
import { flagLabel, flagTone, formatDateTime } from './tone';

interface ResultRow {
  observationId: string;
  code?: string;
  value: number | string | null;
  unit?: string;
  interpretation: string;
  abnormal: boolean;
  referenceRangeText?: string;
  effectiveDateTime?: string;
}

interface Acknowledgement {
  id: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
  note?: string;
  followUpTaskId?: string;
}

interface ReportDetail {
  report: {
    id: string;
    status: string;
    category?: string;
    code?: { text?: string };
    issued?: string;
    effectiveDateTime?: string;
    conclusion?: string;
    performer?: { display?: string };
  };
  patient: {
    id: string;
    name: string;
    birthDate?: string;
    gender?: string;
    nhsNumber?: string;
  } | null;
  encounter: { id: string; specialty?: string; reasonText?: string } | null;
  results: ResultRow[];
  abnormalCount: number;
  criticalCount: number;
  worstInterpretation: string;
  acknowledged: boolean;
  acknowledgement: Acknowledgement | null;
}

interface AcknowledgePayload {
  acknowledgedBy: string;
  note?: string;
  createFollowUpTask: boolean;
  followUp?: { description: string; priority: string };
}

export function ResultReportPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<ReportDetail>(id ? `/api/results/report/${id}` : null);

  if (isLoading || !data) return <Spinner className="m-10" />;

  const { report, patient } = data;
  const title = report.code?.text ?? 'Diagnostic report';

  return (
    <div>
      <Link to="/results" className="text-sm text-nhs-blue hover:underline">
        ← Back to Results &amp; Reporting
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-sky-200">
              {report.category ?? 'Report'}
            </div>
            <h1 className="text-2xl font-bold">{title}</h1>
            <div className="mt-1 text-sm text-sky-200">
              {patient?.name ?? 'Unknown patient'}
              {patient?.nhsNumber && <> · NHS {patient.nhsNumber}</>}
              {patient?.birthDate && <> · DOB {patient.birthDate}</>}
              {patient?.gender && <> · {patient.gender}</>}
            </div>
            <div className="mt-1 text-xs text-sky-300">
              Issued {formatDateTime(report.issued)} · Collected{' '}
              {formatDateTime(report.effectiveDateTime)}
              {report.performer?.display && <> · Reported by {report.performer.display}</>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-sky-200">Overall</div>
            <Badge tone={flagTone(data.worstInterpretation)} className="text-base">
              {flagLabel(data.worstInterpretation)}
            </Badge>
          </div>
        </div>
      </div>

      <PageHeader title="" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                Results{' '}
                {data.abnormalCount > 0 && (
                  <span className="ml-1 text-sm font-normal text-slate-400">
                    ({data.abnormalCount} out of range
                    {data.criticalCount > 0 ? `, ${data.criticalCount} critical` : ''})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardBody>
              <DataTable
                rows={data.results}
                rowKey={(r) => r.observationId}
                empty="No discrete results recorded"
                columns={[
                  {
                    header: 'Analyte',
                    cell: (r) => (
                      <span className="font-medium text-slate-800">{r.code ?? '—'}</span>
                    ),
                  },
                  {
                    header: 'Value',
                    cell: (r) => (
                      <span
                        className={r.abnormal ? 'font-semibold text-nhs-red' : 'text-slate-700'}
                      >
                        {r.value ?? '—'}
                        {r.unit ? ` ${r.unit}` : ''}
                      </span>
                    ),
                  },
                  {
                    header: 'Reference range',
                    cell: (r) => (
                      <span className="text-slate-500">{r.referenceRangeText ?? '—'}</span>
                    ),
                  },
                  {
                    header: 'Flag',
                    cell: (r) =>
                      r.interpretation === 'normal' ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <Badge tone={flagTone(r.interpretation)}>
                          {flagLabel(r.interpretation)}
                        </Badge>
                      ),
                  },
                ]}
              />
              {report.conclusion && (
                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">Conclusion: </span>
                  {report.conclusion}
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div>
          <AcknowledgePanel reportId={report.id} detail={data} />
        </div>
      </div>
    </div>
  );
}

function AcknowledgePanel({ reportId, detail }: { reportId: string; detail: ReportDetail }) {
  const [acknowledgedBy, setAcknowledgedBy] = useState('Dr A. Clinician');
  const [note, setNote] = useState('');
  const [createFollowUpTask, setCreateFollowUpTask] = useState(false);
  const [followUpDescription, setFollowUpDescription] = useState('');
  const [priority, setPriority] = useState('routine');

  const mutation = useApiMutation<AcknowledgePayload>(
    'POST',
    () => `/api/results/${reportId}/acknowledge`,
  );

  if (detail.acknowledged && detail.acknowledgement) {
    const ack = detail.acknowledgement;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acknowledged</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <Badge tone="success">Signed off</Badge>
          <div className="text-slate-700">
            By <span className="font-medium">{ack.acknowledgedBy}</span>
          </div>
          <div className="text-xs text-slate-400">{formatDateTime(ack.acknowledgedAt)}</div>
          {ack.note && <p className="rounded-lg bg-slate-50 p-2 text-slate-600">{ack.note}</p>}
          {ack.followUpTaskId && (
            <p className="text-xs text-nhs-blue">Follow-up task raised ({ack.followUpTaskId}).</p>
          )}
        </CardBody>
      </Card>
    );
  }

  const canSubmit =
    acknowledgedBy.trim().length > 0 &&
    (!createFollowUpTask || followUpDescription.trim().length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acknowledge result</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <label className="block text-sm">
          <span className="text-slate-600">Acknowledged by</span>
          <input
            value={acknowledgedBy}
            onChange={(e) => setAcknowledgedBy(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-600">Note (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Clinical comment on the result…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={createFollowUpTask}
            onChange={(e) => setCreateFollowUpTask(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-nhs-blue focus:ring-nhs-blue"
          />
          Raise a follow-up task
        </label>

        {createFollowUpTask && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <label className="block text-sm">
              <span className="text-slate-600">Task</span>
              <input
                value={followUpDescription}
                onChange={(e) => setFollowUpDescription(e.target.value)}
                placeholder="e.g. Repeat U&E in 12 hours"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Priority</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="asap">ASAP</option>
                <option value="stat">Stat</option>
              </select>
            </label>
          </div>
        )}

        <Button
          disabled={!canSubmit || mutation.isPending}
          onClick={() =>
            mutation.mutate({
              acknowledgedBy: acknowledgedBy.trim(),
              note: note.trim() || undefined,
              createFollowUpTask,
              followUp: createFollowUpTask
                ? { description: followUpDescription.trim(), priority }
                : undefined,
            })
          }
          className="w-full"
        >
          {mutation.isPending ? 'Signing off…' : 'Acknowledge & sign off'}
        </Button>

        {mutation.isError && (
          <p className="text-sm text-nhs-red">
            {(mutation.error as Error)?.message ?? 'Failed to acknowledge.'}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
