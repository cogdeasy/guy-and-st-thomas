/** Deterministic-friendly id helpers used across the platform. */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomId(prefix = '', rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return prefix ? `${prefix}-${out}` : out;
}

/** Build a FHIR-style reference string. */
export function ref(resourceType: string, id: string): string {
  return `${resourceType}/${id}`;
}

/** Parse a reference string into its parts. */
export function parseRef(reference: string): { resourceType: string; id: string } | null {
  const idx = reference.indexOf('/');
  if (idx < 0) return null;
  return { resourceType: reference.slice(0, idx), id: reference.slice(idx + 1) };
}
