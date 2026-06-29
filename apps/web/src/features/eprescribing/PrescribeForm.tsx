import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@trustos/api-client';
import { useApiMutation } from '@trustos/api-client';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@trustos/ui';
import type { AllergyCheckResult, AllergyWarning, Formulary, FormularyDrug } from './types';

interface PrescribeBody {
  patientId: string;
  encounterId?: string;
  drugCode: string;
  dose: string;
  route: string;
  frequency: string;
  prn: boolean;
  courseOfTherapyType: 'acute' | 'continuous' | 'stat';
  acknowledgeAllergy: boolean;
}

interface Props {
  patientId: string;
  encounterId?: string;
  formulary?: Formulary;
}

export function PrescribeForm({ patientId, encounterId, formulary }: Props) {
  const drugs = useMemo(() => formulary?.drugs ?? [], [formulary]);
  const [drugCode, setDrugCode] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('');
  const [frequency, setFrequency] = useState('');
  const [prn, setPrn] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);

  const selected = drugs.find((d) => d.code === drugCode);

  const allergyCheck = useApiMutation<{ patientId: string; drugCode: string }, AllergyCheckResult>(
    'POST',
    () => '/api/eprescribing/allergy-check',
    [],
  );
  const prescribe = useApiMutation<PrescribeBody, unknown>('POST', () => '/api/eprescribing/prescribe');

  // Pre-fill sensible defaults whenever a drug is chosen.
  function chooseDrug(drug: FormularyDrug | undefined) {
    setDrugCode(drug?.code ?? '');
    setDose(drug?.defaultDose ?? '');
    setRoute(drug?.routes[0] ?? '');
    setFrequency(drug?.prnByDefault ? 'PRN' : (drug?.defaultFrequency ?? ''));
    setPrn(drug?.prnByDefault ?? false);
    setAcknowledge(false);
  }

  // Live allergy decision-support as soon as a drug is selected.
  const checkMutate = allergyCheck.mutate;
  useEffect(() => {
    if (drugCode) checkMutate({ patientId, drugCode });
  }, [drugCode, patientId, checkMutate]);

  const blockedBody =
    prescribe.error instanceof ApiClientError &&
    (prescribe.error.body as { code?: string } | undefined)?.code === 'allergy_contraindication'
      ? (prescribe.error.body as { warnings: AllergyWarning[] })
      : null;

  const liveWarnings = allergyCheck.data?.warnings ?? blockedBody?.warnings ?? [];
  const contraindicated = liveWarnings.some((w) => w.severity === 'contraindicated');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!drugCode || !dose || !route || !frequency) return;
    prescribe.mutate(
      {
        patientId,
        encounterId,
        drugCode,
        dose,
        route,
        frequency,
        prn,
        courseOfTherapyType: frequency === 'STAT' ? 'stat' : 'acute',
        acknowledgeAllergy: acknowledge,
      },
      {
        onSuccess: () => {
          chooseDrug(undefined);
          allergyCheck.reset();
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prescribe medication</CardTitle>
      </CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Drug">
            <select
              value={drugCode}
              onChange={(e) => {
                prescribe.reset();
                chooseDrug(drugs.find((d) => d.code === e.target.value));
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            >
              <option value="">Select from formulary…</option>
              {drugs.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.display} — {d.drugClass}
                </option>
              ))}
            </select>
          </Field>

          {liveWarnings.length > 0 && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                contraindicated
                  ? 'border-nhs-red/40 bg-red-50 text-red-800'
                  : 'border-nhs-yellow/50 bg-amber-50 text-amber-800'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                {contraindicated ? 'Allergy contraindication' : 'Allergy caution'}
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-6">
                {liveWarnings.map((w) => (
                  <li key={w.allergen}>
                    {w.message}
                    {w.reactions.length > 0 && (
                      <span className="text-xs"> (reactions: {w.reactions.join(', ')})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Dose">
              <input
                value={dose}
                onChange={(e) => setDose(e.target.value)}
                placeholder="e.g. 500 mg"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
              />
            </Field>
            <Field label="Route">
              <select
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
              >
                <option value="">Select…</option>
                {(formulary?.routes ?? selected?.routes ?? []).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Frequency">
              <select
                value={frequency}
                onChange={(e) => {
                  setFrequency(e.target.value);
                  setPrn(e.target.value === 'PRN');
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
              >
                <option value="">Select…</option>
                {(formulary?.frequencies ?? []).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <label className="flex h-full items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={prn} onChange={(e) => setPrn(e.target.checked)} />
                As required (PRN)
              </label>
            </Field>
          </div>

          {contraindicated && (
            <label className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
                className="mt-0.5"
              />
              I acknowledge the allergy contraindication and accept clinical responsibility for overriding it.
            </label>
          )}

          {prescribe.isError && !blockedBody && (
            <p className="text-sm text-nhs-red">{(prescribe.error as Error).message}</p>
          )}
          {prescribe.isSuccess && (
            <p className="flex items-center gap-1 text-sm text-nhs-green">
              <ShieldCheck className="h-4 w-4" /> Prescription added to the chart.
            </p>
          )}

          <Button
            type="submit"
            variant={contraindicated ? 'danger' : 'primary'}
            disabled={
              !drugCode ||
              !dose ||
              !route ||
              !frequency ||
              prescribe.isPending ||
              (contraindicated && !acknowledge)
            }
          >
            {contraindicated ? 'Override & prescribe' : 'Prescribe'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
