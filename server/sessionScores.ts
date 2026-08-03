import type Database from 'better-sqlite3';
import {
  autoFormPlace,
  buildAutoScores,
  calculateTrotScore,
} from '../shared/scoring.js';
import { getParameters, getScoringParameters } from './parameters.js';
import { getTrackPostWinPercentCached } from './atgStats.js';

export function recalculateSessionScores(
  db: Database.Database,
  sessionId: number,
  options?: { useGlobal?: boolean },
) {
  const parameters = options?.useGlobal
    ? getParameters(db)
    : getScoringParameters(db, sessionId);

  const sessionMeta = db
    .prepare(
      `SELECT start_method as startMethod, atg_track_id as atgTrackId, date as raceDate
       FROM race_sessions WHERE id = ?`,
    )
    .get(sessionId) as {
    startMethod: string | null;
    atgTrackId: number | null;
    raceDate: string;
  } | undefined;

  const entries = db
    .prepare(
      `SELECT id, start_points, earnings_per_start, post_position, volte_row, start_distance,
              driver_track_win_pct, driver_global_win_pct, driver_v85_win_pct_override,
              trainer_win_pct, trainer_win_pct_override, track_post_win_pct, scratched
       FROM race_entries WHERE session_id = ?`,
    )
    .all(sessionId) as Array<{
    id: number;
    start_points: number | null;
    earnings_per_start: number | null;
    post_position: number | null;
    volte_row: 'front' | 'back' | null;
    start_distance: number | null;
    driver_track_win_pct: number | null;
    driver_global_win_pct: number | null;
    driver_v85_win_pct_override: number | null;
    trainer_win_pct: number | null;
    trainer_win_pct_override: number | null;
    track_post_win_pct: number | null;
    scratched: number;
  }>;

  const updateTrackPct = db.prepare(
    'UPDATE race_entries SET track_post_win_pct = ? WHERE id = ?',
  );

  if (sessionMeta?.atgTrackId) {
    for (const entry of entries) {
      if (entry.scratched) continue;
      const pct = getTrackPostWinPercentCached(
        sessionMeta.atgTrackId,
        entry.post_position,
        sessionMeta.startMethod,
        db,
        entry.volte_row === 'front' || entry.volte_row === 'back' ? entry.volte_row : null,
      );
      entry.track_post_win_pct = pct;
      updateTrackPct.run(pct, entry.id);
    }
  }

  const updateScore = db.prepare('UPDATE race_entries SET trot_score = ? WHERE id = ?');
  const upsertEntryScore = db.prepare(`
    INSERT INTO entry_scores (entry_id, parameter_id, score) VALUES (?, ?, ?)
    ON CONFLICT(entry_id, parameter_id) DO UPDATE SET score = excluded.score
  `);

  const activeEntries = entries.filter((e) => !e.scratched);
  const fieldStartPoints = activeEntries.map((e) => e.start_points);
  const fieldEarningsPerStart = activeEntries.map((e) => e.earnings_per_start);
  const fieldStartDistances = activeEntries.map((e) => e.start_distance);

  for (const entry of entries) {
    if (entry.scratched) {
      for (const param of parameters) {
        upsertEntryScore.run(entry.id, param.id, 0);
      }
      updateScore.run(0, entry.id);
      continue;
    }

    const formStarts = db
      .prepare(
        `SELECT date, place, km_time as kmTime, prize_first as prizeFirst,
                is_record_time as isRecordTime
         FROM form_starts WHERE entry_id = ? ORDER BY form_order`,
      )
      .all(entry.id) as Array<{
        date: string | null;
        place: string | null;
        kmTime: string | null;
        prizeFirst: number | null;
        isRecordTime: number | boolean | null;
      }>;

    const recentFormStarts = formStarts.slice(0, 2).map((row) => ({
      ...row,
      isRecordTime: Boolean(row.isRecordTime),
    }));

    const manualParamIds = new Set(
      parameters.filter((p) => !p.autoKey).map((p) => p.id),
    );
    const manualRows = db
      .prepare('SELECT parameter_id, score FROM entry_scores WHERE entry_id = ?')
      .all(entry.id) as Array<{ parameter_id: string; score: number }>;

    const manualScores = Object.fromEntries(
      manualRows
        .filter((r) => manualParamIds.has(r.parameter_id))
        .map((r) => [r.parameter_id, r.score]),
    );
    const formPlaceScore = autoFormPlace(formStarts, sessionMeta?.raceDate ?? '');

    const scores = buildAutoScores(
      {
        startPoints: entry.start_points,
        earningsPerStart: entry.earnings_per_start,
        fieldStartPoints,
        fieldEarningsPerStart,
        formPlace: formPlaceScore,
        postPosition: entry.post_position,
        startMethod: sessionMeta?.startMethod ?? null,
        fieldSize: activeEntries.length || 12,
        volteRow: entry.volte_row,
        startDistance: entry.start_distance,
        fieldStartDistances,
        driverTrackWinPct: entry.driver_track_win_pct,
        driverGlobalWinPct: entry.driver_global_win_pct,
        driverWinPctOverride: entry.driver_v85_win_pct_override,
        trainerWinPct: entry.trainer_win_pct_override ?? entry.trainer_win_pct,
        trackPostWinPct: entry.track_post_win_pct,
        recentFormStarts,
        raceDate: sessionMeta?.raceDate ?? '',
        manualScores,
      },
      parameters,
    );

    for (const [paramId, score] of Object.entries(scores)) {
      upsertEntryScore.run(entry.id, paramId, score);
    }

    updateScore.run(calculateTrotScore(scores, parameters), entry.id);
  }
}
