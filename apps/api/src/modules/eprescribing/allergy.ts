import type { AllergyIntolerance } from '@trustos/ontology';

/**
 * Known cross-sensitivity groups. A documented allergy to the key implies a
 * potential reaction to any member drug or drug class in the list. This is a
 * deliberately small, demo-grade decision-support table.
 */
const CROSS_SENSITIVITY: Record<string, string[]> = {
  Penicillin: [
    'Penicillin',
    'Amoxicillin',
    'Co-amoxiclav',
    'Flucloxacillin',
    'Benzylpenicillin',
    'Piperacillin',
  ],
  Ibuprofen: ['Ibuprofen', 'NSAID', 'Naproxen', 'Diclofenac', 'Aspirin'],
};

export type AllergySeverity = 'contraindicated' | 'caution';

export interface AllergyWarning {
  allergen: string;
  criticality: AllergyIntolerance['criticality'];
  severity: AllergySeverity;
  reactions: string[];
  message: string;
}

function allergenName(a: AllergyIntolerance): string {
  return (a.code?.text ?? a.code?.coding?.[0]?.display ?? '').trim();
}

/**
 * Return any allergy alerts triggered by prescribing `drug` to a patient with
 * the given active allergies. A `high` criticality match is treated as a hard
 * contraindication; anything else is a caution.
 */
export function checkAllergies(
  drug: { display: string; drugClass: string },
  allergies: AllergyIntolerance[],
): AllergyWarning[] {
  const warnings: AllergyWarning[] = [];
  for (const allergy of allergies) {
    const allergen = allergenName(allergy);
    if (!allergen) continue;

    const conflicts = CROSS_SENSITIVITY[allergen] ?? [allergen];
    const lowered = conflicts.map((c) => c.toLowerCase());
    const matches =
      lowered.includes(drug.display.toLowerCase()) ||
      lowered.includes(drug.drugClass.toLowerCase()) ||
      allergen.toLowerCase() === drug.display.toLowerCase() ||
      allergen.toLowerCase() === drug.drugClass.toLowerCase();

    if (!matches) continue;

    warnings.push({
      allergen,
      criticality: allergy.criticality,
      severity: allergy.criticality === 'high' ? 'contraindicated' : 'caution',
      reactions: allergy.reactionManifestation ?? [],
      message: `Documented ${allergen} allergy — ${drug.display} (${drug.drugClass}) may cross-react.`,
    });
  }
  return warnings;
}
