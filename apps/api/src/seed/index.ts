import {
  CodeSystems,
  GSTT_SITES,
  SPECIALTIES,
  generateNhsNumber,
  type Patient,
  type Practitioner,
  type Organization,
  type Location,
  type Encounter,
  type Observation,
  type Condition,
  type AllergyIntolerance,
} from '@trustos/ontology';
import { isoDaysAgo, nowIso, pick, randInt, ref } from '@trustos/core';
import type { ModuleContext } from '../modules/types';

const FIRST_NAMES = [
  'Oliver', 'Amelia', 'Harry', 'Isla', 'George', 'Ava', 'Noah', 'Mia', 'Leo', 'Grace',
  'Mohammed', 'Aisha', 'Chidi', 'Ngozi', 'Wei', 'Mei', 'Sanjay', 'Priya', 'Sofia', 'Lucas',
  'Eleanor', 'Arthur', 'Florence', 'Theodore', 'Maryam', 'Ibrahim', 'Esther', 'Samuel',
];
const LAST_NAMES = [
  'Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Patel', 'Okafor', 'Adebayo',
  'Chen', 'Nguyen', 'Khan', 'Ahmed', 'Murphy', 'Walsh', 'Evans', 'Roberts', 'Clarke',
  'Hughes', 'Mensah', 'Osei', 'Kowalski', 'Rossi', 'Garcia', 'Dubois',
];

const CONDITIONS: Array<{ code: string; display: string }> = [
  { code: '38341003', display: 'Hypertension' },
  { code: '44054006', display: 'Type 2 diabetes mellitus' },
  { code: '195967001', display: 'Asthma' },
  { code: '13645005', display: 'COPD' },
  { code: '84114007', display: 'Heart failure' },
  { code: '90688005', display: 'Chronic kidney disease' },
  { code: '49436004', display: 'Atrial fibrillation' },
  { code: '35489007', display: 'Depression' },
];

const ALLERGENS = [
  { code: '372687004', display: 'Penicillin', reactions: ['Anaphylaxis', 'Urticaria'] },
  { code: '256349002', display: 'Peanut', reactions: ['Anaphylaxis'] },
  { code: '227037002', display: 'Shellfish', reactions: ['Angioedema'] },
  { code: '387207008', display: 'Ibuprofen', reactions: ['Rash'] },
];

export interface CoreSeedResult {
  trust: Organization;
  practitioners: Practitioner[];
  patients: Patient[];
}

/** Seed baseline trust structure, staff and a cohort of patients. */
export function seedCore(ctx: ModuleContext): CoreSeedResult {
  const { store, rng } = ctx;

  const trust = store.create<Organization>('Organization', {
    name: "Guy's and St Thomas' NHS Foundation Trust",
    type: 'NHS Foundation Trust',
    identifier: [{ system: CodeSystems.ODS, value: 'RJ1' }],
    active: true,
  });

  // Sites + a few wards and beds per site.
  for (const siteName of GSTT_SITES) {
    const site = store.create<Location>('Location', {
      name: siteName,
      physicalType: 'site',
      status: 'active',
      managingOrganization: { reference: ref('Organization', trust.id), display: trust.name },
    });
    const wardCount = randInt(2, 3, rng);
    for (let w = 0; w < wardCount; w++) {
      const ward = store.create<Location>('Location', {
        name: `${siteName.split(' ')[0]} Ward ${String.fromCharCode(65 + w)}`,
        physicalType: 'ward',
        status: 'active',
        partOf: { reference: ref('Location', site.id), display: site.name },
      });
      const bedCount = randInt(6, 10, rng);
      for (let b = 1; b <= bedCount; b++) {
        store.create<Location>('Location', {
          name: `${ward.name} Bed ${b}`,
          physicalType: 'bed',
          status: 'active',
          operationalStatus: rng() < 0.7 ? 'occupied' : 'available',
          partOf: { reference: ref('Location', ward.id), display: ward.name },
        });
      }
    }
  }

  // Practitioners across specialties.
  const practitioners: Practitioner[] = [];
  const roles = ['Consultant', 'Registrar', 'Junior Doctor', 'Staff Nurse', 'Pharmacist'];
  for (let i = 0; i < 30; i++) {
    const given = pick(FIRST_NAMES, rng);
    const family = pick(LAST_NAMES, rng);
    const role = pick(roles, rng);
    practitioners.push(
      store.create<Practitioner>('Practitioner', {
        name: [{ family, given: [given], prefix: [role === 'Staff Nurse' ? 'Nurse' : 'Dr'] }],
        role,
        specialty: pick(SPECIALTIES, rng),
        gmcNumber: String(randInt(1000000, 9999999, rng)),
        active: true,
      }),
    );
  }

  // Patients with demographics, problems, allergies, an encounter and vitals.
  const patients: Patient[] = [];
  for (let i = 0; i < 40; i++) {
    const given = pick(FIRST_NAMES, rng);
    const family = pick(LAST_NAMES, rng);
    const gender = rng() < 0.5 ? 'male' : 'female';
    const age = randInt(1, 95, rng);
    const birthYear = new Date().getUTCFullYear() - age;
    const birthDate = `${birthYear}-${pad(randInt(1, 12, rng))}-${pad(randInt(1, 28, rng))}`;
    const patient = store.create<Patient>('Patient', {
      identifier: [
        { system: CodeSystems.NHS_NUMBER, value: generateNhsNumber(rng), use: 'official' },
        { system: CodeSystems.GSTT_MRN, value: `M${randInt(100000, 999999, rng)}`, use: 'usual' },
      ],
      name: [{ family, given: [given], use: 'official' }],
      gender,
      birthDate,
      active: true,
      address: [
        {
          line: [`${randInt(1, 200, rng)} ${pick(LAST_NAMES, rng)} Road`],
          city: 'London',
          postalCode: `SE1 ${randInt(1, 9, rng)}${pick(['AA', 'BB', 'RT', 'XY'], rng)}`,
          country: 'United Kingdom',
          use: 'home',
        },
      ],
      telecom: [{ system: 'phone', value: `07${randInt(100000000, 999999999, rng)}`, use: 'mobile' }],
      ethnicity: pick(['White British', 'Black African', 'Asian Indian', 'Mixed', 'Other'], rng),
      preferredLanguage: rng() < 0.85 ? 'English' : pick(['Bengali', 'Polish', 'Spanish'], rng),
    });
    patients.push(patient);

    // Problems
    const problemCount = randInt(0, 3, rng);
    for (let p = 0; p < problemCount; p++) {
      const c = pick(CONDITIONS, rng);
      store.create<Condition>('Condition', {
        code: { coding: [{ system: CodeSystems.SNOMED, code: c.code, display: c.display }], text: c.display },
        subject: { reference: ref('Patient', patient.id), display: `${given} ${family}` },
        clinicalStatus: 'active',
        verificationStatus: 'confirmed',
        category: 'problem-list-item',
        recordedDate: isoDaysAgo(randInt(30, 1500, rng)),
      });
    }

    // Allergies
    if (rng() < 0.4) {
      const a = pick(ALLERGENS, rng);
      store.create<AllergyIntolerance>('AllergyIntolerance', {
        code: { coding: [{ system: CodeSystems.SNOMED, code: a.code, display: a.display }], text: a.display },
        patient: { reference: ref('Patient', patient.id), display: `${given} ${family}` },
        criticality: rng() < 0.5 ? 'high' : 'low',
        category: a.display === 'Penicillin' || a.display === 'Ibuprofen' ? 'medication' : 'food',
        reactionManifestation: a.reactions,
        recordedDate: isoDaysAgo(randInt(100, 2000, rng)),
      });
    }

    // Active inpatient encounter for ~40% with vitals
    if (rng() < 0.4) {
      const consultant = pick(practitioners, rng);
      const encounter = store.create<Encounter>('Encounter', {
        status: 'in-progress',
        class: 'inpatient',
        subject: { reference: ref('Patient', patient.id), display: `${given} ${family}` },
        participant: [{ reference: ref('Practitioner', consultant.id) }],
        period: { start: isoDaysAgo(randInt(0, 10, rng)) },
        specialty: consultant.specialty,
        reasonText: pick(['Chest pain', 'Shortness of breath', 'Abdominal pain', 'Fall', 'Sepsis review'], rng),
      });
      seedVitals(ctx, patient, encounter);
    }
  }

  store.create('Organization', {
    name: 'Demo seed marker',
    type: 'meta',
    active: false,
  });

  return { trust, practitioners, patients };
}

function seedVitals(ctx: ModuleContext, patient: Patient, encounter: Encounter): void {
  const { store, rng } = ctx;
  const subject = { reference: ref('Patient', patient.id) };
  const enc = { reference: ref('Encounter', encounter.id) };
  const obs = (code: string, display: string, value: number, unit: string) =>
    store.create<Observation>('Observation', {
      status: 'final',
      category: 'vital-signs',
      code: { coding: [{ system: CodeSystems.LOINC, code, display }], text: display },
      subject,
      encounter: enc,
      effectiveDateTime: nowIso(),
      valueQuantity: { value, unit },
    });
  obs('8867-4', 'Heart rate', randInt(55, 120, rng), 'bpm');
  obs('9279-1', 'Respiratory rate', randInt(12, 26, rng), '/min');
  obs('2708-6', 'Oxygen saturation', randInt(90, 100, rng), '%');
  obs('8310-5', 'Body temperature', Number((36 + rng() * 2.5).toFixed(1)), 'Cel');
  obs('8480-6', 'Systolic blood pressure', randInt(95, 160, rng), 'mmHg');
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
