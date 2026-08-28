import type Database from 'better-sqlite3';
import type { BacktestGoal, BacktestRaceDetail, GameTypeProfile, MissAnalysisBucket, MissAnalysisRace, TrackMissAnalysis } from '../shared/types.js';
import { distanceBandLabel } from '../shared/format.js';
import { raceProfileTags } from '../shared/raceProfile.js';
import { buildTopPickWinAnalysis, type TopPickWinRaceRow } from '../shared/topPickWin.js';
import { runBacktest } from './backtest.js';
import { getStoredOptimizeResult } from './jobs/autoOptimize.js';
import { getTrackProfileOrGlobal, hasTrackProfile } from './trackWeightProfiles.js';
import { resolveTrackName } from './trackStats.js';

interface SessionMeta {
  id: number;
  distance: number | null;
  fieldSize: number;
  winnerName: string | null;
  winnerStartNumber: number | null;
  raceName: string | null;
  raceTerms: string[];
}

function bucket(
  label: string,
  races: Array<{ hit: BacktestRaceDetail['hit'] }>,
): MissAnalysisBucket {
  const hits = races.filter((r) => r.hit !== 'miss').length;
  const misses = races.filter((r) => r.hit === 'miss').length;
  const total = races.length;
  return {
    label,
    hits,
    misses,
    total,
    hitRate: total > 0 ? Math.round((hits / total) * 1000) / 10 : null,
  };
}

function distanceLabel(distance: number | null): string {
  return distanceBandLabel(distance);
}

function winnerRankLabel(rank: number | null): string {
  if (rank == null) return 'Okänd rank';
  if (rank <= 3) return 'Rank 1–3';
  if (rank <= 5) return 'Rank 4–5';
  if (rank <= 8) return 'Rank 6–8';
  return 'Rank 9+';
}

function loadSessionMeta(db: Database.Database, sessionIds: number[]): Map<number, SessionMeta> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => '?').join(',');
  const sessions = db
    .prepare(`SELECT id, distance, race_name as raceName, race_terms as raceTerms FROM race_sessions WHERE id IN (${placeholders})`)
    .all(...sessionIds) as Array<{ id: number; distance: number | null; raceName: string | null; raceTerms: string | null }>;

  const fieldRows = db
    .prepare(
      `SELECT session_id as sessionId, COUNT(*) as fieldSize
       FROM race_entries
       WHERE session_id IN (${placeholders}) AND scratched = 0
       GROUP BY session_id`,
    )
    .all(...sessionIds) as Array<{ sessionId: number; fieldSize: number }>;

  const winnerRows = db
    .prepare(
      `SELECT session_id as sessionId, horse_name as horseName, start_number as startNumber
       FROM race_entries
       WHERE session_id IN (${placeholders}) AND actual_position = 1`,
    )
    .all(...sessionIds) as Array<{ sessionId: number; horseName: string; startNumber: number }>;

  const fieldBySession = new Map(fieldRows.map((r) => [r.sessionId, r.fieldSize]));
  const winnerBySession = new Map(winnerRows.map((r) => [r.sessionId, r]));

  return new Map(
    sessions.map((s) => {
      const winner = winnerBySession.get(s.id);
      let raceTerms: string[] = [];
      if (s.raceTerms) {
        try {
          raceTerms = JSON.parse(s.raceTerms) as string[];
        } catch {
          raceTerms = [];
        }
      }
      return [
        s.id,
        {
          id: s.id,
          distance: s.distance,
          fieldSize: fieldBySession.get(s.id) ?? 0,
          winnerName: winner?.horseName ?? null,
          winnerStartNumber: winner?.startNumber ?? null,
          raceName: s.raceName,
          raceTerms,
        },
      ];
    }),
  );
}

function countUpcomingRaces(db: Database.Database, atgTrackId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT rs.id) as count
       FROM race_sessions rs
       WHERE rs.atg_track_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM race_entries re
           WHERE re.session_id = rs.id
             AND re.actual_position IS NOT NULL
             AND re.actual_position > 0
         )`,
    )
    .get(atgTrackId) as { count: number };
  return row.count;
}

function buildInsights(
  analysis: Pick<
    TrackMissAnalysis,
    'trackName' | 'racesWithResult' | 'misses' | 'hits' | 'hitRate' | 'byStartMethod' | 'byDistance' | 'byWinnerRank'
  >,
): string[] {
  const insights: string[] = [];

  if (analysis.racesWithResult === 0) {
    insights.push(
      `Inga avslutade lopp med resultat på ${analysis.trackName} ännu. Importera historik under Importera (bulk-import) — då kan vi se var nuvarande vikter missar.`,
    );
    return insights;
  }

  if (analysis.racesWithResult < 5) {
    insights.push(
      `Bara ${analysis.racesWithResult} lopp med resultat — mönster kan vara slump. Importera fler avslutade omgångar på ${analysis.trackName}.`,
    );
  }

  const auto = analysis.byStartMethod.find((b) => b.label === 'Autostart');
  const volte = analysis.byStartMethod.find((b) => b.label === 'Voltstart');
  if (auto && volte && volte.total >= 3 && auto.total >= 3) {
    const volteMissRate = volte.misses / volte.total;
    const autoMissRate = auto.misses / auto.total;
    if (volteMissRate > autoMissRate + 0.15) {
      insights.push(
        'Fler missar på voltstart än autostart — gardera extra brett på volt-avdelningar.',
      );
    } else if (autoMissRate > volteMissRate + 0.15) {
      insights.push(
        'Fler missar på autostart — rank 4–5 är extra viktiga att ta med där.',
      );
    }
  }

  const closeMisses = analysis.byWinnerRank.find((b) => b.label === 'Rank 4–5');
  if (closeMisses && analysis.misses > 0 && closeMisses.misses >= analysis.misses * 0.35) {
    insights.push(
      'Ofta nära missar — vinnaren var rank 4–5 i Trot Score. Ta med minst en häst till utöver topp 3.',
    );
  }

  const farMisses = analysis.byWinnerRank.find((b) => b.label === 'Rank 9+');
  if (farMisses && analysis.misses > 0 && farMisses.misses >= analysis.misses * 0.3) {
    insights.push(
      'Många stora missar — vinnaren låg långt ner i rankingen. Gardera brett och var försiktig med spikar.',
    );
  }

  const rankedDistances = [...analysis.byDistance]
    .filter((b) => b.total >= 3)
    .sort((a, b) => (a.hitRate ?? 0) - (b.hitRate ?? 0));
  const weakest = rankedDistances[0];
  if (
    weakest &&
    weakest.hitRate != null &&
    analysis.hitRate != null &&
    weakest.hitRate < analysis.hitRate - 12
  ) {
    insights.push(
      `Svagast träff på ${weakest.label.toLowerCase()} (${weakest.hitRate}% träff). Granska missarna på den distansen nedan.`,
    );
  }

  if (analysis.misses === 0) {
    insights.push('Inga missar i historiken med nuvarande vikter — starkt underlag inför spel.');
  } else if (insights.length === 0) {
    insights.push(
      'Missarna är spridda utan tydligt mönster — använd rankingens rank 4–5 som garderingskandidater.',
    );
  }

  return insights;
}

function buildGameTypeProfiles(races: MissAnalysisRace[]): GameTypeProfile[] {
  const groups = new Map<string, MissAnalysisRace[]>();
  for (const race of races) {
    const list = groups.get(race.gameType) ?? [];
    list.push(race);
    groups.set(race.gameType, list);
  }

  return [...groups.entries()]
    .filter(([, groupRaces]) => groupRaces.length >= 3)
    .map(([gameType, groupRaces]) => {
      const summary = bucket(gameType, groupRaces);

      const startBuckets = [
        bucket('Autostart', groupRaces.filter((r) => r.startMethod === 'auto')),
        bucket('Voltstart', groupRaces.filter((r) => r.startMethod === 'volte')),
      ].filter((b) => b.total > 0);

      const distGroups = new Map<string, MissAnalysisRace[]>();
      for (const race of groupRaces) {
        const label = distanceLabel(race.distance);
        const list = distGroups.get(label) ?? [];
        list.push(race);
        distGroups.set(label, list);
      }
      const distanceBuckets = [...distGroups.entries()]
        .map(([label, group]) => bucket(label, group))
        .filter((b) => b.total > 0)
        .sort((a, b) => a.label.localeCompare(b.label, 'sv'));

      const rankGroups = new Map<string, MissAnalysisRace[]>();
      for (const race of groupRaces.filter((r) => r.hit === 'miss')) {
        const label = winnerRankLabel(race.winnerRank);
        const list = rankGroups.get(label) ?? [];
        list.push(race);
        rankGroups.set(label, list);
      }
      const winnerRankBuckets = ['Rank 4–5', 'Rank 6–8', 'Rank 9+', 'Okänd rank']
        .map((label) => bucket(label, rankGroups.get(label) ?? []))
        .filter((b) => b.total > 0);

      return {
        gameType,
        hits: summary.hits,
        misses: summary.misses,
        total: summary.total,
        hitRate: summary.hitRate,
        byStartMethod: startBuckets,
        byDistance: distanceBuckets,
        byWinnerRank: winnerRankBuckets,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function analyzeTrackMisses(
  db: Database.Database,
  atgTrackId: number,
  goal: BacktestGoal,
): TrackMissAnalysis {
  const parameters = getTrackProfileOrGlobal(db, atgTrackId);
  const summary = runBacktest(db, parameters, { atgTrackId }, goal);
  const trackName = resolveTrackName(db, atgTrackId) ?? summary.trackName;
  const meta = loadSessionMeta(
    db,
    summary.races.map((r) => r.sessionId),
  );

  const enrichedRaces: MissAnalysisRace[] = summary.races.map((race) => {
    const sessionMeta = meta.get(race.sessionId);
    return {
      ...race,
      distance: sessionMeta?.distance ?? null,
      fieldSize: sessionMeta?.fieldSize ?? 0,
      winnerName: sessionMeta?.winnerName ?? null,
      winnerStartNumber: sessionMeta?.winnerStartNumber ?? null,
    };
  });

  const missRaces = enrichedRaces
    .filter((r) => r.hit === 'miss')
    .sort((a, b) => b.date.localeCompare(a.date) || b.legNumber - a.legNumber);

  const byStartMethod = [
    bucket('Autostart', enrichedRaces.filter((r) => r.startMethod === 'auto')),
    bucket('Voltstart', enrichedRaces.filter((r) => r.startMethod === 'volte')),
    bucket(
      'Okänd startmetod',
      enrichedRaces.filter((r) => r.startMethod !== 'auto' && r.startMethod !== 'volte'),
    ),
  ].filter((b) => b.total > 0);

  const distanceGroups = new Map<string, MissAnalysisRace[]>();
  for (const race of enrichedRaces) {
    const label = distanceLabel(race.distance);
    const list = distanceGroups.get(label) ?? [];
    list.push(race);
    distanceGroups.set(label, list);
  }
  const byDistance = [...distanceGroups.entries()]
    .map(([label, races]) => bucket(label, races))
    .sort((a, b) => a.label.localeCompare(b.label, 'sv'));

  const gameGroups = new Map<string, MissAnalysisRace[]>();
  for (const race of enrichedRaces) {
    const list = gameGroups.get(race.gameType) ?? [];
    list.push(race);
    gameGroups.set(race.gameType, list);
  }
  const byGameType = [...gameGroups.entries()]
    .map(([label, races]) => bucket(label, races))
    .sort((a, b) => b.total - a.total);

  const rankGroups = new Map<string, MissAnalysisRace[]>();
  for (const race of enrichedRaces.filter((r) => r.hit === 'miss')) {
    const label = winnerRankLabel(race.winnerRank);
    const list = rankGroups.get(label) ?? [];
    list.push(race);
    rankGroups.set(label, list);
  }
  const byWinnerRank = ['Rank 4–5', 'Rank 6–8', 'Rank 9+', 'Okänd rank']
    .map((label) => bucket(label, rankGroups.get(label) ?? []))
    .filter((b) => b.total > 0);

  const categoryGroups = new Map<string, MissAnalysisRace[]>();
  for (const race of enrichedRaces) {
    const sessionMeta = meta.get(race.sessionId);
    const tags = raceProfileTags(sessionMeta?.raceName ?? null, sessionMeta?.raceTerms ?? []);
    for (const tag of tags) {
      const list = categoryGroups.get(tag) ?? [];
      list.push(race);
      categoryGroups.set(tag, list);
    }
  }
  const byRaceCategory = [...categoryGroups.entries()]
    .map(([label, races]) => bucket(label, races))
    .filter((b) => b.total >= 3)
    .sort((a, b) => (a.hitRate ?? 0) - (b.hitRate ?? 0));

  const gameTypeProfiles = buildGameTypeProfiles(enrichedRaces);

  const topPickWinRows: TopPickWinRaceRow[] = summary.races
    .filter((race) => race.winnerRank != null)
    .map((race) => {
      const sessionMeta = meta.get(race.sessionId);
      const top = race.topPicks[0];
      const second = race.topPicks[1];
      const margin12 =
        top && second ? Math.round((top.trotScore - second.trotScore) * 10) / 10 : null;
      return {
        gameType: race.gameType,
        startMethod: race.startMethod,
        distance: sessionMeta?.distance ?? null,
        fieldSize: sessionMeta?.fieldSize ?? 0,
        margin12,
        topWon: race.winnerRank === 1,
        tags: raceProfileTags(sessionMeta?.raceName ?? null, sessionMeta?.raceTerms ?? []),
      };
    });
  const topPickWin = buildTopPickWinAnalysis(topPickWinRows);

  const misses = summary.racesWithResult - summary.hits;
  const storedOptimize = getStoredOptimizeResult(db, atgTrackId);

  const result: TrackMissAnalysis = {
    atgTrackId,
    trackName,
    goal,
    racesWithResult: summary.racesWithResult,
    upcomingRaceCount: countUpcomingRaces(db, atgTrackId),
    hits: summary.hits,
    misses,
    hitRate: summary.hitRate,
    usesTrackProfile: hasTrackProfile(db, atgTrackId),
    byStartMethod,
    byDistance,
    byGameType,
    byWinnerRank,
    byRaceCategory,
    gameTypeProfiles,
    topPickWin,
    missRaces,
    insights: [],
    suggestedWeights:
      storedOptimize?.improved && storedOptimize.goal === goal
        ? storedOptimize.optimized.weights
        : storedOptimize?.optimized.weights ?? null,
    suggestedHitRate: storedOptimize?.optimized.hitRate ?? null,
    suggestedHits: storedOptimize?.optimized.hits ?? null,
    suggestedHitsGained: storedOptimize?.hitsGained ?? null,
  };

  result.insights = buildInsights(result);
  return result;
}
