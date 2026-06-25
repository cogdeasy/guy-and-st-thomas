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
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import type { Worklist, WorklistItem, WeightLossRisk } from './types';
import { mustTone, patientName } from './types';

export function NutritionWorklistPage() {
  const { data, isLoading, refetch } = useApiQuery<Worklist>('/api/nutrition/worklist');
  const [screening, setScreening] = useState<WorklistItem | null>(null);

  return (
    <div>
      <PageHeader
        title="Dietetics & Nutrition"
        description="MUST malnutrition screening, dietitian referral and 24-hour fluid balance for admitted patients."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Admitted patients" value={data?.total ?? '—'} />
        <Stat label="High nutrition risk" value={data?.atRisk ?? '—'} tone="danger" hint="MUST ≥ 2" />
        <Stat label="Awaiting screen" value={data?.awaitingScreen ?? '—'} tone="warning" />
        <Stat
          label="Dietitian referrals"
          value={data?.items.filter((i) => i.referralToDietitian).length ?? '—'}
          tone="info"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nutrition risk worklist</CardTitle>
        </CardHeader>
        <CardBody>
          {isLoading ? (
            <Spinner className="m-6" />
          ) : (
            <DataTable
              rows={data?.items ?? []}
              rowKey={(r) => r.encounterId}
              empty="No admitted patients"
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <Link
                      className="font-medium text-nhs-blue hover:underline"
                      to={`/nutrition/${r.patient?.id ?? ''}`}
                    >
                      {patientName(r.patient)}
                    </Link>
                  ),
                },
                { header: 'Specialty', cell: (r) => r.specialty ?? '—' },
                {
                  header: 'BMI',
                  cell: (r) => (r.screen ? r.screen.bmi.toFixed(1) : <span className="text-slate-400">—</span>),
                },
                {
                  header: 'Weight loss',
                  cell: (r) =>
                    r.screen ? (
                      <span className="capitalize">{r.screen.weightLossRisk}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    ),
                },
                {
                  header: 'MUST',
                  cell: (r) =>
                    r.mustScore !== null ? (
                      <Badge tone={mustTone(r.risk)}>
                        {r.mustScore} · {r.risk}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">unscreened</Badge>
                    ),
                },
                {
                  header: 'Dietitian',
                  cell: (r) =>
                    r.referralToDietitian ? (
                      <Badge tone="info">referred</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    ),
                },
                {
                  header: '',
                  cell: (r) => (
                    <Button variant="secondary" onClick={() => setScreening(r)}>
                      Screen
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>

      {screening && (
        <ScreenDialog
          item={screening}
          onClose={() => setScreening(null)}
          onSaved={() => {
            setScreening(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}

function ScreenDialog({
  item,
  onClose,
  onSaved,
}: {
  item: WorklistItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bmi, setBmi] = useState(item.screen ? String(item.screen.bmi) : '22');
  const [weightLossRisk, setWeightLossRisk] = useState<WeightLossRisk>(
    item.screen?.weightLossRisk ?? 'low',
  );
  const [acutelyIllNoIntake, setAcutelyIllNoIntake] = useState(false);

  const mutation = useApiMutation<Record<string, unknown>>('POST', () => '/api/nutrition/screen');

  const submit = () => {
    mutation.mutate(
      {
        patientId: item.patient?.id,
        encounterId: item.encounterId,
        bmi: Number(bmi),
        weightLossRisk,
        acutelyIllNoIntake,
      },
      { onSuccess: onSaved },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>MUST screening · {patientName(item.patient)}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="BMI (kg/m²)">
            <input
              type="number"
              step="0.1"
              value={bmi}
              onChange={(e) => setBmi(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">≥20 = 0 · 18.5–20 = 1 · &lt;18.5 = 2</p>
          </Field>

          <Field label="Unplanned weight loss (3–6 months)">
            <select
              value={weightLossRisk}
              onChange={(e) => setWeightLossRisk(e.target.value as WeightLossRisk)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              <option value="low">&lt;5% (0)</option>
              <option value="medium">5–10% (1)</option>
              <option value="high">&gt;10% (2)</option>
            </select>
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={acutelyIllNoIntake}
              onChange={(e) => setAcutelyIllNoIntake(e.target.checked)}
            />
            Acutely ill and no nutritional intake &gt; 5 days (2)
          </label>

          {mutation.isError && (
            <p className="text-sm text-nhs-red">Could not save screening. Please try again.</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save screening'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}
