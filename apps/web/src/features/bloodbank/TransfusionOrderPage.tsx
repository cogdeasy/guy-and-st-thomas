import { Link, useParams } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import {
  COMPONENT_LABELS,
  NEXT_ACTION,
  STATUS_LABELS,
  TRANSFUSION_PATHWAY,
  patientName,
  priorityTone,
  statusTone,
  type OrderDetail,
} from './types';

export function TransfusionOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<OrderDetail>(id ? `/api/bloodbank/${id}` : null);

  const advance = useApiMutation<{ path: string }>('POST', ({ path }) => `/api/bloodbank/${id}/${path}`);

  if (isLoading || !data) return <Spinner className="m-10" />;

  const { order, patient, timeline, available } = data;
  const next = NEXT_ACTION[order.status];
  const reachedIndex = TRANSFUSION_PATHWAY.indexOf(order.status);

  return (
    <div>
      <Link to="/bloodbank" className="text-sm text-nhs-blue hover:underline">
        ← Back to Blood Bank
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {patientName(patient, order.patient.display)}
            </h1>
            <div className="mt-1 text-sm text-sky-200">
              {COMPONENT_LABELS[order.component]} · {order.units} unit
              {order.units > 1 ? 's' : ''} · Group {order.bloodGroup}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-sky-200">Status</div>
            <Badge tone={statusTone(order.status)} className="text-base">
              {STATUS_LABELS[order.status]}
            </Badge>
          </div>
        </div>
      </div>

      <PageHeader title="" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Component" value={COMPONENT_LABELS[order.component]} />
        <Stat label="Units requested" value={order.units} />
        <Stat
          label="Stock available"
          value={available}
          tone={available < order.units ? 'danger' : 'success'}
          hint={`${order.bloodGroup} ${COMPONENT_LABELS[order.component].toLowerCase()}`}
        />
        <Stat label="Priority" value={order.priority} tone={priorityTone(order.priority)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Transfusion pathway</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-3">
              {TRANSFUSION_PATHWAY.map((step, i) => {
                const event = timeline.find((t) => t.status === step);
                const done = i <= reachedIndex;
                const current = i === reachedIndex;
                return (
                  <li key={step} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        done ? 'bg-nhs-green text-white' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div>
                      <div
                        className={`text-sm font-medium ${
                          current ? 'text-nhs-blue' : done ? 'text-slate-800' : 'text-slate-400'
                        }`}
                      >
                        {STATUS_LABELS[step]}
                      </div>
                      {event && (
                        <div className="text-xs text-slate-400">
                          {new Date(event.at).toLocaleString('en-GB')}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {next && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <Button
                  disabled={advance.isPending}
                  onClick={() => advance.mutate({ path: next.path })}
                >
                  {advance.isPending ? 'Working…' : `${next.label} this order`}
                </Button>
                {advance.isError && (
                  <p className="mt-2 text-sm text-nhs-red">{(advance.error as Error).message}</p>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Order detail</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Detail label="Indication" value={order.indication} />
            <Detail label="Blood group" value={order.bloodGroup} />
            <Detail label="Group & Save" value={order.groupAndSave ? 'Valid sample' : 'Not done'} />
            <Detail label="Requested" value={new Date(order.requestedAt).toLocaleString('en-GB')} />
            {order.crossmatchedAt && (
              <Detail
                label="Crossmatched"
                value={new Date(order.crossmatchedAt).toLocaleString('en-GB')}
              />
            )}
            {order.issuedAt && (
              <Detail label="Issued" value={new Date(order.issuedAt).toLocaleString('en-GB')} />
            )}
            {order.transfusedAt && (
              <Detail
                label="Transfused"
                value={new Date(order.transfusedAt).toLocaleString('en-GB')}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}
