import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

describe('scheduling module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the scheduling module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('scheduling');
  });

  it('seeds clinic sessions with slots and utilisation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scheduling/clinics?range=all' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clinics.length).toBeGreaterThan(0);
    expect(body.totals.capacity).toBeGreaterThan(0);
    expect(body.totals.booked).toBeGreaterThan(0);
    expect(body.totals.utilisation).toBeGreaterThan(0);
    expect(body.totals.utilisation).toBeLessThanOrEqual(1);
    const clinic = body.clinics[0];
    expect(clinic.specialty).toBeTruthy();
    expect(clinic.clinician.display).toBeTruthy();
    expect(clinic.slots.length).toBe(clinic.capacity);
    expect(body.bySpecialty.length).toBeGreaterThan(0);
  });

  it('exposes a clinic detail with a slot grid joined to patients', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/scheduling/clinics?range=all' });
    const clinicId = list.json().clinics[0].id;
    const res = await app.inject({ method: 'GET', url: `/api/scheduling/clinics/${clinicId}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.slots.length).toBe(detail.capacity);
    const booked = detail.slots.find((s: { appointment: unknown }) => s.appointment);
    expect(booked.appointment.patient).toBeTruthy();
    expect(booked.appointment.patient.name).toBeTruthy();
  });

  it('returns 404 for an unknown clinic', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scheduling/clinics/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('lists appointments and filters by status', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/scheduling/appointments' });
    expect(all.statusCode).toBe(200);
    expect(all.json().total).toBeGreaterThan(0);

    const fulfilled = await app.inject({
      method: 'GET',
      url: '/api/scheduling/appointments?status=fulfilled',
    });
    expect(fulfilled.statusCode).toBe(200);
    for (const item of fulfilled.json().items) {
      expect(item.status).toBe('fulfilled');
    }
  });

  it('books a patient into a free slot and reflects it in utilisation', async () => {
    const clinics = await app.inject({ method: 'GET', url: '/api/scheduling/clinics?range=all' });
    const withFree = clinics.json().clinics.find((c: { free: number }) => c.free > 0);
    expect(withFree).toBeTruthy();

    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;

    const before = withFree.booked;
    const res = await app.inject({
      method: 'POST',
      url: '/api/scheduling/book',
      payload: { sessionId: withFree.id, patientId, reasonText: 'New referral' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.appointment.status).toBe('booked');
    expect(body.appointment.patient.id).toBe(patientId);
    expect(body.session.booked).toBe(before + 1);
  });

  it('rejects booking into an unknown clinic session', async () => {
    const patients = await app.inject({ method: 'GET', url: '/api/fhir/Patient' });
    const patientId = patients.json().entry[0].id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/scheduling/book',
      payload: { sessionId: 'nope', patientId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an invalid booking body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scheduling/book',
      payload: { patientId: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('transitions an appointment through attendance states', async () => {
    const booked = await app.inject({
      method: 'GET',
      url: '/api/scheduling/appointments?status=booked',
    });
    const appt = booked.json().items[0];
    expect(appt).toBeTruthy();

    const arrived = await app.inject({
      method: 'POST',
      url: `/api/scheduling/${appt.id}/status`,
      payload: { status: 'arrived' },
    });
    expect(arrived.statusCode).toBe(200);
    expect(arrived.json().status).toBe('arrived');

    const seen = await app.inject({
      method: 'POST',
      url: `/api/scheduling/${appt.id}/status`,
      payload: { status: 'seen' },
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.json().status).toBe('fulfilled');

    // 'fulfilled' is terminal — a further transition is rejected.
    const again = await app.inject({
      method: 'POST',
      url: `/api/scheduling/${appt.id}/status`,
      payload: { status: 'arrived' },
    });
    expect(again.statusCode).toBe(400);

    // Re-posting the current (terminal) status must also be rejected, so a
    // finalised appointment cannot be silently mutated via its note.
    const reseen = await app.inject({
      method: 'POST',
      url: `/api/scheduling/${appt.id}/status`,
      payload: { status: 'seen', note: 'override' },
    });
    expect(reseen.statusCode).toBe(400);
  });

  it('frees the slot when an appointment is cancelled', async () => {
    const clinics = await app.inject({ method: 'GET', url: '/api/scheduling/clinics?range=all' });
    const clinic = clinics
      .json()
      .clinics.find((c: { statusCounts: Record<string, number> }) => (c.statusCounts.booked ?? 0) > 0);
    expect(clinic).toBeTruthy();

    const detail = await app.inject({ method: 'GET', url: `/api/scheduling/clinics/${clinic.id}` });
    const slot = detail
      .json()
      .slots.find((s: { appointment: { status: string } | null }) => s.appointment?.status === 'booked');
    const freeBefore = clinic.free;

    const res = await app.inject({
      method: 'POST',
      url: `/api/scheduling/${slot.appointment.id}/status`,
      payload: { status: 'cancelled' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');

    const after = await app.inject({ method: 'GET', url: `/api/scheduling/clinics/${clinic.id}` });
    expect(after.json().free).toBe(freeBefore + 1);
  });

  it('returns 404 when transitioning an unknown appointment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/scheduling/missing/status',
      payload: { status: 'arrived' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('reports DNA and utilisation metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scheduling/metrics?range=all' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.capacity).toBeGreaterThan(0);
    expect(body.utilisation).toBeGreaterThan(0);
    expect(body.dnaRate).toBeGreaterThanOrEqual(0);
    expect(body.dnaRate).toBeLessThanOrEqual(1);
    expect(typeof body.byStatus).toBe('object');
    expect(body.bySpecialty.length).toBeGreaterThan(0);
  });
});
