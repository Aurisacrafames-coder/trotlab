import express from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { fetchRaceResults, fetchRaceResultsFromUrl } from './atg.js';
import { getStatsSyncStatus, runTrackPostStatsSync, backfillTrackPostWinPct } from './atgStats.js';
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
import { listBacktestTracks, optimizeWeights, runBacktest } from './backtest.js';
import { refreshAllGameSessionRaceInfo } from './raceInfoRefresh.js';
import { saveUserSystem, validateUserSystemLegs } from './userSystem.js';
import { getBulkImportStatus, scheduleBulkImport } from './jobs/bulkImport.js';
import { listKnownTracks } from './atg.js';
import {
  getParameters as loadParameters,
  getScoringParameters,
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
import { accessGate } from './auth.js';
import type { BacktestGoal, Parameter, RaceEntry, RaceSession } from '../shared/types.js';

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

function loadSession(id: number): RaceSession | null {
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

  const tipParameters = getSessionTipParameters(db, id);
  const scoringParameters = getScoringParameters(db, id);
  const usesTipParameters = session.usesTipParameters === 1;

  const entries = db
    .prepare(
      `SELECT id, start_number as startNumber, post_position as postPosition,
              start_distance as startDistance, volte_row as volteRow,
              horse_name as horseName, atg_horse_id as atgHorseId,
              atg_driver_id as atgDriverId, driver_name as driverName,
              start_points as startPoints, earnings_per_start as earningsPerStart,
              horse_sex as horseSex, career_starts as careerStarts,
              driver_apprentice as driverApprentice,
              driver_v85_win_pct as driverV85WinPct,
              bet_distribution_pct as betDistributionPct,
              track_post_win_pct as trackPostWinPct,
              trot_score as trotScore, actual_position as actualPosition
       FROM race_entries WHERE session_id = ? ORDER BY start_number`,
    )
    .all(id) as RaceEntry[];

  for (const entry of entries) {
    entry.formStarts = db
      .prepare(
        `SELECT form_order as formOrder, date, distance, post_position as postPosition,
                km_time as kmTime, place, driver_name as driverName,
                prize_first as prizeFirst, track_name as trackName
         FROM form_starts WHERE entry_id = ? ORDER BY form_order`,
      )
      .all(entry.id) as RaceEntry['formStarts'];

    const scoresRows = db
      .prepare('SELECT parameter_id, score FROM entry_scores WHERE entry_id = ?')
      .all(entry.id) as Array<{ parameter_id: string; score: number }>;

    entry.scores = Object.fromEntries(scoresRows.map((r) => [r.parameter_id, r.score]));
    entry.driverApprentice = Boolean(
      (entry as RaceEntry & { driverApprentice?: number | boolean }).driverApprentice,
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
    const { url } = req.body as { url: string };
    if (!url?.trim()) return res.status(400).json({ error: 'URL saknas' });

    const sessionId = await persistImportedRace(getDb(), url.trim());
    scheduleAutoOptimize(getDb());
    res.json(loadSession(sessionId));
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
    months: months ?? 6,
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

app.get('/api/sessions/:id', (req, res) => {
  const session = loadSession(parseInt(req.params.id, 10));
  if (!session) return res.status(404).json({ error: 'Lopp hittades inte' });
  res.json(session);
});

app.patch('/api/sessions/:sessionId/entries/:entryId/scores', (req, res) => {
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
  res.json(loadSession(sessionId));
});

app.post('/api/sessions/:id/submit-tip', (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const exists = db
    .prepare('SELECT id FROM race_sessions WHERE id = ?')
    .get(sessionId) as { id: number } | undefined;

  if (!exists) return res.status(404).json({ error: 'Lopp hittades inte' });

  const params = getParameters();
  saveTipParameterSnapshot(getDb(), sessionId, params);
  recalculateSessionScores(sessionId);
  res.json(loadSession(sessionId));
});

app.post('/api/sessions/:id/recalculate', (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  const db = getDb();
  const exists = db
    .prepare('SELECT id FROM race_sessions WHERE id = ?')
    .get(sessionId) as { id: number } | undefined;

  if (!exists) return res.status(404).json({ error: 'Lopp hittades inte' });

  db.prepare('UPDATE race_sessions SET uses_tip_parameters = 0 WHERE id = ?').run(sessionId);
  recalculateSessionScores(sessionId, { useGlobal: true });
  res.json(loadSession(sessionId));
});

app.post('/api/sessions/:id/restore-tip', (req, res) => {
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
  res.json(loadSession(sessionId));
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
    res.json(loadSession(sessionId));
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
    await runTrackPostStatsSync(db);
    const entriesUpdated = backfillTrackPostWinPct(db);
    res.json({ ...getStatsSyncStatus(db), entriesUpdated });
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

  const params = getParameters();
  saveGameTipSnapshot(db, gameSessionId, params);

  for (const raceId of getRaceIdsForGame(db, gameSessionId)) {
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

  db.prepare('UPDATE game_sessions SET uses_tip_parameters = 0 WHERE id = ?').run(gameSessionId);
  for (const raceId of getRaceIdsForGame(db, gameSessionId)) {
    db.prepare('UPDATE race_sessions SET uses_tip_parameters = 0 WHERE id = ?').run(raceId);
    recalculateSessionScores(raceId, { useGlobal: true });
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

app.get('/api/stats', (req, res) => {
  res.json(computeStatsSummary(getDb(), parseStatsFilters(req.query)));
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
  const { atgTrackId, startMethod, gameType, goal } = req.body as {
    atgTrackId?: number;
    startMethod?: 'auto' | 'volte' | null;
    gameType?: string | null;
    goal?: BacktestGoal;
  };

  if (atgTrackId == null) {
    return res.status(400).json({ error: 'atgTrackId krävs' });
  }
  if (goal !== 'win' && goal !== 'top3') {
    return res.status(400).json({ error: 'goal måste vara win eller top3' });
  }

  const result = optimizeWeights(
    getDb(),
    getTrackProfileOrGlobal(getDb(), atgTrackId),
    { atgTrackId, startMethod: startMethod ?? undefined, gameType: gameType ?? undefined },
    goal,
  );
  res.json(result);
});

app.get('/api/backtest/auto', (_req, res) => {
  res.json(getAutoOptimizerStatus(getDb()));
});

app.post('/api/backtest/auto/run', (req, res) => {
  const { goal } = (req.body ?? {}) as { goal?: BacktestGoal };
  const selectedGoal = goal === 'win' ? 'win' : 'top3';
  scheduleAutoOptimize(getDb(), selectedGoal);
  res.json(getAutoOptimizerStatus(getDb()));
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
  startStatsSyncJob(() => db);
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
