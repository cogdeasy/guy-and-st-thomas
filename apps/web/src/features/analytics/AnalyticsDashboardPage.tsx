import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApiQuery } from '@trustos/api-client';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
  news2Tone,
  type BadgeTone,
} from '@trustos/ui';
import type { BySite, Overview, SiteSummary, Trends, WatchItem } from './types';

const NHS = {
  blue: '#005eb8',
  darkblue: '#003087',
  brightblue: '#0072ce',
  green: '#009639',
  red: '#d5281b',
  yellow: '#ffb81c',
  slate: '#94a3b8',
};

const RISK_META: Array<{ key: keyof Overview['inpatients']['byRisk']; label: string; color: string }> = [
  { key: 'low', label: 'Low', color: NHS.green },
  { key: 'low-medium', label: 'Low-medium', color: NHS.brightblue },
  { key: 'medium', label: 'Medium', color: NHS.yellow },
  { key: 'high', label: 'High', color: NHS.red },
];

export function AnalyticsDashboardPage() {
  const overview = useApiQuery<Overview>('/api/analytics/overview');
  const bySite = useApiQuery<BySite>('/api/analytics/by-site');
  const trends = useApiQuery<Trends>('/api/analytics/trends?days=7');

  if (overview.isLoading || !overview.data) return <Spinner className="m-10" />;

  const o = overview.data;
  const occupancyTone: BadgeTone =
    o.beds.occupancyPct >= 92 ? 'danger' : o.beds.occupancyPct >= 85 ? 'warning' : 'success';
  const edTone: BadgeTone = o.ed.compliancePct >= o.ed.target ? 'success' : 'warning';

  return (
    <div>
      <PageHeader
        title="Operational Analytics"
        description="Trust-wide bed occupancy, patient flow and deterioration — across all GSTT sites."
        actions={
          <span className="text-xs text-slate-400">
            Updated {new Date(o.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        }
      />

      {/* Executive KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Bed occupancy"
          value={`${o.beds.occupancyPct}%`}
          hint={`${o.beds.occupied}/${o.beds.total - o.beds.closed} staffed beds`}
          tone={occupancyTone}
        />
        <Stat label="Active inpatients" value={o.inpatients.active} hint="In-progress stays" tone="info" />
        <Stat
          label="Deteriorating"
          value={o.inpatients.deteriorating}
          hint="NEWS2 ≥ 5"
          tone={o.inpatients.deteriorating > 0 ? 'danger' : 'success'}
        />
        <Stat
          label="ED 4-hour"
          value={`${o.ed.compliancePct}%`}
          hint={`Target ${o.ed.target}% · ${o.ed.breaches} breaches`}
          tone={edTone}
        />
        <Stat label="Admissions today" value={o.flow.admissionsToday} hint="All sites" tone="info" />
        <Stat label="Discharges today" value={o.flow.dischargesToday} hint="All sites" tone="success" />
      </div>

      {/* Flow trend + risk mix */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Patient flow — last 7 days</CardTitle>
          </CardHeader>
          <CardBody>
            {trends.data ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trends.data.buckets} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDay} tick={axisTick} stroke={NHS.slate} />
                  <YAxis allowDecimals={false} tick={axisTick} stroke={NHS.slate} />
                  <Tooltip labelFormatter={(d) => longDay(String(d))} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="admissions"
                    name="Admissions"
                    stroke={NHS.blue}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="discharges"
                    name="Discharges"
                    stroke={NHS.green}
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Spinner />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>NEWS2 risk distribution</CardTitle>
          </CardHeader>
          <CardBody>
            <RiskPie byRisk={o.inpatients.byRisk} monitored={o.inpatients.monitored} />
          </CardBody>
        </Card>
      </div>

      {/* Per-site occupancy + activity */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bed occupancy by site</CardTitle>
          </CardHeader>
          <CardBody>
            {bySite.data ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={bySite.data.sites.map((s) => ({ site: shortSite(s.site), occupancy: s.beds.occupancyPct }))}
                  margin={{ top: 8, right: 16, left: -8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="site" tick={axisTick} stroke={NHS.slate} interval={0} />
                  <YAxis domain={[0, 100]} unit="%" tick={axisTick} stroke={NHS.slate} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Occupancy']} />
                  <Bar dataKey="occupancy" radius={[6, 6, 0, 0]}>
                    {bySite.data.sites.map((s) => (
                      <Cell key={s.siteId} fill={occupancyColor(s.beds.occupancyPct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Spinner />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Site activity</CardTitle>
          </CardHeader>
          <CardBody>
            <SiteTable sites={bySite.data?.sites ?? []} loading={bySite.isLoading} />
          </CardBody>
        </Card>
      </div>

      {/* Deterioration watchlist */}
      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Deterioration watchlist — highest NEWS2</CardTitle>
          </CardHeader>
          <CardBody>
            <WatchlistTable items={o.watchlist} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function RiskPie({ byRisk, monitored }: { byRisk: Overview['inpatients']['byRisk']; monitored: number }) {
  const data = RISK_META.map((m) => ({ name: m.label, value: byRisk[m.key], color: m.color })).filter(
    (d) => d.value > 0,
  );
  if (monitored === 0 || data.length === 0) {
    return <EmptyState title="No monitored inpatients" description="NEWS2 needs a full set of vitals." />;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip formatter={(v, n) => [`${v} patient(s)`, n]} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function SiteTable({ sites, loading }: { sites: SiteSummary[]; loading: boolean }) {
  if (loading) return <Spinner />;
  return (
    <DataTable
      rows={sites}
      rowKey={(s) => s.siteId}
      empty="No sites"
      columns={[
        { header: 'Site', cell: (s) => <span className="font-medium text-slate-800">{s.site}</span> },
        {
          header: 'Occupancy',
          cell: (s) => (
            <Badge tone={s.beds.occupancyPct >= 92 ? 'danger' : s.beds.occupancyPct >= 85 ? 'warning' : 'success'}>
              {s.beds.occupancyPct}%
            </Badge>
          ),
        },
        { header: 'Inpatients', cell: (s) => s.activity.activeInpatients },
        { header: 'Adm.', cell: (s) => s.activity.admissionsToday },
        { header: 'Disch.', cell: (s) => s.activity.dischargesToday },
        {
          header: 'ED',
          cell: (s) => (
            <span>
              {s.activity.edAttendances}
              {s.activity.edBreaches > 0 && (
                <span className="ml-1 text-xs text-nhs-red">({s.activity.edBreaches} breach)</span>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}

function WatchlistTable({ items }: { items: WatchItem[] }) {
  return (
    <DataTable
      rows={items}
      rowKey={(w) => w.encounterId}
      empty="No deteriorating patients — all monitored inpatients are low risk."
      columns={[
        { header: 'Patient', cell: (w) => <span className="font-medium text-slate-800">{w.name}</span> },
        { header: 'Specialty', cell: (w) => w.specialty ?? '—' },
        {
          header: 'NEWS2',
          cell: (w) => <Badge tone={news2Tone(w.risk)}>{w.news2}</Badge>,
        },
        {
          header: 'Risk',
          cell: (w) => <span className="capitalize text-slate-600">{w.risk}</span>,
        },
      ]}
    />
  );
}

function occupancyColor(pct: number): string {
  if (pct >= 92) return NHS.red;
  if (pct >= 85) return NHS.yellow;
  return NHS.green;
}

const axisTick = { fontSize: 12, fill: '#64748b' };

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}

function longDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function shortSite(name: string): string {
  return name.replace(/ Hospital$/, '').replace('Evelina London Children’s', 'Evelina');
}
