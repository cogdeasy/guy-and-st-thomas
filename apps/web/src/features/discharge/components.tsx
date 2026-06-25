import { Check, X } from 'lucide-react';
import type { Checklist } from './types';

/** Compact "x / y" progress bar used in the worklist table. */
export function ChecklistProgress({ checklist }: { checklist: Checklist }) {
  const pct = checklist.total === 0 ? 0 : Math.round((checklist.complete / checklist.total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${checklist.ready ? 'bg-nhs-green' : 'bg-nhs-blue'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-slate-500">
        {checklist.complete}/{checklist.total}
      </span>
    </div>
  );
}

/** Full readiness checklist with per-item tick/cross. */
export function ChecklistCard({ checklist }: { checklist: Checklist }) {
  return (
    <ul className="space-y-2">
      {checklist.items.map((item) => (
        <li key={item.key} className="flex items-center gap-3 text-sm">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full ${
              item.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {item.done ? <Check size={13} /> : <X size={13} />}
          </span>
          <span className={item.done ? 'text-slate-700' : 'text-slate-500'}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
