/** Role-based access control roles used across clinical and operational modules. */
export const ROLES = [
  'consultant',
  'registrar',
  'junior-doctor',
  'nurse',
  'pharmacist',
  'radiographer',
  'biomedical-scientist',
  'bed-manager',
  'theatre-coordinator',
  'receptionist',
  'administrator',
  'patient',
] as const;

export type Role = (typeof ROLES)[number];

export const CLINICAL_ROLES: Role[] = [
  'consultant',
  'registrar',
  'junior-doctor',
  'nurse',
  'pharmacist',
  'radiographer',
  'biomedical-scientist',
];

export function isClinical(role: Role): boolean {
  return CLINICAL_ROLES.includes(role);
}

export function canPrescribe(role: Role): boolean {
  return role === 'consultant' || role === 'registrar' || role === 'junior-doctor';
}
