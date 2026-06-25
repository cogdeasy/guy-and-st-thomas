import { z } from 'zod';

/** Lifecycle of a discharge summary as it moves through the discharge pathway. */
export const DISCHARGE_STATUSES = ['draft', 'pending-pharmacy', 'completed'] as const;
export type DischargeStatus = (typeof DISCHARGE_STATUSES)[number];

/** A single "to take out" (TTO) medication line. */
export const TtoMed = z.object({
  medication: z.string().min(1),
  dose: z.string().min(1),
  route: z.string().default('Oral'),
  frequency: z.string().min(1),
  quantity: z.string().optional(),
});
export type TtoMed = z.infer<typeof TtoMed>;

/**
 * Custom (non-ontology) collection owned by this module. Stored documents carry
 * the store-generated `id`/`meta`; references are FHIR-style strings built with
 * `ref('Patient', id)` so they resolve against the core store.
 */
export const DischargeSummarySchema = z.object({
  id: z.string(),
  resourceType: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  patient: z.string().min(1).describe('Patient reference, e.g. "Patient/abc"'),
  encounter: z.string().min(1).describe('Encounter reference, e.g. "Encounter/abc"'),
  status: z.enum(DISCHARGE_STATUSES).default('draft'),
  diagnosis: z.string().default(''),
  ttoMeds: z.array(TtoMed).default([]),
  followUp: z.string().default(''),
  gpLetterGenerated: z.boolean().default(false),
  pharmacist: z.string().optional().describe('Practitioner reference performing the clinical check'),
  updatedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type DischargeSummary = z.infer<typeof DischargeSummarySchema>;

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export interface Checklist {
  items: ChecklistItem[];
  complete: number;
  total: number;
  ready: boolean;
}

/** Derive the discharge readiness checklist from a summary's current state. */
export function buildChecklist(summary: DischargeSummary): Checklist {
  const items: ChecklistItem[] = [
    { key: 'diagnosis', label: 'Discharge diagnosis documented', done: summary.diagnosis.trim().length > 0 },
    { key: 'tto', label: 'TTO medications reconciled', done: summary.ttoMeds.length > 0 },
    { key: 'followUp', label: 'Follow-up arranged', done: summary.followUp.trim().length > 0 },
    { key: 'gpLetter', label: 'GP discharge letter generated', done: summary.gpLetterGenerated },
  ];
  const complete = items.filter((i) => i.done).length;
  return { items, complete, total: items.length, ready: complete === items.length };
}
