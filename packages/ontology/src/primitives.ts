import { z } from 'zod';

/**
 * FHIR R4-aligned primitive and common datatypes.
 * These are intentionally pragmatic — a clinically meaningful subset that the
 * whole TrustOS platform shares so every module speaks the same language.
 */

export const Coding = z.object({
  system: z.string().describe('Code system URI, e.g. http://snomed.info/sct'),
  code: z.string(),
  display: z.string().optional(),
});
export type Coding = z.infer<typeof Coding>;

export const CodeableConcept = z.object({
  coding: z.array(Coding).default([]),
  text: z.string().optional(),
});
export type CodeableConcept = z.infer<typeof CodeableConcept>;

export const Identifier = z.object({
  system: z.string().optional(),
  value: z.string(),
  use: z.enum(['usual', 'official', 'temp', 'secondary', 'old']).optional(),
});
export type Identifier = z.infer<typeof Identifier>;

export const Period = z.object({
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
});
export type Period = z.infer<typeof Period>;

export const Quantity = z.object({
  value: z.number(),
  unit: z.string().optional(),
  system: z.string().optional(),
  code: z.string().optional(),
});
export type Quantity = z.infer<typeof Quantity>;

export const HumanName = z.object({
  use: z.enum(['usual', 'official', 'temp', 'nickname', 'maiden']).optional(),
  family: z.string(),
  given: z.array(z.string()).default([]),
  prefix: z.array(z.string()).optional(),
});
export type HumanName = z.infer<typeof HumanName>;

export const ContactPoint = z.object({
  system: z.enum(['phone', 'email', 'fax', 'pager', 'url', 'sms', 'other']),
  value: z.string(),
  use: z.enum(['home', 'work', 'temp', 'old', 'mobile']).optional(),
});
export type ContactPoint = z.infer<typeof ContactPoint>;

export const Address = z.object({
  use: z.enum(['home', 'work', 'temp', 'old', 'billing']).optional(),
  line: z.array(z.string()).default([]),
  city: z.string().optional(),
  district: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().default('United Kingdom'),
});
export type Address = z.infer<typeof Address>;

/** A typed reference to another resource, e.g. { reference: "Patient/abc", display: "Jane Doe" } */
export const Reference = z.object({
  reference: z.string().describe('ResourceType/id'),
  display: z.string().optional(),
});
export type Reference = z.infer<typeof Reference>;

export const AdministrativeGender = z.enum(['male', 'female', 'other', 'unknown']);
export type AdministrativeGender = z.infer<typeof AdministrativeGender>;

/** Metadata attached to every stored resource. */
export const ResourceMeta = z.object({
  versionId: z.string().optional(),
  lastUpdated: z.string().datetime({ offset: true }).optional(),
  source: z.string().optional(),
});
export type ResourceMeta = z.infer<typeof ResourceMeta>;
