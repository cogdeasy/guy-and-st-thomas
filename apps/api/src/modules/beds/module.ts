import { z } from 'zod';
import {
  calculateNews2,
  CodeSystems,
  type Encounter,
  type Location,
  type News2Result,
  type Observation,
  type Patient,
} from '@trustos/ontology';
import { ageFromBirthDate, BadRequest, NotFound, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore, Entity } from '../../store/store';

/**
 * Bed Management & Patient Flow.
 *
 * A live bed-state board and patient-flow workspace across every GSTT site.
 * It reads the core `Location` hierarchy (site -> ward -> bed) seeded by the
 * platform and layers two module-owned collections on top:
 *   - `BedRequest`   — a request to admit/transfer a patient to a ward.
 *   - `BedOccupancy` — the authoritative patient<->bed link (core `Location`
 *                      only carries an `operationalStatus`, not an occupant).
 *
 * Endpoints are workflow-oriented (composite board, capacity rollups, request
 * worklist and an allocate state-transition) rather than plain CRUD, which is
 * already provided generically at `/api/fhir/:type`.
 */

const PRIORITIES = ['routine', 'urgent', 'emergency'] as const;
type Priority = (typeof PRIORITIES)[number];

const REQUEST_STATUSES = ['pending', 'allocated', 'rejected'] as const;
type RequestStatus = (typeof REQUEST_STATUSES)[number];

type BedRequest = Entity & {
  patient: { reference: string; display?: string };
  fromLocation?: { reference: string; display?: string };
  requestedWard?: string;
  specialty: string;
  priority: Priority;
  status: RequestStatus;
  requestedAt: string;
  allocatedBed?: { reference: string; display?: string };
  allocatedAt?: string;
  rejectedReason?: string;
};

type BedOccupancy = Entity & {
  bed: { reference: string; display?: string };
  patient: { reference: string; display?: string };
  encounter?: { reference: string };
  status: 'active' | 'discharged';
  admittedAt: string;
};

export default defineModule({
  id: 'beds',
  name: 'Bed Management & Patient Flow',
  description: 'Live ward bed-state board, capacity and admission/transfer flow across all GSTT sites.',

  collections: [{ name: 'BedRequest' }, { name: 'BedOccupancy' }],

  routes(app, { store }) {
    // Live ward board: every ward with an occupancy summary and per-bed status.
    app.get('/board', async () => {
      const { sites, wards, beds } = locationIndex(store);
      const occupancyByBed = activeOccupancyByBed(store);

      const wardViews = wards
        .map((ward) => {
          const wardBeds = beds.filter((b) => b.partOf?.reference === ref('Location', ward.id));
          const site = ward.partOf ? sites.get(ward.partOf.reference) : undefined;
          return {
            wardId: ward.id,
            wardName: ward.name,
            siteId: site?.id,
            siteName: site?.name,
            summary: summariseBeds(wardBeds),
            beds: wardBeds
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
              .map((bed) => {
                const occ = occupancyByBed.get(ref('Location', bed.id));
                return {
                  id: bed.id,
                  name: bed.name,
                  status: bed.operationalStatus ?? 'available',
                  occupant: occ ? occupant(store, occ) : null,
                };
              }),
          };
        })
        .sort((a, b) => (a.siteName ?? '').localeCompare(b.siteName ?? '') || a.wardName.localeCompare(b.wardName));

      return { summary: summariseBeds(beds), wards: wardViews };
    });

    // Trust-wide capacity rollup with per-site occupancy.
    app.get('/capacity', async () => {
      const { sites, wards, beds } = locationIndex(store);
      const siteOfBed = (bed: Location): Location | undefined => {
        const ward = bed.partOf ? wards.find((w) => ref('Location', w.id) === bed.partOf?.reference) : undefined;
        return ward?.partOf ? sites.get(ward.partOf.reference) : undefined;
      };

      const perSite = [...sites.values()]
        .map((site) => {
          const siteBeds = beds.filter((bed) => siteOfBed(bed)?.id === site.id);
          return { siteId: site.id, siteName: site.name, ...summariseBeds(siteBeds) };
        })
        .filter((s) => s.total > 0)
        .sort((a, b) => b.occupancyPct - a.occupancyPct);

      return { trust: summariseBeds(beds), sites: perSite };
    });

    // Bed-request worklist (admissions/transfers awaiting a bed).
    app.get<{ Querystring: { status?: string } }>('/requests', async (req) => {
      const status = req.query.status;
      let items = store.list<BedRequest>('BedRequest');
      if (status) {
        if (!REQUEST_STATUSES.includes(status as RequestStatus)) {
          throw BadRequest(`Invalid status filter '${status}'`);
        }
        items = items.filter((r) => r.status === status);
      }
      const enriched = items
        .map((r) => enrichRequest(store, r))
        .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || a.requestedAt.localeCompare(b.requestedAt));
      return {
        total: enriched.length,
        pending: enriched.filter((r) => r.status === 'pending').length,
        items: enriched,
      };
    });

    // Create a bed request for a real patient.
    const CreateBody = z.object({
      patientId: z.string().min(1),
      specialty: z.string().min(1),
      priority: z.enum(PRIORITIES).default('routine'),
      requestedWard: z.string().optional(),
      fromLocationId: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/requests', async (req, reply) => {
      const body = CreateBody.parse(req.body);
      const patient = store.get<Patient>('Patient', body.patientId);
      if (!patient) throw NotFound(`Patient/${body.patientId}`);

      let fromLocation: BedRequest['fromLocation'];
      if (body.fromLocationId) {
        const loc = store.get<Location>('Location', body.fromLocationId);
        if (!loc) throw NotFound(`Location/${body.fromLocationId}`);
        fromLocation = { reference: ref('Location', loc.id), display: loc.name };
      }

      const created = store.create<BedRequest>('BedRequest', {
        patient: { reference: ref('Patient', patient.id), display: patientName(patient) },
        fromLocation,
        requestedWard: body.requestedWard,
        specialty: body.specialty,
        priority: body.priority,
        status: 'pending',
        requestedAt: nowIso(),
      });
      reply.code(201);
      return enrichRequest(store, created);
    });

    // Allocate a bed to a pending request: occupies the bed and records the
    // patient<->bed link, flipping the request to `allocated`.
    const AllocateBody = z.object({ bedId: z.string().min(1) });
    app.post<{ Params: { id: string }; Body: unknown }>('/requests/:id/allocate', async (req) => {
      const request = store.get<BedRequest>('BedRequest', req.params.id);
      if (!request) throw NotFound(`BedRequest/${req.params.id}`);
      if (request.status !== 'pending') {
        throw BadRequest(`Request is already ${request.status} and cannot be allocated`);
      }
      const { bedId } = AllocateBody.parse(req.body);

      const bed = store.get<Location>('Location', bedId);
      if (!bed) throw NotFound(`Location/${bedId}`);
      if (bed.physicalType !== 'bed') throw BadRequest(`Location/${bedId} is not a bed`);
      if ((bed.operationalStatus ?? 'available') !== 'available') {
        throw BadRequest(`Bed ${bed.name} is ${bed.operationalStatus ?? 'unavailable'} and cannot be allocated`);
      }

      store.update<Location>('Location', bed.id, { operationalStatus: 'occupied' });
      const occupancy = store.create<BedOccupancy>('BedOccupancy', {
        bed: { reference: ref('Location', bed.id), display: bed.name },
        patient: request.patient,
        status: 'active',
        admittedAt: nowIso(),
      });
      const updated = store.update<BedRequest>('BedRequest', request.id, {
        status: 'allocated',
        allocatedBed: { reference: ref('Location', bed.id), display: bed.name },
        allocatedAt: occupancy.admittedAt,
      });

      return { request: enrichRequest(store, updated), bed: store.getOrThrow<Location>('Location', bed.id) };
    });
  },

  // Deterministic demo data: derive occupancy from seeded beds and create a
  // realistic admissions/transfer worklist for real patients.
  seed({ store, rng }) {
    const beds = store.list<Location>('Location').filter((l) => l.physicalType === 'bed');
    const patients = store.list<Patient>('Patient');
    const encounters = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );

    // Patients that hold an active inpatient encounter (placed first so the
    // board surfaces real vitals/NEWS2), then everyone else.
    const encounterByPatient = new Map<string, Encounter>();
    for (const e of encounters) encounterByPatient.set(e.subject.reference, e);
    const inpatientFirst = patients
      .slice()
      .sort((a, b) => {
        const ai = encounterByPatient.has(ref('Patient', a.id)) ? 0 : 1;
        const bi = encounterByPatient.has(ref('Patient', b.id)) ? 0 : 1;
        return ai - bi;
      });

    // Reserve a handful of patients (placed last, i.e. those without an active
    // encounter) to drive the admissions/transfer worklist; fill occupied beds
    // with everyone else, inpatients first so the board shows real vitals/NEWS2.
    const requestCount = 8;
    const pool = inpatientFirst.slice();
    const reserveForRequests = Math.min(requestCount, pool.length);
    const placeable = Math.max(0, pool.length - reserveForRequests);

    const occupiedBeds = beds.filter((b) => b.operationalStatus === 'occupied');
    let placed = 0;
    for (const bed of occupiedBeds) {
      if (placed >= placeable) break;
      const patient = pool.shift();
      if (!patient) break;
      placed++;
      const enc = encounterByPatient.get(ref('Patient', patient.id));
      store.create<BedOccupancy>('BedOccupancy', {
        bed: { reference: ref('Location', bed.id), display: bed.name },
        patient: { reference: ref('Patient', patient.id), display: patientName(patient) },
        encounter: enc ? { reference: ref('Encounter', enc.id) } : undefined,
        status: 'active',
        admittedAt: nowIso(),
      });
      if (enc) store.update<Encounter>('Encounter', enc.id, { location: { reference: ref('Location', bed.id), display: bed.name } });
    }

    // Patients still waiting for a bed (e.g. in ED) drive the request worklist.
    const sites = store.list<Location>('Location').filter((l) => l.physicalType === 'site');
    const specialties = encounters.map((e) => e.specialty).filter((s): s is string => Boolean(s));
    for (let i = 0; i < requestCount && pool.length > 0; i++) {
      const idx = randInt(0, pool.length - 1, rng);
      const [patient] = pool.splice(idx, 1);
      if (!patient) continue;
      const site = sites.length ? pick(sites, rng) : undefined;
      const specialty = specialties.length ? pick(specialties, rng) : 'General Medicine';
      const request = store.create<BedRequest>('BedRequest', {
        patient: { reference: ref('Patient', patient.id), display: patientName(patient) },
        fromLocation: site ? { reference: ref('Location', site.id), display: `Emergency Department, ${site.name}` } : undefined,
        requestedWard: undefined,
        specialty,
        priority: pick(PRIORITIES, rng),
        status: 'pending',
        requestedAt: nowIso(),
      });

      // Pre-allocate roughly a third so the worklist shows both states.
      if (rng() < 0.35) {
        const free = beds.find((b) => b.operationalStatus === 'available');
        if (free) {
          // Mutate the local snapshot too: store.update replaces (not mutates)
          // the stored entity, so without this the next round would re-find
          // this same bed and double-book it.
          free.operationalStatus = 'occupied';
          store.update<Location>('Location', free.id, { operationalStatus: 'occupied' });
          store.create<BedOccupancy>('BedOccupancy', {
            bed: { reference: ref('Location', free.id), display: free.name },
            patient: request.patient,
            status: 'active',
            admittedAt: nowIso(),
          });
          store.update<BedRequest>('BedRequest', request.id, {
            status: 'allocated',
            allocatedBed: { reference: ref('Location', free.id), display: free.name },
            allocatedAt: nowIso(),
          });
        }
      }
    }
  },
});

// --- helpers ----------------------------------------------------------------

interface BedSummary {
  total: number;
  occupied: number;
  available: number;
  closed: number;
  occupancyPct: number;
}

function summariseBeds(beds: Location[]): BedSummary {
  // Treat an unset status as 'available', matching the board and allocate logic.
  const occupied = beds.filter((b) => b.operationalStatus === 'occupied').length;
  const available = beds.filter((b) => (b.operationalStatus ?? 'available') === 'available').length;
  const closed = beds.filter((b) => b.operationalStatus === 'closed').length;
  const total = beds.length;
  const denom = occupied + available || total;
  return {
    total,
    occupied,
    available,
    closed,
    occupancyPct: denom === 0 ? 0 : Math.round((occupied / denom) * 100),
  };
}

function locationIndex(store: DataStore): {
  sites: Map<string, Location>;
  wards: Location[];
  beds: Location[];
} {
  const locations = store.list<Location>('Location');
  const sites = new Map<string, Location>();
  for (const l of locations) {
    if (l.physicalType === 'site') sites.set(ref('Location', l.id), l);
  }
  return {
    sites,
    wards: locations.filter((l) => l.physicalType === 'ward'),
    beds: locations.filter((l) => l.physicalType === 'bed'),
  };
}

function activeOccupancyByBed(store: DataStore): Map<string, BedOccupancy> {
  const map = new Map<string, BedOccupancy>();
  for (const occ of store.list<BedOccupancy>('BedOccupancy')) {
    if (occ.status === 'active') map.set(occ.bed.reference, occ);
  }
  return map;
}

function occupant(store: DataStore, occ: BedOccupancy) {
  const patient = store.get<Patient>('Patient', occ.patient.reference.split('/')[1] ?? '');
  if (!patient) return { display: occ.patient.display ?? 'Unknown' };
  const news2 = latestNews2(store, patient.id);
  return {
    patientId: patient.id,
    name: patientName(patient),
    nhsNumber: patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
    age: ageFromBirthDate(patient.birthDate),
    gender: patient.gender,
    admittedAt: occ.admittedAt,
    news2: news2 ? { score: news2.score, risk: news2.risk } : null,
  };
}

function enrichRequest(store: DataStore, r: BedRequest) {
  const patient = store.get<Patient>('Patient', r.patient.reference.split('/')[1] ?? '');
  return {
    id: r.id,
    status: r.status,
    priority: r.priority,
    specialty: r.specialty,
    requestedWard: r.requestedWard,
    requestedAt: r.requestedAt,
    fromLocation: r.fromLocation ?? null,
    allocatedBed: r.allocatedBed ?? null,
    allocatedAt: r.allocatedAt ?? null,
    patient: patient
      ? {
          id: patient.id,
          name: patientName(patient),
          nhsNumber: patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
          age: ageFromBirthDate(patient.birthDate),
          gender: patient.gender,
        }
      : { display: r.patient.display },
  };
}

function patientName(p: Patient): string {
  const n = p.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim() || 'Unknown patient';
}

function priorityRank(p: Priority): number {
  return p === 'emergency' ? 3 : p === 'urgent' ? 2 : 1;
}

function latestNews2(store: DataStore, patientId: string): News2Result | null {
  const patientRef = ref('Patient', patientId);
  const vitals = store
    .query<Observation>('Observation', (o) => o.subject?.reference === patientRef && o.category === 'vital-signs')
    .sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime));
  const byCode = (loinc: string) =>
    vitals.find((o) => o.code?.coding?.some((c) => c.code === loinc))?.valueQuantity?.value;

  const respiratoryRate = byCode('9279-1');
  const spo2 = byCode('2708-6');
  const systolicBp = byCode('8480-6');
  const pulse = byCode('8867-4');
  const temperature = byCode('8310-5');
  if (
    respiratoryRate === undefined ||
    spo2 === undefined ||
    systolicBp === undefined ||
    pulse === undefined ||
    temperature === undefined
  ) {
    return null;
  }
  return calculateNews2({ respiratoryRate, spo2, onOxygen: false, systolicBp, pulse, consciousness: 'A', temperature });
}
