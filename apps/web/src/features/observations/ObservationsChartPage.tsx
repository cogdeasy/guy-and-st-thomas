import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  Spinner,
  news2Tone,
} from '@trustos/ui';
import { Sparkline } from './Sparkline';
import type { Chart, News2, RecordResult, VitalsSet } from './types';

interface FormState {
  respiratoryRate: string;
  spo2: string;
  systolicBp: string;
  heartRate: string;
  temperature: string;
  consciousness: 'A' | 'V' | 'P' | 'U';
  onOxygen: boolean;
}

const EMPTY_FORM: FormState = {
  respiratoryRate: '',
  spo2: '',
  systolicBp: '',
  heartRate: '',
  temperature: '',
  consciousness: 'A',
  onOxygen: false,
};

export function ObservationsChartPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const chart = useApiQuery<Chart>(patientId ? `/api/observations/${patientId}/chart` : null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [result, setResult] = useState<RecordResult | null>(null);

  const record = useApiMutation<Record<string, unknown>, RecordResult>(
    'POST',
    () => `/api/observations/${patientId}/record`,
  );

  if (chart.isLoading || !chart.data) return <Spinner className="m-10" />;

  const { patient, nhsNumber, series, latest } = chart.data;
  const name = patient.name?.[0];
  const fullName = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
  const trendScores = series.map((s) => s.news2?.score).filter((n): n is number => n != null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    record.mutate(
      {
        respiratoryRate: Number(form.respiratoryRate),
        spo2: Number(form.spo2),
        systolicBp: Number(form.systolicBp),
        heartRate: Number(form.heartRate),
        temperature: Number(form.temperature),
        consciousness: form.consciousness,
        onOxygen: form.onOxygen,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          setForm(EMPTY_FORM);
        },
      },
    );
  };

  return (
    <div>
      <Link to="/observations" className="text-sm text-nhs-blue hover:underline">
        ← Back to NEWS2 surveillance
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{fullName || 'Patient'}</h1>
            <div className="mt-1 text-sm text-sky-200">
              {ageFromBirthDate(patient.birthDate)}y · {patient.gender} · NHS {nhsNumber ?? 'unknown'}
            </div>
          </div>
          {latest?.news2 && (
            <div className="text-right">
              <div className="text-xs text-sky-200">Latest NEWS2</div>
              <Badge tone={news2Tone(latest.news2.risk)} className="text-base">
                {latest.news2.score}
              </Badge>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>NEWS2 trend</CardTitle>
              <span className="text-nhs-blue">
                <Sparkline values={trendScores} />
              </span>
            </CardHeader>
            <CardBody>
              {latest?.news2 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{latest.news2.recommendation}</p>
              ) : (
                <p className="text-sm text-slate-400">No scored observations yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Observation chart</CardTitle>
            </CardHeader>
            <CardBody>
              <DataTable
                rows={[...series].reverse()}
                rowKey={(r) => r.recordedAt}
                empty="No vital signs recorded"
                columns={[
                  {
                    header: 'Recorded',
                    cell: (r: VitalsSet) => (
                      <span className="text-xs text-slate-500">{new Date(r.recordedAt).toLocaleString('en-GB')}</span>
                    ),
                  },
                  { header: 'RR', cell: (r) => fmt(r.respiratoryRate) },
                  { header: 'SpO₂', cell: (r) => fmt(r.spo2, '%') },
                  { header: 'O₂', cell: (r) => (r.onOxygen ? 'Yes' : 'Air') },
                  { header: 'BP (sys)', cell: (r) => fmt(r.systolicBp) },
                  { header: 'HR', cell: (r) => fmt(r.heartRate) },
                  { header: 'Temp', cell: (r) => fmt(r.temperature, '°C') },
                  { header: 'ACVPU', cell: (r) => r.consciousness ?? '—' },
                  {
                    header: 'NEWS2',
                    cell: (r) =>
                      r.news2 ? <Badge tone={news2Tone(r.news2.risk)}>{r.news2.score}</Badge> : <span className="text-slate-400">—</span>,
                  },
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Record observations</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={submit} className="space-y-3">
              <Field label="Respiratory rate (/min)" value={form.respiratoryRate} onChange={(v) => setForm({ ...form, respiratoryRate: v })} />
              <Field label="SpO₂ (%)" value={form.spo2} onChange={(v) => setForm({ ...form, spo2: v })} />
              <Field label="Systolic BP (mmHg)" value={form.systolicBp} onChange={(v) => setForm({ ...form, systolicBp: v })} />
              <Field label="Heart rate (bpm)" value={form.heartRate} onChange={(v) => setForm({ ...form, heartRate: v })} />
              <Field label="Temperature (°C)" value={form.temperature} onChange={(v) => setForm({ ...form, temperature: v })} step="0.1" />

              <label className="block">
                <span className="text-xs font-medium text-slate-500">Consciousness (ACVPU)</span>
                <select
                  value={form.consciousness}
                  onChange={(e) => setForm({ ...form, consciousness: e.target.value as FormState['consciousness'] })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
                >
                  <option value="A">Alert</option>
                  <option value="V">Voice</option>
                  <option value="P">Pain</option>
                  <option value="U">Unresponsive</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.onOxygen}
                  onChange={(e) => setForm({ ...form, onOxygen: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-nhs-blue focus:ring-nhs-blue"
                />
                Supplemental oxygen
              </label>

              <Button type="submit" className="w-full" disabled={record.isPending}>
                {record.isPending ? 'Recording…' : 'Record & score NEWS2'}
              </Button>
              {record.isError && <p className="text-xs text-nhs-red">Could not record — check all fields are valid.</p>}
            </form>

            {result && <ScoreCard news2={result.news2} escalation={result.escalation} />}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ScoreCard({ news2, escalation }: { news2: News2; escalation: RecordResult['escalation'] }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">Computed NEWS2</span>
        <Badge tone={news2Tone(news2.risk)} className="text-base">
          {news2.score}
        </Badge>
      </div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{escalation.band} risk</div>
      <p className="mt-2 text-xs text-slate-500">{escalation.monitoring}</p>
      <p className="mt-1 text-xs text-slate-500">{escalation.response}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
      />
    </label>
  );
}

function fmt(value?: number, unit = ''): string {
  return value === undefined ? '—' : `${value}${unit}`;
}
