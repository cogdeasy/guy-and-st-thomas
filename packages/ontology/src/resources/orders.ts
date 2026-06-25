import { z } from 'zod';
import { defineResource } from '../resource';
import { CodeableConcept, Period, Reference } from '../primitives';

export const RequestPriority = z.enum(['routine', 'urgent', 'asap', 'stat']);
export type RequestPriority = z.infer<typeof RequestPriority>;

/** Orders for diagnostics/procedures: pathology, radiology, referrals, etc. */
export const ServiceRequest = defineResource('ServiceRequest', {
  status: z
    .enum(['draft', 'active', 'on-hold', 'completed', 'revoked', 'entered-in-error'])
    .default('active'),
  intent: z.enum(['proposal', 'plan', 'order']).default('order'),
  priority: RequestPriority.default('routine'),
  category: z.string().optional().describe('e.g. laboratory, imaging, referral, procedure'),
  code: CodeableConcept,
  subject: Reference,
  encounter: Reference.optional(),
  requester: Reference.optional(),
  performer: Reference.optional(),
  authoredOn: z.string().datetime({ offset: true }).optional(),
  occurrenceDateTime: z.string().datetime({ offset: true }).optional(),
  reasonText: z.string().optional(),
});
export type ServiceRequest = z.infer<typeof ServiceRequest>;

export const Dosage = z.object({
  text: z.string(),
  route: z.string().optional(),
  doseQuantity: z.string().optional(),
  frequency: z.string().optional(),
  asNeeded: z.boolean().default(false),
});
export type Dosage = z.infer<typeof Dosage>;

/** Electronic Prescribing & Medicines Administration (EPMA). */
export const MedicationRequest = defineResource('MedicationRequest', {
  status: z
    .enum(['active', 'on-hold', 'cancelled', 'completed', 'stopped', 'draft'])
    .default('active'),
  intent: z.enum(['proposal', 'plan', 'order']).default('order'),
  priority: RequestPriority.default('routine'),
  medication: CodeableConcept,
  subject: Reference,
  encounter: Reference.optional(),
  requester: Reference.optional(),
  authoredOn: z.string().datetime({ offset: true }).optional(),
  dosageInstruction: z.array(Dosage).default([]),
  dispenseQuantity: z.string().optional(),
  courseOfTherapyType: z.enum(['acute', 'continuous', 'stat']).default('acute'),
});
export type MedicationRequest = z.infer<typeof MedicationRequest>;

export const MedicationAdministration = defineResource('MedicationAdministration', {
  status: z
    .enum(['in-progress', 'completed', 'not-done', 'on-hold', 'stopped'])
    .default('completed'),
  medication: CodeableConcept,
  subject: Reference,
  request: Reference.optional(),
  effectiveDateTime: z.string().datetime({ offset: true }),
  performer: Reference.optional(),
  dosageText: z.string().optional(),
  notGivenReason: z.string().optional(),
});
export type MedicationAdministration = z.infer<typeof MedicationAdministration>;

export const DiagnosticReport = defineResource('DiagnosticReport', {
  status: z
    .enum(['registered', 'partial', 'preliminary', 'final', 'amended', 'cancelled'])
    .default('final'),
  category: z.string().optional().describe('e.g. LAB, RAD, PATH'),
  code: CodeableConcept,
  subject: Reference,
  encounter: Reference.optional(),
  basedOn: Reference.optional().describe('The ServiceRequest this fulfils'),
  effectiveDateTime: z.string().datetime({ offset: true }).optional(),
  issued: z.string().datetime({ offset: true }).optional(),
  performer: Reference.optional(),
  result: z.array(Reference).default([]).describe('Observation references'),
  conclusion: z.string().optional(),
});
export type DiagnosticReport = z.infer<typeof DiagnosticReport>;

export const Appointment = defineResource('Appointment', {
  status: z
    .enum(['proposed', 'booked', 'arrived', 'fulfilled', 'cancelled', 'noshow', 'waitlist'])
    .default('booked'),
  serviceType: z.string().optional(),
  specialty: z.string().optional(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  subject: Reference,
  practitioner: Reference.optional(),
  location: Reference.optional(),
  description: z.string().optional(),
});
export type Appointment = z.infer<typeof Appointment>;

/** Workflow task — drives the clinician/operational Inbox across modules. */
export const Task = defineResource('Task', {
  status: z
    .enum(['requested', 'received', 'accepted', 'in-progress', 'completed', 'cancelled'])
    .default('requested'),
  priority: RequestPriority.default('routine'),
  intent: z.enum(['unknown', 'proposal', 'plan', 'order']).default('order'),
  code: z.string().describe('Task type, e.g. review-result, sign-discharge, chase-referral'),
  description: z.string(),
  for: Reference.optional().describe('Patient the task concerns'),
  owner: Reference.optional().describe('Assigned practitioner/team'),
  authoredOn: z.string().datetime({ offset: true }).optional(),
  executionPeriod: Period.optional(),
});
export type Task = z.infer<typeof Task>;
