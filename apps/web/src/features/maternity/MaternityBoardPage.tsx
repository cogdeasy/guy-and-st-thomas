import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
import {
  DELIVERY_MODE_LABELS,
  patientIdFromRef,
  type Episode,
  type MaternitySummary,
} from './types';

interface ListResponse {
  total: number;
  items: Episode[];
}

export function MaternityBoardPage() {
  const summary = useApiQuery<MaternitySummary>('/api/maternity/summary');
  const labour = useApiQuery<ListResponse>('/api/maternity/labour-ward');
  const antenatal = useApiQuery<ListResponse>('/api/maternity/antenatal');
  const [birthFor, setBirthFor] = useState<Episode | null>(null);

  return (
    <div>
      <PageHeader
        title="Maternity & Obstetrics"
        description="Antenatal clinic, live labour-ward board and birth outcomes — Evelina London & St Thomas'."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Antenatal" value={summary.data?.antenatal ?? '—'} tone="info" />
        <Stat label="In labour" value={summary.data?.intrapartum ?? '—'} tone="warning" />
        <Stat label="Postnatal" value={summary.data?.postnatal ?? '—'} tone="success" />
        <Stat label="Births recorded" value={summary.data?.births ?? '—'} />
        <Stat label="High risk" value={summary.data?.highRisk ?? '—'} tone="danger" />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Labour ward board ({labour.data?.total ?? 0})
        </h2>
        {labour.isLoading ? (
          <Spinner className="m-6" />
        ) : (labour.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No women currently in labour" description="The labour ward board is clear." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {labour.data?.items.map((e) => (
              <Card key={e.id} className="border-l-4 border-l-nhs-blue">
                <CardBody>
                  <div className="flex items-start justify-between">
                    <div>
                      <Link
                        to={`/maternity/${patientIdFromRef(e.patient)}`}
                        className="font-semibold text-nhs-blue hover:underline"
                      >
                        {e.patientName}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {e.patientAge}y · NHS {e.nhsNumber ?? 'unknown'}
                      </div>
                    </div>
                    <Badge tone={e.highRisk ? 'danger' : 'success'}>
                      {e.highRisk ? 'High risk' : 'Low risk'}
                    </Badge>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                    <dt className="text-slate-500">Gestation</dt>
                    <dd className="text-right font-medium text-slate-800">{e.gestationWeeks} wks</dd>
                    <dt className="text-slate-500">Bed</dt>
                    <dd className="text-right text-slate-700">{e.bed ?? 'Unassigned'}</dd>
                    <dt className="text-slate-500">Midwife</dt>
                    <dd className="text-right text-slate-700">{e.midwifeName ?? '—'}</dd>
                    <dt className="text-slate-500">EDD</dt>
                    <dd className="text-right text-slate-700">{e.edd.slice(0, 10)}</dd>
                  </dl>

                  {e.riskFactors.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {e.riskFactors.map((r) => (
                        <Badge key={r} tone="warning">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <Button className="mt-4 w-full" onClick={() => setBirthFor(e)}>
                    Record birth
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Antenatal clinic ({antenatal.data?.total ?? 0})
        </h2>
        {antenatal.isLoading ? (
          <Spinner className="m-6" />
        ) : (
          <DataTable
            rows={antenatal.data?.items ?? []}
            rowKey={(r) => r.id}
            empty="No antenatal women booked"
            columns={[
              {
                header: 'Patient',
                cell: (r) => (
                  <Link
                    className="font-medium text-nhs-blue hover:underline"
                    to={`/maternity/${patientIdFromRef(r.patient)}`}
                  >
                    {r.patientName}
                  </Link>
                ),
              },
              {
                header: 'Gestation',
                cell: (r) => (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{r.gestationWeeks} wks</span>
                    <Badge tone="neutral">T{r.trimester}</Badge>
                  </span>
                ),
              },
              { header: 'EDD', cell: (r) => r.edd.slice(0, 10) },
              { header: 'G/P', cell: (r) => `G${r.gravida ?? '—'} P${r.parity}` },
              {
                header: 'Risk',
                cell: (r) =>
                  r.riskFactors.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {r.riskFactors.map((rf) => (
                        <Badge key={rf} tone="warning">
                          {rf}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <Badge tone="success">Low risk</Badge>
                  ),
              },
            ]}
          />
        )}
      </section>

      {birthFor && <RecordBirthModal episode={birthFor} onClose={() => setBirthFor(null)} />}
    </div>
  );
}

interface BirthForm {
  episodeId: string;
  mode: string;
  babyWeightGrams: number;
  apgar1: number;
  apgar5: number;
}

function RecordBirthModal({ episode, onClose }: { episode: Episode; onClose: () => void }) {
  const [mode, setMode] = useState('svd');
  const [weight, setWeight] = useState(3400);
  const [apgar1, setApgar1] = useState(8);
  const [apgar5, setApgar5] = useState(9);

  const mutation = useApiMutation<BirthForm>(
    'POST',
    (body) => `/api/maternity/episodes/${body.episodeId}/birth`,
  );

  const submit = () => {
    mutation.mutate(
      { episodeId: episode.id, mode, babyWeightGrams: weight, apgar1, apgar5 },
      { onSuccess: onClose },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Record birth — {episode.patientName}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Mode of delivery">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              {Object.entries(DELIVERY_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Birth weight (grams)">
            <NumberInput value={weight} min={200} max={7000} onChange={setWeight} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Apgar @ 1 min">
              <NumberInput value={apgar1} min={0} max={10} onChange={setApgar1} />
            </Field>
            <Field label="Apgar @ 5 min">
              <NumberInput value={apgar5} min={0} max={10} onChange={setApgar5} />
            </Field>
          </div>
          {mutation.isError && (
            <p className="text-sm text-nhs-red">{(mutation.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Confirm birth'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
    />
  );
}
