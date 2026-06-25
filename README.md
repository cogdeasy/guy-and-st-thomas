# TrustOS — Digital Hospital Platform

A modular, FHIR-aligned digital-hospital platform for **Guy's and St Thomas'
NHS Foundation Trust (GSTT)**. TrustOS pairs a generic clinical data core with
independently-developed **workflow modules** that span the whole hospital —
patient administration, bed management, e-prescribing, diagnostics, theatres,
referrals, and more.

> Built to demo as a production-grade EPR/PAS. Architecture supports dozens of
> teams shipping modules in parallel without merge conflicts.

## Architecture

```
@trustos/ontology   FHIR R4 Zod schemas, terminology (SNOMED/LOINC/ICD-10),
                    NHS-number validation, NEWS2 scoring
@trustos/core       ids, RBAC, audit, datetime, Result, deterministic RNG
@trustos/ui         NHS-aligned React design system
@trustos/api-client typed HTTP client + React Query hooks

@trustos/api        Fastify server: in-memory FHIR store, generic /api/fhir CRUD,
                    auto-discovered workflow modules under /api/<id>
@trustos/web        Vite + React shell: auto-discovered features, command centre
@trustos/e2e        Playwright end-to-end suite
```

Both the backend modules and frontend features are **auto-discovered** — drop a
folder in and it wires itself into the API, the router and the navigation. See
[`AGENTS.md`](./AGENTS.md) for the module-authoring contract.

## Quick start

```bash
pnpm install --no-frozen-lockfile
pnpm dev          # API on http://localhost:4000, web on http://localhost:5173
```

The web app proxies `/api` to the API. Open http://localhost:5173 for the
Command Centre.

### Verify

```bash
pnpm typecheck
pnpm lint
pnpm test         # unit + integration (ontology, core, api)
pnpm test:e2e     # Playwright (boots API + web preview)
pnpm build
```

## Key endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness |
| `GET /api/modules` | Registered workflow modules |
| `GET /api/fhir/_types` | Resource types + counts |
| `GET/POST/PUT/DELETE /api/fhir/:type[/:id]` | Generic FHIR CRUD |
| `GET /api/patients/search?q=` | Master patient index search |
| `GET /api/patients/worklist` | Active inpatients + NEWS2 |
| `GET /api/patients/:id/summary` | Composite patient chart |

## Clinical standards

- **FHIR R4** resource shapes (Patient, Encounter, Observation, ServiceRequest,
  MedicationRequest, …)
- **NHS Number** Modulus-11 validation
- **NEWS2** (RCP National Early Warning Score 2) for deterioration detection
- Terminology: SNOMED CT, LOINC, ICD-10, dm+d, NHS ODS

## Repository

Module authors: start with [`AGENTS.md`](./AGENTS.md). The
`patients` module (API + web) is the reference implementation.
