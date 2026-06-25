import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('bloodbank module', () => {
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
    expect(ids).toContain('bloodbank');
  });

  it('returns a seeded transfusion worklist grouped by status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bloodbank/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(5);
    expect(body.items.length).toBe(body.total);
    // Every seeded order is attached to a real patient.
    expect(body.items.every((i: { patient: unknown }) => i.patient)).toBe(true);
    // Status buckets are populated across the workflow.
    expect(Object.keys(body.byStatus).length).toBeGreaterThan(1);
  });

  it('filters the worklist by status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bloodbank/worklist?status=requested' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((i: { order: { status: string } }) => i.order.status === 'requested')).toBe(
      true,
    );
  });

  it('reports blood stock by component and group', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bloodbank/stock' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalUnits).toBeGreaterThan(0);
    expect(body.components.map((c: { component: string }) => c.component)).toEqual([
      'red-cells',
      'platelets',
      'ffp',
    ]);
    expect(body.components[0].groups.length).toBe(8);
  });

  it('drives an order through the crossmatch → issue → transfuse pathway', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/bloodbank/order',
      payload: {
        patientId,
        component: 'red-cells',
        bloodGroup: 'O+',
        units: 1,
        indication: 'Symptomatic anaemia',
        priority: 'urgent',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().status).toBe('requested');

    const xm = await app.inject({ method: 'POST', url: `/api/bloodbank/${id}/crossmatch` });
    expect(xm.statusCode).toBe(200);
    expect(xm.json().status).toBe('crossmatched');

    const issue = await app.inject({ method: 'POST', url: `/api/bloodbank/${id}/issue` });
    expect(issue.statusCode).toBe(200);
    expect(issue.json().status).toBe('issued');

    const transfuse = await app.inject({ method: 'POST', url: `/api/bloodbank/${id}/transfuse` });
    expect(transfuse.statusCode).toBe(200);
    expect(transfuse.json().status).toBe('transfused');
  });

  it('rejects an out-of-sequence transition', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/bloodbank/order',
      payload: {
        patientId,
        component: 'platelets',
        bloodGroup: 'A+',
        units: 1,
        indication: 'Thrombocytopenia',
      },
    });
    const id = created.json().id;
    // Can't issue before crossmatch.
    const issue = await app.inject({ method: 'POST', url: `/api/bloodbank/${id}/issue` });
    expect(issue.statusCode).toBe(400);
  });

  it('rejects an order for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bloodbank/order',
      payload: {
        patientId: 'does-not-exist',
        component: 'ffp',
        bloodGroup: 'B+',
        units: 2,
        indication: 'Coagulopathy',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('validates the order body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bloodbank/order',
      payload: { patientId: 'x', component: 'gold', bloodGroup: 'O+', units: 1, indication: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown order', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bloodbank/nope' });
    expect(res.statusCode).toBe(404);
  });
});
