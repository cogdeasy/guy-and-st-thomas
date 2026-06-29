import { z } from 'zod';
import {
  CodeSystems,
  Reference,
  type Encounter,
  type Location,
  type Patient,
} from '@trustos/ontology';
import { BadRequest, NotFound, nowIso, isoHoursFromNow, pick, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore } from '../../store/store';

/**
 * Infection Prevention & Control (IPC) — surveillance and isolation management.
 *
 * Owns a custom `IpcAlert` collection (alerts are not a core FHIR resource) and
 * exposes workflow endpoints on top of the shared store: an isolation board,
 * alert creation, a clear/de-isolate state transition and a metrics summary
 * sizing isolation demand against side-room capacity.
 */

/** Organisms IPC routinely flags for surveillance and isolation at GSTT. */
export const ORGANISMS = [
  { name: 'MRSA', isolation: true },
  { name: 'C. difficile', isolation: true },
  { name: 'COVID-19', isolation: true },
  { name: 'CPE', isolation: true },
  { name: 'Norovirus', isolation: true },
  { name: 'VRE', isolation: true },
  { name: 'Influenza A', isolation: true },
  { name: 'ESBL', isolation: false },
] as const;

const ORGANISM_NAMES: string[] = ORGANISMS.map((o) => o.name);

/** Side rooms available per ward for cohort/isolation use (capacity model). */
const SIDE_ROOMS_PER_WARD = 2;

const AlertType = z.enum(['colonisation', 'infection']);
const AlertStatus = z.enum(['active', 'cleared']);

/**
 * Stored shape of an IPC alert. `id`/`meta` are added by the store, so the
 * collection validator accepts them alongside the workflow fields.
 */
const IpcAlertSchema = z
  .object({
    id: z.string(),
    patient: Reference,
    organism: z.string().min(1),
    type: AlertType,
    isolationRequired: z.boolean(),
    sideRoom: z.boolean(),
    status: AlertStatus,
    notifiedAt: z.string(),
    clearedAt: z.string().optional(),
    note: z.string().optional(),
    ward: Reference.optional(),
    bed: Reference.optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type IpcAlert = z.infer<typeof IpcAlertSchema>;

export default defineModule({
  id: 'infection',
  name: 'Infection Prevention & Control',
  description: 'IPC surveillance, alerts and isolation/side-room management across the trust.',

  collections: [{ name: 'IpcAlert', validator: (input) => IpcAlertSchema.parse(input) }],

  routes(app, { store }) {
    // Isolation board: active alerts enriched with patient + location + status.
    app.get('/board', async () => {
      const alerts = activeAlerts(store);
      const rows = alerts
        .map((a) => enrichAlert(store, a))
        .sort(
          (x, y) =>
            Number(y.isolationRequired) - Number(x.isolationRequired) ||
            y.notifiedAt.localeCompare(x.notifiedAt),
        );
      return {
        total: rows.length,
        awaitingSideRoom: rows.filter((r) => r.isolationRequired && !r.sideRoom).length,
        items: rows,
      };
    });

    // Surveillance metrics: organism breakdown + isolation demand vs capacity.
    app.get('/metrics', async () => {
      const alerts = activeAlerts(store);
      // Cover every organism actually present (incl. ad-hoc ones from POST /alerts),
      // keeping the surveillance list ordered first so the breakdown always sums to
      // activeCases.
      const organisms = [
        ...ORGANISM_NAMES,
        ...alerts.map((a) => a.organism).filter((o) => !ORGANISM_NAMES.includes(o)),
      ];
      const byOrganism = [...new Set(organisms)]
        .map((organism) => {
          const cases = alerts.filter((a) => a.organism === organism);
          return {
            organism,
            total: cases.length,
            infection: cases.filter((a) => a.type === 'infection').length,
            colonisation: cases.filter((a) => a.type === 'colonisation').length,
          };
        })
        .filter((o) => o.total > 0)
        .sort((a, b) => b.total - a.total);

      const sideRoomCapacity = wardCount(store) * SIDE_ROOMS_PER_WARD;
      const sideRoomsInUse = alerts.filter((a) => a.sideRoom).length;
      const isolationRequired = alerts.filter((a) => a.isolationRequired).length;

      return {
        activeCases: alerts.length,
        byOrganism,
        isolation: {
          required: isolationRequired,
          sideRoomCapacity,
          sideRoomsInUse,
          sideRoomsAvailable: Math.max(0, sideRoomCapacity - sideRoomsInUse),
          awaitingSideRoom: alerts.filter((a) => a.isolationRequired && !a.sideRoom).length,
          utilisation: sideRoomCapacity === 0 ? 0 : Math.round((sideRoomsInUse / sideRoomCapacity) * 100),
        },
      };
    });

    // Raise a new IPC alert against an existing patient.
    const CreateBody = z.object({
      patientId: z.string().min(1),
      organism: z.string().min(1),
      type: AlertType,
      isolationRequired: z.boolean().optional(),
      sideRoom: z.boolean().default(false),
      note: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/alerts', async (req, reply) => {
      const body = CreateBody.parse(req.body);
      const patient = store.get<Patient>('Patient', body.patientId);
      if (!patient) throw NotFound(`Patient/${body.patientId}`);

      const isolationRequired =
        body.isolationRequired ??
        ORGANISMS.find((o) => o.name === body.organism)?.isolation ??
        true;

      const location = currentLocation(store, patient.id);
      const created = store.create<IpcAlert>('IpcAlert', {
        patient: { reference: ref('Patient', patient.id), display: patientName(patient) },
        organism: body.organism,
        type: body.type,
        isolationRequired,
        sideRoom: body.sideRoom,
        status: 'active',
        notifiedAt: nowIso(),
        note: body.note,
        ward: location?.ward,
        bed: location?.bed,
      });
      reply.code(201);
      return created;
    });

    // Clear an alert (de-isolate) — active -> cleared state transition.
    app.post<{ Params: { id: string } }>('/:id/clear', async (req) => {
      const alert = store.get<IpcAlert>('IpcAlert', req.params.id);
      if (!alert) throw NotFound(`IpcAlert/${req.params.id}`);
      if (alert.status === 'cleared') {
        throw BadRequest('IPC alert is already cleared');
      }
      return store.update<IpcAlert>('IpcAlert', alert.id, {
        status: 'cleared',
        isolationRequired: false,
        sideRoom: false,
        clearedAt: nowIso(),
      });
    });
  },

  // ~8 IPC alerts on currently-admitted patients, deterministic via rng.
  seed({ store, rng }) {
    const admitted = store
      .query<Encounter>('Encounter', (e) => e.class === 'inpatient' && e.status === 'in-progress')
      .map((e) => store.get<Patient>('Patient', e.subject.reference.split('/')[1] ?? ''))
      .filter((p): p is Patient => Boolean(p));

    const wards = store.list<Location>('Location', { physicalType: 'ward' });

    const shuffled = [...admitted].sort(() => rng() - 0.5);
    const target = Math.min(8, shuffled.length);

    for (let i = 0; i < target; i++) {
      const patient = shuffled[i] as Patient;
      const organism = pick(ORGANISMS, rng);
      const type = rng() < 0.45 ? 'infection' : 'colonisation';
      const isolationRequired = organism.isolation;
      const placement = placeOnWard(store, wards, rng);
      // ~70% of those needing isolation have secured a side room.
      const sideRoom = isolationRequired && rng() < 0.7;

      store.create<IpcAlert>('IpcAlert', {
        patient: { reference: ref('Patient', patient.id), display: patientName(patient) },
        organism: organism.name,
        type,
        isolationRequired,
        sideRoom,
        status: 'active',
        notifiedAt: isoHoursFromNow(-randHours(rng)),
        ward: placement.ward,
        bed: placement.bed,
      });
    }
  },
});

interface EnrichedAlert {
  id: string;
  organism: string;
  type: z.infer<typeof AlertType>;
  status: z.infer<typeof AlertStatus>;
  isolationRequired: boolean;
  sideRoom: boolean;
  notifiedAt: string;
  patient: { id: string; name: string; nhsNumber?: string } | null;
  ward?: Reference;
  bed?: Reference;
}

function enrichAlert(store: DataStore, alert: IpcAlert): EnrichedAlert {
  const patientId = alert.patient.reference.split('/')[1] ?? '';
  const patient = store.get<Patient>('Patient', patientId);
  return {
    id: alert.id,
    organism: alert.organism,
    type: alert.type,
    status: alert.status,
    isolationRequired: alert.isolationRequired,
    sideRoom: alert.sideRoom,
    notifiedAt: alert.notifiedAt,
    patient: patient
      ? {
          id: patient.id,
          name: patientName(patient),
          nhsNumber: patient.identifier?.find((idn) => idn.system === CodeSystems.NHS_NUMBER)?.value,
        }
      : null,
    ward: alert.ward,
    bed: alert.bed,
  };
}

function activeAlerts(store: DataStore): IpcAlert[] {
  return store.query<IpcAlert>('IpcAlert', (a) => a.status === 'active');
}

function wardCount(store: DataStore): number {
  return store.list<Location>('Location', { physicalType: 'ward' }).length;
}

interface Placement {
  ward?: Reference;
  bed?: Reference;
}

/** Pick a ward and a bed that actually belongs to it, so board rows are coherent. */
function placeOnWard(store: DataStore, wards: Location[], rng: () => number): Placement {
  if (!wards.length) return {};
  const ward = pick(wards, rng);
  return { ...wardRef(ward), ...bedOnWard(store, ward, (arr) => pick(arr, rng)) };
}

/** Deterministically map a patient onto a real ward + one of its beds for display. */
function currentLocation(store: DataStore, patientId: string): Placement {
  const wards = store.list<Location>('Location', { physicalType: 'ward' });
  if (!wards.length) return {};
  const idx = hash(patientId);
  const ward = wards[idx % wards.length] as Location;
  return { ...wardRef(ward), ...bedOnWard(store, ward, (arr) => arr[idx % arr.length] as Location) };
}

function wardRef(ward: Location): Placement {
  return { ward: { reference: ref('Location', ward.id), display: ward.name } };
}

function bedOnWard(
  store: DataStore,
  ward: Location,
  choose: (beds: Location[]) => Location,
): Placement {
  const wardRefStr = ref('Location', ward.id);
  const beds = store.query<Location>(
    'Location',
    (l) => l.physicalType === 'bed' && l.partOf?.reference === wardRefStr,
  );
  if (!beds.length) return {};
  const bed = choose(beds);
  return { bed: { reference: ref('Location', bed.id), display: bed.name } };
}

function patientName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}

function randHours(rng: () => number): number {
  return Math.floor(rng() * 96) + 1;
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
