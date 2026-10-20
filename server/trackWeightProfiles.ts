import type Database from 'better-sqlite3';
import type { Parameter, TrackProfileSummary } from '../shared/types.js';
import { normalizeProfileGameType } from '../shared/trackProfileGameTypes.js';
import { getParameters, mergeParametersWithGlobal } from './parameters.js';
import { recalculateSessionScores } from './sessionScores.js';
import { listTrackStats } from './trackStats.js';

function countSessionsForProfile(
  db: Database.Database,
  atgTrackId: number,
  gameType: string,
): { raceCount: number; racesWithResult: number } {
  const normalized = normalizeProfileGameType(gameType);
  const row = db
    .prepare(
      `SELECT COUNT(*) as raceCount,
              SUM(CASE WHEN status = 'results' THEN 1 ELSE 0 END) as racesWithResult
       FROM race_sessions
       WHERE atg_track_id = ?
         AND (? = '' OR game_type = ?)`,
    )
    .get(atgTrackId, normalized, normalized) as {
    raceCount: number;
    racesWithResult: number | null;
  };
  return {
    raceCount: row.raceCount,
    racesWithResult: row.racesWithResult ?? 0,
  };
}

export function listTrackProfiles(db: Database.Database): TrackProfileSummary[] {
  const statsByTrack = new Map(listTrackStats(db).map((t) => [t.atgTrackId, t]));
  const rows = db
    .prepare(
      `SELECT atg_track_id as atgTrackId, game_type as gameType, track_name as trackName, updated_at as updatedAt
       FROM track_profile_meta
       ORDER BY track_name, game_type`,
    )
    .all() as Array<{
    atgTrackId: number;
    gameType: string;
    trackName: string;
    updatedAt: string;
  }>;

  return rows.map((row) => {
    const stats = statsByTrack.get(row.atgTrackId);
    const scoped = countSessionsForProfile(db, row.atgTrackId, row.gameType);
    return {
      atgTrackId: row.atgTrackId,
      gameType: normalizeProfileGameType(row.gameType),
      trackName: row.trackName,
      updatedAt: row.updatedAt,
      raceCount: scoped.raceCount || stats?.raceCount || 0,
      racesWithResult: scoped.racesWithResult || stats?.racesWithResult || 0,
    };
  });
}

export function hasTrackProfile(
  db: Database.Database,
  atgTrackId: number,
  gameType?: string | null,
): boolean {
  const normalized = normalizeProfileGameType(gameType);
  if (normalized) {
    const exact = db
      .prepare(`SELECT 1 FROM track_profile_meta WHERE atg_track_id = ? AND game_type = ?`)
      .get(atgTrackId, normalized);
    if (exact) return true;
  }
  const fallback = db
    .prepare(`SELECT 1 FROM track_profile_meta WHERE atg_track_id = ? AND game_type = ''`)
    .get(atgTrackId);
  return fallback != null;
}

export function getTrackProfileParameters(
  db: Database.Database,
  atgTrackId: number,
  gameType: string = '',
): Parameter[] | null {
  const normalized = normalizeProfileGameType(gameType);
  const load = (gt: string) =>
    db
      .prepare(
        `SELECT parameter_id as id, name, weight, min_score as minScore, max_score as maxScore,
                sort_order as sortOrder, auto_key as autoKey
         FROM track_weight_profiles
         WHERE atg_track_id = ? AND game_type = ?
         ORDER BY sort_order`,
      )
      .all(atgTrackId, gt) as Parameter[];

  if (normalized) {
    const exact = load(normalized);
    if (exact.length > 0) return exact;
  }
  const all = load('');
  return all.length > 0 ? all : null;
}

export function resolveTrackProfileParameters(
  db: Database.Database,
  atgTrackId: number,
  sessionGameType: string | null | undefined,
): Parameter[] | null {
  const gameType = normalizeProfileGameType(sessionGameType);
  if (gameType) {
    const exact = getTrackProfileParameters(db, atgTrackId, gameType);
    if (exact) return exact;
  }
  return getTrackProfileParameters(db, atgTrackId, '');
}

export function getTrackProfileOrGlobal(
  db: Database.Database,
  atgTrackId: number | null,
  gameType?: string | null,
): Parameter[] {
  if (atgTrackId != null) {
    const profile = resolveTrackProfileParameters(db, atgTrackId, gameType);
    if (profile) return mergeParametersWithGlobal(profile, getParameters(db));
  }
  return getParameters(db);
}

export function saveTrackProfile(
  db: Database.Database,
  atgTrackId: number,
  trackName: string,
  params: Parameter[],
  gameType: string = '',
) {
  const normalizedGameType = normalizeProfileGameType(gameType);
  const del = db.prepare(
    `DELETE FROM track_weight_profiles WHERE atg_track_id = ? AND game_type = ?`,
  );
  const insert = db.prepare(`
    INSERT INTO track_weight_profiles
      (atg_track_id, game_type, parameter_id, name, weight, min_score, max_score, sort_order, auto_key)
    VALUES (@atgTrackId, @gameType, @id, @name, @weight, @minScore, @maxScore, @sortOrder, @autoKey)
  `);
  const upsertMeta = db.prepare(`
    INSERT INTO track_profile_meta (atg_track_id, game_type, track_name, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(atg_track_id, game_type) DO UPDATE SET
      track_name = excluded.track_name,
      updated_at = excluded.updated_at
  `);

  db.transaction(() => {
    del.run(atgTrackId, normalizedGameType);
    for (const p of params) {
      insert.run({ atgTrackId, gameType: normalizedGameType, ...p });
    }
    upsertMeta.run(atgTrackId, normalizedGameType, trackName);
  })();

  const sessionSql =
    normalizedGameType === ''
      ? `SELECT id FROM race_sessions
         WHERE atg_track_id = ? AND tip_submitted_at IS NULL`
      : `SELECT id FROM race_sessions
         WHERE atg_track_id = ? AND tip_submitted_at IS NULL AND game_type = ?`;

  const sessions =
    normalizedGameType === ''
      ? (db.prepare(sessionSql).all(atgTrackId) as Array<{ id: number }>)
      : (db.prepare(sessionSql).all(atgTrackId, normalizedGameType) as Array<{ id: number }>);

  for (const session of sessions) {
    recalculateSessionScores(db, session.id);
  }
}

export function deleteTrackProfile(
  db: Database.Database,
  atgTrackId: number,
  gameType: string = '',
) {
  const normalizedGameType = normalizeProfileGameType(gameType);
  db.transaction(() => {
    db.prepare(`DELETE FROM track_weight_profiles WHERE atg_track_id = ? AND game_type = ?`).run(
      atgTrackId,
      normalizedGameType,
    );
    db.prepare(`DELETE FROM track_profile_meta WHERE atg_track_id = ? AND game_type = ?`).run(
      atgTrackId,
      normalizedGameType,
    );
  })();

  const sessionSql =
    normalizedGameType === ''
      ? `SELECT id FROM race_sessions
         WHERE atg_track_id = ? AND tip_submitted_at IS NULL`
      : `SELECT id FROM race_sessions
         WHERE atg_track_id = ? AND tip_submitted_at IS NULL AND game_type = ?`;

  const sessions =
    normalizedGameType === ''
      ? (db.prepare(sessionSql).all(atgTrackId) as Array<{ id: number }>)
      : (db.prepare(sessionSql).all(atgTrackId, normalizedGameType) as Array<{ id: number }>);

  for (const session of sessions) {
    recalculateSessionScores(db, session.id);
  }
}
