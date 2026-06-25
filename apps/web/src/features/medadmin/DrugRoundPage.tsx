import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import {
  type DoseStatus,
  type OmissionReason,
  type RoundItem,
  type RoundResponse,
  formatSlot,
} from './types';

const STATUS_TONE: Record<DoseStatus, BadgeTone> = {
  overdue: 'danger',
  due: 'warning',
  upcoming: 'info',
  given: 'success',
  omitted: 'neutral',
};

const STATUS_LABEL: Record<DoseStatus, string> = {
  overdue: 'Overdue',
  due: 'Due now',
  upcoming: 'Upcoming',
  given: 'Given',
  omitted: 'Omitted',
};

interface AdministerPayload {
  medicationRequestId: string;
  scheduledTime: string;
  status: 'given' | 'omitted';
  reasonCode?: string;
}

export function DrugRoundPage() {
  const [ward, setWard] = useState('');
  const [omitTarget, setOmitTarget] = useState<RoundItem | null>(null);

  const query = ward
    ? `/api/medadmin/round?ward=${encodeURIComponent(ward)}`
    : '/api/medadmin/round';
  const round = useApiQuery<RoundResponse>(query);
  const reasons = useApiQuery<{ reasons: OmissionReason[] }>('/api/medadmin/reasons');

  const administer = useApiMutation<AdministerPayload>('POST', () => '/api/medadmin/administer');

  const data = round.data;
  const actionable = useMemo(
    () => (data?.items ?? []).filter((i) => i.status === 'overdue' || i.status === 'due'),
    [data],
  );
  const upcoming = useMemo(
    () => (data?.items ?? []).filter((i) => i.status === 'upcoming'),
    [data],
  );
  const completed = useMemo(
    () => (data?.items ?? []).filter((i) => i.status === 'given' || i.status === 'omitted'),
    [data],
  );

  const give = (item: RoundItem) =>
    administer.mutate({
      medicationRequestId: item.medicationRequestId,
      scheduledTime: item.scheduledTime,
      status: 'given',
    });

  const confirmOmit = (reasonCode: string) => {
    if (!omitTarget) return;
    administer.mutate(
      {
        medicationRequestId: omitTarget.medicationRequestId,
        scheduledTime: omitTarget.scheduledTime,
        status: 'omitted',
        reasonCode,
      },
      { onSuccess: () => setOmitTarget(null) },
    );
  };

  return (
    <div>
      <PageHeader
        title="Medication Administration"
        description="Live electronic drug round (eMAR) — due, overdue and completed doses across the trust."
        actions={
          <select
            value={ward}
            onChange={(e) => setWard(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
          >
            <option value="">All wards</option>
            {(data?.wards ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.overdue + w.due} to action)
              </option>
            ))}
          </select>
        }
      />

      {round.isLoading && <Spinner className="m-10" />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="Overdue" value={data.stats.overdue} tone="danger" />
            <Stat label="Due now" value={data.stats.due} tone="warning" />
            <Stat label="Upcoming" value={data.stats.upcoming} tone="info" />
            <Stat label="Given" value={data.stats.given} tone="success" />
            <Stat label="Omitted" value={data.stats.omitted} />
          </div>

          {data.wards.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              <WardChip active={ward === ''} onClick={() => setWard('')} label="All wards" />
              {data.wards.map((w) => (
                <WardChip
                  key={w.id}
                  active={ward === w.id}
                  onClick={() => setWard(w.id)}
                  label={w.name}
                  count={w.overdue + w.due}
                />
              ))}
            </div>
          )}

          {administer.isError && (
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
              {(administer.error as Error)?.message ?? 'Failed to record administration.'}
            </div>
          )}

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                To administer{' '}
                <span className="ml-1 text-sm font-normal text-slate-400">
                  {actionable.length} dose{actionable.length === 1 ? '' : 's'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody>
              {actionable.length === 0 ? (
                <EmptyState
                  title="Nothing due"
                  description="No overdue or due doses for this view."
                />
              ) : (
                <DataTable
                  rows={actionable}
                  rowKey={(r) => r.id}
                  columns={[
                    { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                    { header: 'Scheduled', cell: (r) => formatSlot(r.scheduledTime) },
                    { header: 'Patient', cell: (r) => <PatientCell item={r} /> },
                    { header: 'Medication', cell: (r) => <MedicationCell item={r} /> },
                    { header: 'Ward', cell: (r) => r.ward?.name ?? '—' },
                    {
                      header: 'Action',
                      className: 'text-right',
                      cell: (r) => (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="primary"
                            onClick={() => give(r)}
                            disabled={administer.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4" /> Administer
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setOmitTarget(r)}
                            disabled={administer.isPending}
                          >
                            <XCircle className="h-4 w-4" /> Omit
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </CardBody>
          </Card>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Upcoming doses</CardTitle>
              </CardHeader>
              <CardBody>
                <DataTable
                  rows={upcoming}
                  rowKey={(r) => r.id}
                  empty="No upcoming doses scheduled"
                  columns={[
                    { header: 'Scheduled', cell: (r) => formatSlot(r.scheduledTime) },
                    { header: 'Patient', cell: (r) => <PatientCell item={r} /> },
                    { header: 'Medication', cell: (r) => <MedicationCell item={r} /> },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recently actioned</CardTitle>
              </CardHeader>
              <CardBody>
                <DataTable
                  rows={completed}
                  rowKey={(r) => r.id}
                  empty="No administrations recorded yet"
                  columns={[
                    { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                    { header: 'Scheduled', cell: (r) => formatSlot(r.scheduledTime) },
                    { header: 'Patient', cell: (r) => <PatientCell item={r} /> },
                    { header: 'Medication', cell: (r) => <MedicationCell item={r} /> },
                    {
                      header: 'Detail',
                      cell: (r) =>
                        r.administration?.notGivenReason ? (
                          <span className="text-amber-700">{r.administration.notGivenReason}</span>
                        ) : (
                          <span className="text-slate-400">
                            {r.administration?.performer ?? '—'}
                          </span>
                        ),
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {omitTarget && (
        <OmitModal
          item={omitTarget}
          reasons={reasons.data?.reasons ?? []}
          pending={administer.isPending}
          onCancel={() => setOmitTarget(null)}
          onConfirm={confirmOmit}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DoseStatus }) {
  const Icon = status === 'overdue' ? AlarmClock : status === 'due' ? Clock : undefined;
  return (
    <Badge tone={STATUS_TONE[status]}>
      {Icon && <Icon className="mr-1 h-3 w-3" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function PatientCell({ item }: { item: RoundItem }) {
  return (
    <Link
      to={`/medadmin/patient/${item.patient.id}`}
      className="font-medium text-nhs-blue hover:underline"
    >
      {item.patient.name}
      {item.patient.nhsNumber && (
        <span className="ml-1 text-xs font-normal text-slate-400">
          · NHS {item.patient.nhsNumber}
        </span>
      )}
    </Link>
  );
}

function MedicationCell({ item }: { item: RoundItem }) {
  return (
    <div>
      <div className="font-medium text-slate-800">{item.medication}</div>
      <div className="text-xs text-slate-400">
        {[item.dose, item.route, item.frequency].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

function WardChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? 'border-nhs-blue bg-nhs-blue text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={`rounded-full px-1.5 text-xs font-semibold ${
            active ? 'bg-white/20' : 'bg-nhs-red/10 text-nhs-red'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function OmitModal({
  item,
  reasons,
  pending,
  onCancel,
  onConfirm,
}: {
  item: RoundItem;
  reasons: OmissionReason[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reasonCode: string) => void;
}) {
  const [reasonCode, setReasonCode] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Omit dose</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="font-medium text-slate-800">{item.medication}</div>
            <div className="text-xs text-slate-500">
              {item.patient.name} · {[item.dose, item.route].filter(Boolean).join(' · ')} ·{' '}
              {formatSlot(item.scheduledTime)}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Reason for omission
            </label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              <option value="">Select a reason…</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.display}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => onConfirm(reasonCode)}
              disabled={pending || !reasonCode}
            >
              Confirm omission
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
