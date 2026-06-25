import { isoHoursFromNow, pick, randInt, ref } from '@trustos/core';
import type {
  DiagnosticReport,
  Encounter,
  Observation,
  Patient,
  Practitioner,
} from '@trustos/ontology';
import type { ModuleContext } from '../types';
import {
  type Analyte,
  type Panel,
  type ResultFlag,
  CXR_FINDINGS,
  LOINC_SYSTEM,
  PANELS,
  SNOMED_SYSTEM,
  classify,
  referenceRangeText,
} from './catalog';

type Scenario = 'normal' | 'abnormal' | 'critical';

/**
 * Seed ~12 DiagnosticReports (FBC, U&E, CRP, CXR) with child Observations and
 * clinically realistic values — a deliberate mix of normal, abnormal and
 * critical — for currently admitted patients. All randomness flows through the
 * injected seeded rng so the demo is reproducible.
 */
export function seedResults(ctx: ModuleContext): void {
  const { store, rng } = ctx;

  const admissions = store
    .query<Encounter>('Encounter', (e) => e.class === 'inpatient' && e.status === 'in-progress')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (admissions.length === 0) return;

  const practitioners = store.list<Practitioner>('Practitioner');
  const pathologists = practitioners.filter((p) => p.specialty === 'Pathology');
  const radiologists = practitioners.filter((p) => p.specialty === 'Radiology');

  const REPORT_COUNT = 12;
  for (let i = 0; i < REPORT_COUNT; i++) {
    const encounter = admissions[i % admissions.length] as Encounter;
    const patientId = encounter.subject.reference.split('/')[1] ?? '';
    const patient = store.get<Patient>('Patient', patientId);
    if (!patient) continue;

    const panel = PANELS[i % PANELS.length] as Panel;
    const scenario = pickScenario(rng);
    const performer = choosePerformer(panel, pathologists, radiologists, practitioners, rng);

    const effectiveDateTime = isoHoursFromNow(-randInt(6, 96, rng));
    const issued = isoHoursFromNow(-randInt(1, 5, rng));
    const subject = {
      reference: ref('Patient', patient.id),
      display: patientName(patient),
    };
    const encounterRef = { reference: ref('Encounter', encounter.id) };
    const performerRef = performer
      ? { reference: ref('Practitioner', performer.id), display: practitionerName(performer) }
      : undefined;

    const resultRefs: Array<{ reference: string }> = [];
    let worst: ResultFlag = 'normal';

    if (panel.imaging) {
      const abnormal = scenario !== 'normal';
      const finding = abnormal ? pick(CXR_FINDINGS.abnormal, rng) : pick(CXR_FINDINGS.normal, rng);
      const flag: ResultFlag = abnormal ? 'abnormal' : 'normal';
      const obs = store.create<Observation>('Observation', {
        status: 'final',
        category: 'imaging',
        code: {
          coding: [{ system: SNOMED_SYSTEM, code: panel.code, display: panel.display }],
          text: panel.display,
        },
        subject,
        encounter: encounterRef,
        effectiveDateTime,
        valueString: finding,
        interpretation: flag,
        performer: performerRef,
      });
      resultRefs.push({ reference: ref('Observation', obs.id) });
      worst = flag;
    } else {
      const analytes = panel.analytes ?? [];
      const flaggedIndexes = chooseFlaggedIndexes(analytes, scenario, rng);
      analytes.forEach((analyte, idx) => {
        const target = flaggedIndexes.get(idx) ?? 'normal';
        const value = generateValue(analyte, target, rng);
        const flag = classify(analyte, value);
        if (severity(flag) > severity(worst)) worst = flag;
        const obs = store.create<Observation>('Observation', {
          status: 'final',
          category: 'laboratory',
          code: {
            coding: [{ system: LOINC_SYSTEM, code: analyte.loinc, display: analyte.display }],
            text: analyte.display,
          },
          subject,
          encounter: encounterRef,
          effectiveDateTime,
          valueQuantity: { value, unit: analyte.unit },
          interpretation: flag,
          referenceRangeText: referenceRangeText(analyte),
          performer: performerRef,
        });
        resultRefs.push({ reference: ref('Observation', obs.id) });
      });
    }

    store.create<DiagnosticReport>('DiagnosticReport', {
      status: 'final',
      category: panel.category,
      code: {
        coding: [{ system: SNOMED_SYSTEM, code: panel.code, display: panel.display }],
        text: panel.display,
      },
      subject,
      encounter: encounterRef,
      effectiveDateTime,
      issued,
      performer: performerRef,
      result: resultRefs,
      conclusion: conclusionFor(panel, worst),
    });
  }
}

function pickScenario(rng: () => number): Scenario {
  const r = rng();
  if (r < 0.45) return 'normal';
  if (r < 0.8) return 'abnormal';
  return 'critical';
}

function choosePerformer(
  panel: Panel,
  pathologists: Practitioner[],
  radiologists: Practitioner[],
  all: Practitioner[],
  rng: () => number,
): Practitioner | undefined {
  const preferred = panel.category === 'RAD' ? radiologists : pathologists;
  const pool = preferred.length > 0 ? preferred : all;
  return pool.length > 0 ? pick(pool, rng) : undefined;
}

/** Decide which analytes are pushed out of range and in which direction. */
function chooseFlaggedIndexes(
  analytes: Analyte[],
  scenario: Scenario,
  rng: () => number,
): Map<number, 'low' | 'high' | 'critical'> {
  const flagged = new Map<number, 'low' | 'high' | 'critical'>();
  if (scenario === 'normal' || analytes.length === 0) return flagged;

  if (scenario === 'critical') {
    const criticalCandidates = analytes
      .map((a, idx) => ({ a, idx }))
      .filter(({ a }) => a.criticalLow !== undefined || a.criticalHigh !== undefined);
    if (criticalCandidates.length > 0) {
      const choice = pick(criticalCandidates, rng);
      flagged.set(choice.idx, 'critical');
    }
  }

  const abnormalCount = randInt(1, 2, rng);
  for (let n = 0; n < abnormalCount; n++) {
    const idx = randInt(0, analytes.length - 1, rng);
    if (flagged.has(idx)) continue;
    flagged.set(idx, rng() < 0.5 ? 'low' : 'high');
  }
  return flagged;
}

function generateValue(
  analyte: Analyte,
  target: 'normal' | 'low' | 'high' | 'critical',
  rng: () => number,
): number {
  const span = analyte.high - analyte.low;
  switch (target) {
    case 'low':
      return round(
        randFloat(
          Math.max(analyte.criticalLow ?? analyte.low - span, analyte.low - span),
          analyte.low - span * 0.05,
          rng,
        ),
        analyte.decimals,
      );
    case 'high':
      return round(
        randFloat(
          analyte.high + span * 0.05,
          (analyte.criticalHigh ?? analyte.high + span) - span * 0.05,
          rng,
        ),
        analyte.decimals,
      );
    case 'critical': {
      if (
        analyte.criticalLow !== undefined &&
        (analyte.criticalHigh === undefined || rng() < 0.5)
      ) {
        return round(
          randFloat(Math.max(0, analyte.criticalLow - span), analyte.criticalLow, rng),
          analyte.decimals,
        );
      }
      if (analyte.criticalHigh !== undefined) {
        return round(
          randFloat(analyte.criticalHigh, analyte.criticalHigh + span, rng),
          analyte.decimals,
        );
      }
      return round(
        randFloat(analyte.high + span, analyte.high + span * 1.5, rng),
        analyte.decimals,
      );
    }
    default:
      return round(randFloat(analyte.low, analyte.high, rng), analyte.decimals);
  }
}

function conclusionFor(panel: Panel, worst: ResultFlag): string {
  if (panel.imaging) {
    return worst === 'normal'
      ? 'No acute cardiopulmonary abnormality.'
      : 'Abnormal appearances — correlate clinically.';
  }
  if (worst === 'critical') return 'Critical result — immediate clinical action required.';
  if (worst === 'normal') return 'All analytes within normal limits.';
  return 'One or more results outside the reference range — clinical review advised.';
}

function severity(flag: ResultFlag): number {
  return flag === 'critical' ? 3 : flag === 'normal' ? 0 : 2;
}

function randFloat(min: number, max: number, rng: () => number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + rng() * (hi - lo);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function patientName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}

function practitionerName(practitioner: Practitioner): string {
  const name = practitioner.name?.[0];
  const prefix = name?.prefix?.[0] ? `${name.prefix[0]} ` : '';
  return `${prefix}${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
}
