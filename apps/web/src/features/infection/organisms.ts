import type { BadgeTone } from '@trustos/ui';

/** Organisms IPC routinely flags — mirrors the backend surveillance list. */
export const ORGANISM_OPTIONS = [
  'MRSA',
  'C. difficile',
  'COVID-19',
  'CPE',
  'Norovirus',
  'VRE',
  'Influenza A',
  'ESBL',
] as const;

const ORGANISM_TONES: Record<string, BadgeTone> = {
  MRSA: 'danger',
  'C. difficile': 'danger',
  'COVID-19': 'info',
  CPE: 'danger',
  Norovirus: 'warning',
  VRE: 'warning',
  'Influenza A': 'info',
  ESBL: 'neutral',
};

export function organismTone(organism: string): BadgeTone {
  return ORGANISM_TONES[organism] ?? 'neutral';
}
