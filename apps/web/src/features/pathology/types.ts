import type { BadgeTone } from '@trustos/ui';

export type SpecimenType = 'blood' | 'urine' | 'csf' | 'swab';
export type SpecimenPriority = 'routine' | 'urgent' | 'stat';
export type SpecimenStatus = 'collected' | 'in-lab' | 'analysing' | 'resulted' | 'rejected';

export interface StatusEvent {
  status: SpecimenStatus;
  at: string;
  note?: string;
}

export interface Specimen {
  id: string;
  subject: { reference: string; display?: string };
  encounter?: { reference: string; display?: string };
  collectedBy?: { reference: string; display?: string };
  type: SpecimenType;
  test: string;
  priority: SpecimenPriority;
  status: SpecimenStatus;
  accession: string;
  collectedAt: string;
  receivedAt?: string;
  resultedAt?: string;
  rejectionReason?: string;
  statusHistory: StatusEvent[];
  patientName: string;
  turnaroundHours: number | null;
  ageHours: number;
  slaHours: number;
  slaBreached: boolean;
}

export interface WorklistLane {
  status: SpecimenStatus;
  count: number;
  items: Specimen[];
}

export interface Worklist {
  total: number;
  lanes: WorklistLane[];
  items: Specimen[];
}

export interface Metrics {
  total: number;
  active: number;
  urgentPending: number;
  byStatus: Record<SpecimenStatus, number>;
  byType: Record<SpecimenType, number>;
  rejected: number;
  rejectionRate: number;
  turnaround: { resultedCount: number; averageHours: number; medianHours: number };
  slaBreaches: number;
}

export const PIPELINE: SpecimenStatus[] = ['collected', 'in-lab', 'analysing', 'resulted'];

export const SPECIMEN_TYPES: SpecimenType[] = ['blood', 'urine', 'csf', 'swab'];
export const SPECIMEN_PRIORITIES: SpecimenPriority[] = ['routine', 'urgent', 'stat'];

/** Tests available per specimen type, mirroring the backend catalogue. */
export const TEST_CATALOGUE: Record<SpecimenType, string[]> = {
  blood: [
    'Full Blood Count',
    'Urea & Electrolytes',
    'Liver Function Tests',
    'C-Reactive Protein',
    'Coagulation Screen',
    'Blood Culture',
    'Troponin',
  ],
  urine: ['Urine Culture & Sensitivity', 'Urinalysis'],
  csf: ['CSF Microscopy & Culture', 'CSF Protein & Glucose'],
  swab: ['Wound Swab M,C&S', 'MRSA Screen', 'Respiratory Viral PCR'],
};

export const STATUS_LABELS: Record<SpecimenStatus, string> = {
  collected: 'Collected',
  'in-lab': 'In lab',
  analysing: 'Analysing',
  resulted: 'Resulted',
  rejected: 'Rejected',
};

/** Permitted forward transitions, mirroring the backend pipeline. */
export const NEXT_STATUS: Record<SpecimenStatus, SpecimenStatus[]> = {
  collected: ['in-lab', 'rejected'],
  'in-lab': ['analysing', 'rejected'],
  analysing: ['resulted', 'rejected'],
  resulted: [],
  rejected: [],
};

export function statusTone(status: SpecimenStatus): BadgeTone {
  switch (status) {
    case 'collected':
      return 'neutral';
    case 'in-lab':
      return 'info';
    case 'analysing':
      return 'warning';
    case 'resulted':
      return 'success';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function priorityTone(priority: SpecimenPriority): BadgeTone {
  return priority === 'stat' ? 'danger' : priority === 'urgent' ? 'warning' : 'neutral';
}

export function formatHours(hours?: number | null): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}
