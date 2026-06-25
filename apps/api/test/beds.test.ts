import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('beds module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the beds module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('beds');
  });

  it('returns a ward board with occupancy summaries and occupied beds with patients', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/beds/board' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.total).toBeGreaterThan(0);
    expect(body.wards.length).toBeGreaterThan(0);

    const ward = body.wards[0];
    expect(ward.wardName).toBeTruthy();
    expect(ward.siteName).toBeTruthy();
    expect(ward.summary.total).toBe(ward.beds.length);

    const occupied = body.wards.flatMap((w: { beds: { status: string; occupant: unknown }[] }) => w.beds).find(
      (b: { status: string; occupant: unknown }) => b.status === 'occupied' && b.occupant,
    );
    expect(occupied).toBeTruthy();
    expect((occupied as { occupant: { name: string } }).occupant.name).toBeTruthy();
  });

  it('reports trust-wide capacity broken down by site', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/beds/capacity' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trust.total).toBeGreaterThan(0);
    expect(body.trust.occupancyPct).toBeGreaterThanOrEqual(0);
    expect(body.trust.occupancyPct).toBeLessThanOrEqual(100);
    expect(body.sites.length).toBeGreaterThan(0);
    expect(body.sites[0].siteName).toBeTruthy();
  });

  it('lists seeded bed requests including pending ones', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/beds/requests' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0].patient).toBeTruthy();
    expect(['routine', 'urgent', 'emergency']).toContain(body.items[0].priority);
  });

  it('rejects an invalid status filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/beds/requests?status=banana' });
    expect(res.statusCode).toBe(400);
  });

  it('creates a bed request for a real patient', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/beds/requests',
      payload: { patientId, specialty: 'Cardiology', priority: 'urgent' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.priority).toBe('urgent');
    expect(body.patient.id).toBe(patientId);
  });

  it('returns 404 when creating a request for an unknown patient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/beds/requests',
      payload: { patientId: 'does-not-exist', specialty: 'Cardiology' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('allocates an available bed to a pending request and occupies the bed', async () => {
    // Create a fresh pending request.
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[1].id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/beds/requests',
      payload: { patientId, specialty: 'General Medicine' },
    });
    const requestId = created.json().id;

    // Find an available bed from the board.
    const board = await app.inject({ method: 'GET', url: '/api/beds/board' });
    const availableBed = board
      .json()
      .wards.flatMap((w: { beds: { id: string; status: string }[] }) => w.beds)
      .find((b: { status: string }) => b.status === 'available');
    expect(availableBed).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: `/api/beds/requests/${requestId}/allocate`,
      payload: { bedId: availableBed.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.request.status).toBe('allocated');
    expect(body.request.allocatedBed.reference).toBe(`Location/${availableBed.id}`);
    expect(body.bed.operationalStatus).toBe('occupied');
  });

  it('rejects allocating to a non-existent request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/beds/requests/nope/allocate',
      payload: { bedId: 'whatever' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects allocating an occupied bed', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[2].id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/beds/requests',
      payload: { patientId, specialty: 'General Medicine' },
    });
    const requestId = created.json().id;

    const board = await app.inject({ method: 'GET', url: '/api/beds/board' });
    const occupiedBed = board
      .json()
      .wards.flatMap((w: { beds: { id: string; status: string }[] }) => w.beds)
      .find((b: { status: string }) => b.status === 'occupied');
    expect(occupiedBed).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: `/api/beds/requests/${requestId}/allocate`,
      payload: { bedId: occupiedBed.id },
    });
    expect(res.statusCode).toBe(400);
  });
});
