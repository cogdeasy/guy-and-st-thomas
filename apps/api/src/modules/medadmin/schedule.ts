/**
 * Medication Administration (eMAR) — scheduling primitives.
 *
 * The NHS drug round runs to a notional ward schedule: each prescription has a
 * frequency code (OD/BD/TDS/QDS/NOCTE) that maps to fixed administration times.
 * These pure helpers turn an active prescription into the concrete dose "slots"
 * a nurse is expected to action, and classify each slot relative to the clock.
 */

export type FrequencyCode = 'OD' | 'BD' | 'TDS' | 'QDS' | 'NOCTE';

/** Scheduled administration times (UTC, 24h) for each frequency. */
export const FREQUENCY_TIMES: Record<FrequencyCode, string[]> = {
  OD: ['08:00'],
  BD: ['08:00', '20:00'],
  TDS: ['08:00', '14:00', '22:00'],
  QDS: ['06:00', '12:00', '18:00', '22:00'],
  NOCTE: ['22:00'],
};

export const FREQUENCY_LABELS: Record<FrequencyCode, string> = {
  OD: 'Once daily (OD)',
  BD: 'Twice daily (BD)',
  TDS: 'Three times daily (TDS)',
  QDS: 'Four times daily (QDS)',
  NOCTE: 'At night (NOCTE)',
};

export function isFrequencyCode(value: string | undefined): value is FrequencyCode {
  return (
    value === 'OD' || value === 'BD' || value === 'TDS' || value === 'QDS' || value === 'NOCTE'
  );
}

export interface FormularyEntry {
  /** Notional dm+d concept id. */
  code: string;
  display: string;
  route: string;
  dose: string;
  frequency: FrequencyCode;
}

/** A small, clinically credible inpatient formulary for demo prescriptions. */
export const FORMULARY: FormularyEntry[] = [
  {
    code: '322236009',
    display: 'Paracetamol 1g tablets',
    route: 'Oral',
    dose: '1 g',
    frequency: 'QDS',
  },
  {
    code: '746551000',
    display: 'Amoxicillin 500mg capsules',
    route: 'Oral',
    dose: '500 mg',
    frequency: 'TDS',
  },
  {
    code: '108600007',
    display: 'Enoxaparin 40mg/0.4ml injection',
    route: 'Subcutaneous',
    dose: '40 mg',
    frequency: 'OD',
  },
  {
    code: '318586007',
    display: 'Bisoprolol 2.5mg tablets',
    route: 'Oral',
    dose: '2.5 mg',
    frequency: 'OD',
  },
  {
    code: '317314001',
    display: 'Omeprazole 20mg gastro-resistant capsules',
    route: 'Oral',
    dose: '20 mg',
    frequency: 'OD',
  },
  {
    code: '317970009',
    display: 'Furosemide 40mg tablets',
    route: 'Oral',
    dose: '40 mg',
    frequency: 'BD',
  },
  {
    code: '325278007',
    display: 'Metformin 500mg tablets',
    route: 'Oral',
    dose: '500 mg',
    frequency: 'BD',
  },
  {
    code: '321988006',
    display: 'Codeine 30mg tablets',
    route: 'Oral',
    dose: '30 mg',
    frequency: 'QDS',
  },
  {
    code: '320169005',
    display: 'Salbutamol 2.5mg/2.5ml nebuliser solution',
    route: 'Nebulised',
    dose: '2.5 mg',
    frequency: 'QDS',
  },
  {
    code: '376698008',
    display: 'Atorvastatin 40mg tablets',
    route: 'Oral',
    dose: '40 mg',
    frequency: 'NOCTE',
  },
  {
    code: '376461008',
    display: 'Dalteparin 5,000 units injection',
    route: 'Subcutaneous',
    dose: '5,000 units',
    frequency: 'OD',
  },
  {
    code: '319773006',
    display: 'Paracetamol 1g/100ml infusion',
    route: 'Intravenous',
    dose: '1 g',
    frequency: 'TDS',
  },
];

/** Standard NHS eMAR non-administration (omission) reason codes. */
export const OMISSION_REASONS = [
  { code: 'patient-refused', display: 'Patient refused' },
  { code: 'nil-by-mouth', display: 'Patient nil by mouth' },
  { code: 'not-available', display: 'Drug not available / out of stock' },
  { code: 'clinical-decision', display: 'Withheld on clinical advice' },
  { code: 'patient-away', display: 'Patient away from ward' },
  { code: 'asleep', display: 'Patient asleep' },
  { code: 'unwell', display: 'Patient nauseated / vomiting' },
  { code: 'route-unavailable', display: 'Access / route unavailable' },
] as const;

export type OmissionReasonCode = (typeof OMISSION_REASONS)[number]['code'];

export function omissionReason(code: string): { code: string; display: string } | undefined {
  return OMISSION_REASONS.find((r) => r.code === code);
}

export type DoseStatus = 'overdue' | 'due' | 'upcoming' | 'given' | 'omitted';

/** Display ordering for a worklist: act on the most urgent first. */
export const STATUS_ORDER: Record<DoseStatus, number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  given: 3,
  omitted: 4,
};

/** A dose is "due" within ±60 min of its scheduled time. */
export const DUE_WINDOW_MS = 60 * 60 * 1000;
/** An administration counts towards a slot if within ±2h of it. */
export const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Expand a frequency into the concrete scheduled-dose timestamps that fall
 * within [from, to], anchored on the UTC day containing `now`.
 */
export function scheduleSlots(frequency: FrequencyCode, from: Date, to: Date, now: Date): string[] {
  const times = FREQUENCY_TIMES[frequency];
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const out: string[] = [];
  for (let dayOffset = -1; dayOffset <= 1; dayOffset++) {
    for (const time of times) {
      const [hh, mm] = time.split(':').map(Number);
      const slot = new Date(startOfDay);
      slot.setUTCDate(slot.getUTCDate() + dayOffset);
      slot.setUTCHours(hh ?? 0, mm ?? 0, 0, 0);
      if (slot >= from && slot <= to) out.push(slot.toISOString());
    }
  }
  return out.sort();
}

/** Classify an un-actioned slot relative to the current time. */
export function slotStatus(
  slotMs: number,
  nowMs: number,
): Exclude<DoseStatus, 'given' | 'omitted'> {
  if (slotMs > nowMs + DUE_WINDOW_MS) return 'upcoming';
  if (slotMs >= nowMs - DUE_WINDOW_MS) return 'due';
  return 'overdue';
}

/** Stable, dependency-free hash used to assign patients to a notional ward. */
export function hashId(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Compose the stable id for a single scheduled dose. */
export function slotId(requestId: string, slotIso: string): string {
  return `${requestId}::${slotIso}`;
}
