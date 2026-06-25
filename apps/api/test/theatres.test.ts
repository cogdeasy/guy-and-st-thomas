import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface CaseView {
  id: string;
  status: string;
  order: number;
  patient: { id: string; name: string };
}

interface ListView {
  id: string;
  date: string;
  theatre: string;
  session: string;
  surgeonName: string;
  cases: CaseView[];
  counts: Record<string, number>;
}

describe('theatres module', () => {
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
    expect(ids).toContain('theatres');
  });

  it("returns today's theatre lists with ordered cases on real patients", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/theatres/lists' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { date: string; total: number; lists: ListView[] };
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.lists.length).toBe(body.total);

    const list = body.lists[0] as ListView;
    expect(list.surgeonName).toBeTruthy();
    expect(list.cases.length).toBeGreaterThanOrEqual(3);
    // Cases are ordered by their position on the list.
    const orders = list.cases.map((c) => c.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    // Cases attach to real seeded patients.
    expect(list.cases[0]?.patient.id).toBeTruthy();
    expect(list.cases[0]?.patient.name).toBeTruthy();
  });

  it('builds a live theatre board across theatres', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/theatres/board' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      theatres: Array<{ theatre: string; state: string; totalCases: number }>;
    };
    expect(body.theatres.length).toBeGreaterThanOrEqual(3);
    for (const t of body.theatres) {
      expect(t.theatre).toBeTruthy();
      expect(t.totalCases).toBeGreaterThan(0);
    }
  });

  it('creates a list and books a case onto it', async () => {
    const prac = await app.inject({ method: 'GET', url: '/api/fhir/Practitioner' });
    const surgeonId = prac.json().entry[0].id as string;
    const pat = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = pat.json().entry[0].id as string;

    const listRes = await app.inject({
      method: 'POST',
      url: '/api/theatres/lists',
      payload: { theatre: 'Test Theatre 9', session: 'PM', surgeonId },
    });
    expect(listRes.statusCode).toBe(201);
    const listId = listRes.json().id as string;

    const caseRes = await app.inject({
      method: 'POST',
      url: '/api/theatres/cases',
      payload: { listId, patientId, procedureText: 'Diagnostic laparoscopy', priority: 'urgent' },
    });
    expect(caseRes.statusCode).toBe(201);
    expect(caseRes.json().status).toBe('scheduled');
    expect(caseRes.json().order).toBe(1);
  });

  it('advances a case through the perioperative pathway', async () => {
    const prac = await app.inject({ method: 'GET', url: '/api/fhir/Practitioner' });
    const surgeonId = prac.json().entry[0].id as string;
    const pat = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = pat.json().entry[1].id as string;

    const listId = (
      await app.inject({
        method: 'POST',
        url: '/api/theatres/lists',
        payload: { theatre: 'Test Theatre 10', session: 'AM', surgeonId },
      })
    ).json().id as string;
    const caseId = (
      await app.inject({
        method: 'POST',
        url: '/api/theatres/cases',
        payload: { listId, patientId, procedureText: 'Appendicectomy' },
      })
    ).json().id as string;

    const advance = await app.inject({ method: 'POST', url: `/api/theatres/cases/${caseId}/status` });
    expect(advance.statusCode).toBe(200);
    expect(advance.json().status).toBe('sent-for');

    const explicit = await app.inject({
      method: 'POST',
      url: `/api/theatres/cases/${caseId}/status`,
      payload: { status: 'anaesthetic' },
    });
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json().status).toBe('anaesthetic');
  });

  it('rejects an illegal status transition', async () => {
    const prac = await app.inject({ method: 'GET', url: '/api/fhir/Practitioner' });
    const surgeonId = prac.json().entry[0].id as string;
    const pat = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = pat.json().entry[2].id as string;

    const listId = (
      await app.inject({
        method: 'POST',
        url: '/api/theatres/lists',
        payload: { theatre: 'Test Theatre 11', session: 'AM', surgeonId },
      })
    ).json().id as string;
    const caseId = (
      await app.inject({
        method: 'POST',
        url: '/api/theatres/cases',
        payload: { listId, patientId, procedureText: 'Cataract extraction' },
      })
    ).json().id as string;

    const res = await app.inject({
      method: 'POST',
      url: `/api/theatres/cases/${caseId}/status`,
      payload: { status: 'complete' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s creating a case against a missing list', async () => {
    const pat = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = pat.json().entry[0].id as string;
    const res = await app.inject({
      method: 'POST',
      url: '/api/theatres/cases',
      payload: { listId: 'does-not-exist', patientId, procedureText: 'Hernia repair' },
    });
    expect(res.statusCode).toBe(404);
  });
});
