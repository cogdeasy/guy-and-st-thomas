import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('medadmin module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers itself as a module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('medadmin');
  });

  it('seeds MedicationRequests and MedicationAdministrations', async () => {
    const requests = await app.inject({ method: 'GET', url: '/api/fhir/MedicationRequest' });
    const admins = await app.inject({ method: 'GET', url: '/api/fhir/MedicationAdministration' });
    expect(requests.json().entry.length).toBeGreaterThan(0);
    expect(admins.json().entry.length).toBeGreaterThan(0);
  });

  it('computes the drug round with stats and worklist items', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/medadmin/round' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.stats.total).toBe(body.items.length);
    // Seed back-fills a 24h mix, so there is at least one administered dose.
    expect(body.stats.given + body.stats.omitted).toBeGreaterThan(0);

    const statuses = new Set(body.items.map((i: { status: string }) => i.status));
    for (const s of statuses) {
      expect(['overdue', 'due', 'upcoming', 'given', 'omitted']).toContain(s);
    }
  });

  it('filters the round by status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/medadmin/round?status=given' });
    expect(res.statusCode).toBe(200);
    for (const item of res.json().items) {
      expect(item.status).toBe('given');
    }
  });

  it('filters the round by ward and 404s on an unknown ward', async () => {
    const round = await app.inject({ method: 'GET', url: '/api/medadmin/round' });
    const ward = round.json().wards[0];
    expect(ward).toBeTruthy();

    const scoped = await app.inject({ method: 'GET', url: `/api/medadmin/round?ward=${ward.id}` });
    expect(scoped.statusCode).toBe(200);
    for (const item of scoped.json().items) {
      expect(item.ward?.id).toBe(ward.id);
    }

    const missing = await app.inject({
      method: 'GET',
      url: '/api/medadmin/round?ward=Location/nope',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('exposes the omission-reason reference list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/medadmin/reasons' });
    expect(res.statusCode).toBe(200);
    expect(res.json().reasons.length).toBeGreaterThan(0);
    expect(res.json().reasons[0]).toHaveProperty('code');
  });

  it('records a given administration and reflects it in patient history', async () => {
    const round = await app.inject({ method: 'GET', url: '/api/medadmin/round' });
    const target = round
      .json()
      .items.find((i: { status: string }) => i.status === 'due' || i.status === 'overdue');
    expect(target).toBeTruthy();

    const before = await app.inject({
      method: 'GET',
      url: `/api/medadmin/history/${target.patient.id}`,
    });
    const givenBefore = before.json().given;

    const res = await app.inject({
      method: 'POST',
      url: '/api/medadmin/administer',
      payload: {
        medicationRequestId: target.medicationRequestId,
        scheduledTime: target.scheduledTime,
        status: 'given',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().administration.status).toBe('completed');

    const after = await app.inject({
      method: 'GET',
      url: `/api/medadmin/history/${target.patient.id}`,
    });
    expect(after.json().given).toBe(givenBefore + 1);
  });

  it('records an omission with a reason code', async () => {
    const round = await app.inject({ method: 'GET', url: '/api/medadmin/round' });
    const target = round
      .json()
      .items.find((i: { status: string }) => i.status === 'due' || i.status === 'overdue');
    expect(target).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: '/api/medadmin/administer',
      payload: {
        medicationRequestId: target.medicationRequestId,
        scheduledTime: target.scheduledTime,
        status: 'omitted',
        reasonCode: 'patient-refused',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().administration.status).toBe('not-done');
    expect(res.json().administration.notGivenReason).toBe('Patient refused');
  });

  it('rejects an omission without a reason code', async () => {
    const round = await app.inject({ method: 'GET', url: '/api/medadmin/round' });
    const target = round.json().items[0];

    const res = await app.inject({
      method: 'POST',
      url: '/api/medadmin/administer',
      payload: { medicationRequestId: target.medicationRequestId, status: 'omitted' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s when administering against an unknown prescription', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/medadmin/administer',
      payload: { medicationRequestId: 'does-not-exist', status: 'given' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s history for an unknown patient', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/medadmin/history/nope' });
    expect(res.statusCode).toBe(404);
  });
});
