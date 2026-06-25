import { z } from 'zod';
import {
  CodeSystems,
  type Encounter,
  type Location,
  type MedicationAdministration,
  type MedicationRequest,
  type Patient,
  type Practitioner,
} from '@trustos/ontology';
import { BadRequest, NotFound, isoDaysAgo, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore } from '../../store/store';
import {
  type DoseStatus,
  FORMULARY,
  FREQUENCY_LABELS,
  type FrequencyCode,
  MATCH_WINDOW_MS,
  OMISSION_REASONS,
  STATUS_ORDER,
  hashId,
  isFrequencyCode,
  nearestSlot,
  omissionReason,
  scheduleSlots,
  slotId,
  slotStatus,
} from './schedule';

const ROUND_WINDOW_MS = 12 * 60 * 60 * 1000;

interface PatientSummary {
  id: string;
  name: string;
  nhsNumber?: string;
  birthDate?: string;
}

interface WardRef {
  id: string;
  name: string;
}

interface AdministrationView {
  id: string;
  status: MedicationAdministration['status'];
  effectiveDateTime: string;
  performer?: string;
  notGivenReason?: string;
}

interface RoundItem {
  id: string;
  status: DoseStatus;
  scheduledTime: string;
  medicationRequestId: string;
  medication: string;
  dose?: string;
  route?: string;
  frequency?: string;
  patient: PatientSummary;
  ward: WardRef | null;
  administration: AdministrationView | null;
}

/**
 * Medication Administration (eMAR) — the electronic drug round.
 *
 * Workflow endpoints on top of the core EPMA resources (`MedicationRequest`
 * orders + `MedicationAdministration` events): a live ward worklist of due /
 * overdue / given doses computed from a notional schedule, a single
 * record-administration transition (given or omitted with a reason code), and a
 * per-patient administration history.
 */
export default defineModule({
  id: 'medadmin',
  name: 'Medication Administration (eMAR)',
  description: 'Electronic drug round: due/overdue worklist, administration recording and history.',

  routes(app, { store }) {
    // The live drug round for one ward (?ward=<locationId>) or all wards,
    // optionally filtered to a single status (?status=overdue|due|...).
    app.get<{ Querystring: { ward?: string; status?: string } }>('/round', async (req) => {
      const now = new Date();
      const from = new Date(now.getTime() - ROUND_WINDOW_MS);
      const to = new Date(now.getTime() + ROUND_WINDOW_MS);

      const wards = store.list<Location>('Location', { physicalType: 'ward' });
      const wardFilter = req.query.ward?.trim();
      if (wardFilter && !wards.some((w) => w.id === wardFilter)) {
        throw NotFound(`Location/${wardFilter}`);
      }
      const statusParam = req.query.status?.trim();
      if (statusParam && !(statusParam in STATUS_ORDER)) {
        throw BadRequest(`Unknown status filter: ${statusParam}`);
      }
      const statusFilter = statusParam as DoseStatus | undefined;

      const encounters = store.query<Encounter>(
        'Encounter',
        (e) => e.class === 'inpatient' && e.status === 'in-progress',
      );

      const items: RoundItem[] = [];
      const seen = new Set<string>();
      for (const encounter of encounters) {
        const patientId = encounter.subject?.reference?.split('/')[1];
        if (!patientId || seen.has(patientId)) continue;
        seen.add(patientId);
        const patient = store.get<Patient>('Patient', patientId);
        if (!patient) continue;
        const ward = wardForPatient(patientId, wards);
        if (wardFilter && ward?.id !== wardFilter) continue;

        const requests = activeRequests(store, patientId);
        for (const mr of requests) {
          for (const item of roundItemsForRequest(store, mr, patient, ward, from, to, now)) {
            items.push(item);
          }
        }
      }

      items.sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          a.scheduledTime.localeCompare(b.scheduledTime),
      );

      const stats = emptyStats();
      for (const item of items) stats[item.status]++;

      const wardSummaries = summariseWards(
        items,
        wardFilter ? wards.filter((w) => w.id === wardFilter) : wards,
      );
      const visible = statusFilter ? items.filter((i) => i.status === statusFilter) : items;

      return {
        generatedAt: now.toISOString(),
        ward: wardFilter ? toWardRef(wards.find((w) => w.id === wardFilter)) : null,
        wards: wardSummaries,
        stats: { ...stats, total: items.length },
        items: visible,
      };
    });

    // Record an administration event for one scheduled dose: given or omitted.
    const AdministerBody = z.object({
      medicationRequestId: z.string().min(1),
      scheduledTime: z.string().datetime({ offset: true }).optional(),
      status: z.enum(['given', 'omitted']),
      reasonCode: z.string().optional(),
      performerId: z.string().optional(),
    });

    app.post<{ Body: unknown }>('/administer', async (req, reply) => {
      const body = AdministerBody.parse(req.body);
      const mr = store.get<MedicationRequest>('MedicationRequest', body.medicationRequestId);
      if (!mr) throw NotFound(`MedicationRequest/${body.medicationRequestId}`);
      if (mr.status !== 'active') {
        throw BadRequest(`MedicationRequest/${mr.id} is not active (status: ${mr.status})`);
      }

      // Idempotency: refuse to record the same scheduled dose twice.
      if (body.scheduledTime) {
        const target = Date.parse(body.scheduledTime);
        const slots = scheduleSlots(
          frequencyCode(mr),
          new Date(target - MATCH_WINDOW_MS),
          new Date(target + MATCH_WINDOW_MS),
          new Date(target),
        );
        const targetSlot = nearestSlot(slots, target)?.slot ?? body.scheduledTime;
        const alreadyRecorded = store
          .query<MedicationAdministration>(
            'MedicationAdministration',
            (a) => a.request?.reference === ref('MedicationRequest', mr.id),
          )
          .some((a) => {
            const match = nearestSlot(slots, Date.parse(a.effectiveDateTime));
            return match !== null && match.dist <= MATCH_WINDOW_MS && match.slot === targetSlot;
          });
        if (alreadyRecorded) {
          throw BadRequest('This dose has already been recorded for the selected time');
        }
      }

      let reason: { code: string; display: string } | undefined;
      if (body.status === 'omitted') {
        if (!body.reasonCode)
          throw BadRequest('An omission reason code is required when omitting a dose');
        reason = omissionReason(body.reasonCode);
        if (!reason) throw BadRequest(`Unknown omission reason code: ${body.reasonCode}`);
      }

      let performer: { reference: string; display?: string } | undefined;
      if (body.performerId) {
        const p = store.getOrThrow<Practitioner>('Practitioner', body.performerId);
        performer = { reference: ref('Practitioner', p.id), display: practitionerName(p) };
      }

      const dose = mr.dosageInstruction?.[0];
      const created = store.create<MedicationAdministration>('MedicationAdministration', {
        status: body.status === 'given' ? 'completed' : 'not-done',
        medication: mr.medication,
        subject: mr.subject,
        request: { reference: ref('MedicationRequest', mr.id) },
        effectiveDateTime: body.scheduledTime ?? new Date().toISOString(),
        ...(performer ? { performer } : {}),
        ...(dose?.doseQuantity ? { dosageText: dose.doseQuantity } : {}),
        ...(reason ? { notGivenReason: reason.display } : {}),
      });

      reply.code(201);
      return { administration: created, scheduledTime: body.scheduledTime ?? null };
    });

    // Full administration history (given + omitted) for one patient.
    app.get<{ Params: { patientId: string } }>('/history/:patientId', async (req) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
      const patientRef = ref('Patient', patient.id);

      const administrations = store
        .query<MedicationAdministration>(
          'MedicationAdministration',
          (a) => a.subject?.reference === patientRef,
        )
        .sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime));

      const given = administrations.filter((a) => a.status === 'completed').length;
      const omitted = administrations.filter((a) => a.status === 'not-done').length;

      return {
        patient: toPatientSummary(patient),
        activeOrders: activeRequests(store, patient.id).map((mr) => ({
          id: mr.id,
          medication: medicationName(mr),
          dose: mr.dosageInstruction?.[0]?.doseQuantity,
          route: mr.dosageInstruction?.[0]?.route,
          frequency: frequencyLabel(mr),
        })),
        total: administrations.length,
        given,
        omitted,
        events: administrations.map((a) => ({
          id: a.id,
          status: a.status,
          medication: a.medication?.text ?? a.medication?.coding?.[0]?.display ?? 'Medication',
          effectiveDateTime: a.effectiveDateTime,
          performer: a.performer?.display,
          notGivenReason: a.notGivenReason,
          requestId: a.request?.reference?.split('/')[1],
        })),
      };
    });

    // Reference list powering the frontend omission-reason picker.
    app.get('/reasons', async () => ({ reasons: OMISSION_REASONS }));
  },

  /**
   * Deterministic demo data: for each admitted patient, prescribe a handful of
   * realistic inpatient medications and back-fill a 24h mix of given/omitted
   * administrations, leaving recent doses un-actioned so the round shows live
   * due/overdue work. All randomness flows through the seeded `rng`.
   */
  seed({ store, rng }) {
    const encounters = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );
    const practitioners = store.list<Practitioner>('Practitioner');
    const nurses = practitioners.filter((p) => p.role === 'Staff Nurse');
    const performerPool = nurses.length ? nurses : practitioners;
    if (!performerPool.length) return;

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (const encounter of encounters) {
      const patientId = encounter.subject?.reference?.split('/')[1];
      if (!patientId) continue;
      const patient = store.get<Patient>('Patient', patientId);
      if (!patient) continue;

      // Always lay down a small, frequency-varied inpatient regimen of our own
      // so the drug round is populated with actionable doses at any time of day,
      // then also administer against any orders other modules (e.g.
      // e-prescribing) have already written for the patient.
      const existing = activeRequests(store, patientId);
      const seeded = seedRegimen(store, patient, patientId, encounter.id, practitioners, rng);
      for (const mr of [...existing, ...seeded]) {
        seedAdministrations(
          store,
          mr,
          frequencyCode(mr),
          mr.dosageInstruction?.[0]?.doseQuantity ?? '',
          performerPool,
          dayAgo,
          now,
          rng,
        );
      }
    }
  },
});

function seedRegimen(
  store: DataStore,
  patient: Patient,
  patientId: string,
  encounterId: string,
  practitioners: Practitioner[],
  rng: () => number,
): MedicationRequest[] {
  const drugs = sample(FORMULARY, randInt(2, 5, rng), rng);
  return drugs.map((drug) => {
    const requester = pick(practitioners, rng);
    return store.create<MedicationRequest>('MedicationRequest', {
      status: 'active',
      intent: 'order',
      priority: 'routine',
      medication: {
        coding: [{ system: CodeSystems.DMD, code: drug.code, display: drug.display }],
        text: drug.display,
      },
      subject: { reference: ref('Patient', patientId), display: patientDisplay(patient) },
      encounter: { reference: ref('Encounter', encounterId) },
      requester: {
        reference: ref('Practitioner', requester.id),
        display: practitionerName(requester),
      },
      authoredOn: isoDaysAgo(randInt(1, 6, rng)),
      dosageInstruction: [
        {
          text: `${drug.dose} ${drug.route} — ${FREQUENCY_LABELS[drug.frequency]}`,
          route: drug.route,
          doseQuantity: drug.dose,
          frequency: drug.frequency,
          asNeeded: false,
        },
      ],
      courseOfTherapyType: 'continuous',
    });
  });
}

function seedAdministrations(
  store: DataStore,
  mr: MedicationRequest,
  frequency: FrequencyCode,
  dose: string,
  performerPool: Practitioner[],
  from: Date,
  now: Date,
  rng: () => number,
): void {
  const slots = scheduleSlots(frequency, from, now, now);
  for (const slotIso of slots) {
    const slotMs = Date.parse(slotIso);
    // Leave the last hour un-actioned so the round surfaces live due/overdue.
    if (slotMs > now.getTime() - 60 * 60 * 1000) continue;
    const roll = rng();
    if (roll < 0.08) continue; // missed dose -> becomes overdue on the round
    const omitted = roll >= 0.9; // ~10% omitted
    const performer = pick(performerPool, rng);
    const jitterMs = Math.floor((rng() - 0.5) * 30 * 60 * 1000);
    const reason = omitted ? pick(OMISSION_REASONS, rng) : undefined;

    store.create<MedicationAdministration>('MedicationAdministration', {
      status: omitted ? 'not-done' : 'completed',
      medication: mr.medication,
      subject: mr.subject,
      request: { reference: ref('MedicationRequest', mr.id) },
      effectiveDateTime: new Date(slotMs + jitterMs).toISOString(),
      performer: {
        reference: ref('Practitioner', performer.id),
        display: practitionerName(performer),
      },
      dosageText: dose,
      ...(reason ? { notGivenReason: reason.display } : {}),
    });
  }
}

function roundItemsForRequest(
  store: DataStore,
  mr: MedicationRequest,
  patient: Patient,
  ward: WardRef | null,
  from: Date,
  to: Date,
  now: Date,
): RoundItem[] {
  const freq = frequencyCode(mr);
  const slots = scheduleSlots(freq, from, to, now);
  if (!slots.length) return [];

  const admins = store.query<MedicationAdministration>(
    'MedicationAdministration',
    (a) => a.request?.reference === ref('MedicationRequest', mr.id),
  );

  // Greedily attach each administration to its single nearest scheduled slot.
  const bySlot = new Map<string, { admin: MedicationAdministration; dist: number }>();
  for (const admin of admins) {
    const at = Date.parse(admin.effectiveDateTime);
    let best: string | undefined;
    let bestDist = Infinity;
    for (const slot of slots) {
      const dist = Math.abs(Date.parse(slot) - at);
      if (dist < bestDist) {
        bestDist = dist;
        best = slot;
      }
    }
    if (best && bestDist <= MATCH_WINDOW_MS) {
      const current = bySlot.get(best);
      if (!current || bestDist < current.dist) bySlot.set(best, { admin, dist: bestDist });
    }
  }

  const patientSummary = toPatientSummary(patient);
  const nowMs = now.getTime();
  return slots.map((slot) => {
    const admin = bySlot.get(slot)?.admin;
    const status: DoseStatus = admin
      ? admin.status === 'not-done'
        ? 'omitted'
        : 'given'
      : slotStatus(Date.parse(slot), nowMs);
    return {
      id: slotId(mr.id, slot),
      status,
      scheduledTime: slot,
      medicationRequestId: mr.id,
      medication: medicationName(mr),
      dose: mr.dosageInstruction?.[0]?.doseQuantity,
      route: mr.dosageInstruction?.[0]?.route,
      frequency: frequencyLabel(mr),
      patient: patientSummary,
      ward,
      administration: admin
        ? {
            id: admin.id,
            status: admin.status,
            effectiveDateTime: admin.effectiveDateTime,
            performer: admin.performer?.display,
            notGivenReason: admin.notGivenReason,
          }
        : null,
    };
  });
}

function activeRequests(store: DataStore, patientId: string): MedicationRequest[] {
  const patientRef = ref('Patient', patientId);
  return store.query<MedicationRequest>(
    'MedicationRequest',
    (m) => m.subject?.reference === patientRef && m.status === 'active',
  );
}

function wardForPatient(patientId: string, wards: Location[]): WardRef | null {
  if (!wards.length) return null;
  const ward = wards[hashId(patientId) % wards.length];
  return ward ? { id: ward.id, name: ward.name } : null;
}

function summariseWards(items: RoundItem[], wards: Location[]) {
  return wards
    .map((ward) => {
      const wardItems = items.filter((i) => i.ward?.id === ward.id);
      const counts = emptyStats();
      for (const item of wardItems) counts[item.status]++;
      return { id: ward.id, name: ward.name, total: wardItems.length, ...counts };
    })
    .filter((w) => w.total > 0)
    .sort((a, b) => b.overdue - a.overdue || b.due - a.due || a.name.localeCompare(b.name));
}

function emptyStats(): Record<DoseStatus, number> {
  return { overdue: 0, due: 0, upcoming: 0, given: 0, omitted: 0 };
}

function frequencyCode(mr: MedicationRequest): FrequencyCode {
  const freq = mr.dosageInstruction?.[0]?.frequency;
  return isFrequencyCode(freq) ? freq : 'OD';
}

function frequencyLabel(mr: MedicationRequest): string {
  return FREQUENCY_LABELS[frequencyCode(mr)];
}

function medicationName(mr: MedicationRequest): string {
  return mr.medication?.text ?? mr.medication?.coding?.[0]?.display ?? 'Medication';
}

function toWardRef(ward?: Location): WardRef | null {
  return ward ? { id: ward.id, name: ward.name } : null;
}

function toPatientSummary(patient: Patient): PatientSummary {
  return {
    id: patient.id,
    name: patientDisplay(patient),
    nhsNumber: patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
    birthDate: patient.birthDate,
  };
}

function patientDisplay(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
}

function practitionerName(p: Practitioner): string {
  const name = p.name?.[0];
  const prefix = name?.prefix?.[0] ? `${name.prefix[0]} ` : '';
  return `${prefix}${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown';
}

function sample<T>(arr: readonly T[], count: number, rng: () => number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0] as T);
  }
  return out;
}
