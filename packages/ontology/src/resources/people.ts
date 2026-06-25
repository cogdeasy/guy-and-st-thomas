import { z } from 'zod';
import { defineResource } from '../resource';
import {
  Address,
  AdministrativeGender,
  CodeableConcept,
  ContactPoint,
  HumanName,
  Identifier,
  Reference,
} from '../primitives';

export const Patient = defineResource('Patient', {
  identifier: z.array(Identifier).default([]),
  active: z.boolean().default(true),
  name: z.array(HumanName).default([]),
  telecom: z.array(ContactPoint).default([]),
  gender: AdministrativeGender.default('unknown'),
  birthDate: z.string().describe('ISO date YYYY-MM-DD'),
  deceasedDateTime: z.string().datetime({ offset: true }).optional(),
  address: z.array(Address).default([]),
  maritalStatus: CodeableConcept.optional(),
  generalPractitioner: z.array(Reference).default([]),
  managingOrganization: Reference.optional(),
  /** GSTT-specific demographics commonly surfaced in the EPR banner. */
  ethnicity: z.string().optional(),
  preferredLanguage: z.string().optional(),
  interpreterRequired: z.boolean().default(false),
});
export type Patient = z.infer<typeof Patient>;

export const Practitioner = defineResource('Practitioner', {
  identifier: z.array(Identifier).default([]),
  active: z.boolean().default(true),
  name: z.array(HumanName).default([]),
  telecom: z.array(ContactPoint).default([]),
  gender: AdministrativeGender.optional(),
  /** e.g. Consultant, Registrar, Staff Nurse, Pharmacist */
  role: z.string().optional(),
  specialty: z.string().optional(),
  gmcNumber: z.string().optional().describe('GMC / NMC / GPhC registration number'),
});
export type Practitioner = z.infer<typeof Practitioner>;

export const RelatedPerson = defineResource('RelatedPerson', {
  patient: Reference,
  relationship: CodeableConcept.optional(),
  name: z.array(HumanName).default([]),
  telecom: z.array(ContactPoint).default([]),
});
export type RelatedPerson = z.infer<typeof RelatedPerson>;
