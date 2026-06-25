import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
} from '@trustos/ui';
import {
  COMPONENT_LABELS,
  NEXT_ACTION,
  STATUS_LABELS,
  patientName,
  priorityTone,
  statusTone,
  type BloodComponent,
  type BloodGroup,
  type Stock,
  type TransfusionStatus,
  type Worklist,
  type WorklistItem,
} from './types';

const STATUS_FILTERS: Array<{ key: TransfusionStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All active' },
  { key: 'requested', label: 'Requested' },
  { key: 'crossmatched', label: 'Crossmatched' },
  { key: 'issued', label: 'Issued' },
  { key: 'transfused', label: 'Transfused' },
];

export function BloodBankPage() {
  const [filter, setFilter] = useState<TransfusionStatus | 'all'>('all');
  const worklist = useApiQuery<Worklist>('/api/bloodbank/worklist');
  const stock = useApiQuery<Stock>('/api/bloodbank/stock');

  const advance = useApiMutation<{ id: string; path: string }>(
    'POST',
    ({ id, path }) => `/api/bloodbank/${id}/${path}`,
  );

  const items = useMemo(() => {
    const all = worklist.data?.items ?? [];
    return filter === 'all' ? all : all.filter((i) => i.order.status === filter);
  }, [worklist.data, filter]);

  const byStatus = worklist.data?.byStatus ?? {};

  return (
    <div>
      <PageHeader
        title="Blood Bank & Transfusion"
        description="Live transfusion worklist with the crossmatch → issue → transfuse pathway and blood stock levels."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Active orders" value={worklist.data?.total ?? 0} />
        <Stat label="Awaiting crossmatch" value={byStatus.requested ?? 0} tone="info" />
        <Stat label="Awaiting issue" value={byStatus.crossmatched ?? 0} tone="warning" />
        <Stat label="Issued" value={byStatus.issued ?? 0} tone="warning" />
        <Stat label="Units in stock" value={stock.data?.totalUnits ?? 0} tone="success" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f.key
                    ? 'bg-nhs-blue text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
                {f.key !== 'all' && (
                  <span className="ml-1.5 opacity-70">{byStatus[f.key] ?? 0}</span>
                )}
              </button>
            ))}
          </div>

          {worklist.isLoading ? (
            <Spinner className="m-10" />
          ) : (
            <DataTable<WorklistItem>
              rows={items}
              rowKey={(r) => r.order.id}
              empty="No transfusion orders in this state"
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <Link
                      to={`/bloodbank/${r.order.id}`}
                      className="font-medium text-nhs-blue hover:underline"
                    >
                      {patientName(r.patient, r.order.patient.display)}
                    </Link>
                  ),
                },
                {
                  header: 'Component',
                  cell: (r) => (
                    <div className="flex items-center gap-2">
                      <ComponentDot component={r.order.component} />
                      <span>{COMPONENT_LABELS[r.order.component]}</span>
                      <span className="text-xs text-slate-400">×{r.order.units}</span>
                    </div>
                  ),
                },
                {
                  header: 'Group',
                  cell: (r) => <span className="font-semibold text-nhs-red">{r.order.bloodGroup}</span>,
                },
                { header: 'Indication', cell: (r) => r.order.indication },
                {
                  header: 'Priority',
                  cell: (r) => <Badge tone={priorityTone(r.order.priority)}>{r.order.priority}</Badge>,
                },
                {
                  header: 'Status',
                  cell: (r) => (
                    <Badge tone={statusTone(r.order.status)}>{STATUS_LABELS[r.order.status]}</Badge>
                  ),
                },
                {
                  header: '',
                  cell: (r) => {
                    const next = NEXT_ACTION[r.order.status];
                    if (!next) return <span className="text-xs text-slate-400">Complete</span>;
                    return (
                      <Button
                        variant="secondary"
                        className="px-3 py-1 text-xs"
                        disabled={advance.isPending}
                        onClick={() =>
                          advance.mutate({ id: r.order.id, path: next.path })
                        }
                      >
                        {next.label}
                      </Button>
                    );
                  },
                },
              ]}
            />
          )}
          {advance.isError && (
            <p className="mt-2 text-sm text-nhs-red">{(advance.error as Error).message}</p>
          )}
        </div>

        <div className="space-y-6">
          <NewOrderCard />
          <StockPanel stock={stock.data} loading={stock.isLoading} />
        </div>
      </div>
    </div>
  );
}

function ComponentDot({ component }: { component: BloodComponent }) {
  const color: Record<BloodComponent, string> = {
    'red-cells': 'bg-nhs-red',
    platelets: 'bg-nhs-yellow',
    ffp: 'bg-nhs-blue',
  };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color[component]}`} />;
}

const GROUPS: BloodGroup[] = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const COMPONENTS: BloodComponent[] = ['red-cells', 'platelets', 'ffp'];

function NewOrderCard() {
  const patients = useResourceList('Patient');
  const create = useApiMutation('POST', () => '/api/bloodbank/order');

  const [patientId, setPatientId] = useState('');
  const [component, setComponent] = useState<BloodComponent>('red-cells');
  const [bloodGroup, setBloodGroup] = useState<BloodGroup>('O+');
  const [units, setUnits] = useState(1);
  const [indication, setIndication] = useState('Symptomatic anaemia');

  const submit = () => {
    if (!patientId) return;
    create.mutate(
      { patientId, component, bloodGroup, units, indication, priority: 'routine' },
      { onSuccess: () => setPatientId('') },
    );
  };

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Raise transfusion order</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <select
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select patient…</option>
          {(patients.data ?? []).slice(0, 40).map((p: Patient) => (
            <option key={p.id} value={p.id}>
              {patientName(p)}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={component}
            onChange={(e) => setComponent(e.target.value as BloodComponent)}
            className={inputClass}
          >
            {COMPONENTS.map((c) => (
              <option key={c} value={c}>
                {COMPONENT_LABELS[c]}
              </option>
            ))}
          </select>
          <select
            value={bloodGroup}
            onChange={(e) => setBloodGroup(e.target.value as BloodGroup)}
            className={inputClass}
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            min={1}
            max={10}
            value={units}
            onChange={(e) => setUnits(Number(e.target.value))}
            className={inputClass}
          />
          <input
            value={indication}
            onChange={(e) => setIndication(e.target.value)}
            placeholder="Indication"
            className={`${inputClass} col-span-2`}
          />
        </div>
        <Button onClick={submit} disabled={!patientId || create.isPending} className="w-full">
          {create.isPending ? 'Submitting…' : 'Submit order'}
        </Button>
        {create.isError && (
          <p className="text-sm text-nhs-red">{(create.error as Error).message}</p>
        )}
      </CardBody>
    </Card>
  );
}

function StockPanel({ stock, loading }: { stock?: Stock; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Blood stock</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {loading && <Spinner />}
        {!loading && !stock && <EmptyState title="No stock data" />}
        {stock?.components.map((c) => (
          <div key={c.component}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{c.label}</span>
              <span className="text-xs text-slate-400">{c.total} units</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {c.groups.map((g) => (
                <div
                  key={g.group}
                  className={`rounded-lg border px-2 py-1.5 text-center ${
                    g.units === 0
                      ? 'border-red-200 bg-red-50'
                      : g.units <= 2
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-700">{g.group}</div>
                  <div
                    className={`text-sm font-bold ${
                      g.units === 0
                        ? 'text-nhs-red'
                        : g.units <= 2
                          ? 'text-amber-600'
                          : 'text-slate-800'
                    }`}
                  >
                    {g.units}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
