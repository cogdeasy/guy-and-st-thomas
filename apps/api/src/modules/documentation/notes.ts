import type { Patient, Practitioner } from '@trustos/ontology';

/** The kinds of clinical note this module captures. */
export const NOTE_TYPES = ['ward-round', 'admission', 'progress', 'discharge-summary'] as const;
export type ClinicalNoteType = (typeof NOTE_TYPES)[number];

/** Human-readable label for a note type, used by the API and UI. */
export const NOTE_TYPE_LABELS: Record<ClinicalNoteType, string> = {
  'ward-round': 'Ward Round',
  admission: 'Admission Clerking',
  progress: 'Progress Note',
  'discharge-summary': 'Discharge Summary',
};

/**
 * A free-text clinical note held in the custom `ClinicalNote` collection.
 * References are stored as FHIR-style strings (e.g. "Patient/<id>").
 */
export interface ClinicalNote {
  id: string;
  patient: string;
  encounter?: string;
  author: string;
  type: ClinicalNoteType;
  body: string;
  createdAt: string;
  meta?: Record<string, unknown>;
  /** Satisfies the store's free-form `Entity` constraint. */
  [key: string]: unknown;
}

export function patientName(patient: Patient): string {
  const name = patient.name?.[0];
  return `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim() || 'Unknown patient';
}

export function practitionerName(practitioner: Practitioner): string {
  const name = practitioner.name?.[0];
  const prefix = name?.prefix?.join(' ');
  const full = `${name?.given?.join(' ') ?? ''} ${name?.family ?? ''}`.trim();
  return [prefix, full].filter(Boolean).join(' ').trim() || 'Unknown clinician';
}

interface ComposeArgs {
  patient: Patient;
  reason: string;
  specialty?: string;
  rng: () => number;
}

const EXAM_FINDINGS = [
  'Chest clear, no added sounds. Heart sounds I + II + 0.',
  'Soft, non-tender abdomen. Bowel sounds present.',
  'GCS 15, no focal neurological deficit.',
  'Mild bibasal crepitations, otherwise unremarkable.',
  'Calves soft and non-tender, no peripheral oedema.',
];

const PLANS = [
  'Continue IV fluids and reassess fluid balance in 6 hours.',
  'Await morning bloods; chase CRP and U&E trend.',
  'Step down oxygen as tolerated, target SpO₂ 94–98%.',
  'Continue current antimicrobials, review with micro advice.',
  'Encourage early mobilisation with physiotherapy input.',
  'For senior review on the post-take ward round.',
];

const IMPRESSIONS = [
  'clinically stable, responding to treatment',
  'showing gradual improvement overnight',
  'no acute deterioration, observations within range',
  'symptomatic but haemodynamically stable',
];

const SOCIAL = [
  'Lives alone, independent with ADLs at baseline.',
  'Lives with family, mobilises with a stick.',
  'Package of care twice daily, awaiting OT review.',
  'Usually independent, no formal support at home.',
];

function pickFrom<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** Build realistic, reproducible note text for a given note type. */
export function composeNoteBody(type: ClinicalNoteType, args: ComposeArgs): string {
  const { reason, specialty, rng } = args;
  const spec = specialty ?? 'General Medicine';
  const exam = pickFrom(EXAM_FINDINGS, rng);
  const plan = pickFrom(PLANS, rng);
  const impression = pickFrom(IMPRESSIONS, rng);

  switch (type) {
    case 'admission':
      return [
        `${spec} admission clerking.`,
        `Presenting complaint: ${reason}.`,
        `History of presenting complaint: ${rng() < 0.5 ? 'symptoms developed over the preceding 24–48 hours' : 'acute onset earlier today, no preceding trauma'}.`,
        `Examination: ${exam}`,
        `Social: ${pickFrom(SOCIAL, rng)}`,
        `Impression: ${reason} — for admission under ${spec}.`,
        `Plan: ${plan}`,
      ].join('\n');
    case 'ward-round':
      return [
        `${spec} ward round.`,
        `Patient ${impression}.`,
        `Examination: ${exam}`,
        `Plan: ${plan}`,
      ].join('\n');
    case 'progress':
      return [
        `Progress note — ${spec}.`,
        `Reviewing ${reason}; patient ${impression}.`,
        `Examination: ${exam}`,
        `Plan: ${plan}`,
      ].join('\n');
    case 'discharge-summary':
      return [
        `Discharge summary — ${spec}.`,
        `Admitted with ${reason}; treated and now ${impression}.`,
        `Discharge plan: ${plan}`,
        'TTOs supplied; GP to review in 2 weeks.',
      ].join('\n');
    default:
      return `${spec} note regarding ${reason}.`;
  }
}
