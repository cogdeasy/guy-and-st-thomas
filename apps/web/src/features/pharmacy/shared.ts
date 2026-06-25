import { ageFromBirthDate } from '@trustos/core';
import type { BadgeTone } from '@trustos/ui';
import type { Patient, Practitioner } from '@trustos/ontology';
import type { DispenseStatus } from './types';

export const STATUS_LABELS: Record<DispenseStatus, string> = {
  'to-verify': 'To verify',
  verified: 'Verified',
  dispensed: 'Dispensed',
  query: 'Query',
};

export function statusTone(status: DispenseStatus): BadgeTone {
  switch (status) {
    case 'to-verify':
      return 'warning';
    case 'verified':
      return 'info';
    case 'dispensed':
      return 'success';
    case 'query':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function priorityTone(priority?: string): BadgeTone {
  switch (priority) {
    case 'stat':
    case 'urgent':
      return 'danger';
    case 'asap':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function fullName(
  person?: { name?: Array<{ given?: string[]; family?: string; prefix?: string[] }> } | null,
): string {
  const name = person?.name?.[0];
  if (!name) return 'Unknown';
  const prefix = name.prefix?.join(' ');
  return `${prefix ? `${prefix} ` : ''}${name.given?.join(' ') ?? ''} ${name.family ?? ''}`.trim();
}

export function patientLine(patient?: Patient | null): string {
  if (!patient) return '—';
  const nhs = patient.identifier?.find((i) => i.system?.includes('nhs-number'))?.value;
  const age = patient.birthDate ? `${ageFromBirthDate(patient.birthDate)}y` : '';
  return [age, patient.gender, nhs ? `NHS ${nhs}` : null].filter(Boolean).join(' · ');
}

export function pharmacistName(pharmacist?: Practitioner | null): string {
  return pharmacist ? fullName(pharmacist) : '—';
}

export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
