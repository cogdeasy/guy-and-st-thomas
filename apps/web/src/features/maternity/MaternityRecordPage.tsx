import { Link, useParams } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import type { Patient } from '@trustos/ontology';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@trustos/ui';
import { DELIVERY_MODE_LABELS, type BirthRecord, type Episode } from './types';

interface MaternityRecord {
  patient: Patient;
  age: number;
  episodes: Episode[];
  births: BirthRecord[];
}

const statusTone = { antenatal: 'info', intrapartum: 'warning', postnatal: 'success' } as const;

export function MaternityRecordPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { data, isLoading } = useApiQuery<MaternityRecord>(
    patientId ? `/api/maternity/${patientId}/record` : null,
  );

  if (isLoading || !data) return <Spinner className="m-10" />;

  const name = data.patient.name?.[0];
  const fullName = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
  const birthByEpisode = new Map(data.births.map((b) => [b.episode.split('/')[1], b]));

  return (
    <div>
      <Link to="/maternity" className="text-sm text-nhs-blue hover:underline">
        ← Back to Maternity & Obstetrics
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <h1 className="text-2xl font-bold">{fullName}</h1>
        <div className="mt-1 text-sm text-sky-200">
          {data.age}y · {data.patient.gender} · DOB {data.patient.birthDate}
        </div>
      </div>

      <PageHeader title="" />

      {data.episodes.length === 0 ? (
        <EmptyState title="No maternity episodes" description="This patient has no recorded pregnancies." />
      ) : (
        <div className="space-y-6">
          {data.episodes.map((e) => {
            const birth = birthByEpisode.get(e.id);
            return (
              <Card key={e.id}>
                <CardHeader className="flex items-center justify-between">
                  <CardTitle>Pregnancy episode</CardTitle>
                  <Badge tone={statusTone[e.status]}>{e.status}</Badge>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
                    <Field label="Gestation" value={`${e.gestationWeeks} wks (T${e.trimester})`} />
                    <Field label="EDD" value={e.edd.slice(0, 10)} />
                    <Field label="Gravida / Parity" value={`G${e.gravida ?? '—'} P${e.parity}`} />
                    <Field label="Named midwife" value={e.midwifeName ?? '—'} />
                  </div>

                  <div className="mt-4">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Risk factors
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {e.riskFactors.length === 0 ? (
                        <Badge tone="success">No risk factors</Badge>
                      ) : (
                        e.riskFactors.map((r) => (
                          <Badge key={r} tone="warning">
                            {r}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>

                  {birth && (
                    <div className="mt-4 rounded-lg bg-slate-50 p-4">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Birth outcome
                      </span>
                      <div className="mt-2 grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
                        <Field
                          label="Delivered"
                          value={new Date(birth.deliveryDateTime).toLocaleString('en-GB')}
                        />
                        <Field label="Mode" value={DELIVERY_MODE_LABELS[birth.mode] ?? birth.mode} />
                        <Field label="Birth weight" value={`${birth.babyWeightGrams} g`} />
                        <Field label="Apgar (1/5)" value={`${birth.apgar1} / ${birth.apgar5}`} />
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-medium text-slate-800">{value}</div>
    </div>
  );
}
