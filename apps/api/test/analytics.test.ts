import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('analytics module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the analytics module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('analytics');
  });

  it('returns a trust-wide operational overview', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.beds.total).toBeGreaterThan(0);
    expect(body.beds.occupancyPct).toBeGreaterThanOrEqual(0);
    expect(body.beds.occupancyPct).toBeLessThanOrEqual(100);
    expect(body.beds.occupied + body.beds.available + body.beds.closed).toBe(body.beds.total);

    expect(body.inpatients.active).toBeGreaterThan(0);
    expect(body.inpatients.deteriorating).toBeLessThanOrEqual(body.inpatients.monitored);

    expect(body.ed.total).toBeGreaterThan(0);
    expect(body.ed.within4h + body.ed.breaches).toBe(body.ed.total);
    expect(body.ed.compliancePct).toBeLessThanOrEqual(100);

    expect(Array.isArray(body.watchlist)).toBe(true);
    expect(body.watchlist.length).toBeLessThanOrEqual(8);
  });

  it('breaks occupancy and activity down per site', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/by-site' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.total).toBe(body.sites.length);
    expect(body.sites.length).toBeGreaterThan(0);

    const totalBeds = body.sites.reduce((s: number, x: { beds: { total: number } }) => s + x.beds.total, 0);
    expect(totalBeds).toBeGreaterThan(0);

    for (const site of body.sites) {
      expect(typeof site.site).toBe('string');
      expect(site.beds.occupancyPct).toBeLessThanOrEqual(100);
      expect(site.activity.edBreaches).toBeLessThanOrEqual(site.activity.edAttendances);
    }
  });

  it('returns time-bucketed admission trends for the default window', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/trends' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.days).toBe(7);
    expect(body.buckets).toHaveLength(7);
    expect(body.totals.admissions).toBe(
      body.buckets.reduce((s: number, b: { admissions: number }) => s + b.admissions, 0),
    );
    expect(body.totals.admissions).toBeGreaterThan(0);
    // Buckets are ordered oldest -> newest and look like ISO dates.
    expect(body.buckets[0].date < body.buckets[6].date).toBe(true);
    expect(body.buckets[6].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('honours a custom trends window', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/trends?days=14' });
    expect(res.statusCode).toBe(200);
    expect(res.json().buckets).toHaveLength(14);
  });

  it('rejects an out-of-range trends window', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/trends?days=999' });
    expect(res.statusCode).toBe(400);
  });

  it('ranks the deterioration watchlist by NEWS2 descending', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analytics/deterioration' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(body.items.length);
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i - 1].news2).toBeGreaterThanOrEqual(body.items[i].news2);
    }
  });
});
