import type { Patient } from '@trustos/ontology';

export type Prophylaxis = 'mechanical' | 'pharmacological' | 'none';

export interface VteAssessment {
  id: string;
  patient: { reference: string };
  encounter: { reference: string };
  riskFactors: string[];
  bleedingRiskFactors: string[];
  prophylaxisRecommended: Prophylaxis;
  completed: boolean;
  assessedAt: string;
  assessedBy?: { reference: string };
}

export interface WorklistItem {
  encounterId: string;
  patient?: Patient;
  specialty?: string;
  reason?: string;
  admittedAt?: string;
  hoursSinceAdmission?: number;
  assessed: boolean;
  overdue: boolean;
  assessment: VteAssessment | null;
}

export interface Worklist {
  total: number;
  assessed: number;
  overdue: number;
  items: WorklistItem[];
}

export interface VteMetrics {
  totalAdmitted: number;
  assessed: number;
  overdue: number;
  withinTarget: number;
  compliancePct: number;
  assessedPct: number;
  byProphylaxis: Record<Prophylaxis, number>;
}

export interface VteCatalog {
  riskFactors: string[];
  bleedingRiskFactors: string[];
  prophylaxisOptions: Prophylaxis[];
}

export function patientName(patient?: Patient): string {
  const name = patient?.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
}

export function prophylaxisLabel(p: Prophylaxis): string {
  switch (p) {
    case 'mechanical':
      return 'Mechanical';
    case 'pharmacological':
      return 'Pharmacological';
    default:
      return 'None';
  }
}
