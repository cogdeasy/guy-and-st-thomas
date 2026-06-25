import type { BadgeTone } from '@trustos/ui';

export type OrderStatus = 'draft' | 'active' | 'completed' | 'revoked';
export type OrderPriority = 'routine' | 'urgent' | 'asap' | 'stat';
export type OrderCategory = 'laboratory' | 'imaging' | 'cardiology' | 'microbiology';

export interface CatalogueItem {
  id: string;
  name: string;
  category: OrderCategory;
  system: string;
  code: string;
  display: string;
  specimen?: string;
  modality?: string;
  turnaroundHours: number;
  hint?: string;
}

export interface CatalogueResponse {
  total: number;
  categories: Array<{ key: OrderCategory; label: string; count: number }>;
  items: CatalogueItem[];
}

export interface OrderRow {
  id: string;
  status: OrderStatus;
  statusLabel: string;
  priority: OrderPriority;
  category?: OrderCategory;
  categoryLabel?: string;
  display: string;
  code?: string;
  specimen?: string;
  modality?: string;
  turnaroundHours?: number;
  authoredOn?: string;
  ageHours: number;
  overdue: boolean;
  reasonText?: string;
  patient: { id: string; name: string } | null;
  requester?: string;
  nextStatuses: Array<{ status: OrderStatus; label: string }>;
}

export interface WorklistResponse {
  total: number;
  summary: { requested: number; inProgress: number; urgent: number; overdue: number };
  groups: Array<{ key: OrderCategory; label: string; orders: OrderRow[] }>;
  orders: OrderRow[];
}

export function statusTone(status: OrderStatus): BadgeTone {
  switch (status) {
    case 'draft':
      return 'info';
    case 'active':
      return 'warning';
    case 'completed':
      return 'success';
    default:
      return 'neutral';
  }
}

export function priorityTone(priority: OrderPriority): BadgeTone {
  switch (priority) {
    case 'stat':
    case 'asap':
      return 'danger';
    case 'urgent':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function formatAge(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
