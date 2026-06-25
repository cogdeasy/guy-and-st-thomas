import { z } from 'zod';
import type { Encounter, Patient, Practitioner } from '@trustos/ontology';
import { BadRequest, NotFound, ref } from '@trustos/core';
import { defineModule } from '../types';
import {
  breachInfo,
  canTransition,
  EdAttendanceSchema,
  EdStatusEnum,
  type EdAttendance,
  type EdStatus,
} from './triage';

const CHIEF_COMPLAINTS = [
  'Chest pain',
  'Shortness of breath',
  'Abdominal pain',
  'Head injury',
  'Fall',
  'Collapse ?cause',
  'Overdose',
  'Sepsis ?source',
  'Stroke symptoms',
  'Limb fracture',
  'Laceration',
  'Palpitations',
  'Severe headache',
  'Allergic reaction',
  'Mental health crisis',
];

const CUBICLES = [
  'Resus 1',
  'Resus 2',
  'Majors 1',
  'Majors 2',
  'Majors 3',
  'Majors 4',
  'Majors 5',
  'Minors 1',
  'Minors 2',
  'Minors 3',
];

const ENCOUNTER_STATUS: Record<EdStatus, Encounter['status']> = {
  waiting: 'arrived',
  triaged: 'triaged',
  'in-treatment': 'in-progress',
  'awaiting-bed': 'in-progress',
  discharged: 'finished',
};

function fullName(p?: { name?: Array<{ given?: string[]; family?: string }> }): string {
  const n = p?.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim();
}

export default defineModule({
  id: 'ed',
  name: 'Emergency Department Tracker',
  description: 'Live A&E whiteboard: triage, patient flow and the 4-hour standard.',

  collections: [{ name: 'EdAttendance', validator: (i) => EdAttendanceSchema.parse(i) }],

  routes(app, { store }) {
    /** Keep the linked emergency Encounter's status in step with the attendance. */
    const syncEncounterStatus = (att: EdAttendance, status: EdStatus, endIso?: string) => {
      if (!att.encounter) return;
      const encId = att.encounter.split('/')[1] ?? '';
      const enc = store.get<Encounter>('Encounter', encId);
      if (!enc) return;
      store.update<Encounter>('Encounter', encId, {
        status: ENCOUNTER_STATUS[status],
        ...(endIso
          ? { period: { ...enc.period, start: enc.period?.start ?? att.arrivalTime, end: endIso } }
          : {}),
      });
    };

    /** Enrich a stored attendance with patient/clinician detail and the breach clock. */
    const present = (att: EdAttendance, now: number) => {
      const patient = store.get<Patient>('Patient', att.patient.split('/')[1] ?? '');
      return {
        ...att,
        patientDisplay: att.patientName ?? fullName(patient),
        breach: breachInfo(att, now),
      };
    };

    // Live ED whiteboard: everyone currently in the department, most urgent /
    // most-breached first. Discharged attendances drop off the board.
    app.get('/board', async () => {
      const now = Date.now();
      const live = store
        .query<EdAttendance>('EdAttendance', (a) => a.status !== 'discharged')
        .map((a) => present(a, now))
        .sort((a, b) => {
          if (a.breach.breached !== b.breach.breached) return a.breach.breached ? -1 : 1;
          const acuityA = a.acuity ?? 6;
          const acuityB = b.acuity ?? 6;
          if (acuityA !== acuityB) return acuityA - acuityB;
          return a.arrivalTime.localeCompare(b.arrivalTime);
        });
      return { total: live.length, generatedAt: new Date(now).toISOString(), attendances: live };
    });

    // 4-hour performance and departmental headline metrics.
    app.get('/metrics', async () => {
      const now = Date.now();
      const all = store.list<EdAttendance>('EdAttendance');
      const inDept = all.filter((a) => a.status !== 'discharged');
      const breaches = inDept.filter((a) => breachInfo(a, now).breached);
      const withinFourHours = all.filter((a) => !breachInfo(a, now).breached).length;
      const performance = all.length === 0 ? 1 : withinFourHours / all.length;

      const byStatus = Object.fromEntries(
        EdStatusEnum.options.map((s) => [s, all.filter((a) => a.status === s).length]),
      ) as Record<EdStatus, number>;

      const awaitingTriage = all.filter((a) => a.status === 'waiting').length;
      const longestWait = inDept.reduce((max, a) => {
        const mins = breachInfo(a, now).elapsedMinutes;
        return mins > max ? mins : max;
      }, 0);

      return {
        totalInDepartment: inDept.length,
        totalAttendances: all.length,
        breaches: breaches.length,
        awaitingTriage,
        longestWaitMinutes: longestWait,
        fourHourPerformance: Number(performance.toFixed(4)),
        byStatus,
      };
    });

    // Register a new arrival: creates the emergency Encounter and attendance.
    const AttendBody = z.object({
      patientId: z.string().min(1),
      chiefComplaint: z.string().min(1),
      acuity: z.number().int().min(1).max(5).optional(),
      arrivalTime: z.string().datetime({ offset: true }).optional(),
    });
    app.post<{ Body: unknown }>('/attend', async (req, reply) => {
      const body = AttendBody.parse(req.body);
      const patient = store.get<Patient>('Patient', body.patientId);
      if (!patient) throw NotFound(`Patient/${body.patientId}`);

      const arrivalTime = body.arrivalTime ?? new Date().toISOString();
      const encounter = store.create<Encounter>('Encounter', {
        status: body.acuity ? 'triaged' : 'arrived',
        class: 'emergency',
        subject: { reference: ref('Patient', patient.id), display: fullName(patient) },
        period: { start: arrivalTime },
        reasonText: body.chiefComplaint,
        specialty: 'Emergency Medicine',
      });

      const attendance = store.create<EdAttendance>('EdAttendance', {
        patient: ref('Patient', patient.id),
        patientName: fullName(patient),
        encounter: ref('Encounter', encounter.id),
        arrivalTime,
        chiefComplaint: body.chiefComplaint,
        acuity: body.acuity ?? null,
        status: body.acuity ? 'triaged' : 'waiting',
        cubicle: 'Waiting Room',
        ...(body.acuity ? { triageTime: arrivalTime } : {}),
      });

      reply.code(201);
      return attendance;
    });

    // Triage: assign a Manchester acuity band and (optionally) a clinician/cubicle.
    const TriageBody = z.object({
      acuity: z.number().int().min(1).max(5),
      assignedClinicianId: z.string().optional(),
      cubicle: z.string().optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/triage', async (req) => {
      const existing = store.getOrThrow<EdAttendance>('EdAttendance', req.params.id);
      if (existing.status === 'discharged') {
        throw BadRequest('Cannot triage a discharged attendance');
      }
      const body = TriageBody.parse(req.body);

      const clinician = body.assignedClinicianId
        ? store.get<Practitioner>('Practitioner', body.assignedClinicianId)
        : undefined;
      if (body.assignedClinicianId && !clinician) {
        throw NotFound(`Practitioner/${body.assignedClinicianId}`);
      }

      const nextStatus: EdStatus = existing.status === 'waiting' ? 'triaged' : existing.status;
      const patch: Partial<EdAttendance> = {
        acuity: body.acuity,
        status: nextStatus,
        triageTime: existing.triageTime ?? new Date().toISOString(),
      };
      if (clinician) {
        patch.assignedClinician = ref('Practitioner', clinician.id);
        patch.assignedClinicianName = fullName(clinician);
      }
      if (body.cubicle) patch.cubicle = body.cubicle;

      if (nextStatus !== existing.status) syncEncounterStatus(existing, nextStatus);

      return store.update<EdAttendance>('EdAttendance', existing.id, patch);
    });

    // Advance an attendance through the patient-flow state machine.
    const StatusBody = z.object({
      status: EdStatusEnum,
      cubicle: z.string().optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/status', async (req) => {
      const existing = store.getOrThrow<EdAttendance>('EdAttendance', req.params.id);
      const body = StatusBody.parse(req.body);

      if (body.status !== existing.status && !canTransition(existing.status, body.status)) {
        throw BadRequest(
          `Illegal transition: ${existing.status} → ${body.status}`,
        );
      }

      const nowIso = new Date().toISOString();
      const patch: Partial<EdAttendance> = { status: body.status };
      if (body.cubicle) patch.cubicle = body.cubicle;
      if (body.status === 'in-treatment' && !existing.treatmentStartTime) {
        patch.treatmentStartTime = nowIso;
      }
      // Stamp the discharge time once, so a repeated discharge POST is idempotent.
      const dischargeIso =
        body.status === 'discharged' ? (existing.dischargeTime ?? nowIso) : undefined;
      if (dischargeIso && !existing.dischargeTime) patch.dischargeTime = dischargeIso;

      if (body.status !== existing.status) syncEncounterStatus(existing, body.status, dischargeIso);

      return store.update<EdAttendance>('EdAttendance', existing.id, patch);
    });
  },

  seed({ store, rng }) {
    const patients = store.list<Patient>('Patient');
    const practitioners = store.list<Practitioner>('Practitioner');
    if (patients.length === 0) return;

    const edClinicians = practitioners.filter((p) => p.specialty === 'Emergency Medicine');
    const clinicianPool = edClinicians.length > 0 ? edClinicians : practitioners;

    // Fisher-Yates shuffle through the seeded rng for reproducible, unique picks.
    const shuffled = [...patients];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j] as Patient, shuffled[i] as Patient];
    }

    const statuses: EdStatus[] = [
      'waiting',
      'waiting',
      'triaged',
      'triaged',
      'in-treatment',
      'in-treatment',
      'awaiting-bed',
      'discharged',
    ];
    const count = Math.min(15, shuffled.length);
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const patient = shuffled[i] as Patient;
      const status = statuses[Math.floor(rng() * statuses.length)] as EdStatus;
      // Arrivals spread across the last ~5 hours; some breach the 4-hour clock.
      const arrivalMinAgo = 15 + Math.floor(rng() * 285);
      const arrivalTime = new Date(now - arrivalMinAgo * 60000).toISOString();
      const acuity = status === 'waiting' ? null : 1 + Math.floor(rng() * 5);

      const encounter = store.create<Encounter>('Encounter', {
        status: ENCOUNTER_STATUS[status],
        class: 'emergency',
        subject: { reference: ref('Patient', patient.id), display: fullName(patient) },
        period: { start: arrivalTime },
        reasonText: CHIEF_COMPLAINTS[Math.floor(rng() * CHIEF_COMPLAINTS.length)],
        specialty: 'Emergency Medicine',
      });

      const triageDelay = 5 + Math.floor(rng() * 35);
      const triageTime =
        status === 'waiting'
          ? undefined
          : new Date(now - Math.max(0, arrivalMinAgo - triageDelay) * 60000).toISOString();
      const treatmentStartTime =
        status === 'in-treatment' || status === 'awaiting-bed' || status === 'discharged'
          ? new Date(now - Math.max(0, arrivalMinAgo - triageDelay - 10) * 60000).toISOString()
          : undefined;
      const dischargeTime =
        status === 'discharged'
          ? new Date(now - Math.floor(rng() * Math.min(30, arrivalMinAgo)) * 60000).toISOString()
          : undefined;

      const clinician =
        status === 'waiting'
          ? undefined
          : (clinicianPool[Math.floor(rng() * clinicianPool.length)] as Practitioner);
      const cubicle =
        status === 'waiting' ? 'Waiting Room' : (CUBICLES[Math.floor(rng() * CUBICLES.length)] as string);

      store.create<EdAttendance>('EdAttendance', {
        patient: ref('Patient', patient.id),
        patientName: fullName(patient),
        encounter: ref('Encounter', encounter.id),
        arrivalTime,
        chiefComplaint:
          encounter.reasonText ?? (CHIEF_COMPLAINTS[0] as string),
        acuity,
        status,
        cubicle,
        ...(triageTime ? { triageTime } : {}),
        ...(treatmentStartTime ? { treatmentStartTime } : {}),
        ...(dischargeTime ? { dischargeTime } : {}),
        ...(clinician
          ? {
              assignedClinician: ref('Practitioner', clinician.id),
              assignedClinicianName: fullName(clinician),
            }
          : {}),
      });
    }
  },
});
