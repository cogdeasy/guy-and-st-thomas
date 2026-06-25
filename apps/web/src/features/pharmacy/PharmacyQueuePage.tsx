import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useApiQuery } from '@trustos/api-client';
import { Badge, Card, CardBody, DataTable, PageHeader, Spinner, Stat } from '@trustos/ui';
import type { EnrichedRecord, PharmacyMetrics, VerifyQueueResponse, DispenseStatus } from './types';
import {
  STATUS_LABELS,
  formatWait,
  fullName,
  patientLine,
  priorityTone,
  statusTone,
} from './shared';

const TABS: Array<{ key: DispenseStatus | 'all'; label: string }> = [
  { key: 'to-verify', label: 'To verify' },
  { key: 'query', label: 'Queries' },
  { key: 'verified', label: 'Verified' },
  { key: 'dispensed', label: 'Dispensed' },
  { key: 'all', label: 'All' },
];

export function PharmacyQueuePage() {
  const [tab, setTab] = useState<DispenseStatus | 'all'>('to-verify');
  const metrics = useApiQuery<PharmacyMetrics>('/api/pharmacy/metrics');
  const queue = useApiQuery<VerifyQueueResponse>(`/api/pharmacy/verify-queue?status=${tab}`);

  return (
    <div>
      <PageHeader
        title="Pharmacy Verification & Stock"
        description="Clinical screening and dispensing of inpatient prescriptions."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Awaiting verification" value={metrics.data?.toVerify ?? '—'} tone="warning" />
        <Stat
          label="Allergy alerts"
          value={metrics.data?.allergyAlerts ?? '—'}
          tone={metrics.data && metrics.data.allergyAlerts > 0 ? 'danger' : 'neutral'}
          hint="Unverified scripts with a documented conflict"
        />
        <Stat label="Urgent / STAT" value={metrics.data?.urgent ?? '—'} tone="info" />
        <Stat label="On-shift pharmacists" value={metrics.data?.pharmacists ?? '—'} />
      </div>

      <div className="mt-6 mb-3 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const count = t.key === 'all' ? metrics.data?.total : metrics.data?.byStatus?.[t.key];
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-nhs-blue text-nhs-blue'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              {count !== undefined && (
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {queue.isLoading ? (
        <Spinner className="m-10" />
      ) : (
        <Card>
          <CardBody className="p-0">
            <DataTable<EnrichedRecord>
              rows={queue.data?.items ?? []}
              rowKey={(r) => r.record.id}
              empty={`No prescriptions ${tab === 'all' ? '' : STATUS_LABELS[tab as DispenseStatus].toLowerCase()}`}
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <Link
                      className="font-medium text-nhs-blue hover:underline"
                      to={`/pharmacy/${r.record.id}`}
                    >
                      {fullName(r.patient)}
                      <div className="text-xs font-normal text-slate-400">
                        {patientLine(r.patient)}
                      </div>
                    </Link>
                  ),
                },
                {
                  header: 'Medication',
                  cell: (r) => (
                    <div>
                      <div className="font-medium text-slate-800">
                        {r.medicationRequest?.medication?.text ?? 'Unknown'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {r.medicationRequest?.dosageInstruction?.[0]?.text ?? '—'}
                      </div>
                    </div>
                  ),
                },
                {
                  header: 'Allergy',
                  cell: (r) =>
                    r.allergyConflicts.length > 0 ? (
                      <Badge tone="danger" className="gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {r.allergyConflicts.map((a) => a.code?.text).join(', ')}
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400">No conflict</span>
                    ),
                },
                {
                  header: 'Priority',
                  cell: (r) => (
                    <Badge tone={priorityTone(r.record.priority)}>{r.record.priority}</Badge>
                  ),
                },
                {
                  header: 'Waiting',
                  cell: (r) => (
                    <span className="text-slate-600">{formatWait(r.waitingMinutes)}</span>
                  ),
                },
                {
                  header: 'Status',
                  cell: (r) => (
                    <Badge tone={statusTone(r.record.status)}>
                      {STATUS_LABELS[r.record.status]}
                    </Badge>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
