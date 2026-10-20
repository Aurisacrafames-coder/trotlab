import type Database from 'better-sqlite3';
import { fetchRaceResults } from './atg.js';
import { normalizeProfileGameType } from '../shared/trackProfileGameTypes.js';
import { recalculateSessionScores } from './sessionScores.js';
import { invalidateTrackStatsCache } from './trackStats.js';

function applyRaceResults(
  db: Database.Database,
  sessionId: number,
  results: Array<{ startNumber: number; actualPosition: number | null }>,
  status: string,
) {
  const update = db.prepare(
    'UPDATE race_entries SET actual_position = ? WHERE session_id = ? AND start_number = ?',
  );
  db.prepare('UPDATE race_sessions SET status = ? WHERE id = ?').run(status, sessionId);
  db.transaction(() => {
    for (const r of results) {
      update.run(r.actualPosition, sessionId, r.startNumber);
    }
  })();
}

export interface RefreshTrackResultsSummary {
  atgTrackId: number;
  gameType: string | null;
  scanned: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** Hämtar resultat från ATG för avslutade lopp som fortfarande står som upcoming i databasen. */
export async function refreshTrackRaceResults(
  db: Database.Database,
  options: {
    atgTrackId: number;
    gameType?: string | null;
    maxSessions?: number;
  },
): Promise<RefreshTrackResultsSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const gameType = normalizeProfileGameType(options.gameType);
  const maxSessions = options.maxSessions ?? 80;

  let sql = `
    SELECT id, atg_race_id as atgRaceId
    FROM race_sessions
    WHERE atg_track_id = ?
      AND date < ?
      AND status != 'results'
  `;
  const args: Array<number | string> = [options.atgTrackId, today];
  if (gameType) {
    sql += ` AND game_type = ?`;
    args.push(gameType);
  }
  sql += ` ORDER BY date DESC LIMIT ?`;
  args.push(maxSessions);

  const rows = db.prepare(sql).all(...args) as Array<{ id: number; atgRaceId: string }>;

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const resultUpdate = await fetchRaceResults(row.atgRaceId);
      applyRaceResults(db, row.id, resultUpdate.results, resultUpdate.status);
      recalculateSessionScores(db, row.id);
      updated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('inga resultat än')) {
        skipped++;
      } else {
        errors.push(`Lopp ${row.id}: ${message}`);
      }
    }
  }

  if (updated > 0) {
    invalidateTrackStatsCache();
  }

  return {
    atgTrackId: options.atgTrackId,
    gameType: gameType || null,
    scanned: rows.length,
    updated,
    skipped,
    errors,
  };
}
