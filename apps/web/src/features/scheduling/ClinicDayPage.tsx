import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
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
import { UtilisationBar } from './UtilisationBar';
import {
  formatDate,
  formatTime,
  pct,
  statusTone,
  STATUS_LABELS,
  utilisationTone,
  type AppointmentStatus,
  type Clinic,
  type ClinicsResponse,
  type MetricsResponse,
} from './types';

type Range = 'today' | 'week' | 'all';

const RANGES: Array<{ key: Range; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'all', label: 'All clinics' },
];

export function ClinicDayPage() {
  const [range, setRange] = useState<Range>('today');
  const clinics = useApiQuery<ClinicsResponse>(`/api/scheduling/clinics?range=${range}`);
  const metrics = useApiQuery<MetricsResponse>(`/api/scheduling/metrics?range=${range}`);

  const totals = clinics.data?.totals;
  const m = metrics.data;

  return (
    <div>
      <PageHeader
        title="Outpatient Appointments & Clinics"
        description="Live clinic day view, slot booking and DNA / utilisation analytics across GSTT outpatient services."
        actions={
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  range === r.key ? 'bg-nhs-blue text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Clinic sessions" value={totals?.sessions ?? '—'} hint={`${totals?.specialties.length ?? 0} specialties`} />
        <Stat
          label="Slot utilisation"
          value={totals ? pct(totals.utilisation) : '—'}
          hint={totals ? `${totals.booked} / ${totals.capacity} slots booked` : undefined}
          tone={totals ? utilisationTone(totals.utilisation) : 'neutral'}
        />
        <Stat
          label="DNA rate"
          value={m ? pct(m.dnaRate) : '—'}
          hint={m ? `${m.dnaCount} did-not-attend of ${m.attended + m.dnaCount} attended slots` : undefined}
          tone={m && m.dnaRate > 0.1 ? 'danger' : 'success'}
        />
        <Stat
          label="Free capacity"
          value={totals?.free ?? '—'}
          hint="bookable slots remaining"
          tone="info"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Clinic sessions
          </h2>
          {clinics.isLoading ? (
            <Spinner className="m-10" />
          ) : (
            <div className="space-y-3">
              {(clinics.data?.clinics ?? []).map((c) => (
                <ClinicCard key={c.id} clinic={c} />
              ))}
              {clinics.data?.clinics.length === 0 && (
                <Card>
                  <CardBody>
                    <p className="text-sm text-slate-400">No clinics scheduled for this period.</p>
                  </CardBody>
                </Card>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Utilisation by specialty</CardTitle>
            </CardHeader>
            <CardBody>
              <DataTable
                rows={clinics.data?.bySpecialty ?? []}
                rowKey={(r) => r.specialty}
                empty="No data"
                columns={[
                  { header: 'Specialty', cell: (r) => <span className="font-medium text-slate-800">{r.specialty}</span> },
                  {
                    header: 'Utilisation',
                    className: 'w-40',
                    cell: (r) => <UtilisationBar value={r.utilisation} />,
                  },
                ]}
              />
            </CardBody>
          </Card>

          {m && (
            <Card>
              <CardHeader>
                <CardTitle>Attendance breakdown</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                {(Object.keys(STATUS_LABELS) as AppointmentStatus[])
                  .filter((s) => (m.byStatus[s] ?? 0) > 0)
                  .map((s) => (
                    <div key={s} className="flex items-center justify-between text-sm">
                      <Badge tone={statusTone(s)}>{STATUS_LABELS[s]}</Badge>
                      <span className="font-semibold text-slate-700">{m.byStatus[s]}</span>
                    </div>
                  ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ClinicCard({ clinic }: { clinic: Clinic }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">{clinic.name}</h3>
              <Badge tone="info">{clinic.specialty}</Badge>
              <Badge tone="neutral">{clinic.half}</Badge>
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {clinic.clinician.display} · {clinic.room}, {clinic.location.display}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {formatDate(clinic.start)} · {formatTime(clinic.start)}–{formatTime(clinic.end)}
            </div>
          </div>
          <Link to={`/scheduling/clinics/${clinic.id}`}>
            <Button variant="secondary">Open clinic</Button>
          </Link>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>
              {clinic.booked} booked · {clinic.free} free
            </span>
            <span>{clinic.capacity} slots</span>
          </div>
          <UtilisationBar value={clinic.utilisation} showLabel={false} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(STATUS_LABELS) as AppointmentStatus[])
            .filter((s) => (clinic.statusCounts[s] ?? 0) > 0)
            .map((s) => (
              <Badge key={s} tone={statusTone(s)}>
                {clinic.statusCounts[s]} {STATUS_LABELS[s]}
              </Badge>
            ))}
        </div>
      </CardBody>
    </Card>
  );
}
