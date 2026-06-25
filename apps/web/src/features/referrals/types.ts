import type { BadgeTone } from '@trustos/ui';

export type ReferralPriority = 'routine' | 'urgent' | '2ww';
export type ReferralStatus = 'received' | 'triaged' | 'booked' | 'treated' | 'discharged';
export type BreachRisk = 'breached' | 'high' | 'medium' | 'low';

export interface Reference {
  reference: string;
  display?: string;
}

export interface HistoryEntry {
  status: ReferralStatus;
  at: string;
  note?: string;
}

export interface Triage {
  outcome: 'accepted' | 'rejected' | 'redirected' | 'advice-and-guidance';
  triagedBy?: string;
  triagedAt: string;
  notes?: string;
}

export interface RttView {
  id: string;
  patient: Reference;
  referrer?: Reference;
  fromSpecialty: string;
  toSpecialty: string;
  priority: ReferralPriority;
  reason: string;
  clockStart: string;
  clockStop?: string;
  status: ReferralStatus;
  triage?: Triage;
  history: HistoryEntry[];
  weeksElapsed: number;
  daysElapsed: number;
  daysToBreach: number;
  breached: boolean;
  breachRisk: BreachRisk;
  clockStopped: boolean;
  is2ww: boolean;
  twoWeekWaitBreached: boolean;
}

export interface Worklist {
  total: number;
  filtered: number;
  open: number;
  breaches: number;
  twoWeekWait: number;
  targetWeeks: number;
  items: RttView[];
}

export interface SpecialtyMetric {
  specialty: string;
  total: number;
  breaches: number;
}

export interface Metrics {
  targetWeeks: number;
  totalReferrals: number;
  openPathways: number;
  withinTarget: number;
  breaches: number;
  performance: number;
  twoWeekWait: number;
  twoWeekWaitBreaches: number;
  bySpecialty: SpecialtyMetric[];
}

export const RTT_TARGET_WEEKS = 18;

/** Map RTT breach risk to a UI badge/bar tone. */
export function breachTone(risk: BreachRisk): BadgeTone {
  switch (risk) {
    case 'breached':
      return 'danger';
    case 'high':
      return 'warning';
    case 'medium':
      return 'info';
    default:
      return 'success';
  }
}

const priorityTones: Record<ReferralPriority, BadgeTone> = {
  routine: 'neutral',
  urgent: 'warning',
  '2ww': 'danger',
};
export function priorityTone(priority: ReferralPriority): BadgeTone {
  return priorityTones[priority];
}

export function priorityLabel(priority: ReferralPriority): string {
  return priority === '2ww' ? '2-week wait' : priority.charAt(0).toUpperCase() + priority.slice(1);
}

const statusTones: Record<ReferralStatus, BadgeTone> = {
  received: 'info',
  triaged: 'info',
  booked: 'warning',
  treated: 'success',
  discharged: 'neutral',
};
export function statusTone(status: ReferralStatus): BadgeTone {
  return statusTones[status];
}

/** Tailwind bar-fill class for the weeks-elapsed progress bar. */
export function barColor(risk: BreachRisk): string {
  switch (risk) {
    case 'breached':
      return 'bg-nhs-red';
    case 'high':
      return 'bg-nhs-yellow';
    case 'medium':
      return 'bg-nhs-blue';
    default:
      return 'bg-nhs-green';
  }
}
