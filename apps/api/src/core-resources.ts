import type { FastifyInstance } from 'fastify';
import { RESOURCE_TYPES, isResourceType } from '@trustos/ontology';
import { ApiError } from '@trustos/core';
import type { ModuleContext } from './modules/types';

/**
 * Generic FHIR-style REST surface for every core resource type:
 *   GET    /api/fhir/:type           (list, with ?field=value filters)
 *   POST   /api/fhir/:type           (create)
 *   GET    /api/fhir/:type/:id        (read)
 *   PUT    /api/fhir/:type/:id        (update)
 *   DELETE /api/fhir/:type/:id        (delete)
 *
 * Modules build richer workflow endpoints on top, but never need boilerplate
 * CRUD for the shared ontology.
 */
export function registerCoreResourceRoutes(app: FastifyInstance, ctx: ModuleContext): void {
  const { store } = ctx;

  app.get('/api/fhir/_types', async () => ({
    resourceTypes: RESOURCE_TYPES,
    counts: Object.fromEntries(RESOURCE_TYPES.map((t) => [t, store.count(t)])),
  }));

  app.get<{ Params: { type: string }; Querystring: Record<string, string> }>(
    '/api/fhir/:type',
    async (req) => {
      const { type } = req.params;
      assertType(type);
      return { resourceType: 'Bundle', total: undefined, entry: store.list(type, req.query) };
    },
  );

  app.post<{ Params: { type: string }; Body: Record<string, unknown> }>(
    '/api/fhir/:type',
    async (req, reply) => {
      const { type } = req.params;
      assertType(type);
      const created = store.create(type, req.body ?? {});
      reply.code(201);
      return created;
    },
  );

  app.get<{ Params: { type: string; id: string } }>('/api/fhir/:type/:id', async (req) => {
    const { type, id } = req.params;
    assertType(type);
    return store.getOrThrow(type, id);
  });

  app.put<{ Params: { type: string; id: string }; Body: Record<string, unknown> }>(
    '/api/fhir/:type/:id',
    async (req) => {
      const { type, id } = req.params;
      assertType(type);
      return store.update(type, id, req.body ?? {});
    },
  );

  app.delete<{ Params: { type: string; id: string } }>('/api/fhir/:type/:id', async (req) => {
    const { type, id } = req.params;
    assertType(type);
    const removed = store.remove(type, id);
    return { removed };
  });
}

function assertType(type: string): asserts type {
  if (!isResourceType(type)) {
    throw new ApiError(404, `Unknown resource type: ${type}`, 'unknown_type');
  }
}
