import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from './types';
import { modules } from './_generated';

export interface RegisteredModule {
  id: string;
  name: string;
  description: string;
}

/** Register every discovered module's collections, routes and seed. */
export async function registerModules(
  app: FastifyInstance,
  ctx: ModuleContext,
): Promise<RegisteredModule[]> {
  const registered: RegisteredModule[] = [];
  const ids = new Set<string>();

  for (const mod of modules) {
    if (ids.has(mod.id)) {
      throw new Error(`Duplicate module id: ${mod.id}`);
    }
    ids.add(mod.id);

    for (const col of mod.collections ?? []) {
      ctx.store.registerCollection(col.name, col.validator);
    }

    if (mod.routes) {
      await app.register(
        async (instance) => {
          await mod.routes!(instance, ctx);
        },
        { prefix: `/api/${mod.id}` },
      );
    }

    registered.push({ id: mod.id, name: mod.name, description: mod.description });
  }

  // Seeds run after all collections are registered so cross-module refs resolve.
  for (const mod of modules) {
    mod.seed?.(ctx);
  }

  app.log.info(`Registered ${registered.length} hospital module(s)`);
  return registered;
}
