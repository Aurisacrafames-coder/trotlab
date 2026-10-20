import type Database from 'better-sqlite3';
import type { Parameter } from '../shared/types.js';
import { resolveTrackProfileParameters } from './trackWeightProfiles.js';

export function getParameters(db: Database.Database): Parameter[] {
  return db
    .prepare(
      `SELECT id, name, weight, min_score as minScore, max_score as maxScore,
              sort_order as sortOrder, auto_key as autoKey
       FROM parameters ORDER BY sort_order`,
    )
    .all() as Parameter[];
}

/** Fill in any parameters added after a track profile was saved. */
export function mergeParametersWithGlobal(
  trackParams: Parameter[],
  globalParams: Parameter[],
): Parameter[] {
  const trackById = new Map(trackParams.map((p) => [p.id, p]));
  return globalParams.map((global) => trackById.get(global.id) ?? global);
}

export type ScoringProfileSource = 'tip' | 'track' | 'global';

export function getScoringProfileSource(
  db: Database.Database,
  sessionId: number,
): ScoringProfileSource {
  const session = db
    .prepare(
      `SELECT uses_tip_parameters as usesTip, atg_track_id as atgTrackId, game_type as gameType
       FROM race_sessions WHERE id = ?`,
    )
    .get(sessionId) as
    | { usesTip: number; atgTrackId: number | null; gameType: string }
    | undefined;

  if (session?.usesTip) {
    const tipParams = getSessionTipParameters(db, sessionId);
    if (tipParams.length > 0) return 'tip';
  }

  if (session?.atgTrackId != null) {
    if (resolveTrackProfileParameters(db, session.atgTrackId, session.gameType)) return 'track';
  }

  return 'global';
}

export function getSessionTipParameters(db: Database.Database, sessionId: number): Parameter[] {
  return db
    .prepare(
      `SELECT parameter_id as id, name, weight, min_score as minScore, max_score as maxScore,
              sort_order as sortOrder, auto_key as autoKey
       FROM session_parameters WHERE session_id = ? ORDER BY sort_order`,
    )
    .all(sessionId) as Parameter[];
}

export function getScoringParameters(db: Database.Database, sessionId: number): Parameter[] {
  const session = db
    .prepare(
      `SELECT uses_tip_parameters as usesTip, atg_track_id as atgTrackId, game_type as gameType
       FROM race_sessions WHERE id = ?`,
    )
    .get(sessionId) as
    | { usesTip: number; atgTrackId: number | null; gameType: string }
    | undefined;

  if (session?.usesTip) {
    const tipParams = getSessionTipParameters(db, sessionId);
    if (tipParams.length > 0) return tipParams;
  }

  if (session?.atgTrackId != null) {
    const trackProfile = resolveTrackProfileParameters(db, session.atgTrackId, session.gameType);
    if (trackProfile) {
      return mergeParametersWithGlobal(trackProfile, getParameters(db));
    }
  }

  return getParameters(db);
}

export function saveTipParameterSnapshot(
  db: Database.Database,
  sessionId: number,
  params: Parameter[],
) {
  const del = db.prepare('DELETE FROM session_parameters WHERE session_id = ?');
  const insert = db.prepare(`
    INSERT INTO session_parameters
      (session_id, parameter_id, name, weight, min_score, max_score, sort_order, auto_key)
    VALUES (@sessionId, @id, @name, @weight, @minScore, @maxScore, @sortOrder, @autoKey)
  `);

  db.transaction(() => {
    del.run(sessionId);
    for (const p of params) {
      insert.run({ sessionId, ...p });
    }
    db.prepare(
      `UPDATE race_sessions
       SET tip_submitted_at = datetime('now'), uses_tip_parameters = 1
       WHERE id = ?`,
    ).run(sessionId);
  })();
}
