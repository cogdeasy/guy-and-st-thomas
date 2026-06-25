export type BedStatus = 'available' | 'occupied' | 'closed' | 'cleaning' | 'reserved';

export interface BedSummary {
  total: number;
  occupied: number;
  available: number;
  closed: number;
  occupancyPct: number;
}

export interface Occupant {
  patientId?: string;
  name?: string;
  display?: string;
  nhsNumber?: string;
  age?: number;
  gender?: string;
  admittedAt?: string;
  news2?: { score: number; risk: string } | null;
}

export interface BedView {
  id: string;
  name: string;
  status: BedStatus;
  occupant: Occupant | null;
}

export interface WardView {
  wardId: string;
  wardName: string;
  siteId?: string;
  siteName?: string;
  summary: BedSummary;
  beds: BedView[];
}

export interface BoardResponse {
  summary: BedSummary;
  wards: WardView[];
}

export interface SiteCapacity extends BedSummary {
  siteId: string;
  siteName: string;
}

export interface CapacityResponse {
  trust: BedSummary;
  sites: SiteCapacity[];
}

export type RequestPriority = 'routine' | 'urgent' | 'emergency';
export type RequestStatus = 'pending' | 'allocated' | 'rejected';

export interface BedRequestView {
  id: string;
  status: RequestStatus;
  priority: RequestPriority;
  specialty: string;
  requestedWard?: string;
  requestedAt: string;
  fromLocation: { reference: string; display?: string } | null;
  allocatedBed: { reference: string; display?: string } | null;
  allocatedAt: string | null;
  patient: {
    id?: string;
    name?: string;
    display?: string;
    nhsNumber?: string;
    age?: number;
    gender?: string;
  };
}

export interface RequestsResponse {
  total: number;
  pending: number;
  items: BedRequestView[];
}
