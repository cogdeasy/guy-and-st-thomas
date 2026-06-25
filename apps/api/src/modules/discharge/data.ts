import type { TtoMed } from './model';

/** Common discharge ("to take out") medications for demo seeding. */
export const COMMON_TTOS: readonly TtoMed[] = [
  { medication: 'Amoxicillin 500mg capsules', dose: '500mg', route: 'Oral', frequency: 'Three times daily', quantity: '21 capsules' },
  { medication: 'Atorvastatin 40mg tablets', dose: '40mg', route: 'Oral', frequency: 'Once daily at night', quantity: '28 tablets' },
  { medication: 'Bisoprolol 2.5mg tablets', dose: '2.5mg', route: 'Oral', frequency: 'Once daily', quantity: '28 tablets' },
  { medication: 'Ramipril 5mg capsules', dose: '5mg', route: 'Oral', frequency: 'Once daily', quantity: '28 capsules' },
  { medication: 'Furosemide 40mg tablets', dose: '40mg', route: 'Oral', frequency: 'Once daily in the morning', quantity: '28 tablets' },
  { medication: 'Apixaban 5mg tablets', dose: '5mg', route: 'Oral', frequency: 'Twice daily', quantity: '56 tablets' },
  { medication: 'Paracetamol 500mg tablets', dose: '1g', route: 'Oral', frequency: 'Four times daily as required', quantity: '32 tablets' },
  { medication: 'Salbutamol 100mcg inhaler', dose: '2 puffs', route: 'Inhaled', frequency: 'As required', quantity: '1 inhaler' },
  { medication: 'Omeprazole 20mg capsules', dose: '20mg', route: 'Oral', frequency: 'Once daily', quantity: '28 capsules' },
  { medication: 'Dalteparin 5000units injection', dose: '5000 units', route: 'Subcutaneous', frequency: 'Once daily', quantity: '7 syringes' },
];

/** Primary discharge diagnoses used for demo seeding. */
export const PRIMARY_DIAGNOSES: readonly string[] = [
  'Community-acquired pneumonia, resolving',
  'Acute exacerbation of COPD',
  'Decompensated heart failure, now euvolaemic',
  'Lower urinary tract infection',
  'Cellulitis of left lower limb',
  'Non-ST elevation myocardial infarction',
  'Mechanical fall with soft-tissue injury',
  'Acute kidney injury, stage 1, resolved',
];

/** Follow-up arrangements used for demo seeding. */
export const FOLLOW_UPS: readonly string[] = [
  'Cardiology outpatient clinic in 6 weeks',
  'Respiratory clinic in 4 weeks with repeat spirometry',
  'GP review in 1 week for blood pressure check',
  'District nurse for daily wound dressing',
  'Heart failure specialist nurse telephone review in 2 weeks',
  'Ambulatory care for repeat bloods (U&Es) in 3 days',
];
