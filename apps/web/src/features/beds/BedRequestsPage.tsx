import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  type BadgeTone,
} from '@trustos/ui';
import type { BedRequestView, BoardResponse, RequestPriority, RequestsResponse } from './types';

interface AllocateVars {
  requestId: string;
  bedId: string;
}

export function BedRequestsPage() {
  const requests = useApiQuery<RequestsResponse>('/api/beds/requests');
  const board = useApiQuery<BoardResponse>('/api/beds/board');
  const [allocatingId, setAllocatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allocate = useApiMutation<AllocateVars, unknown>(
    'POST',
    (vars) => `/api/beds/requests/${vars.requestId}/allocate`,
  );

  const availableBeds = useMemo(
    () =>
      (board.data?.wards ?? []).flatMap((w) =>
        w.beds
          .filter((b) => b.status === 'available')
          .map((b) => ({ id: b.id, name: b.name, ward: w.wardName, site: w.siteName })),
      ),
    [board.data],
  );

  const items = requests.data?.items ?? [];
  const pending = items.filter((r) => r.status === 'pending');
  const resolved = items.filter((r) => r.status !== 'pending');

  function runAllocate(requestId: string, bedId: string) {
    setError(null);
    allocate.mutate(
      { requestId, bedId },
      {
        onSuccess: () => setAllocatingId(null),
        onError: (e) => setError(e instanceof Error ? e.message : 'Allocation failed'),
      },
    );
  }

  return (
    <div>
      <Link to="/beds" className="inline-flex items-center gap-1 text-sm text-nhs-blue hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to bed board
      </Link>

      <div className="mt-3">
        <PageHeader
          title="Bed Requests"
          description="Admission and transfer requests awaiting a bed. Allocate an available bed to admit a patient."
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      {requests.isLoading && <Spinner className="m-10" />}

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Pending ({pending.length})</CardTitle>
          </CardHeader>
          <CardBody>
            {pending.length === 0 ? (
              <EmptyState title="No pending requests" description="All admission and transfer requests are resolved." />
            ) : (
              <div className="space-y-3">
                {pending.map((r) => (
                  <PendingRow
                    key={r.id}
                    request={r}
                    isOpen={allocatingId === r.id}
                    onToggle={() => {
                      setError(null);
                      setAllocatingId((cur) => (cur === r.id ? null : r.id));
                    }}
                    availableBeds={availableBeds}
                    onAllocate={(bedId) => runAllocate(r.id, bedId)}
                    isAllocating={allocate.isPending}
                  />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recently allocated / rejected ({resolved.length})
          </h2>
          <DataTable
            rows={resolved}
            rowKey={(r) => r.id}
            empty="No allocated requests yet"
            columns={[
              { header: 'Patient', cell: (r) => patientLabel(r) },
              { header: 'Specialty', cell: (r) => r.specialty },
              { header: 'Priority', cell: (r) => <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge> },
              {
                header: 'Status',
                cell: (r) => <Badge tone={r.status === 'allocated' ? 'success' : 'danger'}>{r.status}</Badge>,
              },
              { header: 'Bed', cell: (r) => r.allocatedBed?.display ?? '—' },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function PendingRow({
  request,
  isOpen,
  onToggle,
  availableBeds,
  onAllocate,
  isAllocating,
}: {
  request: BedRequestView;
  isOpen: boolean;
  onToggle: () => void;
  availableBeds: { id: string; name: string; ward: string; site?: string }[];
  onAllocate: (bedId: string) => void;
  isAllocating: boolean;
}) {
  const [bedId, setBedId] = useState('');

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-800">{patientLabel(request)}</div>
          <div className="mt-0.5 text-xs text-slate-400">
            {request.specialty}
            {request.fromLocation?.display ? ` · from ${request.fromLocation.display}` : ''} · requested{' '}
            {request.requestedAt.slice(0, 10)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={priorityTone(request.priority)}>{request.priority}</Badge>
          <Button variant={isOpen ? 'secondary' : 'primary'} onClick={onToggle}>
            {isOpen ? 'Cancel' : 'Allocate bed'}
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <select
            value={bedId}
            onChange={(e) => setBedId(e.target.value)}
            className="min-w-64 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
          >
            <option value="">Select an available bed…</option>
            {availableBeds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.site ? ` — ${b.site}` : ''}
              </option>
            ))}
          </select>
          <Button variant="primary" disabled={!bedId || isAllocating} onClick={() => onAllocate(bedId)}>
            {isAllocating ? 'Allocating…' : 'Confirm admission'}
          </Button>
        </div>
      )}
    </div>
  );
}

function patientLabel(r: BedRequestView): string {
  const p = r.patient;
  const name = p.name ?? p.display ?? 'Unknown patient';
  const extras = [p.age != null ? `${p.age}y` : null, p.nhsNumber ? `NHS ${p.nhsNumber}` : null]
    .filter(Boolean)
    .join(' · ');
  return extras ? `${name} (${extras})` : name;
}

function priorityTone(priority: RequestPriority): BadgeTone {
  if (priority === 'emergency') return 'danger';
  if (priority === 'urgent') return 'warning';
  return 'neutral';
}
