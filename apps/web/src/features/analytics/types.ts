/** Shapes returned by the /api/analytics workflow endpoints. */

export interface BedStats {
  total: number;
  occupied: number;
  available: number;
  closed: number;
  occupancyPct: number;
}

export interface RiskBreakdown {
  low: number;
  'low-medium': number;
  medium: number;
  high: number;
}

export interface EdStats {
  total: number;
  within4h: number;
  breaches: number;
  compliancePct: number;
  longestWaitHours: number;
  target: number;
}

export interface WatchItem {
  encounterId: string;
  patientId?: string;
  name: string;
  specialty?: string;
  news2: number;
  risk: string;
}

export interface Overview {
  generatedAt: string;
  beds: BedStats;
  inpatients: {
    active: number;
    monitored: number;
    deteriorating: number;
    byRisk: RiskBreakdown;
  };
  flow: { admissionsToday: number; dischargesToday: number };
  ed: EdStats;
  watchlist: WatchItem[];
}

export interface SiteSummary {
  siteId: string;
  site: string;
  beds: BedStats;
  activity: {
    activeInpatients: number;
    admissionsToday: number;
    dischargesToday: number;
    edAttendances: number;
    edBreaches: number;
  };
}

export interface BySite {
  total: number;
  sites: SiteSummary[];
}

export interface TrendBucket {
  date: string;
  admissions: number;
  discharges: number;
}

export interface Trends {
  days: number;
  buckets: TrendBucket[];
  totals: { admissions: number; discharges: number };
}
