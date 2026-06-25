import { z } from 'zod';
import {
  RequestPriority,
  type Encounter,
  type Patient,
  type Practitioner,
  type ServiceRequest,
} from '@trustos/ontology';
import { BadRequest, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore } from '../../store/store';
import {
  ORDER_CATALOGUE,
  ORDER_CATEGORY_LABELS,
  catalogueByCode,
  findCatalogueItem,
  type CatalogueItem,
  type OrderCategory,
} from './catalogue';

/**
 * Diagnostic & Procedure Orders (CPOE).
 *
 * Computerised Provider Order Entry built on the core FHIR `ServiceRequest`.
 * Clinicians pick from a coded order catalogue, place orders against a patient,
 * and track them through an outstanding-orders worklist. The order lifecycle is
 * modelled on `ServiceRequest.status`:
 *
 *   draft (Requested) → active (In progress) → completed (Resulted)
 *
 * with `revoked` (Cancelled) reachable from either open state.
 */

type OrderStatus = 'draft' | 'active' | 'completed' | 'revoked';

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Requested',
  active: 'In progress',
  completed: 'Completed',
  revoked: 'Cancelled',
};

/** Allowed forward transitions for the order lifecycle. */
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['active', 'revoked'],
  active: ['completed', 'revoked'],
  completed: [],
  revoked: [],
};

/** Statuses that still need action — the "outstanding" worklist. */
const OUTSTANDING_STATUSES: OrderStatus[] = ['draft', 'active'];

export default defineModule({
  id: 'orders',
  name: 'Diagnostic & Procedure Orders',
  description: 'Clinical order entry (CPOE) for bloods, imaging, ECG and microbiology with a live worklist.',

  routes(app, { store }) {
    // --- Order catalogue -----------------------------------------------------
    app.get<{ Querystring: { category?: string; q?: string } }>('/catalogue', async (req) => {
      const q = (req.query.q ?? '').trim().toLowerCase();
      const category = req.query.category as OrderCategory | undefined;
      const items = ORDER_CATALOGUE.filter((item) => {
        if (category && item.category !== category) return false;
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.display.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q)
        );
      });
      return {
        total: items.length,
        categories: (Object.keys(ORDER_CATEGORY_LABELS) as OrderCategory[]).map((key) => ({
          key,
          label: ORDER_CATEGORY_LABELS[key],
          count: items.filter((i) => i.category === key).length,
        })),
        items,
      };
    });

    // --- Place an order ------------------------------------------------------
    const OrderBody = z.object({
      patientId: z.string().min(1),
      itemId: z.string().min(1),
      priority: RequestPriority.default('routine'),
      clinicalDetails: z.string().max(2000).optional(),
      requesterId: z.string().min(1).optional(),
    });
    app.post<{ Body: unknown }>('/order', async (req, reply) => {
      const body = OrderBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      const item = findCatalogueItem(body.itemId);
      if (!item) throw BadRequest(`Unknown catalogue item '${body.itemId}'`);

      let requester: Practitioner | undefined;
      if (body.requesterId) {
        requester = store.getOrThrow<Practitioner>('Practitioner', body.requesterId);
      }

      const encounter = activeEncounter(store, patient.id);
      const created = store.create<ServiceRequest>('ServiceRequest', {
        status: 'draft',
        intent: 'order',
        priority: body.priority,
        category: item.category,
        code: {
          coding: [{ system: item.system, code: item.code, display: item.display }],
          text: item.name,
        },
        subject: { reference: ref('Patient', patient.id), display: patientName(patient) },
        ...(encounter ? { encounter: { reference: ref('Encounter', encounter.id) } } : {}),
        ...(requester
          ? { requester: { reference: ref('Practitioner', requester.id), display: practitionerName(requester) } }
          : {}),
        authoredOn: nowIso(),
        reasonText: body.clinicalDetails,
      });

      reply.code(201);
      return enrichOrder(store, created, item);
    });

    // --- Outstanding-orders worklist ----------------------------------------
    app.get<{ Querystring: { status?: string; category?: string; priority?: string } }>(
      '/worklist',
      async (req) => {
        const statusFilter = req.query.status as OrderStatus | undefined;
        const categoryFilter = req.query.category as OrderCategory | undefined;
        const priorityFilter = req.query.priority;

        const all = store
          .list<ServiceRequest>('ServiceRequest')
          .filter((o) => (statusFilter ? o.status === statusFilter : isOutstanding(o.status)))
          .filter((o) => (categoryFilter ? o.category === categoryFilter : true))
          .filter((o) => (priorityFilter ? o.priority === priorityFilter : true))
          .map((o) => enrichOrder(store, o))
          .sort(byUrgencyThenAge);

        const groups = (Object.keys(ORDER_CATEGORY_LABELS) as OrderCategory[])
          .map((key) => ({
            key,
            label: ORDER_CATEGORY_LABELS[key],
            orders: all.filter((o) => o.category === key),
          }))
          .filter((g) => g.orders.length > 0);

        return {
          total: all.length,
          summary: {
            requested: all.filter((o) => o.status === 'draft').length,
            inProgress: all.filter((o) => o.status === 'active').length,
            urgent: all.filter((o) => o.priority === 'urgent' || o.priority === 'stat' || o.priority === 'asap').length,
            overdue: all.filter((o) => o.overdue).length,
          },
          groups,
          orders: all,
        };
      },
    );

    // --- Single order (composite read) --------------------------------------
    app.get<{ Params: { id: string } }>('/:id', async (req) => {
      const order = store.getOrThrow<ServiceRequest>('ServiceRequest', req.params.id);
      return enrichOrder(store, order);
    });

    // --- Status transition ---------------------------------------------------
    const StatusBody = z.object({
      status: z.enum(['draft', 'active', 'completed', 'revoked']),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/status', async (req) => {
      const order = store.getOrThrow<ServiceRequest>('ServiceRequest', req.params.id);
      const { status: next } = StatusBody.parse(req.body);
      const current = order.status as OrderStatus;

      if (next === current) return enrichOrder(store, order);
      if (!ORDER_STATUS_TRANSITIONS[current]?.includes(next)) {
        throw BadRequest(
          `Illegal order transition ${current} (${ORDER_STATUS_LABELS[current]}) → ${next} (${ORDER_STATUS_LABELS[next]})`,
        );
      }

      const patch: Record<string, unknown> = { status: next };
      if (next === 'completed') patch.occurrenceDateTime = nowIso();
      const updated = store.update<ServiceRequest>('ServiceRequest', order.id, patch);
      return enrichOrder(store, updated);
    });
  },

  // --- Deterministic demo data ----------------------------------------------
  seed({ store, rng }) {
    const admitted = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );
    if (admitted.length === 0) return;

    const practitioners = store.list<Practitioner>('Practitioner');
    const requesters = practitioners.filter((p) =>
      ['Consultant', 'Registrar', 'Junior Doctor'].includes(p.role ?? ''),
    );

    // A weighted spread of statuses so the worklist looks realistic.
    const statusPool: OrderStatus[] = [
      'draft',
      'draft',
      'draft',
      'active',
      'active',
      'completed',
    ];

    for (let i = 0; i < 15; i++) {
      const encounter = pick(admitted, rng);
      const patient = store.get<Patient>('Patient', refId(encounter.subject.reference));
      if (!patient) continue;

      const item = pick(ORDER_CATALOGUE, rng);
      const status = pick(statusPool, rng);
      const priority = pick(['routine', 'routine', 'urgent', 'asap', 'stat'] as const, rng);
      const requester = requesters.length > 0 ? pick(requesters, rng) : undefined;
      const authoredHoursAgo = randInt(1, 96, rng);

      store.create<ServiceRequest>('ServiceRequest', {
        status,
        intent: 'order',
        priority,
        category: item.category,
        code: {
          coding: [{ system: item.system, code: item.code, display: item.display }],
          text: item.name,
        },
        subject: { reference: ref('Patient', patient.id), display: patientName(patient) },
        encounter: { reference: ref('Encounter', encounter.id) },
        ...(requester
          ? { requester: { reference: ref('Practitioner', requester.id), display: practitionerName(requester) } }
          : {}),
        authoredOn: hoursAgoIso(authoredHoursAgo),
        ...(status === 'completed' ? { occurrenceDateTime: hoursAgoIso(randInt(0, authoredHoursAgo, rng)) } : {}),
        reasonText: pick(
          ['Sepsis screen', 'Pre-operative work-up', 'Chest pain pathway', 'Acute kidney injury', 'Routine ward round'],
          rng,
        ),
      });
    }
  },
});

// --- helpers ----------------------------------------------------------------

interface EnrichedOrder {
  id: string;
  status: OrderStatus;
  statusLabel: string;
  priority: ServiceRequest['priority'];
  category?: string;
  categoryLabel?: string;
  display: string;
  code?: string;
  system?: string;
  catalogueId?: string;
  specimen?: string;
  modality?: string;
  turnaroundHours?: number;
  authoredOn?: string;
  ageHours: number;
  overdue: boolean;
  reasonText?: string;
  patient: { id: string; name: string } | null;
  requester?: string;
  nextStatuses: Array<{ status: OrderStatus; label: string }>;
}

function enrichOrder(store: DataStore, order: ServiceRequest, knownItem?: CatalogueItem): EnrichedOrder {
  const coding = order.code?.coding?.[0];
  const item =
    knownItem ?? (coding ? catalogueByCode(coding.system, coding.code) : undefined);
  const status = order.status as OrderStatus;
  const patient = order.subject?.reference
    ? store.get<Patient>('Patient', refId(order.subject.reference))
    : undefined;
  const ageHours = order.authoredOn
    ? Math.max(0, Math.round((Date.now() - new Date(order.authoredOn).getTime()) / 3_600_000))
    : 0;
  const overdue =
    status === 'active' && item?.turnaroundHours !== undefined && ageHours > item.turnaroundHours;

  return {
    id: order.id,
    status,
    statusLabel: ORDER_STATUS_LABELS[status] ?? status,
    priority: order.priority,
    category: order.category,
    categoryLabel: order.category ? ORDER_CATEGORY_LABELS[order.category as OrderCategory] : undefined,
    display: order.code?.text ?? item?.name ?? coding?.display ?? 'Order',
    code: coding?.code,
    system: coding?.system,
    catalogueId: item?.id,
    specimen: item?.specimen,
    modality: item?.modality,
    turnaroundHours: item?.turnaroundHours,
    authoredOn: order.authoredOn,
    ageHours,
    overdue,
    reasonText: order.reasonText,
    patient: patient ? { id: patient.id, name: patientName(patient) } : null,
    requester: order.requester?.display,
    nextStatuses: (ORDER_STATUS_TRANSITIONS[status] ?? []).map((s) => ({
      status: s,
      label: ORDER_STATUS_LABELS[s],
    })),
  };
}

const PRIORITY_RANK: Record<string, number> = { stat: 0, asap: 1, urgent: 2, routine: 3 };

function byUrgencyThenAge(a: EnrichedOrder, b: EnrichedOrder): number {
  const pa = PRIORITY_RANK[a.priority] ?? 9;
  const pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return b.ageHours - a.ageHours;
}

function isOutstanding(status: string): boolean {
  return OUTSTANDING_STATUSES.includes(status as OrderStatus);
}

function activeEncounter(store: DataStore, patientId: string): Encounter | undefined {
  return store
    .query<Encounter>(
      'Encounter',
      (e) =>
        e.status === 'in-progress' && refId(e.subject?.reference ?? '') === patientId,
    )
    .sort((a, b) => (b.period?.start ?? '').localeCompare(a.period?.start ?? ''))[0];
}

function patientName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
}

function practitionerName(p: Practitioner): string {
  const name = p.name?.[0];
  const prefix = name?.prefix?.[0] ? `${name.prefix[0]} ` : '';
  return `${prefix}${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}

function refId(reference: string): string {
  return reference.split('/')[1] ?? '';
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}
