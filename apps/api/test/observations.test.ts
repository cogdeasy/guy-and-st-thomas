import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('observations module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the observations module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('observations');
  });

  async function anAdmittedPatientId(): Promise<string> {
    const worklist = await app.inject({ method: 'GET', url: '/api/patients/worklist' });
    const item = worklist.json().items[0];
    expect(item).toBeTruthy();
    return item.patient.id as string;
  }

  it('returns a vitals chart with a NEWS2 trend for an admitted patient', async () => {
    const patientId = await anAdmittedPatientId();
    const res = await app.inject({ method: 'GET', url: `/api/observations/${patientId}/chart` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.patient.id).toBe(patientId);
    expect(Array.isArray(body.series)).toBe(true);
    expect(body.total).toBeGreaterThan(1); // historical sets seeded over 24h
    expect(body.trend.length).toBe(body.total);
    const scored = body.series.find((s: { news2: unknown }) => s.news2);
    expect(scored.news2.score).toBeGreaterThanOrEqual(0);
    expect(['low', 'low-medium', 'medium', 'high']).toContain(scored.news2.risk);
  });

  it('returns an observation-round worklist sorted by NEWS2 desc', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/observations/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    const scores = body.items
      .map((r: { news2: { score: number } | null }) => r.news2?.score ?? -1)
      .filter((n: number) => n >= 0);
    expect([...scores]).toEqual([...scores].sort((a, b) => b - a));
  });

  it('404s charting an unknown patient', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/observations/does-not-exist/chart' });
    expect(res.statusCode).toBe(404);
  });

  it('records a set of vitals and returns NEWS2 + escalation', async () => {
    const patientId = await anAdmittedPatientId();
    const res = await app.inject({
      method: 'POST',
      url: `/api/observations/${patientId}/record`,
      payload: {
        respiratoryRate: 28,
        spo2: 89,
        onOxygen: true,
        systolicBp: 88,
        heartRate: 125,
        consciousness: 'V',
        temperature: 39.1,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.news2.score).toBeGreaterThanOrEqual(7);
    expect(body.news2.risk).toBe('high');
    expect(body.escalation.band).toBe('High');
    expect(body.observations.length).toBeGreaterThan(0);

    // The recorded set should now be the latest point on the chart.
    const chart = await app.inject({ method: 'GET', url: `/api/observations/${patientId}/chart` });
    expect(chart.json().latest.news2.score).toBe(body.news2.score);
  });

  it('rejects an out-of-range vitals submission', async () => {
    const patientId = await anAdmittedPatientId();
    const res = await app.inject({
      method: 'POST',
      url: `/api/observations/${patientId}/record`,
      payload: { respiratoryRate: 18, spo2: 250, systolicBp: 120, heartRate: 80, temperature: 37 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists deteriorating patients trust-wide, sorted by NEWS2 desc', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/observations/deteriorating' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.threshold).toBe(5);
    expect(body.total).toBeGreaterThan(0); // seed guarantees a few deteriorating patients
    for (const row of body.items) {
      expect(row.news2).toBeGreaterThanOrEqual(5);
      expect(row.escalation.band).toBeTruthy();
    }
    const scores = body.items.map((r: { news2: number }) => r.news2);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});
