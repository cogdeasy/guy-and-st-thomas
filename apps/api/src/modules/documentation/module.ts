import { z } from 'zod';
import type { Encounter, Patient, Practitioner } from '@trustos/ontology';
import { BadRequest, isoHoursFromNow, parseRef, pick, ref } from '@trustos/core';
import type { DataStore } from '../../store/store';
import { defineModule } from '../types';
import {
  NOTE_TYPES,
  type ClinicalNote,
  type ClinicalNoteType,
  composeNoteBody,
  practitionerName,
  patientName,
} from './notes';

/**
 * Clinical Documentation & Notes.
 *
 * Ward-round and admission documentation captured against a patient and their
 * active encounter. Builds workflow endpoints on top of a custom `ClinicalNote`
 * collection: a chronological per-patient timeline, a compose-note action, and
 * a trust-wide recent-notes feed for the documentation dashboard.
 */
export default defineModule({
  id: 'documentation',
  name: 'Clinical Documentation & Notes',
  description: 'Ward-round and admission notes: patient timelines and a trust-wide recent-notes feed.',

  collections: [{ name: 'ClinicalNote' }],

  routes(app, { store }) {
    /** Chronological note timeline for a single patient (oldest → newest). */
    app.get<{ Params: { patientId: string } }>('/:patientId/notes', async (req) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
      const patientRef = ref('Patient', patient.id);
      const notes = store
        .query<ClinicalNote>('ClinicalNote', (n) => n.patient === patientRef)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((n) => decorateNote(store, n));

      return {
        patient,
        patientName: patientName(patient),
        total: notes.length,
        notes,
      };
    });

    /** Latest notes across the whole trust for the documentation dashboard. */
    app.get<{ Querystring: { limit?: string; type?: string } }>('/recent', async (req) => {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 25) || 25, 1), 100);
      const type = req.query.type;
      const notes = store
        .query<ClinicalNote>('ClinicalNote', (n) => (type ? n.type === type : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((n) => decorateNote(store, n));

      const counts = Object.fromEntries(
        NOTE_TYPES.map((t) => [t, store.query<ClinicalNote>('ClinicalNote', (n) => n.type === t).length]),
      ) as Record<ClinicalNoteType, number>;

      return { total: store.count('ClinicalNote'), counts, notes };
    });

    /** Add a new clinical note against a patient (and optionally an encounter). */
    const CreateNoteBody = z.object({
      patientId: z.string().min(1),
      authorId: z.string().min(1),
      encounterId: z.string().optional(),
      type: z.enum(NOTE_TYPES),
      body: z.string().min(1, 'Note body is required').max(10000),
    });
    app.post<{ Body: unknown }>('/notes', async (req, reply) => {
      const input = CreateNoteBody.parse(req.body);

      const patient = store.getOrThrow<Patient>('Patient', input.patientId);
      const author = store.getOrThrow<Practitioner>('Practitioner', input.authorId);

      let encounterRef: string | undefined;
      if (input.encounterId) {
        const encounter = store.getOrThrow<Encounter>('Encounter', input.encounterId);
        if (encounter.subject?.reference !== ref('Patient', patient.id)) {
          throw BadRequest('Encounter does not belong to the specified patient');
        }
        encounterRef = ref('Encounter', encounter.id);
      }

      const note = store.create<ClinicalNote>('ClinicalNote', {
        patient: ref('Patient', patient.id),
        encounter: encounterRef,
        author: ref('Practitioner', author.id),
        type: input.type,
        body: input.body.trim(),
        createdAt: new Date().toISOString(),
      });

      reply.code(201);
      return decorateNote(store, note);
    });
  },

  seed({ store, rng }) {
    const practitioners = store.list<Practitioner>('Practitioner');
    if (practitioners.length === 0) return;

    // Document every admitted patient: an admission note plus 1–3 progress notes.
    const admissions = store.query<Encounter>(
      'Encounter',
      (e) => e.class === 'inpatient' && e.status === 'in-progress',
    );

    for (const encounter of admissions) {
      const patientId = parseRef(encounter.subject.reference)?.id;
      if (!patientId) continue;
      const patient = store.get<Patient>('Patient', patientId);
      if (!patient) continue;

      const patientRef = ref('Patient', patient.id);
      const encounterRef = ref('Encounter', encounter.id);
      const admittingId = parseRef(encounter.participant?.[0]?.reference ?? '')?.id;
      const admitting =
        (admittingId && store.get<Practitioner>('Practitioner', admittingId)) ||
        pick(practitioners, rng);

      const admittedAt = encounter.period?.start ?? new Date().toISOString();
      const reason = encounter.reasonText ?? 'Acute medical presentation';

      // Admission clerking note authored by the admitting clinician.
      putNote(store, {
        patient: patientRef,
        encounter: encounterRef,
        author: ref('Practitioner', admitting.id),
        type: 'admission',
        body: composeNoteBody('admission', { patient, reason, specialty: encounter.specialty, rng }),
        createdAt: admittedAt,
      });

      // 1–3 progress / ward-round notes over the admission.
      const progressCount = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < progressCount; i++) {
        const author = pick(practitioners, rng);
        const noteType: ClinicalNoteType = rng() < 0.5 ? 'ward-round' : 'progress';
        putNote(store, {
          patient: patientRef,
          encounter: encounterRef,
          author: ref('Practitioner', author.id),
          type: noteType,
          body: composeNoteBody(noteType, { patient, reason, specialty: encounter.specialty, rng }),
          createdAt: isoHoursFromNow(12 * (i + 1), new Date(admittedAt)),
        });
      }
    }
  },
});

/** Resolve the patient and author references into display fields for the UI. */
function decorateNote(
  store: DataStore,
  note: ClinicalNote,
): ClinicalNote & { authorName: string; authorRole?: string; patientName: string } {
  const authorId = parseRef(note.author)?.id;
  const author = authorId ? store.get<Practitioner>('Practitioner', authorId) : undefined;
  const patientId = parseRef(note.patient)?.id;
  const patient = patientId ? store.get<Patient>('Patient', patientId) : undefined;
  return {
    ...note,
    authorName: author ? practitionerName(author) : 'Unknown clinician',
    authorRole: author?.role,
    patientName: patient ? patientName(patient) : 'Unknown patient',
  };
}

function putNote(store: DataStore, input: Omit<ClinicalNote, 'id'>): ClinicalNote {
  return store.create<ClinicalNote>('ClinicalNote', { ...input });
}
