import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface RecentNote {
  id: string;
  patient: string;
  author: string;
  type: string;
  body: string;
  createdAt: string;
  authorName: string;
  patientName: string;
}

describe('documentation module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the documentation module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('documentation');
  });

  it('seeds clinical notes and exposes a recent-notes feed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documentation/recent' });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.total).toBeGreaterThan(0);
    expect(json.notes.length).toBeGreaterThan(0);
    // Decorated with display fields and ordered newest-first.
    const notes: RecentNote[] = json.notes;
    expect(notes[0]!.authorName).toBeTruthy();
    expect(notes[0]!.patientName).toBeTruthy();
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i - 1]!.createdAt >= notes[i]!.createdAt).toBe(true);
    }
    // Every admitted patient gets an admission note.
    expect(json.counts.admission).toBeGreaterThan(0);
  });

  it('filters the recent feed by note type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documentation/recent?type=admission' });
    expect(res.statusCode).toBe(200);
    const notes: RecentNote[] = res.json().notes;
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => n.type === 'admission')).toBe(true);
  });

  it('returns a chronological per-patient timeline', async () => {
    const recent = await app.inject({ method: 'GET', url: '/api/documentation/recent' });
    const patientRef: string = recent.json().notes[0].patient;
    const patientId = patientRef.split('/')[1];

    const res = await app.inject({ method: 'GET', url: `/api/documentation/${patientId}/notes` });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.patient.id).toBe(patientId);
    expect(json.notes.length).toBeGreaterThan(0);
    // Oldest-first ordering.
    for (let i = 1; i < json.notes.length; i++) {
      expect(json.notes[i - 1].createdAt <= json.notes[i].createdAt).toBe(true);
    }
    // The earliest note for an admitted patient is the admission clerking.
    expect(json.notes[0].type).toBe('admission');
  });

  it('adds a note via POST and reflects it in the timeline', async () => {
    const patient = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId: string = patient.json().entry[0].id;
    const practitioner = await app.inject({ method: 'GET', url: '/api/fhir/Practitioner' });
    const authorId: string = practitioner.json().entry[0].id;

    const before = await app.inject({ method: 'GET', url: `/api/documentation/${patientId}/notes` });
    const beforeCount = before.json().total;

    const create = await app.inject({
      method: 'POST',
      url: '/api/documentation/notes',
      payload: {
        patientId,
        authorId,
        type: 'progress',
        body: 'Reviewed on the post-take ward round. Plan unchanged.',
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().type).toBe('progress');
    expect(create.json().authorName).toBeTruthy();

    const after = await app.inject({ method: 'GET', url: `/api/documentation/${patientId}/notes` });
    expect(after.json().total).toBe(beforeCount + 1);
  });

  it('rejects an unknown patient with 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documentation/does-not-exist/notes' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid note body with 400', async () => {
    const practitioner = await app.inject({ method: 'GET', url: '/api/fhir/Practitioner' });
    const authorId: string = practitioner.json().entry[0].id;
    const patient = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId: string = patient.json().entry[0].id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/documentation/notes',
      payload: { patientId, authorId, type: 'progress', body: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a note for a non-existent author with 404', async () => {
    const patient = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId: string = patient.json().entry[0].id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/documentation/notes',
      payload: { patientId, authorId: 'nope', type: 'admission', body: 'Test note body.' },
    });
    expect(res.statusCode).toBe(404);
  });
});
