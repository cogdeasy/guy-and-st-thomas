import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApiMutation, useApiQuery, useResourceList } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import type { Patient } from '@trustos/ontology';
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
} from '@trustos/ui';
import { UtilisationBar } from './UtilisationBar';
import {
  formatDate,
  formatTime,
  pct,
  statusTone,
  STATUS_LABELS,
  type AppointmentStatus,
  type Clinic,
  type ClinicSlot,
} from './types';

type StatusAction = 'arrived' | 'seen' | 'dna' | 'cancelled';

const ACTIONS: Array<{ action: StatusAction; label: string; variant: 'primary' | 'secondary' | 'danger' }> = [
  { action: 'arrived', label: 'Arrived', variant: 'secondary' },
  { action: 'seen', label: 'Seen', variant: 'primary' },
  { action: 'dna', label: 'DNA', variant: 'secondary' },
  { action: 'cancelled', label: 'Cancel', variant: 'danger' },
];

export function ClinicDetailPage() {
  const { id } = useParams<{ id: string }>();
  const clinic = useApiQuery<Clinic>(id ? `/api/scheduling/clinics/${id}` : null);

  const book = useApiMutation<{ sessionId: string; patientId: string; slotIndex: number; reasonText?: string }>(
    'POST',
    () => '/api/scheduling/book',
  );
  const setStatus = useApiMutation<{ id: string; status: StatusAction }>(
    'POST',
    (body) => `/api/scheduling/${body.id}/status`,
  );

  const [patientId, setPatientId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (clinic.isLoading || !clinic.data) return <Spinner className="m-10" />;
  const c = clinic.data;
  const freeSlots = c.slots.filter((s) => !s.appointment);

  const onBook = (slotIndex: number) => {
    if (!patientId) {
      setError('Select a patient to book.');
      return;
    }
    setError(null);
    book.mutate(
      { sessionId: c.id, patientId, slotIndex, reasonText: reason || undefined },
      {
        onSuccess: () => {
          setReason('');
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  const onStatus = (appointmentId: string, action: StatusAction) => {
    setError(null);
    setStatus.mutate(
      { id: appointmentId, status: action },
      { onError: (e) => setError(e.message) },
    );
  };

  return (
    <div>
      <Link to="/scheduling" className="text-sm text-nhs-blue hover:underline">
        ← Back to clinics
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{c.name}</h1>
              <Badge tone="info">{c.specialty}</Badge>
            </div>
            <div className="mt-1 text-sm text-sky-200">
              {c.clinician.display} · {c.room}, {c.location.display}
            </div>
            <div className="mt-0.5 text-sm text-sky-200">
              {formatDate(c.start)} · {formatTime(c.start)}–{formatTime(c.end)} · {c.half} list
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-sky-200">Utilisation</div>
            <div className="text-2xl font-bold">{pct(c.utilisation)}</div>
            <div className="text-xs text-sky-200">
              {c.booked} booked · {c.free} free
            </div>
          </div>
        </div>
        <div className="mt-3">
          <UtilisationBar value={c.utilisation} showLabel={false} />
        </div>
      </div>

      <PageHeader title="" />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Slot list ({c.slots.length})
          </h2>
          <DataTable
            rows={c.slots}
            rowKey={(s) => String(s.index)}
            empty="No slots"
            columns={[
              { header: 'Time', className: 'w-20 font-medium text-slate-800', cell: (s) => formatTime(s.start) },
              {
                header: 'Patient',
                cell: (s) =>
                  s.appointment?.patient ? (
                    <div>
                      <div className="font-medium text-slate-800">{s.appointment.patient.name}</div>
                      <div className="text-xs text-slate-400">
                        NHS {s.appointment.patient.nhsNumber ?? '—'} ·{' '}
                        {ageFromBirthDate(s.appointment.patient.birthDate)}y
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">Free slot</span>
                  ),
              },
              {
                header: 'Status',
                className: 'w-24',
                cell: (s) =>
                  s.appointment ? (
                    <Badge tone={statusTone(s.appointment.status)}>
                      {STATUS_LABELS[s.appointment.status]}
                    </Badge>
                  ) : (
                    <span className="text-slate-300">—</span>
                  ),
              },
              {
                header: 'Actions',
                className: 'w-72',
                cell: (s) => <SlotActions slot={s} onBook={onBook} onStatus={onStatus} busy={book.isPending || setStatus.isPending} />,
              },
            ]}
          />
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Book appointment</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <PatientPicker value={patientId} onChange={setPatientId} />
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for appointment (optional)"
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
              />
              <Button
                className="w-full"
                disabled={book.isPending || freeSlots.length === 0 || !patientId}
                onClick={() => freeSlots[0] && onBook(freeSlots[0].index)}
              >
                {freeSlots.length === 0
                  ? 'Clinic fully booked'
                  : `Book into next free slot (${formatTime(freeSlots[0]!.start)})`}
              </Button>
              <p className="text-xs text-slate-400">
                Or use the “Book” button against any specific free slot in the list.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SlotActions({
  slot,
  onBook,
  onStatus,
  busy,
}: {
  slot: ClinicSlot;
  onBook: (slotIndex: number) => void;
  onStatus: (appointmentId: string, action: StatusAction) => void;
  busy: boolean;
}) {
  if (!slot.appointment) {
    return (
      <Button variant="secondary" disabled={busy} onClick={() => onBook(slot.index)}>
        Book
      </Button>
    );
  }
  const terminal: AppointmentStatus[] = ['fulfilled', 'cancelled', 'noshow'];
  if (terminal.includes(slot.appointment.status)) {
    return <span className="text-xs text-slate-400">No actions</span>;
  }
  const apptId = slot.appointment.id;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACTIONS.map((a) => (
        <button
          key={a.action}
          disabled={busy}
          onClick={() => onStatus(apptId, a.action)}
          className={`rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50 ${
            a.variant === 'primary'
              ? 'bg-nhs-blue text-white hover:bg-nhs-darkblue'
              : a.variant === 'danger'
                ? 'text-nhs-red hover:bg-red-50'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function PatientPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data, isLoading } = useResourceList('Patient');
  const options = useMemo(() => {
    const patients = (data ?? []) as Patient[];
    return [...patients].sort((a, b) =>
      (a.name?.[0]?.family ?? '').localeCompare(b.name?.[0]?.family ?? ''),
    );
  }, [data]);

  if (isLoading) return <Spinner />;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
    >
      <option value="">Select patient…</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name?.[0]?.given?.join(' ')} {p.name?.[0]?.family} · NHS{' '}
          {p.identifier?.find((i) => i.use === 'official')?.value ?? '—'}
        </option>
      ))}
    </select>
  );
}
