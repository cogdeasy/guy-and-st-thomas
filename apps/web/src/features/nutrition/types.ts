import type { Patient } from '@trustos/ontology';

export type WeightLossRisk = 'low' | 'medium' | 'high';
export type MustRisk = 'low' | 'medium' | 'high';
export type FluidRoute = 'oral' | 'iv' | 'ng-tube' | 'urine' | 'drain' | 'stool' | 'vomit';

export interface NutritionScreen {
  id: string;
  patient: { reference: string; display?: string };
  mustScore: number;
  bmi: number;
  weightLossRisk: WeightLossRisk;
  referralToDietitian: boolean;
  screenedAt: string;
}

export interface WorklistItem {
  encounterId: string;
  patient?: Patient;
  specialty?: string;
  screen: NutritionScreen | null;
  mustScore: number | null;
  risk: MustRisk | null;
  atRisk: boolean;
  referralToDietitian: boolean;
}

export interface Worklist {
  total: number;
  atRisk: number;
  awaitingScreen: number;
  items: WorklistItem[];
}

export interface FluidEntry {
  id: string;
  timestamp: string;
  intakeMl: number;
  outputMl: number;
  route: FluidRoute;
  balanceMl: number;
}

export interface FluidBalance {
  patient: Patient;
  windowHours: number;
  totalIntakeMl: number;
  totalOutputMl: number;
  netBalanceMl: number;
  entries: FluidEntry[];
}

/** Maps a MUST risk band to a UI badge tone. */
export function mustTone(risk?: MustRisk | null): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (risk) {
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'success';
    default:
      return 'neutral';
  }
}

export function patientName(patient?: Patient): string {
  const name = patient?.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
}
