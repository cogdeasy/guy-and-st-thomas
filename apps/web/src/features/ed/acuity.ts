import type { BadgeTone } from '@trustos/ui';

export type EdStatus = 'waiting' | 'triaged' | 'in-treatment' | 'awaiting-bed' | 'discharged';

export interface AcuityMeta {
  label: string;
  /** Manchester Triage colour name. */
  colour: string;
  /** Tailwind classes for the acuity chip. */
  chip: string;
  /** Left accent bar for the board row. */
  bar: string;
}

/** Manchester Triage System acuity bands (1 = immediate, 5 = non-urgent). */
export function acuityMeta(acuity: number | null): AcuityMeta {
  switch (acuity) {
    case 1:
      return { label: 'Immediate', colour: 'Red', chip: 'bg-nhs-red text-white', bar: 'bg-nhs-red' };
    case 2:
      return { label: 'Very urgent', colour: 'Orange', chip: 'bg-orange-500 text-white', bar: 'bg-orange-500' };
    case 3:
      return { label: 'Urgent', colour: 'Yellow', chip: 'bg-nhs-yellow text-slate-900', bar: 'bg-nhs-yellow' };
    case 4:
      return { label: 'Standard', colour: 'Green', chip: 'bg-nhs-green text-white', bar: 'bg-nhs-green' };
    case 5:
      return { label: 'Non-urgent', colour: 'Blue', chip: 'bg-nhs-blue text-white', bar: 'bg-nhs-blue' };
    default:
      return { label: 'Untriaged', colour: 'Grey', chip: 'bg-slate-200 text-slate-700', bar: 'bg-slate-300' };
  }
}

const STATUS_LABELS: Record<EdStatus, string> = {
  waiting: 'Waiting',
  triaged: 'Triaged',
  'in-treatment': 'In treatment',
  'awaiting-bed': 'Awaiting bed',
  discharged: 'Discharged',
};

export function statusLabel(status: EdStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: EdStatus): BadgeTone {
  switch (status) {
    case 'waiting':
      return 'warning';
    case 'triaged':
      return 'info';
    case 'in-treatment':
      return 'info';
    case 'awaiting-bed':
      return 'neutral';
    case 'discharged':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Format minutes as h:mm, negative values shown as "+h:mm over". */
export function formatClock(minutes: number): string {
  const over = minutes < 0;
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const text = `${h}:${String(m).padStart(2, '0')}`;
  return over ? `+${text} over` : text;
}
