import { Link } from 'react-router-dom';
import { AlertTriangle, Pill } from 'lucide-react';
import { useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import { Badge, Card, DataTable, PageHeader, Spinner, Stat } from '@trustos/ui';
import { patientName, type Worklist } from './types';

export function EPrescribingWorklistPage() {
  const { data, isLoading } = useApiQuery<Worklist>('/api/eprescribing/worklist');

  const items = data?.items ?? [];
  const totalActive = items.reduce((sum, i) => sum + i.counts.active, 0);
  const totalPrn = items.reduce((sum, i) => sum + i.counts.prn, 0);
  const withAllergies = items.filter((i) => i.allergyCount > 0).length;

  return (
    <div>
      <PageHeader
        title="E-Prescribing"
        description="Inpatient drug charts across the trust. Select a patient to review and prescribe."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Patients on treatment" value={data?.total ?? 0} hint="With ≥1 active order" />
        <Stat label="Active prescriptions" value={totalActive} tone="info" />
        <Stat label="PRN orders" value={totalPrn} tone="warning" hint="As-required medicines" />
        <Stat
          label="With documented allergies"
          value={withAllergies}
          tone={withAllergies > 0 ? 'danger' : 'success'}
        />
      </div>

      {isLoading ? (
        <Spinner className="m-10" />
      ) : (
        <Card>
          <DataTable
            rows={items}
            rowKey={(r) => r.patient.id}
            empty="No patients with active prescriptions"
            columns={[
              {
                header: 'Patient',
                cell: (r) => (
                  <Link
                    to={`/eprescribing/${r.patient.id}`}
                    className="inline-flex items-center gap-2 font-medium text-nhs-blue hover:underline"
                  >
                    <Pill className="h-4 w-4" />
                    {patientName(r.patient)}
                  </Link>
                ),
              },
              {
                header: 'NHS number',
                cell: (r) => <span className="font-mono text-xs text-slate-500">{r.nhsNumber ?? '—'}</span>,
              },
              {
                header: 'Age / Sex',
                cell: (r) => `${ageFromBirthDate(r.patient.birthDate)}y · ${r.patient.gender}`,
              },
              { header: 'Regular', cell: (r) => r.counts.regular },
              {
                header: 'PRN',
                cell: (r) =>
                  r.counts.prn > 0 ? <Badge tone="warning">{r.counts.prn}</Badge> : <span className="text-slate-400">0</span>,
              },
              {
                header: 'STAT',
                cell: (r) =>
                  r.counts.stat > 0 ? <Badge tone="info">{r.counts.stat}</Badge> : <span className="text-slate-400">0</span>,
              },
              {
                header: 'Allergies',
                cell: (r) =>
                  r.allergyCount > 0 ? (
                    <Badge tone="danger" className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {r.allergyCount}
                    </Badge>
                  ) : (
                    <Badge tone="success">None</Badge>
                  ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
