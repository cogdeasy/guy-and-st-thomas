import { z } from 'zod';
import type { Appointment, Location, Patient, Practitioner } from '@trustos/ontology';
import { BadRequest, NotFound, ref, pick, randInt } from '@trustos/core';
import { defineModule } from '../types';
import type { DataStore } from '../../store/store';

/**
 * Outpatient Appointments & Clinics (Scheduling).
 *
 * Models outpatient clinic *sessions* (a clinician's list for a half-day at a
 * given location) as a custom `ClinicSession` collection whose slots reference
 * core FHIR `Appointment`s. The workflow endpoints layered on top of the
 * generic CRUD provide the things a booking clerk / clinic coordinator actually
 * needs: a clinic day view with live utilisation, slot-aware booking, attendance
 * state transitions (arrived / seen / DNA / cancelled) and DNA/utilisation KPIs.
 */

const SLOT_MINUTES = 15;

/** Friendly attendance actions mapped onto FHIR Appointment statuses. */
const STATUS_ACTIONS = {
  arrived: 'arrived',
  seen: 'fulfilled',
  dna: 'noshow',
  cancelled: 'cancelled',
} as const;
type StatusAction = keyof typeof STATUS_ACTIONS;

interface ClinicSlot {
  index: number;
  start: string;
  end: string;
  appointmentId: string | null;
}

type ClinicSession = {
  id: string;
  resourceType?: string;
  meta?: Record<string, unknown>;
  name: string;
  date: string; // YYYY-MM-DD
  half: 'AM' | 'PM';
  specialty: string;
  clinician: { reference: string; display: string };
  location: { reference: string; display: string };
  room: string;
  slotMinutes: number;
  start: string;
  end: string;
  capacity: number;
  slots: ClinicSlot[];
};

export default defineModule({
  id: 'scheduling',
  name: 'Outpatient Appointments & Clinics',
  description: 'Outpatient clinic scheduling: day view, slot booking, attendance and DNA/utilisation KPIs.',

  collections: [{ name: 'ClinicSession' }],

  routes(app, { store }) {
    // --- Clinics: sessions grouped by specialty/clinician with utilisation ---
    app.get<{ Querystring: { date?: string; range?: string } }>('/clinics', async (req) => {
      const sessions = filterSessions(store, req.query.date, req.query.range);
      const clinics = sessions
        .map((s) => decorateSession(store, s))
        .sort((a, b) => a.start.localeCompare(b.start));

      const totals = aggregate(clinics);
      const bySpecialtyMap = new Map<string, ReturnType<typeof aggregate>>();
      for (const c of clinics) {
        const group = clinics.filter((x) => x.specialty === c.specialty);
        if (!bySpecialtyMap.has(c.specialty)) bySpecialtyMap.set(c.specialty, aggregate(group));
      }
      const bySpecialty = [...bySpecialtyMap.entries()]
        .map(([specialty, agg]) => ({ specialty, ...agg }))
        .sort((a, b) => b.capacity - a.capacity);

      return {
        scope: req.query.date ?? req.query.range ?? 'today',
        totals,
        bySpecialty,
        clinics,
      };
    });

    // --- Single clinic detail: full slot grid with patient names ---
    app.get<{ Params: { id: string } }>('/clinics/:id', async (req) => {
      const session = store.get<ClinicSession>('ClinicSession', req.params.id);
      if (!session) throw NotFound('ClinicSession');
      const decorated = decorateSession(store, session);
      const slots = session.slots.map((slot) => ({
        ...slot,
        appointment: slot.appointmentId
          ? joinAppointment(store, slot.appointmentId)
          : null,
      }));
      return { ...decorated, slots };
    });

    // --- Appointments: filter by date / status / clinic / patient ---
    app.get<{ Querystring: { date?: string; status?: string; clinicId?: string; patientId?: string } }>(
      '/appointments',
      async (req) => {
        const { date, status, clinicId, patientId } = req.query;
        let appointments = store.list<Appointment>('Appointment');
        if (clinicId) {
          const session = store.get<ClinicSession>('ClinicSession', clinicId);
          const ids = new Set((session?.slots ?? []).map((s) => s.appointmentId).filter(Boolean));
          appointments = appointments.filter((a) => ids.has(a.id));
        }
        if (date) appointments = appointments.filter((a) => a.start.slice(0, 10) === date);
        if (status) appointments = appointments.filter((a) => a.status === status);
        if (patientId) {
          appointments = appointments.filter((a) => a.subject.reference === ref('Patient', patientId));
        }
        const items = appointments
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((a) => joinAppointment(store, a.id))
          .filter(Boolean);
        return { total: items.length, items };
      },
    );

    // --- Book a patient into a clinic slot ---
    const BookBody = z.object({
      sessionId: z.string().min(1),
      patientId: z.string().min(1),
      slotIndex: z.number().int().nonnegative().optional(),
      reasonText: z.string().max(200).optional(),
    });
    app.post<{ Body: unknown }>('/book', async (req, reply) => {
      const body = BookBody.parse(req.body);
      const session = store.get<ClinicSession>('ClinicSession', body.sessionId);
      if (!session) throw NotFound('ClinicSession');
      const patient = store.get<Patient>('Patient', body.patientId);
      if (!patient) throw NotFound('Patient');

      const slot =
        body.slotIndex !== undefined
          ? session.slots.find((s) => s.index === body.slotIndex)
          : session.slots.find((s) => s.appointmentId === null);
      if (!slot) {
        throw BadRequest(
          body.slotIndex !== undefined
            ? `No slot ${body.slotIndex} in this clinic session`
            : 'Clinic session is fully booked',
        );
      }
      if (slot.appointmentId) throw BadRequest('Slot is already booked');

      const appointment = store.create<Appointment>('Appointment', {
        status: 'booked',
        serviceType: session.name,
        specialty: session.specialty,
        start: slot.start,
        end: slot.end,
        subject: { reference: ref('Patient', patient.id), display: patientName(patient) },
        practitioner: session.clinician,
        location: session.location,
        description: body.reasonText ?? `${session.name} appointment`,
      });

      slot.appointmentId = appointment.id;
      store.update('ClinicSession', session.id, { slots: session.slots });

      reply.code(201);
      return { appointment: joinAppointment(store, appointment.id), session: decorateSession(store, session) };
    });

    // --- Attendance state transition: arrived / seen / dna / cancelled ---
    const StatusBody = z.object({
      status: z.enum(['arrived', 'seen', 'dna', 'cancelled']),
      note: z.string().max(200).optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/:id/status', async (req) => {
      const body = StatusBody.parse(req.body);
      const existing = store.get<Appointment>('Appointment', req.params.id);
      if (!existing) throw NotFound('Appointment');

      const action = body.status as StatusAction;
      const next = STATUS_ACTIONS[action];
      assertTransition(existing.status, next);

      const updated = store.update<Appointment>('Appointment', existing.id, {
        status: next,
        ...(body.note ? { description: body.note } : {}),
      });

      // Cancellation frees the slot so it can be re-booked.
      if (next === 'cancelled') {
        const session = findSessionByAppointment(store, existing.id);
        if (session) {
          const slot = session.slots.find((s) => s.appointmentId === existing.id);
          if (slot) {
            slot.appointmentId = null;
            store.update('ClinicSession', session.id, { slots: session.slots });
          }
        }
      }

      return joinAppointment(store, updated.id);
    });

    // --- KPIs: DNA rate, utilisation, status & specialty breakdown ---
    app.get<{ Querystring: { date?: string; range?: string } }>('/metrics', async (req) => {
      const sessions = filterSessions(store, req.query.date, req.query.range).map((s) =>
        decorateSession(store, s),
      );
      const totals = aggregate(sessions);

      const byStatus: Record<string, number> = {};
      let attended = 0;
      let dna = 0;
      for (const s of sessions) {
        for (const [status, count] of Object.entries(s.statusCounts)) {
          byStatus[status] = (byStatus[status] ?? 0) + count;
          if (status === 'arrived' || status === 'fulfilled') attended += count;
          if (status === 'noshow') dna += count;
        }
      }
      const dnaDenominator = attended + dna;
      const dnaRate = dnaDenominator === 0 ? 0 : round(dna / dnaDenominator);

      const bySpecialty = totals.specialties.map((specialty) => {
        const group = sessions.filter((s) => s.specialty === specialty);
        return { specialty, ...aggregate(group) };
      });

      return {
        scope: req.query.date ?? req.query.range ?? 'today',
        sessions: sessions.length,
        capacity: totals.capacity,
        booked: totals.booked,
        free: totals.free,
        utilisation: totals.utilisation,
        dnaRate,
        dnaCount: dna,
        attended,
        byStatus,
        bySpecialty,
      };
    });
  },

  seed(ctx) {
    const { store, rng } = ctx;
    const patients = store.list<Patient>('Patient');
    const practitioners = store.list<Practitioner>('Practitioner');
    const sites = store.list<Location>('Location', { physicalType: 'site' });
    if (patients.length === 0 || practitioners.length === 0) return;

    const CLINIC_TEMPLATES: Array<{ specialty: string; name: string; room: string }> = [
      { specialty: 'Cardiology', name: 'Cardiology Outpatients', room: 'Clinic 2A' },
      { specialty: 'Respiratory Medicine', name: 'Respiratory Clinic', room: 'Clinic 4B' },
      { specialty: 'Dermatology', name: 'Dermatology Clinic', room: 'Clinic 1C' },
      { specialty: 'Orthopaedics', name: 'Fracture Clinic', room: 'Clinic 3A' },
      { specialty: 'Endocrinology', name: 'Diabetes & Endocrine Clinic', room: 'Clinic 5B' },
      { specialty: 'Gastroenterology', name: 'GI Outpatients', room: 'Clinic 2C' },
      { specialty: 'Neurology', name: 'Neurology Clinic', room: 'Clinic 6A' },
      { specialty: 'Ophthalmology', name: 'Eye Clinic', room: 'Clinic 1A' },
    ];

    // Weekday window around today so demos always show past + upcoming clinics.
    const dayOffsets: number[] = [];
    for (let d = -4; d <= 4; d++) {
      if (isWeekday(d)) dayOffsets.push(d);
    }

    for (const dayOffset of dayOffsets) {
      // 2-3 clinics per day, deterministic selection.
      const clinicCount = randInt(2, 3, rng);
      const templates = shuffle(CLINIC_TEMPLATES, rng).slice(0, clinicCount);
      for (const template of templates) {
        const half: 'AM' | 'PM' = rng() < 0.5 ? 'AM' : 'PM';
        const clinician = pickClinician(practitioners, template.specialty, rng);
        const site = sites.length ? pick(sites, rng) : undefined;
        const capacity = randInt(10, 16, rng);
        const startHour = half === 'AM' ? 9 : 13;
        const startMinute = half === 'AM' ? 0 : 30;

        const slots: ClinicSlot[] = [];
        for (let i = 0; i < capacity; i++) {
          slots.push({
            index: i,
            start: slotIso(dayOffset, startHour, startMinute + i * SLOT_MINUTES),
            end: slotIso(dayOffset, startHour, startMinute + (i + 1) * SLOT_MINUTES),
            appointmentId: null,
          });
        }

        const session = store.create<ClinicSession>('ClinicSession', {
          name: template.name,
          date: dateKey(dayOffset),
          half,
          specialty: template.specialty,
          clinician: {
            reference: ref('Practitioner', clinician.id),
            display: practitionerName(clinician),
          },
          location: site
            ? { reference: ref('Location', site.id), display: site.name }
            : { reference: 'Location/unknown', display: 'Outpatients' },
          room: template.room,
          slotMinutes: SLOT_MINUTES,
          start: slotIso(dayOffset, startHour, startMinute),
          end: slotIso(dayOffset, startHour, startMinute + capacity * SLOT_MINUTES),
          capacity,
          slots,
        });

        // Fill a realistic proportion of slots with appointments.
        const fillRatio = 0.55 + rng() * 0.4;
        for (const slot of session.slots) {
          if (rng() > fillRatio) continue;
          const patient = pick(patients, rng);
          const status = seedStatus(dayOffset, rng);
          const appointment = store.create<Appointment>('Appointment', {
            status,
            serviceType: session.name,
            specialty: session.specialty,
            start: slot.start,
            end: slot.end,
            subject: { reference: ref('Patient', patient.id), display: patientName(patient) },
            practitioner: session.clinician,
            location: session.location,
            description: `${session.name} appointment`,
          });
          // A cancelled appointment frees its slot for rebooking, mirroring the
          // POST /:id/status cancel handler; the record is kept as an audit trail.
          slot.appointmentId = status === 'cancelled' ? null : appointment.id;
        }
        store.update('ClinicSession', session.id, { slots: session.slots });
      }
    }
  },
});

// --- helpers ---------------------------------------------------------------

type DecoratedSession = ClinicSession & {
  booked: number;
  free: number;
  utilisation: number;
  statusCounts: Record<string, number>;
};

function decorateSession(store: DataStore, session: ClinicSession): DecoratedSession {
  const statusCounts: Record<string, number> = {};
  let booked = 0;
  for (const slot of session.slots) {
    if (!slot.appointmentId) continue;
    const appt = store.get<Appointment>('Appointment', slot.appointmentId);
    if (!appt) continue;
    if (appt.status !== 'cancelled') booked++;
    statusCounts[appt.status] = (statusCounts[appt.status] ?? 0) + 1;
  }
  return {
    ...session,
    booked,
    free: session.capacity - booked,
    utilisation: session.capacity === 0 ? 0 : round(booked / session.capacity),
    statusCounts,
  };
}

function joinAppointment(store: DataStore, appointmentId: string) {
  const appt = store.get<Appointment>('Appointment', appointmentId);
  if (!appt) return null;
  const patientId = appt.subject.reference.split('/')[1] ?? '';
  const patient = store.get<Patient>('Patient', patientId);
  return {
    ...appt,
    patient: patient
      ? {
          id: patient.id,
          name: patientName(patient),
          birthDate: patient.birthDate,
          nhsNumber: patient.identifier?.find((i) => i.use === 'official')?.value,
        }
      : null,
  };
}

function aggregate(sessions: DecoratedSession[]) {
  const capacity = sessions.reduce((sum, s) => sum + s.capacity, 0);
  const booked = sessions.reduce((sum, s) => sum + s.booked, 0);
  const specialties = [...new Set(sessions.map((s) => s.specialty))];
  return {
    sessions: sessions.length,
    capacity,
    booked,
    free: capacity - booked,
    utilisation: capacity === 0 ? 0 : round(booked / capacity),
    specialties,
  };
}

function filterSessions(store: DataStore, date?: string, range?: string): ClinicSession[] {
  const all = store.list<ClinicSession>('ClinicSession');
  if (date) return all.filter((s) => s.date === date);
  if (range === 'week') {
    const today = dateKey(0);
    const weekEnd = dateKey(7);
    return all.filter((s) => s.date >= today && s.date <= weekEnd);
  }
  if (range === 'all') return all;
  // Default: today's clinics.
  return all.filter((s) => s.date === dateKey(0));
}

function findSessionByAppointment(store: DataStore, appointmentId: string): ClinicSession | undefined {
  return store
    .list<ClinicSession>('ClinicSession')
    .find((s) => s.slots.some((slot) => slot.appointmentId === appointmentId));
}

const ATTENDED: ReadonlySet<string> = new Set(['arrived', 'fulfilled', 'noshow', 'cancelled']);

function assertTransition(current: string, next: string): void {
  if (current === next) return;
  if (ATTENDED.has(current) && current !== 'arrived') {
    throw BadRequest(`Cannot move appointment from '${current}' to '${next}'`);
  }
  // From 'arrived' the patient may still be seen, marked DNA in error, or cancelled.
}

function pickClinician(practitioners: Practitioner[], specialty: string, rng: () => number): Practitioner {
  const matches = practitioners.filter((p) => p.specialty === specialty);
  return matches.length ? pick(matches, rng) : pick(practitioners, rng);
}

function seedStatus(dayOffset: number, rng: () => number): Appointment['status'] {
  if (dayOffset < 0) {
    const r = rng();
    if (r < 0.78) return 'fulfilled';
    if (r < 0.92) return 'noshow';
    return 'cancelled';
  }
  if (dayOffset === 0) {
    const r = rng();
    if (r < 0.35) return 'fulfilled';
    if (r < 0.6) return 'arrived';
    if (r < 0.72) return 'noshow';
    return 'booked';
  }
  return 'booked';
}

function patientName(patient: Patient): string {
  const n = patient.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim() || 'Unknown patient';
}

function practitionerName(practitioner: Practitioner): string {
  const n = practitioner.name?.[0];
  const prefix = n?.prefix?.join(' ') ?? '';
  return `${prefix} ${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.replace(/\s+/g, ' ').trim();
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isWeekday(dayOffset: number): boolean {
  const d = baseDate(dayOffset);
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function baseDate(dayOffset: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return d;
}

function dateKey(dayOffset: number): string {
  return baseDate(dayOffset).toISOString().slice(0, 10);
}

function slotIso(dayOffset: number, hour: number, minute: number): string {
  const d = baseDate(dayOffset);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}
