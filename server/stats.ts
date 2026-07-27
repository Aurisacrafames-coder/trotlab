import type Database from 'better-sqlite3';
import { evaluateTopPicksLegHit, TOP_PICK_COUNT } from '../shared/scoring.js';
import type { StatsSummary } from '../shared/types.js';
import { sessionMatchesFilters, type StatsFilters } from '../shared/statsFilters.js';

export type { StatsFilters };
export { sessionMatchesFilters };

function buildSessionFilterWhere(filters: StatsFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.trackName) {
    clauses.push('track_name = ?');
    params.push(filters.trackName);
  }
  if (filters.gameType) {
    clauses.push('game_type = ?');
    params.push(filters.gameType);
  }
  if (filters.dateFrom) {
    clauses.push('date >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    clauses.push('date <= ?');
    params.push(filters.dateTo);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export function computeStatsSummary(db: Database.Database, filters: StatsFilters = {}): StatsSummary {
  const { where, params } = buildSessionFilterWhere(filters);
  const sessions = db
    .prepare(`SELECT id FROM race_sessions ${where}`)
    .all(...params) as Array<{ id: number }>;

  let racesWithResult = 0;
  let topScoreWins = 0;
  let topScoreTop3 = 0;

  for (const { id } of sessions) {
    const withResult = db
      .prepare(
        `SELECT COUNT(*) as c FROM race_entries
         WHERE session_id = ? AND actual_position IS NOT NULL AND actual_position > 0`,
      )
      .get(id) as { c: number };

    if (withResult.c === 0) continue;
    racesWithResult++;

    const allScored = db
      .prepare(
        `SELECT start_number, trot_score, actual_position FROM race_entries
         WHERE session_id = ? AND trot_score IS NOT NULL`,
      )
      .all(id) as Array<{
      start_number: number;
      trot_score: number;
      actual_position: number | null;
    }>;

    if (allScored.length === 0) continue;

    const topPicks = [...allScored]
      .sort((a, b) => b.trot_score - a.trot_score || a.start_number - b.start_number)
      .slice(0, TOP_PICK_COUNT);
    const legHit = evaluateTopPicksLegHit(topPicks.map((e) => e.actual_position));
    if (legHit === 'win') topScoreWins++;
    if (legHit === 'win' || legHit === 'top3') topScoreTop3++;
  }

  return {
    totalRaces: sessions.length,
    racesWithResult,
    topScoreWins,
    topScoreTop3,
    hitRateWin:
      racesWithResult > 0 ? Math.round((topScoreWins / racesWithResult) * 1000) / 10 : null,
    hitRateTop3:
      racesWithResult > 0 ? Math.round((topScoreTop3 / racesWithResult) * 1000) / 10 : null,
  };
}
