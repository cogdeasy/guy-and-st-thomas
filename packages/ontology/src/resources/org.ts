import { z } from 'zod';
import { defineResource } from '../resource';
import { Address, Identifier, Reference } from '../primitives';

export const Organization = defineResource('Organization', {
  identifier: z.array(Identifier).default([]),
  active: z.boolean().default(true),
  name: z.string(),
  type: z.string().optional().describe('e.g. NHS Foundation Trust, Department'),
  partOf: Reference.optional(),
  address: z.array(Address).default([]),
});
export type Organization = z.infer<typeof Organization>;

export const LocationType = z.enum([
  'site',
  'building',
  'ward',
  'bay',
  'bed',
  'room',
  'theatre',
  'clinic',
  'department',
]);
export type LocationType = z.infer<typeof LocationType>;

export const Location = defineResource('Location', {
  identifier: z.array(Identifier).default([]),
  status: z.enum(['active', 'suspended', 'inactive']).default('active'),
  name: z.string(),
  physicalType: LocationType,
  /** For beds/bays: current operational state. */
  operationalStatus: z
    .enum(['available', 'occupied', 'closed', 'cleaning', 'reserved'])
    .optional(),
  managingOrganization: Reference.optional(),
  partOf: Reference.optional().describe('Parent location (bed -> bay -> ward -> site)'),
});
export type Location = z.infer<typeof Location>;
