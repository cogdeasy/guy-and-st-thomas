/**
 * A small inpatient formulary used by the E-Prescribing module. Each entry
 * carries enough metadata to pre-populate the prescribe form and to drive
 * allergy cross-sensitivity checking. SNOMED CT codes are illustrative.
 */
export interface FormularyDrug {
  /** SNOMED CT concept id for the medicinal product. */
  code: string;
  display: string;
  /** Therapeutic/allergy class used for cross-sensitivity checking. */
  drugClass: string;
  form: string;
  routes: string[];
  defaultDose: string;
  defaultFrequency: string;
  /** Typically prescribed "as required" rather than on a regular schedule. */
  prnByDefault?: boolean;
}

export const ROUTES = ['Oral', 'IV', 'IM', 'Subcutaneous', 'Topical', 'Inhaled'] as const;
export type Route = (typeof ROUTES)[number];

/** Human-readable inpatient administration frequencies. */
export const FREQUENCIES = ['OD', 'BD', 'TDS', 'QDS', 'PRN', 'STAT', 'ONCE WEEKLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FORMULARY: FormularyDrug[] = [
  {
    code: '387517004',
    display: 'Paracetamol',
    drugClass: 'Analgesic',
    form: 'Tablet',
    routes: ['Oral', 'IV'],
    defaultDose: '1 g',
    defaultFrequency: 'QDS',
    prnByDefault: true,
  },
  {
    code: '350288003',
    display: 'Enoxaparin',
    drugClass: 'Anticoagulant',
    form: 'Pre-filled syringe',
    routes: ['Subcutaneous'],
    defaultDose: '40 mg',
    defaultFrequency: 'OD',
  },
  {
    code: '27658006',
    display: 'Amoxicillin',
    drugClass: 'Penicillin',
    form: 'Capsule',
    routes: ['Oral', 'IV'],
    defaultDose: '500 mg',
    defaultFrequency: 'TDS',
  },
  {
    code: '387137007',
    display: 'Omeprazole',
    drugClass: 'Proton pump inhibitor',
    form: 'Capsule',
    routes: ['Oral', 'IV'],
    defaultDose: '20 mg',
    defaultFrequency: 'OD',
  },
  {
    code: '387475002',
    display: 'Furosemide',
    drugClass: 'Diuretic',
    form: 'Tablet',
    routes: ['Oral', 'IV'],
    defaultDose: '40 mg',
    defaultFrequency: 'OD',
  },
];

export function findDrug(code: string): FormularyDrug | undefined {
  return FORMULARY.find((d) => d.code === code);
}
