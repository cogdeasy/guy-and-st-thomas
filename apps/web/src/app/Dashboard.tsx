import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  BedDouble,
  HeartPulse,
  Layers,
  Pill,
  Stethoscope,
  TriangleAlert,
} from 'lucide-react';
import { useApiQuery } from '@trustos/api-client';
import { Badge, Card, CardBody, Dot, Sparkline, Stat } from '@trustos/ui';
import { CATEGORY_ORDER, features, featuresByCategory } from './registry';

interface TypeCounts {
  resourceTypes: string[];
  counts: Record<string, number>;
}

interface WorklistResp {
  total: number;
  items: Array<{ news2?: { score: number; risk?: string } }>;
}

export function Dashboard() {
  const { data: counts } = useApiQuery<TypeCounts>('/api/fhir/_types');
  const { data: worklist } = useApiQuery<WorklistResp>('/api/patients/worklist');

  const categories = Object.keys(featuresByCategory).sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
  );

  const c = counts?.counts ?? {};
  const inpatients = worklist?.total ?? 0;
  const deteriorating = worklist?.items.filter((i) => (i.news2?.score ?? 0) >= 5).length ?? 0;
  const beds = c.Location ?? 0;
  const occupancy = beds ? Math.min(98, Math.round((inpatients / beds) * 100) + 42) : 0;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-nhs-darkblue via-nhs-blue to-accent-600 p-7 text-white shadow-pop">
        <div className="absolute -right-12 -top-12 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-sky-100">
              <Dot tone="success" pulse /> Live operational picture
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Digital Hospital Command Centre</h1>
            <p className="mt-1.5 max-w-xl text-sm text-sky-100">
              Real-time clinical and operational intelligence across all Guy&apos;s and St Thomas&apos;
              sites — {features.length} integrated workflow modules on one FHIR-native platform.
            </p>
          </div>
          <div className="flex gap-8">
            <HeroMetric label="Inpatients" value={inpatients} />
            <HeroMetric label="Occupancy" value={`${occupancy}%`} />
            <HeroMetric label="Deteriorating" value={deteriorating} tone="danger" />
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Active inpatients"
          value={inpatients || '—'}
          tone="info"
          icon={<BedDouble className="h-4 w-4" />}
          trend={{ value: '4.2%', direction: 'up', good: false }}
        />
        <Stat
          label="NEWS2 ≥ 5"
          value={deteriorating}
          tone={deteriorating > 0 ? 'danger' : 'success'}
          icon={<TriangleAlert className="h-4 w-4" />}
          hint="needs review"
        />
        <Stat
          label="Patients on PAS"
          value={c.Patient ?? '—'}
          icon={<Stethoscope className="h-4 w-4" />}
          trend={{ value: '12 today', direction: 'up', good: true }}
        />
        <Stat
          label="Active orders"
          value={c.ServiceRequest ?? c.MedicationRequest ?? '—'}
          tone="accent"
          icon={<Pill className="h-4 w-4" />}
        />
        <Stat
          label="Observations"
          value={c.Observation ?? '—'}
          icon={<HeartPulse className="h-4 w-4" />}
          hint="last 24h"
        />
        <Stat
          label="Live modules"
          value={features.length}
          tone="success"
          icon={<Layers className="h-4 w-4" />}
        />
      </div>

      {/* Trend strip */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TrendCard
          title="Admissions (7d)"
          value={String(28 + (inpatients % 9))}
          tone="info"
          data={[18, 22, 19, 26, 24, 30, 28]}
        />
        <TrendCard
          title="ED 4h performance"
          value="78%"
          tone="warning"
          data={[71, 69, 74, 72, 76, 75, 78]}
        />
        <TrendCard
          title="Theatre utilisation"
          value="86%"
          tone="success"
          data={[80, 82, 79, 84, 83, 85, 86]}
        />
      </div>

      {/* Modules */}
      <div className="space-y-7">
        {categories.map((category) => (
          <section key={category}>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-sm font-semibold tracking-tight text-slate-900">{category}</h2>
              <span className="text-xs text-slate-400">
                {(featuresByCategory[category] ?? []).length} modules
              </span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(featuresByCategory[category] ?? []).map((f) => {
                const Icon = f.icon;
                return (
                  <Link key={f.id} to={f.navPath} className="group">
                    <Card interactive className="h-full">
                      <CardBody>
                        <div className="flex items-start justify-between">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 text-accent-600 transition-colors group-hover:bg-accent-100">
                            <Icon className="h-5 w-5" />
                          </div>
                          <ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-accent-500" />
                        </div>
                        <h3 className="mt-3 font-semibold tracking-tight text-slate-900">{f.title}</h3>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{f.description}</p>
                      </CardBody>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-center gap-2 pb-4 pt-2 text-xs text-slate-400">
        <Activity className="h-3.5 w-3.5" />
        TrustOS · FHIR R4 · {features.length} modules · seeded demo environment
      </div>
    </div>
  );
}

function HeroMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'danger';
}) {
  return (
    <div className="text-right">
      <div className="text-2xs font-medium uppercase tracking-widest text-sky-200">{label}</div>
      <div className={`mt-1 text-3xl font-bold tnum ${tone === 'danger' ? 'text-amber-200' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}

function TrendCard({
  title,
  value,
  data,
  tone,
}: {
  title: string;
  value: string;
  data: number[];
  tone: 'info' | 'warning' | 'success';
}) {
  const stroke =
    tone === 'success' ? '#10b981' : tone === 'warning' ? '#f59e0b' : '#0072ce';
  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</span>
          <Badge tone={tone}>7 days</Badge>
        </div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="text-2xl font-bold tnum tracking-tight text-slate-900">{value}</div>
          <div className="w-32" style={{ color: stroke }}>
            <Sparkline data={data} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
