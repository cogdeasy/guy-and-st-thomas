import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('radiology module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the radiology module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('radiology');
  });

  it('seeds imaging requests onto the worklist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/radiology/worklist' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0].patientSummary).toBeTruthy();
  });

  it('filters the worklist by modality', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/radiology/worklist?modality=CT' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((r: { modality: string }) => r.modality === 'CT')).toBe(true);
  });

  it('rejects an unknown modality filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/radiology/worklist?modality=PET' });
    expect(res.statusCode).toBe(400);
  });

  it('exposes operational metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/radiology/metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.byModality).toHaveLength(4);
    expect(body.byStatus).toHaveLength(4);
  });

  it('walks a request through the schedule -> report workflow', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id as string;

    const created = await app.inject({
      method: 'POST',
      url: '/api/radiology/request',
      payload: {
        patientId,
        modality: 'MRI',
        bodyPart: 'Brain',
        clinicalIndication: 'New focal neurology',
        priority: 'urgent',
      },
    });
    expect(created.statusCode).toBe(201);
    const request = created.json();
    expect(request.status).toBe('requested');

    // Cannot report before acquisition.
    const tooEarly = await app.inject({
      method: 'POST',
      url: `/api/radiology/${request.id}/report`,
      payload: { findings: 'x', impression: 'y' },
    });
    expect(tooEarly.statusCode).toBe(400);

    const scheduled = await app.inject({
      method: 'POST',
      url: `/api/radiology/${request.id}/schedule`,
      payload: { scheduledFor: new Date().toISOString() },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json().status).toBe('scheduled');

    const reported = await app.inject({
      method: 'POST',
      url: `/api/radiology/${request.id}/report`,
      payload: { findings: 'No acute intracranial abnormality.', impression: 'Normal study.' },
    });
    expect(reported.statusCode).toBe(200);
    expect(reported.json().status).toBe('reported');
    expect(reported.json().report.impression).toBe('Normal study.');
  });

  it('404s for an unknown request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/radiology/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
