import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { EmptyState, PageHeader, Spinner } from '@trustos/ui';
import { TheatreListCard } from './TheatreListCard';
import type { ListsResponse } from './types';

export function TheatreListsPage() {
  const { data, isLoading } = useApiQuery<ListsResponse>('/api/theatres/lists');

  if (isLoading || !data) return <Spinner className="m-10" />;

  return (
    <div>
      <Link to="/theatres" className="text-sm text-nhs-blue hover:underline">
        ← Back to Theatre Board
      </Link>
      <div className="mt-3">
        <PageHeader
          title="Theatre Lists"
          description={`All operating lists for ${data.date} — advance cases through the perioperative pathway.`}
        />
      </div>

      {data.lists.length === 0 ? (
        <EmptyState title="No theatre lists today" description="Lists scheduled for today will appear here." />
      ) : (
        <div className="space-y-6">
          {data.lists.map((list) => (
            <TheatreListCard key={list.id} list={list} linkTitle />
          ))}
        </div>
      )}
    </div>
  );
}
