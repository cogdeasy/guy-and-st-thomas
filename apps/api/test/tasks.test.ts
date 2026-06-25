import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface EnrichedTask {
  id: string;
  code: string;
  status: string;
  priority: string;
  team: string;
  overdue: boolean;
  patient: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
}

interface Worklist {
  total: number;
  open: number;
  overdue: number;
  unassigned: number;
  byPriority: Array<{ priority: string; tasks: EnrichedTask[] }>;
  byTeam: Array<{ team: string; open: number; overdue: number }>;
}

describe('tasks module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the tasks module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('tasks');
  });

  it('seeds a ward-jobs worklist grouped by priority and team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Worklist;
    expect(body.open).toBeGreaterThan(0);
    expect(body.byPriority.map((g) => g.priority)).toEqual(['stat', 'asap', 'urgent', 'routine']);
    expect(body.byTeam.length).toBe(6);
    const someTask = body.byPriority.flatMap((g) => g.tasks)[0];
    expect(someTask).toBeTruthy();
    expect(someTask?.patient).toBeTruthy();
    expect(someTask?.team).toBeTruthy();
  });

  it('returns metrics with open/overdue broken down by team', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalOpen).toBeGreaterThan(0);
    expect(body.totalOverdue).toBeGreaterThanOrEqual(0);
    expect(body.byTeam.reduce((s: number, t: { open: number }) => s + t.open, 0)).toBe(body.totalOpen);
  });

  it('exposes reference data (teams and job types)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/teams' });
    expect(res.statusCode).toBe(200);
    expect(res.json().teams).toContain('Cardiology');
    expect(res.json().jobTypes.length).toBeGreaterThan(0);
  });

  it('creates, claims and completes a task through its workflow', async () => {
    const patients = (await app.inject({ method: 'GET', url: '/api/fhir/Patient' })).json().entry;
    const practitioners = (await app.inject({ method: 'GET', url: '/api/fhir/Practitioner' })).json()
      .entry;
    const patientId = patients[0].id as string;
    const practitionerId = practitioners[0].id as string;

    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks/create',
      payload: {
        patientId,
        code: 'cannula',
        team: 'Cardiology',
        priority: 'urgent',
        dueInHours: 2,
      },
    });
    expect(created.statusCode).toBe(201);
    const task = created.json() as EnrichedTask;
    expect(task.status).toBe('requested');
    expect(task.team).toBe('Cardiology');
    expect(task.owner).toBeNull();

    const claimed = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/claim`,
      payload: { practitionerId },
    });
    expect(claimed.statusCode).toBe(200);
    expect((claimed.json() as EnrichedTask).status).toBe('in-progress');
    expect((claimed.json() as EnrichedTask).owner?.id).toBe(practitionerId);

    const completed = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/complete`,
      payload: {},
    });
    expect(completed.statusCode).toBe(200);
    expect((completed.json() as EnrichedTask).status).toBe('completed');

    // Completing an already-completed task is rejected.
    const again = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/complete`,
      payload: {},
    });
    expect(again.statusCode).toBe(400);
  });

  it('rejects creating a task for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/create',
      payload: { patientId: 'does-not-exist', code: 'cannula', team: 'Cardiology' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects claiming an unknown task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/unknown-id/claim',
      payload: { practitionerId: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});
