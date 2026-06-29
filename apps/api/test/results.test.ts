import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

interface InboxItem {
  reportId: string;
  abnormal: boolean;
  criticalCount: number;
  worstInterpretation: string;
  acknowledged: boolean;
  patient: { id: string; name: string } | null;
}

describe('results module', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await buildApp({ logger: false, seed: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the results module', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/modules' });
    expect(res.statusCode).toBe(200);
    const ids = res.json().modules.map((m: { id: string }) => m.id);
    expect(ids).toContain('results');
  });

  it('seeds diagnostic reports with child observations', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fhir/DiagnosticReport' });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry.length).toBeGreaterThanOrEqual(10);
  });

  it('returns an inbox of unacknowledged results that flags abnormal findings', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/results/inbox' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; items: InboxItem[] };
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.every((i) => !i.acknowledged)).toBe(true);
    expect(body.items.some((i) => i.abnormal)).toBe(true);
    // Worst-first ordering: the first item is at least as severe as the last.
    const severity = (s: string) => (s === 'critical' ? 3 : s === 'normal' ? 0 : 2);
    expect(severity(body.items[0]!.worstInterpretation)).toBeGreaterThanOrEqual(
      severity(body.items[body.items.length - 1]!.worstInterpretation),
    );
  });

  it('exposes headline stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/results/stats' });
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.unacknowledged).toBeGreaterThan(0);
    expect(stats.abnormal).toBeGreaterThan(0);
  });

  it('returns a report with observations and reference ranges', async () => {
    const inbox = await app.inject({ method: 'GET', url: '/api/results/inbox' });
    const lab = (inbox.json().items as InboxItem[]).find((i) => i.worstInterpretation !== 'normal');
    const target = lab ?? (inbox.json().items as InboxItem[])[0]!;

    const res = await app.inject({ method: 'GET', url: `/api/results/report/${target.reportId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.report.id).toBe(target.reportId);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.acknowledged).toBe(false);
  });

  it('404s for an unknown report', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/results/report/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('acknowledges a result and creates a follow-up task', async () => {
    const inbox = await app.inject({ method: 'GET', url: '/api/results/inbox' });
    const reportId = (inbox.json().items as InboxItem[])[0]!.reportId;

    const ack = await app.inject({
      method: 'POST',
      url: `/api/results/${reportId}/acknowledge`,
      payload: {
        acknowledgedBy: 'Dr Test Reviewer',
        note: 'Reviewed, repeat bloods in the morning.',
        createFollowUpTask: true,
        followUp: { description: 'Repeat U&E in 12 hours', priority: 'urgent' },
      },
    });
    expect(ack.statusCode).toBe(201);
    const body = ack.json();
    expect(body.acknowledgement.acknowledgedBy).toBe('Dr Test Reviewer');
    expect(body.task).toBeTruthy();
    expect(body.task.code).toBe('review-result');

    // The follow-up Task is persisted as a core resource.
    const task = await app.inject({ method: 'GET', url: `/api/fhir/Task/${body.task.id}` });
    expect(task.statusCode).toBe(200);

    // The report now drops out of the unacknowledged inbox.
    const after = await app.inject({ method: 'GET', url: '/api/results/inbox' });
    expect((after.json().items as InboxItem[]).some((i) => i.reportId === reportId)).toBe(false);

    // The report detail reflects the acknowledgement.
    const detail = await app.inject({ method: 'GET', url: `/api/results/report/${reportId}` });
    expect(detail.json().acknowledged).toBe(true);
  });

  it('rejects acknowledging the same report twice', async () => {
    const inbox = await app.inject({ method: 'GET', url: '/api/results/inbox' });
    const reportId = (inbox.json().items as InboxItem[])[0]!.reportId;

    const first = await app.inject({
      method: 'POST',
      url: `/api/results/${reportId}/acknowledge`,
      payload: { acknowledgedBy: 'Dr First' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/api/results/${reportId}/acknowledge`,
      payload: { acknowledgedBy: 'Dr Second' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('validates the acknowledge body', async () => {
    const inbox = await app.inject({ method: 'GET', url: '/api/results/inbox' });
    const reportId = (inbox.json().items as InboxItem[])[0]!.reportId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/results/${reportId}/acknowledge`,
      payload: { note: 'missing acknowledgedBy' },
    });
    expect(res.statusCode).toBe(400);
  });
});
