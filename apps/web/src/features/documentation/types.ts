import type { BadgeTone } from '@trustos/ui';

export const NOTE_TYPES = ['ward-round', 'admission', 'progress', 'discharge-summary'] as const;
export type ClinicalNoteType = (typeof NOTE_TYPES)[number];

export const NOTE_TYPE_LABELS: Record<ClinicalNoteType, string> = {
  'ward-round': 'Ward Round',
  admission: 'Admission Clerking',
  progress: 'Progress Note',
  'discharge-summary': 'Discharge Summary',
};

export interface ClinicalNote {
  id: string;
  patient: string;
  encounter?: string;
  author: string;
  type: ClinicalNoteType;
  body: string;
  createdAt: string;
  authorName: string;
  authorRole?: string;
  patientName: string;
}

export interface PatientNotesResponse {
  patient: { id: string; birthDate?: string; gender?: string };
  patientName: string;
  total: number;
  notes: ClinicalNote[];
}

export interface RecentNotesResponse {
  total: number;
  counts: Record<ClinicalNoteType, number>;
  notes: ClinicalNote[];
}

export function noteTone(type: ClinicalNoteType): BadgeTone {
  switch (type) {
    case 'admission':
      return 'info';
    case 'progress':
      return 'success';
    case 'discharge-summary':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
