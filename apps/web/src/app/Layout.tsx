import { NavLink, useLocation } from 'react-router-dom';
import { Activity, LayoutDashboard, Search } from 'lucide-react';
import { CATEGORY_ORDER, featuresByCategory } from './registry';

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const categories = Object.keys(featuresByCategory).sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
  );

  return (
    <div className="flex h-full">
      <aside className="flex w-64 flex-shrink-0 flex-col overflow-y-auto bg-nhs-darkblue text-white">
        <div className="flex items-center gap-2 px-5 py-4">
          <Activity className="h-6 w-6 text-nhs-yellow" />
          <div>
            <div className="text-lg font-bold leading-tight">TrustOS</div>
            <div className="text-[11px] leading-tight text-sky-200">Guy's &amp; St Thomas'</div>
          </div>
        </div>

        <nav className="flex-1 space-y-4 px-3 pb-6">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                isActive ? 'bg-white/15' : 'hover:bg-white/10'
              }`
            }
          >
            <LayoutDashboard className="h-4 w-4" />
            Command Centre
          </NavLink>

          {categories.map((category) => (
            <div key={category}>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                {category}
              </div>
              <div className="space-y-0.5">
                {(featuresByCategory[category] ?? []).map((f) => {
                  const Icon = f.icon;
                  const active = location.pathname === f.navPath || location.pathname.startsWith(f.navPath + '/');
                  return (
                    <NavLink
                      key={f.id}
                      to={f.navPath}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                        active ? 'bg-white/15 font-medium' : 'text-sky-100 hover:bg-white/10'
                      }`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{f.title}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Search className="h-4 w-4" />
            <span>Guy's and St Thomas' NHS Foundation Trust &middot; Digital Hospital Platform</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
              Live
            </span>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-nhs-blue text-center text-sm font-semibold leading-8 text-white">
                CD
              </div>
              <div className="leading-tight">
                <div className="font-medium text-slate-800">Dr C. Deasy</div>
                <div className="text-[11px] text-slate-400">Consultant</div>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
