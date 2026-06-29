import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Activity, Command, Search } from 'lucide-react';
import { Dot } from '@trustos/ui';
import { CATEGORY_ORDER, featuresByCategory } from './registry';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const categories = Object.keys(featuresByCategory).sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
  );

  const q = query.trim().toLowerCase();
  const filter = (title: string) => !q || title.toLowerCase().includes(q);

  return (
    <div className="flex h-full bg-slate-50">
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-nhs-blue text-white shadow-sm">
            <Activity className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-slate-900">TrustOS</div>
            <div className="text-2xs font-medium text-slate-400">Guy&apos;s &amp; St Thomas&apos;</div>
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-accent-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-100"
            />
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
          {filter('command centre') && (
            <NavLink
              to="/"
              className={({ isActive }) =>
                `group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent-50 text-accent-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              <Command className="h-4 w-4" />
              Command Centre
            </NavLink>
          )}

          {categories.map((category) => {
            const items = (featuresByCategory[category] ?? []).filter((f) => filter(f.title));
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <div className="px-3 pb-1.5 text-2xs font-semibold uppercase tracking-widest text-slate-400">
                  {category}
                </div>
                <div className="space-y-0.5">
                  {items.map((f) => {
                    const Icon = f.icon;
                    const active =
                      location.pathname === f.navPath ||
                      location.pathname.startsWith(f.navPath + '/');
                    return (
                      <NavLink
                        key={f.id}
                        to={f.navPath}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-accent-50 font-medium text-accent-700'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent-500" />
                        )}
                        <Icon
                          className={`h-4 w-4 flex-shrink-0 ${active ? 'text-accent-600' : 'text-slate-400 group-hover:text-slate-600'}`}
                        />
                        <span className="truncate">{f.title}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 px-5 py-3 text-2xs text-slate-400">
          FHIR R4 · {Object.values(featuresByCategory).flat().length} live modules
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="font-medium text-slate-700">Guy&apos;s and St Thomas&apos; NHS Foundation Trust</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-400">Digital Hospital Platform</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <Dot tone="success" pulse />
              Live
            </span>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-nhs-blue text-xs font-semibold text-white">
                CD
              </div>
              <div className="leading-tight">
                <div className="text-sm font-medium text-slate-800">Dr C. Deasy</div>
                <div className="text-2xs text-slate-400">Consultant · Cardiology</div>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] animate-fade-in p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
