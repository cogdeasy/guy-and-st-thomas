import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('orders module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the orders module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('orders');
  });

  it('serves a coded order catalogue grouped by category', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders/catalogue' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(10);
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['fbc', 'ue', 'crp', 'lft', 'cxr', 'ct-head', 'ecg']));
    expect(body.categories.find((c: { key: string }) => c.key === 'laboratory').count).toBeGreaterThan(0);
    // Every catalogue item carries a terminology code.
    for (const item of body.items) {
      expect(item.code).toBeTruthy();
      expect(item.system).toBeTruthy();
    }
  });

  it('filters the catalogue by category and free text', async () => {
    const imaging = await app.inject({ method: 'GET', url: '/api/orders/catalogue?category=imaging' });
    expect(imaging.json().items.every((i: { category: string }) => i.category === 'imaging')).toBe(true);

    const search = await app.inject({ method: 'GET', url: '/api/orders/catalogue?q=troponin' });
    expect(search.json().items.map((i: { id: string }) => i.id)).toContain('trop');
  });

  it('seeds outstanding orders into the worklist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.groups.length).toBeGreaterThan(0);
    // Worklist only contains outstanding (not completed/cancelled) orders.
    expect(body.orders.every((o: { status: string }) => ['draft', 'active'].includes(o.status))).toBe(true);
    expect(body.summary).toHaveProperty('requested');
    expect(body.summary).toHaveProperty('inProgress');
  });

  it('places an order against a seeded patient and returns it enriched', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/order',
      payload: { patientId, itemId: 'fbc', priority: 'urgent', clinicalDetails: 'Query sepsis' },
    });
    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(order.status).toBe('draft');
    expect(order.statusLabel).toBe('Requested');
    expect(order.priority).toBe('urgent');
    expect(order.display).toContain('Full Blood Count');
    expect(order.patient.id).toBe(patientId);
    expect(order.nextStatuses.map((s: { status: string }) => s.status)).toContain('active');
  });

  it('rejects an order for an unknown catalogue item', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/order',
      payload: { patientId, itemId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an order for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/orders/order',
      payload: { patientId: 'nope-123', itemId: 'fbc' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('advances an order through its lifecycle and blocks illegal transitions', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders/order',
      payload: { patientId, itemId: 'cxr' },
    });
    const id = created.json().id;

    const toActive = await app.inject({ method: 'POST', url: `/api/orders/${id}/status`, payload: { status: 'active' } });
    expect(toActive.statusCode).toBe(200);
    expect(toActive.json().status).toBe('active');

    const toCompleted = await app.inject({
      method: 'POST',
      url: `/api/orders/${id}/status`,
      payload: { status: 'completed' },
    });
    expect(toCompleted.statusCode).toBe(200);
    expect(toCompleted.json().status).toBe('completed');

    // completed is terminal — cannot go back to active.
    const illegal = await app.inject({
      method: 'POST',
      url: `/api/orders/${id}/status`,
      payload: { status: 'active' },
    });
    expect(illegal.statusCode).toBe(400);
  });

  it('404s when reading a non-existent order', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/orders/missing-id' });
    expect(res.statusCode).toBe(404);
  });
});
