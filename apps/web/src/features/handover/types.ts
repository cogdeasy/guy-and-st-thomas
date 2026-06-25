import type { Patient, Practitioner } from '@trustos/ontology';

export type HandoverPriority = 'routine' | 'urgent' | 'high';
export type HandoverShift = 'day' | 'night';
export type HandoverStatus = 'active' | 'handed-over';

export interface News2Snapshot {
  score: number;
  risk: string;
  recommendation: string;
  recordedAt?: string;
}

export interface HandoverEntry {
  id: string;
  patient: Patient | null;
  author: Practitioner | null;
  encounter?: { reference: string };
  specialty?: string;
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  news2: News2Snapshot | null;
  priority: HandoverPriority;
  shift: HandoverShift;
  status: HandoverStatus;
  updatedAt: string;
}

export interface HandoverList {
  total: number;
  counts: { high: number; urgent: number; routine: number };
  items: HandoverEntry[];
}
