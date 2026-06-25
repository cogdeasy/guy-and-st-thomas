export const DELIVERY_MODE_LABELS: Record<string, string> = {
  svd: 'Spontaneous vaginal',
  instrumental: 'Instrumental',
  'elective-lscs': 'Elective C-section',
  'emergency-lscs': 'Emergency C-section',
};

export type PregnancyStatus = 'antenatal' | 'intrapartum' | 'postnatal';

export interface Episode {
  id: string;
  patient: string;
  edd: string;
  gestationWeeks: number;
  parity: number;
  gravida?: number;
  riskFactors: string[];
  status: PregnancyStatus;
  bookingDate?: string;
  admittedAt?: string;
  patientName: string;
  patientAge?: number;
  nhsNumber?: string;
  midwifeName?: string;
  bed?: string;
  trimester: 1 | 2 | 3;
  highRisk: boolean;
}

export interface BirthRecord {
  id: string;
  episode: string;
  patient: string;
  deliveryDateTime: string;
  mode: string;
  babyWeightGrams: number;
  apgar1: number;
  apgar5: number;
  birthAttendant?: string;
}

export interface MaternitySummary {
  totalEpisodes: number;
  antenatal: number;
  intrapartum: number;
  postnatal: number;
  births: number;
  highRisk: number;
}

export function patientIdFromRef(reference: string): string {
  return reference.split('/')[1] ?? '';
}
