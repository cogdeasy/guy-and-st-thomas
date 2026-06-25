import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface BoardAttendance {
  id: string;
  patient: string;
  status: string;
  acuity: number | null;
  patientDisplay: string;
  breach: { elapsedMinutes: number; minutesToBreach: number; breached: boolean };
}

describe('ed module', () => {
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
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('ed');
  });

  it('serves a seeded board sorted by breach then acuity', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ed/board' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; attendances: BoardAttendance[] };
    expect(body.total).toBeGreaterThan(0);
    expect(body.attendances.every((a) => a.status !== 'discharged')).toBe(true);
    expect(body.attendances[0]?.patientDisplay).toBeTruthy();

    const breachRank = (a: BoardAttendance) => (a.breach.breached ? 0 : 1);
    const acuityRank = (a: BoardAttendance) => a.acuity ?? 6;
    for (let i = 1; i < body.attendances.length; i++) {
      const prev = body.attendances[i - 1] as BoardAttendance;
      const cur = body.attendances[i] as BoardAttendance;
      const ordered =
        breachRank(prev) < breachRank(cur) ||
        (breachRank(prev) === breachRank(cur) && acuityRank(prev) <= acuityRank(cur));
      expect(ordered).toBe(true);
    }
  });

  it('reports 4-hour performance metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ed/metrics' });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.totalAttendances).toBeGreaterThan(0);
    expect(m.totalInDepartment).toBeGreaterThanOrEqual(0);
    expect(m.fourHourPerformance).toBeGreaterThanOrEqual(0);
    expect(m.fourHourPerformance).toBeLessThanOrEqual(1);
    expect(typeof m.byStatus.waiting).toBe('number');
  });

  it('registers an arrival and surfaces it on the board', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id as string;

    const res = await app.inject({
      method: 'POST',
      url: '/api/ed/attend',
      payload: { patientId, chiefComplaint: 'Chest pain' },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created.status).toBe('waiting');
    expect(created.encounter).toMatch(/^Encounter\//);

    const board = await app.inject({ method: 'GET', url: '/api/ed/board' });
    const ids = (board.json().attendances as BoardAttendance[]).map((a) => a.id);
    expect(ids).toContain(created.id);
  });

  it('rejects an arrival for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ed/attend',
      payload: { patientId: 'does-not-exist', chiefComplaint: 'Fall' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('triages a waiting attendance and assigns acuity', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[1].id as string;
    const attend = await app.inject({
      method: 'POST',
      url: '/api/ed/attend',
      payload: { patientId, chiefComplaint: 'Shortness of breath' },
    });
    const id = attend.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/ed/${id}/triage`,
      payload: { acuity: 2, cubicle: 'Majors 3' },
    });
    expect(res.statusCode).toBe(200);
    const triaged = res.json();
    expect(triaged.acuity).toBe(2);
    expect(triaged.status).toBe('triaged');
    expect(triaged.cubicle).toBe('Majors 3');
  });

  it('validates the triage acuity range', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[2].id as string;
    const attend = await app.inject({
      method: 'POST',
      url: '/api/ed/attend',
      payload: { patientId, chiefComplaint: 'Fall' },
    });
    const id = attend.json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/ed/${id}/triage`,
      payload: { acuity: 9 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('advances status through legal transitions and rejects illegal ones', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[3].id as string;
    const attend = await app.inject({
      method: 'POST',
      url: '/api/ed/attend',
      payload: { patientId, chiefComplaint: 'Sepsis ?source', acuity: 1 },
    });
    const id = attend.json().id as string;

    const ok = await app.inject({
      method: 'POST',
      url: `/api/ed/${id}/status`,
      payload: { status: 'in-treatment' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('in-treatment');
    expect(ok.json().treatmentStartTime).toBeTruthy();

    const discharge = await app.inject({
      method: 'POST',
      url: `/api/ed/${id}/status`,
      payload: { status: 'discharged' },
    });
    expect(discharge.statusCode).toBe(200);
    expect(discharge.json().dischargeTime).toBeTruthy();

    // discharged is terminal — no further transitions allowed.
    const illegal = await app.inject({
      method: 'POST',
      url: `/api/ed/${id}/status`,
      payload: { status: 'waiting' },
    });
    expect(illegal.statusCode).toBe(400);
  });

  it('returns 404 transitioning an unknown attendance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ed/nope/status',
      payload: { status: 'discharged' },
    });
    expect(res.statusCode).toBe(404);
  });
});
