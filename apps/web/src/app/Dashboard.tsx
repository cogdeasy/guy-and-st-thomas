import { Link } from 'react-router-dom';
import { useApiQuery } from '@trustos/api-client';
import { Card, CardBody, PageHeader, Stat } from '@trustos/ui';
import { CATEGORY_ORDER, features, featuresByCategory } from './registry';

interface TypeCounts {
  resourceTypes: string[];
  counts: Record<string, number>;
}

export function Dashboard() {
  const { data: counts } = useApiQuery<TypeCounts>('/api/fhir/_types');
  const { data: worklist } = useApiQuery<{ total: number; items: Array<{ news2?: { score: number } }> }>(
    '/api/patients/worklist',
  );

  const categories = Object.keys(featuresByCategory).sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
  );

  const deteriorating =
    worklist?.items.filter((i) => (i.news2?.score ?? 0) >= 5).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Digital Hospital Command Centre"
        description="Real-time operational and clinical overview across all GSTT sites."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Active inpatients" value={worklist?.total ?? '—'} tone="info" />
        <Stat
          label="Deteriorating (NEWS2 ≥ 5)"
          value={deteriorating}
          tone={deteriorating > 0 ? 'danger' : 'success'}
        />
        <Stat label="Patients on PAS" value={counts?.counts.Patient ?? '—'} />
        <Stat label="Live modules" value={features.length} tone="success" />
      </div>

      <div className="mt-8 space-y-8">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {category}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(featuresByCategory[category] ?? []).map((f) => {
                const Icon = f.icon;
                return (
                  <Link key={f.id} to={f.navPath}>
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <CardBody>
                        <div className="flex items-center gap-2">
                          <div className="rounded-lg bg-nhs-blue/10 p-2 text-nhs-blue">
                            <Icon className="h-5 w-5" />
                          </div>
                          <h3 className="font-semibold text-slate-900">{f.title}</h3>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">{f.description}</p>
                      </CardBody>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
