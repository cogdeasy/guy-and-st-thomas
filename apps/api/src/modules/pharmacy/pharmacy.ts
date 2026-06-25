import { z } from 'zod';
import type { AllergyIntolerance, MedicationRequest } from '@trustos/ontology';

/** Custom (non-ontology) collection owned by this module. */
export const DISPENSE_COLLECTION = 'DispenseRecord';

export const DispenseStatus = z.enum(['to-verify', 'verified', 'dispensed', 'query']);
export type DispenseStatus = z.infer<typeof DispenseStatus>;

const DispenseHistoryEntry = z.object({
  status: DispenseStatus,
  at: z.string(),
  by: z.string().optional(),
  note: z.string().optional(),
});

/**
 * A pharmacy dispense record tracks one prescription through clinical
 * verification and dispensing. It references a core `MedicationRequest` rather
 * than duplicating its data, keeping the prescribing source of truth intact.
 */
export const DispenseRecordSchema = z
  .object({
    id: z.string(),
    resourceType: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
    medicationRequest: z
      .string()
      .describe('Reference to the MedicationRequest, e.g. MedicationRequest/<id>'),
    patient: z.string().describe('Reference to the Patient, e.g. Patient/<id>'),
    status: DispenseStatus.default('to-verify'),
    priority: z.enum(['routine', 'urgent', 'asap', 'stat']).default('routine'),
    pharmacist: z.string().optional().describe('Reference to the verifying Practitioner'),
    note: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    history: z.array(DispenseHistoryEntry).default([]),
  })
  .passthrough();

export type DispenseRecord = z.infer<typeof DispenseRecordSchema> & { id: string };

export interface CatalogueDrug {
  code: string;
  name: string;
  /** SNOMED-style allergen class keys this drug belongs to (for screening). */
  classes: string[];
  dose: string;
  route: string;
  frequency: string;
  dispenseQuantity?: string;
  asNeeded?: boolean;
}

/** A small, clinically credible inpatient formulary for demo seeding. */
export const MEDICATION_CATALOGUE: CatalogueDrug[] = [
  {
    code: '27658006',
    name: 'Amoxicillin 500mg capsules',
    classes: ['penicillin'],
    dose: '500mg',
    route: 'Oral',
    frequency: 'TDS',
    dispenseQuantity: '21 capsules',
  },
  {
    code: '350354000',
    name: 'Co-amoxiclav 625mg tablets',
    classes: ['penicillin'],
    dose: '625mg',
    route: 'Oral',
    frequency: 'TDS',
    dispenseQuantity: '21 tablets',
  },
  {
    code: '387517004',
    name: 'Paracetamol 1g tablets',
    classes: [],
    dose: '1g',
    route: 'Oral',
    frequency: 'QDS',
    dispenseQuantity: '28 tablets',
  },
  {
    code: '387207008',
    name: 'Ibuprofen 400mg tablets',
    classes: ['nsaid'],
    dose: '400mg',
    route: 'Oral',
    frequency: 'TDS PRN',
    dispenseQuantity: '30 tablets',
    asNeeded: true,
  },
  {
    code: '108774000',
    name: 'Omeprazole 20mg capsules',
    classes: [],
    dose: '20mg',
    route: 'Oral',
    frequency: 'OD',
    dispenseQuantity: '28 capsules',
  },
  {
    code: '387475002',
    name: 'Furosemide 40mg tablets',
    classes: [],
    dose: '40mg',
    route: 'Oral',
    frequency: 'OD',
    dispenseQuantity: '28 tablets',
  },
  {
    code: '108972005',
    name: 'Enoxaparin 40mg/0.4ml injection',
    classes: [],
    dose: '40mg',
    route: 'Subcutaneous',
    frequency: 'OD',
    dispenseQuantity: '7 syringes',
  },
  {
    code: '376209006',
    name: 'Bisoprolol 2.5mg tablets',
    classes: [],
    dose: '2.5mg',
    route: 'Oral',
    frequency: 'OD',
    dispenseQuantity: '28 tablets',
  },
  {
    code: '373529000',
    name: 'Gentamicin 80mg/2ml injection',
    classes: [],
    dose: '80mg',
    route: 'IV',
    frequency: 'OD',
    dispenseQuantity: '3 vials',
  },
  {
    code: '372487007',
    name: 'Ondansetron 4mg tablets',
    classes: [],
    dose: '4mg',
    route: 'Oral',
    frequency: 'BD PRN',
    dispenseQuantity: '10 tablets',
    asNeeded: true,
  },
  {
    code: '373529001',
    name: 'Morphine sulfate 10mg/ml injection',
    classes: ['opioid'],
    dose: '10mg',
    route: 'IV',
    frequency: 'PRN',
    dispenseQuantity: '5 ampoules',
    asNeeded: true,
  },
  {
    code: '376683000',
    name: 'Atorvastatin 40mg tablets',
    classes: [],
    dose: '40mg',
    route: 'Oral',
    frequency: 'ON',
    dispenseQuantity: '28 tablets',
  },
];

const CATALOGUE_BY_CODE = new Map(MEDICATION_CATALOGUE.map((d) => [d.code, d]));

/**
 * Detect prescriptions that conflict with a patient's documented allergies.
 * Matches on shared allergen class (e.g. penicillin) and on direct name/text
 * overlap, mirroring a basic clinical decision-support check.
 */
export function detectAllergyConflicts(
  medication: MedicationRequest,
  allergies: AllergyIntolerance[],
): AllergyIntolerance[] {
  const code = medication.medication?.coding?.[0]?.code;
  const drug = code ? CATALOGUE_BY_CODE.get(code) : undefined;
  const drugClasses = new Set(drug?.classes ?? []);
  const drugText = (medication.medication?.text ?? '').toLowerCase();

  return allergies.filter((allergy) => {
    const allergen = (allergy.code?.text ?? allergy.code?.coding?.[0]?.display ?? '').toLowerCase();
    if (!allergen) return false;
    if (drugClasses.has('penicillin') && allergen.includes('penicillin')) return true;
    if (drugClasses.has('nsaid') && (allergen.includes('ibuprofen') || allergen.includes('nsaid')))
      return true;
    return drugText.includes(allergen) || allergen.includes(drugText);
  });
}
