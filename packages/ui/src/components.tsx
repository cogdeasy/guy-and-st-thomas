import * as React from 'react';
import { cn } from './cn';

/**
 * TrustOS design system — a clean, minimal, modern set of primitives shared by
 * every feature. Visual language: hairline borders, generous whitespace, soft
 * shadows, tabular figures for data, and a restrained NHS-blue accent.
 */

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/* ------------------------------------------------------------------ Surfaces */

export function Card({
  className,
  interactive,
  ...props
}: { interactive?: boolean } & DivProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white shadow-card',
        interactive && 'transition-all duration-200 hover:border-slate-300 hover:shadow-pop',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-sm font-semibold tracking-tight text-slate-900', className)}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: DivProps) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

/* -------------------------------------------------------------------- Badges */

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-50 text-slate-600 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  accent: 'bg-accent-50 text-accent-700 ring-accent-200',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: { tone?: BadgeTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
  accent: 'bg-accent-500',
};

/** A small status dot, optionally pulsing (for "live" states). */
export function Dot({
  tone = 'neutral',
  pulse,
  className,
}: {
  tone?: BadgeTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)}>
      {pulse && (
        <span
          className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', dotClasses[tone])}
        />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', dotClasses[tone])} />
    </span>
  );
}

/* ------------------------------------------------------------------- Buttons */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-nhs-blue text-white shadow-sm hover:bg-nhs-darkblue active:bg-nhs-darkblue',
  secondary: 'bg-white text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
};
const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: { variant?: ButtonVariant; size?: ButtonSize } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------- Page scaffold */

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent-600">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A titled section block with optional description and actions. */
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
            )}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/* --------------------------------------------------------------------- Stats */

const statAccent: Record<BadgeTone, string> = {
  neutral: 'text-slate-900',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
  info: 'text-sky-600',
  accent: 'text-accent-600',
};

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  trend?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean };
}) {
  const trendColor = trend
    ? trend.direction === 'flat'
      ? 'text-slate-400'
      : trend.good
        ? 'text-emerald-600'
        : 'text-red-600'
    : '';
  return (
    <Card>
      <CardBody className="py-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
          {icon && <div className="text-slate-300">{icon}</div>}
        </div>
        <div className={cn('mt-2 text-3xl font-bold tnum tracking-tight', statAccent[tone])}>
          {value}
        </div>
        <div className="mt-1 flex items-center gap-2">
          {trend && (
            <span className={cn('text-xs font-semibold tnum', trendColor)}>
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
            </span>
          )}
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ Feedback */

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-accent-500',
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Full-block loading state for pages/cards. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-400">
      <Spinner />
      {label}…
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse2 rounded-md bg-slate-100', className)} />;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------- Table */

export function DataTable<T>({
  rows,
  columns,
  empty = 'No records',
  rowKey,
  onRowClick,
  dense,
}: {
  rows: T[];
  columns: Array<{ header: string; cell: (row: T) => React.ReactNode; className?: string }>;
  empty?: string;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  dense?: boolean;
}) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  const pad = dense ? 'px-3 py-2' : 'px-4 py-3';
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-card">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead>
          <tr className="bg-slate-50/80">
            {columns.map((c) => (
              <th
                key={c.header}
                className={cn(
                  'text-left text-2xs font-semibold uppercase tracking-wider text-slate-500',
                  pad,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'transition-colors',
                onRowClick ? 'cursor-pointer hover:bg-accent-50/40' : 'hover:bg-slate-50/70',
              )}
            >
              {columns.map((c) => (
                <td key={c.header} className={cn('text-slate-700', pad, c.className)}>
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

/* ------------------------------------------------------------------ Avatar */

const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
];

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  const dims = size === 'sm' ? 'h-7 w-7 text-xs' : size === 'lg' ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm';
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold',
        color,
        dims,
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}

/* --------------------------------------------------------------- Progress */

export function ProgressBar({
  value,
  tone = 'accent',
  className,
}: {
  value: number;
  tone?: BadgeTone;
  className?: string;
}) {
  const fill: Record<BadgeTone, string> = {
    neutral: 'bg-slate-400',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    info: 'bg-sky-500',
    accent: 'bg-accent-500',
  };
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className={cn('h-full rounded-full transition-all', fill[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* --------------------------------------------------------------- Sparkline */

export function Sparkline({
  data,
  className,
  stroke = 'currentColor',
}: {
  data: number[];
  className?: string;
  stroke?: string;
}) {
  if (data.length < 2) return null;
  const w = 100;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((d, i) => `${(i / (data.length - 1)) * w},${h - ((d - min) / span) * h}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn('h-7 w-full', className)}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ----------------------------------------------------- Segmented / tabs */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: React.ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- KeyValue */

export function KeyValue({
  items,
  className,
}: {
  items: Array<{ label: React.ReactNode; value: React.ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{it.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-slate-800">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* Maps a NEWS2 risk band to a badge tone. */
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
