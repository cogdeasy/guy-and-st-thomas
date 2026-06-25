import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface ChartResponse {
  patient: { id: string };
  allergies: Array<{ code?: { text?: string } }>;
  counts: { active: number; regular: number; prn: number; stat: number };
  groups: {
    regular: Array<{ id: string; status: string }>;
    prn: Array<{ id: string; dosageInstruction: Array<{ asNeeded: boolean }> }>;
    stat: Array<{ id: string }>;
  };
}

interface WorklistResponse {
  total: number;
  items: Array<{
    patient: { id: string };
    counts: { active: number; prn: number };
    allergyCount: number;
  }>;
}

describe('eprescribing module', () => {
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
    expect(ids).toContain('eprescribing');
  });

  it('exposes the inpatient formulary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/eprescribing/formulary' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.drugs.length).toBeGreaterThan(0);
    expect(body.drugs.map((d: { display: string }) => d.display)).toContain('Amoxicillin');
  });

  it('seeds prescriptions onto admitted patients, including at least one PRN', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/eprescribing/worklist' });
    expect(res.statusCode).toBe(200);
    const worklist = res.json() as WorklistResponse;
    expect(worklist.total).toBeGreaterThan(0);
    const totalPrn = worklist.items.reduce((sum, i) => sum + i.counts.prn, 0);
    expect(totalPrn).toBeGreaterThan(0);
  });

  it('returns a drug chart grouped by regular / PRN / stat', async () => {
    const worklist = (
      await app.inject({ method: 'GET', url: '/api/eprescribing/worklist' })
    ).json() as WorklistResponse;
    const patientId = worklist.items[0]!.patient.id;

    const res = await app.inject({ method: 'GET', url: `/api/eprescribing/chart/${patientId}` });
    expect(res.statusCode).toBe(200);
    const chart = res.json() as ChartResponse;
    expect(chart.patient.id).toBe(patientId);
    expect(chart.counts.active).toBe(
      chart.groups.regular.length + chart.groups.prn.length + chart.groups.stat.length,
    );
    chart.groups.prn.forEach((m) => expect(m.dosageInstruction[0]?.asNeeded).toBe(true));
  });

  it('404s the chart for an unknown patient', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/eprescribing/chart/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('prescribes a medication and writes it to the chart', async () => {
    const worklist = (
      await app.inject({ method: 'GET', url: '/api/eprescribing/worklist' })
    ).json() as WorklistResponse;
    const patientId = worklist.items[0]!.patient.id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/eprescribing/prescribe',
      payload: {
        patientId,
        drugCode: '387137007', // Omeprazole
        dose: '20 mg',
        route: 'Oral',
        frequency: 'OD',
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().medicationRequest;
    expect(created.medication.text).toBe('Omeprazole');
    expect(created.status).toBe('active');

    const chart = (
      await app.inject({ method: 'GET', url: `/api/eprescribing/chart/${patientId}` })
    ).json() as ChartResponse;
    expect(chart.groups.regular.some((m) => m.id === created.id)).toBe(true);
  });

  it('rejects an invalid prescription body', async () => {
    const worklist = (
      await app.inject({ method: 'GET', url: '/api/eprescribing/worklist' })
    ).json() as WorklistResponse;
    const patientId = worklist.items[0]!.patient.id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/eprescribing/prescribe',
      payload: { patientId, drugCode: '387137007', dose: '', route: 'Spaceship', frequency: 'OD' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('blocks a contraindicated prescription unless the allergy is acknowledged', async () => {
    // Find a patient with an active Penicillin allergy.
    const allergyRes = await app.inject({ method: 'GET', url: '/api/fhir/AllergyIntolerance' });
    const entries = allergyRes.json().entry as Array<{
      patient?: { reference?: string };
      code?: { text?: string };
      clinicalStatus: string;
    }>;
    const penicillin = entries.find(
      (e) => e.code?.text === 'Penicillin' && e.clinicalStatus === 'active',
    );
    expect(penicillin).toBeTruthy();
    const patientId = penicillin!.patient!.reference!.split('/')[1]!;

    // Live allergy check flags it.
    const check = await app.inject({
      method: 'POST',
      url: '/api/eprescribing/allergy-check',
      payload: { patientId, drugCode: '27658006' }, // Amoxicillin (penicillin class)
    });
    expect(check.statusCode).toBe(200);
    expect(check.json().warnings.length).toBeGreaterThan(0);

    // Prescribing without acknowledgement is blocked (only when high criticality).
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/eprescribing/prescribe',
      payload: { patientId, drugCode: '27658006', dose: '500 mg', route: 'Oral', frequency: 'TDS' },
    });

    if (blocked.statusCode === 409) {
      expect(blocked.json().code).toBe('allergy_contraindication');
      const overridden = await app.inject({
        method: 'POST',
        url: '/api/eprescribing/prescribe',
        payload: {
          patientId,
          drugCode: '27658006',
          dose: '500 mg',
          route: 'Oral',
          frequency: 'TDS',
          acknowledgeAllergy: true,
        },
      });
      expect(overridden.statusCode).toBe(201);
      expect(overridden.json().allergyWarnings.length).toBeGreaterThan(0);
    } else {
      // Low-criticality allergy → allowed but still returns a caution warning.
      expect(blocked.statusCode).toBe(201);
      expect(blocked.json().allergyWarnings.length).toBeGreaterThan(0);
    }
  });

  it('discontinues an active medication and moves it out of the active chart', async () => {
    const worklist = (
      await app.inject({ method: 'GET', url: '/api/eprescribing/worklist' })
    ).json() as WorklistResponse;
    const patientId = worklist.items[0]!.patient.id;
    const chart = (
      await app.inject({ method: 'GET', url: `/api/eprescribing/chart/${patientId}` })
    ).json() as ChartResponse;
    const target = chart.groups.regular[0] ?? chart.groups.prn[0] ?? chart.groups.stat[0];
    expect(target).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: `/api/eprescribing/${target!.id}/discontinue`,
      payload: { reason: 'Course completed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().medicationRequest.status).toBe('stopped');

    const after = (
      await app.inject({ method: 'GET', url: `/api/eprescribing/chart/${patientId}` })
    ).json() as ChartResponse;
    const stillActive = [
      ...after.groups.regular,
      ...after.groups.prn,
      ...after.groups.stat,
    ].some((m) => m.id === target!.id);
    expect(stillActive).toBe(false);
  });
});
