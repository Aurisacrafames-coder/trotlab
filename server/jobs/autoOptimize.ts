import type Database from 'better-sqlite3';
import {
  listBacktestGameTypes,
  listBacktestTracks,
  normalizeMaxTrials,
  optimizeWeights,
} from '../backtest.js';
import { getTrackProfileOrGlobal } from '../trackWeightProfiles.js';
import { getTrackStats, resolveTrackName } from '../trackStats.js';
import type { AutoOptimizerStatus, BacktestGoal, BacktestOptimizeResult } from '../../shared/types.js';
import { DEFAULT_BACKTEST_GOAL } from '../../shared/types.js';
import { normalizeProfileGameType } from '../../shared/trackProfileGameTypes.js';

const META_RUNNING = 'auto_opt_running';
const META_RESULT = 'auto_opt_result';
const META_STATUS = 'auto_opt_status';
const AUTO_OPT_MAX_RACES = 150;
const AUTO_OPT_BACKGROUND_TRIALS = 1500;

function resultMetaKey(atgTrackId: number, gameType?: string | null) {
  const gt = normalizeProfileGameType(gameType);
  return gt ? `${META_RESULT}_${atgTrackId}_${gt}` : `${META_RESULT}_${atgTrackId}_all`;
}

function statusMetaKey(atgTrackId: number, gameType?: string | null) {
  const gt = normalizeProfileGameType(gameType);
  return gt ? `${META_STATUS}_${atgTrackId}_${gt}` : `${META_STATUS}_${atgTrackId}_all`;
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
  gameType: null,
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

function racesWithResultForTrack(
  db: Database.Database,
  atgTrackId: number,
  gameType?: string | null,
): number {
  const gt = normalizeProfileGameType(gameType);
  if (!gt) {
    return getTrackStats(db, atgTrackId)?.racesWithResult ?? 0;
  }
  const row = listBacktestGameTypes(db, atgTrackId).find((g) => g.gameType === gt);
  return row?.racesWithResult ?? 0;
}

function pickPrimaryTrack(db: Database.Database) {
  const tracks = listBacktestTracks(db).filter((t) => t.racesWithResult >= 3);
  if (tracks.length === 0) return null;
  return tracks.sort((a, b) => b.racesWithResult - a.racesWithResult)[0] ?? null;
}

function resolveTrack(db: Database.Database, atgTrackId?: number | null, gameType?: string | null) {
  const tracks = listBacktestTracks(db);
  if (atgTrackId != null) {
    const selected = tracks.find((t) => t.atgTrackId === atgTrackId);
    if (!selected) {
      return { track: null, error: 'Banan saknar importerade lopp i databasen.' };
    }
    const racesWithResult = racesWithResultForTrack(db, selected.atgTrackId, gameType);
    if (racesWithResult < 3) {
      const gtLabel = normalizeProfileGameType(gameType);
      const scope = gtLabel ? ` för ${gtLabel}` : '';
      return {
        track: null,
        error: `${selected.trackName}${scope} har bara ${racesWithResult} lopp med resultat — importera minst 3 för optimering.`,
      };
    }
    return { track: { ...selected, racesWithResult }, error: null };
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

function parseStoredResult(
  raw: string,
  expectedTrackId?: number | null,
  expectedGameType?: string | null,
): BacktestOptimizeResult | null {
  try {
    const result = JSON.parse(raw) as BacktestOptimizeResult;
    if (expectedTrackId != null && result.atgTrackId !== expectedTrackId) return null;
    const expectedGt = normalizeProfileGameType(expectedGameType);
    const resultGt = normalizeProfileGameType(result.gameType);
    if (expectedTrackId != null && expectedGt !== resultGt) return null;
    return result;
  } catch {
    return null;
  }
}

function normalizeStoredResult(
  db: Database.Database,
  result: BacktestOptimizeResult,
): BacktestOptimizeResult {
  const trackName = resolveTrackName(db, result.atgTrackId) ?? result.trackName;
  return trackName === result.trackName ? result : { ...result, trackName };
}

function loadLegacyResult(db: Database.Database): BacktestOptimizeResult | null {
  const raw = getMeta(db, META_RESULT);
  if (!raw) return null;
  const result = parseStoredResult(raw);
  return result ? normalizeStoredResult(db, result) : null;
}

function loadStoredResult(
  db: Database.Database,
  atgTrackId?: number | null,
  gameType?: string | null,
): BacktestOptimizeResult | null {
  if (atgTrackId != null) {
    const perScope = getMeta(db, resultMetaKey(atgTrackId, gameType));
    if (perScope) {
      const result = parseStoredResult(perScope, atgTrackId, gameType);
      if (result) return normalizeStoredResult(db, result);
    }
    const legacy = loadLegacyResult(db);
    if (legacy?.atgTrackId === atgTrackId && !normalizeProfileGameType(gameType)) {
      return legacy;
    }
    return null;
  }

  return loadLegacyResult(db);
}

export function getStoredOptimizeResult(
  db: Database.Database,
  atgTrackId: number,
  gameType?: string | null,
): BacktestOptimizeResult | null {
  return loadStoredResult(db, atgTrackId, gameType);
}

function idleStatus(
  db: Database.Database,
  overrides: Partial<AutoOptimizerStatus> = {},
): AutoOptimizerStatus {
  return {
    running: false,
    atgTrackId: null,
    trackName: null,
    gameType: null,
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
  filterGameType?: string | null,
): AutoOptimizerStatus {
  const filterGt = normalizeProfileGameType(filterGameType);

  if (liveStatus.running) {
    const sameTrack = filterTrackId == null || liveStatus.atgTrackId === filterTrackId;
    const sameGameType =
      filterTrackId == null ||
      normalizeProfileGameType(liveStatus.gameType) === filterGt;
    if (sameTrack && sameGameType) {
      return liveStatus;
    }
    return idleStatus(db, {
      running: true,
      atgTrackId: liveStatus.atgTrackId,
      trackName: liveStatus.trackName,
      gameType: liveStatus.gameType,
      goal: liveStatus.goal,
      trialsRun: liveStatus.trialsRun,
      bestHits: liveStatus.bestHits,
      racesWithResult: liveStatus.racesWithResult,
      phase: liveStatus.phase,
      message: liveStatus.message ?? `Optimerar ${liveStatus.trackName ?? 'annan bana'}…`,
    });
  }

  if (filterTrackId != null) {
    const stored = loadStoredResult(db, filterTrackId, filterGameType);
    const track = getTrackStats(db, filterTrackId);
    const trackName = resolveTrackName(db, filterTrackId) ?? track?.trackName ?? null;
    if (stored) {
      return idleStatus(db, {
        atgTrackId: stored.atgTrackId,
        trackName: stored.trackName,
        gameType: normalizeProfileGameType(stored.gameType) || null,
        goal: stored.goal,
        bestHits: stored.optimized.hits,
        racesWithResult: stored.racesWithResult,
        phase: 'done',
        lastResult: stored,
        lastRunAt: getMeta(db, statusMetaKey(filterTrackId, filterGameType)) ?? getMeta(db, META_STATUS),
        message: stored.message,
      });
    }
    return idleStatus(db, {
      atgTrackId: filterTrackId,
      trackName,
      gameType: filterGt || null,
      message: trackName
        ? `Ingen optimering sparad för ${trackName}${filterGt ? ` (${filterGt})` : ''} ännu.`
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
    gameType: normalizeProfileGameType(stored?.gameType) || liveStatus.gameType,
    goal: stored?.goal ?? liveStatus.goal,
    phase: stored ? 'done' : 'idle',
    message: stored?.message ?? liveStatus.message,
  });
}

async function runAutoOptimize(
  db: Database.Database,
  goal: BacktestGoal = DEFAULT_BACKTEST_GOAL,
  atgTrackId?: number | null,
  gameType?: string | null,
  maxTrials?: number,
  startMethod?: 'auto' | 'volte' | null,
) {
  const normalizedGameType = normalizeProfileGameType(gameType);
  const { track, error } = resolveTrack(db, atgTrackId, gameType);
  if (!track) {
    liveStatus = {
      running: false,
      atgTrackId: atgTrackId ?? null,
      trackName: null,
      gameType: normalizedGameType || null,
      goal,
      trialsRun: 0,
      bestHits: null,
      racesWithResult: null,
      phase: 'idle',
      lastResult: loadStoredResult(db, atgTrackId, gameType),
      lastRunAt: getMeta(db, META_STATUS),
      message: error,
    };
    return;
  }

  setMeta(db, META_RUNNING, '1');
  const trialLimit = normalizeMaxTrials(maxTrials);
  const scopeLabel = normalizedGameType ? `${track.trackName} (${normalizedGameType})` : track.trackName;
  liveStatus = {
    running: true,
    atgTrackId: track.atgTrackId,
    trackName: track.trackName,
    gameType: normalizedGameType || null,
    goal,
    trialsRun: 0,
    bestHits: null,
    racesWithResult: track.racesWithResult,
    phase: 'coarse',
    lastResult: loadStoredResult(db, track.atgTrackId, gameType),
    lastRunAt: getMeta(db, META_STATUS),
    message: `Testar viktkombinationer mot ${scopeLabel} (max ${trialLimit.toLocaleString('sv-SE')} försök)…`,
  };

  const filter = {
    atgTrackId: track.atgTrackId,
    gameType: normalizedGameType || undefined,
    startMethod: startMethod ?? undefined,
  };

  try {
    const result = await optimizeWeights(
      db,
      getTrackProfileOrGlobal(db, track.atgTrackId, normalizedGameType || null),
      filter,
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

    setMeta(db, resultMetaKey(track.atgTrackId, gameType), JSON.stringify(result));
    setMeta(db, statusMetaKey(track.atgTrackId, gameType), new Date().toISOString());
    setMeta(db, META_RESULT, JSON.stringify(result));
    setMeta(db, META_STATUS, new Date().toISOString());

    liveStatus = {
      running: false,
      atgTrackId: track.atgTrackId,
      trackName: track.trackName,
      gameType: normalizedGameType || null,
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
      gameType: normalizedGameType || null,
      goal,
      trialsRun: liveStatus.trialsRun,
      bestHits: liveStatus.bestHits,
      racesWithResult: track.racesWithResult,
      phase: 'error',
      lastResult: loadStoredResult(db, track.atgTrackId, gameType),
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
  options?: {
    allowLargeTrack?: boolean;
    gameType?: string | null;
    startMethod?: 'auto' | 'volte' | null;
  },
) {
  const gameType = options?.gameType;
  const { track, error } = resolveTrack(db, atgTrackId, gameType);
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

  backgroundPromise = runAutoOptimize(
    db,
    goal,
    atgTrackId,
    gameType,
    trialLimit,
    options?.startMethod,
  )
    .catch((err) => console.error('Automatisk optimering misslyckades:', err))
    .finally(() => {
      backgroundPromise = null;
      if (queuedRun) {
        queuedRun = false;
        scheduleAutoOptimize(db, goal, atgTrackId, maxTrials, options);
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
