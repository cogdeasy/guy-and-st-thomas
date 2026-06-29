import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('infection module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the infection module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('infection');
  });

  it('returns an isolation board of seeded active alerts with patient + location', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/infection/board' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.total);
    const item = body.items[0];
    expect(item.patient).toBeTruthy();
    expect(item.patient.name).toBeTruthy();
    expect(item.organism).toBeTruthy();
    expect(['active']).toContain(item.status);
    // Isolation-required alerts should sort to the top of the board.
    expect(item.isolationRequired).toBe(true);
  });

  it('reports metrics with an organism breakdown and side-room capacity', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/infection/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.activeCases).toBeGreaterThan(0);
    expect(Array.isArray(body.byOrganism)).toBe(true);
    expect(body.byOrganism.length).toBeGreaterThan(0);
    const sum = body.byOrganism.reduce((acc: number, o: { total: number }) => acc + o.total, 0);
    expect(sum).toBe(body.activeCases);
    expect(body.isolation.sideRoomCapacity).toBeGreaterThan(0);
    expect(body.isolation.sideRoomsAvailable).toBeGreaterThanOrEqual(0);
  });

  it('includes ad-hoc organisms in the metrics breakdown so it always sums to activeCases', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[1].id as string;
    await app.inject({
      method: 'POST',
      url: '/api/infection/alerts',
      payload: { patientId, organism: 'RSV', type: 'infection' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/infection/metrics' });
    const body = res.json();
    const sum = body.byOrganism.reduce((acc: number, o: { total: number }) => acc + o.total, 0);
    expect(sum).toBe(body.activeCases);
    expect(body.byOrganism.some((o: { organism: string }) => o.organism === 'RSV')).toBe(true);
  });

  it('raises a new alert against an existing patient', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/infection/alerts',
      payload: { patientId, organism: 'MRSA', type: 'colonisation', sideRoom: true },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('active');
    expect(created.organism).toBe('MRSA');
    expect(created.isolationRequired).toBe(true);
    expect(created.patient.reference).toBe(`Patient/${patientId}`);
  });

  it('rejects an alert for an unknown patient with 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/infection/alerts',
      payload: { patientId: 'does-not-exist', organism: 'MRSA', type: 'infection' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid alert body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/infection/alerts',
      payload: { organism: 'MRSA' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clears an active alert and is idempotency-guarded', async () => {
    const board = await app.inject({ method: 'GET', url: '/api/infection/board' });
    const alertId = board.json().items[0].id as string;

    const cleared = await app.inject({ method: 'POST', url: `/api/infection/${alertId}/clear` });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().status).toBe('cleared');
    expect(cleared.json().clearedAt).toBeTruthy();

    // Cleared alerts drop off the board.
    const after = await app.inject({ method: 'GET', url: '/api/infection/board' });
    const stillThere = after.json().items.some((i: { id: string }) => i.id === alertId);
    expect(stillThere).toBe(false);

    // Clearing again is a bad request.
    const again = await app.inject({ method: 'POST', url: `/api/infection/${alertId}/clear` });
    expect(again.statusCode).toBe(400);
  });

  it('returns 404 when clearing an unknown alert', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/infection/unknown-id/clear' });
    expect(res.statusCode).toBe(404);
  });
});
