import { z } from 'zod';
import {
  CodeSystems,
  type AllergyIntolerance,
  type Encounter,
  type MedicationRequest,
  type Patient,
  type Practitioner,
} from '@trustos/ontology';
import {
  ApiError,
  BadRequest,
  NotFound,
  isoDaysAgo,
  nowIso,
  pick,
  randInt,
  ref,
} from '@trustos/core';
import type { DataStore } from '../../store/store';
import { defineModule } from '../types';
import {
  DISPENSE_COLLECTION,
  DispenseRecordSchema,
  MEDICATION_CATALOGUE,
  detectAllergyConflicts,
  type DispenseRecord,
  type DispenseStatus,
} from './pharmacy';

/**
 * Pharmacy Verification & Stock.
 *
 * Inpatient clinical screening and dispensing of electronic prescriptions
 * (`MedicationRequest`), complementing the prescribing (EPMA) workflow. Each
 * prescription that reaches pharmacy gets a `DispenseRecord` that moves through
 * to-verify → verified → dispensed, with a "query" lane for pharmacist
 * clarifications. The verify queue surfaces patient + allergy context so a
 * pharmacist can clinically screen safely.
 */
export default defineModule({
  id: 'pharmacy',
  name: 'Pharmacy Verification & Stock',
  description: 'Clinical screening, verification and dispensing of inpatient prescriptions.',

  collections: [
    { name: DISPENSE_COLLECTION, validator: (input) => DispenseRecordSchema.parse(input) },
  ],

  routes(app, { store }) {
    /** Pharmacist verification worklist with patient + allergy context. */
    app.get<{ Querystring: { status?: string } }>('/verify-queue', async (req) => {
      const filter = (req.query.status ?? 'to-verify') as DispenseStatus | 'all';
      const records = store
        .list<DispenseRecord>(DISPENSE_COLLECTION)
        .filter((r) => (filter === 'all' ? true : r.status === filter));
      const items = records.map((r) => enrich(store, r)).sort((a, b) => sortKey(b) - sortKey(a));
      return { total: items.length, status: filter, items };
    });

    /** Full context for a single dispense record (verification screen). */
    app.get<{ Params: { id: string } }>('/:id', async (req) => {
      const record = store.getOrThrow<DispenseRecord>(DISPENSE_COLLECTION, req.params.id);
      return enrich(store, record);
    });

    /** Clinically verify a prescription (to-verify | query → verified). */
    const VerifyBody = z.object({
      pharmacistId: z.string().optional(),
      note: z.string().max(500).optional(),
      overrideAllergy: z.boolean().optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/verify', async (req) => {
      const body = VerifyBody.parse(req.body ?? {});
      const record = store.getOrThrow<DispenseRecord>(DISPENSE_COLLECTION, req.params.id);
      if (record.status === 'verified' || record.status === 'dispensed') {
        throw new ApiError(409, `Prescription already ${record.status}`, 'invalid_transition');
      }
      const enriched = enrich(store, record);
      if (enriched.allergyConflicts.length > 0 && !body.overrideAllergy) {
        throw new ApiError(
          409,
          'Allergy conflict detected — set overrideAllergy to verify with documented rationale',
          'allergy_conflict',
        );
      }
      const pharmacist = resolvePharmacist(store, body.pharmacistId);
      return transition(store, record, 'verified', pharmacist, body.note);
    });

    /** Raise a clarification query back to the prescriber (→ query). */
    const QueryBody = z.object({
      note: z.string().min(1, 'A query note is required').max(500),
      pharmacistId: z.string().optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/query', async (req) => {
      const body = QueryBody.parse(req.body ?? {});
      const record = store.getOrThrow<DispenseRecord>(DISPENSE_COLLECTION, req.params.id);
      if (record.status === 'verified' || record.status === 'dispensed') {
        throw new ApiError(409, `Cannot query a ${record.status} prescription`, 'invalid_transition');
      }
      const pharmacist = resolvePharmacist(store, body.pharmacistId);
      return transition(store, record, 'query', pharmacist, body.note);
    });

    /** Dispense a verified prescription (verified → dispensed). */
    const DispenseBody = z.object({
      pharmacistId: z.string().optional(),
      note: z.string().max(500).optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/dispense', async (req) => {
      const body = DispenseBody.parse(req.body ?? {});
      const record = store.getOrThrow<DispenseRecord>(DISPENSE_COLLECTION, req.params.id);
      if (record.status !== 'verified') {
        throw BadRequest('Only verified prescriptions can be dispensed');
      }
      const pharmacist = resolvePharmacist(store, body.pharmacistId);
      return transition(store, record, 'dispensed', pharmacist, body.note);
    });

    /** Department metrics for the pharmacy command-centre tile. */
    app.get('/metrics', async () => {
      const records = store.list<DispenseRecord>(DISPENSE_COLLECTION);
      const byStatus: Record<DispenseStatus, number> = {
        'to-verify': 0,
        verified: 0,
        dispensed: 0,
        query: 0,
      };
      let allergyAlerts = 0;
      let urgent = 0;
      for (const r of records) {
        byStatus[r.status] += 1;
        const enriched = enrich(store, r);
        if (enriched.allergyConflicts.length > 0 && r.status === 'to-verify') allergyAlerts += 1;
        if ((r.priority === 'urgent' || r.priority === 'stat') && r.status === 'to-verify')
          urgent += 1;
      }
      return {
        total: records.length,
        byStatus,
        toVerify: byStatus['to-verify'],
        allergyAlerts,
        urgent,
        pharmacists: store.query<Practitioner>('Practitioner', (p) => p.role === 'Pharmacist')
          .length,
      };
    });
  },

  seed({ store, rng }) {
    const patients = store.list<Patient>('Patient');
    if (patients.length === 0) return;

    const pharmacists = store.query<Practitioner>('Practitioner', (p) => p.role === 'Pharmacist');
    const prescribers = store.query<Practitioner>(
      'Practitioner',
      (p) => p.role === 'Consultant' || p.role === 'Registrar' || p.role === 'Junior Doctor',
    );

    // Prefer prescriptions for active inpatients; fall back to any patient.
    const inpatientRefs = new Set(
      store
        .query<Encounter>('Encounter', (e) => e.class === 'inpatient' && e.status === 'in-progress')
        .map((e) => e.subject.reference),
    );
    const candidates = patients.filter((p) => inpatientRefs.has(ref('Patient', p.id)));
    const subjects = candidates.length > 0 ? candidates : patients.slice(0, 12);

    // Reuse any existing MedicationRequests; otherwise create a realistic set.
    let prescriptions = store.list<MedicationRequest>('MedicationRequest');
    if (prescriptions.length === 0) {
      prescriptions = [];
      for (const patient of subjects) {
        const display = patientDisplay(patient);
        const count = randInt(1, 3, rng);
        for (let i = 0; i < count; i++) {
          const drug = pick(MEDICATION_CATALOGUE, rng);
          const prescriber = prescribers.length > 0 ? pick(prescribers, rng) : undefined;
          prescriptions.push(
            store.create<MedicationRequest>('MedicationRequest', {
              status: 'active',
              intent: 'order',
              priority: rng() < 0.2 ? 'urgent' : 'routine',
              medication: {
                coding: [{ system: CodeSystems.SNOMED, code: drug.code, display: drug.name }],
                text: drug.name,
              },
              subject: { reference: ref('Patient', patient.id), display },
              requester: prescriber ? { reference: ref('Practitioner', prescriber.id) } : undefined,
              authoredOn: isoDaysAgo(0, new Date()),
              dosageInstruction: [
                {
                  text: `${drug.dose} ${drug.route} ${drug.frequency}`,
                  route: drug.route,
                  doseQuantity: drug.dose,
                  frequency: drug.frequency,
                  asNeeded: drug.asNeeded ?? false,
                },
              ],
              dispenseQuantity: drug.dispenseQuantity,
              courseOfTherapyType: drug.asNeeded ? 'acute' : 'continuous',
            }),
          );
        }
      }
    }

    // One dispense record per prescription, mostly awaiting verification.
    for (const mr of prescriptions) {
      const roll = rng();
      let status: DispenseStatus = 'to-verify';
      if (roll > 0.92) status = 'dispensed';
      else if (roll > 0.78) status = 'verified';
      else if (roll > 0.68) status = 'query';

      const needsPharmacist = status !== 'to-verify';
      const pharmacist =
        needsPharmacist && pharmacists.length > 0 ? pick(pharmacists, rng) : undefined;
      const createdAt = isoDaysAgo(0, new Date(Date.now() - randInt(5, 600, rng) * 60_000));
      const note =
        status === 'query'
          ? pick(
              [
                'Dose appears high for renal function — please confirm.',
                'No indication documented — clarify before dispensing.',
                'Possible duplication with existing therapy.',
                'Confirm route — enteral vs IV.',
              ],
              rng,
            )
          : undefined;

      store.create<DispenseRecord>(DISPENSE_COLLECTION, {
        medicationRequest: ref('MedicationRequest', mr.id),
        patient: mr.subject.reference,
        status,
        priority: mr.priority ?? 'routine',
        pharmacist: pharmacist ? ref('Practitioner', pharmacist.id) : undefined,
        note,
        createdAt,
        updatedAt: status === 'to-verify' ? createdAt : nowIso(),
        history: [
          {
            status,
            at: createdAt,
            by: pharmacist ? ref('Practitioner', pharmacist.id) : undefined,
          },
        ],
      });
    }
  },
});

interface EnrichedRecord {
  record: DispenseRecord;
  medicationRequest: MedicationRequest | null;
  patient: Patient | null;
  prescriber: Practitioner | null;
  pharmacist: Practitioner | null;
  allergies: AllergyIntolerance[];
  allergyConflicts: AllergyIntolerance[];
  waitingMinutes: number;
}

function enrich(store: DataStore, record: DispenseRecord): EnrichedRecord {
  const medicationRequest = refTo<MedicationRequest>(store, record.medicationRequest);
  const patient = refTo<Patient>(store, record.patient);
  const prescriber = medicationRequest?.requester?.reference
    ? refTo<Practitioner>(store, medicationRequest.requester.reference)
    : null;
  const pharmacist = record.pharmacist ? refTo<Practitioner>(store, record.pharmacist) : null;
  const allergies = patient
    ? store.query<AllergyIntolerance>(
        'AllergyIntolerance',
        (a) => a.patient?.reference === ref('Patient', patient.id) && a.clinicalStatus === 'active',
      )
    : [];
  const allergyConflicts = medicationRequest
    ? detectAllergyConflicts(medicationRequest, allergies)
    : [];
  const waitingMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(record.createdAt).getTime()) / 60_000),
  );
  return {
    record,
    medicationRequest,
    patient,
    prescriber,
    pharmacist,
    allergies,
    allergyConflicts,
    waitingMinutes,
  };
}

function refTo<T extends { id: string }>(
  store: DataStore,
  reference: string | undefined,
): T | null {
  if (!reference) return null;
  const [type, id] = reference.split('/');
  if (!type || !id) return null;
  return (store.get<T & { id: string }>(type, id) as T) ?? null;
}

function resolvePharmacist(store: DataStore, pharmacistId?: string): Practitioner {
  if (pharmacistId) {
    const found = store.get<Practitioner>('Practitioner', pharmacistId);
    if (!found) throw NotFound(`Practitioner/${pharmacistId}`);
    return found;
  }
  const pharmacists = store.query<Practitioner>('Practitioner', (p) => p.role === 'Pharmacist');
  if (pharmacists.length === 0) throw new ApiError(409, 'No pharmacist available', 'no_pharmacist');
  return pharmacists[0] as Practitioner;
}

function transition(
  store: DataStore,
  record: DispenseRecord,
  status: DispenseStatus,
  pharmacist: Practitioner,
  note?: string,
): EnrichedRecord {
  const at = nowIso();
  const updated = store.update<DispenseRecord>(DISPENSE_COLLECTION, record.id, {
    status,
    pharmacist: ref('Practitioner', pharmacist.id),
    note: note ?? record.note,
    updatedAt: at,
    history: [
      ...(record.history ?? []),
      { status, at, by: ref('Practitioner', pharmacist.id), note },
    ],
  });
  return enrich(store, updated);
}

function sortKey(e: EnrichedRecord): number {
  const priorityWeight = e.record.priority === 'stat' ? 3 : e.record.priority === 'urgent' ? 2 : 1;
  const allergyWeight = e.allergyConflicts.length > 0 ? 1000 : 0;
  return allergyWeight + priorityWeight * 100 + e.waitingMinutes;
}

function patientDisplay(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}
