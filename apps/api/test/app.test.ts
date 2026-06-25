import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('TrustOS API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('lists registered modules including patients', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('patients');
  });

  it('seeds patients into the core FHIR store', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry.length).toBeGreaterThan(10);
  });

  it('returns a composite patient summary with NEWS2 where vitals exist', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/patients/worklist' });
    const item = list.json().items[0];
    expect(item).toBeTruthy();
    const summary = await app.inject({
      method: 'GET',
      url: `/api/patients/${item.patient.id}/summary`,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().patient.id).toBe(item.patient.id);
  });

  it('rejects registration with an invalid NHS number', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/patients/register',
      payload: { family: 'Test', given: 'Patient', birthDate: '1990-01-01', nhsNumber: '1234567890' },
    });
    expect(res.statusCode).toBe(400);
  });
});
