import { Link, useParams } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import type {
  AllergyIntolerance,
  Condition,
  Encounter,
  Patient,
} from '@trustos/ontology';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  Spinner,
  news2Tone,
} from '@trustos/ui';

interface Summary {
  patient: Patient;
  age: number;
  nhsNumber?: string;
  problems: Condition[];
  allergies: AllergyIntolerance[];
  encounters: Encounter[];
  vitals: {
    heartRate?: number;
    respiratoryRate?: number;
    spo2?: number;
    temperature?: number;
    systolicBp?: number;
    recordedAt?: string;
  };
  news2?: { score: number; risk: string; recommendation: string } | null;
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<Summary>(id ? `/api/patients/${id}/summary` : null);

  if (isLoading || !data) return <Spinner className="m-10" />;

  const name = data.patient.name?.[0];
  const fullName = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`;

  return (
    <div>
      <Link to="/patients" className="text-sm text-nhs-blue hover:underline">
        ← Back to Patient Administration
      </Link>

      {/* EPR banner */}
      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{fullName}</h1>
            <div className="mt-1 text-sm text-sky-200">
              {data.age}y · {data.patient.gender} · NHS {data.nhsNumber ?? 'unknown'} · DOB{' '}
              {data.patient.birthDate}
            </div>
          </div>
          {data.news2 && (
            <div className="text-right">
              <div className="text-xs text-sky-200">NEWS2</div>
              <Badge tone={news2Tone(data.news2.risk)} className="text-base">
                {data.news2.score}
              </Badge>
            </div>
          )}
        </div>
        {data.allergies.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.allergies.map((a) => (
              <Badge key={a.id} tone="danger">
                ⚠ {a.code?.text} {a.criticality === 'high' ? '(high)' : ''}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <PageHeader title="" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Problems</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {data.problems.length === 0 && <p className="text-sm text-slate-400">No active problems.</p>}
            {data.problems.map((c) => (
              <div key={c.id} className="text-sm text-slate-700">
                {c.code?.text}
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest observations</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1 text-sm text-slate-700">
            <Vital label="Heart rate" value={data.vitals.heartRate} unit="bpm" />
            <Vital label="Resp rate" value={data.vitals.respiratoryRate} unit="/min" />
            <Vital label="SpO₂" value={data.vitals.spo2} unit="%" />
            <Vital label="Temperature" value={data.vitals.temperature} unit="°C" />
            <Vital label="Systolic BP" value={data.vitals.systolicBp} unit="mmHg" />
            {data.news2 && (
              <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                {data.news2.recommendation}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Encounters</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {data.encounters.slice(0, 6).map((e) => (
              <div key={e.id} className="text-sm">
                <span className="font-medium text-slate-800">{e.class}</span>{' '}
                <Badge tone={e.status === 'in-progress' ? 'info' : 'neutral'}>{e.status}</Badge>
                <div className="text-xs text-slate-400">
                  {e.specialty} · {e.period?.start?.slice(0, 10)}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Vital({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value !== undefined ? `${value} ${unit}` : '—'}</span>
    </div>
  );
}
