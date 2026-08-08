import type Database from 'better-sqlite3';
import { calculateTrotScore, evaluateTopPicksHit, isTopPicksHit, TOP_PICK_COUNT } from '../shared/scoring.js';
import type {
  BacktestGoal,
  BacktestOptimizeResult,
  BacktestRaceDetail,
  BacktestSummary,
  BacktestTrackOption,
  Parameter,
} from '../shared/types.js';
import { OPTIMIZE_TRIALS_DEFAULT, VARMNING_PARAMETER_ID } from '../shared/types.js';
import { listTrackStats } from './trackStats.js';

export type { BacktestGoal, BacktestOptimizeResult, BacktestRaceDetail, BacktestSummary, BacktestTrackOption };

export interface BacktestFilter {
  atgTrackId: number;
  startMethod?: 'auto' | 'volte' | null;
  gameType?: string | null;
  gameSessionId?: number;
}

interface SessionRow {
  id: number;
  date: string;
  gameType: string;
  legNumber: number;
  trackRaceNumber: number | null;
  trackName: string;
  startMethod: string | null;
}

interface EntryRow {
  sessionId: number;
  startNumber: number;
  horseName: string;
  actualPosition: number | null;
  parameterId: string;
  score: number;
}

interface ScoredBacktest extends BacktestSummary {
  margin: number;
}

const COARSE_STEP = 5;
const FINE_STEP = 1;
const RANDOM_RESTARTS = 8;
const WEIGHT_SEARCH_RADIUS = 50;
const OPTIMIZE_YIELD_EVERY = 25;
const MIN_TOTAL_WEIGHT = 50;
const MIN_ACTIVE_PARAMS = 3;
const MIN_WEIGHT_FOR_ACTIVE = 5;

export function normalizeMaxTrials(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return OPTIMIZE_TRIALS_DEFAULT;
  return Math.min(100_000, Math.max(1_000, Math.round(value)));
}

export interface OptimizeProgress {
  trialsRun: number;
  bestHits: number;
  racesWithResult: number;
  phase: 'coarse' | 'fine' | 'restart';
  restartIndex: number;
}

export interface OptimizeOptions {
  onProgress?: (progress: OptimizeProgress) => void;
  maxTrials?: number;
}

function yieldOptimize(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function maybeYieldOptimize(trialsRun: number): Promise<void> {
  if (trialsRun > 0 && trialsRun % OPTIMIZE_YIELD_EVERY === 0) {
    await yieldOptimize();
  }
}

function cloneParameters(params: Parameter[]): Parameter[] {
  return params.map((p) => ({ ...p }));
}

function totalWeight(params: Parameter[]): number {
  return params.reduce((sum, p) => sum + p.weight, 0);
}

function activeParamCount(params: Parameter[]): number {
  return params.reduce((sum, p) => sum + (p.weight >= MIN_WEIGHT_FOR_ACTIVE ? 1 : 0), 0);
}

function isValidWeightSet(params: Parameter[]): boolean {
  return totalWeight(params) >= MIN_TOTAL_WEIGHT && activeParamCount(params) >= MIN_ACTIVE_PARAMS;
}

function isHit(actualPositions: Array<number | null>, goal: BacktestGoal): boolean {
  return isTopPicksHit(actualPositions, goal);
}

function hitKind(actualPositions: Array<number | null>, goal: BacktestGoal): 'win' | 'top3' | 'miss' {
  return evaluateTopPicksHit(actualPositions, goal);
}

/** Positive when a is better than b. */
function compareBacktests(a: ScoredBacktest, b: ScoredBacktest): number {
  if (a.hits !== b.hits) return a.hits - b.hits;
  return a.margin - b.margin;
}

function weightCandidates(param: Parameter, baselineWeight: number, step: number): number[] {
  const values = new Set<number>();

  if (baselineWeight >= MIN_WEIGHT_FOR_ACTIVE) {
    const lo = Math.max(MIN_WEIGHT_FOR_ACTIVE, baselineWeight - WEIGHT_SEARCH_RADIUS);
    const hi = Math.min(100, baselineWeight + WEIGHT_SEARCH_RADIUS);
    for (let w = lo; w <= hi; w += step) values.add(w);
  } else {
    values.add(0);
    for (let w = MIN_WEIGHT_FOR_ACTIVE; w <= WEIGHT_SEARCH_RADIUS; w += step) values.add(w);
  }

  values.add(param.weight);
  return [...values].sort((a, b) => a - b);
}

function randomValidWeights(base: Parameter[]): Parameter[] | null {
  const optimizable = base.filter((p) => p.id !== VARMNING_PARAMETER_ID);
  const varmning = base.find((p) => p.id === VARMNING_PARAMETER_ID);

  for (let attempt = 0; attempt < 200; attempt++) {
    const trial = cloneParameters(base);
    for (const param of optimizable) {
      const target = trial.find((p) => p.id === param.id);
      if (!target) continue;
      const roll = Math.random();
      if (roll < 0.25) {
        target.weight = 0;
      } else {
        const choices = [];
        for (let w = MIN_WEIGHT_FOR_ACTIVE; w <= 100; w += COARSE_STEP) choices.push(w);
        target.weight = choices[Math.floor(Math.random() * choices.length)] ?? MIN_WEIGHT_FOR_ACTIVE;
      }
    }
    if (varmning) {
      const v = trial.find((p) => p.id === VARMNING_PARAMETER_ID);
      if (v) v.weight = varmning.weight;
    }
    if (isValidWeightSet(trial)) return trial;
  }

  return null;
}

interface OptimizeContext {
  sessions: SessionRow[];
  entryScoresBySession: Map<
    number,
    Array<{ startNumber: number; horseName: string; actualPosition: number | null; scores: Record<string, number> }>
  >;
  goal: BacktestGoal;
  trackName: string;
  atgTrackId: number;
}

async function coordinateDescent(
  ctx: OptimizeContext,
  start: Parameter[],
  baselineById: Map<string, number>,
  step: number,
  best: ScoredBacktest,
  state: { trialsRun: number; maxTrials: number },
  options?: OptimizeOptions,
  phase: OptimizeProgress['phase'] = 'coarse',
  restartIndex = 0,
): Promise<{ best: ScoredBacktest; weights: Parameter[] }> {
  let localBest = best;
  let localWeights = cloneParameters(start);
  let current = cloneParameters(start);
  const optimizable = current.filter((p) => p.id !== VARMNING_PARAMETER_ID);

  while (state.trialsRun < state.maxTrials) {
    let improved = false;

    for (const param of optimizable) {
      const baselineWeight = baselineById.get(param.id) ?? 0;
      for (const w of weightCandidates(param, baselineWeight, step)) {
        if (state.trialsRun >= state.maxTrials) break;

        const currentWeight = current.find((p) => p.id === param.id)?.weight ?? 0;
        if (w === currentWeight) continue;

        const trial = cloneParameters(current);
        const target = trial.find((p) => p.id === param.id);
        if (!target) continue;
        target.weight = w;
        if (!isValidWeightSet(trial)) continue;

        state.trialsRun++;
        await maybeYieldOptimize(state.trialsRun);
        const result = runBacktestInternal(
          ctx.sessions,
          ctx.entryScoresBySession,
          trial,
          ctx.goal,
          ctx.trackName,
          ctx.atgTrackId,
        );

        options?.onProgress?.({
          trialsRun: state.trialsRun,
          bestHits: localBest.hits,
          racesWithResult: localBest.racesWithResult,
          phase,
          restartIndex,
        });

        if (compareBacktests(result, localBest) > 0) {
          localBest = result;
          localWeights = cloneParameters(trial);
          current = trial;
          improved = true;
        }
      }
    }

    if (!improved) break;
  }

  return { best: localBest, weights: localWeights };
}

async function fillRemainingTrials(
  ctx: OptimizeContext,
  baselineWeights: Parameter[],
  best: ScoredBacktest,
  bestWeights: Parameter[],
  state: { trialsRun: number; maxTrials: number },
  options?: OptimizeOptions,
): Promise<{ best: ScoredBacktest; weights: Parameter[] }> {
  let localBest = best;
  let localWeights = cloneParameters(bestWeights);

  while (state.trialsRun < state.maxTrials) {
    const seed = randomValidWeights(baselineWeights);
    if (!seed) continue;

    state.trialsRun++;
    await maybeYieldOptimize(state.trialsRun);
    const result = runBacktestInternal(
      ctx.sessions,
      ctx.entryScoresBySession,
      seed,
      ctx.goal,
      ctx.trackName,
      ctx.atgTrackId,
    );

    options?.onProgress?.({
      trialsRun: state.trialsRun,
      bestHits: localBest.hits,
      racesWithResult: localBest.racesWithResult,
      phase: 'restart',
      restartIndex: 0,
    });

    if (compareBacktests(result, localBest) > 0) {
      localBest = result;
      localWeights = cloneParameters(seed);
    }
  }

  return { best: localBest, weights: localWeights };
}

function loadSessions(db: Database.Database, filter: BacktestFilter): SessionRow[] {
  let sql = `
    SELECT id, date, game_type as gameType, leg_number as legNumber,
           track_race_number as trackRaceNumber, track_name as trackName,
           start_method as startMethod
    FROM race_sessions
    WHERE atg_track_id = ?
  `;
  const args: Array<number | string> = [filter.atgTrackId];

  if (filter.startMethod) {
    sql += ` AND start_method = ?`;
    args.push(filter.startMethod);
  }
  if (filter.gameType) {
    sql += ` AND game_type = ?`;
    args.push(filter.gameType);
  }
  if (filter.gameSessionId != null) {
    sql += ` AND game_session_id = ?`;
    args.push(filter.gameSessionId);
  }

  sql += ` ORDER BY date, leg_number`;
  return db.prepare(sql).all(...args) as SessionRow[];
}

function loadEntryScores(
  db: Database.Database,
  sessionIds: number[],
): Map<
  number,
  Array<{
    startNumber: number;
    horseName: string;
    actualPosition: number | null;
    scratched: boolean;
    scores: Record<string, number>;
  }>
> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT re.session_id as sessionId, re.start_number as startNumber,
              re.horse_name as horseName, re.actual_position as actualPosition,
              re.scratched as scratched,
              es.parameter_id as parameterId, es.score
       FROM race_entries re
       JOIN entry_scores es ON es.entry_id = re.id
       WHERE re.session_id IN (${placeholders})`,
    )
    .all(...sessionIds) as Array<
    EntryRow & { scratched: number }
  >;

  const bySession = new Map<
    number,
    Map<
      number,
      {
        startNumber: number;
        horseName: string;
        actualPosition: number | null;
        scratched: boolean;
        scores: Record<string, number>;
      }
    >
  >();

  for (const row of rows) {
    let session = bySession.get(row.sessionId);
    if (!session) {
      session = new Map();
      bySession.set(row.sessionId, session);
    }
    let entry = session.get(row.startNumber);
    if (!entry) {
      entry = {
        startNumber: row.startNumber,
        horseName: row.horseName,
        actualPosition: row.actualPosition,
        scratched: row.scratched === 1,
        scores: {},
      };
      session.set(row.startNumber, entry);
    }
    entry.scores[row.parameterId] = row.score;
  }

  const result = new Map<
    number,
    Array<{
      startNumber: number;
      horseName: string;
      actualPosition: number | null;
      scratched: boolean;
      scores: Record<string, number>;
    }>
  >();
  for (const [sessionId, entries] of bySession) {
    result.set(sessionId, [...entries.values()]);
  }
  return result;
}

function scoreEntries(
  entries: Array<{
    startNumber: number;
    horseName: string;
    actualPosition: number | null;
    scratched?: boolean;
    scores: Record<string, number>;
  }>,
  parameters: Parameter[],
) {
  const scored = entries.map((entry) => ({
    ...entry,
    scratched: entry.scratched ?? false,
    trotScore: calculateTrotScore(entry.scores, parameters),
  }));

  scored.sort((a, b) => {
    if (a.scratched !== b.scratched) return a.scratched ? 1 : -1;
    if (b.trotScore !== a.trotScore) return b.trotScore - a.trotScore;
    return a.startNumber - b.startNumber;
  });

  return scored;
}

function runBacktestInternal(
  sessions: SessionRow[],
  entryScoresBySession: Map<
    number,
    Array<{ startNumber: number; horseName: string; actualPosition: number | null; scores: Record<string, number> }>
  >,
  parameters: Parameter[],
  goal: BacktestGoal,
  trackName: string,
  atgTrackId: number,
): ScoredBacktest {
  const races: BacktestRaceDetail[] = [];
  let racesWithResult = 0;
  let hits = 0;
  let margin = 0;

  for (const session of sessions) {
    const entries = entryScoresBySession.get(session.id) ?? [];
    if (entries.length === 0) continue;

    const hasResult = entries.some((e) => e.actualPosition != null && e.actualPosition > 0);
    if (!hasResult) continue;

    racesWithResult++;
    const scored = scoreEntries(entries, parameters);
    const topPicks = scored.slice(0, TOP_PICK_COUNT);
    const third = topPicks[2];
    const fourth = scored[3];
    if (third && fourth) {
      margin += third.trotScore - fourth.trotScore;
    } else if (third) {
      margin += third.trotScore;
    }

    const pickPositions = topPicks.map((p) => p.actualPosition);
    const hit = isHit(pickPositions, goal);
    if (hit) hits++;

    races.push({
      sessionId: session.id,
      date: session.date,
      gameType: session.gameType,
      legNumber: session.legNumber,
      trackRaceNumber: session.trackRaceNumber,
      startMethod: session.startMethod,
      topPicks: topPicks.map((p) => ({
        startNumber: p.startNumber,
        horseName: p.horseName,
        trotScore: p.trotScore,
        actualPosition: p.actualPosition,
      })),
      hit: hitKind(pickPositions, goal),
    });
  }

  return {
    goal,
    atgTrackId,
    trackName,
    raceCount: sessions.length,
    racesWithResult,
    hits,
    hitRate:
      racesWithResult > 0 ? Math.round((hits / racesWithResult) * 1000) / 10 : null,
    weights: cloneParameters(parameters),
    races,
    margin,
  };
}

export function listBacktestTracks(db: Database.Database): BacktestTrackOption[] {
  return listTrackStats(db);
}

export function runBacktest(
  db: Database.Database,
  parameters: Parameter[],
  filter: BacktestFilter,
  goal: BacktestGoal,
): BacktestSummary {
  const sessions = loadSessions(db, filter);
  if (sessions.length === 0) {
    return {
      goal,
      atgTrackId: filter.atgTrackId,
      trackName: '',
      raceCount: 0,
      racesWithResult: 0,
      hits: 0,
      hitRate: null,
      weights: cloneParameters(parameters),
      races: [],
    };
  }

  const trackName = sessions[0].trackName;
  const entryScoresBySession = loadEntryScores(
    db,
    sessions.map((s) => s.id),
  );
  const { margin: _margin, ...summary } = runBacktestInternal(
    sessions,
    entryScoresBySession,
    parameters,
    goal,
    trackName,
    filter.atgTrackId,
  );
  return summary;
}

export async function optimizeWeights(
  db: Database.Database,
  baseParameters: Parameter[],
  filter: BacktestFilter,
  goal: BacktestGoal,
  options?: OptimizeOptions,
): Promise<BacktestOptimizeResult> {
  const baselineWeights = cloneParameters(baseParameters);
  const sessions = loadSessions(db, filter);
  const trackName = sessions[0]?.trackName ?? '';
  const entryScoresBySession = loadEntryScores(
    db,
    sessions.map((s) => s.id),
  );

  const baselineFull = runBacktestInternal(
    sessions,
    entryScoresBySession,
    baselineWeights,
    goal,
    trackName,
    filter.atgTrackId,
  );

  if (baselineFull.racesWithResult === 0) {
    return {
      goal,
      atgTrackId: filter.atgTrackId,
      trackName,
      racesWithResult: 0,
      baseline: stripMargin(baselineFull),
      optimized: stripMargin(baselineFull),
      hitsGained: 0,
      improved: false,
      message: 'Inga lopp med resultat att optimera mot.',
      trialsRun: 0,
      maxTrials: normalizeMaxTrials(options?.maxTrials),
    };
  }

  const ctx: OptimizeContext = {
    sessions,
    entryScoresBySession,
    goal,
    trackName,
    atgTrackId: filter.atgTrackId,
  };
  const baselineById = new Map(baselineWeights.map((p) => [p.id, p.weight]));
  const state = {
    trialsRun: 0,
    maxTrials: normalizeMaxTrials(options?.maxTrials),
  };

  let best = baselineFull;
  let bestWeights = cloneParameters(baselineWeights);

  let pass = await coordinateDescent(ctx, bestWeights, baselineById, COARSE_STEP, best, state, options, 'coarse');
  if (compareBacktests(pass.best, best) > 0) {
    best = pass.best;
    bestWeights = pass.weights;
  }
  pass = await coordinateDescent(ctx, pass.weights, baselineById, FINE_STEP, pass.best, state, options, 'fine');
  if (compareBacktests(pass.best, best) > 0) {
    best = pass.best;
    bestWeights = pass.weights;
  }

  for (let restart = 0; restart < RANDOM_RESTARTS && state.trialsRun < state.maxTrials; restart++) {
    const seed = randomValidWeights(baselineWeights);
    if (!seed) continue;

    let restartBest = runBacktestInternal(
      ctx.sessions,
      ctx.entryScoresBySession,
      seed,
      ctx.goal,
      ctx.trackName,
      ctx.atgTrackId,
    );

    let restartPass = await coordinateDescent(
      ctx,
      seed,
      baselineById,
      COARSE_STEP,
      restartBest,
      state,
      options,
      'restart',
      restart + 1,
    );
    restartPass = await coordinateDescent(
      ctx,
      restartPass.weights,
      baselineById,
      FINE_STEP,
      restartPass.best,
      state,
      options,
      'restart',
      restart + 1,
    );

    if (compareBacktests(restartPass.best, best) > 0) {
      best = restartPass.best;
      bestWeights = restartPass.weights;
    }
  }

  if (state.trialsRun < state.maxTrials) {
    const filled = await fillRemainingTrials(ctx, baselineWeights, best, bestWeights, state, options);
    if (compareBacktests(filled.best, best) > 0) {
      best = filled.best;
      bestWeights = filled.weights;
    }
  }

  const improved = compareBacktests(best, baselineFull) > 0;
  const usedAllTrials = state.trialsRun >= state.maxTrials;

  return {
    goal,
    atgTrackId: filter.atgTrackId,
    trackName,
    racesWithResult: baselineFull.racesWithResult,
    baseline: stripMargin(baselineFull),
    optimized: {
      ...stripMargin(improved ? best : baselineFull),
      weights: cloneParameters(improved ? bestWeights : baselineWeights),
    },
    hitsGained: (improved ? best : baselineFull).hits - baselineFull.hits,
    improved,
    message: improved
      ? usedAllTrials
        ? `Hittade bättre vikter efter alla ${state.maxTrials.toLocaleString('sv-SE')} testade alternativ.`
        : `Hittade bättre vikter efter ${state.trialsRun.toLocaleString('sv-SE')} testade alternativ (max ${state.maxTrials.toLocaleString('sv-SE')}).`
      : usedAllTrials
        ? `Ingen bättre viktuppsättning hittades efter alla ${state.maxTrials.toLocaleString('sv-SE')} testade alternativ — behåll nuvarande inställningar.`
        : `Ingen bättre viktuppsättning hittades efter ${state.trialsRun.toLocaleString('sv-SE')} testade alternativ (max ${state.maxTrials.toLocaleString('sv-SE')}) — behåll nuvarande inställningar.`,
    trialsRun: state.trialsRun,
    maxTrials: state.maxTrials,
  };
}

function stripMargin(summary: ScoredBacktest): BacktestSummary {
  const { margin: _margin, ...rest } = summary;
  return rest;
}
