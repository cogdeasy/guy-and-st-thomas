import { z } from 'zod';
import { CodeSystems, type DiagnosticReport, type Encounter, type Observation, type Patient, type Task } from '@trustos/ontology';
import { BadRequest, Conflict, nowIso, ref } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore, Entity } from '../../store/store';
import { type ResultFlag, FLAG_SEVERITY } from './catalog';
import { seedResults } from './seed';

/** A normalised single result row derived from a child Observation. */
interface ResultRow {
  observationId: string;
  code?: string;
  value: number | string | null;
  unit?: string;
  interpretation: ResultFlag;
  abnormal: boolean;
  referenceRangeText?: string;
  effectiveDateTime?: string;
}

interface ReportSummary {
  reportId: string;
  code?: string;
  category?: string;
  status: string;
  issued?: string;
  effectiveDateTime?: string;
  patient: { id: string; name: string } | null;
  performer?: string;
  resultCount: number;
  abnormalCount: number;
  criticalCount: number;
  worstInterpretation: ResultFlag;
  abnormal: boolean;
  acknowledged: boolean;
}

/** Acknowledgement records own no core resource type, so use a custom collection. */
const AcknowledgementSchema = z.object({
  id: z.string(),
  resourceType: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  report: z.string().describe('DiagnosticReport reference'),
  subject: z.string().optional().describe('Patient reference'),
  acknowledgedBy: z.string(),
  acknowledgedAt: z.string(),
  note: z.string().optional(),
  followUpTaskId: z.string().optional(),
});

const AcknowledgeBody = z.object({
  acknowledgedBy: z.string().min(1, 'acknowledgedBy is required'),
  note: z.string().max(1000).optional(),
  createFollowUpTask: z.boolean().default(false),
  followUp: z
    .object({
      description: z.string().min(1),
      priority: z.enum(['routine', 'urgent', 'asap', 'stat']).default('routine'),
      owner: z.string().optional(),
    })
    .optional(),
});

/**
 * Results & Reporting — clinical results acknowledgement and review.
 *
 * Builds workflow endpoints on top of the core DiagnosticReport / Observation
 * resources: an unacknowledged-results inbox with abnormal/critical flagging, a
 * composite report view (values vs reference ranges) and a sign-off transition
 * that can spawn a core follow-up Task.
 */
export default defineModule({
  id: 'results',
  name: 'Results & Reporting',
  description: 'Diagnostic results inbox, abnormal-result review and clinician sign-off.',

  collections: [{ name: 'ResultAcknowledgement', validator: (input) => AcknowledgementSchema.parse(input) as Entity }],

  routes(app, { store }) {
    // Headline KPIs for the inbox dashboard.
    app.get('/stats', async () => {
      const reports = store.list<DiagnosticReport>('DiagnosticReport');
      let abnormal = 0;
      let critical = 0;
      let unacknowledged = 0;
      for (const report of reports) {
        const summary = summarise(store, report);
        if (!summary.acknowledged) unacknowledged += 1;
        if (summary.abnormal) abnormal += 1;
        if (summary.criticalCount > 0) critical += 1;
      }
      return { total: reports.length, unacknowledged, abnormal, critical };
    });

    // Inbox of results awaiting clinician acknowledgement (abnormal highlighted).
    app.get<{ Querystring: { includeAcknowledged?: string } }>('/inbox', async (req) => {
      const includeAcknowledged = req.query.includeAcknowledged === 'true';
      const items = store
        .list<DiagnosticReport>('DiagnosticReport')
        .map((report) => summarise(store, report))
        .filter((s) => includeAcknowledged || !s.acknowledged)
        .sort((a, b) => {
          const sev = FLAG_SEVERITY[b.worstInterpretation] - FLAG_SEVERITY[a.worstInterpretation];
          if (sev !== 0) return sev;
          return (b.issued ?? '').localeCompare(a.issued ?? '');
        });
      return { total: items.length, items };
    });

    // Composite report: all result observations with reference ranges + flags.
    app.get<{ Params: { id: string } }>('/report/:id', async (req) => {
      const report = store.getOrThrow<DiagnosticReport>('DiagnosticReport', req.params.id);
      const patient = subjectPatient(store, report);
      const encounter = report.encounter?.reference
        ? store.get<Encounter>('Encounter', report.encounter.reference.split('/')[1] ?? '')
        : undefined;
      const results = (report.result ?? [])
        .map((r) => store.get<Observation>('Observation', r.reference.split('/')[1] ?? ''))
        .filter((o): o is Observation => Boolean(o))
        .map(toResultRow);
      const acknowledgement = findAcknowledgement(store, report.id);

      return {
        report,
        patient: patient ? { id: patient.id, name: patientName(patient), birthDate: patient.birthDate, gender: patient.gender, nhsNumber: nhsNumber(patient) } : null,
        encounter: encounter ? { id: encounter.id, specialty: encounter.specialty, reasonText: encounter.reasonText } : null,
        results,
        abnormalCount: results.filter((r) => r.abnormal).length,
        criticalCount: results.filter((r) => r.interpretation === 'critical').length,
        worstInterpretation: worstOf(results),
        acknowledged: Boolean(acknowledgement),
        acknowledgement: acknowledgement ?? null,
      };
    });

    // Sign off a result, optionally raising a core follow-up Task.
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/acknowledge', async (req, reply) => {
      const report = store.getOrThrow<DiagnosticReport>('DiagnosticReport', req.params.id);
      const body = AcknowledgeBody.parse(req.body);
      if (findAcknowledgement(store, report.id)) {
        throw Conflict('Result has already been acknowledged');
      }
      if (body.createFollowUpTask && !body.followUp) {
        throw BadRequest('followUp details are required when createFollowUpTask is true');
      }

      const patient = subjectPatient(store, report);
      let task: Task | undefined;
      if (body.createFollowUpTask && body.followUp) {
        task = store.create<Task>('Task', {
          status: 'requested',
          intent: 'order',
          priority: body.followUp.priority,
          code: 'review-result',
          description: body.followUp.description,
          for: patient ? { reference: ref('Patient', patient.id), display: patientName(patient) } : undefined,
          owner: body.followUp.owner ? { reference: body.followUp.owner } : undefined,
          authoredOn: nowIso(),
        });
      }

      const acknowledgement = store.create('ResultAcknowledgement', {
        report: ref('DiagnosticReport', report.id),
        subject: patient ? ref('Patient', patient.id) : undefined,
        acknowledgedBy: body.acknowledgedBy,
        acknowledgedAt: nowIso(),
        note: body.note,
        followUpTaskId: task?.id,
      });

      reply.code(201);
      return { acknowledgement, task: task ?? null };
    });
  },

  seed(ctx) {
    seedResults(ctx);
  },
});

function summarise(store: DataStore, report: DiagnosticReport): ReportSummary {
  const patient = subjectPatient(store, report);
  const performer = report.performer?.display;
  const rows = (report.result ?? [])
    .map((r) => store.get<Observation>('Observation', r.reference.split('/')[1] ?? ''))
    .filter((o): o is Observation => Boolean(o))
    .map(toResultRow);
  return {
    reportId: report.id,
    code: report.code?.text ?? report.code?.coding?.[0]?.display,
    category: report.category,
    status: report.status,
    issued: report.issued,
    effectiveDateTime: report.effectiveDateTime,
    patient: patient ? { id: patient.id, name: patientName(patient) } : null,
    performer,
    resultCount: rows.length,
    abnormalCount: rows.filter((r) => r.abnormal).length,
    criticalCount: rows.filter((r) => r.interpretation === 'critical').length,
    worstInterpretation: worstOf(rows),
    abnormal: rows.some((r) => r.abnormal),
    acknowledged: Boolean(findAcknowledgement(store, report.id)),
  };
}

function toResultRow(obs: Observation): ResultRow {
  const interpretation = (obs.interpretation ?? 'normal') as ResultFlag;
  return {
    observationId: obs.id,
    code: obs.code?.text ?? obs.code?.coding?.[0]?.display,
    value: obs.valueQuantity?.value ?? obs.valueString ?? null,
    unit: obs.valueQuantity?.unit,
    interpretation,
    abnormal: interpretation !== 'normal',
    referenceRangeText: obs.referenceRangeText,
    effectiveDateTime: obs.effectiveDateTime,
  };
}

function worstOf(rows: ResultRow[]): ResultFlag {
  return rows.reduce<ResultFlag>(
    (worst, row) => (FLAG_SEVERITY[row.interpretation] > FLAG_SEVERITY[worst] ? row.interpretation : worst),
    'normal',
  );
}

function findAcknowledgement(store: DataStore, reportId: string) {
  return store.query<Entity & { report: string }>(
    'ResultAcknowledgement',
    (a) => a.report === ref('DiagnosticReport', reportId),
  )[0];
}

function subjectPatient(store: DataStore, report: DiagnosticReport): Patient | undefined {
  const id = report.subject?.reference?.split('/')[1];
  return id ? store.get<Patient>('Patient', id) : undefined;
}

function patientName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}

function nhsNumber(patient: Patient): string | undefined {
  return patient.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value;
}
