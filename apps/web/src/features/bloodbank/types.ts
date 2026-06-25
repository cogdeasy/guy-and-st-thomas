import type { Patient } from '@trustos/ontology';
import type { BadgeTone } from '@trustos/ui';

export type BloodComponent = 'red-cells' | 'platelets' | 'ffp';
export type BloodGroup = 'O-' | 'O+' | 'A-' | 'A+' | 'B-' | 'B+' | 'AB-' | 'AB+';
export type TransfusionStatus = 'requested' | 'crossmatched' | 'issued' | 'transfused';
export type TransfusionPriority = 'routine' | 'urgent' | 'asap' | 'stat';

export interface TransfusionOrder {
  id: string;
  patient: { reference: string; display?: string };
  encounter?: { reference: string };
  bloodGroup: BloodGroup;
  component: BloodComponent;
  units: number;
  indication: string;
  priority: TransfusionPriority;
  status: TransfusionStatus;
  groupAndSave: boolean;
  requestedAt: string;
  crossmatchedAt?: string;
  issuedAt?: string;
  transfusedAt?: string;
}

export interface WorklistItem {
  order: TransfusionOrder;
  patient: Patient | null;
}

export interface Worklist {
  total: number;
  byStatus: Partial<Record<TransfusionStatus, number>>;
  items: WorklistItem[];
}

export interface StockGroup {
  group: BloodGroup;
  units: number;
}

export interface StockComponent {
  component: BloodComponent;
  label: string;
  total: number;
  groups: StockGroup[];
}

export interface Stock {
  totalUnits: number;
  components: StockComponent[];
}

export interface OrderDetail {
  order: TransfusionOrder;
  patient: Patient | null;
  timeline: Array<{ status: TransfusionStatus; at: string }>;
  available: number;
}

export const TRANSFUSION_PATHWAY: TransfusionStatus[] = [
  'requested',
  'crossmatched',
  'issued',
  'transfused',
];

export const COMPONENT_LABELS: Record<BloodComponent, string> = {
  'red-cells': 'Red cells',
  platelets: 'Platelets',
  ffp: 'Fresh frozen plasma',
};

export const STATUS_LABELS: Record<TransfusionStatus, string> = {
  requested: 'Requested',
  crossmatched: 'Crossmatched',
  issued: 'Issued',
  transfused: 'Transfused',
};

/** The next transition action available for an order, if any. */
export const NEXT_ACTION: Record<TransfusionStatus, { label: string; path: string } | null> = {
  requested: { label: 'Crossmatch', path: 'crossmatch' },
  crossmatched: { label: 'Issue', path: 'issue' },
  issued: { label: 'Transfuse', path: 'transfuse' },
  transfused: null,
};

export function statusTone(status: TransfusionStatus): BadgeTone {
  switch (status) {
    case 'requested':
      return 'neutral';
    case 'crossmatched':
      return 'info';
    case 'issued':
      return 'warning';
    case 'transfused':
      return 'success';
  }
}

export function priorityTone(priority: TransfusionPriority): BadgeTone {
  switch (priority) {
    case 'stat':
    case 'asap':
      return 'danger';
    case 'urgent':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function patientName(patient: Patient | null, fallback?: string): string {
  if (!patient) return fallback ?? 'Unknown patient';
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || (fallback ?? 'Unknown');
}
