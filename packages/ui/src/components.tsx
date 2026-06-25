import * as React from 'react';
import { cn } from './cn';

/** NHS-aligned design-system primitives shared by every TrustOS feature. */

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm', className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn('border-b border-slate-100 px-5 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold text-slate-900', className)} {...props} />;
}

export function CardBody({ className, ...props }: DivProps) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-sky-100 text-sky-800',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: { tone?: BadgeTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-nhs-blue text-white hover:bg-nhs-darkblue',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: { variant?: ButtonVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-nhs-blue/40 disabled:opacity-50',
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: BadgeTone;
}) {
  const accent: Record<BadgeTone, string> = {
    neutral: 'text-slate-900',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    info: 'text-sky-600',
  };
  return (
    <Card>
      <CardBody>
        <div className="text-sm font-medium text-slate-500">{label}</div>
        <div className={cn('mt-1 text-3xl font-bold', accent[tone])}>{value}</div>
        {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
      </CardBody>
    </Card>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-nhs-blue',
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
    </div>
  );
}

export function DataTable<T>({
  rows,
  columns,
  empty = 'No records',
  rowKey,
}: {
  rows: T[];
  columns: Array<{ header: string; cell: (row: T) => React.ReactNode; className?: string }>;
  empty?: string;
  rowKey: (row: T, index: number) => string;
}) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.header} className={cn('px-4 py-2.5 text-slate-700', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Maps a NEWS2 risk band to a badge tone. */
export function news2Tone(risk?: string): BadgeTone {
  switch (risk) {
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low-medium':
      return 'info';
    default:
      return 'success';
  }
}
