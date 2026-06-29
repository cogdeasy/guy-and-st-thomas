import { CodeSystems } from '@trustos/ontology';

/**
 * Static, clinically-credible order catalogue for the Diagnostic & Procedure
 * Orders (CPOE) module. Each orderable maps to a real terminology code
 * (LOINC for pathology, SNOMED CT for imaging/procedures) and the FHIR
 * `ServiceRequest.category` it is filed under.
 */

export type OrderCategory = 'laboratory' | 'imaging' | 'cardiology' | 'microbiology';

export interface CatalogueItem {
  /** URL-safe id used by POST /order. */
  id: string;
  /** Human-readable orderable name. */
  name: string;
  category: OrderCategory;
  /** Terminology system URI (LOINC or SNOMED CT). */
  system: string;
  code: string;
  /** Preferred terminology display term. */
  display: string;
  /** Specimen (pathology/microbiology) or modality (imaging). */
  specimen?: string;
  modality?: string;
  /** Typical turnaround in hours — surfaced to clinicians as expected wait. */
  turnaroundHours: number;
  /** Short clinical hint shown in the catalogue UI. */
  hint?: string;
}

export const ORDER_CATEGORY_LABELS: Record<OrderCategory, string> = {
  laboratory: 'Pathology / Bloods',
  imaging: 'Imaging / Radiology',
  cardiology: 'Cardiac Investigations',
  microbiology: 'Microbiology',
};

export const ORDER_CATALOGUE: readonly CatalogueItem[] = [
  // --- Pathology / bloods (LOINC) ---
  {
    id: 'fbc',
    name: 'Full Blood Count (FBC)',
    category: 'laboratory',
    system: CodeSystems.LOINC,
    code: '58410-2',
    display: 'CBC panel - Blood by Automated count',
    specimen: 'EDTA whole blood',
    turnaroundHours: 2,
    hint: 'Haemoglobin, white cells and platelets.',
  },
  {
    id: 'ue',
    name: 'Urea & Electrolytes (U&E)',
    category: 'laboratory',
    system: CodeSystems.LOINC,
    code: '24362-6',
    display: 'Renal function panel - Serum or Plasma',
    specimen: 'Serum (gold top)',
    turnaroundHours: 2,
    hint: 'Sodium, potassium, urea and creatinine.',
  },
  {
    id: 'crp',
    name: 'C-Reactive Protein (CRP)',
    category: 'laboratory',
    system: CodeSystems.LOINC,
    code: '1988-5',
    display: 'C reactive protein - Serum or Plasma',
    specimen: 'Serum (gold top)',
    turnaroundHours: 2,
    hint: 'Acute-phase marker of inflammation/infection.',
  },
  {
    id: 'lft',
    name: 'Liver Function Tests (LFT)',
    category: 'laboratory',
    system: CodeSystems.LOINC,
    code: '24325-3',
    display: 'Hepatic function panel - Serum or Plasma',
    specimen: 'Serum (gold top)',
    turnaroundHours: 3,
    hint: 'ALT, ALP, bilirubin and albumin.',
  },
  {
    id: 'coag',
    name: 'Coagulation Screen',
    category: 'laboratory',
    system: CodeSystems.LOINC,
    code: '34534-8',
    display: 'Coagulation panel - Platelet poor plasma',
    specimen: 'Citrate (blue top)',
    turnaroundHours: 2,
    hint: 'PT/INR and APTT.',
  },
  {
    id: 'trop',
    name: 'High-Sensitivity Troponin',
    category: 'laboratory',
    system: CodeSystems.LOINC,
    code: '67151-1',
    display: 'Troponin T.cardiac [Mass/Vol] by High sensitivity method',
    specimen: 'Serum (gold top)',
    turnaroundHours: 1,
    hint: 'Myocardial injury marker for chest pain.',
  },

  // --- Imaging / radiology (SNOMED CT) ---
  {
    id: 'cxr',
    name: 'Chest X-ray (CXR)',
    category: 'imaging',
    system: CodeSystems.SNOMED,
    code: '399208008',
    display: 'Plain chest X-ray',
    modality: 'X-ray (CR)',
    turnaroundHours: 4,
    hint: 'PA/AP film for cardiorespiratory assessment.',
  },
  {
    id: 'ct-head',
    name: 'CT Head',
    category: 'imaging',
    system: CodeSystems.SNOMED,
    code: '303653007',
    display: 'Computed tomography of head',
    modality: 'CT',
    turnaroundHours: 6,
    hint: 'First-line for acute neurology / trauma.',
  },
  {
    id: 'ct-abdo',
    name: 'CT Abdomen & Pelvis',
    category: 'imaging',
    system: CodeSystems.SNOMED,
    code: '169070004',
    display: 'Computed tomography of abdomen and pelvis',
    modality: 'CT',
    turnaroundHours: 8,
    hint: 'Acute abdomen / staging.',
  },
  {
    id: 'us-abdo',
    name: 'Ultrasound Abdomen',
    category: 'imaging',
    system: CodeSystems.SNOMED,
    code: '45036003',
    display: 'Ultrasonography of abdomen',
    modality: 'Ultrasound',
    turnaroundHours: 12,
    hint: 'Liver, biliary tree and renal tract.',
  },

  // --- Cardiac investigations ---
  {
    id: 'ecg',
    name: '12-Lead ECG',
    category: 'cardiology',
    system: CodeSystems.LOINC,
    code: '11524-6',
    display: 'EKG study',
    modality: '12-lead ECG',
    turnaroundHours: 1,
    hint: 'Rhythm and ischaemia assessment.',
  },

  // --- Microbiology (SNOMED CT) ---
  {
    id: 'wound-swab',
    name: 'Wound Swab MC&S',
    category: 'microbiology',
    system: CodeSystems.SNOMED,
    code: '697989009',
    display: 'Swab of wound',
    specimen: 'Wound swab (charcoal)',
    turnaroundHours: 48,
    hint: 'Microscopy, culture and sensitivities.',
  },
  {
    id: 'urine-cs',
    name: 'Urine MC&S',
    category: 'microbiology',
    system: CodeSystems.SNOMED,
    code: '122575003',
    display: 'Urine specimen',
    specimen: 'Mid-stream urine',
    turnaroundHours: 36,
    hint: 'Suspected urinary tract infection.',
  },
  {
    id: 'blood-culture',
    name: 'Blood Cultures',
    category: 'microbiology',
    system: CodeSystems.SNOMED,
    code: '432089005',
    display: 'Specimen from blood for culture',
    specimen: 'Aerobic + anaerobic bottles',
    turnaroundHours: 72,
    hint: 'Suspected sepsis / bacteraemia.',
  },
  {
    id: 'mrsa-screen',
    name: 'MRSA Screen',
    category: 'microbiology',
    system: CodeSystems.SNOMED,
    code: '702475000',
    display: 'Methicillin resistant Staphylococcus aureus screening',
    specimen: 'Nose + groin swab',
    turnaroundHours: 48,
    hint: 'Infection prevention admission screen.',
  },
];

export function findCatalogueItem(id: string): CatalogueItem | undefined {
  return ORDER_CATALOGUE.find((item) => item.id === id);
}

export function catalogueByCode(system: string, code: string): CatalogueItem | undefined {
  return ORDER_CATALOGUE.find((item) => item.system === system && item.code === code);
}
