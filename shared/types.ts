export type GameType = 'V85' | 'V86' | 'V75' | 'GS75' | 'V64' | 'V65' | 'V5' | 'V4' | 'V3';

export interface Parameter {
  id: string;
  name: string;
  weight: number;
  minScore: number;
  maxScore: number;
  sortOrder: number;
  autoKey: string | null;
}

export interface FormStart {
  formOrder: number;
  date: string;
  distance: number | null;
  postPosition: number | null;
  kmTime: string | null;
  place: string | null;
  isRecordTime?: boolean;
  driverName: string | null;
  prizeFirst: number | null;
  trackName: string | null;
}

export interface RaceEntry {
  id: number;
  startNumber: number;
  postPosition: number | null;
  startDistance: number | null;
  volteRow: 'front' | 'back' | null;
  horseName: string;
  atgHorseId: number;
  atgDriverId: number | null;
  driverName: string | null;
  horseSex: string | null;
  careerStarts: number | null;
  driverApprentice: boolean;
  startPoints: number | null;
  earningsPerStart: number | null;
  driverTrackWinPct: number | null;
  driverGlobalWinPct: number | null;
  driverV85WinPctOverride: number | null;
  atgTrainerId: number | null;
  trainerName: string | null;
  trainerWinPct: number | null;
  trainerWinPctOverride: number | null;
  betDistributionPct: number | null;
  trackPostWinPct: number | null;
  trotScore: number | null;
  actualPosition: number | null;
  scratched?: boolean;
  isWatched?: boolean;
  formStarts: FormStart[];
  scores: Record<string, number>;
}

export interface RaceLegInfo {
  name: string | null;
  prize: string | null;
  terms: string[];
  startMethod: string | null;
  distance: number | null;
  scheduledStartTime: string | null;
}

export interface SystemLegSuggestion {
  strategy: 'spik' | 'gardering';
  recommendedPickCount: number;
  picks: Array<{ startNumber: number; horseName: string; trotScore: number }>;
  uncertaintyScore: number;
  reasons: string[];
  scoreMarginTop2: number | null;
  scoreMarginTop3: number | null;
}

export interface GameSystemPlan {
  legs: Array<SystemLegSuggestion & { legId: number; legNumber: number; trackRaceNumber: number | null }>;
  totalRowsEstimate: number;
  spikeCount: number;
  garderingCount: number;
}

export interface UserSavedSystemLeg {
  legId: number;
  startNumbers: number[];
}

export interface UserSavedSystem {
  savedAt: string;
  updatedAt: string;
  legs: UserSavedSystemLeg[];
}

export interface GameSessionLeg {
  id: number;
  legNumber: number;
  trackRaceNumber: number | null;
  distance: number | null;
  startMethod: string | null;
  status: string | null;
  raceInfo: RaceLegInfo | null;
  systemSuggestion: SystemLegSuggestion | null;
  rankedHorses: Array<{
    startNumber: number;
    horseName: string;
    trotScore: number;
    isWatched?: boolean;
    scratched?: boolean;
  }>;
  topStartNumber: number | null;
  topHorseName: string | null;
  topScore: number | null;
  secondStartNumber: number | null;
  secondHorseName: string | null;
  secondScore: number | null;
  marginToSecond: number | null;
  spikeScore: number | null;
  meetsSpikeCriteria: boolean;
  topPosition: number | null;
  hit: 'win' | 'top3' | 'miss' | 'pending' | null;
}

export interface SpikeSuggestion {
  legId: number;
  legNumber: number;
  trackRaceNumber: number | null;
  startNumber: number;
  horseName: string;
  topScore: number;
  secondStartNumber: number | null;
  secondHorseName: string | null;
  secondScore: number;
  marginToSecond: number;
  spikeScore: number;
  rank: number;
}

export interface GameSession {
  id: number;
  gameType: string;
  date: string;
  trackName: string;
  atgTrackId: number | null;
  tipSubmittedAt: string | null;
  usesTipParameters: boolean;
  tipParameters: Parameter[] | null;
  legCount: number;
  legsWithResults: number;
  hitsWin: number;
  hitsTop3: number;
  suggestedSpikes: SpikeSuggestion[];
  systemPlan: GameSystemPlan | null;
  userSystem: UserSavedSystem | null;
  legs: GameSessionLeg[];
}

export type ScoringProfileSource = 'tip' | 'track' | 'global';

export interface RaceSession {
  id: number;
  gameSessionId: number | null;
  atgRaceId: string;
  atgTrackId: number | null;
  gameType: string;
  legNumber: number;
  trackRaceNumber: number | null;
  date: string;
  trackName: string;
  distance: number | null;
  startMethod: string | null;
  sourceUrl: string | null;
  raceName: string | null;
  racePrize: string | null;
  raceTerms: string[];
  scheduledStartTime: string | null;
  importedAt: string;
  status: string | null;
  tipSubmittedAt: string | null;
  usesTipParameters: boolean;
  scoringProfileSource: ScoringProfileSource;
  tipParameters: Parameter[] | null;
  scoringParameters: Parameter[];
  entries: RaceEntry[];
}

export interface StatsSummary {
  totalRaces: number;
  racesWithResult: number;
  topScoreWins: number;
  topScoreTop3: number;
  hitRateWin: number | null;
  hitRateTop3: number | null;
}

export type BacktestGoal = 'win' | 'top3';

/** Default optimization/backtest goal — vinstträff in top 3 picks. */
export const DEFAULT_BACKTEST_GOAL: BacktestGoal = 'win';

export interface BacktestTrackOption {
  atgTrackId: number;
  trackName: string;
  raceCount: number;
  racesWithResult: number;
}

export interface BacktestPickDetail {
  startNumber: number;
  horseName: string;
  trotScore: number;
  actualPosition: number | null;
}

export interface BacktestRaceDetail {
  sessionId: number;
  date: string;
  gameType: string;
  legNumber: number;
  trackRaceNumber: number | null;
  startMethod: string | null;
  topPicks: BacktestPickDetail[];
  hit: 'win' | 'top3' | 'miss';
}

export interface BacktestSummary {
  goal: BacktestGoal;
  atgTrackId: number;
  trackName: string;
  raceCount: number;
  racesWithResult: number;
  hits: number;
  hitRate: number | null;
  weights: Parameter[];
  races: BacktestRaceDetail[];
}

export interface BacktestOptimizeResult {
  goal: BacktestGoal;
  atgTrackId: number;
  trackName: string;
  racesWithResult: number;
  baseline: BacktestSummary;
  optimized: BacktestSummary;
  hitsGained: number;
  improved: boolean;
  message: string | null;
  trialsRun: number;
  maxTrials: number;
}

/** Default number of weight combinations to try during optimization. */
export const OPTIMIZE_TRIALS_DEFAULT = 5000;

export const OPTIMIZE_TRIAL_OPTIONS = [
  { value: 5000, label: 'Standard — 5 000 försök', hint: 'Snabbast, ca 1–3 min' },
  { value: 10000, label: 'Utökad — 10 000 försök', hint: 'Ca 2–6 min' },
  { value: 25000, label: 'Grundlig — 25 000 försök', hint: 'Ca 5–15 min' },
  { value: 50000, label: 'Djup — 50 000 försök', hint: 'Kan ta 15–30+ min' },
] as const;

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

export interface KnownTrack {
  atgTrackId: number;
  slug: string;
  name: string;
}

export interface TrackProfileSummary {
  atgTrackId: number;
  trackName: string;
  updatedAt: string;
  raceCount: number;
  racesWithResult: number;
}

/** How far back bulk track import fetches finished races for backtest/optimization. */
export const BULK_IMPORT_LOOKBACK_MONTHS = 18;

export interface BulkImportStatus {
  running: boolean;
  atgTrackId: number | null;
  trackName: string | null;
  fromDate: string | null;
  toDate: string | null;
  total: number;
  done: number;
  imported: number;
  skipped: number;
  errors: string[];
  message: string | null;
  finishedAt: string | null;
}

export interface ParsedAtgUrl {
  gameType: string;
  date: string;
  trackSlug: string;
  leg: number;
}

export function mergeTrackParameterWeights(
  trackParams: Parameter[],
  globalParams: Parameter[],
): Parameter[] {
  const trackById = new Map(trackParams.map((p) => [p.id, p]));
  return globalParams.map((global) => {
    const track = trackById.get(global.id);
    return track ? { ...global, weight: track.weight } : global;
  });
}

export const DEFAULT_PARAMETERS: Omit<Parameter, 'id'>[] = [
  { name: 'Startpoäng', weight: 25, minScore: 0, maxScore: 10, sortOrder: 0, autoKey: 'startPoints' },
  { name: 'Kr/start', weight: 15, minScore: 0, maxScore: 10, sortOrder: 1, autoKey: 'earningsPerStart' },
  { name: 'Form (placering)', weight: 30, minScore: 0, maxScore: 10, sortOrder: 2, autoKey: 'formPlace' },
  { name: 'Spår', weight: 15, minScore: 0, maxScore: 10, sortOrder: 3, autoKey: 'trackPostWin' },
  { name: 'Kusk vinst%', weight: 10, minScore: 0, maxScore: 10, sortOrder: 4, autoKey: 'driverV85Win' },
  { name: 'Tränare vinst%', weight: 0, minScore: 0, maxScore: 10, sortOrder: 5, autoKey: 'trainerWin' },
  { name: 'Vinst senaste start', weight: 0, minScore: 0, maxScore: 10, sortOrder: 6, autoKey: 'recentWin' },
  { name: 'Startstraff', weight: 0, minScore: 0, maxScore: 10, sortOrder: 8, autoKey: 'startDistancePenalty' },
  { name: 'Värmning', weight: 0, minScore: 0, maxScore: 10, sortOrder: 7, autoKey: null },
];

export const VARMNING_PARAMETER_ID = 'param-6';

/** Poäng för manuell värmningsmarkering */
export const VARMNING_SCORES = {
  none: 0,
  goodReport: 6,
  winner: 10,
} as const;
