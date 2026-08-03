import type Database from 'better-sqlite3';
import type { GameSession, GameSessionLeg, Parameter } from '../shared/types.js';
import { evaluateTopPicksLegHit, TOP_PICK_COUNT } from '../shared/scoring.js';
import { computeSpikeMetrics, pickSpikeSuggestions } from '../shared/spikeSuggestions.js';
import { analyzeSystemLeg } from '../shared/systemSuggestions.js';
import { buildPlanFromSessionLegs } from '../shared/systemOptimizer.js';
import { loadUserSystem } from './userSystem.js';
import { getActiveWatchlistIdSet } from './watchlist.js';

export function findOrCreateGameSession(
  db: Database.Database,
  data: {
    gameType: string;
    date: string;
    trackName: string;
    atgTrackId: number;
  },
): number {
  const existing = db
    .prepare(
      `SELECT id FROM game_sessions
       WHERE game_type = ? AND date = ? AND atg_track_id = ?`,
    )
    .get(data.gameType, data.date, data.atgTrackId) as { id: number } | undefined;

  if (existing) return existing.id;

  const result = db
    .prepare(
      `INSERT INTO game_sessions (game_type, date, track_name, atg_track_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(data.gameType, data.date, data.trackName, data.atgTrackId);

  return Number(result.lastInsertRowid);
}

export function linkRaceToGameSession(
  db: Database.Database,
  raceSessionId: number,
  gameSessionId: number,
) {
  db.prepare('UPDATE race_sessions SET game_session_id = ? WHERE id = ?').run(
    gameSessionId,
    raceSessionId,
  );
}

export function getGameSessionTipParameters(
  db: Database.Database,
  gameSessionId: number,
): Parameter[] {
  return db
    .prepare(
      `SELECT parameter_id as id, name, weight, min_score as minScore, max_score as maxScore,
              sort_order as sortOrder, auto_key as autoKey
       FROM game_session_parameters WHERE game_session_id = ? ORDER BY sort_order`,
    )
    .all(gameSessionId) as Parameter[];
}

export function saveGameTipSnapshot(
  db: Database.Database,
  gameSessionId: number,
  params: Parameter[],
) {
  const del = db.prepare('DELETE FROM game_session_parameters WHERE game_session_id = ?');
  const insert = db.prepare(`
    INSERT INTO game_session_parameters
      (game_session_id, parameter_id, name, weight, min_score, max_score, sort_order, auto_key)
    VALUES (@gameSessionId, @id, @name, @weight, @minScore, @maxScore, @sortOrder, @autoKey)
  `);

  db.transaction(() => {
    del.run(gameSessionId);
    for (const p of params) {
      insert.run({ gameSessionId, ...p });
    }
    db.prepare(
      `UPDATE game_sessions
       SET tip_submitted_at = datetime('now'), uses_tip_parameters = 1
       WHERE id = ?`,
    ).run(gameSessionId);
  })();
}

export function saveRaceTipSnapshot(
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

export function getRaceIdsForGame(db: Database.Database, gameSessionId: number): number[] {
  const rows = db
    .prepare('SELECT id FROM race_sessions WHERE game_session_id = ? ORDER BY leg_number')
    .all(gameSessionId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

function computeLegHit(
  topPositions: Array<number | null>,
  raceStatus: string | null,
): 'win' | 'top3' | 'miss' | 'pending' | null {
  const raceDone = raceStatus === 'results';
  const hasKnownResult = topPositions.some((p) => p != null);
  if (!hasKnownResult) return raceDone ? 'miss' : 'pending';
  return evaluateTopPicksLegHit(topPositions);
}

function parseRaceTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function loadLegSummary(db: Database.Database, sessionId: number): GameSessionLeg {
  const session = db
    .prepare(
      `SELECT id, leg_number as legNumber, track_race_number as trackRaceNumber, distance,
              start_method as startMethod, status, race_name as raceName, race_prize as racePrize,
              race_terms as raceTerms, scheduled_start_time as scheduledStartTime
       FROM race_sessions WHERE id = ?`,
    )
    .get(sessionId) as {
    id: number;
    legNumber: number;
    trackRaceNumber: number | null;
    distance: number | null;
    startMethod: string | null;
    status: string | null;
    raceName: string | null;
    racePrize: string | null;
    raceTerms: string | null;
    scheduledStartTime: string | null;
  };

  const terms = parseRaceTerms(session.raceTerms);
  const watchedHorseIds = getActiveWatchlistIdSet(db);

  const entries = db
    .prepare(
      `SELECT start_number as startNumber, horse_name as horseName, atg_horse_id as atgHorseId,
              trot_score as trotScore, actual_position as actualPosition,
              start_points as startPoints, earnings_per_start as earningsPerStart,
              horse_sex as horseSex, career_starts as careerStarts,
              driver_apprentice as driverApprentice, scratched
       FROM race_entries WHERE session_id = ? ORDER BY start_number`,
    )
    .all(sessionId) as Array<{
    startNumber: number;
    horseName: string;
    atgHorseId: number;
    trotScore: number | null;
    actualPosition: number | null;
    startPoints: number | null;
    earningsPerStart: number | null;
    horseSex: string | null;
    careerStarts: number | null;
    driverApprentice: number;
    scratched: number;
  }>;

  const activeEntries = entries.filter((e) => !e.scratched);
  const scored = [...entries]
    .filter((e) => e.trotScore != null)
    .sort((a, b) => {
      if (a.scratched !== b.scratched) return a.scratched - b.scratched;
      return b.trotScore! - a.trotScore! || a.startNumber - b.startNumber;
    });

  const topPicks = scored.slice(0, TOP_PICK_COUNT);
  const top = scored[0];
  const second = scored[1];
  const spike = computeSpikeMetrics(top?.trotScore ?? null, second?.trotScore ?? null);

  const systemSuggestion = analyzeSystemLeg({
    terms,
    entries: activeEntries.map((e) => ({
      startNumber: e.startNumber,
      horseName: e.horseName,
      trotScore: e.trotScore,
      startPoints: e.startPoints,
      earningsPerStart: e.earningsPerStart,
      horseSex: e.horseSex,
      careerStarts: e.careerStarts,
      driverApprentice: e.driverApprentice === 1,
    })),
  });

  const raceInfo =
    session.raceName || session.racePrize || terms.length > 0 || session.scheduledStartTime
      ? {
          name: session.raceName,
          prize: session.racePrize,
          terms,
          startMethod: session.startMethod,
          distance: session.distance,
          scheduledStartTime: session.scheduledStartTime,
        }
      : session.distance || session.startMethod
        ? {
            name: null,
            prize: null,
            terms: [],
            startMethod: session.startMethod,
            distance: session.distance,
            scheduledStartTime: session.scheduledStartTime,
          }
        : null;

  return {
    id: session.id,
    legNumber: session.legNumber,
    trackRaceNumber: session.trackRaceNumber,
    distance: session.distance,
    startMethod: session.startMethod,
    status: session.status,
    raceInfo,
    systemSuggestion,
    rankedHorses: scored.map((e) => ({
      startNumber: e.startNumber,
      horseName: e.horseName,
      trotScore: e.trotScore!,
      isWatched: watchedHorseIds.has(e.atgHorseId),
      scratched: e.scratched === 1,
    })),
    topStartNumber: top?.startNumber ?? null,
    topHorseName: top?.horseName ?? null,
    topScore: top?.trotScore ?? null,
    secondStartNumber: second?.startNumber ?? null,
    secondHorseName: second?.horseName ?? null,
    secondScore: second?.trotScore ?? null,
    marginToSecond: spike.marginToSecond,
    spikeScore: spike.spikeScore,
    meetsSpikeCriteria: spike.meetsSpikeCriteria,
    topPosition: top?.actualPosition ?? null,
    hit: topPicks.length > 0
      ? computeLegHit(
          topPicks.map((p) => p.actualPosition),
          session.status,
        )
      : null,
  };
}

export function loadGameSession(db: Database.Database, id: number): GameSession | null {
  const game = db
    .prepare(
      `SELECT id, game_type as gameType, date, track_name as trackName,
              atg_track_id as atgTrackId, tip_submitted_at as tipSubmittedAt,
              uses_tip_parameters as usesTipParameters
       FROM game_sessions WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        gameType: string;
        date: string;
        trackName: string;
        atgTrackId: number | null;
        tipSubmittedAt: string | null;
        usesTipParameters: number;
      }
    | undefined;

  if (!game) return null;

  const raceIds = getRaceIdsForGame(db, id);
  const legs = raceIds.map((raceId) => loadLegSummary(db, raceId));

  let legsWithResults = 0;
  let hitsWin = 0;
  let hitsTop3 = 0;
  for (const leg of legs) {
    if (leg.hit && leg.hit !== 'pending') legsWithResults++;
    if (leg.hit === 'win') hitsWin++;
    if (leg.hit === 'top3') hitsTop3++;
  }

  const tipParams = getGameSessionTipParameters(db, id);
  const suggestedSpikes = pickSpikeSuggestions(
    legs.map((leg) => ({
      legId: leg.id,
      legNumber: leg.legNumber,
      trackRaceNumber: leg.trackRaceNumber,
      topStartNumber: leg.topStartNumber,
      topHorseName: leg.topHorseName,
      topScore: leg.topScore,
      secondStartNumber: leg.secondStartNumber,
      secondHorseName: leg.secondHorseName,
      secondScore: leg.secondScore,
    })),
  );

  const spikeLegIds = new Set(suggestedSpikes.map((s) => s.legId));
  const systemPlan = buildPlanFromSessionLegs(
    legs,
    legs.map((leg) => leg.systemSuggestion?.recommendedPickCount ?? 1),
    spikeLegIds,
  );

  const userSystem = loadUserSystem(db, id);

  return {
    id: game.id,
    gameType: game.gameType,
    date: game.date,
    trackName: game.trackName,
    atgTrackId: game.atgTrackId,
    tipSubmittedAt: game.tipSubmittedAt,
    usesTipParameters: game.usesTipParameters === 1,
    tipParameters: tipParams.length > 0 ? tipParams : null,
    legCount: legs.length,
    legsWithResults,
    hitsWin,
    hitsTop3,
    suggestedSpikes,
    systemPlan,
    userSystem,
    legs,
  };
}

export interface GameSessionListItem {
  id: number;
  gameType: string;
  date: string;
  trackName: string;
  legCount: number;
  tipSubmittedAt: string | null;
  hitsWin: number;
  legsWithResults: number;
}

export function listGameSessions(db: Database.Database): GameSessionListItem[] {
  const games = db
    .prepare(
      `SELECT id, game_type as gameType, date, track_name as trackName,
              tip_submitted_at as tipSubmittedAt
       FROM game_sessions ORDER BY date DESC, id DESC`,
    )
    .all() as Array<{
    id: number;
    gameType: string;
    date: string;
    trackName: string;
    tipSubmittedAt: string | null;
  }>;

  return games.map((g) => {
    const full = loadGameSession(db, g.id)!;
    return {
      id: g.id,
      gameType: g.gameType,
      date: g.date,
      trackName: g.trackName,
      legCount: full.legCount,
      tipSubmittedAt: g.tipSubmittedAt,
      hitsWin: full.hitsWin,
      legsWithResults: full.legsWithResults,
    };
  });
}

export function deleteGameSession(db: Database.Database, id: number): boolean {
  const exists = db.prepare('SELECT id FROM game_sessions WHERE id = ?').get(id) as
    | { id: number }
    | undefined;
  if (!exists) return false;

  db.transaction(() => {
    db.prepare('DELETE FROM race_sessions WHERE game_session_id = ?').run(id);
    db.prepare('DELETE FROM game_sessions WHERE id = ?').run(id);
  })();

  return true;
}
