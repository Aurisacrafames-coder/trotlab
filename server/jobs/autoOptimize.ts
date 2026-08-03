import type Database from 'better-sqlite3';
import { listBacktestTracks, normalizeMaxTrials, optimizeWeights } from '../backtest.js';
import { getTrackProfileOrGlobal } from '../trackWeightProfiles.js';
import { getTrackStats } from '../trackStats.js';
import type { BacktestGoal, BacktestOptimizeResult } from '../../shared/types.js';
import { DEFAULT_BACKTEST_GOAL } from '../../shared/types.js';

const META_RUNNING = 'auto_opt_running';
const META_RESULT = 'auto_opt_result';
const META_STATUS = 'auto_opt_status';
const AUTO_OPT_MAX_RACES = 150;
const AUTO_OPT_BACKGROUND_TRIALS = 1500;

function resultMetaKey(atgTrackId: number) {
  return `${META_RESULT}_${atgTrackId}`;
}

function statusMetaKey(atgTrackId: number) {
  return `${META_STATUS}_${atgTrackId}`;
}

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

function resolveTrack(db: Database.Database, atgTrackId?: number | null) {
  const tracks = listBacktestTracks(db);
  if (atgTrackId != null) {
    const selected = tracks.find((t) => t.atgTrackId === atgTrackId);
    if (!selected) {
      return { track: null, error: 'Banan saknar importerade lopp i databasen.' };
    }
    if (selected.racesWithResult < 3) {
      return {
        track: null,
        error: `${selected.trackName} har bara ${selected.racesWithResult} lopp med resultat — importera minst 3 för optimering.`,
      };
    }
    return { track: selected, error: null };
  }
  const primary = pickPrimaryTrack(db);
  if (!primary) {
    return {
      track: null,
      error: 'Inga banor med tillräckligt underlag för automatisk optimering (minst 3 lopp med resultat).',
    };
  }
  return { track: primary, error: null };
}

function loadLegacyResult(db: Database.Database): BacktestOptimizeResult | null {
  const raw = getMeta(db, META_RESULT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BacktestOptimizeResult;
  } catch {
    return null;
  }
}

function loadStoredResult(db: Database.Database, atgTrackId?: number | null): BacktestOptimizeResult | null {
  if (atgTrackId != null) {
    const perTrack = getMeta(db, resultMetaKey(atgTrackId));
    if (perTrack) {
      try {
        return JSON.parse(perTrack) as BacktestOptimizeResult;
      } catch {
        return null;
      }
    }
    const legacy = loadLegacyResult(db);
    if (legacy?.atgTrackId === atgTrackId) return legacy;
    return null;
  }

  return loadLegacyResult(db);
}

function idleStatus(
  db: Database.Database,
  overrides: Partial<AutoOptimizerStatus> = {},
): AutoOptimizerStatus {
  return {
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
    ...overrides,
  };
}

export function getAutoOptimizerStatus(
  db: Database.Database,
  filterTrackId?: number | null,
): AutoOptimizerStatus {
  if (liveStatus.running) {
    if (filterTrackId == null || liveStatus.atgTrackId === filterTrackId) {
      return liveStatus;
    }
    return idleStatus(db, {
      running: true,
      atgTrackId: liveStatus.atgTrackId,
      trackName: liveStatus.trackName,
      goal: liveStatus.goal,
      trialsRun: liveStatus.trialsRun,
      bestHits: liveStatus.bestHits,
      racesWithResult: liveStatus.racesWithResult,
      phase: liveStatus.phase,
      message: liveStatus.message ?? `Optimerar ${liveStatus.trackName ?? 'annan bana'}…`,
    });
  }

  if (filterTrackId != null) {
    const stored = loadStoredResult(db, filterTrackId);
    const track = getTrackStats(db, filterTrackId);
    if (stored) {
      return idleStatus(db, {
        atgTrackId: stored.atgTrackId,
        trackName: stored.trackName,
        goal: stored.goal,
        bestHits: stored.optimized.hits,
        racesWithResult: stored.racesWithResult,
        phase: 'done',
        lastResult: stored,
        lastRunAt: getMeta(db, statusMetaKey(filterTrackId)) ?? getMeta(db, META_STATUS),
        message: stored.message,
      });
    }
    return idleStatus(db, {
      atgTrackId: filterTrackId,
      trackName: track?.trackName ?? null,
      message: track
        ? `Ingen optimering sparad för ${track.trackName} ännu.`
        : 'Ingen optimering sparad för denna bana ännu.',
    });
  }

  const stored = loadStoredResult(db);
  const lastRunAt = getMeta(db, META_STATUS);
  return idleStatus(db, {
    lastResult: stored,
    lastRunAt,
    atgTrackId: stored?.atgTrackId ?? liveStatus.atgTrackId,
    trackName: stored?.trackName ?? liveStatus.trackName,
    goal: stored?.goal ?? liveStatus.goal,
    phase: stored ? 'done' : 'idle',
    message: stored?.message ?? liveStatus.message,
  });
}

async function runAutoOptimize(
  db: Database.Database,
  goal: BacktestGoal = DEFAULT_BACKTEST_GOAL,
  atgTrackId?: number | null,
  maxTrials?: number,
) {
  const { track, error } = resolveTrack(db, atgTrackId);
  if (!track) {
    liveStatus = {
      running: false,
      atgTrackId: atgTrackId ?? null,
      trackName: null,
      goal,
      trialsRun: 0,
      bestHits: null,
      racesWithResult: null,
      phase: 'idle',
      lastResult: loadStoredResult(db),
      lastRunAt: getMeta(db, META_STATUS),
      message: error,
    };
    return;
  }

  setMeta(db, META_RUNNING, '1');
  const trialLimit = normalizeMaxTrials(maxTrials);
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
    message: `Testar viktkombinationer mot ${track.trackName} (max ${trialLimit.toLocaleString('sv-SE')} försök)…`,
  };

  try {
    const result = await optimizeWeights(
      db,
      getTrackProfileOrGlobal(db, track.atgTrackId),
      { atgTrackId: track.atgTrackId },
      goal,
      {
        maxTrials: trialLimit,
        onProgress: (progress) => {
          liveStatus = {
            ...liveStatus,
            running: true,
            trialsRun: progress.trialsRun,
            bestHits: progress.bestHits,
            racesWithResult: progress.racesWithResult,
            phase: progress.phase,
            message: `Testar alternativ… ${progress.trialsRun.toLocaleString('sv-SE')}/${trialLimit.toLocaleString('sv-SE')} kombinationer, bästa hittills ${progress.bestHits}/${progress.racesWithResult}.`,
          };
        },
      },
    );

    setMeta(db, resultMetaKey(track.atgTrackId), JSON.stringify(result));
    setMeta(db, statusMetaKey(track.atgTrackId), new Date().toISOString());
    setMeta(db, META_RESULT, JSON.stringify(result));
    setMeta(db, META_STATUS, new Date().toISOString());

    liveStatus = {
      running: false,
      atgTrackId: track.atgTrackId,
      trackName: track.trackName,
      goal,
      trialsRun: result.trialsRun,
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

export function scheduleAutoOptimize(
  db: Database.Database,
  goal: BacktestGoal = DEFAULT_BACKTEST_GOAL,
  atgTrackId?: number | null,
  maxTrials?: number,
  options?: { allowLargeTrack?: boolean },
) {
  const { track, error } = resolveTrack(db, atgTrackId);
  if (!track) {
    if (error) console.log(`Auto-optimering hoppades över: ${error}`);
    return;
  }
  if (!options?.allowLargeTrack && track.racesWithResult > AUTO_OPT_MAX_RACES) {
    console.log(
      `Auto-optimering hoppades över för ${track.trackName} (${track.racesWithResult} lopp — kör manuellt vid behov).`,
    );
    return;
  }

  const trialLimit = maxTrials ?? AUTO_OPT_BACKGROUND_TRIALS;

  if (backgroundPromise) {
    queuedRun = true;
    return;
  }

  backgroundPromise = runAutoOptimize(db, goal, atgTrackId, trialLimit)
    .catch((err) => console.error('Automatisk optimering misslyckades:', err))
    .finally(() => {
      backgroundPromise = null;
      if (queuedRun) {
        queuedRun = false;
        scheduleAutoOptimize(db, goal, atgTrackId, maxTrials);
      }
    });
}

export function startAutoOptimizeJob(getDb: () => Database.Database) {
  setTimeout(() => {
    const db = getDb();
    const primary = pickPrimaryTrack(db);
    if (!primary || primary.racesWithResult > AUTO_OPT_MAX_RACES) {
      if (primary) {
        console.log(
          `Auto-optimering vid start hoppades över för ${primary.trackName} (${primary.racesWithResult} lopp).`,
        );
      }
      return;
    }
    scheduleAutoOptimize(db);
  }, 5000);
}
