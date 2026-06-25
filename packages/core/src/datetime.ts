export function nowIso(): string {
  return new Date().toISOString();
}

export function isoDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function isoHoursFromNow(hours: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

export function ageFromBirthDate(birthDate: string, asOf: Date = new Date()): number {
  const b = new Date(birthDate);
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  const m = asOf.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && asOf.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
