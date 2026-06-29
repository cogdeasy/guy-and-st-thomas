import type { Reference } from '@trustos/ontology';
import type { Entity } from '../../store/store';

export type Prophylaxis = 'mechanical' | 'pharmacological' | 'none';

/**
 * A VTE risk assessment record. Stored in this module's own `VteAssessment`
 * collection (free-form, validated at the route layer with zod) so the shared
 * FHIR ontology is left untouched.
 */
export interface VteAssessment extends Entity {
  patient: Reference;
  encounter: Reference;
  riskFactors: string[];
  bleedingRiskFactors: string[];
  prophylaxisRecommended: Prophylaxis;
  completed: boolean;
  assessedAt: string;
  assessedBy?: Reference;
}

/** NICE thrombosis (VTE) risk factors for adult inpatients. */
export const VTE_RISK_FACTORS = [
  'Active cancer or cancer treatment',
  'Age over 60',
  'Dehydration',
  'Known thrombophilia',
  'Obesity (BMI ≥ 30)',
  'One or more significant medical comorbidities',
  'Personal or first-degree family history of VTE',
  'Use of hormone replacement therapy',
  'Use of oestrogen-containing contraceptive therapy',
  'Varicose veins with phlebitis',
  'Significantly reduced mobility for 3 days or more',
  'Hip or knee replacement',
  'Hip fracture',
] as const;

/** NICE bleeding risk factors that may contra-indicate pharmacological VTE prophylaxis. */
export const BLEEDING_RISK_FACTORS = [
  'Active bleeding',
  'Acquired bleeding disorder (e.g. acute liver failure)',
  'Concurrent use of anticoagulants',
  'Acute stroke',
  'Thrombocytopenia (platelets < 75)',
  'Uncontrolled systolic hypertension (≥ 230/120 mmHg)',
  'Untreated inherited bleeding disorder',
  'Lumbar puncture / epidural in the previous 4 hours',
] as const;

/**
 * NICE recommendation logic: offer pharmacological prophylaxis when VTE risk
 * outweighs bleeding risk; fall back to mechanical prophylaxis when bleeding
 * risk is present, and none when neither applies.
 */
export function recommendProphylaxis(
  riskFactors: string[],
  bleedingRiskFactors: string[],
): Prophylaxis {
  if (riskFactors.length === 0) return 'none';
  return bleedingRiskFactors.length > 0 ? 'mechanical' : 'pharmacological';
}
