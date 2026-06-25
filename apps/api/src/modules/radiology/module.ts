import { z } from 'zod';
import type { Encounter, Patient, Practitioner } from '@trustos/ontology';
import { BadRequest, isoDaysAgo, isoHoursFromNow, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore } from '../../store/store';
import {
  type ImagingModality,
  type ImagingRequest,
  ImagingRequestValidator,
  MODALITIES,
  PRIORITIES,
  STATUSES,
} from './types';

/**
 * Imaging / Radiology — requests and reporting worklist.
 *
 * Owns a custom `ImagingRequest` collection (not in the core ontology) and
 * exposes workflow endpoints over it: a filterable worklist, request creation,
 * scheduling, reporting state transitions and an operational metrics summary.
 * Generic CRUD is intentionally avoided — that already exists at /api/fhir/:type.
 */
export default defineModule({
  id: 'radiology',
  name: 'Imaging / Radiology',
  description: 'Radiology requests and reporting worklist across modalities (XR, CT, MRI, US).',

  collections: [{ name: 'ImagingRequest', validator: ImagingRequestValidator }],

  routes(app, { store }) {
    // Filterable worklist — optionally by status and/or modality.
    app.get<{ Querystring: { status?: string; modality?: string } }>('/worklist', async (req) => {
      const status = req.query.status?.trim();
      const modality = req.query.modality?.trim();
      if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
        throw BadRequest(`Unknown status '${status}'`);
      }
      if (modality && !MODALITIES.includes(modality as ImagingModality)) {
        throw BadRequest(`Unknown modality '${modality}'`);
      }

      const items = store
        .list<ImagingRequest>('ImagingRequest')
        .filter((r) => (!status || r.status === status) && (!modality || r.modality === modality))
        .sort((a, b) => priorityRank(b) - priorityRank(a) || a.requestedAt.localeCompare(b.requestedAt))
        .map((r) => enrich(store, r));

      return { total: items.length, items };
    });

    // Single request with the linked patient resolved.
    app.get<{ Params: { id: string } }>('/:id', async (req) => {
      const request = store.getOrThrow<ImagingRequest>('ImagingRequest', req.params.id);
      return enrich(store, request);
    });

    // Raise a new imaging request (status -> requested).
    const RequestBody = z.object({
      patientId: z.string().min(1),
      modality: z.enum(MODALITIES),
      bodyPart: z.string().min(1),
      clinicalIndication: z.string().min(1),
      priority: z.enum(PRIORITIES).default('routine'),
      requestedById: z.string().optional(),
      encounterId: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/request', async (req, reply) => {
      const body = RequestBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      const requestedBy = body.requestedById
        ? store.getOrThrow<Practitioner>('Practitioner', body.requestedById)
        : undefined;

      const created = store.create<ImagingRequest>('ImagingRequest', {
        patient: { reference: ref('Patient', patient.id), display: displayName(patient) },
        modality: body.modality,
        bodyPart: body.bodyPart,
        clinicalIndication: body.clinicalIndication,
        priority: body.priority,
        status: 'requested',
        requestedAt: nowIso(),
        ...(requestedBy
          ? { requestedBy: { reference: ref('Practitioner', requestedBy.id), display: displayName(requestedBy) } }
          : {}),
        ...(body.encounterId ? { encounter: { reference: ref('Encounter', body.encounterId) } } : {}),
      });
      reply.code(201);
      return enrich(store, created);
    });

    // Schedule an acquisition slot (requested -> scheduled).
    const ScheduleBody = z.object({ scheduledFor: z.string().min(1) });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/schedule', async (req) => {
      const body = ScheduleBody.parse(req.body);
      const request = store.getOrThrow<ImagingRequest>('ImagingRequest', req.params.id);
      if (request.status !== 'requested') {
        throw BadRequest(`Cannot schedule a request in status '${request.status}'`);
      }
      const updated = store.update<ImagingRequest>('ImagingRequest', request.id, {
        status: 'scheduled',
        scheduledFor: body.scheduledFor,
      });
      return enrich(store, updated);
    });

    // Attach a report and finalise (scheduled|acquired -> reported).
    const ReportBody = z.object({
      reportedById: z.string().optional(),
      findings: z.string().min(1),
      impression: z.string().min(1),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/report', async (req) => {
      const body = ReportBody.parse(req.body);
      const request = store.getOrThrow<ImagingRequest>('ImagingRequest', req.params.id);
      if (request.status === 'requested') {
        throw BadRequest('Cannot report a request that has not been acquired yet');
      }
      if (request.status === 'reported') {
        throw BadRequest('Request has already been reported');
      }
      const radiologist = body.reportedById
        ? store.getOrThrow<Practitioner>('Practitioner', body.reportedById)
        : undefined;
      const reportedAt = nowIso();
      const updated = store.update<ImagingRequest>('ImagingRequest', request.id, {
        status: 'reported',
        acquiredAt: request.acquiredAt ?? reportedAt,
        reportedAt,
        report: {
          findings: body.findings,
          impression: body.impression,
          reportedAt,
          ...(radiologist
            ? { radiologist: { reference: ref('Practitioner', radiologist.id), display: displayName(radiologist) } }
            : {}),
        },
      });
      return enrich(store, updated);
    });

    // Operational metrics for the radiology command centre.
    app.get('/metrics', async () => {
      const all = store.list<ImagingRequest>('ImagingRequest');
      const byStatus = countBy(all, (r) => r.status);
      const byModality = countBy(all, (r) => r.modality);
      const reported = all.filter((r) => r.status === 'reported');
      const turnaroundHours = reported
        .map((r) => hoursBetween(r.requestedAt, r.reportedAt))
        .filter((h): h is number => h !== null);
      const avgTurnaroundHours =
        turnaroundHours.length > 0
          ? Number((turnaroundHours.reduce((a, b) => a + b, 0) / turnaroundHours.length).toFixed(1))
          : null;

      return {
        total: all.length,
        awaitingReport: all.filter((r) => r.status === 'acquired').length,
        urgentOutstanding: all.filter((r) => r.priority !== 'routine' && r.status !== 'reported').length,
        avgTurnaroundHours,
        byStatus: STATUSES.map((status) => ({ status, count: byStatus[status] ?? 0 })),
        byModality: MODALITIES.map((modality) => ({ modality, count: byModality[modality] ?? 0 })),
      };
    });
  },

  seed({ store, rng }) {
    const admitted = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );
    if (admitted.length === 0) return;
    const radiologists = store.query<Practitioner>('Practitioner', (p) => p.specialty === 'Radiology');
    const anyPractitioners = store.list<Practitioner>('Practitioner');

    const studies: Record<ImagingModality, string[]> = {
      XR: ['Chest', 'Abdomen', 'Pelvis', 'Left wrist', 'Right ankle'],
      CT: ['Head', 'Chest', 'Abdomen & pelvis', 'CT pulmonary angiogram', 'Cervical spine'],
      MRI: ['Brain', 'Lumbar spine', 'Left knee', 'Liver', 'Pituitary'],
      US: ['Abdomen', 'Renal tract', 'Pelvis', 'Doppler legs', 'Thyroid'],
    };
    const indications = [
      'Suspected lower respiratory tract infection',
      'Rule out pulmonary embolism',
      'Acute abdominal pain, ?obstruction',
      'Post-fall, query fracture',
      'New focal neurology',
      'Deranged LFTs for investigation',
      'Persistent headache, red flags',
      'Sepsis source identification',
    ];

    for (let i = 0; i < 15; i++) {
      const enc = pick(admitted, rng);
      const patientId = enc.subject.reference.split('/')[1] ?? '';
      const patient = store.get<Patient>('Patient', patientId);
      if (!patient) continue;

      const modality = pick(MODALITIES, rng);
      const bodyPart = pick(studies[modality], rng);
      const priority = pick(PRIORITIES, rng);
      const requester = pick(anyPractitioners, rng);
      const requestedAt = isoDaysAgo(randInt(0, 6, rng));
      const status = pick(STATUSES, rng);

      const base: Record<string, unknown> = {
        patient: { reference: ref('Patient', patient.id), display: displayName(patient) },
        encounter: { reference: ref('Encounter', enc.id) },
        modality,
        bodyPart,
        clinicalIndication: pick(indications, rng),
        priority,
        status,
        requestedAt,
        ...(requester
          ? { requestedBy: { reference: ref('Practitioner', requester.id), display: displayName(requester) } }
          : {}),
      };

      if (status === 'scheduled' || status === 'acquired' || status === 'reported') {
        base.scheduledFor = isoHoursFromNow(randInt(-48, 24, rng), new Date(requestedAt));
      }
      if (status === 'acquired' || status === 'reported') {
        base.acquiredAt = isoHoursFromNow(randInt(1, 24, rng), new Date(requestedAt));
      }
      if (status === 'reported') {
        const radiologist = radiologists.length > 0 ? pick(radiologists, rng) : requester;
        const reportedAt = isoHoursFromNow(randInt(1, 12, rng), new Date(base.acquiredAt as string));
        base.reportedAt = reportedAt;
        base.report = {
          findings: reportFindings(modality, bodyPart, rng),
          impression: pick(
            ['No acute abnormality.', 'Findings consistent with the clinical query.', 'Recommend correlation and follow-up imaging.'],
            rng,
          ),
          reportedAt,
          ...(radiologist
            ? { radiologist: { reference: ref('Practitioner', radiologist.id), display: displayName(radiologist) } }
            : {}),
        };
      }

      store.create<ImagingRequest>('ImagingRequest', base);
    }
  },
});

function priorityRank(r: ImagingRequest): number {
  return PRIORITIES.indexOf(r.priority);
}

function enrich(store: DataStore, request: ImagingRequest) {
  const patientId = request.patient.reference.split('/')[1] ?? '';
  const patient = store.get<Patient>('Patient', patientId) ?? null;
  return { ...request, patientSummary: patient ? patientCard(patient) : null };
}

function patientCard(patient: Patient) {
  return {
    id: patient.id,
    name: displayName(patient),
    gender: patient.gender,
    birthDate: patient.birthDate,
    nhsNumber: patient.identifier?.find((i) => i.system?.includes('nhs-number'))?.value,
  };
}

function displayName(person: Patient | Practitioner): string {
  const name = person.name?.[0];
  const prefix = name?.prefix?.join(' ');
  const full = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
  return prefix ? `${prefix} ${full}`.trim() : full || 'Unknown';
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = key(item);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

function hoursBetween(from: string, to?: string): number | null {
  if (!to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (Number.isNaN(ms)) return null;
  return ms / 3_600_000;
}

function reportFindings(modality: ImagingModality, bodyPart: string, rng: () => number): string {
  const templates = [
    `${modality} ${bodyPart}: no acute intracranial or focal abnormality identified.`,
    `${modality} ${bodyPart}: appearances within normal limits for age.`,
    `${modality} ${bodyPart}: minor changes noted, clinically correlate.`,
  ];
  return pick(templates, rng);
}
