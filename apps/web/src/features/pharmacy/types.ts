import type {
  AllergyIntolerance,
  MedicationRequest,
  Patient,
  Practitioner,
} from '@trustos/ontology';

export type DispenseStatus = 'to-verify' | 'verified' | 'dispensed' | 'query';

export interface DispenseHistoryEntry {
  status: DispenseStatus;
  at: string;
  by?: string;
  note?: string;
}

export interface DispenseRecord {
  id: string;
  medicationRequest: string;
  patient: string;
  status: DispenseStatus;
  priority: 'routine' | 'urgent' | 'asap' | 'stat';
  pharmacist?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  history: DispenseHistoryEntry[];
}

export interface EnrichedRecord {
  record: DispenseRecord;
  medicationRequest: MedicationRequest | null;
  patient: Patient | null;
  prescriber: Practitioner | null;
  pharmacist: Practitioner | null;
  allergies: AllergyIntolerance[];
  allergyConflicts: AllergyIntolerance[];
  waitingMinutes: number;
}

export interface VerifyQueueResponse {
  total: number;
  status: string;
  items: EnrichedRecord[];
}

export interface PharmacyMetrics {
  total: number;
  byStatus: Record<DispenseStatus, number>;
  toVerify: number;
  allergyAlerts: number;
  urgent: number;
  pharmacists: number;
}
