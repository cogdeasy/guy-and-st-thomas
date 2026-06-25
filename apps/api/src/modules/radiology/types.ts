import { z } from 'zod';
import type { Entity } from '../../store/store';

/** Imaging modalities supported by the radiology worklist. */
export const MODALITIES = ['XR', 'CT', 'MRI', 'US'] as const;
export type ImagingModality = (typeof MODALITIES)[number];

/** Clinical priority bands, ordered routine -> urgent -> stat. */
export const PRIORITIES = ['routine', 'urgent', 'stat'] as const;
export type ImagingPriority = (typeof PRIORITIES)[number];

/** Request lifecycle states. */
export const STATUSES = ['requested', 'scheduled', 'acquired', 'reported'] as const;
export type ImagingStatus = (typeof STATUSES)[number];

const Reference = z.object({
  reference: z.string(),
  display: z.string().optional(),
});

const ImagingReport = z.object({
  findings: z.string(),
  impression: z.string(),
  reportedAt: z.string(),
  radiologist: Reference.optional(),
});

/**
 * Custom (non-core-ontology) collection owned by the radiology module. Declared
 * here so the shared ontology registry stays untouched (see AGENTS.md §4).
 */
export const ImagingRequestSchema = z.object({
  id: z.string(),
  meta: z.record(z.unknown()).optional(),
  patient: Reference,
  encounter: Reference.optional(),
  modality: z.enum(MODALITIES),
  bodyPart: z.string(),
  clinicalIndication: z.string(),
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
  requestedBy: Reference.optional(),
  requestedAt: z.string(),
  scheduledFor: z.string().optional(),
  acquiredAt: z.string().optional(),
  reportedAt: z.string().optional(),
  report: ImagingReport.optional(),
});

export type ImagingRequest = z.infer<typeof ImagingRequestSchema>;

export const ImagingRequestValidator = (input: unknown): Entity =>
  ImagingRequestSchema.parse(input) as Entity;
