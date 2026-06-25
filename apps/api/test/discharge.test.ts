import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface WorklistResponse {
  total: number;
  readyForDischarge: number;
  byStatus: Record<string, number>;
  items: Array<{
    id: string;
    status: string;
    patient?: { id: string };
    encounter?: { id: string; status: string };
    checklist: { complete: number; total: number; ready: boolean };
  }>;
}

describe('discharge module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the discharge module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('discharge');
  });

  it('returns a seeded worklist with checklist completeness and status counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/discharge/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as WorklistResponse;
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.total);
    const statusSum = Object.values(body.byStatus).reduce((a, b) => a + b, 0);
    expect(statusSum).toBe(body.total);
    for (const item of body.items) {
      expect(item.patient?.id).toBeTruthy();
      expect(item.checklist.total).toBe(4);
      expect(item.checklist.complete).toBeLessThanOrEqual(item.checklist.total);
    }
  });

  it('filters the worklist by status and rejects unknown statuses', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/discharge/worklist?status=draft' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as WorklistResponse).items.every((i) => i.status === 'draft')).toBe(true);

    const bad = await app.inject({ method: 'GET', url: '/api/discharge/worklist?status=nope' });
    expect(bad.statusCode).toBe(400);
  });

  it('returns a composite read for a discharge summary', async () => {
    const list = (
      await app.inject({ method: 'GET', url: '/api/discharge/worklist' })
    ).json() as WorklistResponse;
    const id = list.items[0]!.id;
    const res = await app.inject({ method: 'GET', url: `/api/discharge/${id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.id).toBe(id);
    expect(body.patient.id).toBeTruthy();
    expect(body.checklist.items).toHaveLength(4);
  });

  it('404s for an unknown summary id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/discharge/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('drafts, edits and completes a discharge for an admitted patient', async () => {
    // Find an admitted patient without an open discharge summary.
    const worklist = (
      await app.inject({ method: 'GET', url: '/api/discharge/worklist' })
    ).json() as WorklistResponse;
    const usedEncounterIds = new Set(worklist.items.map((i) => i.encounter?.id));

    const encounters = (
      await app.inject({ method: 'GET', url: '/api/fhir/Encounter?class=inpatient&status=in-progress' })
    ).json().entry as Array<{ id: string; subject: { reference: string } }>;
    const free = encounters.find((e) => !usedEncounterIds.has(e.id));
    expect(free).toBeTruthy();
    const patientId = free!.subject.reference.split('/')[1];

    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/discharge/draft',
      payload: { patientId, encounterId: free!.id },
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = draftRes.json();
    expect(draft.status).toBe('draft');

    // Cannot complete an empty draft.
    const tooEarly = await app.inject({ method: 'POST', url: `/api/discharge/${draft.id}/complete` });
    expect(tooEarly.statusCode).toBe(422);

    // The edit endpoint cannot be used to bypass the completion checklist.
    const sneaky = await app.inject({
      method: 'PUT',
      url: `/api/discharge/${draft.id}`,
      payload: { status: 'completed' },
    });
    expect(sneaky.statusCode).toBe(400);

    // Fill in the required fields.
    const put = await app.inject({
      method: 'PUT',
      url: `/api/discharge/${draft.id}`,
      payload: {
        status: 'pending-pharmacy',
        diagnosis: 'Community-acquired pneumonia, resolving',
        followUp: 'GP review in 1 week',
        gpLetterGenerated: true,
        ttoMeds: [
          { medication: 'Amoxicillin 500mg capsules', dose: '500mg', frequency: 'Three times daily' },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().status).toBe('pending-pharmacy');

    // Now completion succeeds and finishes the encounter.
    const complete = await app.inject({ method: 'POST', url: `/api/discharge/${draft.id}/complete` });
    expect(complete.statusCode).toBe(200);
    const completed = complete.json();
    expect(completed.summary.status).toBe('completed');
    expect(completed.encounter.status).toBe('finished');
    expect(completed.encounter.period.end).toBeTruthy();

    // Completed summaries are immutable.
    const editAfter = await app.inject({
      method: 'PUT',
      url: `/api/discharge/${draft.id}`,
      payload: { diagnosis: 'changed' },
    });
    expect(editAfter.statusCode).toBe(400);
  });

  it('rejects a draft for a patient with no active inpatient encounter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/discharge/draft',
      payload: { patientId: 'not-a-real-patient' },
    });
    expect(res.statusCode).toBe(404);
  });
});
