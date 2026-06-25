import type { BadgeTone } from '@trustos/ui';

export type ResultFlag = 'normal' | 'low' | 'high' | 'critical' | 'abnormal';

/** Map a result interpretation flag to a design-system badge tone. */
export function flagTone(flag?: string): BadgeTone {
  switch (flag) {
    case 'critical':
      return 'danger';
    case 'high':
    case 'low':
    case 'abnormal':
      return 'warning';
    case 'normal':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Short human label for a flag. */
export function flagLabel(flag?: string): string {
  switch (flag) {
    case 'critical':
      return 'Critical';
    case 'high':
      return 'High';
    case 'low':
      return 'Low';
    case 'abnormal':
      return 'Abnormal';
    case 'normal':
      return 'Normal';
    default:
      return '—';
  }
}

/** Format an ISO timestamp as a compact UK-style date/time. */
export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
