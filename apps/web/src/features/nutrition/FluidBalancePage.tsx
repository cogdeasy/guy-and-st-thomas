import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CodeSystems } from '@trustos/ontology';
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
  Stat,
} from '@trustos/ui';
import type { FluidBalance, FluidRoute } from './types';
import { patientName } from './types';

const ROUTES: FluidRoute[] = ['oral', 'iv', 'ng-tube', 'urine', 'drain', 'stool', 'vomit'];
const INTAKE_ROUTES: FluidRoute[] = ['oral', 'iv', 'ng-tube'];

export function FluidBalancePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { data, isLoading, refetch } = useApiQuery<FluidBalance>(
    patientId ? `/api/nutrition/${patientId}/fluid-balance` : null,
  );

  if (isLoading || !data) return <Spinner className="m-10" />;

  const chart = data.entries.map((e) => ({
    time: e.timestamp.slice(11, 16),
    intake: e.intakeMl,
    output: -e.outputMl,
    balance: e.balanceMl,
  }));

  const balanceTone = data.netBalanceMl >= 0 ? 'success' : 'danger';

  return (
    <div>
      <Link to="/nutrition" className="text-sm text-nhs-blue hover:underline">
        ← Back to Dietetics & Nutrition
      </Link>

      <div className="mt-3">
        <PageHeader
          title={patientName(data.patient)}
          description={`24-hour fluid balance · NHS ${
            data.patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value ?? '—'
          }`}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Total intake" value={`${data.totalIntakeMl} ml`} tone="info" hint="last 24h" />
        <Stat label="Total output" value={`${data.totalOutputMl} ml`} tone="warning" hint="last 24h" />
        <Stat
          label="Net balance"
          value={`${data.netBalanceMl > 0 ? '+' : ''}${data.netBalanceMl} ml`}
          tone={balanceTone}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Fluid balance over 24 hours</CardTitle>
        </CardHeader>
        <CardBody>
          {chart.length === 0 ? (
            <EmptyState title="No fluid entries" description="Record intake or output to start the chart." />
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 12 }} stroke="#94a3b8" unit="ml" width={56} />
                  <Tooltip
                    formatter={(value: number, name) => [`${Math.abs(value)} ml`, String(name)]}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <ReferenceLine y={0} stroke="#cbd5e1" />
                  <Bar dataKey="intake" name="Intake" fill="#0072CE" radius={[2, 2, 0, 0]} barSize={14} />
                  <Bar dataKey="output" name="Output" fill="#FFB81C" radius={[0, 0, 2, 2]} barSize={14} />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    name="Cumulative balance"
                    stroke="#009639"
                    fill="#00963922"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Entries</CardTitle>
            </CardHeader>
            <CardBody>
              <DataTable
                rows={[...data.entries].reverse()}
                rowKey={(r) => r.id}
                empty="No fluid entries in the last 24 hours"
                columns={[
                  { header: 'Time', cell: (r) => r.timestamp.slice(11, 16) },
                  {
                    header: 'Route',
                    cell: (r) => <span className="capitalize">{r.route.replace('-', ' ')}</span>,
                  },
                  {
                    header: 'Intake',
                    cell: (r) => (r.intakeMl ? `${r.intakeMl} ml` : <span className="text-slate-400">—</span>),
                  },
                  {
                    header: 'Output',
                    cell: (r) => (r.outputMl ? `${r.outputMl} ml` : <span className="text-slate-400">—</span>),
                  },
                  {
                    header: 'Balance',
                    cell: (r) => (
                      <Badge tone={r.balanceMl >= 0 ? 'success' : 'danger'}>
                        {r.balanceMl > 0 ? '+' : ''}
                        {r.balanceMl} ml
                      </Badge>
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <AddEntryCard patientId={patientId ?? ''} onAdded={() => void refetch()} />
      </div>
    </div>
  );
}

function AddEntryCard({ patientId, onAdded }: { patientId: string; onAdded: () => void }) {
  const [route, setRoute] = useState<FluidRoute>('oral');
  const [volume, setVolume] = useState('200');

  const mutation = useApiMutation<Record<string, unknown>>(
    'POST',
    () => `/api/nutrition/${patientId}/fluid`,
  );

  const isIntake = INTAKE_ROUTES.includes(route);

  const submit = () => {
    const ml = Number(volume);
    mutation.mutate(
      {
        route,
        intakeMl: isIntake ? ml : 0,
        outputMl: isIntake ? 0 : ml,
      },
      { onSuccess: onAdded },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add entry</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Route</label>
          <select
            value={route}
            onChange={(e) => setRoute(e.target.value as FluidRoute)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize focus:border-nhs-blue focus:outline-none"
          >
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {r.replace('-', ' ')} {INTAKE_ROUTES.includes(r) ? '(intake)' : '(output)'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Volume ({isIntake ? 'intake' : 'output'} ml)
          </label>
          <input
            type="number"
            min="0"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
          />
        </div>

        {mutation.isError && <p className="text-sm text-nhs-red">Could not add entry.</p>}

        <Button className="w-full" onClick={submit} disabled={mutation.isPending || Number(volume) <= 0}>
          {mutation.isPending ? 'Adding…' : 'Add fluid entry'}
        </Button>
      </CardBody>
    </Card>
  );
}
