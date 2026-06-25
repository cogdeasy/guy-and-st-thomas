import type { FastifyInstance } from 'fastify';
import type { DataStore, Validator } from '../store/store';

export interface ModuleContext {
  store: DataStore;
  /** Deterministic RNG shared by all seeds for reproducible demo data. */
  rng: () => number;
}

export interface ModuleCollection {
  name: string;
  validator?: Validator;
}

/**
 * A self-contained hospital workflow module. Drop a folder under
 * `src/modules/<id>/` whose `module.ts` default-exports one of these and it is
 * auto-discovered, its routes mounted under `/api/<id>`, and its seed run.
 *
 * Modules MUST NOT edit any shared/central file — registration is automatic.
 */
export interface HospitalModule {
  /** URL-safe id, also the route prefix: routes mount under /api/<id>. */
  id: string;
  /** Human-readable name shown in operational tooling. */
  name: string;
  description: string;
  /** Custom (non-core-ontology) collections this module owns. */
  collections?: ModuleCollection[];
  /** Register Fastify routes. They are mounted under the `/api/<id>` prefix. */
  routes?: (app: FastifyInstance, ctx: ModuleContext) => void | Promise<void>;
  /** Populate demo data. Runs once at startup after core seed. */
  seed?: (ctx: ModuleContext) => void;
}

export function defineModule(mod: HospitalModule): HospitalModule {
  return mod;
}
