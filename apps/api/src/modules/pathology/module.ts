import { z } from 'zod';
import type { Encounter, Patient, Practitioner } from '@trustos/ontology';
import { BadRequest, isoHoursFromNow, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';

/**
 * Pathology / Laboratory — specimen tracking and the lab worklist.
 *
 * Complements the order-comms ('orders') and results modules by modelling the
 * physical journey of a specimen through the lab: collected → in-lab →
 * analysing → resulted (or rejected). It owns a custom `Specimen` collection
 * (not part of the core FHIR ontology) and exposes workflow endpoints — a
 * status-banded worklist, specimen collection, validated state transitions and
 * turnaround-time metrics — rather than plain CRUD (which already exists at
 * `/api/fhir/:type`).
 */

const SPECIMEN = 'Specimen';

const SpecimenType = z.enum(['blood', 'urine', 'csf', 'swab']);
const SpecimenPriority = z.enum(['routine', 'urgent', 'stat']);
const SpecimenStatus = z.enum(['collected', 'in-lab', 'analysing', 'resulted', 'rejected']);
type SpecimenStatusValue = z.infer<typeof SpecimenStatus>;

const ReferenceSchema = z.object({
  reference: z.string(),
  display: z.string().optional(),
});

const StatusEventSchema = z.object({
  status: SpecimenStatus,
  at: z.string(),
  note: z.string().optional(),
});

/** Validator for the custom Specimen collection (free-form core types stay untouched). */
const SpecimenSchema = z
  .object({
    id: z.string(),
    resourceType: z.literal('Specimen').optional(),
    subject: ReferenceSchema,
    encounter: ReferenceSchema.optional(),
    collectedBy: ReferenceSchema.optional(),
    type: SpecimenType,
    test: z.string().min(1),
    priority: SpecimenPriority.default('routine'),
    status: SpecimenStatus.default('collected'),
    accession: z.string().min(1),
    collectedAt: z.string(),
    receivedAt: z.string().optional(),
    resultedAt: z.string().optional(),
    rejectionReason: z.string().optional(),
    statusHistory: z.array(StatusEventSchema).default([]),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

type Specimen = z.infer<typeof SpecimenSchema>;

/** Lab tests offered per specimen type (display + LOINC-style turnaround SLA in hours). */
const TEST_CATALOGUE: Record<z.infer<typeof SpecimenType>, Array<{ test: string; slaHours: number }>> = {
  blood: [
    { test: 'Full Blood Count', slaHours: 4 },
    { test: 'Urea & Electrolytes', slaHours: 4 },
    { test: 'Liver Function Tests', slaHours: 6 },
    { test: 'C-Reactive Protein', slaHours: 4 },
    { test: 'Coagulation Screen', slaHours: 4 },
    { test: 'Blood Culture', slaHours: 36 },
    { test: 'Troponin', slaHours: 2 },
  ],
  urine: [
    { test: 'Urine Culture & Sensitivity', slaHours: 24 },
    { test: 'Urinalysis', slaHours: 2 },
  ],
  csf: [
    { test: 'CSF Microscopy & Culture', slaHours: 12 },
    { test: 'CSF Protein & Glucose', slaHours: 6 },
  ],
  swab: [
    { test: 'Wound Swab M,C&S', slaHours: 48 },
    { test: 'MRSA Screen', slaHours: 24 },
    { test: 'Respiratory Viral PCR', slaHours: 12 },
  ],
};

/** Permitted forward transitions of the lab pipeline. */
const TRANSITIONS: Record<SpecimenStatusValue, SpecimenStatusValue[]> = {
  collected: ['in-lab', 'rejected'],
  'in-lab': ['analysing', 'rejected'],
  analysing: ['resulted', 'rejected'],
  resulted: [],
  rejected: [],
};

const PIPELINE: SpecimenStatusValue[] = ['collected', 'in-lab', 'analysing', 'resulted'];

export default defineModule({
  id: 'pathology',
  name: 'Pathology / Laboratory',
  description: 'Laboratory specimen tracking, lab worklist and turnaround-time metrics.',

  collections: [{ name: SPECIMEN, validator: (input) => SpecimenSchema.parse(input) }],

  routes(app, { store }) {
    // Status-banded lab worklist. Optional ?status= and ?type= filters; otherwise
    // returns every active specimen grouped into the pipeline lanes.
    app.get<{ Querystring: { status?: string; type?: string } }>('/worklist', async (req) => {
      const statusFilter = req.query.status?.trim();
      const typeFilter = req.query.type?.trim();
      let specimens = store
        .list<Specimen>(SPECIMEN)
        .sort((a, b) => priorityRank(b) - priorityRank(a) || a.collectedAt.localeCompare(b.collectedAt));
      if (statusFilter) specimens = specimens.filter((s) => s.status === statusFilter);
      if (typeFilter) specimens = specimens.filter((s) => s.type === typeFilter);

      const items = specimens.map((s) => decorate(s));
      const lanes = PIPELINE.map((status) => ({
        status,
        count: items.filter((i) => i.status === status).length,
        items: items.filter((i) => i.status === status),
      }));

      return { total: items.length, lanes, items };
    });

    // Single specimen with patient context and SLA state.
    app.get<{ Params: { id: string } }>('/:id', async (req) => {
      const specimen = store.getOrThrow<Specimen>(SPECIMEN, req.params.id);
      return decorate(specimen);
    });

    // Register (collect) a new specimen. Validates the patient exists and that
    // the requested test is valid for the specimen type.
    const CollectBody = z.object({
      patientId: z.string().min(1),
      type: SpecimenType,
      test: z.string().min(1),
      priority: SpecimenPriority.default('routine'),
    });
    app.post<{ Body: unknown }>('/collect', async (req, reply) => {
      const body = CollectBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      if (!TEST_CATALOGUE[body.type].some((t) => t.test === body.test)) {
        throw BadRequest(`Test "${body.test}" is not valid for a ${body.type} specimen`);
      }
      const encounter = store
        .query<Encounter>(
          'Encounter',
          (e) => e.subject?.reference === ref('Patient', patient.id) && e.status === 'in-progress',
        )
        .at(0);

      const collectedAt = nowIso();
      const created = store.create<Specimen>(SPECIMEN, {
        subject: { reference: ref('Patient', patient.id), display: patientName(patient) },
        encounter: encounter ? { reference: ref('Encounter', encounter.id) } : undefined,
        type: body.type,
        test: body.test,
        priority: body.priority,
        status: 'collected',
        accession: nextAccession(store),
        collectedAt,
        statusHistory: [{ status: 'collected', at: collectedAt }],
      });
      reply.code(201);
      return decorate(created);
    });

    // Advance (or reject) a specimen through the lab pipeline.
    const StatusBody = z.object({
      status: SpecimenStatus,
      note: z.string().optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/status', async (req) => {
      const specimen = store.getOrThrow<Specimen>(SPECIMEN, req.params.id);
      const body = StatusBody.parse(req.body);
      const allowed = TRANSITIONS[specimen.status];
      if (!allowed.includes(body.status)) {
        throw BadRequest(
          `Cannot move specimen from "${specimen.status}" to "${body.status}"` +
            (allowed.length ? ` (allowed: ${allowed.join(', ')})` : ' (specimen is in a terminal state)'),
        );
      }
      if (body.status === 'rejected' && !body.note) {
        throw BadRequest('A rejection reason (note) is required when rejecting a specimen');
      }

      const at = nowIso();
      const patch: Record<string, unknown> = {
        status: body.status,
        statusHistory: [...specimen.statusHistory, { status: body.status, at, note: body.note }],
      };
      if (body.status === 'in-lab') patch.receivedAt = at;
      if (body.status === 'resulted') patch.resultedAt = at;
      if (body.status === 'rejected') patch.rejectionReason = body.note;

      const updated = store.update<Specimen>(SPECIMEN, specimen.id, patch);
      return decorate(updated);
    });

    // Operational metrics: pending counts, turnaround times and rejection rate.
    app.get('/metrics', async () => {
      const specimens = store.list<Specimen>(SPECIMEN);
      const byStatus = Object.fromEntries(SpecimenStatus.options.map((s) => [s, 0])) as Record<
        SpecimenStatusValue,
        number
      >;
      const byType = Object.fromEntries(SpecimenType.options.map((t) => [t, 0])) as Record<
        z.infer<typeof SpecimenType>,
        number
      >;
      for (const s of specimens) {
        byStatus[s.status] += 1;
        byType[s.type] += 1;
      }

      const active = (['collected', 'in-lab', 'analysing'] as SpecimenStatusValue[]).reduce(
        (sum, s) => sum + byStatus[s],
        0,
      );
      const urgentPending = specimens.filter(
        (s) => s.priority !== 'routine' && s.status !== 'resulted' && s.status !== 'rejected',
      ).length;

      const turnaroundHours = specimens
        .filter((s) => s.status === 'resulted' && s.resultedAt)
        .map((s) => hoursBetween(s.collectedAt, s.resultedAt as string));
      const slaBreaches = specimens.filter(isSlaBreached).length;

      return {
        total: specimens.length,
        active,
        urgentPending,
        byStatus,
        byType,
        rejected: byStatus.rejected,
        rejectionRate: specimens.length ? round(byStatus.rejected / specimens.length, 3) : 0,
        turnaround: {
          resultedCount: turnaroundHours.length,
          averageHours: round(mean(turnaroundHours), 1),
          medianHours: round(median(turnaroundHours), 1),
        },
        slaBreaches,
      };
    });
  },

  seed({ store, rng }) {
    // Attach ~18 specimens, across all pipeline states, to admitted patients.
    const admissions = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );
    if (admissions.length === 0) return;

    const practitioners = store.list<Practitioner>('Practitioner');
    const statusPlan: SpecimenStatusValue[] = [
      'collected',
      'collected',
      'collected',
      'in-lab',
      'in-lab',
      'in-lab',
      'in-lab',
      'analysing',
      'analysing',
      'analysing',
      'resulted',
      'resulted',
      'resulted',
      'resulted',
      'resulted',
      'resulted',
      'rejected',
      'rejected',
    ];

    let accession = 1000;
    for (const status of statusPlan) {
      const encounter = pick(admissions, rng);
      const patientId = encounter.subject.reference.split('/')[1] ?? '';
      const patient = store.get<Patient>('Patient', patientId);
      if (!patient) continue;

      const type = pick(SpecimenType.options, rng);
      const catalogueEntry = pick(TEST_CATALOGUE[type], rng);
      const priority = pick(SpecimenPriority.options, rng);
      const collector = practitioners.length ? pick(practitioners, rng) : undefined;

      // Older specimens are further along the pipeline; keep times deterministic.
      const collectedHoursAgo = randInt(1, 60, rng);
      const collectedAt = isoHoursFromNow(-collectedHoursAgo);
      const history: Array<{ status: SpecimenStatusValue; at: string; note?: string }> = [
        { status: 'collected', at: collectedAt },
      ];

      let receivedAt: string | undefined;
      let resultedAt: string | undefined;
      let rejectionReason: string | undefined;

      const reached = (s: SpecimenStatusValue) => PIPELINE.indexOf(status) >= PIPELINE.indexOf(s);
      if (reached('in-lab') || status === 'rejected') {
        receivedAt = isoHoursFromNow(-(collectedHoursAgo - 1));
        history.push({ status: 'in-lab', at: receivedAt });
      }
      if (reached('analysing')) {
        history.push({ status: 'analysing', at: isoHoursFromNow(-Math.max(collectedHoursAgo - 2, 0)) });
      }
      if (status === 'resulted') {
        resultedAt = isoHoursFromNow(-Math.max(collectedHoursAgo - catalogueEntry.slaHours, 0));
        history.push({ status: 'resulted', at: resultedAt });
      }
      if (status === 'rejected') {
        rejectionReason = pick(
          ['Haemolysed sample', 'Insufficient volume', 'Unlabelled specimen', 'Clotted sample'],
          rng,
        );
        history.push({ status: 'rejected', at: isoHoursFromNow(-(collectedHoursAgo - 1)), note: rejectionReason });
      }

      store.create<Specimen>(SPECIMEN, {
        subject: { reference: ref('Patient', patient.id), display: patientName(patient) },
        encounter: { reference: ref('Encounter', encounter.id) },
        collectedBy: collector ? { reference: ref('Practitioner', collector.id) } : undefined,
        type,
        test: catalogueEntry.test,
        priority,
        status,
        accession: `GSTT-LAB-${accession++}`,
        collectedAt,
        receivedAt,
        resultedAt,
        rejectionReason,
        statusHistory: history,
      });
    }
  },
});

interface DecoratedSpecimen extends Specimen {
  patientName: string;
  turnaroundHours: number | null;
  ageHours: number;
  slaHours: number;
  slaBreached: boolean;
}

/** Attach derived, read-only fields used by the worklist and detail views. */
function decorate(s: Specimen): DecoratedSpecimen {
  const slaHours = TEST_CATALOGUE[s.type].find((t) => t.test === s.test)?.slaHours ?? 24;
  const turnaroundHours = s.resultedAt ? hoursBetween(s.collectedAt, s.resultedAt) : null;
  return {
    ...s,
    patientName: s.subject.display ?? 'Unknown patient',
    turnaroundHours: turnaroundHours === null ? null : round(turnaroundHours, 1),
    ageHours: round(hoursBetween(s.collectedAt, nowIso()), 1),
    slaHours,
    slaBreached: isSlaBreached(s),
  };
}

function isSlaBreached(s: Specimen): boolean {
  if (s.status === 'resulted' || s.status === 'rejected') return false;
  const slaHours = TEST_CATALOGUE[s.type].find((t) => t.test === s.test)?.slaHours ?? 24;
  return hoursBetween(s.collectedAt, nowIso()) > slaHours;
}

function priorityRank(s: Specimen): number {
  return s.priority === 'stat' ? 2 : s.priority === 'urgent' ? 1 : 0;
}

function patientName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
}

function nextAccession(store: { list: (name: string) => unknown[] }): string {
  return `GSTT-LAB-${2000 + store.list(SPECIMEN).length}`;
}

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  const lo = sorted[mid - 1] ?? hi;
  return sorted.length % 2 ? hi : (lo + hi) / 2;
}

function round(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}
