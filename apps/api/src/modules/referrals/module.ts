import { z } from 'zod';
import { SPECIALTIES, type Patient, type Practitioner } from '@trustos/ontology';
import { BadRequest, isoDaysAgo, nowIso, pick, randInt, ref } from '@trustos/core';
import { defineModule } from '../types';
import { RTT_TARGET_WEEKS, isClockStopped, rttDays, toRttView } from './rtt';

/** A custom (non-ontology) collection owned by this module. */
const REFERRAL = 'Referral';

export const ReferralPriority = z.enum(['routine', 'urgent', '2ww']);
export type ReferralPriority = z.infer<typeof ReferralPriority>;

export const ReferralStatus = z.enum(['received', 'triaged', 'booked', 'treated', 'discharged']);
export type ReferralStatus = z.infer<typeof ReferralStatus>;

const ReferenceSchema = z.object({
  reference: z.string().min(1),
  display: z.string().optional(),
});

const TriageSchema = z.object({
  outcome: z.enum(['accepted', 'rejected', 'redirected', 'advice-and-guidance']),
  triagedBy: z.string().optional(),
  triagedAt: z.string(),
  notes: z.string().optional(),
});

const HistoryEntrySchema = z.object({
  status: ReferralStatus,
  at: z.string(),
  note: z.string().optional(),
});

/** Validator for the Referral collection (also documents its shape). */
const ReferralSchema = z
  .object({
    id: z.string(),
    resourceType: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
    patient: ReferenceSchema,
    referrer: ReferenceSchema.optional(),
    fromSpecialty: z.string().min(1),
    toSpecialty: z.string().min(1),
    priority: ReferralPriority,
    reason: z.string().min(1),
    clockStart: z.string(),
    clockStop: z.string().optional(),
    status: ReferralStatus,
    triage: TriageSchema.optional(),
    history: z.array(HistoryEntrySchema).default([]),
  })
  .passthrough();
export type Referral = z.infer<typeof ReferralSchema>;

/** Body accepted by POST /refer to create a new referral. */
const ReferBody = z.object({
  patientId: z.string().min(1),
  fromSpecialty: z.string().min(1).default('General Practice'),
  toSpecialty: z.string().min(1),
  priority: ReferralPriority.default('routine'),
  reason: z.string().min(1),
  referrerId: z.string().optional(),
  /** Optional backdated clock start (ISO date); defaults to now. */
  clockStart: z.string().optional(),
});

const TriageBody = z.object({
  outcome: z.enum(['accepted', 'rejected', 'redirected', 'advice-and-guidance']),
  triagedBy: z.string().optional(),
  notes: z.string().optional(),
  /** When redirecting, the specialty the pathway is being sent to. */
  toSpecialty: z.string().optional(),
});

const StatusBody = z.object({
  status: ReferralStatus,
  note: z.string().optional(),
});

/** Legal forward transitions for the referral state machine. */
const TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  received: ['triaged', 'discharged'],
  triaged: ['booked', 'discharged'],
  booked: ['treated', 'discharged'],
  treated: ['discharged'],
  discharged: [],
};

/**
 * Referrals & RTT (18-week) — referral management with Referral-To-Treatment
 * clock tracking. Builds workflow endpoints (worklist with computed breach
 * risk, triage and status transitions, RTT performance metrics) on top of a
 * custom `Referral` collection attached to core Patients.
 */
export default defineModule({
  id: 'referrals',
  name: 'Referrals & RTT (18-week)',
  description: 'Referral management with 18-week Referral-To-Treatment clock and breach tracking.',

  collections: [{ name: REFERRAL, validator: (input) => ReferralSchema.parse(input) }],

  routes(app, { store }) {
    const getReferral = (id: string): Referral => store.getOrThrow<Referral>(REFERRAL, id);

    // RTT worklist: every referral decorated with weeks elapsed + breach risk,
    // newest-breaching first. Optional filters by status / priority / specialty.
    app.get<{ Querystring: { status?: string; priority?: string; specialty?: string } }>(
      '/worklist',
      async (req) => {
        const { status, priority, specialty } = req.query;
        const now = new Date();
        const all = store.list<Referral>(REFERRAL).map((r) => toRttView(r, now));

        let items = all;
        if (status) items = items.filter((r) => r.status === status);
        if (priority) items = items.filter((r) => r.priority === priority);
        if (specialty) items = items.filter((r) => r.toSpecialty === specialty);
        items = [...items].sort((a, b) => b.daysElapsed - a.daysElapsed);

        // Summary always reflects global totals so the dashboard stays stable
        // regardless of the active worklist filters.
        const open = all.filter((r) => !r.clockStopped);
        return {
          total: all.length,
          filtered: items.length,
          open: open.length,
          breaches: open.filter((r) => r.breached).length,
          twoWeekWait: open.filter((r) => r.is2ww).length,
          targetWeeks: RTT_TARGET_WEEKS,
          items,
        };
      },
    );

    // RTT performance summary for the dashboard tiles + per-specialty table.
    app.get('/metrics', async () => {
      const now = new Date();
      const all = store.list<Referral>(REFERRAL);
      const open = all.filter((r) => !isClockStopped(r.status));
      const withinTarget = open.filter((r) => rttDays(r, now) < RTT_TARGET_WEEKS * 7);
      const breaches = open.length - withinTarget.length;
      const performance = open.length ? Math.round((withinTarget.length / open.length) * 1000) / 10 : 100;

      const twoWeekWait = open.filter((r) => r.priority === '2ww');
      const twoWeekWaitBreaches = twoWeekWait.filter((r) => rttDays(r, now) > 14).length;

      const bySpecialty = Object.values(
        open.reduce<Record<string, { specialty: string; total: number; breaches: number }>>((acc, r) => {
          const key = r.toSpecialty;
          const bucket = acc[key] ?? { specialty: key, total: 0, breaches: 0 };
          bucket.total += 1;
          if (rttDays(r, now) >= RTT_TARGET_WEEKS * 7) bucket.breaches += 1;
          acc[key] = bucket;
          return acc;
        }, {}),
      ).sort((a, b) => b.breaches - a.breaches || b.total - a.total);

      return {
        targetWeeks: RTT_TARGET_WEEKS,
        totalReferrals: all.length,
        openPathways: open.length,
        withinTarget: withinTarget.length,
        breaches,
        performance,
        twoWeekWait: twoWeekWait.length,
        twoWeekWaitBreaches,
        bySpecialty,
      };
    });

    // Single referral with its computed RTT view.
    app.get<{ Params: { id: string } }>('/:id', async (req) => {
      return toRttView(getReferral(req.params.id));
    });

    // Create a referral and start the RTT clock.
    app.post<{ Body: unknown }>('/refer', async (req, reply) => {
      const body = ReferBody.parse(req.body);
      const patient = store.getOrThrow<Patient>('Patient', body.patientId);
      const name = patient.name?.[0];
      const patientDisplay = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();

      let referrer: { reference: string; display?: string } | undefined;
      if (body.referrerId) {
        const practitioner = store.getOrThrow<Practitioner>('Practitioner', body.referrerId);
        const pn = practitioner.name?.[0];
        referrer = {
          reference: ref('Practitioner', practitioner.id),
          display: `${pn?.prefix?.join(' ') ?? ''} ${pn?.given?.join(' ') ?? ''} ${pn?.family ?? ''}`.trim(),
        };
      }

      const clockStart = body.clockStart ?? nowIso();
      const created = store.create<Referral>(REFERRAL, {
        patient: { reference: ref('Patient', patient.id), display: patientDisplay },
        referrer,
        fromSpecialty: body.fromSpecialty,
        toSpecialty: body.toSpecialty,
        priority: body.priority,
        reason: body.reason,
        clockStart,
        status: 'received',
        history: [{ status: 'received', at: nowIso(), note: 'Referral received' }],
      });
      reply.code(201);
      return created;
    });

    // Triage a received referral.
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/triage', async (req) => {
      const body = TriageBody.parse(req.body);
      const referral = getReferral(req.params.id);
      if (referral.status !== 'received') {
        throw BadRequest(`Cannot triage a referral in status '${referral.status}'`);
      }
      const triagedAt = nowIso();
      const nextStatus: ReferralStatus = body.outcome === 'rejected' ? 'discharged' : 'triaged';
      return store.update<Referral>(REFERRAL, referral.id, {
        status: nextStatus,
        toSpecialty: body.toSpecialty ?? referral.toSpecialty,
        clockStop: nextStatus === 'discharged' ? triagedAt : referral.clockStop,
        triage: { outcome: body.outcome, triagedBy: body.triagedBy, triagedAt, notes: body.notes },
        history: [
          ...referral.history,
          { status: nextStatus, at: triagedAt, note: `Triaged: ${body.outcome}` },
        ],
      });
    });

    // Advance the referral along the RTT pathway.
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/status', async (req) => {
      const body = StatusBody.parse(req.body);
      const referral = getReferral(req.params.id);
      const allowed = TRANSITIONS[referral.status];
      if (!allowed.includes(body.status)) {
        throw BadRequest(
          `Illegal transition '${referral.status}' -> '${body.status}'. Allowed: ${
            allowed.join(', ') || 'none'
          }`,
        );
      }
      const at = nowIso();
      return store.update<Referral>(REFERRAL, referral.id, {
        status: body.status,
        // Preserve an earlier clock-stop (e.g. the treatment date) when a
        // treated pathway is later discharged — don't overwrite it.
        clockStop: isClockStopped(body.status) ? (referral.clockStop ?? at) : referral.clockStop,
        history: [...referral.history, { status: body.status, at, note: body.note }],
      });
    });
  },

  // ~20 referrals with clock starts spread 0–22 weeks ago across specialties,
  // some already breaching, all driven by the injected seeded rng.
  seed({ store, rng }) {
    const patients = store.list<Patient>('Patient');
    const practitioners = store.list<Practitioner>('Practitioner');
    if (patients.length === 0) return;

    const referralSpecialties = SPECIALTIES.filter(
      (s) => !['Anaesthetics', 'Radiology', 'Pathology', 'Pharmacy'].includes(s),
    );
    const fromSpecialties = ['General Practice', 'Emergency Medicine', 'General Medicine', 'General Surgery'];
    const priorities: ReferralPriority[] = ['routine', 'routine', 'routine', 'urgent', 'urgent', '2ww'];
    const reasonsBySpecialty: Record<string, string[]> = {
      default: [
        'For specialist assessment and management',
        'Diagnostic uncertainty — please advise',
        'Failed first-line treatment in primary care',
        'New symptoms requiring secondary care review',
      ],
      Cardiology: ['Exertional chest pain, abnormal ECG', 'New atrial fibrillation', 'Suspected heart failure'],
      Oncology: ['Suspected malignancy — urgent review', 'Abnormal imaging, ?neoplasm'],
      Dermatology: ['Suspicious pigmented lesion', 'Chronic treatment-resistant eczema'],
      Orthopaedics: ['Mechanical knee pain, locking', 'Hip OA, considering arthroplasty'],
      Gastroenterology: ['Iron-deficiency anaemia for investigation', 'Altered bowel habit'],
    };

    for (let i = 0; i < 20; i++) {
      const patient = pick(patients, rng);
      const toSpecialty = pick(referralSpecialties, rng);
      const priority = pick(priorities, rng);
      const reasons = reasonsBySpecialty[toSpecialty] ?? reasonsBySpecialty.default;
      const reason = pick(reasons ?? [], rng) ?? 'For specialist assessment and management';
      const weeksAgo = randInt(0, 22, rng);
      const clockStart = isoDaysAgo(weeksAgo * 7 + randInt(0, 6, rng));

      const name = patient.name?.[0];
      const patientDisplay = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
      const referrer = practitioners.length ? pick(practitioners, rng) : undefined;
      const referrerName = referrer?.name?.[0];

      // Drive a plausible status from how long the pathway has been open.
      const roll = rng();
      let status: ReferralStatus = 'received';
      if (weeksAgo >= 1) status = 'triaged';
      if (weeksAgo >= 6 && roll > 0.35) status = 'booked';
      if (weeksAgo >= 12 && roll > 0.6) status = 'treated';
      if (weeksAgo >= 16 && roll > 0.85) status = 'discharged';

      const history: Referral['history'] = [{ status: 'received', at: clockStart, note: 'Referral received' }];
      let clockStop: string | undefined;
      if (status !== 'received') {
        history.push({ status: 'triaged', at: isoDaysAgo(weeksAgo * 7 - 3), note: 'Triaged: accepted' });
      }
      if (status === 'booked' || status === 'treated' || status === 'discharged') {
        history.push({ status: 'booked', at: isoDaysAgo(Math.max(0, weeksAgo * 7 - 14)), note: 'Appointment booked' });
      }
      if (status === 'treated' || status === 'discharged') {
        clockStop = isoDaysAgo(Math.max(0, weeksAgo * 7 - 21));
        history.push({ status: 'treated', at: clockStop, note: 'First definitive treatment' });
      }
      if (status === 'discharged') {
        // RTT clock stops at first treatment; discharge is later and must not
        // overwrite the treatment-date clock-stop set above.
        const dischargedAt = isoDaysAgo(Math.max(0, weeksAgo * 7 - 28));
        history.push({ status: 'discharged', at: dischargedAt, note: 'Discharged to primary care' });
      }

      const triage: Referral['triage'] =
        status === 'received'
          ? undefined
          : {
              outcome: 'accepted',
              triagedAt: isoDaysAgo(weeksAgo * 7 - 3),
              notes: 'Accepted onto pathway',
            };

      store.create<Referral>(REFERRAL, {
        patient: { reference: ref('Patient', patient.id), display: patientDisplay },
        referrer: referrer
          ? {
              reference: ref('Practitioner', referrer.id),
              display: `${referrerName?.prefix?.join(' ') ?? ''} ${referrerName?.given?.join(' ') ?? ''} ${
                referrerName?.family ?? ''
              }`.trim(),
            }
          : undefined,
        fromSpecialty: pick(fromSpecialties, rng),
        toSpecialty,
        priority,
        reason,
        clockStart,
        clockStop,
        status,
        triage,
        history,
      });
    }
  },
});
