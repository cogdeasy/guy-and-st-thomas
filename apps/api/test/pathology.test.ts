import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('pathology module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers itself as a discoverable module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('pathology');
  });

  it('returns a status-banded worklist of seeded specimens', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pathology/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(10);
    expect(body.lanes.map((l: { status: string }) => l.status)).toEqual([
      'collected',
      'in-lab',
      'analysing',
      'resulted',
    ]);
    const first = body.items[0];
    expect(first.patientName).toBeTruthy();
    expect(typeof first.ageHours).toBe('number');
  });

  it('filters the worklist by status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pathology/worklist?status=resulted' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((s: { status: string }) => s.status === 'resulted')).toBe(true);
    expect(body.items.every((s: { resultedAt?: string }) => Boolean(s.resultedAt))).toBe(true);
  });

  it('reports turnaround and pending metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pathology/metrics' });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.total).toBeGreaterThan(10);
    expect(m.byStatus).toHaveProperty('resulted');
    expect(m.turnaround.resultedCount).toBeGreaterThan(0);
    expect(m.turnaround.averageHours).toBeGreaterThanOrEqual(0);
    expect(m.rejectionRate).toBeGreaterThanOrEqual(0);
  });

  it('collects a new specimen for an admitted patient and advances it through the pipeline', async () => {
    const worklist = await app.inject({ method: 'GET', url: '/api/pathology/worklist' });
    const patientId = worklist.json().items[0].subject.reference.split('/')[1];

    const collect = await app.inject({
      method: 'POST',
      url: '/api/pathology/collect',
      payload: { patientId, type: 'blood', test: 'Full Blood Count', priority: 'urgent' },
    });
    expect(collect.statusCode).toBe(201);
    const specimen = collect.json();
    expect(specimen.status).toBe('collected');
    expect(specimen.accession).toMatch(/^GSTT-LAB-/);

    const received = await app.inject({
      method: 'POST',
      url: `/api/pathology/${specimen.id}/status`,
      payload: { status: 'in-lab' },
    });
    expect(received.statusCode).toBe(200);
    expect(received.json().status).toBe('in-lab');
    expect(received.json().receivedAt).toBeTruthy();
  });

  it('rejects an invalid state transition', async () => {
    const collect = await app.inject({
      method: 'POST',
      url: '/api/pathology/collect',
      payload: {
        patientId: (await app.inject({ method: 'GET', url: '/api/pathology/worklist' })).json().items[0].subject
          .reference.split('/')[1],
        type: 'urine',
        test: 'Urinalysis',
      },
    });
    const id = collect.json().id;
    const bad = await app.inject({
      method: 'POST',
      url: `/api/pathology/${id}/status`,
      payload: { status: 'resulted' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('requires a reason when rejecting a specimen', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/pathology/worklist?status=collected' });
    const id = list.json().items[0].id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/pathology/${id}/status`,
      payload: { status: 'rejected' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('validates that a test matches the specimen type', async () => {
    const patientId = (await app.inject({ method: 'GET', url: '/api/pathology/worklist' })).json().items[0].subject
      .reference.split('/')[1];
    const res = await app.inject({
      method: 'POST',
      url: '/api/pathology/collect',
      payload: { patientId, type: 'urine', test: 'Full Blood Count' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown specimen', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pathology/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
