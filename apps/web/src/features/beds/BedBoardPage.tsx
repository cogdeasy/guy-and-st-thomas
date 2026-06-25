import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { useApiQuery } from '@trustos/api-client';
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
  news2Tone,
  type BadgeTone,
} from '@trustos/ui';
import type { BedView, BoardResponse, CapacityResponse, WardView } from './types';

export function BedBoardPage() {
  const board = useApiQuery<BoardResponse>('/api/beds/board');
  const capacity = useApiQuery<CapacityResponse>('/api/beds/capacity');

  const trust = capacity.data?.trust;

  return (
    <div>
      <PageHeader
        title="Bed Management & Patient Flow"
        description="Live bed-state board and capacity across all Guy's and St Thomas' sites."
        actions={
          <Link to="/beds/requests">
            <Button variant="primary">
              <ClipboardList className="h-4 w-4" />
              Bed requests
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total beds" value={trust?.total ?? '—'} />
        <Stat
          label="Occupied"
          value={trust?.occupied ?? '—'}
          tone={occupancyTone(trust?.occupancyPct)}
          hint={trust ? `${trust.occupancyPct}% occupancy` : undefined}
        />
        <Stat label="Available" value={trust?.available ?? '—'} tone="success" />
        <Stat label="Closed" value={trust?.closed ?? '—'} tone={trust && trust.closed > 0 ? 'warning' : 'neutral'} />
      </div>

      {capacity.data && capacity.data.sites.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Capacity by site</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {capacity.data.sites.map((site) => (
              <div key={site.siteId}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{site.siteName}</span>
                  <span className="text-slate-500">
                    {site.occupied}/{site.occupied + site.available} occupied ·{' '}
                    <span className="font-semibold text-slate-700">{site.occupancyPct}%</span> · {site.available}{' '}
                    free
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${occupancyBar(site.occupancyPct)}`}
                    style={{ width: `${site.occupancyPct}%` }}
                  />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Ward board</h2>

      {board.isLoading && <Spinner className="m-10" />}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {(board.data?.wards ?? []).map((ward) => (
          <WardCard key={ward.wardId} ward={ward} />
        ))}
      </div>
    </div>
  );
}

function WardCard({ ward }: { ward: WardView }) {
  const { summary } = ward;
  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{ward.wardName}</CardTitle>
          {ward.siteName && <p className="mt-0.5 text-xs text-slate-400">{ward.siteName}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={occupancyTone(summary.occupancyPct)}>{summary.occupancyPct}% full</Badge>
          <Badge tone="success">{summary.available} free</Badge>
          {summary.closed > 0 && <Badge tone="warning">{summary.closed} closed</Badge>}
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ward.beds.map((bed) => (
            <BedTile key={bed.id} bed={bed} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function BedTile({ bed }: { bed: BedView }) {
  const bedNo = bed.name.replace(/^.*\bBed\b/i, 'Bed').trim() || bed.name;
  const occupant = bed.occupant;

  return (
    <div className={`rounded-lg border p-3 text-sm ${tileClasses(bed)}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-800">{bedNo}</span>
        {bed.status === 'occupied' && occupant?.news2 ? (
          <Badge tone={news2Tone(occupant.news2.risk)}>NEWS2 {occupant.news2.score}</Badge>
        ) : (
          <span className={`text-xs font-medium capitalize ${statusText(bed.status)}`}>{bed.status}</span>
        )}
      </div>
      {bed.status === 'occupied' ? (
        occupant?.name ? (
          <div className="mt-1.5">
            <div className="truncate font-medium text-slate-700">{occupant.name}</div>
            <div className="truncate text-xs text-slate-400">
              {occupant.age != null ? `${occupant.age}y` : ''}
              {occupant.gender ? ` · ${occupant.gender}` : ''}
              {occupant.nhsNumber ? ` · NHS ${occupant.nhsNumber}` : ''}
            </div>
          </div>
        ) : (
          <div className="mt-1.5 text-xs text-slate-400">Occupied</div>
        )
      ) : (
        <div className="mt-1.5 text-xs text-slate-400">
          {bed.status === 'available' ? 'Ready for admission' : 'Out of service'}
        </div>
      )}
    </div>
  );
}

function tileClasses(bed: BedView): string {
  if (bed.status === 'available') return 'border-emerald-200 bg-emerald-50';
  if (bed.status === 'closed') return 'border-slate-200 bg-slate-100';
  const risk = bed.occupant?.news2?.risk;
  if (risk === 'high') return 'border-red-200 bg-red-50';
  if (risk === 'medium') return 'border-amber-200 bg-amber-50';
  return 'border-sky-200 bg-sky-50';
}

function statusText(status: string): string {
  if (status === 'available') return 'text-emerald-700';
  if (status === 'closed') return 'text-slate-500';
  return 'text-sky-700';
}

function occupancyTone(pct?: number): BadgeTone {
  if (pct == null) return 'neutral';
  if (pct >= 95) return 'danger';
  if (pct >= 85) return 'warning';
  return 'success';
}

function occupancyBar(pct: number): string {
  if (pct >= 95) return 'bg-nhs-red';
  if (pct >= 85) return 'bg-nhs-yellow';
  return 'bg-nhs-green';
}
