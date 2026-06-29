import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import {
  formatAge,
  priorityTone,
  statusTone,
  type OrderRow,
  type OrderStatus,
  type WorklistResponse,
} from './types';

export function OrdersWorklistPage() {
  const { data, isLoading } = useApiQuery<WorklistResponse>('/api/orders/worklist');
  const transition = useApiMutation<{ id: string; status: OrderStatus }>(
    'POST',
    (vars) => `/api/orders/${vars.id}/status`,
  );

  const advance = (order: OrderRow, status: OrderStatus) => {
    transition.mutate({ id: order.id, status });
  };

  return (
    <div>
      <PageHeader
        title="Diagnostic & Procedure Orders"
        description="Clinical order entry (CPOE) and the live outstanding-orders worklist."
        actions={
          <Link to="/orders/new">
            <Button>
              <Plus className="h-4 w-4" /> New order
            </Button>
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Outstanding" value={data?.total ?? 0} hint="Awaiting collection or result" />
        <Stat label="Requested" value={data?.summary.requested ?? 0} tone="info" hint="Not yet actioned" />
        <Stat label="In progress" value={data?.summary.inProgress ?? 0} tone="warning" hint="Collected / booked" />
        <Stat
          label="Urgent / overdue"
          value={`${data?.summary.urgent ?? 0} / ${data?.summary.overdue ?? 0}`}
          tone="danger"
          hint="Priority orders · past turnaround"
        />
      </div>

      {isLoading && <Spinner className="m-10" />}

      {!isLoading && (data?.total ?? 0) === 0 && (
        <EmptyState
          title="No outstanding orders"
          description="Every order has been resulted. Place a new order to populate the worklist."
        />
      )}

      <div className="space-y-6">
        {data?.groups.map((group) => (
          <Card key={group.key}>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>{group.label}</CardTitle>
              <Badge tone="neutral">{group.orders.length}</Badge>
            </CardHeader>
            <CardBody className="p-0">
              <DataTable
                rows={group.orders}
                rowKey={(r) => r.id}
                empty="No outstanding orders in this category"
                columns={[
                  {
                    header: 'Order',
                    cell: (r) => (
                      <div>
                        <div className="font-medium text-slate-800">{r.display}</div>
                        <div className="text-xs text-slate-400">
                          {r.specimen ?? r.modality ?? r.code}
                          {r.reasonText ? ` · ${r.reasonText}` : ''}
                        </div>
                      </div>
                    ),
                  },
                  {
                    header: 'Patient',
                    cell: (r) =>
                      r.patient ? (
                        <Link className="text-nhs-blue hover:underline" to={`/patients/${r.patient.id}`}>
                          {r.patient.name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      ),
                  },
                  {
                    header: 'Priority',
                    cell: (r) => (
                      <Badge tone={priorityTone(r.priority)} className="uppercase">
                        {r.priority}
                      </Badge>
                    ),
                  },
                  {
                    header: 'Status',
                    cell: (r) => (
                      <div className="flex items-center gap-2">
                        <Badge tone={statusTone(r.status)}>{r.statusLabel}</Badge>
                        {r.overdue && <Badge tone="danger">Overdue</Badge>}
                      </div>
                    ),
                  },
                  {
                    header: 'Age',
                    cell: (r) => <span className="text-slate-500">{formatAge(r.ageHours)}</span>,
                  },
                  {
                    header: 'Actions',
                    className: 'text-right',
                    cell: (r) => (
                      <div className="flex justify-end gap-2">
                        {r.nextStatuses.map((next) => (
                          <Button
                            key={next.status}
                            variant={next.status === 'revoked' ? 'ghost' : 'secondary'}
                            className="px-3 py-1 text-xs"
                            disabled={transition.isPending}
                            onClick={() => advance(r, next.status)}
                          >
                            {next.status === 'active'
                              ? 'Mark collected'
                              : next.status === 'completed'
                                ? 'Mark resulted'
                                : next.label}
                          </Button>
                        ))}
                      </div>
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
