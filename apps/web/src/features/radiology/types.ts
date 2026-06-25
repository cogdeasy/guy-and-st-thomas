export const MODALITIES = ['XR', 'CT', 'MRI', 'US'] as const;
export type Modality = (typeof MODALITIES)[number];

export const STATUSES = ['requested', 'scheduled', 'acquired', 'reported'] as const;
export type ImagingStatus = (typeof STATUSES)[number];

export type Priority = 'routine' | 'urgent' | 'stat';

export interface Reference {
  reference: string;
  display?: string;
}

export interface ImagingReport {
  findings: string;
  impression: string;
  reportedAt: string;
  radiologist?: Reference;
}

export interface PatientSummary {
  id: string;
  name: string;
  gender?: string;
  birthDate?: string;
  nhsNumber?: string;
}

export interface ImagingRequest {
  id: string;
  patient: Reference;
  encounter?: Reference;
  modality: Modality;
  bodyPart: string;
  clinicalIndication: string;
  priority: Priority;
  status: ImagingStatus;
  requestedBy?: Reference;
  requestedAt: string;
  scheduledFor?: string;
  acquiredAt?: string;
  reportedAt?: string;
  report?: ImagingReport;
  patientSummary?: PatientSummary | null;
}

export interface Worklist {
  total: number;
  items: ImagingRequest[];
}

export interface Metrics {
  total: number;
  open: number;
  awaitingReport: number;
  urgentOutstanding: number;
  avgTurnaroundHours: number | null;
  byStatus: Array<{ status: ImagingStatus; count: number }>;
  byModality: Array<{ modality: Modality; count: number }>;
}

export const MODALITY_LABELS: Record<Modality, string> = {
  XR: 'X-ray',
  CT: 'CT',
  MRI: 'MRI',
  US: 'Ultrasound',
};
