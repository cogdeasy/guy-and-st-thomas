import { z } from 'zod';

/** A&E 4-hour operational standard (decision-to-admit/discharge clock). */
export const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;

/** Manchester Triage System acuity bands (1 = most urgent). */
export const ED_STATUSES = [
  'waiting',
  'triaged',
  'in-treatment',
  'awaiting-bed',
  'discharged',
] as const;
export type EdStatus = (typeof ED_STATUSES)[number];

export const EdStatusEnum = z.enum(ED_STATUSES);

/** Allowed forward transitions for the patient-flow state machine. */
const TRANSITIONS: Record<EdStatus, EdStatus[]> = {
  waiting: ['triaged', 'in-treatment', 'discharged'],
  triaged: ['in-treatment', 'awaiting-bed', 'discharged'],
  'in-treatment': ['awaiting-bed', 'discharged'],
  'awaiting-bed': ['discharged'],
  discharged: [],
};

export function canTransition(from: EdStatus, to: EdStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * EdAttendance — a custom collection owned by this module. Models a live
 * presence in the Emergency Department, linked to a core emergency Encounter.
 */
export const EdAttendanceSchema = z
  .object({
    id: z.string(),
    patient: z.string().describe('Patient/<id> reference'),
    patientName: z.string().optional(),
    encounter: z.string().optional().describe('Encounter/<id> reference'),
    arrivalTime: z.string(),
    chiefComplaint: z.string(),
    acuity: z.number().int().min(1).max(5).nullable().default(null),
    status: EdStatusEnum,
    assignedClinician: z.string().optional().describe('Practitioner/<id> reference'),
    assignedClinicianName: z.string().optional(),
    cubicle: z.string().optional(),
    triageTime: z.string().optional(),
    treatmentStartTime: z.string().optional(),
    dischargeTime: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type EdAttendance = z.infer<typeof EdAttendanceSchema>;

export interface BreachInfo {
  /** Whole minutes elapsed since arrival (or to discharge). */
  elapsedMinutes: number;
  /** Minutes remaining against the 4-hour standard (negative once breached). */
  minutesToBreach: number;
  breached: boolean;
}

/** Compute the 4-hour clock for an attendance relative to `now`. */
export function breachInfo(att: EdAttendance, now: number): BreachInfo {
  const end = att.dischargeTime ? Date.parse(att.dischargeTime) : now;
  const elapsedMs = end - Date.parse(att.arrivalTime);
  const elapsedMinutes = Math.round(elapsedMs / 60000);
  const minutesToBreach = Math.round((FOUR_HOUR_MS - elapsedMs) / 60000);
  return { elapsedMinutes, minutesToBreach, breached: elapsedMs > FOUR_HOUR_MS };
}
