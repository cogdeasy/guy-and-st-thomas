import { calculateNews2, type News2Result, type Observation } from '@trustos/ontology';

/**
 * Vital-signs charting helpers shared by the routes and seed of the
 * observations module. A "vitals set" is the group of individual FHIR
 * `Observation` resources that were recorded at the same instant for one
 * patient; together they yield a single NEWS2 score.
 */

/** LOINC (and ACVPU) codes for each component of a NEWS2 observation set. */
export const VitalCodes = {
  respiratoryRate: { code: '9279-1', display: 'Respiratory rate', unit: '/min' },
  spo2: { code: '2708-6', display: 'Oxygen saturation', unit: '%' },
  systolicBp: { code: '8480-6', display: 'Systolic blood pressure', unit: 'mmHg' },
  heartRate: { code: '8867-4', display: 'Heart rate', unit: 'bpm' },
  temperature: { code: '8310-5', display: 'Body temperature', unit: 'Cel' },
  consciousness: { code: '80288-4', display: 'Level of consciousness (ACVPU)', unit: '' },
  onOxygen: { code: '3150-0', display: 'Supplemental oxygen', unit: '' },
} as const;

export type Consciousness = 'A' | 'V' | 'P' | 'U';

export interface VitalsReading {
  respiratoryRate: number;
  spo2: number;
  onOxygen: boolean;
  systolicBp: number;
  heartRate: number;
  consciousness: Consciousness;
  temperature: number;
}

export interface VitalsSet extends Partial<VitalsReading> {
  recordedAt: string;
  news2: News2Result | null;
}

/**
 * Observations recorded within this window are treated as one set. The core
 * seed timestamps each component of a "now" set a few milliseconds apart, so a
 * tolerance (rather than exact-equality) grouping is required to reconstruct a
 * single scoreable set.
 */
const SET_WINDOW_MS = 60_000;

const hasCode = (o: Observation, code: string): boolean =>
  o.code?.coding?.some((c) => c.code === code) ?? false;

// Within a set the latest reading for a given code wins (members are pre-sorted ascending).
const numericByCode = (group: Observation[], code: string): number | undefined => {
  for (let i = group.length - 1; i >= 0; i--) {
    const o = group[i]!;
    if (hasCode(o, code)) return o.valueQuantity?.value;
  }
  return undefined;
};

const stringByCode = (group: Observation[], code: string): string | undefined => {
  for (let i = group.length - 1; i >= 0; i--) {
    const o = group[i]!;
    if (hasCode(o, code)) return o.valueString;
  }
  return undefined;
};

/** Score a complete reading; returns null if any NEWS2 input is missing. */
export function scoreReading(set: Partial<VitalsReading>): News2Result | null {
  if (
    set.respiratoryRate === undefined ||
    set.spo2 === undefined ||
    set.systolicBp === undefined ||
    set.heartRate === undefined ||
    set.temperature === undefined
  ) {
    return null;
  }
  return calculateNews2({
    respiratoryRate: set.respiratoryRate,
    spo2: set.spo2,
    onOxygen: set.onOxygen ?? false,
    systolicBp: set.systolicBp,
    pulse: set.heartRate,
    consciousness: set.consciousness ?? 'A',
    temperature: set.temperature,
  });
}

/**
 * Group a patient's vital-signs observations into chronological sets (one per
 * recording instant) and attach the NEWS2 score for each complete set.
 */
export function toVitalsSeries(observations: Observation[]): VitalsSet[] {
  const vitals = observations
    .filter((o) => o.category === 'vital-signs')
    .sort((a, b) => a.effectiveDateTime.localeCompare(b.effectiveDateTime));

  // Bucket consecutive observations that fall within SET_WINDOW_MS of the
  // bucket's start into a single set.
  const buckets: Observation[][] = [];
  let bucketStart = -Infinity;
  for (const o of vitals) {
    const t = Date.parse(o.effectiveDateTime);
    const current = buckets.at(-1);
    if (!current || t - bucketStart > SET_WINDOW_MS) {
      buckets.push([o]);
      bucketStart = t;
    } else {
      current.push(o);
    }
  }

  return buckets.map((group) => {
    const recordedAt = group.reduce((m, o) => (o.effectiveDateTime > m ? o.effectiveDateTime : m), group[0]!.effectiveDateTime);
    const oxygenFlag = stringByCode(group, VitalCodes.onOxygen.code);
    const set: VitalsSet = {
      recordedAt,
      respiratoryRate: numericByCode(group, VitalCodes.respiratoryRate.code),
      spo2: numericByCode(group, VitalCodes.spo2.code),
      systolicBp: numericByCode(group, VitalCodes.systolicBp.code),
      heartRate: numericByCode(group, VitalCodes.heartRate.code),
      temperature: numericByCode(group, VitalCodes.temperature.code),
      onOxygen: oxygenFlag === undefined ? undefined : oxygenFlag === 'true',
      consciousness: (stringByCode(group, VitalCodes.consciousness.code) as Consciousness) || undefined,
      news2: null,
    };
    set.news2 = scoreReading(set);
    return set;
  });
}

/** The most recent scored set for a patient, or null. */
export function latestScoredSet(observations: Observation[]): VitalsSet | null {
  const series = toVitalsSeries(observations);
  for (let i = series.length - 1; i >= 0; i--) {
    const set = series[i];
    if (set?.news2) return set;
  }
  return series.at(-1) ?? null;
}
