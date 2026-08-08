import type Database from 'better-sqlite3';
import type { BacktestTrackOption } from '../shared/types.js';
import { knownTrackNameById } from './atg.js';

let cache: { at: number; data: BacktestTrackOption[] } | null = null;
const CACHE_MS = 30_000;

export function invalidateTrackStatsCache(): void {
  cache = null;
}

export function listTrackStats(db: Database.Database): BacktestTrackOption[] {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }
  const data = queryTrackStats(db);
  cache = { at: Date.now(), data };
  return data;
}

export function getTrackStats(
  db: Database.Database,
  atgTrackId: number,
): BacktestTrackOption | null {
  return listTrackStats(db).find((t) => t.atgTrackId === atgTrackId) ?? null;
}

export function resolveTrackName(db: Database.Database, atgTrackId: number): string | null {
  const known = knownTrackNameById(atgTrackId);
  if (known) return known;
  const cached = getTrackStats(db, atgTrackId);
  if (cached) return cached.trackName;
  const row = db
    .prepare(
      `SELECT track_name as trackName FROM race_sessions
       WHERE atg_track_id = ? AND track_name IS NOT NULL
       LIMIT 1`,
    )
    .get(atgTrackId) as { trackName: string } | undefined;
  return row?.trackName ?? null;
}

function queryTrackStats(db: Database.Database): BacktestTrackOption[] {
  const rows = db
    .prepare(
      `SELECT rs.atg_track_id as atgTrackId,
              MIN(rs.track_name) as trackName,
              COUNT(DISTINCT rs.id) as raceCount,
              COUNT(DISTINCT CASE
                WHEN re.actual_position IS NOT NULL AND re.actual_position > 0 THEN rs.id
              END) as racesWithResult
       FROM race_sessions rs
       LEFT JOIN race_entries re ON re.session_id = rs.id
       WHERE rs.atg_track_id IS NOT NULL
       GROUP BY rs.atg_track_id
       ORDER BY racesWithResult DESC, trackName`,
    )
    .all() as Array<{
    atgTrackId: number;
    trackName: string;
    raceCount: number;
    racesWithResult: number;
  }>;

  return rows.map((r) => ({
    atgTrackId: r.atgTrackId,
    trackName: knownTrackNameById(r.atgTrackId) ?? r.trackName,
    raceCount: r.raceCount,
    racesWithResult: r.racesWithResult,
  }));
}
