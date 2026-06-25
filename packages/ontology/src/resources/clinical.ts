import { z } from 'zod';
import { defineResource } from '../resource';
import { CodeableConcept, Period, Quantity, Reference } from '../primitives';

export const EncounterClass = z.enum([
  'inpatient',
  'outpatient',
  'emergency',
  'daycase',
  'virtual',
  'home',
]);
export type EncounterClass = z.infer<typeof EncounterClass>;

export const Encounter = defineResource('Encounter', {
  status: z
    .enum(['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled'])
    .default('planned'),
  class: EncounterClass,
  subject: Reference,
  participant: z.array(Reference).default([]),
  period: Period.optional(),
  reasonText: z.string().optional(),
  diagnosis: z.array(Reference).default([]),
  serviceProvider: Reference.optional(),
  location: Reference.optional(),
  specialty: z.string().optional(),
});
export type Encounter = z.infer<typeof Encounter>;

export const Condition = defineResource('Condition', {
  clinicalStatus: z
    .enum(['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'])
    .default('active'),
  verificationStatus: z
    .enum(['unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted'])
    .default('confirmed'),
  category: z.enum(['problem-list-item', 'encounter-diagnosis']).default('problem-list-item'),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  code: CodeableConcept,
  subject: Reference,
  encounter: Reference.optional(),
  onsetDateTime: z.string().datetime({ offset: true }).optional(),
  recordedDate: z.string().datetime({ offset: true }).optional(),
  recorder: Reference.optional(),
});
export type Condition = z.infer<typeof Condition>;

export const Observation = defineResource('Observation', {
  status: z
    .enum(['registered', 'preliminary', 'final', 'amended', 'cancelled'])
    .default('final'),
  category: z.string().optional().describe('e.g. vital-signs, laboratory, imaging'),
  code: CodeableConcept,
  subject: Reference,
  encounter: Reference.optional(),
  effectiveDateTime: z.string().datetime({ offset: true }),
  valueQuantity: Quantity.optional(),
  valueString: z.string().optional(),
  valueCodeableConcept: CodeableConcept.optional(),
  interpretation: z.enum(['normal', 'low', 'high', 'critical', 'abnormal']).optional(),
  referenceRangeText: z.string().optional(),
  performer: Reference.optional(),
});
export type Observation = z.infer<typeof Observation>;

export const Procedure = defineResource('Procedure', {
  status: z
    .enum(['preparation', 'in-progress', 'completed', 'not-done', 'stopped'])
    .default('completed'),
  code: CodeableConcept,
  subject: Reference,
  encounter: Reference.optional(),
  performedDateTime: z.string().datetime({ offset: true }).optional(),
  performer: z.array(Reference).default([]),
  bodySite: z.string().optional(),
  outcome: z.string().optional(),
});
export type Procedure = z.infer<typeof Procedure>;

export const AllergyIntolerance = defineResource('AllergyIntolerance', {
  clinicalStatus: z.enum(['active', 'inactive', 'resolved']).default('active'),
  type: z.enum(['allergy', 'intolerance']).default('allergy'),
  category: z.enum(['food', 'medication', 'environment', 'biologic']).optional(),
  criticality: z.enum(['low', 'high', 'unable-to-assess']).default('low'),
  code: CodeableConcept,
  patient: Reference,
  reactionManifestation: z.array(z.string()).default([]),
  recordedDate: z.string().datetime({ offset: true }).optional(),
});
export type AllergyIntolerance = z.infer<typeof AllergyIntolerance>;

export const CarePlan = defineResource('CarePlan', {
  status: z.enum(['draft', 'active', 'on-hold', 'completed', 'revoked']).default('active'),
  intent: z.enum(['proposal', 'plan', 'order']).default('plan'),
  title: z.string(),
  description: z.string().optional(),
  subject: Reference,
  encounter: Reference.optional(),
  period: Period.optional(),
  activities: z
    .array(z.object({ detail: z.string(), status: z.string().default('not-started') }))
    .default([]),
});
export type CarePlan = z.infer<typeof CarePlan>;
