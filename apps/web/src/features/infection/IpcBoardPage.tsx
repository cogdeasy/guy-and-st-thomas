import { useMemo, useState } from 'react';
import { useApiMutation, useApiQuery, useResourceList } from '@trustos/api-client';
import type { Patient } from '@trustos/ontology';
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
  Stat,
  type BadgeTone,
} from '@trustos/ui';
import { ORGANISM_OPTIONS, organismTone } from './organisms';

interface Reference {
  reference: string;
  display?: string;
}

interface BoardRow {
  id: string;
  organism: string;
  type: 'colonisation' | 'infection';
  status: 'active' | 'cleared';
  isolationRequired: boolean;
  sideRoom: boolean;
  notifiedAt: string;
  patient: { id: string; name: string; nhsNumber?: string } | null;
  ward?: Reference;
  bed?: Reference;
}

interface Board {
  total: number;
  awaitingSideRoom: number;
  items: BoardRow[];
}

interface Metrics {
  activeCases: number;
  byOrganism: Array<{ organism: string; total: number; infection: number; colonisation: number }>;
  isolation: {
    required: number;
    sideRoomCapacity: number;
    sideRoomsInUse: number;
    sideRoomsAvailable: number;
    awaitingSideRoom: number;
    utilisation: number;
  };
}

export function IpcBoardPage() {
  const board = useApiQuery<Board>('/api/infection/board');
  const metrics = useApiQuery<Metrics>('/api/infection/metrics');

  const clear = useApiMutation<string>('POST', (id) => `/api/infection/${id}/clear`);

  if (board.isLoading || metrics.isLoading) return <Spinner className="m-10" />;

  const data = board.data;
  const m = metrics.data;

  return (
    <div>
      <PageHeader
        title="Infection Prevention & Control"
        description="Live isolation board, organism surveillance and side-room capacity across the trust."
        actions={<RaiseAlertButton />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active cases" value={m?.activeCases ?? 0} tone="info" />
        <Stat label="Isolation required" value={m?.isolation.required ?? 0} tone="danger" />
        <Stat
          label="Side rooms in use"
          value={`${m?.isolation.sideRoomsInUse ?? 0} / ${m?.isolation.sideRoomCapacity ?? 0}`}
          hint={`${m?.isolation.utilisation ?? 0}% utilisation`}
          tone={capacityTone(m?.isolation.utilisation ?? 0)}
        />
        <Stat
          label="Awaiting side room"
          value={m?.isolation.awaitingSideRoom ?? 0}
          hint="Isolation needed, not yet placed"
          tone={(m?.isolation.awaitingSideRoom ?? 0) > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Isolation board ({data?.total ?? 0})
          </h2>
          <DataTable
            rows={data?.items ?? []}
            rowKey={(r) => r.id}
            empty="No active IPC alerts"
            columns={[
              {
                header: 'Patient',
                cell: (r) => (
                  <div>
                    <div className="font-medium text-slate-800">{r.patient?.name ?? 'Unknown'}</div>
                    <div className="text-xs text-slate-400">NHS {r.patient?.nhsNumber ?? '—'}</div>
                  </div>
                ),
              },
              {
                header: 'Organism',
                cell: (r) => <Badge tone={organismTone(r.organism)}>{r.organism}</Badge>,
              },
              {
                header: 'Type',
                cell: (r) => (
                  <Badge tone={r.type === 'infection' ? 'danger' : 'warning'}>{r.type}</Badge>
                ),
              },
              {
                header: 'Location',
                cell: (r) => (
                  <div className="text-sm">
                    <div className="text-slate-700">{r.ward?.display ?? '—'}</div>
                    <div className="text-xs text-slate-400">{r.bed?.display ?? ''}</div>
                  </div>
                ),
              },
              {
                header: 'Isolation',
                cell: (r) =>
                  r.isolationRequired ? (
                    r.sideRoom ? (
                      <Badge tone="success">Side room</Badge>
                    ) : (
                      <Badge tone="danger">Awaiting</Badge>
                    )
                  ) : (
                    <span className="text-slate-400">Not required</span>
                  ),
              },
              { header: 'Notified', cell: (r) => relativeTime(r.notifiedAt) },
              {
                header: '',
                cell: (r) => (
                  <Button
                    variant="secondary"
                    className="px-3 py-1 text-xs"
                    disabled={clear.isPending}
                    onClick={() => clear.mutate(r.id)}
                  >
                    Clear
                  </Button>
                ),
              },
            ]}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Organism breakdown</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {(m?.byOrganism ?? []).length === 0 && (
                <p className="text-sm text-slate-400">No active cases.</p>
              )}
              {(m?.byOrganism ?? []).map((o) => {
                const max = Math.max(...(m?.byOrganism ?? []).map((x) => x.total), 1);
                return (
                  <div key={o.organism}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">{o.organism}</span>
                      <span className="text-slate-500">{o.total}</span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-nhs-blue"
                        style={{ width: `${(o.total / max) * 100}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {o.infection} infection · {o.colonisation} colonisation
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Side-room capacity</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex items-end justify-between">
                <div className="text-3xl font-bold text-slate-900">
                  {m?.isolation.sideRoomsInUse ?? 0}
                  <span className="text-lg font-medium text-slate-400">
                    {' '}
                    / {m?.isolation.sideRoomCapacity ?? 0}
                  </span>
                </div>
                <Badge tone={capacityTone(m?.isolation.utilisation ?? 0)}>
                  {m?.isolation.utilisation ?? 0}%
                </Badge>
              </div>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${capacityBar(m?.isolation.utilisation ?? 0)}`}
                  style={{ width: `${Math.min(100, m?.isolation.utilisation ?? 0)}%` }}
                />
              </div>
              <p className="mt-3 text-sm text-slate-500">
                {m?.isolation.sideRoomsAvailable ?? 0} side rooms available ·{' '}
                {m?.isolation.awaitingSideRoom ?? 0} patients awaiting isolation
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RaiseAlertButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Raise IPC alert</Button>
      {open && <RaiseAlertModal onClose={() => setOpen(false)} />}
    </>
  );
}

function RaiseAlertModal({ onClose }: { onClose: () => void }) {
  const patients = useResourceList('Patient');
  const create = useApiMutation<Record<string, unknown>>('POST', () => '/api/infection/alerts');

  const [patientId, setPatientId] = useState('');
  const [organism, setOrganism] = useState<string>(ORGANISM_OPTIONS[0]);
  const [type, setType] = useState<'colonisation' | 'infection'>('colonisation');
  const [sideRoom, setSideRoom] = useState(false);

  const sortedPatients = useMemo(
    () =>
      [...(patients.data ?? [])].sort((a, b) =>
        (a.name?.[0]?.family ?? '').localeCompare(b.name?.[0]?.family ?? ''),
      ),
    [patients.data],
  );

  const submit = () => {
    if (!patientId) return;
    create.mutate(
      { patientId, organism, type, sideRoom },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Raise IPC alert</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {patients.isLoading ? (
            <Spinner />
          ) : sortedPatients.length === 0 ? (
            <EmptyState title="No patients available" />
          ) : (
            <>
              <Field label="Patient">
                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                >
                  <option value="">Select patient…</option>
                  {sortedPatients.map((p: Patient) => (
                    <option key={p.id} value={p.id}>
                      {p.name?.[0]?.given?.join(' ')} {p.name?.[0]?.family}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Organism">
                <select
                  value={organism}
                  onChange={(e) => setOrganism(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                >
                  {ORGANISM_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Type">
                <div className="flex gap-2">
                  {(['colonisation', 'infection'] as const).map((t) => (
                    <Button
                      key={t}
                      variant={type === t ? 'primary' : 'secondary'}
                      className="flex-1 capitalize"
                      onClick={() => setType(t)}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </Field>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sideRoom}
                  onChange={(e) => setSideRoom(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Patient placed in a side room
              </label>
            </>
          )}

          {create.isError && (
            <p className="text-sm text-nhs-red">Could not raise alert. Please try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!patientId || create.isPending}>
              {create.isPending ? 'Raising…' : 'Raise alert'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function capacityTone(utilisation: number): BadgeTone {
  if (utilisation >= 90) return 'danger';
  if (utilisation >= 70) return 'warning';
  return 'success';
}

function capacityBar(utilisation: number): string {
  if (utilisation >= 90) return 'bg-nhs-red';
  if (utilisation >= 70) return 'bg-nhs-yellow';
  return 'bg-nhs-green';
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const hours = Math.round((Date.now() - then) / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
