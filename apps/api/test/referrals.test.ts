import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface RttView {
  id: string;
  patient: { reference: string; display?: string };
  toSpecialty: string;
  priority: 'routine' | 'urgent' | '2ww';
  status: 'received' | 'triaged' | 'booked' | 'treated' | 'discharged';
  weeksElapsed: number;
  daysElapsed: number;
  daysToBreach: number;
  breached: boolean;
  breachRisk: 'breached' | 'high' | 'medium' | 'low';
  clockStopped: boolean;
  is2ww: boolean;
  twoWeekWaitBreached: boolean;
}

interface Worklist {
  total: number;
  open: number;
  breaches: number;
  twoWeekWait: number;
  targetWeeks: number;
  items: RttView[];
}

describe('referrals module', () => {
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
    expect(ids).toContain('referrals');
  });

  it('returns a worklist of seeded referrals with computed RTT fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/referrals/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Worklist;
    expect(body.total).toBeGreaterThanOrEqual(15);
    expect(body.targetWeeks).toBe(18);
    expect(body.items.length).toBe(body.total);

    const first = body.items[0]!;
    expect(first).toBeTruthy();
    // Worklist is sorted newest-breaching (most days elapsed) first.
    expect(first.daysElapsed).toBeGreaterThanOrEqual(body.items[body.items.length - 1]!.daysElapsed);
    expect(first.breached).toBe(first.daysElapsed >= 18 * 7);
    expect(typeof first.breachRisk).toBe('string');
  });

  it('flags 2-week-wait pathways in the worklist summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/referrals/worklist?priority=2ww' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Worklist;
    expect(body.items.every((r) => r.priority === '2ww')).toBe(true);
  });

  it('reports RTT performance metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/referrals/metrics' });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.targetWeeks).toBe(18);
    expect(m.totalReferrals).toBeGreaterThan(0);
    expect(m.openPathways).toBeGreaterThanOrEqual(0);
    expect(m.performance).toBeGreaterThanOrEqual(0);
    expect(m.performance).toBeLessThanOrEqual(100);
    expect(Array.isArray(m.bySpecialty)).toBe(true);
  });

  it('creates a referral, starting the RTT clock', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals/refer',
      payload: {
        patientId,
        toSpecialty: 'Cardiology',
        priority: 'urgent',
        reason: 'New onset exertional chest pain',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.status).toBe('received');
    expect(created.clockStart).toBeTruthy();
    expect(created.patient.reference).toBe(`Patient/${patientId}`);
  });

  it('rejects a referral for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals/refer',
      payload: { patientId: 'does-not-exist', toSpecialty: 'Cardiology', reason: 'test' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid referral body (validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals/refer',
      payload: { toSpecialty: 'Cardiology' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('triages a newly received referral', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[1].id as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/referrals/refer',
      payload: { patientId, toSpecialty: 'Dermatology', reason: 'Suspicious lesion', priority: '2ww' },
    });
    const id = created.json().id as string;

    const triaged = await app.inject({
      method: 'POST',
      url: `/api/referrals/${id}/triage`,
      payload: { outcome: 'accepted', triagedBy: 'Dr Triage', notes: 'Accepted' },
    });
    expect(triaged.statusCode).toBe(200);
    expect(triaged.json().status).toBe('triaged');
    expect(triaged.json().triage.outcome).toBe('accepted');
  });

  it('advances a referral through legal status transitions and stops the clock', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[2].id as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/referrals/refer',
      payload: { patientId, toSpecialty: 'Orthopaedics', reason: 'Knee pain' },
    });
    const id = created.json().id as string;

    await app.inject({ method: 'POST', url: `/api/referrals/${id}/triage`, payload: { outcome: 'accepted' } });
    const booked = await app.inject({ method: 'POST', url: `/api/referrals/${id}/status`, payload: { status: 'booked' } });
    expect(booked.statusCode).toBe(200);
    const treated = await app.inject({ method: 'POST', url: `/api/referrals/${id}/status`, payload: { status: 'treated' } });
    expect(treated.statusCode).toBe(200);

    const view = await app.inject({ method: 'GET', url: `/api/referrals/${id}` });
    expect(view.json().clockStopped).toBe(true);
    expect(view.json().clockStop).toBeTruthy();
  });

  it('rejects an illegal status transition', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[3].id as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/referrals/refer',
      payload: { patientId, toSpecialty: 'Neurology', reason: 'Headache' },
    });
    const id = created.json().id as string;
    // received -> treated is illegal (must be triaged then booked first).
    const res = await app.inject({ method: 'POST', url: `/api/referrals/${id}/status`, payload: { status: 'treated' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown referral', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/referrals/nope' });
    expect(res.statusCode).toBe(404);
  });
});
