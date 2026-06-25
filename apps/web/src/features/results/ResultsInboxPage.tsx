import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { Badge, Button, Card, CardBody, DataTable, PageHeader, Spinner, Stat } from '@trustos/ui';
import { flagLabel, flagTone, formatDateTime } from './tone';

interface InboxItem {
  reportId: string;
  code?: string;
  category?: string;
  status: string;
  issued?: string;
  patient: { id: string; name: string } | null;
  performer?: string;
  resultCount: number;
  abnormalCount: number;
  criticalCount: number;
  worstInterpretation: string;
  abnormal: boolean;
  acknowledged: boolean;
}

interface Stats {
  total: number;
  unacknowledged: number;
  abnormal: number;
  critical: number;
}

export function ResultsInboxPage() {
  const [includeAcknowledged, setIncludeAcknowledged] = useState(false);
  const stats = useApiQuery<Stats>('/api/results/stats');
  const inbox = useApiQuery<{ total: number; items: InboxItem[] }>(
    `/api/results/inbox?includeAcknowledged=${includeAcknowledged}`,
  );

  return (
    <div>
      <PageHeader
        title="Results & Reporting"
        description="Diagnostic results awaiting acknowledgement, with abnormal and critical findings highlighted."
        actions={
          <Button
            variant={includeAcknowledged ? 'secondary' : 'primary'}
            onClick={() => setIncludeAcknowledged((v) => !v)}
          >
            {includeAcknowledged ? 'Showing all results' : 'Unacknowledged only'}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total results" value={stats.data?.total ?? '—'} />
        <Stat label="Awaiting sign-off" value={stats.data?.unacknowledged ?? '—'} tone="info" />
        <Stat label="Abnormal" value={stats.data?.abnormal ?? '—'} tone="warning" />
        <Stat label="Critical" value={stats.data?.critical ?? '—'} tone="danger" />
      </div>

      <Card>
        <CardBody>
          {inbox.isLoading ? (
            <Spinner className="m-6" />
          ) : (
            <DataTable
              rows={inbox.data?.items ?? []}
              rowKey={(r) => r.reportId}
              empty={
                includeAcknowledged ? 'No results found' : 'No results awaiting acknowledgement'
              }
              columns={[
                {
                  header: 'Patient',
                  cell: (r) =>
                    r.patient ? (
                      <Link
                        className="font-medium text-nhs-blue hover:underline"
                        to={`/results/${r.reportId}`}
                      >
                        {r.patient.name}
                      </Link>
                    ) : (
                      <span className="text-slate-400">Unknown</span>
                    ),
                },
                {
                  header: 'Investigation',
                  cell: (r) => (
                    <div>
                      <div className="font-medium text-slate-800">{r.code ?? '—'}</div>
                      {r.performer && <div className="text-xs text-slate-400">{r.performer}</div>}
                    </div>
                  ),
                },
                {
                  header: 'Type',
                  cell: (r) => <Badge tone="neutral">{r.category ?? '—'}</Badge>,
                },
                {
                  header: 'Flag',
                  cell: (r) => (
                    <div className="flex items-center gap-2">
                      <Badge tone={flagTone(r.worstInterpretation)}>
                        {flagLabel(r.worstInterpretation)}
                      </Badge>
                      {r.abnormalCount > 0 && (
                        <span className="text-xs text-slate-400">
                          {r.abnormalCount}/{r.resultCount} out of range
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  header: 'Issued',
                  cell: (r) => <span className="text-slate-600">{formatDateTime(r.issued)}</span>,
                },
                {
                  header: 'Status',
                  cell: (r) =>
                    r.acknowledged ? (
                      <Badge tone="success">Acknowledged</Badge>
                    ) : (
                      <Badge tone="info">Awaiting</Badge>
                    ),
                },
                {
                  header: '',
                  cell: (r) => (
                    <Link
                      to={`/results/${r.reportId}`}
                      className="text-sm font-medium text-nhs-blue hover:underline"
                    >
                      Review →
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
