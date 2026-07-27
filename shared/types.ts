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
  driverV85WinPct: number | null;
  betDistributionPct: number | null;
  trackPostWinPct: number | null;
  trotScore: number | null;
  actualPosition: number | null;
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
  rankedHorses: Array<{ startNumber: number; horseName: string; trotScore: number }>;
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

export const DEFAULT_PARAMETERS: Omit<Parameter, 'id'>[] = [
  { name: 'Startpoäng', weight: 25, minScore: 0, maxScore: 10, sortOrder: 0, autoKey: 'startPoints' },
  { name: 'Kr/start', weight: 15, minScore: 0, maxScore: 10, sortOrder: 1, autoKey: 'earningsPerStart' },
  { name: 'Form (placering)', weight: 30, minScore: 0, maxScore: 10, sortOrder: 2, autoKey: 'formPlace' },
  { name: 'Spår', weight: 15, minScore: 0, maxScore: 10, sortOrder: 3, autoKey: 'trackPostWin' },
  { name: 'Kusk vinst%', weight: 10, minScore: 0, maxScore: 10, sortOrder: 4, autoKey: 'driverV85Win' },
  { name: 'Vinst senaste start', weight: 0, minScore: 0, maxScore: 10, sortOrder: 5, autoKey: 'recentWin' },
  { name: 'Värmning', weight: 0, minScore: 0, maxScore: 10, sortOrder: 6, autoKey: null },
];

export const VARMNING_PARAMETER_ID = 'param-6';

/** Poäng för manuell värmningsmarkering */
export const VARMNING_SCORES = {
  none: 0,
  goodReport: 6,
  winner: 10,
} as const;
