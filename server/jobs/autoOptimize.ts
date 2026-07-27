import type Database from 'better-sqlite3';
import { listBacktestTracks, optimizeWeights } from '../backtest.js';
import { getParameters } from '../parameters.js';
import type { BacktestGoal, BacktestOptimizeResult } from '../../shared/types.js';

const META_RUNNING = 'auto_opt_running';
const META_RESULT = 'auto_opt_result';
const META_STATUS = 'auto_opt_status';

export interface AutoOptimizerStatus {
  running: boolean;
  atgTrackId: number | null;
  trackName: string | null;
  goal: BacktestGoal | null;
  trialsRun: number;
  bestHits: number | null;
  racesWithResult: number | null;
  phase: 'idle' | 'coarse' | 'fine' | 'restart' | 'done' | 'error';
  lastResult: BacktestOptimizeResult | null;
  lastRunAt: string | null;
  message: string | null;
}

function setMeta(db: Database.Database, key: string, value: string) {
  db.prepare(
    `INSERT INTO stats_sync_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value);
}

function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM stats_sync_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

let liveStatus: AutoOptimizerStatus = {
  running: false,
  atgTrackId: null,
  trackName: null,
  goal: null,
  trialsRun: 0,
  bestHits: null,
  racesWithResult: null,
  phase: 'idle',
  lastResult: null,
  lastRunAt: null,
  message: null,
};

let backgroundPromise: Promise<void> | null = null;
let queuedRun = false;

function pickPrimaryTrack(db: Database.Database) {
  const tracks = listBacktestTracks(db).filter((t) => t.racesWithResult >= 3);
  if (tracks.length === 0) return null;
  return tracks.sort((a, b) => b.racesWithResult - a.racesWithResult)[0] ?? null;
}

function loadStoredResult(db: Database.Database): BacktestOptimizeResult | null {
  const raw = getMeta(db, META_RESULT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BacktestOptimizeResult;
  } catch {
    return null;
  }
}

export function getAutoOptimizerStatus(db: Database.Database): AutoOptimizerStatus {
  if (liveStatus.running) return liveStatus;

  const stored = loadStoredResult(db);
  const lastRunAt = getMeta(db, META_STATUS);
  return {
    ...liveStatus,
    lastResult: stored,
    lastRunAt,
    phase: stored ? 'done' : 'idle',
    message: stored?.message ?? liveStatus.message,
  };
}

async function runAutoOptimize(db: Database.Database, goal: BacktestGoal = 'top3') {
  const track = pickPrimaryTrack(db);
  if (!track) {
    liveStatus = {
      running: false,
      atgTrackId: null,
      trackName: null,
      goal,
      trialsRun: 0,
      bestHits: null,
      racesWithResult: null,
      phase: 'idle',
      lastResult: loadStoredResult(db),
      lastRunAt: getMeta(db, META_STATUS),
      message: 'Inga banor med tillräckligt underlag för automatisk optimering (minst 3 lopp med resultat).',
    };
    return;
  }

  setMeta(db, META_RUNNING, '1');
  liveStatus = {
    running: true,
    atgTrackId: track.atgTrackId,
    trackName: track.trackName,
    goal,
    trialsRun: 0,
    bestHits: null,
    racesWithResult: track.racesWithResult,
    phase: 'coarse',
    lastResult: loadStoredResult(db),
    lastRunAt: getMeta(db, META_STATUS),
    message: `Testar viktkombinationer mot ${track.trackName}…`,
  };

  try {
    const result = optimizeWeights(
      db,
      getParameters(db),
      { atgTrackId: track.atgTrackId },
      goal,
      {
        onProgress: (progress) => {
          liveStatus = {
            ...liveStatus,
            running: true,
            trialsRun: progress.trialsRun,
            bestHits: progress.bestHits,
            racesWithResult: progress.racesWithResult,
            phase: progress.phase,
            message: `Testar alternativ… ${progress.trialsRun} kombinationer provade, bästa hittills ${progress.bestHits}/${progress.racesWithResult}.`,
          };
        },
      },
    );

    setMeta(db, META_RESULT, JSON.stringify(result));
    setMeta(db, META_STATUS, new Date().toISOString());

    liveStatus = {
      running: false,
      atgTrackId: track.atgTrackId,
      trackName: track.trackName,
      goal,
      trialsRun: liveStatus.trialsRun,
      bestHits: result.optimized.hits,
      racesWithResult: result.racesWithResult,
      phase: 'done',
      lastResult: result,
      lastRunAt: new Date().toISOString(),
      message: result.message,
    };
  } catch (err) {
    liveStatus = {
      running: false,
      atgTrackId: track.atgTrackId,
      trackName: track.trackName,
      goal,
      trialsRun: liveStatus.trialsRun,
      bestHits: liveStatus.bestHits,
      racesWithResult: track.racesWithResult,
      phase: 'error',
      lastResult: loadStoredResult(db),
      lastRunAt: getMeta(db, META_STATUS),
      message: err instanceof Error ? err.message : 'Automatisk optimering misslyckades.',
    };
  } finally {
    setMeta(db, META_RUNNING, '0');
  }
}

export function scheduleAutoOptimize(db: Database.Database, goal: BacktestGoal = 'top3') {
  if (backgroundPromise) {
    queuedRun = true;
    return;
  }

  backgroundPromise = runAutoOptimize(db, goal)
    .catch((err) => console.error('Automatisk optimering misslyckades:', err))
    .finally(() => {
      backgroundPromise = null;
      if (queuedRun) {
        queuedRun = false;
        scheduleAutoOptimize(db, goal);
      }
    });
}

export function startAutoOptimizeJob(getDb: () => Database.Database) {
  setTimeout(() => {
    scheduleAutoOptimize(getDb());
  }, 5000);
}
