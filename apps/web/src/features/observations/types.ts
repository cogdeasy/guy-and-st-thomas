import type { Patient } from '@trustos/ontology';

export interface News2 {
  score: number;
  risk: 'low' | 'low-medium' | 'medium' | 'high';
  recommendation: string;
  breakdown?: Record<string, number>;
}

export interface Escalation {
  band: string;
  monitoring: string;
  response: string;
}

export interface VitalsSet {
  recordedAt: string;
  respiratoryRate?: number;
  spo2?: number;
  onOxygen?: boolean;
  systolicBp?: number;
  heartRate?: number;
  consciousness?: 'A' | 'V' | 'P' | 'U';
  temperature?: number;
  news2: News2 | null;
}

export interface TrendPoint {
  recordedAt: string;
  news2: number | null;
  risk: string | null;
}

export interface Chart {
  patient: Patient;
  nhsNumber?: string;
  total: number;
  latest: VitalsSet | null;
  trend: TrendPoint[];
  series: VitalsSet[];
}

export interface RecordResult {
  patientId: string;
  recordedAt: string;
  news2: News2;
  escalation: Escalation;
}

export interface DeterioratingRow {
  patient: Patient;
  encounterId?: string;
  ward?: string;
  specialty?: string;
  news2: number;
  risk: string;
  recommendation: string;
  escalation: Escalation;
  recordedAt: string;
}
