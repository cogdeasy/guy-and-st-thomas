import { CodeSystems } from '@trustos/ontology';

/** Interpretation flags aligned with the core Observation schema. */
export type ResultFlag = 'normal' | 'low' | 'high' | 'critical' | 'abnormal';

/** A single measurable analyte within a pathology panel. */
export interface Analyte {
  /** LOINC code for the measurement. */
  loinc: string;
  display: string;
  unit: string;
  /** Inclusive normal reference range. */
  low: number;
  high: number;
  /** Optional critical action thresholds (panic values). */
  criticalLow?: number;
  criticalHigh?: number;
  decimals: number;
}

export type PanelCategory = 'LAB' | 'RAD';

/** A report template: either a lab panel (analytes) or an imaging study. */
export interface Panel {
  key: string;
  /** SNOMED code for the diagnostic report. */
  code: string;
  display: string;
  category: PanelCategory;
  /** LAB panels carry analytes. */
  analytes?: Analyte[];
  /** RAD studies carry a narrative report instead of discrete values. */
  imaging?: boolean;
}

/**
 * Pathology and radiology catalogue used to generate realistic demo results.
 * Reference ranges reflect typical UK adult laboratory values.
 */
export const PANELS: Panel[] = [
  {
    key: 'FBC',
    code: '26604007',
    display: 'Full blood count',
    category: 'LAB',
    analytes: [
      { loinc: '718-7', display: 'Haemoglobin', unit: 'g/L', low: 120, high: 165, criticalLow: 70, criticalHigh: 200, decimals: 0 },
      { loinc: '6690-2', display: 'White cell count', unit: '10*9/L', low: 4.0, high: 11.0, criticalLow: 1.0, criticalHigh: 30.0, decimals: 1 },
      { loinc: '777-3', display: 'Platelets', unit: '10*9/L', low: 150, high: 400, criticalLow: 50, criticalHigh: 1000, decimals: 0 },
      { loinc: '751-8', display: 'Neutrophils', unit: '10*9/L', low: 2.0, high: 7.5, criticalLow: 0.5, decimals: 1 },
    ],
  },
  {
    key: 'U&E',
    code: '444164000',
    display: 'Urea and electrolytes',
    category: 'LAB',
    analytes: [
      { loinc: '2951-2', display: 'Sodium', unit: 'mmol/L', low: 135, high: 145, criticalLow: 120, criticalHigh: 160, decimals: 0 },
      { loinc: '2823-3', display: 'Potassium', unit: 'mmol/L', low: 3.5, high: 5.3, criticalLow: 2.5, criticalHigh: 6.5, decimals: 1 },
      { loinc: '3094-0', display: 'Urea', unit: 'mmol/L', low: 2.5, high: 7.8, criticalHigh: 40, decimals: 1 },
      { loinc: '2160-0', display: 'Creatinine', unit: 'umol/L', low: 60, high: 110, criticalHigh: 300, decimals: 0 },
    ],
  },
  {
    key: 'CRP',
    code: '1988-5',
    display: 'C-reactive protein',
    category: 'LAB',
    analytes: [
      { loinc: '1988-5', display: 'C-reactive protein', unit: 'mg/L', low: 0, high: 5, criticalHigh: 200, decimals: 0 },
    ],
  },
  {
    key: 'CXR',
    code: '399208008',
    display: 'Chest X-ray',
    category: 'RAD',
    imaging: true,
  },
];

/** Normal and abnormal narrative options for the chest X-ray study. */
export const CXR_FINDINGS = {
  normal: [
    'Clear lung fields. Normal cardiomediastinal contour. No effusion or pneumothorax.',
    'No focal consolidation, effusion or pneumothorax. Heart size within normal limits.',
  ],
  abnormal: [
    'Right basal consolidation in keeping with pneumonia. No effusion.',
    'Bilateral interstitial shadowing consistent with pulmonary oedema. Cardiomegaly noted.',
    'Left-sided pleural effusion with associated basal atelectasis.',
  ],
} as const;

/** Classify a numeric value against an analyte's reference and critical ranges. */
export function classify(analyte: Analyte, value: number): ResultFlag {
  if (analyte.criticalLow !== undefined && value <= analyte.criticalLow) return 'critical';
  if (analyte.criticalHigh !== undefined && value >= analyte.criticalHigh) return 'critical';
  if (value < analyte.low) return 'low';
  if (value > analyte.high) return 'high';
  return 'normal';
}

/** Human-readable reference range, e.g. "135–145 mmol/L". */
export function referenceRangeText(analyte: Analyte): string {
  return `${analyte.low}\u2013${analyte.high} ${analyte.unit}`;
}

/** Severity ordering so a report can surface its single worst result. */
export const FLAG_SEVERITY: Record<ResultFlag, number> = {
  normal: 0,
  low: 2,
  high: 2,
  abnormal: 2,
  critical: 3,
};

export const LOINC_SYSTEM = CodeSystems.LOINC;
export const SNOMED_SYSTEM = CodeSystems.SNOMED;
