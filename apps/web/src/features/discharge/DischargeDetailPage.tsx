import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Spinner,
} from '@trustos/ui';
import { ChecklistCard } from './components';
import {
  STATUS_LABELS,
  patientName,
  statusTone,
  type Checklist,
  type DischargeDetail,
  type DischargeStatus,
  type TtoMed,
} from './types';

interface FormState {
  diagnosis: string;
  followUp: string;
  gpLetterGenerated: boolean;
  ttoMeds: TtoMed[];
  status: DischargeStatus;
}

const EMPTY_TTO: TtoMed = { medication: '', dose: '', route: 'Oral', frequency: '', quantity: '' };

function liveChecklist(form: FormState): Checklist {
  const items = [
    { key: 'diagnosis', label: 'Discharge diagnosis documented', done: form.diagnosis.trim().length > 0 },
    { key: 'tto', label: 'TTO medications reconciled', done: form.ttoMeds.some((m) => m.medication.trim()) },
    { key: 'followUp', label: 'Follow-up arranged', done: form.followUp.trim().length > 0 },
    { key: 'gpLetter', label: 'GP discharge letter generated', done: form.gpLetterGenerated },
  ];
  const complete = items.filter((i) => i.done).length;
  return { items, complete, total: items.length, ready: complete === items.length };
}

export function DischargeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<DischargeDetail>(id ? `/api/discharge/${id}` : null);

  const save = useApiMutation<Partial<FormState>>('PUT', () => `/api/discharge/${id}`);
  const complete = useApiMutation('POST', () => `/api/discharge/${id}/complete`);

  const [form, setForm] = useState<FormState | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    if (data && data.summary.id !== loadedId) {
      setForm({
        diagnosis: data.summary.diagnosis,
        followUp: data.summary.followUp,
        gpLetterGenerated: data.summary.gpLetterGenerated,
        ttoMeds: data.summary.ttoMeds.length ? data.summary.ttoMeds : [],
        status: data.summary.status,
      });
      setLoadedId(data.summary.id);
    }
  }, [data, loadedId]);

  if (isLoading || !data || !form) return <Spinner className="m-10" />;

  const readOnly = form.status === 'completed';
  const checklist = liveChecklist(form);
  const patient = data.patient;

  const update = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const updateTto = (index: number, patch: Partial<TtoMed>) =>
    setForm((f) =>
      f ? { ...f, ttoMeds: f.ttoMeds.map((m, i) => (i === index ? { ...m, ...patch } : m)) } : f,
    );

  const onSave = async (status?: DischargeStatus) => {
    const next: FormState = {
      ...form,
      ttoMeds: form.ttoMeds.filter((m) => m.medication.trim()),
      status: status ?? form.status,
    };
    setForm(next);
    await save.mutateAsync(next);
    return next;
  };

  // Persist the current form before completing so the backend validates the
  // checklist against the edits the clinician can see on screen.
  const onComplete = async () => {
    await onSave();
    await complete.mutateAsync(undefined);
  };

  return (
    <div>
      <Link to="/discharge" className="text-sm text-nhs-blue hover:underline">
        ← Back to Discharge worklist
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{patientName(patient)}</h1>
            <div className="mt-1 text-sm text-sky-200">
              {patient?.birthDate ? `${ageFromBirthDate(patient.birthDate)}y · ` : ''}
              {patient?.gender ?? 'unknown'} · NHS{' '}
              {patient?.identifier?.find((i) => i.use === 'official')?.value ?? 'unknown'}
              {data.encounter?.specialty ? ` · ${data.encounter.specialty}` : ''}
            </div>
          </div>
          <Badge tone={statusTone(form.status)} className="text-sm">
            {STATUS_LABELS[form.status]}
          </Badge>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Discharge summary</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <Field label="Primary diagnosis">
                <textarea
                  value={form.diagnosis}
                  disabled={readOnly}
                  onChange={(e) => update({ diagnosis: e.target.value })}
                  rows={2}
                  placeholder="e.g. Community-acquired pneumonia, resolving"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none disabled:bg-slate-50"
                />
              </Field>

              <Field label="Follow-up arrangements">
                <textarea
                  value={form.followUp}
                  disabled={readOnly}
                  onChange={(e) => update({ followUp: e.target.value })}
                  rows={2}
                  placeholder="e.g. Cardiology outpatient clinic in 6 weeks"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none disabled:bg-slate-50"
                />
              </Field>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.gpLetterGenerated}
                  disabled={readOnly}
                  onChange={(e) => update({ gpLetterGenerated: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-nhs-blue focus:ring-nhs-blue"
                />
                GP discharge letter generated
              </label>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>To-take-out (TTO) medications</CardTitle>
              {!readOnly && (
                <Button
                  variant="secondary"
                  onClick={() => update({ ttoMeds: [...form.ttoMeds, { ...EMPTY_TTO }] })}
                >
                  <Plus size={15} /> Add medicine
                </Button>
              )}
            </CardHeader>
            <CardBody className="space-y-3">
              {form.ttoMeds.length === 0 && (
                <p className="text-sm text-slate-400">No TTO medications added yet.</p>
              )}
              {form.ttoMeds.map((med, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <TtoInput
                      placeholder="Medication"
                      value={med.medication}
                      disabled={readOnly}
                      onChange={(v) => updateTto(i, { medication: v })}
                      className="md:col-span-2"
                    />
                    <TtoInput placeholder="Dose" value={med.dose} disabled={readOnly} onChange={(v) => updateTto(i, { dose: v })} />
                    <TtoInput placeholder="Route" value={med.route ?? ''} disabled={readOnly} onChange={(v) => updateTto(i, { route: v })} />
                    <TtoInput placeholder="Frequency" value={med.frequency} disabled={readOnly} onChange={(v) => updateTto(i, { frequency: v })} />
                    <TtoInput placeholder="Quantity to dispense" value={med.quantity ?? ''} disabled={readOnly} onChange={(v) => updateTto(i, { quantity: v })} />
                  </div>
                  {!readOnly && (
                    <button
                      onClick={() => update({ ttoMeds: form.ttoMeds.filter((_, idx) => idx !== i) })}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-nhs-red hover:underline"
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Readiness checklist</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <ChecklistCard checklist={checklist} />
              <div
                className={`rounded-lg p-3 text-sm font-medium ${
                  checklist.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {checklist.ready
                  ? 'All checks complete — ready to discharge.'
                  : `${checklist.total - checklist.complete} item(s) outstanding before discharge.`}
              </div>
            </CardBody>
          </Card>

          {!readOnly && (
            <Card>
              <CardBody className="space-y-3">
                <Button className="w-full" onClick={() => onSave()} disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </Button>
                {form.status === 'draft' && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => onSave('pending-pharmacy')}
                    disabled={save.isPending}
                  >
                    Send to pharmacy
                  </Button>
                )}
                <Button
                  variant="primary"
                  className="w-full bg-nhs-green hover:bg-nhs-green/90"
                  disabled={!checklist.ready || save.isPending || complete.isPending}
                  onClick={onComplete}
                >
                  {complete.isPending ? 'Completing…' : 'Complete discharge'}
                </Button>
                {complete.isError && (
                  <p className="text-xs text-nhs-red">{(complete.error as Error).message}</p>
                )}
                <p className="text-xs text-slate-400">
                  Completing finishes the inpatient encounter and locks this summary.
                </p>
              </CardBody>
            </Card>
          )}

          {readOnly && (
            <Card>
              <CardBody className="text-sm text-slate-500">
                This discharge is complete and the encounter has been finished.
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function TtoInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none disabled:bg-slate-50 ${className ?? ''}`}
    />
  );
}
