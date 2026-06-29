import { z } from 'zod';
import {
  CodeSystems,
  type AllergyIntolerance,
  type Encounter,
  type MedicationRequest,
  type Patient,
  type Practitioner,
} from '@trustos/ontology';
import { BadRequest, NotFound, isoDaysAgo, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore } from '../../store/store';
import { FORMULARY, FREQUENCIES, ROUTES, findDrug, type FormularyDrug } from './formulary';
import { checkAllergies, type AllergyWarning } from './allergy';

/**
 * E-Prescribing (Inpatient EPMA) — the electronic drug chart.
 *
 * Workflow endpoints on top of the core `MedicationRequest` resource:
 * a composite drug chart grouped by regular/PRN/stat, allergy-checked
 * prescribing, discontinuation with audit, and a ward worklist. A custom
 * `PrescriptionAudit` collection records every prescribe/discontinue action.
 */
const PRESCRIPTION_AUDIT = 'PrescriptionAudit';

const ChartGroup = z.enum(['regular', 'prn', 'stat']);
type ChartGroup = z.infer<typeof ChartGroup>;

const PrescribeBody = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().optional(),
  drugCode: z.string().min(1),
  dose: z.string().min(1, 'Dose is required'),
  route: z.enum(ROUTES),
  frequency: z.enum(FREQUENCIES),
  prn: z.boolean().default(false),
  prnIndication: z.string().optional(),
  courseOfTherapyType: z.enum(['acute', 'continuous', 'stat']).default('acute'),
  priority: z.enum(['routine', 'urgent', 'asap', 'stat']).default('routine'),
  requesterId: z.string().optional(),
  /** Clinician override of a documented allergy contraindication. */
  acknowledgeAllergy: z.boolean().default(false),
});

const DiscontinueBody = z.object({
  reason: z.string().min(1, 'A discontinuation reason is required'),
  actorId: z.string().optional(),
});

const AllergyCheckBody = z.object({
  patientId: z.string().min(1),
  drugCode: z.string().min(1),
});

export default defineModule({
  id: 'eprescribing',
  name: 'E-Prescribing',
  description: 'Inpatient electronic prescribing — the digital drug chart (EPMA).',

  collections: [{ name: PRESCRIPTION_AUDIT }],

  routes(app, { store }) {
    // The inpatient formulary that drives the prescribe form.
    app.get('/formulary', async () => ({
      routes: ROUTES,
      frequencies: FREQUENCIES,
      drugs: FORMULARY,
    }));

    // Composite drug chart for one patient, grouped regular / PRN / stat.
    app.get<{ Params: { patientId: string } }>('/chart/:patientId', async (req) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
      const patientRef = ref('Patient', patient.id);

      const allergies = activeMedicationAllergies(store, patientRef);
      const meds = store
        .query<MedicationRequest>('MedicationRequest', (m) => m.subject?.reference === patientRef)
        .sort((a, b) => (b.authoredOn ?? '').localeCompare(a.authoredOn ?? ''));

      const active = meds.filter((m) => m.status === 'active');
      const groups: Record<ChartGroup, MedicationRequest[]> = {
        regular: active.filter((m) => groupOf(m) === 'regular'),
        prn: active.filter((m) => groupOf(m) === 'prn'),
        stat: active.filter((m) => groupOf(m) === 'stat'),
      };

      return {
        patient,
        nhsNumber: patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
        allergies,
        counts: {
          active: active.length,
          regular: groups.regular.length,
          prn: groups.prn.length,
          stat: groups.stat.length,
          discontinued: meds.length - active.length,
        },
        groups,
        history: meds.filter((m) => m.status !== 'active'),
      };
    });

    // Live allergy decision-support used by the prescribe form.
    app.post<{ Body: unknown }>('/allergy-check', async (req) => {
      const body = AllergyCheckBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      const drug = findDrug(body.drugCode);
      if (!drug) throw BadRequest(`Unknown drug code: ${body.drugCode}`);
      const allergies = activeMedicationAllergies(store, ref('Patient', patient.id));
      const warnings = checkAllergies(drug, allergies);
      return { warnings, blocked: hasContraindication(warnings) };
    });

    // Prescribe a medication. Hard-stops on an un-acknowledged contraindication.
    app.post<{ Body: unknown }>('/prescribe', async (req, reply) => {
      const body = PrescribeBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      const patientRef = ref('Patient', patient.id);

      const drug = findDrug(body.drugCode);
      if (!drug) throw BadRequest(`Unknown drug code: ${body.drugCode}`);

      if (body.encounterId && !store.get<Encounter>('Encounter', body.encounterId)) {
        throw NotFound(`Encounter/${body.encounterId}`);
      }

      const allergies = activeMedicationAllergies(store, patientRef);
      const warnings = checkAllergies(drug, allergies);
      if (hasContraindication(warnings) && !body.acknowledgeAllergy) {
        reply.code(409);
        return {
          status: 409,
          title: 'Prescription blocked by allergy contraindication',
          code: 'allergy_contraindication',
          warnings,
        };
      }

      const requester = body.requesterId
        ? store.get<Practitioner>('Practitioner', body.requesterId)
        : undefined;

      const created = store.create<MedicationRequest>('MedicationRequest', {
        status: 'active',
        intent: 'order',
        priority: body.courseOfTherapyType === 'stat' ? 'stat' : body.priority,
        medication: {
          coding: [{ system: CodeSystems.SNOMED, code: drug.code, display: drug.display }],
          text: drug.display,
        },
        subject: { reference: patientRef, display: patientName(patient) },
        encounter: body.encounterId ? { reference: ref('Encounter', body.encounterId) } : undefined,
        requester: requester
          ? { reference: ref('Practitioner', requester.id), display: practitionerName(requester) }
          : undefined,
        authoredOn: nowIso(),
        courseOfTherapyType: body.courseOfTherapyType,
        dosageInstruction: [
          {
            text: dosageText(drug, body),
            route: body.route,
            doseQuantity: body.dose,
            frequency: body.frequency,
            asNeeded: body.prn,
          },
        ],
      });

      audit(store, {
        action: 'prescribe',
        medicationRequestId: created.id,
        patientId: patient.id,
        drug: drug.display,
        actorId: requester?.id,
        overrodeAllergy: hasContraindication(warnings) && body.acknowledgeAllergy,
        detail: dosageText(drug, body),
      });

      reply.code(201);
      return { medicationRequest: created, allergyWarnings: warnings };
    });

    // Discontinue (stop) an active medication.
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/discontinue', async (req) => {
      const body = DiscontinueBody.parse(req.body);
      const existing = store.getOrThrow<MedicationRequest>('MedicationRequest', req.params.id);
      if (existing.status !== 'active') {
        throw BadRequest(`MedicationRequest/${existing.id} is not active (status: ${existing.status})`);
      }
      const updated = store.update<MedicationRequest>('MedicationRequest', existing.id, {
        status: 'stopped',
      });

      audit(store, {
        action: 'discontinue',
        medicationRequestId: existing.id,
        patientId: existing.subject?.reference?.split('/')[1] ?? '',
        drug: existing.medication?.text ?? 'Unknown',
        actorId: body.actorId,
        detail: body.reason,
      });

      return { medicationRequest: updated, reason: body.reason };
    });

    // Ward worklist: patients with one or more active prescriptions.
    app.get('/worklist', async () => {
      const active = store.query<MedicationRequest>(
        'MedicationRequest',
        (m) => m.status === 'active',
      );
      const byPatient = new Map<string, MedicationRequest[]>();
      for (const m of active) {
        const id = m.subject?.reference?.split('/')[1];
        if (!id) continue;
        const list = byPatient.get(id) ?? [];
        list.push(m);
        byPatient.set(id, list);
      }

      const items = [...byPatient.entries()]
        .map(([patientId, meds]) => {
          const patient = store.get<Patient>('Patient', patientId);
          if (!patient) return null;
          const allergies = activeMedicationAllergies(store, ref('Patient', patientId));
          return {
            patient,
            nhsNumber: patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
            counts: {
              active: meds.length,
              regular: meds.filter((m) => groupOf(m) === 'regular').length,
              prn: meds.filter((m) => groupOf(m) === 'prn').length,
              stat: meds.filter((m) => groupOf(m) === 'stat').length,
            },
            allergyCount: allergies.length,
            lastUpdated: meds
              .map((m) => m.authoredOn ?? '')
              .sort()
              .at(-1),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => patientName(b.patient).localeCompare(patientName(a.patient)) * -1);

      return { total: items.length, items };
    });
  },

  seed({ store, rng }) {
    // Attach prescriptions to admitted patients (active inpatient encounters).
    const encounters = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );
    const prescribers = store
      .list<Practitioner>('Practitioner')
      .filter((p) => p.role !== 'Staff Nurse');

    let prnSeeded = false;

    encounters.forEach((encounter, index) => {
      const patientId = encounter.subject?.reference?.split('/')[1];
      if (!patientId) return;
      const patient = store.get<Patient>('Patient', patientId);
      if (!patient) return;

      const count = randInt(1, 3, rng);
      const chosen = shuffle(FORMULARY, rng).slice(0, count);
      // Guarantee the demo always contains at least one PRN order.
      if (!prnSeeded && !chosen.some((d) => d.prnByDefault)) {
        chosen[0] = FORMULARY[0]!; // Paracetamol
      }

      chosen.forEach((drug, di) => {
        const requester = prescribers.length ? pick(prescribers, rng) : undefined;
        const prn = drug.prnByDefault === true;
        // Give the first patient's first med a stat order for chart variety.
        const stat = index === 0 && di === 0 && !prn;
        if (prn) prnSeeded = true;

        const frequency = stat ? 'STAT' : prn ? 'PRN' : drug.defaultFrequency;
        const courseOfTherapyType = stat
          ? 'stat'
          : drug.drugClass === 'Anticoagulant' || drug.drugClass === 'Diuretic'
            ? 'continuous'
            : 'acute';

        const created = store.create<MedicationRequest>('MedicationRequest', {
          status: 'active',
          intent: 'order',
          priority: stat ? 'stat' : 'routine',
          medication: {
            coding: [{ system: CodeSystems.SNOMED, code: drug.code, display: drug.display }],
            text: drug.display,
          },
          subject: { reference: ref('Patient', patient.id), display: patientName(patient) },
          encounter: { reference: ref('Encounter', encounter.id) },
          requester: requester
            ? { reference: ref('Practitioner', requester.id), display: practitionerName(requester) }
            : undefined,
          authoredOn: isoDaysAgo(randInt(0, 4, rng)),
          courseOfTherapyType,
          dosageInstruction: [
            {
              text: `${drug.display} ${drug.defaultDose} ${drug.routes[0]} ${frequency}${
                prn ? ' as required for pain' : ''
              }`,
              route: drug.routes[0],
              doseQuantity: drug.defaultDose,
              frequency,
              asNeeded: prn,
            },
          ],
        });

        audit(store, {
          action: 'prescribe',
          medicationRequestId: created.id,
          patientId: patient.id,
          drug: drug.display,
          actorId: requester?.id,
          detail: created.dosageInstruction[0]?.text ?? drug.display,
        });
      });
    });
  },
});

interface AuditInput {
  action: 'prescribe' | 'discontinue';
  medicationRequestId: string;
  patientId: string;
  drug: string;
  actorId?: string;
  detail?: string;
  overrodeAllergy?: boolean;
}

function audit(store: DataStore, input: AuditInput): void {
  store.create(PRESCRIPTION_AUDIT, {
    ...input,
    recordedAt: nowIso(),
    patient: ref('Patient', input.patientId),
    medicationRequest: ref('MedicationRequest', input.medicationRequestId),
  });
}

function activeMedicationAllergies(store: DataStore, patientRef: string): AllergyIntolerance[] {
  return store.query<AllergyIntolerance>(
    'AllergyIntolerance',
    (a) => a.patient?.reference === patientRef && a.clinicalStatus === 'active',
  );
}

function groupOf(m: MedicationRequest): ChartGroup {
  if (m.courseOfTherapyType === 'stat') return 'stat';
  if (m.dosageInstruction?.some((d) => d.asNeeded)) return 'prn';
  return 'regular';
}

function hasContraindication(warnings: AllergyWarning[]): boolean {
  return warnings.some((w) => w.severity === 'contraindicated');
}

function dosageText(drug: FormularyDrug, body: z.infer<typeof PrescribeBody>): string {
  const base = `${drug.display} ${body.dose} ${body.route} ${body.frequency}`;
  return body.prn ? `${base} as required${body.prnIndication ? ` for ${body.prnIndication}` : ''}` : base;
}

function patientName(p: Patient): string {
  const n = p.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim();
}

function practitionerName(p: Practitioner): string {
  const n = p.name?.[0];
  return `${n?.prefix?.join(' ') ?? ''} ${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim();
}

function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
