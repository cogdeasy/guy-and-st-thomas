import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import type { Patient } from '@trustos/ontology';
import { Badge, Card, CardBody, DataTable, PageHeader, Spinner, news2Tone } from '@trustos/ui';

interface WorklistItem {
  encounterId: string;
  patient: Patient;
  specialty?: string;
  reason?: string;
  news2?: { score: number; risk: string } | null;
}

export function PatientListPage() {
  const [q, setQ] = useState('');
  const search = useApiQuery<{ patients: Patient[] }>(`/api/patients/search?q=${encodeURIComponent(q)}`);
  const worklist = useApiQuery<{ total: number; items: WorklistItem[] }>('/api/patients/worklist');

  return (
    <div>
      <PageHeader
        title="Patient Administration"
        description="Master patient index, active inpatient worklist and registration."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardBody>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / NHS number / MRN"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-nhs-blue focus:outline-none"
            />
            <div className="mt-3 space-y-1">
              {search.isLoading && <Spinner />}
              {(search.data?.patients ?? []).slice(0, 12).map((p) => (
                <Link
                  key={p.id}
                  to={`/patients/${p.id}`}
                  className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <div className="font-medium text-slate-800">
                    {p.name?.[0]?.given?.join(' ')} {p.name?.[0]?.family}
                  </div>
                  <div className="text-xs text-slate-400">
                    {p.gender} · {ageFromBirthDate(p.birthDate)}y ·{' '}
                    {p.identifier?.[0]?.value}
                  </div>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>

        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Active inpatients ({worklist.data?.total ?? 0})
          </h2>
          <DataTable
            rows={worklist.data?.items ?? []}
            rowKey={(r) => r.encounterId}
            empty="No active inpatients"
            columns={[
              {
                header: 'Patient',
                cell: (r) => (
                  <Link className="font-medium text-nhs-blue hover:underline" to={`/patients/${r.patient?.id}`}>
                    {r.patient?.name?.[0]?.given?.join(' ')} {r.patient?.name?.[0]?.family}
                  </Link>
                ),
              },
              { header: 'Specialty', cell: (r) => r.specialty ?? '—' },
              { header: 'Reason', cell: (r) => r.reason ?? '—' },
              {
                header: 'NEWS2',
                cell: (r) =>
                  r.news2 ? (
                    <Badge tone={news2Tone(r.news2.risk)}>{r.news2.score}</Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
