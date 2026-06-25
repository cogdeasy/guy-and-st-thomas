import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('waitinglist module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('waitinglist');
  });

  it('returns a seeded, breach-aware PTL sorted by longest wait', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/waitinglist/ptl' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.total);
    // Sorted descending by weeks waiting.
    const weeks = body.items.map((i: { weeksWaiting: number }) => i.weeksWaiting);
    expect([...weeks].sort((a, b) => b - a)).toEqual(weeks);
    // Computed RTT fields present.
    const first = body.items[0];
    expect(first).toHaveProperty('breached');
    expect(first).toHaveProperty('weeksToTarget');
    expect(first.patient).toMatch(/^Patient\//);
  });

  it('filters the PTL by specialty', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/waitinglist/ptl' });
    const specialty = all.json().items[0].specialty as string;
    const res = await app.inject({
      method: 'GET',
      url: `/api/waitinglist/ptl?specialty=${encodeURIComponent(specialty)}`,
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ specialty: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.specialty === specialty)).toBe(true);
  });

  it('exposes metrics with breaches by specialty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/waitinglist/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalWaiting).toBeGreaterThan(0);
    expect(Array.isArray(body.bySpecialty)).toBe(true);
    expect(body.longestWaiters.length).toBeGreaterThan(0);
    expect(body.longestWaitWeeks).toBeGreaterThanOrEqual(0);
  });

  it('adds a patient to the list and schedules a TCI', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id as string;

    const added = await app.inject({
      method: 'POST',
      url: '/api/waitinglist/add',
      payload: {
        patientId,
        specialty: 'Orthopaedics',
        procedure: 'Total knee replacement',
        priority: 'routine',
      },
    });
    expect(added.statusCode).toBe(201);
    const entry = added.json();
    expect(entry.status).toBe('waiting');
    expect(entry.patient).toBe(`Patient/${patientId}`);
    expect(entry.targetWeeks).toBe(18);

    const tci = await app.inject({
      method: 'POST',
      url: `/api/waitinglist/${entry.id}/tci`,
      payload: { tciDate: new Date().toISOString() },
    });
    expect(tci.statusCode).toBe(200);
    expect(tci.json().status).toBe('tci');
  });

  it('removes an entry from the list', async () => {
    const ptl = await app.inject({ method: 'GET', url: '/api/waitinglist/ptl' });
    const id = ptl.json().items[0].id as string;
    const res = await app.inject({
      method: 'POST',
      url: `/api/waitinglist/${id}/remove`,
      payload: { reason: 'Treated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('removed');
  });

  it('rejects adding an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/waitinglist/add',
      payload: { patientId: 'does-not-exist', specialty: 'Urology', procedure: 'Cystoscopy' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s scheduling a TCI on a missing entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/waitinglist/wl-does-not-exist/tci',
      payload: { tciDate: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(404);
  });
});
