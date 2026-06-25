import { z } from 'zod';

/** Delivery modes recorded on the birth record. */
export const DELIVERY_MODES = ['svd', 'instrumental', 'elective-lscs', 'emergency-lscs'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** Common antenatal risk factors flagged on the maternity pathway. */
export const RISK_FACTORS = [
  'Previous caesarean section',
  'Gestational diabetes',
  'Pre-eclampsia',
  'Advanced maternal age',
  'Raised BMI',
  'Placenta praevia',
  'Twin pregnancy',
  'Pre-existing hypertension',
  'Previous postpartum haemorrhage',
  'Reduced fetal movements',
] as const;

const Meta = z.record(z.unknown()).optional();

/**
 * A pregnancy episode tracks one woman through the antenatal → intrapartum →
 * postnatal pathway. `patient`/`midwife`/`location` are FHIR reference strings
 * (e.g. "Patient/abc") into the core store.
 */
export const PregnancyEpisodeEntity = z
  .object({
    id: z.string(),
    patient: z.string(),
    edd: z.string(),
    gestationWeeks: z.number().int().min(0).max(45),
    parity: z.number().int().min(0),
    gravida: z.number().int().min(1).optional(),
    riskFactors: z.array(z.string()).default([]),
    status: z.enum(['antenatal', 'intrapartum', 'postnatal']),
    midwife: z.string().optional(),
    location: z.string().optional(),
    bookingDate: z.string().optional(),
    admittedAt: z.string().optional(),
    meta: Meta,
  })
  .passthrough();
export type PregnancyEpisode = z.infer<typeof PregnancyEpisodeEntity>;

/** A birth outcome attached to a pregnancy episode. */
export const BirthRecordEntity = z
  .object({
    id: z.string(),
    episode: z.string(),
    patient: z.string(),
    deliveryDateTime: z.string(),
    mode: z.enum(DELIVERY_MODES),
    babyWeightGrams: z.number().int().min(200).max(7000),
    apgar1: z.number().int().min(0).max(10),
    apgar5: z.number().int().min(0).max(10),
    birthAttendant: z.string().optional(),
    meta: Meta,
  })
  .passthrough();
export type BirthRecord = z.infer<typeof BirthRecordEntity>;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Live gestation in completed weeks derived from the estimated delivery date. */
export function gestationFromEdd(edd: string, asOf: Date = new Date()): number {
  const weeksToEdd = (new Date(edd).getTime() - asOf.getTime()) / WEEK_MS;
  return Math.max(0, Math.min(42, Math.round(40 - weeksToEdd)));
}

/** Pregnancy trimester for a gestation in weeks. */
export function trimester(gestationWeeks: number): 1 | 2 | 3 {
  if (gestationWeeks < 13) return 1;
  if (gestationWeeks < 27) return 2;
  return 3;
}
