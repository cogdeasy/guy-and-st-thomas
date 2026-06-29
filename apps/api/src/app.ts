import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import { ApiError, mulberry32 } from '@trustos/core';
import { DataStore } from './store/store';
import { registerCoreResourceRoutes } from './core-resources';
import { registerModules, seedModules, type RegisteredModule } from './modules/registry';
import type { ModuleContext } from './modules/types';
import { seedCore } from './seed';

/**
 * Demo data is anchored to a single instant captured at process start so that
 * every seeded timestamp is reproducible across builds within a process (e.g.
 * the API server, or two `buildApp` calls in one test) while staying fresh
 * relative to when the server started.
 */
const SEED_CLOCK = Date.now();

/** Run `fn` with the global clock frozen at {@link SEED_CLOCK}. */
function withFrozenClock<T>(fn: () => T): T {
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(...args: [] | [value: number | string | Date]) {
      if (args.length === 0) super(SEED_CLOCK);
      else super(args[0]);
    }
    static override now(): number {
      return SEED_CLOCK;
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

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

  // Ids draw from a dedicated deterministic stream so generated ids are
  // reproducible across builds without perturbing each module's seed sequence.
  const store = new DataStore(mulberry32(seedValue + 1));
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
    withFrozenClock(() => seedCore(ctx));
  }

  // Platform meta endpoints.
  app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }));
  let registered: RegisteredModule[] = [];
  app.get('/api/modules', async () => ({ modules: registered }));

  registerCoreResourceRoutes(app, ctx);
  registered = await registerModules(app, ctx);
  if (seed) {
    withFrozenClock(() => seedModules(ctx));
  }

  return { app, store, modules: registered };
}
