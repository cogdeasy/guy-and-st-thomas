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
} from '@trustos/ui';
import {
  RTT_TARGET_WEEKS,
  breachTone,
  priorityLabel,
  priorityTone,
  statusTone,
  type ReferralStatus,
  type RttView,
} from './types';
import { RttBar } from './RttBar';

export function ReferralDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<RttView>(id ? `/api/referrals/${id}` : null);

  const triage = useApiMutation<{ outcome: string }, RttView>('POST', () => `/api/referrals/${id}/triage`);
  const setStatus = useApiMutation<{ status: ReferralStatus }, RttView>('POST', () => `/api/referrals/${id}/status`);
  const pending = triage.isPending || setStatus.isPending;

  if (isLoading || !data) return <Spinner className="m-10" />;

  return (
    <div>
      <Link to="/referrals" className="text-sm text-nhs-blue hover:underline">
        ← Back to Referrals & RTT
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{data.patient.display || data.patient.reference}</h1>
            <div className="mt-1 text-sm text-sky-200">
              {data.fromSpecialty} → <span className="font-semibold text-white">{data.toSpecialty}</span> · referred{' '}
              {data.clockStart.slice(0, 10)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={priorityTone(data.priority)} className="text-sm">
              {priorityLabel(data.priority)}
            </Badge>
            <Badge tone={statusTone(data.status)} className="text-sm">
              {data.status}
            </Badge>
          </div>
        </div>
      </div>

      <PageHeader title="" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>RTT clock</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <Metric label="Weeks elapsed" value={`${data.weeksElapsed}`} />
              <Metric label="Target" value={`${RTT_TARGET_WEEKS} wks`} />
              <Metric
                label={data.breached ? 'Over target by' : 'Days to breach'}
                value={data.clockStopped ? 'Clock stopped' : `${Math.abs(data.daysToBreach)}d`}
              />
            </div>
            <RttBar view={data} />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={breachTone(data.breachRisk)}>
                {data.breached ? 'Breached 18-week target' : `Breach risk: ${data.breachRisk}`}
              </Badge>
              {data.twoWeekWaitBreached && <Badge tone="danger">2-week-wait breached</Badge>}
              {data.clockStop && (
                <span className="text-slate-400">Clock stopped {data.clockStop.slice(0, 10)}</span>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">Reason for referral</h3>
              <p className="text-sm text-slate-600">{data.reason}</p>
              {data.referrer?.display && (
                <p className="mt-2 text-xs text-slate-400">Referrer: {data.referrer.display}</p>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Actions</h3>
              {pending ? (
                <Spinner />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.status === 'received' && (
                    <>
                      <Button onClick={() => triage.mutate({ outcome: 'accepted' })}>Accept &amp; triage</Button>
                      <Button variant="danger" onClick={() => triage.mutate({ outcome: 'rejected' })}>
                        Reject
                      </Button>
                    </>
                  )}
                  {data.status === 'triaged' && (
                    <Button onClick={() => setStatus.mutate({ status: 'booked' })}>Book appointment</Button>
                  )}
                  {data.status === 'booked' && (
                    <Button onClick={() => setStatus.mutate({ status: 'treated' })}>Mark treated</Button>
                  )}
                  {data.status !== 'discharged' && data.status !== 'received' && (
                    <Button variant="secondary" onClick={() => setStatus.mutate({ status: 'discharged' })}>
                      Discharge
                    </Button>
                  )}
                  {data.status === 'discharged' && (
                    <span className="text-sm text-slate-400">Pathway closed — discharged to primary care.</span>
                  )}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Pathway timeline</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-4">
              {[...data.history].reverse().map((h, i) => (
                <li key={`${h.status}-${h.at}-${i}`} className="flex gap-3">
                  <div className="mt-1 flex flex-col items-center">
                    <span className="h-2.5 w-2.5 rounded-full bg-nhs-blue" />
                    {i < data.history.length - 1 && <span className="mt-1 h-full w-px flex-1 bg-slate-200" />}
                  </div>
                  <div className="pb-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone(h.status)}>{h.status}</Badge>
                      <span className="text-xs text-slate-400">{h.at.slice(0, 10)}</span>
                    </div>
                    {h.note && <p className="mt-1 text-sm text-slate-600">{h.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {data.triage && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                Triage outcome: <span className="font-medium text-slate-700">{data.triage.outcome}</span>
                {data.triage.notes && <> — {data.triage.notes}</>}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
