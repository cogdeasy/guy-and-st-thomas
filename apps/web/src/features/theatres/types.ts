import type { BadgeTone } from '@trustos/ui';

export const CASE_STATUSES = [
  'scheduled',
  'sent-for',
  'anaesthetic',
  'in-theatre',
  'recovery',
  'complete',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export type CasePriority = 'elective' | 'expedited' | 'urgent' | 'immediate';

export interface CaseView {
  id: string;
  listId: string;
  order: number;
  status: CaseStatus;
  priority: CasePriority;
  procedureCode?: string;
  procedureText: string;
  estimatedMinutes: number;
  updatedAt: string;
  patient: {
    id: string;
    name: string;
    nhsNumber?: string;
    birthDate?: string;
  };
}

export interface TheatreListView {
  id: string;
  date: string;
  theatre: string;
  site: string;
  session: 'AM' | 'PM';
  surgeonName: string;
  specialty: string;
  cases: CaseView[];
  counts: Record<CaseStatus, number>;
}

export interface ListsResponse {
  date: string;
  total: number;
  lists: TheatreListView[];
}

export interface BoardTile {
  listId: string;
  theatre: string;
  site: string;
  session: 'AM' | 'PM';
  specialty: string;
  surgeon: string;
  state: CaseStatus | 'idle';
  currentCase: CaseView | null;
  nextCase: CaseView | null;
  totalCases: number;
  completed: number;
  counts: Record<CaseStatus, number>;
}

export interface BoardResponse {
  date: string;
  total: number;
  theatres: BoardTile[];
}

export const STATUS_LABELS: Record<CaseStatus | 'idle', string> = {
  scheduled: 'Scheduled',
  'sent-for': 'Sent for',
  anaesthetic: 'Anaesthetic',
  'in-theatre': 'In theatre',
  recovery: 'Recovery',
  complete: 'Complete',
  idle: 'Idle',
};

export function statusTone(status: CaseStatus | 'idle'): BadgeTone {
  switch (status) {
    case 'in-theatre':
      return 'danger';
    case 'anaesthetic':
    case 'sent-for':
      return 'warning';
    case 'recovery':
      return 'info';
    case 'complete':
      return 'success';
    default:
      return 'neutral';
  }
}

export function priorityTone(priority: CasePriority): BadgeTone {
  switch (priority) {
    case 'immediate':
      return 'danger';
    case 'urgent':
      return 'warning';
    case 'expedited':
      return 'info';
    default:
      return 'neutral';
  }
}

export function nextStatus(status: CaseStatus): CaseStatus | null {
  const idx = CASE_STATUSES.indexOf(status);
  return idx >= 0 && idx < CASE_STATUSES.length - 1 ? (CASE_STATUSES[idx + 1] as CaseStatus) : null;
}
