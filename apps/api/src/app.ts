import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import { ApiError, mulberry32 } from '@trustos/core';
import { DataStore } from './store/store';
import { registerCoreResourceRoutes } from './core-resources';
import { registerModules, type RegisteredModule } from './modules/registry';
import type { ModuleContext } from './modules/types';
import { seedCore } from './seed';

export interface BuiltApp {
  app: FastifyInstance;
  store: DataStore;
  modules: RegisteredModule[];
}

export interface BuildOptions {
  logger?: boolean;
  seed?: boolean;
  seedValue?: number;
}

export async function buildApp(opts: BuildOptions = {}): Promise<BuiltApp> {
  const { logger = false, seed = true, seedValue = 42 } = opts;
  const app = Fastify({ logger });

  await app.register(cors, { origin: true });
  await app.register(sensible);

  const store = new DataStore();
  const ctx: ModuleContext = { store, rng: mulberry32(seedValue) };

  app.setErrorHandler((error: FastifyError, _req, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.status).send(error.toProblem());
      return;
    }
    if (error instanceof ZodError) {
      reply.code(400).send({ status: 400, title: 'Validation failed', issues: error.issues });
      return;
    }
    app.log.error(error);
    reply.code(error.statusCode ?? 500).send({
      status: error.statusCode ?? 500,
      title: error.message || 'Internal Server Error',
    });
  });

  if (seed) {
    seedCore(ctx);
  }

  // Platform meta endpoints.
  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));
  let registered: RegisteredModule[] = [];
  app.get('/api/modules', async () => ({ modules: registered }));

  registerCoreResourceRoutes(app, ctx);
  registered = await registerModules(app, ctx);

  return { app, store, modules: registered };
}
