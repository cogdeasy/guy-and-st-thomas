/**
 * NHS / GSTT terminology helpers shared across the platform.
 */

export const CodeSystems = {
  SNOMED: 'http://snomed.info/sct',
  ICD10: 'http://hl7.org/fhir/sid/icd-10',
  LOINC: 'http://loinc.org',
  NHS_NUMBER: 'https://fhir.nhs.uk/Id/nhs-number',
  GSTT_MRN: 'https://fhir.gstt.nhs.uk/Id/mrn',
  ODS: 'https://fhir.nhs.uk/Id/ods-organization-code',
  DMD: 'https://dmd.nhs.uk',
} as const;

/** Guy's and St Thomas' NHS Foundation Trust sites. */
export const GSTT_SITES = [
  "Guy's Hospital",
  "St Thomas' Hospital",
  'Evelina London Children\u2019s Hospital',
  'Royal Brompton Hospital',
  'Harefield Hospital',
] as const;
export type GsttSite = (typeof GSTT_SITES)[number];

export const SPECIALTIES = [
  'Emergency Medicine',
  'General Medicine',
  'General Surgery',
  'Cardiology',
  'Cardiac Surgery',
  'Respiratory Medicine',
  'Critical Care',
  'Obstetrics & Gynaecology',
  'Paediatrics',
  'Neonatology',
  'Oncology',
  'Haematology',
  'Renal Medicine',
  'Orthopaedics',
  'Neurology',
  'Gastroenterology',
  'Endocrinology',
  'Dermatology',
  'Ophthalmology',
  'Urology',
  'Vascular Surgery',
  'Anaesthetics',
  'Radiology',
  'Pathology',
  'Pharmacy',
] as const;

/**
 * Validate an NHS number using the Modulus 11 check-digit algorithm.
 * Accepts strings with or without spaces (e.g. "943 476 5919").
 */
export function isValidNhsNumber(input: string): boolean {
  const digits = input.replace(/\s/g, '');
  if (!/^\d{10}$/.test(digits)) return false;
  const nums = digits.split('').map((d) => Number(d));
  let total = 0;
  for (let i = 0; i < 9; i++) {
    total += (nums[i] as number) * (10 - i);
  }
  const remainder = total % 11;
  let check = 11 - remainder;
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === nums[9];
}

/** Generate a valid random NHS number (for seed data only). */
export function generateNhsNumber(rng: () => number = Math.random): string {
  for (;;) {
    let base = '';
    for (let i = 0; i < 9; i++) base += Math.floor(rng() * 10).toString();
    const nums = base.split('').map(Number);
    let total = 0;
    for (let i = 0; i < 9; i++) total += (nums[i] as number) * (10 - i);
    const remainder = total % 11;
    let check = 11 - remainder;
    if (check === 11) check = 0;
    if (check === 10) continue;
    return base + check.toString();
  }
}

export interface News2Vitals {
  respiratoryRate: number;
  spo2: number;
  onOxygen: boolean;
  systolicBp: number;
  pulse: number;
  /** 'A' = Alert, or V/P/U (any of these scores 3) */
  consciousness: 'A' | 'V' | 'P' | 'U';
  temperature: number;
}

export interface News2Result {
  score: number;
  risk: 'low' | 'low-medium' | 'medium' | 'high';
  breakdown: Record<string, number>;
  recommendation: string;
}

/**
 * Compute the National Early Warning Score 2 (NEWS2), the RCP standard used
 * across the NHS to detect clinical deterioration. Uses Scale 1.
 */
export function calculateNews2(v: News2Vitals): News2Result {
  const breakdown: Record<string, number> = {};

  breakdown.respiratoryRate =
    v.respiratoryRate <= 8 ? 3 : v.respiratoryRate <= 11 ? 1 : v.respiratoryRate <= 20 ? 0 : v.respiratoryRate <= 24 ? 2 : 3;

  breakdown.spo2 = v.spo2 >= 96 ? 0 : v.spo2 >= 94 ? 1 : v.spo2 >= 92 ? 2 : 3;

  breakdown.oxygen = v.onOxygen ? 2 : 0;

  breakdown.systolicBp =
    v.systolicBp <= 90 ? 3 : v.systolicBp <= 100 ? 2 : v.systolicBp <= 110 ? 1 : v.systolicBp <= 219 ? 0 : 3;

  breakdown.pulse =
    v.pulse <= 40 ? 3 : v.pulse <= 50 ? 1 : v.pulse <= 90 ? 0 : v.pulse <= 110 ? 1 : v.pulse <= 130 ? 2 : 3;

  breakdown.consciousness = v.consciousness === 'A' ? 0 : 3;

  breakdown.temperature =
    v.temperature <= 35.0 ? 3 : v.temperature <= 36.0 ? 1 : v.temperature <= 38.0 ? 0 : v.temperature <= 39.0 ? 1 : 2;

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const hasThree = Object.values(breakdown).some((s) => s === 3);

  let risk: News2Result['risk'];
  let recommendation: string;
  if (score >= 7) {
    risk = 'high';
    recommendation = 'Emergency response — continuous monitoring; urgent critical care review.';
  } else if (score >= 5 || hasThree) {
    risk = 'medium';
    recommendation = 'Urgent review by clinician; minimum hourly observations.';
  } else if (score >= 1) {
    risk = 'low-medium';
    recommendation = 'Assess by registered nurse; observations every 4\u20136 hours.';
  } else {
    risk = 'low';
    recommendation = 'Routine monitoring; observations every 12 hours.';
  }

  return { score, risk, breakdown, recommendation };
}

/** 18-week Referral To Treatment pathway status (NHS access standard). */
export const RTT_STATUSES = [
  'referral-received',
  'first-appointment',
  'diagnostics',
  'decision-to-treat',
  'treatment',
  'discharged',
] as const;
export type RttStatus = (typeof RTT_STATUSES)[number];
