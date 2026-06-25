# AGENTS.md — TrustOS Module Authoring Contract

**Read this fully before writing any code.** TrustOS is a digital-hospital
platform for Guy's and St Thomas' NHS Foundation Trust (GSTT). It is built as
many independent **workflow modules** that plug into a shared core. Dozens of
agents build modules in parallel, so the #1 rule is: **never edit a shared
file** — modules are auto-discovered.

---

## 1. Monorepo layout

```
packages/
  ontology/      @trustos/ontology  FHIR-R4 Zod schemas, terminology, NEWS2, NHS#  (SHARED — do not edit)
  core/          @trustos/core      ids, rbac, audit, datetime, Result, seeded RNG  (SHARED — do not edit)
  ui/            @trustos/ui        React design system (Card, Badge, Button, …)    (SHARED — do not edit)
  api-client/    @trustos/api-client typed fetch + React Query hooks                (SHARED — do not edit)
apps/
  api/           @trustos/api       Fastify server, in-memory store, module loader
    src/modules/<id>/module.ts      <-- YOUR backend module
    test/<id>.test.ts               <-- YOUR backend tests
  web/           @trustos/web       Vite + React shell, feature loader
    src/features/<id>/feature.tsx   <-- YOUR frontend feature
e2e/             @trustos/e2e       Playwright smoke/e2e
```

### Files you MUST NOT edit (shared/central)
- Anything under `packages/**`
- `apps/api/src/{app.ts,store/**,core-resources.ts,seed/**,index.ts}`
- `apps/api/src/modules/{types.ts,registry.ts}`
- `apps/web/src/app/**`, `apps/web/src/main.tsx`
- root configs (`package.json`, `tsconfig*`, `eslint.config.js`, CI)

If you think you need to change a shared file, you almost certainly don't —
use a **custom collection** (see §4). If it's truly unavoidable, keep it
additive and conflict-free and call it out in your PR.

---

## 2. Your deliverable

One PR that adds a single workflow module:
- `apps/api/src/modules/<id>/module.ts` (+ helpers in the same folder)
- `apps/api/test/<id>.test.ts` (integration tests via `buildApp`)
- `apps/web/src/features/<id>/feature.tsx` (+ pages in the same folder)

`<id>` is a unique, URL-safe slug (e.g. `beds`, `eprescribing`, `theatres`).
All your files live in your own two folders — no collisions with other agents.

Branch name: `feat/<id>-module`. PR title: `feat(<id>): <Workflow Name> module`.

---

## 3. Backend module contract

```ts
// apps/api/src/modules/<id>/module.ts
import { defineModule } from '../types';
import { ref } from '@trustos/core';
import type { Patient } from '@trustos/ontology';

export default defineModule({
  id: '<id>',                       // route prefix: routes mount under /api/<id>
  name: 'Human Readable Name',
  description: 'One line shown in the command centre.',

  // Optional: custom (non-core) collections this module owns.
  collections: [{ name: 'BedRequest' }],

  // Routes are mounted under /api/<id>. Paths here are RELATIVE to that prefix.
  routes(app, { store }) {
    app.get('/', async () => ({ items: store.list('BedRequest') }));
    app.post<{ Body: Record<string, unknown> }>('/', async (req, reply) => {
      reply.code(201);
      return store.create('BedRequest', req.body);
    });
  },

  // Optional: deterministic demo data. Runs once at startup AFTER core seed,
  // so core Patients/Practitioners/Locations already exist.
  seed({ store, rng }) {
    const patients = store.list<Patient>('Patient');
    // use rng() — never Math.random() — for reproducible demos
  },
});
```

Rules:
- Use the shared `store` (`apps/api/src/store/store.ts`) for all persistence:
  `create/get/getOrThrow/update/remove/list/query/count/put`.
- Core FHIR resource types already have generic CRUD at `/api/fhir/:type`.
  Build **workflow** endpoints (composite reads, state transitions, worklists)
  on top — don't re-implement plain CRUD.
- Read/seed core resources by reference. Build references with
  `ref('Patient', id)` → `"Patient/<id>"`.
- Throw `ApiError`/`NotFound`/`BadRequest` from `@trustos/core` for errors.
- All seed randomness goes through the injected `rng` (a seeded mulberry32).

### Custom collections (preferred over editing the ontology)
If your workflow needs a resource type that isn't in `@trustos/ontology`
(e.g. `BedRequest`, `TheatreList`, `TransfusionOrder`), declare it in
`collections`. With no validator it accepts free-form documents; pass a Zod
`validator` if you want validation. This keeps the shared registry untouched.

### Backend tests (required)
```ts
// apps/api/test/<id>.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';

describe('<id> module', () => {
  let app; 
  beforeAll(async () => { ({ app } = await buildApp({ seed: true })); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('lists via its route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/<id>' });
    expect(res.statusCode).toBe(200);
  });
});
```

---

## 4. Frontend feature contract

```tsx
// apps/web/src/features/<id>/feature.tsx
import { BedDouble } from 'lucide-react';            // pick a Lucide icon
import { defineFeature } from '../../app/types';
import { ListPage } from './ListPage';

export default defineFeature({
  id: '<id>',
  title: 'Bed Management',
  description: 'Live bed state, requests and flow across all sites.',
  category: 'Operations',   // Clinical|Diagnostics|Medicines|Scheduling|Operations|Patient|Analytics|Administration
  icon: BedDouble,
  navPath: '/<id>',
  routes: [
    { path: '/<id>', component: ListPage },
    { path: '/<id>/:id', component: DetailPage },   // optional detail route
  ],
});
```

Page components:
- Fetch with `useApiQuery<T>('/api/<id>/...')` or `useResourceList('Patient')`
  from `@trustos/api-client`. Mutations: `useApiMutation('POST', () => '/api/<id>')`.
- Build UI from `@trustos/ui` (`PageHeader`, `Card`, `CardBody`, `Badge`,
  `Button`, `Stat`, `DataTable`, `Spinner`, `EmptyState`, `news2Tone`).
- Use Tailwind utility classes + NHS tokens (`nhs-blue`, `nhs-darkblue`,
  `nhs-green`, `nhs-red`, `nhs-yellow`).
- Route `path`s are **absolute** and must be unique to your `<id>`.

**Reference implementation:** copy the patterns in
`apps/api/src/modules/patients/` and `apps/web/src/features/patients/`.

---

## 5. Commands (run before opening your PR)

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @trustos/api gen     # regenerate the module index (gitignored)
pnpm typecheck                     # must pass
pnpm lint                          # must pass
pnpm --filter @trustos/api test    # your backend tests must pass
pnpm --filter @trustos/web build   # web must build
```

To run the stack locally: `pnpm dev` (API on :4000, web on :5173, web proxies
`/api` → API).

---

## 6. Definition of done
- Module loads (`GET /api/modules` includes your `id`).
- Routes work and return seeded demo data.
- Feature appears in the command centre nav and renders without console errors.
- `pnpm typecheck`, `pnpm lint`, API tests, and web build all pass.
- PR opened from `feat/<id>-module` describing the workflow and endpoints.
