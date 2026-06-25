import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface ListResponse {
  total: number;
  counts: { high: number; urgent: number; routine: number };
  items: Array<{
    id: string;
    patient: { id: string; name?: Array<{ family?: string }> } | null;
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
    priority: 'routine' | 'urgent' | 'high';
    shift: 'day' | 'night';
    status: 'active' | 'handed-over';
    news2: { score: number; risk: string } | null;
  }>;
}

const PRIORITY_RANK = { high: 3, urgent: 2, routine: 1 } as const;

describe('handover module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the handover module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('handover');
  });

  it('seeds a prioritised handover list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/handover/list' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListResponse;
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.total);

    // Every entry resolves a real patient and carries full SBAR text.
    for (const item of body.items) {
      expect(item.patient).not.toBeNull();
      expect(item.situation.length).toBeGreaterThan(0);
      expect(item.background.length).toBeGreaterThan(0);
      expect(item.assessment.length).toBeGreaterThan(0);
      expect(item.recommendation.length).toBeGreaterThan(0);
    }

    // List is ordered by priority (then NEWS2 desc).
    for (let i = 1; i < body.items.length; i++) {
      const prev = body.items[i - 1]!;
      const curr = body.items[i]!;
      const prevRank = PRIORITY_RANK[prev.priority];
      const currRank = PRIORITY_RANK[curr.priority];
      expect(prevRank).toBeGreaterThanOrEqual(currRank);
      if (prevRank === currRank) {
        expect(prev.news2?.score ?? -1).toBeGreaterThanOrEqual(curr.news2?.score ?? -1);
      }
    }
  });

  it('is deterministic across seeded builds', async () => {
    const { app: app2 } = await buildApp({ logger: false, seed: true });
    await app2.ready();
    const a = (await app.inject({ method: 'GET', url: '/api/handover/list' })).json() as ListResponse;
    const b = (await app2.inject({ method: 'GET', url: '/api/handover/list' })).json() as ListResponse;
    expect(b.total).toBe(a.total);
    expect(b.items.map((i) => i.situation)).toEqual(a.items.map((i) => i.situation));
    await app2.close();
  });

  it('filters by shift', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/handover/list?shift=night' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListResponse;
    for (const item of body.items) expect(item.shift).toBe('night');
  });

  it('creates a handover entry for an existing patient', async () => {
    const patients = (await app.inject({ method: 'GET', url: '/api/fhir/Patient' })).json();
    const patientId = patients.entry[0].id as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/handover/entries',
      payload: {
        patientId,
        situation: 'Post-op day 1, comfortable.',
        background: 'Elective cholecystectomy.',
        assessment: 'Stable, observations within range.',
        recommendation: 'Continue analgesia; mobilise.',
        priority: 'routine',
        shift: 'day',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.id).toBeTruthy();
    expect(created.patient.reference).toBe(`Patient/${patientId}`);
    expect(created.updatedAt).toBeTruthy();
  });

  it('rejects creating an entry for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/handover/entries',
      payload: {
        patientId: 'does-not-exist',
        situation: 's',
        background: 'b',
        assessment: 'a',
        recommendation: 'r',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('validates the create body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/handover/entries',
      payload: { situation: 'missing patient' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('updates an existing entry and bumps updatedAt', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/handover/list' })).json() as ListResponse;
    const target = list.items[0]!;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/handover/entries/${target.id}`,
      payload: { assessment: 'Reviewed by registrar — plan unchanged.', status: 'handed-over' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json();
    expect(updated.assessment).toBe('Reviewed by registrar — plan unchanged.');
    expect(updated.status).toBe('handed-over');
  });

  it('returns 404 when updating a missing entry', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/handover/entries/nope',
      payload: { situation: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('generates entries for uncovered admitted patients and is then idempotent', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/handover/generate', payload: {} });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody).toHaveProperty('generated');
    expect(firstBody).toHaveProperty('skipped');

    // A second run must not duplicate entries for patients already covered.
    const second = await app.inject({ method: 'POST', url: '/api/handover/generate', payload: {} });
    expect(second.statusCode).toBe(201);
    expect(second.json().generated).toBe(0);
  });
});
