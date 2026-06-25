import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { useApiMutation } from '@trustos/api-client';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, DataTable } from '@trustos/ui';
import {
  STATUS_LABELS,
  nextStatus,
  priorityTone,
  statusTone,
  type CaseView,
  type TheatreListView,
} from './types';

export function TheatreListCard({ list, linkTitle = false }: { list: TheatreListView; linkTitle?: boolean }) {
  const advance = useApiMutation<{ id: string }, CaseView>(
    'POST',
    (body) => `/api/theatres/cases/${body.id}/status`,
  );

  const title = (
    <span className="flex items-center gap-2">
      {list.theatre}
      <Badge tone="neutral">{list.session}</Badge>
    </span>
  );

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>
            {linkTitle ? (
              <Link to={`/theatres/lists/${list.id}`} className="text-nhs-blue hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </CardTitle>
          <div className="mt-1 text-xs text-slate-500">
            {list.specialty} · {list.surgeonName} · {list.site}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          {list.counts.complete}/{list.cases.length} complete
        </div>
      </CardHeader>
      <CardBody>
        <DataTable
          rows={list.cases}
          rowKey={(c) => c.id}
          empty="No cases booked on this list"
          columns={[
            { header: '#', cell: (c) => <span className="font-medium text-slate-500">{c.order}</span>, className: 'w-10' },
            {
              header: 'Patient',
              cell: (c) => (
                <Link to={`/patients/${c.patient.id}`} className="font-medium text-nhs-blue hover:underline">
                  {c.patient.name}
                </Link>
              ),
            },
            {
              header: 'Procedure',
              cell: (c) => (
                <div>
                  <div className="text-slate-800">{c.procedureText}</div>
                  <div className="text-xs text-slate-400">~{c.estimatedMinutes} min</div>
                </div>
              ),
            },
            { header: 'Priority', cell: (c) => <Badge tone={priorityTone(c.priority)}>{c.priority}</Badge> },
            { header: 'Status', cell: (c) => <Badge tone={statusTone(c.status)}>{STATUS_LABELS[c.status]}</Badge> },
            {
              header: 'Action',
              className: 'text-right',
              cell: (c) => <AdvanceButton row={c} pending={advance.isPending} onAdvance={(id) => advance.mutate({ id })} />,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function AdvanceButton({
  row,
  pending,
  onAdvance,
}: {
  row: CaseView;
  pending: boolean;
  onAdvance: (id: string) => void;
}) {
  const next = nextStatus(row.status);
  if (!next) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <CheckCircle2 className="h-4 w-4" /> Complete
      </span>
    );
  }
  return (
    <Button variant="secondary" disabled={pending} onClick={() => onAdvance(row.id)} className="px-3 py-1.5 text-xs">
      {STATUS_LABELS[next]} <ArrowRight className="h-3.5 w-3.5" />
    </Button>
  );
}
