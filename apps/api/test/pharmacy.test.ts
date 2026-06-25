import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface QueueItem {
  record: { id: string; status: string; priority: string };
  medicationRequest: { id: string; medication: { text?: string } } | null;
  patient: { id: string } | null;
  allergies: unknown[];
  allergyConflicts: unknown[];
  waitingMinutes: number;
}

describe('pharmacy module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the pharmacy module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('pharmacy');
  });

  it('seeds dispense records into the verify queue with patient + allergy context', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pharmacy/verify-queue' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    const item: QueueItem = body.items[0];
    expect(item.record.status).toBe('to-verify');
    expect(item.medicationRequest).toBeTruthy();
    expect(item.patient).toBeTruthy();
    expect(Array.isArray(item.allergies)).toBe(true);
    expect(Array.isArray(item.allergyConflicts)).toBe(true);
  });

  it('reports metrics with a status breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pharmacy/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.byStatus['to-verify']).toBeGreaterThan(0);
    expect(body.toVerify).toBe(body.byStatus['to-verify']);
    expect(typeof body.pharmacists).toBe('number');
  });

  it('verifies a prescription and removes it from the to-verify queue', async () => {
    const queue = await app.inject({ method: 'GET', url: '/api/pharmacy/verify-queue' });
    const target = (queue.json().items as QueueItem[]).find((i) => i.allergyConflicts.length === 0);
    expect(target).toBeTruthy();
    const id = target!.record.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/pharmacy/${id}/verify`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.status).toBe('verified');
    expect(res.json().record.pharmacist).toBeTruthy();

    const detail = await app.inject({ method: 'GET', url: `/api/pharmacy/${id}` });
    expect(detail.json().record.status).toBe('verified');
  });

  it('blocks verification when an allergy conflict exists unless overridden', async () => {
    const queue = await app.inject({ method: 'GET', url: '/api/pharmacy/verify-queue' });
    const conflicting = (queue.json().items as QueueItem[]).find(
      (i) => i.allergyConflicts.length > 0,
    );
    expect(conflicting, 'seed should contain at least one allergy conflict').toBeTruthy();
    const id = conflicting!.record.id;

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/pharmacy/${id}/verify`,
      payload: {},
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('allergy_conflict');

    const overridden = await app.inject({
      method: 'POST',
      url: `/api/pharmacy/${id}/verify`,
      payload: { overrideAllergy: true, note: 'Patient tolerated previously — documented' },
    });
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json().record.status).toBe('verified');
  });

  it('requires a note when raising a query', async () => {
    const queue = await app.inject({ method: 'GET', url: '/api/pharmacy/verify-queue' });
    const first = (queue.json().items as QueueItem[])[0];
    expect(first).toBeTruthy();
    const res = await app.inject({
      method: 'POST',
      url: `/api/pharmacy/${first!.record.id}/query`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown dispense record', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pharmacy/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
