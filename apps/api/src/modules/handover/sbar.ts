import {
  calculateNews2,
  type Condition,
  type Encounter,
  type Observation,
  type Patient,
} from '@trustos/ontology';
import { ageFromBirthDate, pick, ref } from '@trustos/core';

/** A compact NEWS2 reading attached to a handover entry. */
export interface News2Snapshot {
  score: number;
  risk: string;
  recommendation: string;
  recordedAt?: string;
}

/** The four SBAR free-text fields that make up a structured handover. */
export interface Sbar {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}

export type HandoverPriority = 'routine' | 'urgent' | 'high';

/** Rank used to sort the prioritised handover board (higher = more urgent). */
export const PRIORITY_RANK: Record<HandoverPriority, number> = {
  high: 3,
  urgent: 2,
  routine: 1,
};

/** Map a NEWS2 reading to a handover priority band. */
export function priorityFromNews2(news2: News2Snapshot | null): HandoverPriority {
  if (!news2) return 'routine';
  if (news2.risk === 'high') return 'high';
  if (news2.risk === 'medium') return 'urgent';
  return 'routine';
}

/** Compute the most recent NEWS2 snapshot from a patient's vital-sign observations. */
export function latestNews2(observations: Observation[]): News2Snapshot | null {
  const vitals = observations
    .filter((o) => o.category === 'vital-signs')
    .sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime));
  if (vitals.length === 0) return null;

  const byCode = (loinc: string) =>
    vitals.find((o) => o.code?.coding?.some((c) => c.code === loinc))?.valueQuantity?.value;

  const respiratoryRate = byCode('9279-1');
  const spo2 = byCode('2708-6');
  const systolicBp = byCode('8480-6');
  const pulse = byCode('8867-4');
  const temperature = byCode('8310-5');

  if (
    respiratoryRate === undefined ||
    spo2 === undefined ||
    systolicBp === undefined ||
    pulse === undefined ||
    temperature === undefined
  ) {
    return null;
  }

  const result = calculateNews2({
    respiratoryRate,
    spo2,
    onOxygen: false,
    systolicBp,
    pulse,
    consciousness: 'A',
    temperature,
  });

  return {
    score: result.score,
    risk: result.risk,
    recommendation: result.recommendation,
    recordedAt: vitals[0]?.effectiveDateTime,
  };
}

function fullName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
}

function problemSummary(problems: Condition[]): string {
  const names = problems
    .map((c) => c.code?.text ?? c.code?.coding?.[0]?.display)
    .filter((t): t is string => Boolean(t));
  if (names.length === 0) return 'No significant past medical history documented.';
  return `Background of ${names.join(', ')}.`;
}

/**
 * Deterministically compose SBAR narrative from a patient's clinical picture.
 * Used by the `generate` endpoint where reproducibility matters and no RNG is
 * available; the seed adds phrasing variety via {@link composeSbarSeed}.
 */
export function composeSbar(args: {
  patient: Patient;
  encounter?: Encounter;
  problems: Condition[];
  news2: News2Snapshot | null;
}): Sbar {
  const { patient, encounter, problems, news2 } = args;
  const name = fullName(patient);
  const age = ageFromBirthDate(patient.birthDate);
  const specialty = encounter?.specialty ?? 'General Medicine';
  const reason = encounter?.reasonText ?? 'ongoing inpatient care';
  const dayOfStay = encounter?.period?.start
    ? Math.max(1, Math.round((Date.now() - Date.parse(encounter.period.start)) / 86_400_000))
    : 1;

  const newsText = news2
    ? `Latest NEWS2 ${news2.score} (${news2.risk} risk).`
    : 'NEWS2 not currently calculable (incomplete observation set).';

  const assessment = news2
    ? news2.risk === 'high'
      ? `Clinically deteriorating — NEWS2 ${news2.score}. Requires close observation and senior review.`
      : news2.risk === 'medium'
        ? `Borderline observations — NEWS2 ${news2.score}. Trending watched, escalation threshold discussed.`
        : `Clinically stable — NEWS2 ${news2.score}. No acute concerns this shift.`
    : 'Clinical status to be reassessed once a full set of observations is available.';

  return {
    situation: `${name}, ${age}y, day ${dayOfStay} under ${specialty} with ${reason}. ${newsText}`,
    background: problemSummary(problems),
    assessment,
    recommendation: news2?.recommendation ?? 'Continue current management plan and review on next ward round.',
  };
}

const HANDOVER_ACTIONS = [
  'Chase outstanding bloods and review on the morning round.',
  'Continue IV antibiotics; reassess fluid balance overnight.',
  'For senior review if NEWS2 rises; escalate per ward protocol.',
  'Awaiting imaging — follow up report and update plan.',
  'Optimise analgesia and encourage early mobilisation.',
  'Monitor urine output hourly; catheter care as per plan.',
] as const;

const SHIFTS = ['day', 'night'] as const;
export type Shift = (typeof SHIFTS)[number];

/**
 * Seed-time SBAR composition with reproducible phrasing variety. All randomness
 * flows through the injected seeded `rng` so demo data is deterministic.
 */
export function composeSbarSeed(
  args: {
    patient: Patient;
    encounter?: Encounter;
    problems: Condition[];
    news2: News2Snapshot | null;
  },
  rng: () => number,
): Sbar {
  const base = composeSbar(args);
  return {
    ...base,
    recommendation: `${base.recommendation} ${pick(HANDOVER_ACTIONS, rng)}`,
  };
}

export function pickShift(rng: () => number): Shift {
  return pick(SHIFTS, rng);
}

/** Resolve the Patient id embedded in a `Patient/<id>` reference. */
export function patientIdFromRef(reference: string): string {
  return reference.split('/')[1] ?? '';
}

export { ref };
