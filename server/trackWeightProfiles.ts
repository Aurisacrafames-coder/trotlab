import type Database from 'better-sqlite3';
import type { Parameter, TrackProfileSummary } from '../shared/types.js';
import { getParameters } from './parameters.js';
import { recalculateSessionScores } from './sessionScores.js';

export function listTrackProfiles(db: Database.Database): TrackProfileSummary[] {
  return db
    .prepare(
      `SELECT m.atg_track_id as atgTrackId, m.track_name as trackName, m.updated_at as updatedAt,
              (SELECT COUNT(*) FROM race_sessions rs
               WHERE rs.atg_track_id = m.atg_track_id) as raceCount,
              (SELECT COUNT(*) FROM race_sessions rs
               WHERE rs.atg_track_id = m.atg_track_id
                 AND EXISTS (
                   SELECT 1 FROM race_entries re
                   WHERE re.session_id = rs.id AND re.actual_position IS NOT NULL AND re.actual_position > 0
                 )) as racesWithResult
       FROM track_profile_meta m
       ORDER BY m.track_name`,
    )
    .all() as TrackProfileSummary[];
}

export function hasTrackProfile(db: Database.Database, atgTrackId: number): boolean {
  const row = db
    .prepare(`SELECT 1 FROM track_profile_meta WHERE atg_track_id = ?`)
    .get(atgTrackId);
  return row != null;
}

export function getTrackProfileParameters(
  db: Database.Database,
  atgTrackId: number,
): Parameter[] | null {
  const rows = db
    .prepare(
      `SELECT parameter_id as id, name, weight, min_score as minScore, max_score as maxScore,
              sort_order as sortOrder, auto_key as autoKey
       FROM track_weight_profiles
       WHERE atg_track_id = ?
       ORDER BY sort_order`,
    )
    .all(atgTrackId) as Parameter[];

  return rows.length > 0 ? rows : null;
}

export function getTrackProfileOrGlobal(
  db: Database.Database,
  atgTrackId: number | null,
): Parameter[] {
  if (atgTrackId != null) {
    const profile = getTrackProfileParameters(db, atgTrackId);
    if (profile) return profile;
  }
  return getParameters(db);
}

export function saveTrackProfile(
  db: Database.Database,
  atgTrackId: number,
  trackName: string,
  params: Parameter[],
) {
  const del = db.prepare(`DELETE FROM track_weight_profiles WHERE atg_track_id = ?`);
  const insert = db.prepare(`
    INSERT INTO track_weight_profiles
      (atg_track_id, parameter_id, name, weight, min_score, max_score, sort_order, auto_key)
    VALUES (@atgTrackId, @id, @name, @weight, @minScore, @maxScore, @sortOrder, @autoKey)
  `);
  const upsertMeta = db.prepare(`
    INSERT INTO track_profile_meta (atg_track_id, track_name, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(atg_track_id) DO UPDATE SET
      track_name = excluded.track_name,
      updated_at = excluded.updated_at
  `);

  db.transaction(() => {
    del.run(atgTrackId);
    for (const p of params) {
      insert.run({ atgTrackId, ...p });
    }
    upsertMeta.run(atgTrackId, trackName);
  })();

  const sessions = db
    .prepare(
      `SELECT id FROM race_sessions
       WHERE atg_track_id = ? AND tip_submitted_at IS NULL`,
    )
    .all(atgTrackId) as Array<{ id: number }>;

  for (const session of sessions) {
    recalculateSessionScores(db, session.id);
  }
}

export function deleteTrackProfile(db: Database.Database, atgTrackId: number) {
  db.transaction(() => {
    db.prepare(`DELETE FROM track_weight_profiles WHERE atg_track_id = ?`).run(atgTrackId);
    db.prepare(`DELETE FROM track_profile_meta WHERE atg_track_id = ?`).run(atgTrackId);
  })();

  const sessions = db
    .prepare(
      `SELECT id FROM race_sessions
       WHERE atg_track_id = ? AND tip_submitted_at IS NULL`,
    )
    .all(atgTrackId) as Array<{ id: number }>;

  for (const session of sessions) {
    recalculateSessionScores(db, session.id);
  }
}
