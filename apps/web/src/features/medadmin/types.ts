/** Shared client types mirroring the `/api/medadmin` responses. */

export type DoseStatus = 'overdue' | 'due' | 'upcoming' | 'given' | 'omitted';

export interface PatientSummary {
  id: string;
  name: string;
  nhsNumber?: string;
  birthDate?: string;
}

export interface WardRef {
  id: string;
  name: string;
}

export interface AdministrationView {
  id: string;
  status: string;
  effectiveDateTime: string;
  performer?: string;
  notGivenReason?: string;
}

export interface RoundItem {
  id: string;
  status: DoseStatus;
  scheduledTime: string;
  medicationRequestId: string;
  medication: string;
  dose?: string;
  route?: string;
  frequency?: string;
  patient: PatientSummary;
  ward: WardRef | null;
  administration: AdministrationView | null;
}

export interface WardSummary {
  id: string;
  name: string;
  total: number;
  overdue: number;
  due: number;
  upcoming: number;
  given: number;
  omitted: number;
}

export interface RoundResponse {
  generatedAt: string;
  ward: WardRef | null;
  wards: WardSummary[];
  stats: Record<DoseStatus, number> & { total: number };
  items: RoundItem[];
}

export interface OmissionReason {
  code: string;
  display: string;
}

export interface HistoryEvent {
  id: string;
  status: string;
  medication: string;
  effectiveDateTime: string;
  performer?: string;
  notGivenReason?: string;
  requestId?: string;
}

export interface HistoryResponse {
  patient: PatientSummary;
  activeOrders: Array<{
    id: string;
    medication: string;
    dose?: string;
    route?: string;
    frequency?: string;
  }>;
  total: number;
  given: number;
  omitted: number;
  events: HistoryEvent[];
}

const TIME_FMT: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
};

/** Format a scheduled-dose timestamp as e.g. "Today 08:00" / "Yesterday 22:00". */
export function formatSlot(iso: string): string {
  const time = new Date(iso).toLocaleTimeString('en-GB', TIME_FMT);
  const slotDay = Date.UTC(
    new Date(iso).getUTCFullYear(),
    new Date(iso).getUTCMonth(),
    new Date(iso).getUTCDate(),
  );
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const label =
    slotDay === today
      ? 'Today'
      : slotDay === today - dayMs
        ? 'Yesterday'
        : slotDay === today + dayMs
          ? 'Tomorrow'
          : new Date(iso).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              timeZone: 'UTC',
            });
  return `${label} ${time}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}
