import type { BadgeTone } from '@trustos/ui';

export interface SlotPatient {
  id: string;
  name: string;
  birthDate: string;
  nhsNumber?: string;
}

export interface SchedulingAppointment {
  id: string;
  status: AppointmentStatus;
  serviceType?: string;
  specialty?: string;
  start: string;
  end: string;
  description?: string;
  practitioner?: { reference: string; display: string };
  location?: { reference: string; display: string };
  patient: SlotPatient | null;
}

export type AppointmentStatus =
  | 'proposed'
  | 'booked'
  | 'arrived'
  | 'fulfilled'
  | 'cancelled'
  | 'noshow'
  | 'waitlist';

export interface ClinicSlot {
  index: number;
  start: string;
  end: string;
  appointmentId: string | null;
  appointment?: SchedulingAppointment | null;
}

export interface Clinic {
  id: string;
  name: string;
  date: string;
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
  booked: number;
  free: number;
  utilisation: number;
  statusCounts: Record<string, number>;
}

export interface ClinicsResponse {
  scope: string;
  totals: {
    sessions: number;
    capacity: number;
    booked: number;
    free: number;
    utilisation: number;
    specialties: string[];
  };
  bySpecialty: Array<{
    specialty: string;
    sessions: number;
    capacity: number;
    booked: number;
    free: number;
    utilisation: number;
  }>;
  clinics: Clinic[];
}

export interface MetricsResponse {
  scope: string;
  sessions: number;
  capacity: number;
  booked: number;
  free: number;
  utilisation: number;
  dnaRate: number;
  dnaCount: number;
  attended: number;
  byStatus: Record<string, number>;
  bySpecialty: Array<{ specialty: string; capacity: number; booked: number; utilisation: number }>;
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  proposed: 'Proposed',
  booked: 'Booked',
  arrived: 'Arrived',
  fulfilled: 'Seen',
  cancelled: 'Cancelled',
  noshow: 'DNA',
  waitlist: 'Waitlist',
};

export function statusTone(status: AppointmentStatus): BadgeTone {
  switch (status) {
    case 'arrived':
      return 'info';
    case 'fulfilled':
      return 'success';
    case 'noshow':
      return 'danger';
    case 'cancelled':
      return 'neutral';
    default:
      return 'warning';
  }
}

/** Tailwind text tone for a utilisation percentage. */
export function utilisationTone(util: number): BadgeTone {
  if (util >= 0.85) return 'success';
  if (util >= 0.6) return 'info';
  if (util >= 0.4) return 'warning';
  return 'danger';
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
