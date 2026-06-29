import { Link, useParams } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { Badge, PageHeader, Spinner, Stat } from '@trustos/ui';
import { TheatreListCard } from './TheatreListCard';
import { STATUS_LABELS, statusTone, type TheatreListView } from './types';

export function TheatreListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApiQuery<TheatreListView>(id ? `/api/theatres/lists/${id}` : null);

  if (isLoading || !data) return <Spinner className="m-10" />;

  const active = data.cases.find((c) => ['sent-for', 'anaesthetic', 'in-theatre', 'recovery'].includes(c.status));

  return (
    <div>
      <Link to="/theatres/lists" className="text-sm text-nhs-blue hover:underline">
        ← Back to Theatre Lists
      </Link>

      <div className="mt-3 rounded-xl bg-nhs-darkblue p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{data.theatre}</h1>
            <div className="mt-1 text-sm text-sky-200">
              {data.site} · {data.session} session · {data.specialty} · {data.surgeonName} · {data.date}
            </div>
          </div>
          {active && (
            <div className="text-right">
              <div className="text-xs text-sky-200">Live</div>
              <Badge tone={statusTone(active.status)} className="text-base">
                {STATUS_LABELS[active.status]}
              </Badge>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Cases" value={data.cases.length} />
        <Stat label="Completed" value={data.counts.complete} tone="success" />
        <Stat label="In theatre" value={data.counts['in-theatre']} tone="danger" />
        <Stat label="Scheduled" value={data.counts.scheduled} tone="info" />
      </div>

      <div className="mt-6">
        <PageHeader title="Operating list" description="Drive each case forward through the surgical pathway." />
        <TheatreListCard list={data} />
      </div>
    </div>
  );
}
