import { BadRequest, NotFound, ref, isoHoursFromNow, nowIso, pick, randInt } from '@trustos/core';
import type { Encounter, Patient } from '@trustos/ontology';
import { defineModule } from '../types';
import type { ModuleContext } from '../types';
import {
  BLOOD_COMPONENTS,
  BLOOD_GROUPS,
  BLOOD_STOCK_COLLECTION,
  COMPONENT_LABELS,
  CreateOrderBody,
  TRANSFUSION_ORDER_COLLECTION,
  type BloodComponent,
  type BloodGroup,
  type BloodStock,
  type TransfusionOrder,
  type TransfusionPriority,
} from './types';

/**
 * Blood Bank & Transfusion — manages the transfusion pathway end to end:
 * request → crossmatch → issue → transfuse, backed by a live stock ledger.
 *
 * Plain CRUD already exists at /api/fhir/:type for core resources; this module
 * adds the *workflow* on top: a status worklist, guarded state transitions and
 * a component/group stock view. Custom collections (TransfusionOrder,
 * BloodStock) keep the shared ontology untouched.
 */
export default defineModule({
  id: 'bloodbank',
  name: 'Blood Bank & Transfusion',
  description: 'Transfusion ordering, crossmatch-to-transfuse tracking and blood stock levels.',

  collections: [{ name: TRANSFUSION_ORDER_COLLECTION }, { name: BLOOD_STOCK_COLLECTION }],

  routes(app, { store }) {
    // Active transfusion worklist, newest first, grouped by status.
    app.get<{ Querystring: { status?: string } }>('/worklist', async (req) => {
      const filter = req.query.status?.trim();
      let orders = store.list<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION);
      if (filter) {
        orders = orders.filter((o) => o.status === filter);
      }
      orders = orders.sort(
        (a, b) =>
          priorityRank(b.priority) - priorityRank(a.priority) ||
          b.requestedAt.localeCompare(a.requestedAt),
      );

      const byStatus = countByStatus(store.list<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION));

      return {
        total: orders.length,
        byStatus,
        items: orders.map((order) => ({ order, patient: resolvePatient(store, order) })),
      };
    });

    // Blood stock by component and ABO/Rh group.
    app.get('/stock', async () => {
      const stock = store.list<BloodStock>(BLOOD_STOCK_COLLECTION);
      const components = BLOOD_COMPONENTS.map((component) => {
        const groups = stock
          .filter((s) => s.component === component)
          .sort((a, b) => BLOOD_GROUPS.indexOf(a.group) - BLOOD_GROUPS.indexOf(b.group))
          .map((s) => ({ group: s.group, units: s.units }));
        return {
          component,
          label: COMPONENT_LABELS[component],
          total: groups.reduce((sum, g) => sum + g.units, 0),
          groups,
        };
      });
      return { totalUnits: components.reduce((sum, c) => sum + c.total, 0), components };
    });

    // Composite read for a single order (with patient + timeline).
    app.get<{ Params: { id: string } }>('/:id', async (req) => {
      const order = store.getOrThrow<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION, req.params.id);
      return {
        order,
        patient: resolvePatient(store, order),
        timeline: timelineOf(order),
        available: availableUnits(store, order.component, order.bloodGroup),
      };
    });

    // Raise a new transfusion order (status starts at 'requested').
    app.post<{ Body: unknown }>('/order', async (req, reply) => {
      const body = CreateOrderBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);

      const order = store.create<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION, {
        patient: { reference: ref('Patient', patient.id), display: patientName(patient) },
        component: body.component,
        bloodGroup: body.bloodGroup,
        units: body.units,
        indication: body.indication,
        priority: body.priority,
        groupAndSave: body.groupAndSave,
        status: 'requested',
        requestedAt: nowIso(),
      });
      reply.code(201);
      return order;
    });

    // requested → crossmatched (needs a valid Group & Save sample).
    app.post<{ Params: { id: string } }>('/:id/crossmatch', async (req) => {
      const order = getOrder(store, req.params.id);
      expectStatus(order, 'requested', 'crossmatch');
      if (!order.groupAndSave) {
        throw BadRequest('A valid Group & Save sample is required before crossmatch');
      }
      return store.update<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION, order.id, {
        status: 'crossmatched',
        crossmatchedAt: nowIso(),
      });
    });

    // crossmatched → issued (decrements stock for the matched component/group).
    app.post<{ Params: { id: string } }>('/:id/issue', async (req) => {
      const order = getOrder(store, req.params.id);
      expectStatus(order, 'crossmatched', 'issue');

      const entry = stockEntry(store, order.component, order.bloodGroup);
      if (!entry || entry.units < order.units) {
        throw BadRequest(
          `Insufficient ${COMPONENT_LABELS[order.component]} (${order.bloodGroup}) in stock: ` +
            `${entry?.units ?? 0} available, ${order.units} required`,
        );
      }
      store.update<BloodStock>(BLOOD_STOCK_COLLECTION, entry.id, { units: entry.units - order.units });

      return store.update<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION, order.id, {
        status: 'issued',
        issuedAt: nowIso(),
      });
    });

    // issued → transfused (administration complete).
    app.post<{ Params: { id: string } }>('/:id/transfuse', async (req) => {
      const order = getOrder(store, req.params.id);
      expectStatus(order, 'issued', 'transfuse');
      return store.update<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION, order.id, {
        status: 'transfused',
        transfusedAt: nowIso(),
      });
    });
  },

  seed(ctx) {
    seedStock(ctx);
    seedOrders(ctx);
  },
});

// --- helpers ---------------------------------------------------------------

const INDICATIONS = [
  'Symptomatic anaemia',
  'Active haemorrhage',
  'Pre-operative optimisation',
  'Thrombocytopenia',
  'Coagulopathy / abnormal clotting',
  'Gastrointestinal bleed',
  'Post-chemotherapy support',
] as const;

const PRIORITIES: TransfusionPriority[] = ['routine', 'urgent', 'asap', 'stat'];

function priorityRank(priority: TransfusionPriority): number {
  return PRIORITIES.indexOf(priority);
}

function patientName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}

function resolvePatient(
  store: ModuleContext['store'],
  order: TransfusionOrder,
): Patient | null {
  const id = order.patient.reference.split('/')[1] ?? '';
  return store.get<Patient>('Patient', id) ?? null;
}

function getOrder(store: ModuleContext['store'], id: string): TransfusionOrder {
  const order = store.get<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION, id);
  if (!order) throw NotFound(`TransfusionOrder/${id}`);
  return order;
}

function expectStatus(
  order: TransfusionOrder,
  expected: TransfusionOrder['status'],
  action: string,
): void {
  if (order.status !== expected) {
    throw BadRequest(
      `Cannot ${action} an order with status '${order.status}' (expected '${expected}')`,
    );
  }
}

function stockEntry(
  store: ModuleContext['store'],
  component: BloodComponent,
  group: BloodGroup,
): BloodStock | undefined {
  return store
    .list<BloodStock>(BLOOD_STOCK_COLLECTION)
    .find((s) => s.component === component && s.group === group);
}

function availableUnits(
  store: ModuleContext['store'],
  component: BloodComponent,
  group: BloodGroup,
): number {
  return stockEntry(store, component, group)?.units ?? 0;
}

function countByStatus(orders: TransfusionOrder[]): Record<string, number> {
  return orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
}

function timelineOf(order: TransfusionOrder): Array<{ status: string; at: string }> {
  const steps: Array<{ status: string; at?: string }> = [
    { status: 'requested', at: order.requestedAt },
    { status: 'crossmatched', at: order.crossmatchedAt },
    { status: 'issued', at: order.issuedAt },
    { status: 'transfused', at: order.transfusedAt },
  ];
  return steps.filter((s): s is { status: string; at: string } => Boolean(s.at));
}

/** Seed a stock ledger: one entry per component × ABO/Rh group. */
function seedStock(ctx: ModuleContext): void {
  const { store, rng } = ctx;
  const baseByComponent: Record<BloodComponent, [number, number]> = {
    'red-cells': [8, 30],
    platelets: [2, 12],
    ffp: [4, 18],
  };
  for (const component of BLOOD_COMPONENTS) {
    const [min, max] = baseByComponent[component];
    for (const group of BLOOD_GROUPS) {
      // O- (universal donor) and common groups hold more units.
      const scarce = group === 'AB-' || group === 'B-';
      store.create<BloodStock>(BLOOD_STOCK_COLLECTION, {
        component,
        group,
        units: scarce ? randInt(0, Math.round(min), rng) : randInt(min, max, rng),
      });
    }
  }
}

/** Seed ~10 transfusion orders spread across the workflow for admitted patients. */
function seedOrders(ctx: ModuleContext): void {
  const { store, rng } = ctx;

  const admissions = store
    .query<Encounter>('Encounter', (e) => e.class === 'inpatient' && e.status === 'in-progress')
    .slice(0, 12);

  const statuses: TransfusionOrder['status'][] = [
    'requested',
    'requested',
    'requested',
    'crossmatched',
    'crossmatched',
    'issued',
    'issued',
    'transfused',
    'transfused',
    'transfused',
  ];

  statuses.forEach((status, i) => {
    const encounter = admissions[i % Math.max(admissions.length, 1)];
    if (!encounter) return;
    const patientId = encounter.subject.reference.split('/')[1] ?? '';
    const patient = store.get<Patient>('Patient', patientId);
    if (!patient) return;

    const component = pick(BLOOD_COMPONENTS, rng);

    // Derive each step's "hours ago" from the previous one so the timeline is
    // always chronological (request → crossmatch → issue → transfuse).
    let hoursAgo = randInt(48, 96, rng);
    const order: Omit<TransfusionOrder, 'id'> = {
      patient: { reference: ref('Patient', patient.id), display: patientName(patient) },
      encounter: { reference: ref('Encounter', encounter.id) },
      bloodGroup: pick(BLOOD_GROUPS, rng),
      component,
      units: component === 'platelets' ? 1 : randInt(1, 4, rng),
      indication: pick(INDICATIONS, rng),
      priority: pick(PRIORITIES, rng),
      groupAndSave: true,
      status,
      requestedAt: isoHoursFromNow(-hoursAgo),
    };
    if (status !== 'requested') {
      hoursAgo -= randInt(4, 12, rng);
      order.crossmatchedAt = isoHoursFromNow(-hoursAgo);
    }
    if (status === 'issued' || status === 'transfused') {
      hoursAgo -= randInt(2, 8, rng);
      order.issuedAt = isoHoursFromNow(-hoursAgo);
    }
    if (status === 'transfused') {
      hoursAgo -= randInt(1, 4, rng);
      order.transfusedAt = isoHoursFromNow(-hoursAgo);
    }

    store.create<TransfusionOrder>(TRANSFUSION_ORDER_COLLECTION, order);
  });
}
