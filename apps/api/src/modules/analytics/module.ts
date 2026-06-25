import { z } from 'zod';
import type { Encounter } from '@trustos/ontology';
import { BadRequest } from '@trustos/core';
import { defineModule } from '../types';
import {
  activeInpatients,
  admissionTrends,
  ED_TARGET_COMPLIANCE,
  edAttendances,
  edStats,
  LocationIndex,
  news2ForEncounter,
  patientName,
  refId,
  riskBreakdown,
  sameUtcDay,
  trustBedStats,
  type WatchItem,
} from './compute';
import { seedAnalytics } from './seed';

/**
 * Operational Analytics — trust-wide executive dashboard.
 *
 * Read-only workflow endpoints that aggregate live across the core FHIR store
 * (Location/Encounter/Observation/Patient). No bespoke CRUD: generic resource
 * CRUD already exists at /api/fhir/:type. Routes mount under /api/analytics.
 */
export default defineModule({
  id: 'analytics',
  name: 'Operational Analytics',
  description: 'Trust-wide bed occupancy, patient flow and deterioration analytics for executives.',

  routes(app, { store }) {
    // Trust-wide operational snapshot for the executive overview.
    app.get('/overview', async () => {
      const now = new Date();
      const beds = trustBedStats(store);

      const inpatients = activeInpatients(store);
      const scored = inpatients
        .map((e) => ({ encounter: e, news2: news2ForEncounter(store, e.id) }))
        .filter((x): x is { encounter: Encounter; news2: NonNullable<typeof x.news2> } => x.news2 != null);
      const deteriorating = scored.filter((x) => x.news2.score >= 5).length;

      const allEncounters = store.list<Encounter>('Encounter');
      const admissionsToday = allEncounters.filter((e) => sameUtcDay(e.period?.start, now)).length;
      const dischargesToday = allEncounters.filter(
        (e) => e.status === 'finished' && sameUtcDay(e.period?.end, now),
      ).length;

      const ed = edStats(edAttendances(store), now.getTime());

      const watchlist: WatchItem[] = scored
        .sort((a, b) => b.news2.score - a.news2.score)
        .slice(0, 8)
        .map((x) => {
          const patientId = refId(x.encounter.subject?.reference);
          return {
            encounterId: x.encounter.id,
            patientId,
            name: patientName(store, patientId),
            specialty: x.encounter.specialty,
            news2: x.news2.score,
            risk: x.news2.risk,
          };
        });

      return {
        generatedAt: now.toISOString(),
        beds,
        inpatients: {
          active: inpatients.length,
          monitored: scored.length,
          deteriorating,
          byRisk: riskBreakdown(scored.map((x) => x.news2)),
        },
        flow: { admissionsToday, dischargesToday },
        ed: { ...ed, target: ED_TARGET_COMPLIANCE },
        watchlist,
      };
    });

    // Per-site bed occupancy + activity for site-level drill-down.
    app.get('/by-site', async () => {
      const now = new Date();
      const index = new LocationIndex(store);
      const inpatients = activeInpatients(store);
      const ed = edAttendances(store);
      const allEncounters = store.list<Encounter>('Encounter');

      const sites = index.sites.map((site) => {
        const onSite = (e: Encounter) => refId(e.location?.reference) === site.id;
        const siteEd = ed.filter(onSite);
        return {
          siteId: site.id,
          site: site.name,
          beds: index.bedStatsForSite(site.id),
          activity: {
            activeInpatients: inpatients.filter(onSite).length,
            admissionsToday: allEncounters.filter(
              (e) => onSite(e) && sameUtcDay(e.period?.start, now),
            ).length,
            dischargesToday: allEncounters.filter(
              (e) => onSite(e) && e.status === 'finished' && sameUtcDay(e.period?.end, now),
            ).length,
            edAttendances: siteEd.length,
            edBreaches: edStats(siteEd, now.getTime()).breaches,
          },
        };
      });

      return { total: sites.length, sites };
    });

    // Time-bucketed admissions/discharges over a configurable recent window.
    const TrendsQuery = z.object({
      days: z.coerce.number().int().min(1).max(30).default(7),
    });
    app.get<{ Querystring: Record<string, string> }>('/trends', async (req) => {
      const parsed = TrendsQuery.safeParse(req.query);
      if (!parsed.success) throw BadRequest('Invalid trends window (days must be 1–30)');
      const { days } = parsed.data;
      const buckets = admissionTrends(store, days);
      return {
        days,
        buckets,
        totals: {
          admissions: buckets.reduce((s, b) => s + b.admissions, 0),
          discharges: buckets.reduce((s, b) => s + b.discharges, 0),
        },
      };
    });

    // Deterioration watchlist (NEWS2) for the active inpatient cohort.
    app.get('/deterioration', async () => {
      const items: WatchItem[] = activeInpatients(store)
        .map((e) => ({ encounter: e, news2: news2ForEncounter(store, e.id) }))
        .filter((x) => x.news2 != null)
        .map((x) => {
          const patientId = refId(x.encounter.subject?.reference);
          return {
            encounterId: x.encounter.id,
            patientId,
            name: patientName(store, patientId),
            specialty: x.encounter.specialty,
            news2: x.news2!.score,
            risk: x.news2!.risk,
          };
        })
        .sort((a, b) => b.news2 - a.news2);
      return { total: items.length, items };
    });
  },

  seed(ctx) {
    seedAnalytics(ctx);
  },
});
