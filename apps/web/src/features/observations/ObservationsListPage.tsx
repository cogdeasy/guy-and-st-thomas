import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import type { Patient } from '@trustos/ontology';
import {
  Badge,
  Card,
  CardBody,
  DataTable,
  PageHeader,
  Spinner,
  Stat,
  news2Tone,
} from '@trustos/ui';
import type { DeterioratingRow } from './types';

interface WorklistItem {
  encounterId: string;
  patient: Patient;
  specialty?: string;
  reason?: string;
  news2?: { score: number; risk: string } | null;
}

function patientName(p?: Patient): string {
  const n = p?.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim() || 'Unknown patient';
}

export function ObservationsListPage() {
  const deteriorating = useApiQuery<{ total: number; items: DeterioratingRow[] }>(
    '/api/observations/deteriorating',
  );
  const worklist = useApiQuery<{ total: number; items: WorklistItem[] }>('/api/observations/worklist');

  const items = deteriorating.data?.items ?? [];
  const highCount = items.filter((r) => r.risk === 'high').length;

  return (
    <div>
      <PageHeader
        title="Vital Signs & NEWS2 Charting"
        description="Trust-wide deterioration surveillance and bedside vital-signs charting."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Deteriorating (NEWS2 ≥ 5)"
          value={deteriorating.isLoading ? '—' : (deteriorating.data?.total ?? 0)}
          tone={items.length ? 'warning' : 'success'}
          hint="Latest score across all inpatients"
        />
        <Stat
          label="High risk (NEWS2 ≥ 7)"
          value={deteriorating.isLoading ? '—' : highCount}
          tone={highCount ? 'danger' : 'success'}
          hint="Emergency response threshold"
        />
        <Stat
          label="Active inpatients"
          value={worklist.isLoading ? '—' : (worklist.data?.total ?? 0)}
          tone="info"
          hint="Currently admitted"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Deteriorating patients
          </h2>
          {deteriorating.isLoading ? (
            <Spinner className="m-6" />
          ) : (
            <DataTable
              rows={items}
              rowKey={(r) => r.patient.id}
              empty="No patients currently meet the deterioration threshold"
              columns={[
                {
                  header: 'Patient',
                  cell: (r) => (
                    <Link className="font-medium text-nhs-blue hover:underline" to={`/observations/${r.patient.id}`}>
                      {patientName(r.patient)}
                    </Link>
                  ),
                },
                { header: 'Specialty', cell: (r) => r.specialty ?? '—' },
                {
                  header: 'NEWS2',
                  cell: (r) => <Badge tone={news2Tone(r.risk)}>{r.news2}</Badge>,
                },
                { header: 'Escalation', cell: (r) => <span className="text-slate-600">{r.escalation.band}</span> },
                {
                  header: 'Last obs',
                  cell: (r) => <span className="text-xs text-slate-400">{new Date(r.recordedAt).toLocaleString('en-GB')}</span>,
                },
              ]}
            />
          )}
        </div>

        <Card className="lg:col-span-1">
          <CardBody>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Active inpatients
            </h2>
            {worklist.isLoading && <Spinner />}
            <div className="space-y-1">
              {(worklist.data?.items ?? []).map((it) => (
                <Link
                  key={it.encounterId}
                  to={`/observations/${it.patient.id}`}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <span>
                    <span className="font-medium text-slate-800">{patientName(it.patient)}</span>
                    <span className="block text-xs text-slate-400">{it.specialty ?? it.reason ?? '—'}</span>
                  </span>
                  {it.news2 ? (
                    <Badge tone={news2Tone(it.news2.risk)}>{it.news2.score}</Badge>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
