import type Database from 'better-sqlite3';

/** Bevakning gäller i 30 dagar (≈ 1 månad). */
export const WATCHLIST_DAYS = 30;

export interface WatchlistEntry {
  atgHorseId: number;
  horseName: string;
  markedAt: string;
  expiresAt: string;
  sourceSessionId: number | null;
}

function watchlistCutoffSql(): string {
  return `datetime('now', '-${WATCHLIST_DAYS} days')`;
}

export function purgeExpiredWatchlist(db: Database.Database): number {
  return db
    .prepare(`DELETE FROM horse_watchlist WHERE marked_at < ${watchlistCutoffSql()}`)
    .run().changes;
}

export function getActiveWatchlistIdSet(db: Database.Database): Set<number> {
  purgeExpiredWatchlist(db);
  const rows = db
    .prepare(
      `SELECT atg_horse_id as id FROM horse_watchlist
       WHERE marked_at >= ${watchlistCutoffSql()}`,
    )
    .all() as Array<{ id: number }>;
  return new Set(rows.map((r) => r.id));
}

export function isHorseWatched(db: Database.Database, atgHorseId: number): boolean {
  return getActiveWatchlistIdSet(db).has(atgHorseId);
}

export function listWatchlist(db: Database.Database): WatchlistEntry[] {
  purgeExpiredWatchlist(db);
  return db
    .prepare(
      `SELECT atg_horse_id as atgHorseId, horse_name as horseName,
              marked_at as markedAt, source_session_id as sourceSessionId,
              datetime(marked_at, '+${WATCHLIST_DAYS} days') as expiresAt
       FROM horse_watchlist
       WHERE marked_at >= ${watchlistCutoffSql()}
       ORDER BY marked_at DESC`,
    )
    .all() as WatchlistEntry[];
}

export function addHorseToWatchlist(
  db: Database.Database,
  atgHorseId: number,
  horseName: string,
  sourceSessionId?: number | null,
): void {
  purgeExpiredWatchlist(db);
  db.prepare(
    `INSERT INTO horse_watchlist (atg_horse_id, horse_name, source_session_id, marked_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(atg_horse_id) DO UPDATE SET
       horse_name = excluded.horse_name,
       source_session_id = COALESCE(excluded.source_session_id, horse_watchlist.source_session_id),
       marked_at = datetime('now')`,
  ).run(atgHorseId, horseName, sourceSessionId ?? null);
}

export function removeHorseFromWatchlist(db: Database.Database, atgHorseId: number): boolean {
  const result = db
    .prepare('DELETE FROM horse_watchlist WHERE atg_horse_id = ?')
    .run(atgHorseId);
  return result.changes > 0;
}
