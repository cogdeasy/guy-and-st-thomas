import {
  calculateNews2,
  type Encounter,
  type Location,
  type Observation,
  type Patient,
} from '@trustos/ontology';
import { ref } from '@trustos/core';
import type { DataStore } from '../../store/store';

/**
 * Pure aggregation helpers for the Operational Analytics module. Everything is
 * computed live from the shared core store (Location/Encounter/Observation/
 * Patient) — this module owns no collections of its own.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const ED_TARGET_HOURS = 4;
/** NHS A&E four-hour standard: 95% of attendances admitted/discharged in 4h. */
export const ED_TARGET_COMPLIANCE = 95;

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

export interface WatchItem {
  encounterId: string;
  patientId?: string;
  name: string;
  ward?: string;
  site?: string;
  specialty?: string;
  news2: number;
  risk: string;
}

export interface EdStats {
  total: number;
  within4h: number;
  breaches: number;
  compliancePct: number;
  longestWaitHours: number;
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

export interface TrendBucket {
  date: string;
  admissions: number;
  discharges: number;
}

/** Index every Location and resolve which site a bed/ward belongs to. */
export class LocationIndex {
  private byId = new Map<string, Location>();
  readonly sites: Location[];

  constructor(store: DataStore) {
    for (const loc of store.list<Location>('Location')) this.byId.set(loc.id, loc);
    this.sites = [...this.byId.values()]
      .filter((l) => l.physicalType === 'site')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string | undefined): Location | undefined {
    return id ? this.byId.get(id) : undefined;
  }

  /** Walk the partOf chain (bed -> ward -> site) to the owning site location. */
  siteOf(loc: Location | undefined): Location | undefined {
    let cur = loc;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (cur.physicalType === 'site') return cur;
      seen.add(cur.id);
      cur = this.get(refId(cur.partOf?.reference));
    }
    return undefined;
  }

  bedStatsForSite(siteId: string): BedStats {
    const beds = [...this.byId.values()].filter(
      (l) => l.physicalType === 'bed' && this.siteOf(l)?.id === siteId,
    );
    return tallyBeds(beds);
  }
}

export function refId(reference: string | undefined): string | undefined {
  return reference ? reference.split('/')[1] : undefined;
}

export function tallyBeds(beds: Location[]): BedStats {
  let occupied = 0;
  let available = 0;
  let closed = 0;
  for (const b of beds) {
    if (b.operationalStatus === 'occupied' || b.operationalStatus === 'reserved') occupied++;
    else if (b.operationalStatus === 'closed') closed++;
    else available++;
  }
  const total = beds.length;
  const denom = total - closed;
  return {
    total,
    occupied,
    available,
    closed,
    occupancyPct: denom > 0 ? round1((occupied / denom) * 100) : 0,
  };
}

export function trustBedStats(store: DataStore): BedStats {
  return tallyBeds(store.list<Location>('Location').filter((l) => l.physicalType === 'bed'));
}

export function activeInpatients(store: DataStore): Encounter[] {
  return store.query<Encounter>(
    'Encounter',
    (e) => e.class === 'inpatient' && e.status === 'in-progress',
  );
}

/** NEWS2 score for an encounter, derived from its most recent vital-signs. */
export function news2ForEncounter(store: DataStore, encounterId: string) {
  const vitals = store
    .query<Observation>(
      'Observation',
      (o) =>
        o.category === 'vital-signs' && o.encounter?.reference === ref('Encounter', encounterId),
    )
    .sort((a, b) => b.effectiveDateTime.localeCompare(a.effectiveDateTime));

  const byCode = (loinc: string) =>
    vitals.find((o) => o.code?.coding?.some((c) => c.code === loinc))?.valueQuantity?.value;

  const respiratoryRate = byCode('9279-1');
  const spo2 = byCode('2708-6');
  const systolicBp = byCode('8480-6');
  const pulse = byCode('8867-4');
  const temperature = byCode('8310-5');
  if (
    respiratoryRate === undefined ||
    spo2 === undefined ||
    systolicBp === undefined ||
    pulse === undefined ||
    temperature === undefined
  ) {
    return null;
  }
  return calculateNews2({
    respiratoryRate,
    spo2,
    onOxygen: false,
    systolicBp,
    pulse,
    consciousness: 'A',
    temperature,
  });
}

export function riskBreakdown(scores: Array<{ risk: string }>): RiskBreakdown {
  const out: RiskBreakdown = { low: 0, 'low-medium': 0, medium: 0, high: 0 };
  for (const s of scores) {
    if (s.risk in out) out[s.risk as keyof RiskBreakdown]++;
  }
  return out;
}

export function patientName(store: DataStore, patientId: string | undefined): string {
  if (!patientId) return 'Unknown patient';
  const p = store.get<Patient>('Patient', patientId);
  const n = p?.name?.[0];
  if (!n) return 'Unknown patient';
  return `${n.given?.join(' ') ?? ''} ${n.family ?? ''}`.trim() || 'Unknown patient';
}

/** Emergency-department flow statistics over the supplied encounters. */
export function edStats(edEncounters: Encounter[], now = Date.now()): EdStats {
  let within4h = 0;
  let breaches = 0;
  let longestWaitMs = 0;
  for (const e of edEncounters) {
    const start = e.period?.start ? new Date(e.period.start).getTime() : now;
    const end = e.period?.end ? new Date(e.period.end).getTime() : now;
    const durationMs = Math.max(0, end - start);
    longestWaitMs = Math.max(longestWaitMs, durationMs);
    if (durationMs <= ED_TARGET_HOURS * 60 * 60 * 1000) within4h++;
    else breaches++;
  }
  const total = edEncounters.length;
  return {
    total,
    within4h,
    breaches,
    compliancePct: total > 0 ? round1((within4h / total) * 100) : 100,
    longestWaitHours: round1(longestWaitMs / (60 * 60 * 1000)),
  };
}

export function edAttendances(store: DataStore): Encounter[] {
  return store.query<Encounter>('Encounter', (e) => e.class === 'emergency');
}

export function sameUtcDay(iso: string | undefined, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getUTCFullYear() === ref.getUTCFullYear() &&
    d.getUTCMonth() === ref.getUTCMonth() &&
    d.getUTCDate() === ref.getUTCDate()
  );
}

/** Time-bucketed admissions/discharges for the last `days` calendar days. */
export function admissionTrends(store: DataStore, days = 7, now = new Date()): TrendBucket[] {
  const encounters = store.list<Encounter>('Encounter');
  const buckets: TrendBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * DAY_MS);
    const date = day.toISOString().slice(0, 10);
    let admissions = 0;
    let discharges = 0;
    for (const e of encounters) {
      if (sameUtcDay(e.period?.start, day)) admissions++;
      if (e.status === 'finished' && sameUtcDay(e.period?.end, day)) discharges++;
    }
    buckets.push({ date, admissions, discharges });
  }
  return buckets;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
