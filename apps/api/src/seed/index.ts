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
import { isoDaysAgo, pick, randInt, ref } from '@trustos/core';
import type { ModuleContext } from '../modules/types';

const FIRST_NAMES = [
  'Oliver', 'Amelia', 'Harry', 'Isla', 'George', 'Ava', 'Noah', 'Mia', 'Leo', 'Grace',
  'Mohammed', 'Aisha', 'Chidi', 'Ngozi', 'Wei', 'Mei', 'Sanjay', 'Priya', 'Sofia', 'Lucas',
  'Eleanor', 'Arthur', 'Florence', 'Theodore', 'Maryam', 'Ibrahim', 'Esther', 'Samuel',
  'Freya', 'Jack', 'Lily', 'Oscar', 'Poppy', 'Charlie', 'Daisy', 'Henry', 'Zara', 'Reuben',
  'Yusuf', 'Fatima', 'Olu', 'Kemi', 'Hannah', 'Joseph', 'Maria', 'Anton', 'Lena', 'Raj',
  'Sara', 'David', 'Elena', 'Tomasz', 'Aoife', 'Ciaran', 'Niamh', 'Bilal', 'Layla', 'Marcus',
];
const LAST_NAMES = [
  'Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Patel', 'Okafor', 'Adebayo',
  'Chen', 'Nguyen', 'Khan', 'Ahmed', 'Murphy', 'Walsh', 'Evans', 'Roberts', 'Clarke',
  'Hughes', 'Mensah', 'Osei', 'Kowalski', 'Rossi', 'Garcia', 'Dubois',
  'Begum', 'Ali', 'Hassan', 'Ndlovu', 'Santos', 'Müller', 'Iqbal', 'Fernandez', 'Park',
  'Lewis', 'Hall', 'Green', 'Wood', 'Harris', 'Martin', 'Thompson', 'Wright', 'Singh',
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
  { code: '73211009', display: 'Diabetes mellitus' },
  { code: '414545008', display: 'Ischaemic heart disease' },
  { code: '64859006', display: 'Osteoporosis' },
  { code: '396275006', display: 'Osteoarthritis' },
  { code: '370143000', display: 'Major depressive disorder' },
  { code: '235595009', display: 'Gastro-oesophageal reflux disease' },
  { code: '709044004', display: 'Chronic kidney disease stage 3' },
  { code: '267036007', display: 'Dyspnoea' },
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
    const wardCount = randInt(3, 4, rng);
    for (let w = 0; w < wardCount; w++) {
      const ward = store.create<Location>('Location', {
        name: `${siteName.split(' ')[0]} Ward ${String.fromCharCode(65 + w)}`,
        physicalType: 'ward',
        status: 'active',
        partOf: { reference: ref('Location', site.id), display: site.name },
      });
      const bedCount = randInt(12, 18, rng);
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
  for (let i = 0; i < 64; i++) {
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
  for (let i = 0; i < 120; i++) {
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
    const problemCount = randInt(1, 4, rng);
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

    // Active inpatient encounter for ~55% with vitals
    if (rng() < 0.55) {
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
  const obs = (code: string, display: string, value: number, unit: string, at: string) =>
    store.create<Observation>('Observation', {
      status: 'final',
      category: 'vital-signs',
      code: { coding: [{ system: CodeSystems.LOINC, code, display }], text: display },
      subject,
      encounter: enc,
      effectiveDateTime: at,
      valueQuantity: { value, unit },
    });

  // Most inpatients are physiologically stable; a minority are unwell or
  // actively deteriorating. This produces a realistic NEWS2 distribution
  // (mostly low, some medium, a few high) rather than everyone at the ceiling.
  const acuity = rng();
  // Three bands: stable (~66%), borderline (~24%), high acuity (~10%).
  const band = acuity > 0.92 ? 'high' : acuity > 0.68 ? 'mid' : 'stable';
  // Current (most recent) baseline per band, tuned to land in the intended
  // NEWS2 aggregate window — stable 0-3 (low), mid 5-6 (medium), high >=7.
  const hr0 = band === 'high' ? randInt(112, 128, rng) : band === 'mid' ? randInt(95, 104, rng) : randInt(60, 86, rng);
  const rr0 = band === 'high' ? randInt(25, 29, rng) : band === 'mid' ? randInt(21, 22, rng) : randInt(13, 18, rng);
  const spo20 = band === 'high' ? randInt(86, 90, rng) : band === 'mid' ? randInt(94, 95, rng) : randInt(96, 100, rng);
  const temp0 = band === 'high' ? 38.7 + rng() * 0.7 : band === 'mid' ? 38.1 + rng() * 0.4 : 36.3 + rng() * 0.9;
  const sbp0 = band === 'high' ? randInt(86, 98, rng) : band === 'mid' ? randInt(105, 111, rng) : randInt(114, 142, rng);

  // Historical readings wander around the baseline; the most recent (p=0)
  // equals the baseline so the scored NEWS2 reflects the patient's band.
  const points = 6;
  const jitter = (base: number, amp: number, p: number) =>
    Math.round(base + (p === 0 ? 0 : (rng() - 0.5) * amp));
  for (let p = points - 1; p >= 0; p--) {
    const at = hoursAgoIso(p * 5 + Math.floor(rng() * 2));
    obs('8867-4', 'Heart rate', jitter(hr0, 14, p), 'bpm', at);
    obs('9279-1', 'Respiratory rate', jitter(rr0, 5, p), '/min', at);
    obs('2708-6', 'Oxygen saturation', Math.min(100, jitter(spo20, 4, p)), '%', at);
    obs('8310-5', 'Body temperature', Number((temp0 + (p === 0 ? 0 : (rng() - 0.5) * 0.8)).toFixed(1)), 'Cel', at);
    obs('8480-6', 'Systolic blood pressure', jitter(sbp0, 18, p), 'mmHg', at);
  }
}

/** ISO timestamp `h` hours before the (frozen-during-seed) clock. */
function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
