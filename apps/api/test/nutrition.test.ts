import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('nutrition module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the nutrition module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('nutrition');
  });

  it('returns a seeded nutrition worklist with MUST scores and at-risk flags', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nutrition/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.total);
    const screened = body.items.filter((i: { screen: unknown }) => i.screen !== null);
    expect(screened.length).toBeGreaterThan(0);
    for (const item of screened) {
      expect(item.mustScore).toBeGreaterThanOrEqual(0);
      expect(item.mustScore).toBeLessThanOrEqual(6);
      expect(['low', 'medium', 'high']).toContain(item.risk);
      expect(item.atRisk).toBe(item.mustScore >= 2);
    }
  });

  it('records a MUST screen and auto-refers high-risk patients', async () => {
    const worklist = await app.inject({ method: 'GET', url: '/api/nutrition/worklist' });
    const patientId = worklist.json().items[0].patient.id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/nutrition/screen',
      payload: { patientId, bmi: 16.2, weightLossRisk: 'high', acutelyIllNoIntake: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.screen.mustScore).toBe(6);
    expect(body.risk).toBe('high');
    expect(body.screen.referralToDietitian).toBe(true);
  });

  it('rejects a MUST screen for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nutrition/screen',
      payload: { patientId: 'does-not-exist', bmi: 22, weightLossRisk: 'low' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid MUST screen body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nutrition/screen',
      payload: { patientId: 'x', bmi: 500, weightLossRisk: 'unknown' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('computes a running 24h fluid balance for a patient', async () => {
    const worklist = await app.inject({ method: 'GET', url: '/api/nutrition/worklist' });
    const patientId = worklist.json().items[0].patient.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/nutrition/${patientId}/fluid-balance`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.windowHours).toBe(24);
    expect(body.patient.id).toBe(patientId);
    expect(body.netBalanceMl).toBe(body.totalIntakeMl - body.totalOutputMl);
    if (body.entries.length > 0) {
      const last = body.entries[body.entries.length - 1];
      expect(last.balanceMl).toBe(body.netBalanceMl);
    }
  });

  it('adds a fluid balance entry and reflects it in the running total', async () => {
    const worklist = await app.inject({ method: 'GET', url: '/api/nutrition/worklist' });
    const patientId = worklist.json().items[0].patient.id;

    const before = await app.inject({
      method: 'GET',
      url: `/api/nutrition/${patientId}/fluid-balance`,
    });
    const beforeIntake = before.json().totalIntakeMl;

    const add = await app.inject({
      method: 'POST',
      url: `/api/nutrition/${patientId}/fluid`,
      payload: { intakeMl: 250, outputMl: 0, route: 'oral' },
    });
    expect(add.statusCode).toBe(201);

    const after = await app.inject({
      method: 'GET',
      url: `/api/nutrition/${patientId}/fluid-balance`,
    });
    expect(after.json().totalIntakeMl).toBe(beforeIntake + 250);
  });

  it('rejects an empty fluid entry', async () => {
    const worklist = await app.inject({ method: 'GET', url: '/api/nutrition/worklist' });
    const patientId = worklist.json().items[0].patient.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/nutrition/${patientId}/fluid`,
      payload: { intakeMl: 0, outputMl: 0, route: 'oral' },
    });
    expect(res.statusCode).toBe(400);
  });
});
