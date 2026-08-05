import express from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { fetchRaceResults, fetchRaceResultsFromUrl, refreshSessionScratchStatus } from './atg.js';
import { getStatsSyncStatus, runFullStatsSync, refreshSessionDriverV85WinPct, refreshSessionTrainerWinPct, backfillDriverV85WinPct } from './atgStats.js';
import { refreshSessionTrainerData, sessionNeedsTrainerBackfill } from './trainerRefresh.js';
import {
  getRaceIdsForGame,
  listGameSessions,
  loadGameSession,
  deleteGameSession,
  saveGameTipSnapshot,
  saveRaceTipSnapshot,
} from './gameSessions.js';
import { startStatsSyncJob } from './jobs/syncStats.js';
import { getAutoOptimizerStatus, scheduleAutoOptimize, startAutoOptimizeJob } from './jobs/autoOptimize.js';
import { startEarningsRefreshJob } from './jobs/refreshEarnings.js';
import { listBacktestTracks, normalizeMaxTrials, runBacktest } from './backtest.js';
import { refreshAllGameSessionRaceInfo } from './raceInfoRefresh.js';
import { saveUserSystem, validateUserSystemLegs } from './userSystem.js';
import {
  addHorseToWatchlist,
  listWatchlist,
  removeHorseFromWatchlist,
  getActiveWatchlistIdSet,
  WATCHLIST_DAYS,
} from './watchlist.js';
import { getBulkImportStatus, scheduleBulkImport } from './jobs/bulkImport.js';
import { listKnownTracks } from './atg.js';
import {
  getParameters as loadParameters,
  getScoringParameters,
  getScoringProfileSource,
  getSessionTipParameters,
  saveTipParameterSnapshot,
} from './parameters.js';
import { recalculateSessionScores as recalcSessionScores } from './sessionScores.js';
import {
  getTrackProfileOrGlobal,
  listTrackProfiles,
  saveTrackProfile,
} from './trackWeightProfiles.js';
import { computeStatsSummary, type StatsFilters } from './stats.js';
import {
  fetchDriverContributingStarts,
  fetchTrainerContributingStarts,
  getDriverStatSummary,
  getTrainerStatSummary,
  searchStatEntities,
} from './statsVerification.js';
import { accessGate } from './auth.js';
import { importAllGameLegsFromUrl, persistImportedRace } from './importService.js';
import { startTrainerBackfillJob } from './trainerRefresh.js';
import type { BacktestGoal, Parameter, RaceEntry, RaceSession } from '../shared/types.js';
import { DEFAULT_BACKTEST_GOAL } from '../shared/types.js';
import { BULK_IMPORT_LOOKBACK_MONTHS } from '../shared/types.js';

const app = express();
const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST ?? '0.0.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');

app.use(cors());
app.use(express.json());
app.use(accessGate);

function getParameters(): Parameter[] {
  return loadParameters(getDb());
}

function recalculateSessionScores(sessionId: number, options?: { useGlobal?: boolean }) {
  recalcSessionScores(getDb(), sessionId, options);
}

async function loadSession(id: number): Promise<RaceSession | null> {
  const db = getDb();
  const session = db
    .prepare(
      `SELECT id, game_session_id as gameSessionId, atg_race_id as atgRaceId, atg_track_id as atgTrackId,
              game_type as gameType, leg_number as legNumber, track_race_number as trackRaceNumber,
              date, track_name as trackName, distance, start_method as startMethod,
              source_url as sourceUrl, imported_at as importedAt, status,
              race_name as raceName, race_prize as racePrize, race_terms as raceTerms,
              scheduled_start_time as scheduledStartTime,
              tip_submitted_at as tipSubmittedAt,
              uses_tip_parameters as usesTipParameters
       FROM race_sessions WHERE id = ?`,
    )
    .get(id) as (Omit<RaceSession, 'entries' | 'tipParameters' | 'scoringParameters'> & {
      usesTipParameters: number;
      gameSessionId: number | null;
    }) | undefined;

  if (!session) return null;

  if (sessionNeedsTrainerBackfill(db, id)) {
    try {
      await refreshSessionTrainerData(db, id);
    } catch (err) {
      console.error(`Kunde inte hämta tränare för lopp ${id}:`, err);
    }
  } else if (refreshSessionTrainerWinPct(db, id)) {
    recalculateSessionScores(id);
  }

  if (refreshSessionDriverV85WinPct(db, id)) {
    recalculateSessionScores(id);
  }

  try {
    if (await refreshSessionScratchStatus(db, id)) {
      recalculateSessionScores(id);
    }
  } catch (err) {
    console.error(`Kunde inte synka strykningar för lopp ${id}:`, err);
  }

  const tipParameters = getSessionTipParameters(db, id);
  const scoringParameters = getScoringParameters(db, id);
  const scoringProfileSource = getScoringProfileSource(db, id);
  const usesTipParameters = session.usesTipParameters === 1;
  const watchedHorseIds = getActiveWatchlistIdSet(db);

  const entries = db
    .prepare(
      `SELECT id, start_number as startNumber, post_position as postPosition,
              start_distance as startDistance, volte_row as volteRow,
              horse_name as horseName, atg_horse_id as atgHorseId,
              atg_driver_id as atgDriverId, driver_name as driverName,
              atg_trainer_id as atgTrainerId, trainer_name as trainerName,
              start_points as startPoints, earnings_per_start as earningsPerStart,
              horse_sex as horseSex, career_starts as careerStarts,
              driver_apprentice as driverApprentice,
              driver_track_win_pct as driverTrackWinPct,
              driver_global_win_pct as driverGlobalWinPct,
              driver_v85_win_pct_override as driverV85WinPctOverride,
              trainer_win_pct as trainerWinPct,
              trainer_win_pct_override as trainerWinPctOverride,
              bet_distribution_pct as betDistributionPct,
              track_post_win_pct as trackPostWinPct,
              trot_score as trotScore, actual_position as actualPosition,
              scratched
       FROM race_entries WHERE session_id = ? ORDER BY start_number`,
    )
    .all(id) as RaceEntry[];

  for (const entry of entries) {
    entry.formStarts = db
      .prepare(
        `SELECT form_order as formOrder, date, distance, post_position as postPosition,
                km_time as kmTime, place, driver_name as driverName,
                prize_first as prizeFirst, track_name as trackName,
                is_record_time as isRecordTime
         FROM form_starts WHERE entry_id = ? ORDER BY form_order`,
      )
      .all(entry.id) as RaceEntry['formStarts'];

    entry.formStarts = entry.formStarts.map((f) => ({
      ...f,
      isRecordTime: Boolean((f as { isRecordTime?: number | boolean }).isRecordTime),
    }));

    const scoresRows = db
      .prepare('SELECT parameter_id, score FROM entry_scores WHERE entry_id = ?')
      .all(entry.id) as Array<{ parameter_id: string; score: number }>;

    entry.scores = Object.fromEntries(scoresRows.map((r) => [r.parameter_id, r.score]));
    entry.driverApprentice = Boolean(
      (entry as RaceEntry & { driverApprentice?: number | boolean }).driverApprentice,
    );
    entry.isWatched = watchedHorseIds.has(entry.atgHorseId);
    entry.scratched = Boolean(
      (entry as RaceEntry & { scratched?: number | boolean }).scratched,
    );
  }

  const termsRaw = (session as { raceTerms?: string | null }).raceTerms;
  let raceTerms: string[] = [];
  if (termsRaw) {
    try {
      raceTerms = JSON.parse(termsRaw) as string[];
    } catch {
      raceTerms = [];
    }
  }

  return {
    ...session,
    raceTerms,
    usesTipParameters,
    scoringProfileSource,
    tipParameters: tipParameters.length > 0 ? tipParameters : null,
    scoringParameters,
    entries,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/parameters', (_req, res) => {
  res.json(getParameters());
});

app.put('/api/parameters', (req, res) => {
  const params = req.body as Parameter[];
  const db = getDb();
  const update = db.prepare(`
    UPDATE parameters SET name = @name, weight = @weight, min_score = @minScore,
           max_score = @maxScore, sort_order = @sortOrder, auto_key = @autoKey
    WHERE id = @id
  `);
  db.transaction(() => {
    for (const p of params) update.run(p);
  })();

  const sessions = db
    .prepare('SELECT id FROM race_sessions WHERE tip_submitted_at IS NULL')
    .all() as Array<{ id: number }>;
  for (const s of sessions) recalculateSessionScores(s.id);

  res.json(getParameters());
});

app.post('/api/import', async (req, res) => {
  try {
    const { url, allLegs } = req.body as { url: string; allLegs?: boolean };
    if (!url?.trim()) return res.status(400).json({ error: 'URL saknas' });

    const db = getDb();
    if (allLegs) {
      const result = await importAllGameLegsFromUrl(db, url.trim());
      scheduleAutoOptimize(db);
      const game = loadGameSession(db, result.gameSessionId);
      if (!game) return res.status(500).json({ error: 'Omgången kunde inte laddas efter import' });
      res.json({
        gameSession: game,
        importedLegs: result.imported,
        totalLegs: result.total,
        errors: result.errors,
      });
      return;
    }

    const sessionId = await persistImportedRace(db, url.trim());
    scheduleAutoOptimize(db);
    res.json(await loadSession(sessionId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import misslyckades';
    res.status(500).json({ error: message });
  }
});

app.get('/api/tracks/known', (_req, res) => {
  res.json(listKnownTracks());
});

app.get('/api/import/bulk/status', (_req, res) => {
  res.json(getBulkImportStatus(getDb()));
});

app.post('/api/import/bulk', (req, res) => {
  const { atgTrackId, trackSlug, trackName, months } = req.body as {
    atgTrackId?: number;
    trackSlug?: string;
    trackName?: string;
    months?: number;
  };

  if (atgTrackId == null || !trackSlug?.trim() || !trackName?.trim()) {
    return res.status(400).json({ error: 'atgTrackId, trackSlug och trackName krävs' });
  }

  scheduleBulkImport(getDb(), {
    atgTrackId,
    trackSlug: trackSlug.trim(),
    trackName: trackName.trim(),
    months: months ?? BULK_IMPORT_LOOKBACK_MONTHS,
  });
  res.json(getBulkImportStatus(getDb()));
});

app.get('/api/track-profiles', (_req, res) => {
  res.json(listTrackProfiles(getDb()));
});

app.get('/api/track-profiles/:atgTrackId', (req, res) => {
  const atgTrackId = parseInt(req.params.atgTrackId, 10);
  if (Number.isNaN(atgTrackId)) {
    return res.status(400).json({ error: 'Ogiltigt ban-id' });
  }
  res.json(getTrackProfileOrGlobal(getDb(), atgTrackId));
});

app.put('/api/track-profiles/:atgTrackId', (req, res) => {
  const atgTrackId = parseInt(req.params.atgTrackId, 10);
  const { trackName, parameters } = req.body as {
    trackName?: string;
    parameters?: Parameter[];
  };

  if (Number.isNaN(atgTrackId)) {
    return res.status(400).json({ error: 'Ogiltigt ban-id' });
  }
  if (!trackName?.trim() || !parameters?.length) {
    return res.status(400).json({ error: 'trackName och parameters krävs' });
  }

  saveTrackProfile(getDb(), atgTrackId, trackName.trim(), parameters);
  res.json(getTrackProfileOrGlobal(getDb(), atgTrackId));
});

app.get('/api/sessions', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, atg_race_id as atgRaceId, game_type as gameType, leg_number as legNumber,
              track_race_number as trackRaceNumber, date, track_name as trackName, distance, status,
              imported_at as importedAt, tip_submitted_at as tipSubmittedAt,
              uses_tip_parameters as usesTipParameters
       FROM race_sessions ORDER BY date DESC, id DESC`,
    )
    .all()
    .map((row) => ({
      ...(row as Record<string, unknown>),
      usesTipParameters: (row as { usesTipParameters: number }).usesTipParameters === 1,
    }));
  res.json(rows);
});

app.get('/api/sessions/:id', async (req, res) => {
  const session = await loadSession(parseInt(req.params.id, 10));
  if (!session) return res.status(404).json({ error: 'Lopp hittades inte' });
  res.json(session);
});

app.patch('/api/sessions/:sessionId/entries/:entryId/scores', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const entryId = parseInt(req.params.entryId, 10);
  const { parameterId, score } = req.body as { parameterId: string; score: number };

  if (!parameterId || score == null || Number.isNaN(Number(score))) {
    return res.status(400).json({ error: 'parameterId och score krävs' });
  }
  if (score < 0 || score > 10) {
    return res.status(400).json({ error: 'Poäng måste vara 0–10' });
  }

  const db = getDb();
  const param = db
    .prepare('SELECT id, auto_key as autoKey FROM parameters WHERE id = ?')
    .get(parameterId) as { id: string; autoKey: string | null } | undefined;

  if (!param) return res.status(404).json({ error: 'Parameter hittades inte' });
  if (param.autoKey) {
    return res.status(400).json({ error: 'Endast manuella parametrar kan sättas här' });
  }

  const entry = db
    .prepare('SELECT id FROM race_entries WHERE id = ? AND session_id = ?')
    .get(entryId, sessionId) as { id: number } | undefined;

  if (!entry) return res.status(404).json({ error: 'Häst hittades inte i loppet' });

  if (score === 0) {
    db.prepare('DELETE FROM entry_scores WHERE entry_id = ? AND parameter_id = ?').run(
      entryId,
      parameterId,
    );
  } else {
    db.prepare(`
      INSERT INTO entry_scores (entry_id, parameter_id, score) VALUES (?, ?, ?)
      ON CONFLICT(entry_id, parameter_id) DO UPDATE SET score = excluded.score
    `).run(entryId, parameterId, score);
  }

  recalculateSessionScores(sessionId);
  res.json(await loadSession(sessionId));
});

app.patch('/api/sessions/:sessionId/entries/:entryId/driver-win-pct', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const entryId = parseInt(req.params.entryId, 10);
  const { winPct } = req.body as { winPct: number | null };

  if (!('winPct' in (req.body as object))) {
    return res.status(400).json({ error: 'winPct krävs (tal eller null)' });
  }
  if (winPct != null && (Number.isNaN(Number(winPct)) || winPct < 0 || winPct > 100)) {
    return res.status(400).json({ error: 'Kusk % måste vara 0–100' });
  }

  const db = getDb();
  const entry = db
    .prepare('SELECT id FROM race_entries WHERE id = ? AND session_id = ?')
    .get(entryId, sessionId) as { id: number } | undefined;

  if (!entry) return res.status(404).json({ error: 'Häst hittades inte i loppet' });

  db.prepare('UPDATE race_entries SET driver_v85_win_pct_override = ? WHERE id = ?').run(
    winPct,
    entryId,
  );

  recalculateSessionScores(sessionId);
  res.json(await loadSession(sessionId));
});

app.patch('/api/sessions/:sessionId/entries/:entryId/trainer-win-pct', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const entryId = parseInt(req.params.entryId, 10);
  const { winPct } = req.body as { winPct: number | null };

  if (!('winPct' in (req.body as object))) {
    return res.status(400).json({ error: 'winPct krävs (tal eller null)' });
  }
  if (winPct != null && (Number.isNaN(Number(winPct)) || winPct < 0 || winPct > 100)) {
    return res.status(400).json({ error: 'Tränare % måste vara 0–100' });
  }

  const db = getDb();
  const entry = db
    .prepare('SELECT id FROM race_entries WHERE id = ? AND session_id = ?')
    .get(entryId, sessionId) as { id: number } | undefined;

  if (!entry) return res.status(404).json({ error: 'Häst hittades inte i loppet' });

  db.prepare('UPDATE race_entries SET trainer_win_pct_override = ? WHERE id = ?').run(
    winPct,
    entryId,
  );

  recalculateSessionScores(sessionId);
  res.json(await loadSession(sessionId));
});

app.post('/api/sessions/:id/submit-tip', async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const exists = db
    .prepare('SELECT id FROM race_sessions WHERE id = ?')
    .get(sessionId) as { id: number } | undefined;

  if (!exists) return res.status(404).json({ error: 'Lopp hittades inte' });

  const params = getScoringParameters(db, sessionId);
  saveTipParameterSnapshot(db, sessionId, params);
  recalculateSessionScores(sessionId);
  res.json(await loadSession(sessionId));
});

app.post('/api/sessions/:id/recalculate', async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const exists = db
    .prepare('SELECT id FROM race_sessions WHERE id = ?')
    .get(sessionId) as { id: number } | undefined;

  if (!exists) return res.status(404).json({ error: 'Lopp hittades inte' });

  const useGlobal = (req.body as { useGlobal?: boolean })?.useGlobal === true;

  db.prepare('UPDATE race_sessions SET uses_tip_parameters = 0 WHERE id = ?').run(sessionId);
  recalculateSessionScores(sessionId, useGlobal ? { useGlobal: true } : undefined);
  res.json(await loadSession(sessionId));
});

app.post('/api/sessions/:id/restore-tip', async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const session = db
    .prepare('SELECT id, tip_submitted_at as tipSubmittedAt FROM race_sessions WHERE id = ?')
    .get(sessionId) as { id: number; tipSubmittedAt: string | null } | undefined;

  if (!session) return res.status(404).json({ error: 'Lopp hittades inte' });
  if (!session.tipSubmittedAt) {
    return res.status(400).json({ error: 'Inget sparat tips att återställa' });
  }

  db.prepare('UPDATE race_sessions SET uses_tip_parameters = 1 WHERE id = ?').run(sessionId);
  recalculateSessionScores(sessionId);
  res.json(await loadSession(sessionId));
});

function applyRaceResults(
  sessionId: number,
  results: Array<{ startNumber: number; actualPosition: number | null }>,
  status: string,
) {
  const db = getDb();
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

app.post('/api/sessions/:id/fetch-results', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const db = getDb();
    const session = db
      .prepare('SELECT id, atg_race_id as atgRaceId, source_url as sourceUrl FROM race_sessions WHERE id = ?')
      .get(sessionId) as { id: number; atgRaceId: string; sourceUrl: string | null } | undefined;

    if (!session) return res.status(404).json({ error: 'Lopp hittades inte' });

    const { url } = (req.body ?? {}) as { url?: string };
    const fetchUrl = url?.trim() || session.sourceUrl;

    const resultUpdate = fetchUrl
      ? await fetchRaceResultsFromUrl(fetchUrl)
      : await fetchRaceResults(session.atgRaceId);

    applyRaceResults(sessionId, resultUpdate.results, resultUpdate.status);
    scheduleAutoOptimize(getDb());
    res.json(await loadSession(sessionId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kunde inte hämta resultat';
    res.status(500).json({ error: message });
  }
});

app.get('/api/stats/sync', (_req, res) => {
  res.json(getStatsSyncStatus(getDb()));
});

app.post('/api/stats/sync', async (_req, res) => {
  const db = getDb();
  const status = getStatsSyncStatus(db);
  if (status.running) {
    return res.status(409).json({ error: 'Synk pågår redan', ...status });
  }

  try {
    await runFullStatsSync(db);
    res.json(getStatsSyncStatus(db));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Synk misslyckades';
    res.status(500).json({ error: message });
  }
});

app.get('/api/game-sessions', (_req, res) => {
  res.json(listGameSessions(getDb()));
});

app.get('/api/game-sessions/:id', (req, res) => {
  const game = loadGameSession(getDb(), parseInt(req.params.id, 10));
  if (!game) return res.status(404).json({ error: 'Omgång hittades inte' });
  res.json(game);
});

app.put('/api/game-sessions/:id/user-system', (req, res) => {
  const gameSessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const game = loadGameSession(db, gameSessionId);
  if (!game) return res.status(404).json({ error: 'Omgång hittades inte' });

  const body = req.body as { legs?: Array<{ legId: number; startNumbers: number[] }> };
  if (!body?.legs || !Array.isArray(body.legs)) {
    return res.status(400).json({ error: 'Ogiltigt system — legs saknas.' });
  }

  const validationError = validateUserSystemLegs(db, gameSessionId, body.legs);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  saveUserSystem(db, gameSessionId, body.legs);
  res.json(loadGameSession(db, gameSessionId));
});

app.post('/api/game-sessions/:id/refresh-race-info', async (req, res) => {
  const gameSessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const game = loadGameSession(db, gameSessionId);
  if (!game) return res.status(404).json({ error: 'Omgång hittades inte' });

  try {
    const updated = await refreshAllGameSessionRaceInfo(db, gameSessionId);
    res.json({ game: loadGameSession(db, gameSessionId), updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kunde inte hämta loppinfo';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/game-sessions/:id', (req, res) => {
  const gameSessionId = parseInt(req.params.id, 10);
  const deleted = deleteGameSession(getDb(), gameSessionId);
  if (!deleted) return res.status(404).json({ error: 'Omgång hittades inte' });
  res.json({ ok: true });
});

app.post('/api/game-sessions/:id/submit-tip', (req, res) => {
  const gameSessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const game = loadGameSession(db, gameSessionId);
  if (!game) return res.status(404).json({ error: 'Omgång hittades inte' });

  const raceIds = getRaceIdsForGame(db, gameSessionId);
  const gameParams =
    raceIds.length > 0 ? getScoringParameters(db, raceIds[0]) : getParameters(db);
  saveGameTipSnapshot(db, gameSessionId, gameParams);

  for (const raceId of raceIds) {
    const params = getScoringParameters(db, raceId);
    saveRaceTipSnapshot(db, raceId, params);
    recalculateSessionScores(raceId);
  }

  res.json(loadGameSession(db, gameSessionId));
});

app.post('/api/game-sessions/:id/recalculate', (req, res) => {
  const gameSessionId = parseInt(req.params.id, 10);
  const db = getDb();
  if (!loadGameSession(db, gameSessionId)) {
    return res.status(404).json({ error: 'Omgång hittades inte' });
  }

  const useGlobal = (req.body as { useGlobal?: boolean })?.useGlobal === true;

  db.prepare('UPDATE game_sessions SET uses_tip_parameters = 0 WHERE id = ?').run(gameSessionId);
  for (const raceId of getRaceIdsForGame(db, gameSessionId)) {
    db.prepare('UPDATE race_sessions SET uses_tip_parameters = 0 WHERE id = ?').run(raceId);
    recalculateSessionScores(raceId, useGlobal ? { useGlobal: true } : undefined);
  }

  res.json(loadGameSession(db, gameSessionId));
});

app.post('/api/game-sessions/:id/restore-tip', (req, res) => {
  const gameSessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const game = db
    .prepare('SELECT id, tip_submitted_at as tipSubmittedAt FROM game_sessions WHERE id = ?')
    .get(gameSessionId) as { id: number; tipSubmittedAt: string | null } | undefined;

  if (!game) return res.status(404).json({ error: 'Omgång hittades inte' });
  if (!game.tipSubmittedAt) {
    return res.status(400).json({ error: 'Inget sparat tips att återställa' });
  }

  db.prepare('UPDATE game_sessions SET uses_tip_parameters = 1 WHERE id = ?').run(gameSessionId);
  for (const raceId of getRaceIdsForGame(db, gameSessionId)) {
    db.prepare('UPDATE race_sessions SET uses_tip_parameters = 1 WHERE id = ?').run(raceId);
    recalculateSessionScores(raceId);
  }

  res.json(loadGameSession(db, gameSessionId));
});

app.post('/api/game-sessions/:id/fetch-results', async (req, res) => {
  try {
    const gameSessionId = parseInt(req.params.id, 10);
    const db = getDb();
    if (!loadGameSession(db, gameSessionId)) {
      return res.status(404).json({ error: 'Omgång hittades inte' });
    }

    const races = db
      .prepare(
        `SELECT id, atg_race_id as atgRaceId, source_url as sourceUrl, leg_number as legNumber
         FROM race_sessions WHERE game_session_id = ? ORDER BY leg_number`,
      )
      .all(gameSessionId) as Array<{
      id: number;
      atgRaceId: string;
      sourceUrl: string | null;
      legNumber: number;
    }>;

    const errors: string[] = [];
    for (const race of races) {
      try {
        const resultUpdate = race.sourceUrl
          ? await fetchRaceResultsFromUrl(race.sourceUrl)
          : await fetchRaceResults(race.atgRaceId);
        applyRaceResults(race.id, resultUpdate.results, resultUpdate.status);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Okänt fel';
        errors.push(`Avd ${race.legNumber}: ${msg}`);
      }
    }

    const game = loadGameSession(db, gameSessionId)!;
    scheduleAutoOptimize(db);
    if (errors.length > 0) {
      res.status(207).json({ game, errors });
      return;
    }
    res.json({ game, errors: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kunde inte hämta resultat';
    res.status(500).json({ error: message });
  }
});

function parseStatsFilters(query: express.Request['query']): StatsFilters {
  const str = (key: string) => {
    const value = query[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  return {
    trackName: str('trackName'),
    gameType: str('gameType'),
    dateFrom: str('dateFrom'),
    dateTo: str('dateTo'),
  };
}

app.get('/api/stats/entities', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  res.json(searchStatEntities(getDb(), q));
});

app.get('/api/stats/drivers/:id', (req, res) => {
  const driverId = parseInt(req.params.id, 10);
  if (Number.isNaN(driverId)) return res.status(400).json({ error: 'Ogiltigt kusk-id' });

  const trackIdRaw = req.query.trackId;
  const sessionIdRaw = req.query.sessionId;
  const entryIdRaw = req.query.entryId;
  const trackId =
    typeof trackIdRaw === 'string' && trackIdRaw.trim() !== ''
      ? parseInt(trackIdRaw, 10)
      : null;
  const sessionId =
    typeof sessionIdRaw === 'string' && sessionIdRaw.trim() !== ''
      ? parseInt(sessionIdRaw, 10)
      : null;
  const entryId =
    typeof entryIdRaw === 'string' && entryIdRaw.trim() !== ''
      ? parseInt(entryIdRaw, 10)
      : null;

  res.json(
    getDriverStatSummary(getDb(), driverId, {
      trackId: Number.isNaN(trackId ?? NaN) ? null : trackId,
      sessionId: Number.isNaN(sessionId ?? NaN) ? null : sessionId,
      entryId: Number.isNaN(entryId ?? NaN) ? null : entryId,
    }),
  );
});

app.get('/api/stats/drivers/:id/races', async (req, res) => {
  const driverId = parseInt(req.params.id, 10);
  if (Number.isNaN(driverId)) return res.status(400).json({ error: 'Ogiltigt kusk-id' });

  const trackIdRaw = req.query.trackId;
  const scopeRaw = req.query.scope;
  const trackId =
    typeof trackIdRaw === 'string' && trackIdRaw.trim() !== ''
      ? parseInt(trackIdRaw, 10)
      : null;
  const scope =
    scopeRaw === 'track' || scopeRaw === 'global' || scopeRaw === 'auto' ? scopeRaw : 'auto';

  try {
    const result = await fetchDriverContributingStarts(
      driverId,
      scope,
      Number.isNaN(trackId ?? NaN) ? null : trackId,
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kunde inte hämta lopp';
    res.status(500).json({ error: message });
  }
});

app.get('/api/stats/trainers/:id', (req, res) => {
  const trainerId = parseInt(req.params.id, 10);
  if (Number.isNaN(trainerId)) return res.status(400).json({ error: 'Ogiltigt tränar-id' });

  const sessionIdRaw = req.query.sessionId;
  const entryIdRaw = req.query.entryId;
  const sessionId =
    typeof sessionIdRaw === 'string' && sessionIdRaw.trim() !== ''
      ? parseInt(sessionIdRaw, 10)
      : null;
  const entryId =
    typeof entryIdRaw === 'string' && entryIdRaw.trim() !== ''
      ? parseInt(entryIdRaw, 10)
      : null;

  res.json(
    getTrainerStatSummary(getDb(), trainerId, {
      sessionId: Number.isNaN(sessionId ?? NaN) ? null : sessionId,
      entryId: Number.isNaN(entryId ?? NaN) ? null : entryId,
    }),
  );
});

app.get('/api/stats/trainers/:id/races', async (req, res) => {
  const trainerId = parseInt(req.params.id, 10);
  if (Number.isNaN(trainerId)) return res.status(400).json({ error: 'Ogiltigt tränar-id' });

  try {
    const result = await fetchTrainerContributingStarts(trainerId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kunde inte hämta lopp';
    res.status(500).json({ error: message });
  }
});

app.get('/api/stats', (req, res) => {
  res.json(computeStatsSummary(getDb(), parseStatsFilters(req.query)));
});

app.get('/api/watchlist', (_req, res) => {
  res.json({ entries: listWatchlist(getDb()), days: WATCHLIST_DAYS });
});

app.post('/api/watchlist', (req, res) => {
  const { atgHorseId, horseName, sourceSessionId } = req.body as {
    atgHorseId?: number;
    horseName?: string;
    sourceSessionId?: number | null;
  };
  if (atgHorseId == null || !Number.isFinite(atgHorseId)) {
    return res.status(400).json({ error: 'atgHorseId krävs' });
  }
  if (!horseName?.trim()) {
    return res.status(400).json({ error: 'horseName krävs' });
  }

  const db = getDb();
  addHorseToWatchlist(db, atgHorseId, horseName.trim(), sourceSessionId ?? null);
  res.json({ ok: true, days: WATCHLIST_DAYS });
});

app.delete('/api/watchlist/:atgHorseId', (req, res) => {
  const atgHorseId = parseInt(req.params.atgHorseId, 10);
  if (Number.isNaN(atgHorseId)) {
    return res.status(400).json({ error: 'Ogiltigt häst-id' });
  }
  removeHorseFromWatchlist(getDb(), atgHorseId);
  res.json({ ok: true });
});

app.get('/api/backtest/tracks', (_req, res) => {
  res.json(listBacktestTracks(getDb()));
});

app.post('/api/backtest/run', (req, res) => {
  const { atgTrackId, startMethod, gameType, goal, weights } = req.body as {
    atgTrackId?: number;
    startMethod?: 'auto' | 'volte' | null;
    gameType?: string | null;
    goal?: BacktestGoal;
    weights?: Parameter[];
  };

  if (atgTrackId == null) {
    return res.status(400).json({ error: 'atgTrackId krävs' });
  }
  if (goal !== 'win' && goal !== 'top3') {
    return res.status(400).json({ error: 'goal måste vara win eller top3' });
  }

  const parameters = weights?.length ? weights : getParameters();
  const result = runBacktest(
    getDb(),
    parameters,
    { atgTrackId, startMethod: startMethod ?? undefined, gameType: gameType ?? undefined },
    goal,
  );
  res.json(result);
});

app.post('/api/backtest/optimize', (req, res) => {
  const { atgTrackId, startMethod, gameType, goal, maxTrials } = req.body as {
    atgTrackId?: number;
    startMethod?: 'auto' | 'volte' | null;
    gameType?: string | null;
    goal?: BacktestGoal;
    maxTrials?: number;
  };

  if (atgTrackId == null) {
    return res.status(400).json({ error: 'atgTrackId krävs' });
  }
  if (goal !== 'win' && goal !== 'top3') {
    return res.status(400).json({ error: 'goal måste vara win eller top3' });
  }

  const status = getAutoOptimizerStatus(getDb(), atgTrackId);
  if (status.running) {
    return res.status(409).json({ error: 'Optimering pågår redan — vänta tills den är klar.' });
  }

  scheduleAutoOptimize(
    getDb(),
    goal,
    atgTrackId,
    normalizeMaxTrials(maxTrials),
    { allowLargeTrack: true },
  );
  res.json(getAutoOptimizerStatus(getDb(), atgTrackId));
});

app.get('/api/backtest/auto', (req, res) => {
  const atgTrackId = req.query.atgTrackId ? Number(req.query.atgTrackId) : undefined;
  const filterTrackId = Number.isFinite(atgTrackId) ? atgTrackId : undefined;
  res.json(getAutoOptimizerStatus(getDb(), filterTrackId));
});

app.post('/api/backtest/auto/run', (req, res) => {
  const { goal, atgTrackId, maxTrials } = (req.body ?? {}) as {
    goal?: BacktestGoal;
    atgTrackId?: number;
    maxTrials?: number;
  };
  const selectedGoal = goal === 'top3' ? 'top3' : DEFAULT_BACKTEST_GOAL;
  const trackId =
    typeof atgTrackId === 'number' && Number.isFinite(atgTrackId) ? atgTrackId : undefined;
  scheduleAutoOptimize(getDb(), selectedGoal, trackId, normalizeMaxTrials(maxTrials), {
    allowLargeTrack: true,
  });
  res.json(getAutoOptimizerStatus(getDb(), trackId));
});

function getLanAddresses(): string[] {
  const nets = os.networkInterfaces();
  const out: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  const db = getDb();
  const driverBackfill = backfillDriverV85WinPct(db);
  if (driverBackfill.entriesUpdated > 0) {
    console.log(`Kusk %: ${driverBackfill.entriesUpdated} rader synkade från cache`);
    for (const sessionId of driverBackfill.sessionIds) {
      recalculateSessionScores(sessionId);
    }
  }
  startStatsSyncJob(() => db);
  startTrainerBackfillJob(() => db);
  startAutoOptimizeJob(() => db);
  startEarningsRefreshJob(() => db);
  console.log(`TrotLab API på http://localhost:${PORT}`);
  console.log(`Databas: ${process.env.DATA_DIR ?? process.env.RAILWAY_VOLUME_MOUNT_PATH ?? 'data/'}`);
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    console.log(`TrotLab app på http://localhost:${PORT}`);
  }
  for (const ip of getLanAddresses()) {
    console.log(`Mobil i samma nätverk: http://${ip}:${PORT}`);
  }
});
