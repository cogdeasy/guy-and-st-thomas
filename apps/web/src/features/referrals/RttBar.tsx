import { RTT_TARGET_WEEKS, barColor, type RttView } from './types';

/** Weeks-elapsed progress bar against the 18-week RTT standard. */
export function RttBar({ view }: { view: RttView }) {
  const pct = Math.min(100, (view.weeksElapsed / RTT_TARGET_WEEKS) * 100);
  return (
    <div className="min-w-[10rem]">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span className="font-medium text-slate-700">{view.weeksElapsed} wks</span>
        {view.is2ww && (
          <span className={view.twoWeekWaitBreached ? 'font-semibold text-nhs-red' : 'text-slate-400'}>2WW</span>
        )}
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${barColor(view.breachRisk)}`} style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
    </div>
  );
}
