import { pct } from './types';

const fills: Array<{ min: number; className: string }> = [
  { min: 0.85, className: 'bg-nhs-green' },
  { min: 0.6, className: 'bg-nhs-blue' },
  { min: 0.4, className: 'bg-nhs-yellow' },
  { min: 0, className: 'bg-nhs-red' },
];

export function UtilisationBar({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const fill = fills.find((f) => value >= f.min)?.className ?? 'bg-slate-300';
  const width = Math.min(100, Math.round(value * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
      </div>
      {showLabel && (
        <span className="w-10 shrink-0 text-right text-xs font-semibold text-slate-600">
          {pct(value)}
        </span>
      )}
    </div>
  );
}
