import type { z } from 'zod';
import { Patient, Practitioner, RelatedPerson } from './resources/people';
import { Location, Organization } from './resources/org';
import {
  AllergyIntolerance,
  CarePlan,
  Condition,
  Encounter,
  Observation,
  Procedure,
} from './resources/clinical';
import {
  Appointment,
  DiagnosticReport,
  MedicationAdministration,
  MedicationRequest,
  ServiceRequest,
  Task,
} from './resources/orders';

/**
 * Central registry mapping resourceType -> Zod schema. The generic backend
 * store and the typed API client both read from this, so adding a core
 * resource here makes it instantly available as a REST collection.
 */
export const ResourceSchemas = {
  Patient,
  Practitioner,
  RelatedPerson,
  Organization,
  Location,
  Encounter,
  Condition,
  Observation,
  Procedure,
  AllergyIntolerance,
  CarePlan,
  ServiceRequest,
  MedicationRequest,
  MedicationAdministration,
  DiagnosticReport,
  Appointment,
  Task,
} as const;

export type ResourceType = keyof typeof ResourceSchemas;

export const RESOURCE_TYPES = Object.keys(ResourceSchemas) as ResourceType[];

export type ResourceOf<T extends ResourceType> = z.infer<(typeof ResourceSchemas)[T]>;

export type AnyResource = {
  [K in ResourceType]: ResourceOf<K>;
}[ResourceType];

export function isResourceType(value: string): value is ResourceType {
  return Object.prototype.hasOwnProperty.call(ResourceSchemas, value);
}

export function getSchema(resourceType: ResourceType) {
  return ResourceSchemas[resourceType];
}
