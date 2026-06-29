import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { ageFromBirthDate } from '@trustos/core';
import { Badge, Button, Card, CardBody, DataTable, PageHeader, Spinner, Stat } from '@trustos/ui';
import type { BadgeTone } from '@trustos/ui';
import {
  patientName,
  prophylaxisLabel,
  type VteMetrics,
  type Worklist,
  type WorklistItem,
} from './types';

function complianceTone(pct: number): BadgeTone {
  if (pct >= 95) return 'success';
  if (pct >= 80) return 'warning';
  return 'danger';
}

export function VteWorklistPage() {
  const worklist = useApiQuery<Worklist>('/api/vte/worklist');
  const metrics = useApiQuery<VteMetrics>('/api/vte/metrics');

  const m = metrics.data;

  return (
    <div>
      <PageHeader
        title="VTE Risk Assessment"
        description="Venous thromboembolism risk assessment must be completed within 24h of admission (NICE NG89)."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="24h compliance"
          value={m ? `${m.compliancePct}%` : '—'}
          hint={m ? `${m.withinTarget} of ${m.totalAdmitted} within target` : undefined}
          tone={m ? complianceTone(m.compliancePct) : 'neutral'}
        />
        <Stat
          label="Admitted inpatients"
          value={m?.totalAdmitted ?? '—'}
          hint="Active inpatient encounters"
        />
        <Stat
          label="Assessed"
          value={m?.assessed ?? '—'}
          hint={m ? `${m.assessedPct}% of admissions` : undefined}
          tone="info"
        />
        <Stat
          label="Overdue"
          value={m?.overdue ?? '—'}
          hint=">24h since admission, not assessed"
          tone={m && m.overdue > 0 ? 'danger' : 'success'}
        />
      </div>

      {m && (
        <Card className="mb-6">
          <CardBody className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span className="font-semibold uppercase tracking-wide text-slate-500">
              Recommended prophylaxis
            </span>
            <span className="text-slate-700">
              <Badge tone="info">{m.byProphylaxis.pharmacological}</Badge> Pharmacological
            </span>
            <span className="text-slate-700">
              <Badge tone="warning">{m.byProphylaxis.mechanical}</Badge> Mechanical
            </span>
            <span className="text-slate-700">
              <Badge tone="neutral">{m.byProphylaxis.none}</Badge> None
            </span>
          </CardBody>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Compliance worklist ({worklist.data?.total ?? 0})
      </h2>

      {worklist.isLoading ? (
        <Spinner className="m-10" />
      ) : (
        <DataTable
          rows={worklist.data?.items ?? []}
          rowKey={(r) => r.encounterId}
          empty="No active inpatients to assess"
          columns={[
            {
              header: 'Patient',
              cell: (r: WorklistItem) => (
                <div>
                  <Link
                    className="font-medium text-nhs-blue hover:underline"
                    to={`/vte/${r.encounterId}`}
                  >
                    {patientName(r.patient)}
                  </Link>
                  <div className="text-xs text-slate-400">
                    {r.patient?.gender}
                    {r.patient?.birthDate ? ` · ${ageFromBirthDate(r.patient.birthDate)}y` : ''}
                    {r.patient?.identifier?.[0]?.value ? ` · ${r.patient.identifier[0].value}` : ''}
                  </div>
                </div>
              ),
            },
            { header: 'Specialty', cell: (r: WorklistItem) => r.specialty ?? '—' },
            { header: 'Reason', cell: (r: WorklistItem) => r.reason ?? '—' },
            {
              header: 'Since admission',
              cell: (r: WorklistItem) =>
                r.hoursSinceAdmission === undefined ? '—' : `${r.hoursSinceAdmission}h`,
            },
            {
              header: 'Prophylaxis',
              cell: (r: WorklistItem) =>
                r.assessment ? prophylaxisLabel(r.assessment.prophylaxisRecommended) : '—',
            },
            {
              header: 'Status',
              cell: (r: WorklistItem) =>
                r.overdue ? (
                  <Badge tone="danger">Overdue</Badge>
                ) : r.assessed ? (
                  <Badge tone="success">Assessed</Badge>
                ) : (
                  <Badge tone="warning">Pending</Badge>
                ),
            },
            {
              header: '',
              cell: (r: WorklistItem) => (
                <Link to={`/vte/${r.encounterId}`}>
                  <Button variant={r.assessed ? 'secondary' : 'primary'}>
                    {r.assessed ? 'Review' : 'Assess'}
                  </Button>
                </Link>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
