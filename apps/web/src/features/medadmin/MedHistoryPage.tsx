import { Link, useParams } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import { type HistoryResponse, formatDateTime } from './types';

export function MedHistoryPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const { data, isLoading } = useApiQuery<HistoryResponse>(
    patientId ? `/api/medadmin/history/${patientId}` : null,
  );

  if (isLoading || !data) return <Spinner className="m-10" />;

  return (
    <div>
      <Link to="/medadmin" className="text-sm text-nhs-blue hover:underline">
        ← Back to drug round
      </Link>

      <PageHeader
        title={data.patient.name}
        description={`Medication administration history${
          data.patient.nhsNumber ? ` · NHS ${data.patient.nhsNumber}` : ''
        }`}
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total events" value={data.total} />
        <Stat label="Given" value={data.given} tone="success" />
        <Stat label="Omitted" value={data.omitted} tone="warning" />
        <Stat label="Active orders" value={data.activeOrders.length} tone="info" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Active prescriptions</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {data.activeOrders.length === 0 && (
              <p className="text-sm text-slate-400">No active prescriptions.</p>
            )}
            {data.activeOrders.map((o) => (
              <div key={o.id} className="rounded-lg border border-slate-100 p-3">
                <div className="text-sm font-medium text-slate-800">{o.medication}</div>
                <div className="text-xs text-slate-400">
                  {[o.dose, o.route, o.frequency].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Administration timeline</CardTitle>
          </CardHeader>
          <CardBody>
            {data.events.length === 0 ? (
              <EmptyState title="No administrations recorded" />
            ) : (
              <ol className="space-y-3">
                {data.events.map((e) => {
                  const given = e.status === 'completed';
                  return (
                    <li key={e.id} className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          given ? 'bg-nhs-green' : 'bg-nhs-red'
                        }`}
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-800">{e.medication}</span>
                          <Badge tone={given ? 'success' : 'danger'}>
                            {given ? 'Given' : 'Omitted'}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-400">
                          {formatDateTime(e.effectiveDateTime)}
                          {e.performer ? ` · ${e.performer}` : ''}
                        </div>
                        {e.notGivenReason && (
                          <div className="mt-0.5 text-xs text-amber-700">{e.notGivenReason}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
