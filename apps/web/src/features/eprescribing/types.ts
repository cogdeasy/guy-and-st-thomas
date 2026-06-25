import type { AllergyIntolerance, MedicationRequest, Patient } from '@trustos/ontology';

export type ChartGroupKey = 'regular' | 'prn' | 'stat';

export interface DrugChart {
  patient: Patient;
  nhsNumber?: string;
  allergies: AllergyIntolerance[];
  counts: {
    active: number;
    regular: number;
    prn: number;
    stat: number;
    discontinued: number;
  };
  groups: Record<ChartGroupKey, MedicationRequest[]>;
  history: MedicationRequest[];
}

export interface WorklistItem {
  patient: Patient;
  nhsNumber?: string;
  counts: { active: number; regular: number; prn: number; stat: number };
  allergyCount: number;
  lastUpdated?: string;
}

export interface Worklist {
  total: number;
  items: WorklistItem[];
}

export interface FormularyDrug {
  code: string;
  display: string;
  drugClass: string;
  form: string;
  routes: string[];
  defaultDose: string;
  defaultFrequency: string;
  prnByDefault?: boolean;
}

export interface Formulary {
  routes: string[];
  frequencies: string[];
  drugs: FormularyDrug[];
}

export interface AllergyWarning {
  allergen: string;
  criticality: 'low' | 'high' | 'unable-to-assess';
  severity: 'contraindicated' | 'caution';
  reactions: string[];
  message: string;
}

export interface AllergyCheckResult {
  warnings: AllergyWarning[];
  blocked: boolean;
}

export function patientName(p?: Patient): string {
  const n = p?.name?.[0];
  return `${n?.given?.join(' ') ?? ''} ${n?.family ?? ''}`.trim() || 'Unknown patient';
}
