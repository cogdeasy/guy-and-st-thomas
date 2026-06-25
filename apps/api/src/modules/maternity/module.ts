import { z } from 'zod';
import { ageFromBirthDate, BadRequest, isoDaysAgo, nowIso, pick, randInt, ref } from '@trustos/core';
import {
  CodeSystems,
  generateNhsNumber,
  type Location,
  type Patient,
  type Practitioner,
} from '@trustos/ontology';
import type { DataStore } from '../../store/store';
import { defineModule } from '../types';
import {
  BirthRecordEntity,
  DELIVERY_MODES,
  gestationFromEdd,
  PregnancyEpisodeEntity,
  RISK_FACTORS,
  trimester,
  type BirthRecord,
  type PregnancyEpisode,
} from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Maternity & Obstetrics — the Evelina / St Thomas' maternity pathway.
 *
 * Owns two custom collections (PregnancyEpisode, BirthRecord) layered on top of
 * the core FHIR Patient/Practitioner/Location resources, and exposes the
 * antenatal clinic list, the live labour-ward board and the birth-recording
 * state transition that moves a woman from intrapartum to postnatal care.
 */
export default defineModule({
  id: 'maternity',
  name: 'Maternity & Obstetrics',
  description: 'Antenatal clinic, live labour-ward board and birth records across the maternity pathway.',

  collections: [
    { name: 'PregnancyEpisode', validator: (i) => PregnancyEpisodeEntity.parse(i) },
    { name: 'BirthRecord', validator: (i) => BirthRecordEntity.parse(i) },
  ],

  routes(app, { store }) {
    // Pathway-wide counts for the command-centre header.
    app.get('/summary', async () => {
      const episodes = store.list<PregnancyEpisode>('PregnancyEpisode');
      const births = store.list<BirthRecord>('BirthRecord');
      const byStatus = (s: PregnancyEpisode['status']) => episodes.filter((e) => e.status === s).length;
      return {
        totalEpisodes: episodes.length,
        antenatal: byStatus('antenatal'),
        intrapartum: byStatus('intrapartum'),
        postnatal: byStatus('postnatal'),
        births: births.length,
        highRisk: episodes.filter((e) => e.riskFactors.length > 0 && e.status !== 'postnatal').length,
      };
    });

    // Antenatal clinic list: current antenatal women with live gestation + risk.
    app.get('/antenatal', async () => {
      const episodes = store
        .list<PregnancyEpisode>('PregnancyEpisode', { status: 'antenatal' })
        .map((e) => decorate(store, e))
        .sort((a, b) => b.gestationWeeks - a.gestationWeeks);
      return { total: episodes.length, items: episodes };
    });

    // Live labour-ward board: intrapartum women with bed, midwife and risk.
    app.get('/labour-ward', async () => {
      const episodes = store
        .list<PregnancyEpisode>('PregnancyEpisode', { status: 'intrapartum' })
        .map((e) => decorate(store, e))
        .sort((a, b) => (a.admittedAt ?? '').localeCompare(b.admittedAt ?? ''));
      return { total: episodes.length, items: episodes };
    });

    // Register a new pregnancy episode against an existing patient.
    const CreateBody = z.object({
      patientId: z.string().min(1),
      edd: z.string().min(1),
      parity: z.number().int().min(0).default(0),
      gravida: z.number().int().min(1).optional(),
      riskFactors: z.array(z.string()).default([]),
      status: z.enum(['antenatal', 'intrapartum', 'postnatal']).default('antenatal'),
      midwifeId: z.string().optional(),
    });
    app.post<{ Body: unknown }>('/episodes', async (req, reply) => {
      const body = CreateBody.parse(req.body);
      store.getOrThrow<Patient>('Patient', body.patientId);
      const created = store.create<PregnancyEpisode>('PregnancyEpisode', {
        patient: ref('Patient', body.patientId),
        edd: body.edd,
        gestationWeeks: gestationFromEdd(body.edd),
        parity: body.parity,
        gravida: body.gravida ?? body.parity + 1,
        riskFactors: body.riskFactors,
        status: body.status,
        midwife: body.midwifeId ? ref('Practitioner', body.midwifeId) : undefined,
        bookingDate: nowIso(),
        admittedAt: body.status === 'intrapartum' ? nowIso() : undefined,
      });
      reply.code(201);
      return decorate(store, created);
    });

    // Record a birth and transition the episode into postnatal care.
    const BirthBody = z.object({
      deliveryDateTime: z.string().min(1).optional(),
      mode: z.enum(DELIVERY_MODES),
      babyWeightGrams: z.number().int().min(200).max(7000),
      apgar1: z.number().int().min(0).max(10),
      apgar5: z.number().int().min(0).max(10),
      birthAttendantId: z.string().optional(),
    });
    app.post<{ Params: { id: string }; Body: unknown }>('/episodes/:id/birth', async (req, reply) => {
      const episode = store.getOrThrow<PregnancyEpisode>('PregnancyEpisode', req.params.id);
      if (episode.status === 'postnatal') {
        throw BadRequest('Birth already recorded for this pregnancy episode');
      }
      const body = BirthBody.parse(req.body);
      const birth = store.create<BirthRecord>('BirthRecord', {
        episode: ref('PregnancyEpisode', episode.id),
        patient: episode.patient,
        deliveryDateTime: body.deliveryDateTime ?? nowIso(),
        mode: body.mode,
        babyWeightGrams: body.babyWeightGrams,
        apgar1: body.apgar1,
        apgar5: body.apgar5,
        birthAttendant: body.birthAttendantId ? ref('Practitioner', body.birthAttendantId) : undefined,
      });
      const updated = store.update<PregnancyEpisode>('PregnancyEpisode', episode.id, {
        status: 'postnatal',
      });
      reply.code(201);
      return { episode: decorate(store, updated), birth };
    });

    // Full maternity record for a single patient: episodes + births.
    app.get<{ Params: { patientId: string } }>('/:patientId/record', async (req) => {
      const patient = store.getOrThrow<Patient>('Patient', req.params.patientId);
      const patientRef = ref('Patient', patient.id);
      const episodes = store
        .query<PregnancyEpisode>('PregnancyEpisode', (e) => e.patient === patientRef)
        .map((e) => decorate(store, e))
        .sort((a, b) => (b.bookingDate ?? '').localeCompare(a.bookingDate ?? ''));
      const births = store
        .query<BirthRecord>('BirthRecord', (b) => b.patient === patientRef)
        .sort((a, b) => b.deliveryDateTime.localeCompare(a.deliveryDateTime));
      return {
        patient,
        age: ageFromBirthDate(patient.birthDate),
        episodes,
        births,
      };
    });
  },

  seed({ store, rng }) {
    const beds = store.list<Location>('Location', { physicalType: 'bed' });
    const midwives = store.list<Practitioner>('Practitioner');
    const obstetricMidwives = midwives.filter(
      (p) => p.specialty === 'Obstetrics & Gynaecology' || p.role === 'Staff Nurse',
    );
    const midwifePool = obstetricMidwives.length > 0 ? obstetricMidwives : midwives;

    // Build a cohort of ~10 women of childbearing age. Prefer existing core
    // patients; the core seed only yields a handful of eligible women, so top
    // up by registering additional expectant mothers (additive — never edits
    // shared seed data).
    const TARGET_COHORT = 10;
    const existing = shuffle(
      store
        .list<Patient>('Patient')
        .filter((p) => p.gender === 'female')
        .filter((p) => {
          const age = ageFromBirthDate(p.birthDate);
          return age >= 16 && age <= 45;
        }),
      rng,
    ).slice(0, TARGET_COHORT);

    const cohort: Patient[] = [...existing];
    while (cohort.length < TARGET_COHORT) {
      cohort.push(registerExpectantMother(store, rng));
    }

    cohort.forEach((patient, index) => {
      // Distribution: most antenatal, a few intrapartum, a few postnatal.
      const status: PregnancyEpisode['status'] =
        index < 5 ? 'antenatal' : index < 8 ? 'intrapartum' : 'postnatal';

      const gestationWeeks =
        status === 'antenatal' ? randInt(6, 38, rng) : randInt(37, 41, rng);
      const edd = new Date(Date.now() + (40 - gestationWeeks) * WEEK_MS).toISOString();
      const riskFactors = pickRiskFactors(rng);
      const midwife = pick(midwifePool, rng);

      const episode = store.create<PregnancyEpisode>('PregnancyEpisode', {
        patient: ref('Patient', patient.id),
        edd,
        gestationWeeks,
        parity: randInt(0, 3, rng),
        gravida: randInt(1, 4, rng),
        riskFactors,
        status,
        midwife: ref('Practitioner', midwife.id),
        location:
          status === 'intrapartum' && beds.length > 0 ? ref('Location', pick(beds, rng).id) : undefined,
        bookingDate: isoDaysAgo(gestationWeeks * 7 - randInt(0, 14, rng), new Date()),
        admittedAt: status === 'intrapartum' ? isoDaysAgo(0, new Date()) : undefined,
      });

      // Postnatal women have a birth record.
      if (status === 'postnatal') {
        store.create<BirthRecord>('BirthRecord', {
          episode: ref('PregnancyEpisode', episode.id),
          patient: ref('Patient', patient.id),
          deliveryDateTime: isoDaysAgo(randInt(0, 3, rng), new Date()),
          mode: pick(DELIVERY_MODES, rng),
          babyWeightGrams: randInt(2500, 4200, rng),
          apgar1: randInt(5, 9, rng),
          apgar5: randInt(8, 10, rng),
          birthAttendant: ref('Practitioner', midwife.id),
        });
      }
    });
  },
});

interface DecoratedEpisode extends PregnancyEpisode {
  patientName: string;
  patientAge?: number;
  nhsNumber?: string;
  midwifeName?: string;
  bed?: string;
  trimester: 1 | 2 | 3;
  highRisk: boolean;
}

/** Resolve the references on an episode into display-friendly fields. */
function decorate(store: DataStore, episode: PregnancyEpisode): DecoratedEpisode {
  const patientId = episode.patient.split('/')[1] ?? '';
  const patient = store.get<Patient>('Patient', patientId);
  const name = patient?.name?.[0];
  const midwifeId = episode.midwife?.split('/')[1];
  const midwife = midwifeId ? store.get<Practitioner>('Practitioner', midwifeId) : undefined;
  const midwifeName = midwife?.name?.[0];
  const bedId = episode.location?.split('/')[1];
  const bed = bedId ? store.get<Location>('Location', bedId) : undefined;
  const gestationWeeks = gestationFromEdd(episode.edd);

  return {
    ...episode,
    gestationWeeks,
    patientName: name ? `${name.given?.join(' ') ?? ''} ${name.family ?? ''}`.trim() : 'Unknown',
    patientAge: patient ? ageFromBirthDate(patient.birthDate) : undefined,
    nhsNumber: patient?.identifier?.find((i) => i.system === CodeSystems.NHS_NUMBER)?.value,
    midwifeName: midwifeName
      ? `${midwifeName.prefix?.join(' ') ?? ''} ${midwifeName.given?.join(' ') ?? ''} ${midwifeName.family ?? ''}`.trim()
      : undefined,
    bed: bed?.name,
    trimester: trimester(gestationWeeks),
    highRisk: episode.riskFactors.length > 0,
  };
}

const MOTHER_FIRST_NAMES = [
  'Amelia', 'Isla', 'Ava', 'Mia', 'Grace', 'Aisha', 'Ngozi', 'Mei', 'Priya', 'Sofia',
  'Eleanor', 'Florence', 'Maryam', 'Esther', 'Chloe', 'Layla', 'Zara', 'Hannah',
];
const MOTHER_LAST_NAMES = [
  'Smith', 'Jones', 'Taylor', 'Patel', 'Okafor', 'Adebayo', 'Chen', 'Nguyen', 'Khan',
  'Murphy', 'Walsh', 'Roberts', 'Mensah', 'Osei', 'Kowalski', 'Rossi', 'Garcia', 'Dubois',
];

/** Register a new female patient of childbearing age to flesh out the cohort. */
function registerExpectantMother(store: DataStore, rng: () => number): Patient {
  const given = pick(MOTHER_FIRST_NAMES, rng);
  const family = pick(MOTHER_LAST_NAMES, rng);
  const age = randInt(19, 42, rng);
  const birthYear = new Date().getUTCFullYear() - age;
  const birthDate = `${birthYear}-${pad(randInt(1, 12, rng))}-${pad(randInt(1, 28, rng))}`;
  return store.create<Patient>('Patient', {
    identifier: [
      { system: CodeSystems.NHS_NUMBER, value: generateNhsNumber(rng), use: 'official' },
      { system: CodeSystems.GSTT_MRN, value: `M${randInt(100000, 999999, rng)}`, use: 'usual' },
    ],
    name: [{ family, given: [given], use: 'official' }],
    gender: 'female',
    birthDate,
    active: true,
    address: [
      {
        line: [`${randInt(1, 200, rng)} ${pick(MOTHER_LAST_NAMES, rng)} Road`],
        city: 'London',
        postalCode: `SE1 ${randInt(1, 9, rng)}AA`,
        country: 'United Kingdom',
        use: 'home',
      },
    ],
  });
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function pickRiskFactors(rng: () => number): string[] {
  if (rng() < 0.45) return [];
  const count = randInt(1, 2, rng);
  const out = new Set<string>();
  while (out.size < count) out.add(pick(RISK_FACTORS, rng));
  return [...out];
}

/** Fisher–Yates using the injected rng for reproducible cohorts. */
function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
