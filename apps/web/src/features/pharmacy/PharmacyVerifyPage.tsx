import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, MessageCircleQuestion, PackageCheck } from 'lucide-react';
import { ApiClientError, useApiMutation, useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  Spinner,
} from '@trustos/ui';
import type { EnrichedRecord } from './types';
import {
  STATUS_LABELS,
  fullName,
  patientLine,
  pharmacistName,
  priorityTone,
  statusTone,
} from './shared';

interface ActionBody {
  note?: string;
  overrideAllergy?: boolean;
}

export function PharmacyVerifyPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<EnrichedRecord>(id ? `/api/pharmacy/${id}` : null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = useApiMutation<ActionBody, EnrichedRecord>(
    'POST',
    () => `/api/pharmacy/${id}/verify`,
  );
  const query = useApiMutation<ActionBody, EnrichedRecord>(
    'POST',
    () => `/api/pharmacy/${id}/query`,
  );
  const dispense = useApiMutation<ActionBody, EnrichedRecord>(
    'POST',
    () => `/api/pharmacy/${id}/dispense`,
  );

  if (isLoading || !data) return <Spinner className="m-10" />;

  const {
    record,
    medicationRequest,
    patient,
    prescriber,
    pharmacist,
    allergyConflicts,
    allergies,
  } = data;
  const hasConflict = allergyConflicts.length > 0;
  const busy = verify.isPending || query.isPending || dispense.isPending;

  const run = (mutation: typeof verify, body: ActionBody, requireNote = false) => {
    setError(null);
    if (requireNote && !note.trim()) {
      setError('Please add a note for the prescriber.');
      return;
    }
    mutation.mutate(
      { ...body, note: note.trim() || undefined },
      {
        onSuccess: () => setNote(''),
        onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Action failed'),
      },
    );
  };

  return (
    <div>
      <Link to="/pharmacy" className="text-sm text-nhs-blue hover:underline">
        ← Back to Pharmacy queue
      </Link>

      {/* Patient + prescription banner */}
      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{fullName(patient)}</h1>
            <div className="mt-1 text-sm text-sky-200">{patientLine(patient)}</div>
          </div>
          <div className="text-right">
            <Badge tone={statusTone(record.status)} className="text-base">
              {STATUS_LABELS[record.status]}
            </Badge>
            <div className="mt-2">
              <Badge tone={priorityTone(record.priority)}>{record.priority}</Badge>
            </div>
          </div>
        </div>
        {allergies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {allergies.map((a) => (
              <Badge key={a.id} tone="danger">
                ⚠ {a.code?.text} {a.criticality === 'high' ? '(high)' : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <PageHeader title="" />

      {hasConflict && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-nhs-red/30 bg-red-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-nhs-red" />
          <div className="text-sm text-red-800">
            <div className="font-semibold">Allergy conflict — clinical decision support alert</div>
            <p className="mt-0.5">
              This prescription conflicts with{' '}
              <span className="font-medium">
                {allergyConflicts.map((a) => a.code?.text).join(', ')}
              </span>
              . Verifying requires an explicit override with a documented rationale.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Prescription</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Field label="Medication" value={medicationRequest?.medication?.text} strong />
            <Field label="Dose & route" value={medicationRequest?.dosageInstruction?.[0]?.text} />
            <Field label="Dispense quantity" value={medicationRequest?.dispenseQuantity} />
            <Field label="Course" value={medicationRequest?.courseOfTherapyType} />
            <Field label="Prescriber" value={prescriber ? fullName(prescriber) : undefined} />
            <Field
              label="Verifying pharmacist"
              value={record.pharmacist ? pharmacistName(pharmacist) : undefined}
            />
            {record.note && <Field label="Latest note" value={record.note} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pharmacist actions</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Verification note or query to prescriber…"
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            />
            {error && <p className="text-sm text-nhs-red">{error}</p>}

            {record.status !== 'dispensed' && record.status !== 'verified' && (
              <>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => run(verify, { overrideAllergy: hasConflict })}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {hasConflict ? 'Override & verify' : 'Verify prescription'}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => run(query, {}, true)}
                >
                  <MessageCircleQuestion className="h-4 w-4" />
                  Raise query
                </Button>
              </>
            )}

            {record.status === 'verified' && (
              <Button className="w-full" disabled={busy} onClick={() => run(dispense, {})}>
                <PackageCheck className="h-4 w-4" />
                Dispense
              </Button>
            )}

            {record.status === 'dispensed' && (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                Dispensed by {pharmacistName(pharmacist)}.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Workflow history</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {record.history.length === 0 && <p className="text-sm text-slate-400">No history yet.</p>}
          {record.history
            .slice()
            .reverse()
            .map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <Badge tone={statusTone(h.status)}>{STATUS_LABELS[h.status]}</Badge>
                <span className="text-slate-500">{new Date(h.at).toLocaleString('en-GB')}</span>
                {h.note && <span className="text-slate-600">— {h.note}</span>}
              </div>
            ))}
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}>
        {value ?? '—'}
      </span>
    </div>
  );
}
