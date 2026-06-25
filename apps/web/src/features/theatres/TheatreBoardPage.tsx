import { Link } from 'react-router-dom';
import { Activity, Clock } from 'lucide-react';
import { useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
} from '@trustos/ui';
import {
  STATUS_LABELS,
  statusTone,
  type BoardResponse,
  type BoardTile,
} from './types';

export function TheatreBoardPage() {
  const { data, isLoading } = useApiQuery<BoardResponse>('/api/theatres/board');

  if (isLoading || !data) return <Spinner className="m-10" />;

  const tiles = data.theatres;
  const live = tiles.filter((t) => t.state !== 'idle' && t.state !== 'complete').length;
  const totalCases = tiles.reduce((sum, t) => sum + t.totalCases, 0);
  const completed = tiles.reduce((sum, t) => sum + t.completed, 0);

  return (
    <div>
      <PageHeader
        title="Theatre Coordination"
        description={`Live operating-theatre status across GSTT · ${data.date}`}
        actions={
          <Link to="/theatres/lists">
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
              View lists
            </span>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Theatres running" value={tiles.length} tone="info" />
        <Stat label="Cases in progress" value={live} tone={live > 0 ? 'warning' : 'success'} />
        <Stat label="Cases completed" value={`${completed}/${totalCases}`} tone="success" />
        <Stat
          label="Utilisation"
          value={totalCases ? `${Math.round((completed / totalCases) * 100)}%` : '—'}
        />
      </div>

      {tiles.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No theatre lists today" description="Lists scheduled for today will appear here." />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {tiles.map((tile) => (
            <TheatreTile key={tile.listId} tile={tile} />
          ))}
        </div>
      )}
    </div>
  );
}

function TheatreTile({ tile }: { tile: BoardTile }) {
  const active = tile.state !== 'idle' && tile.state !== 'complete';
  return (
    <Link to={`/theatres/lists/${tile.listId}`} className="block">
      <Card className="h-full transition-shadow hover:shadow-md">
        <div
          className={`flex items-center justify-between rounded-t-xl px-5 py-3 text-white ${
            active ? 'bg-nhs-blue' : 'bg-nhs-darkblue'
          }`}
        >
          <div>
            <div className="text-base font-semibold">{tile.theatre}</div>
            <div className="text-xs text-sky-100">
              {tile.site} · {tile.session}
            </div>
          </div>
          <Badge tone={statusTone(tile.state)} className="bg-white/90">
            {active && <Activity className="mr-1 h-3 w-3" />}
            {STATUS_LABELS[tile.state]}
          </Badge>
        </div>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">{tile.specialty}</span>
            <span className="font-medium text-slate-700">{tile.surgeon}</span>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            {tile.currentCase ? (
              <>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  In progress
                </div>
                <div className="mt-1 font-medium text-slate-900">{tile.currentCase.procedureText}</div>
                <div className="text-xs text-slate-500">{tile.currentCase.patient.name}</div>
              </>
            ) : tile.nextCase ? (
              <>
                <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <Clock className="h-3 w-3" /> Next on list
                </div>
                <div className="mt-1 font-medium text-slate-900">{tile.nextCase.procedureText}</div>
                <div className="text-xs text-slate-500">{tile.nextCase.patient.name}</div>
              </>
            ) : (
              <div className="text-sm text-slate-500">List complete</div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {tile.completed}/{tile.totalCases} done
            </span>
            <div className="flex h-1.5 w-32 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-nhs-green"
                style={{ width: `${tile.totalCases ? (tile.completed / tile.totalCases) * 100 : 0}%` }}
              />
            </div>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
