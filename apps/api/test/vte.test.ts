import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('vte module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the vte module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('vte');
  });

  it('exposes the risk-factor catalogue', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vte/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.riskFactors.length).toBeGreaterThan(0);
    expect(body.bleedingRiskFactors.length).toBeGreaterThan(0);
    expect(body.prophylaxisOptions).toEqual(['mechanical', 'pharmacological', 'none']);
  });

  it('returns a worklist of admitted patients with assessment status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vte/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.total);
    // Seed leaves some patients unassessed (and therefore overdue).
    expect(body.assessed).toBeGreaterThan(0);
    expect(body.assessed).toBeLessThan(body.total);
    for (const item of body.items) {
      expect(item.encounterId).toBeTruthy();
      expect(item.patient).toBeTruthy();
      expect(typeof item.assessed).toBe('boolean');
      expect(typeof item.overdue).toBe('boolean');
    }
    // Overdue items sort to the top.
    const firstUnassessed = body.items.findIndex((i: { assessed: boolean }) => i.assessed);
    if (firstUnassessed > 0) {
      expect(
        body.items.slice(0, firstUnassessed).every((i: { assessed: boolean }) => !i.assessed),
      ).toBe(true);
    }
  });

  it('reports 24h compliance metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vte/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalAdmitted).toBeGreaterThan(0);
    expect(body.compliancePct).toBeGreaterThanOrEqual(0);
    expect(body.compliancePct).toBeLessThanOrEqual(100);
    expect(body.withinTarget).toBeLessThanOrEqual(body.assessed);
  });

  it('records an assessment and derives the prophylaxis recommendation', async () => {
    const worklist = await app.inject({ method: 'GET', url: '/api/vte/worklist' });
    const target = worklist.json().items.find((i: { assessed: boolean }) => !i.assessed);
    expect(target).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: '/api/vte/assess',
      payload: {
        encounterId: target.encounterId,
        riskFactors: ['Active cancer or cancer treatment', 'Age over 60'],
        bleedingRiskFactors: ['Active bleeding'],
      },
    });
    expect(res.statusCode).toBe(201);
    const saved = res.json();
    expect(saved.completed).toBe(true);
    // Risk present + bleeding risk present => mechanical prophylaxis.
    expect(saved.prophylaxisRecommended).toBe('mechanical');

    // The patient should now show as assessed (and not overdue) on the worklist.
    const after = await app.inject({ method: 'GET', url: '/api/vte/worklist' });
    const updated = after
      .json()
      .items.find((i: { encounterId: string }) => i.encounterId === target.encounterId);
    expect(updated.assessed).toBe(true);
    expect(updated.overdue).toBe(false);
  });

  it('updates an existing assessment in place (idempotent per encounter)', async () => {
    const worklist = await app.inject({ method: 'GET', url: '/api/vte/worklist' });
    const target = worklist.json().items.find((i: { assessed: boolean }) => i.assessed);
    expect(target).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: '/api/vte/assess',
      payload: { encounterId: target.encounterId, riskFactors: [], bleedingRiskFactors: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().prophylaxisRecommended).toBe('none');
  });

  it('404s when assessing an unknown encounter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vte/assess',
      payload: { encounterId: 'does-not-exist', riskFactors: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s on an invalid assessment body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vte/assess',
      payload: { riskFactors: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
});
