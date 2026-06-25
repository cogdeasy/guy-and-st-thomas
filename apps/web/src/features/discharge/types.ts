import type { Encounter, Patient } from '@trustos/ontology';

export const DISCHARGE_STATUSES = ['draft', 'pending-pharmacy', 'completed'] as const;
export type DischargeStatus = (typeof DISCHARGE_STATUSES)[number];

export interface TtoMed {
  medication: string;
  dose: string;
  route?: string;
  frequency: string;
  quantity?: string;
}

export interface DischargeSummary {
  id: string;
  patient: string;
  encounter: string;
  status: DischargeStatus;
  diagnosis: string;
  ttoMeds: TtoMed[];
  followUp: string;
  gpLetterGenerated: boolean;
  pharmacist?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export interface Checklist {
  items: ChecklistItem[];
  complete: number;
  total: number;
  ready: boolean;
}

export interface WorklistItem {
  id: string;
  status: DischargeStatus;
  patient?: Patient;
  encounter?: Encounter;
  diagnosis: string;
  ttoCount: number;
  gpLetterGenerated: boolean;
  updatedAt?: string;
  checklist: Checklist;
}

export interface WorklistResponse {
  total: number;
  readyForDischarge: number;
  byStatus: Record<DischargeStatus, number>;
  items: WorklistItem[];
}

export interface DischargeDetail {
  summary: DischargeSummary;
  patient?: Patient;
  encounter?: Encounter;
  checklist: Checklist;
}

export const STATUS_LABELS: Record<DischargeStatus, string> = {
  draft: 'Draft',
  'pending-pharmacy': 'Pending pharmacy',
  completed: 'Completed',
};

export function statusTone(status: DischargeStatus): 'neutral' | 'warning' | 'success' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'pending-pharmacy':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function patientName(patient?: Patient): string {
  const name = patient?.name?.[0];
  if (!name) return 'Unknown patient';
  return `${name.given?.join(' ') ?? ''} ${name.family ?? ''}`.trim();
}
