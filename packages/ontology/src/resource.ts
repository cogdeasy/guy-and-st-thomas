import { z } from 'zod';
import { ResourceMeta } from './primitives';

/**
 * Base shape shared by every resource in the system. Concrete resource schemas
 * extend this with `resourceType` set to a literal and their own fields.
 */
export const ResourceBase = z.object({
  resourceType: z.string(),
  id: z.string(),
  meta: ResourceMeta.optional(),
});
export type ResourceBase = z.infer<typeof ResourceBase>;

/** Helper to declare a resource schema with a fixed `resourceType` literal. */
export function defineResource<T extends z.ZodRawShape>(resourceType: string, shape: T) {
  return z
    .object({
      resourceType: z.literal(resourceType),
      id: z.string(),
      meta: ResourceMeta.optional(),
    })
    .extend(shape);
}
