import type { Referral } from './module';

/** NHS Referral-To-Treatment standard: 92% of pathways treated within 18 weeks. */
export const RTT_TARGET_WEEKS = 18;
export const RTT_TARGET_DAYS = RTT_TARGET_WEEKS * 7;
/** Cancer 2-week-wait: first appointment within 14 days of referral. */
export const TWO_WEEK_WAIT_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type BreachRisk = 'breached' | 'high' | 'medium' | 'low';

/** True once the RTT clock has stopped (pathway no longer counts as waiting). */
export function isClockStopped(status: Referral['status']): boolean {
  return status === 'treated' || status === 'discharged';
}

/**
 * Whole days a referral has been on the RTT clock. The clock starts at
 * `clockStart` and stops at `clockStop` (set when treated/discharged); for an
 * open pathway it runs to `asOf`.
 */
export function rttDays(referral: Referral, asOf: Date = new Date()): number {
  const start = new Date(referral.clockStart).getTime();
  const end = referral.clockStop ? new Date(referral.clockStop).getTime() : asOf.getTime();
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

export function rttWeeks(referral: Referral, asOf: Date = new Date()): number {
  return Math.floor(rttDays(referral, asOf) / 7);
}

export function breachRisk(days: number): BreachRisk {
  if (days >= RTT_TARGET_DAYS) return 'breached';
  const remaining = RTT_TARGET_DAYS - days;
  if (remaining <= 21) return 'high';
  if (remaining <= 42) return 'medium';
  return 'low';
}

export interface RttView extends Referral {
  weeksElapsed: number;
  daysElapsed: number;
  daysToBreach: number;
  breached: boolean;
  breachRisk: BreachRisk;
  clockStopped: boolean;
  is2ww: boolean;
  twoWeekWaitBreached: boolean;
}

/** Decorate a stored referral with computed RTT fields for the worklist UI. */
export function toRttView(referral: Referral, asOf: Date = new Date()): RttView {
  const daysElapsed = rttDays(referral, asOf);
  const stopped = isClockStopped(referral.status);
  const is2ww = referral.priority === '2ww';
  return {
    ...referral,
    daysElapsed,
    weeksElapsed: Math.floor(daysElapsed / 7),
    daysToBreach: RTT_TARGET_DAYS - daysElapsed,
    breached: daysElapsed >= RTT_TARGET_DAYS,
    breachRisk: breachRisk(daysElapsed),
    clockStopped: stopped,
    is2ww,
    twoWeekWaitBreached: is2ww && !stopped && daysElapsed > TWO_WEEK_WAIT_DAYS,
  };
}
