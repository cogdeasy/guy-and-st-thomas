import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('maternity module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the maternity module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('maternity');
  });

  it('reports pathway summary counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/maternity/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalEpisodes).toBeGreaterThan(0);
    expect(body.antenatal + body.intrapartum + body.postnatal).toBe(body.totalEpisodes);
  });

  it('lists antenatal women with live gestation and risk', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/maternity/antenatal' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    const item = body.items[0];
    expect(item.status).toBe('antenatal');
    expect(typeof item.gestationWeeks).toBe('number');
    expect(item.patientName).toBeTruthy();
    expect(Array.isArray(item.riskFactors)).toBe(true);
    // Sorted by descending gestation.
    expect(item.gestationWeeks).toBeGreaterThanOrEqual(
      body.items[body.items.length - 1].gestationWeeks,
    );
  });

  it('returns the intrapartum labour-ward board', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/maternity/labour-ward' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.every((i: { status: string }) => i.status === 'intrapartum')).toBe(true);
  });

  it('creates a pregnancy episode against a real patient', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/maternity/episodes',
      payload: {
        patientId,
        edd: new Date(Date.now() + 14 * 7 * 24 * 60 * 60 * 1000).toISOString(),
        parity: 1,
        riskFactors: ['Gestational diabetes'],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('antenatal');
    expect(body.patient).toBe(`Patient/${patientId}`);
    expect(body.gestationWeeks).toBeGreaterThan(20);
  });

  it('rejects an episode for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/maternity/episodes',
      payload: { patientId: 'does-not-exist', edd: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an episode with an invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/maternity/episodes',
      payload: { edd: '2030-01-01' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('records a birth and moves the episode to postnatal', async () => {
    const board = await app.inject({ method: 'GET', url: '/api/maternity/labour-ward' });
    const episode = board.json().items[0];
    expect(episode).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: `/api/maternity/episodes/${episode.id}/birth`,
      payload: { mode: 'svd', babyWeightGrams: 3500, apgar1: 8, apgar5: 9 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.episode.status).toBe('postnatal');
    expect(body.birth.mode).toBe('svd');
    expect(body.birth.babyWeightGrams).toBe(3500);

    // A second birth on the same episode is rejected.
    const again = await app.inject({
      method: 'POST',
      url: `/api/maternity/episodes/${episode.id}/birth`,
      payload: { mode: 'svd', babyWeightGrams: 3500, apgar1: 8, apgar5: 9 },
    });
    expect(again.statusCode).toBe(400);
  });

  it('returns a full maternity record for a patient', async () => {
    const board = await app.inject({ method: 'GET', url: '/api/maternity/antenatal' });
    const patientRef: string = board.json().items[0].patient;
    const patientId = patientRef.split('/')[1];

    const res = await app.inject({ method: 'GET', url: `/api/maternity/${patientId}/record` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.patient.id).toBe(patientId);
    expect(body.episodes.length).toBeGreaterThan(0);
  });

  it('returns 404 for a maternity record of an unknown patient', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/maternity/nope/record' });
    expect(res.statusCode).toBe(404);
  });
});
