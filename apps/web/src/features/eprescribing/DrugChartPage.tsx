import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Clock, Pill, Repeat, Zap } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import type { MedicationRequest } from '@trustos/ontology';
import { Badge, Card, CardBody, CardHeader, CardTitle, Spinner } from '@trustos/ui';
import { PrescribeForm } from './PrescribeForm';
import { patientName, type ChartGroupKey, type DrugChart, type Formulary } from './types';

const SECTIONS: Array<{ key: ChartGroupKey; title: string; icon: typeof Repeat; hint: string }> = [
  { key: 'regular', title: 'Regular medications', icon: Repeat, hint: 'Scheduled, given routinely' },
  { key: 'prn', title: 'When required (PRN)', icon: Clock, hint: 'Given as needed' },
  { key: 'stat', title: 'Stat / immediate', icon: Zap, hint: 'Single immediate dose' },
];

export function DrugChartPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const chart = useApiQuery<DrugChart>(patientId ? `/api/eprescribing/chart/${patientId}` : null);
  const formulary = useApiQuery<Formulary>('/api/eprescribing/formulary');
  const discontinue = useApiMutation<{ id: string; reason: string }, unknown>(
    'POST',
    (b) => `/api/eprescribing/${b.id}/discontinue`,
  );

  if (chart.isLoading || !chart.data) return <Spinner className="m-10" />;

  const data = chart.data;
  const patient = data.patient;

  function onDiscontinue(med: MedicationRequest) {
    const reason = window.prompt(`Discontinue ${med.medication?.text}? Reason:`, 'Course completed');
    if (reason) discontinue.mutate({ id: med.id, reason });
  }

  return (
    <div>
      <Link to="/eprescribing" className="text-sm text-nhs-blue hover:underline">
        ← Back to E-Prescribing
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Pill className="h-6 w-6" /> {patientName(patient)}
            </h1>
            <div className="mt-1 text-sm text-sky-200">
              {ageFromBirthDate(patient.birthDate)}y · {patient.gender} · NHS {data.nhsNumber ?? 'unknown'} · DOB{' '}
              {patient.birthDate}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-sky-200">Active orders</div>
            <div className="text-2xl font-bold">{data.counts.active}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {data.allergies.length === 0 ? (
            <Badge tone="success">No known drug allergies</Badge>
          ) : (
            data.allergies.map((a) => (
              <Badge key={a.id} tone="danger" className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {a.code?.text}
                {a.criticality === 'high' ? ' (high)' : ''}
              </Badge>
            ))
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {SECTIONS.map((section) => {
            const meds = data.groups[section.key];
            const Icon = section.icon;
            return (
              <Card key={section.key}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-nhs-blue" />
                    {section.title}
                    <Badge tone="neutral">{meds.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  {meds.length === 0 ? (
                    <p className="text-sm text-slate-400">{section.hint} — none prescribed.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {meds.map((m) => (
                        <MedicationRow key={m.id} med={m} onDiscontinue={() => onDiscontinue(m)} />
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            );
          })}

          {data.history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-500">Discontinued ({data.history.length})</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1 text-sm text-slate-400">
                  {data.history.slice(0, 8).map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <span className="line-through">{m.medication?.text}</span>
                      <Badge tone="neutral">{m.status}</Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="lg:col-span-1">
          <PrescribeForm patientId={patient.id} formulary={formulary.data} />
        </div>
      </div>
    </div>
  );
}

function MedicationRow({ med, onDiscontinue }: { med: MedicationRequest; onDiscontinue: () => void }) {
  const dose = med.dosageInstruction?.[0];
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div>
        <div className="font-medium text-slate-800">{med.medication?.text}</div>
        <div className="text-sm text-slate-500">{dose?.text}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {dose?.route && <Badge tone="neutral">{dose.route}</Badge>}
          {dose?.frequency && <Badge tone="info">{dose.frequency}</Badge>}
          {med.priority === 'stat' && <Badge tone="warning">STAT</Badge>}
        </div>
      </div>
      <button
        onClick={onDiscontinue}
        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-nhs-red hover:bg-red-50"
      >
        Discontinue
      </button>
    </li>
  );
}
