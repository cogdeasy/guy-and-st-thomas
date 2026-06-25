import { randomId, nowIso, type AuditEvent } from '@trustos/core';
import { ResourceSchemas, isResourceType, type ResourceType } from '@trustos/ontology';
import { NotFound } from '@trustos/core';

export type Entity = { id: string; resourceType?: string; meta?: Record<string, unknown> } & Record<
  string,
  unknown
>;

export type Validator = (input: unknown) => Entity;

/**
 * In-memory document store keyed by collection name. Core FHIR resource types
 * are auto-registered with Zod validation; modules may register their own
 * collections (e.g. BedRequest, TheatreList) with or without a validator.
 *
 * Chosen over a SQL layer deliberately: zero migration coupling means dozens of
 * modules can be developed in parallel without touching a shared schema file.
 */
export class DataStore {
  private data = new Map<string, Map<string, Entity>>();
  private validators = new Map<string, Validator>();
  private auditLog: AuditEvent[] = [];
  private readonly idRng: () => number;

  /**
   * @param idRng source of randomness for generated ids. Pass the seeded rng
   * so demo data is reproducible across builds; defaults to Math.random.
   */
  constructor(idRng: () => number = Math.random) {
    this.idRng = idRng;
    for (const type of Object.keys(ResourceSchemas) as ResourceType[]) {
      this.registerCollection(type, (input) => ResourceSchemas[type].parse(input) as Entity);
    }
  }

  registerCollection(name: string, validator?: Validator): void {
    if (!this.data.has(name)) this.data.set(name, new Map());
    if (validator) this.validators.set(name, validator);
  }

  private map(name: string): Map<string, Entity> {
    let m = this.data.get(name);
    if (!m) {
      m = new Map();
      this.data.set(name, m);
    }
    return m;
  }

  collections(): string[] {
    return [...this.data.keys()].sort();
  }

  create<T extends Entity = Entity>(name: string, input: Record<string, unknown>): T {
    const id = (input.id as string) || randomId(name.toLowerCase().slice(0, 3), this.idRng);
    const withMeta = {
      ...input,
      id,
      ...(isResourceType(name) ? { resourceType: name } : {}),
      meta: { ...(input.meta as object), lastUpdated: nowIso(), versionId: '1' },
    };
    const validator = this.validators.get(name);
    const entity = (validator ? validator(withMeta) : withMeta) as T;
    this.map(name).set(id, entity);
    return entity;
  }

  /** Insert a pre-built entity (used by seeds) without re-generating ids. */
  put<T extends Entity = Entity>(name: string, entity: T): T {
    this.map(name).set(entity.id, entity);
    return entity;
  }

  get<T extends Entity = Entity>(name: string, id: string): T | undefined {
    return this.map(name).get(id) as T | undefined;
  }

  getOrThrow<T extends Entity = Entity>(name: string, id: string): T {
    const found = this.get<T>(name, id);
    if (!found) throw NotFound(`${name}/${id}`);
    return found;
  }

  update<T extends Entity = Entity>(name: string, id: string, patch: Record<string, unknown>): T {
    const existing = this.getOrThrow<T>(name, id);
    const versionId = String(Number((existing.meta?.versionId as string) ?? '1') + 1);
    const merged = {
      ...existing,
      ...patch,
      id,
      meta: { ...existing.meta, lastUpdated: nowIso(), versionId },
    };
    const validator = this.validators.get(name);
    const entity = (validator ? validator(merged) : merged) as T;
    this.map(name).set(id, entity);
    return entity;
  }

  remove(name: string, id: string): boolean {
    return this.map(name).delete(id);
  }

  list<T extends Entity = Entity>(name: string, filter?: Partial<Record<string, unknown>>): T[] {
    let items = [...this.map(name).values()] as T[];
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        if (value === undefined || value === null || value === '') continue;
        items = items.filter((item) => matches(item, key, value));
      }
    }
    return items;
  }

  query<T extends Entity = Entity>(name: string, predicate: (item: T) => boolean): T[] {
    return (this.list(name) as T[]).filter(predicate);
  }

  count(name: string): number {
    return this.map(name).size;
  }

  audit(event: AuditEvent): void {
    this.auditLog.push(event);
  }

  getAuditLog(): AuditEvent[] {
    return this.auditLog;
  }
}

/** Shallow-ish match supporting reference fields and nested `subject.reference`. */
function matches(item: Entity, key: string, value: unknown): boolean {
  const raw = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, item);
  if (raw === undefined) {
    // Allow filtering by reference shorthand, e.g. ?subject=Patient/123
    const maybeRef = item[key];
    if (maybeRef && typeof maybeRef === 'object' && 'reference' in maybeRef) {
      return (maybeRef as { reference: string }).reference === value;
    }
    return false;
  }
  return String(raw) === String(value);
}
