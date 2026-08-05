import type {
  AutoOptimizerStatus,
  BacktestGoal,
  BacktestSummary,
  BacktestTrackOption,
  BulkImportStatus,
  GameSession,
  KnownTrack,
  Parameter,
  RaceSession,
  StatsSummary,
  TrackProfileSummary,
} from '../shared/types';
import { DEFAULT_BACKTEST_GOAL } from '../shared/types';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Något gick fel');
  return data as T;
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

export interface StatsSyncStatus {
  lastSyncAt: string | null;
  running: boolean;
}

export interface StatEntityOption {
  type: 'driver' | 'trainer';
  id: number;
  name: string;
  appearances: number;
}

export interface CachedStatRow {
  starts: number;
  wins: number;
  winPercent: number | null;
  updatedAt: string | null;
  source: string;
}

export interface StatSummary {
  entityType: 'driver' | 'trainer';
  entityId: number;
  name: string | null;
  scope: 'track' | 'global';
  trackId: number | null;
  trackName: string | null;
  lookbackDays: number;
  usedWinPercent: number | null;
  cached: CachedStatRow | null;
  globalCached: CachedStatRow | null;
  entryValue?: number | null;
  entryTrackValue?: number | null;
  entryGlobalValue?: number | null;
  entryOverride: number | null;
  description: string;
}

export interface StatContributingStart {
  date: string;
  raceId: string;
  trackId: number;
  trackName: string;
  raceNumber: number | null;
  postPosition: number | null;
  won: boolean;
  place: number | null;
  horseName: string | null;
  atgUrl: string | null;
}

export interface StatRacesResult {
  starts: StatContributingStart[];
  computed: { starts: number; wins: number; winPercent: number | null };
  lookbackDays: number;
  fromDate: string;
  toDate: string;
  scope: 'track' | 'global';
  trackId: number | null;
  trackName: string | null;
}

export const fetchStatEntities = (q?: string) => {
  const params = q ? `?q=${encodeURIComponent(q)}` : '';
  return api<StatEntityOption[]>(`/stats/entities${params}`);
};

export const fetchDriverStatSummary = (
  driverId: number,
  options?: { trackId?: number; sessionId?: number; entryId?: number },
) => {
  const params = new URLSearchParams();
  if (options?.trackId != null) params.set('trackId', String(options.trackId));
  if (options?.sessionId != null) params.set('sessionId', String(options.sessionId));
  if (options?.entryId != null) params.set('entryId', String(options.entryId));
  const qs = params.toString();
  return api<StatSummary>(`/stats/drivers/${driverId}${qs ? `?${qs}` : ''}`);
};

export const fetchDriverStatRaces = (
  driverId: number,
  options?: { trackId?: number; scope?: 'auto' | 'track' | 'global' },
) => {
  const params = new URLSearchParams();
  if (options?.trackId != null) params.set('trackId', String(options.trackId));
  if (options?.scope) params.set('scope', options.scope);
  const qs = params.toString();
  return api<StatRacesResult>(`/stats/drivers/${driverId}/races${qs ? `?${qs}` : ''}`);
};

export const fetchTrainerStatSummary = (
  trainerId: number,
  options?: { sessionId?: number; entryId?: number },
) => {
  const params = new URLSearchParams();
  if (options?.sessionId != null) params.set('sessionId', String(options.sessionId));
  if (options?.entryId != null) params.set('entryId', String(options.entryId));
  const qs = params.toString();
  return api<StatSummary>(`/stats/trainers/${trainerId}${qs ? `?${qs}` : ''}`);
};

export const fetchTrainerStatRaces = (trainerId: number) =>
  api<StatRacesResult>(`/stats/trainers/${trainerId}/races`);

export const fetchParameters = () => api<Parameter[]>('/parameters');
export const saveParameters = (params: Parameter[]) =>
  api<Parameter[]>('/parameters', { method: 'PUT', body: JSON.stringify(params) });

export interface SessionListItem {
  id: number;
  atgRaceId: string;
  gameType: string;
  legNumber: number;
  trackRaceNumber: number | null;
  date: string;
  trackName: string;
  distance: number | null;
  status: string | null;
  importedAt: string;
  tipSubmittedAt: string | null;
  usesTipParameters: boolean;
}

export const fetchSessions = () => api<SessionListItem[]>('/sessions');
export const fetchSession = (id: number) => api<RaceSession>(`/sessions/${id}`);
export const saveEntryManualScore = (
  sessionId: number,
  entryId: number,
  parameterId: string,
  score: number,
) =>
  api<RaceSession>(`/sessions/${sessionId}/entries/${entryId}/scores`, {
    method: 'PATCH',
    body: JSON.stringify({ parameterId, score }),
  });
export const saveEntryDriverWinPct = (
  sessionId: number,
  entryId: number,
  winPct: number | null,
) =>
  api<RaceSession>(`/sessions/${sessionId}/entries/${entryId}/driver-win-pct`, {
    method: 'PATCH',
    body: JSON.stringify({ winPct }),
  });
export const saveEntryTrainerWinPct = (
  sessionId: number,
  entryId: number,
  winPct: number | null,
) =>
  api<RaceSession>(`/sessions/${sessionId}/entries/${entryId}/trainer-win-pct`, {
    method: 'PATCH',
    body: JSON.stringify({ winPct }),
  });
export interface ImportGameResult {
  gameSession: GameSession;
  importedLegs: number;
  totalLegs: number;
  errors: string[];
}

export const importRace = (url: string, allLegs = false) =>
  allLegs
    ? api<ImportGameResult>('/import', { method: 'POST', body: JSON.stringify({ url, allLegs: true }) })
    : api<RaceSession>('/import', { method: 'POST', body: JSON.stringify({ url }) });
export const fetchResultsFromAtg = (id: number, url?: string) =>
  api<RaceSession>(`/sessions/${id}/fetch-results`, {
    method: 'POST',
    body: JSON.stringify(url ? { url } : {}),
  });
export const submitTip = (id: number) =>
  api<RaceSession>(`/sessions/${id}/submit-tip`, { method: 'POST', body: '{}' });
export const recalculateSession = (id: number, useGlobal = false) =>
  api<RaceSession>(`/sessions/${id}/recalculate`, {
    method: 'POST',
    body: JSON.stringify({ useGlobal }),
  });
export const restoreTipWeights = (id: number) =>
  api<RaceSession>(`/sessions/${id}/restore-tip`, { method: 'POST', body: '{}' });
export interface StatsFilters {
  trackName?: string;
  gameType?: string;
  dateFrom?: string;
  dateTo?: string;
}

function statsQueryString(filters?: StatsFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.trackName) params.set('trackName', filters.trackName);
  if (filters.gameType) params.set('gameType', filters.gameType);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const fetchStats = (filters?: StatsFilters) =>
  api<StatsSummary>(`/stats${statsQueryString(filters)}`);
export const fetchStatsSync = () => api<StatsSyncStatus>('/stats/sync');
export const syncTrackStats = () =>
  api<StatsSyncStatus & { entriesUpdated?: number }>('/stats/sync', {
    method: 'POST',
    body: '{}',
  });

export const fetchBacktestTracks = () => api<BacktestTrackOption[]>('/backtest/tracks');
export const runBacktest = (body: {
  atgTrackId: number;
  startMethod?: 'auto' | 'volte' | null;
  gameType?: string | null;
  goal: BacktestGoal;
  weights?: Parameter[];
}) =>
  api<BacktestSummary>('/backtest/run', { method: 'POST', body: JSON.stringify(body) });
export const optimizeBacktest = (body: {
  atgTrackId: number;
  startMethod?: 'auto' | 'volte' | null;
  gameType?: string | null;
  goal: BacktestGoal;
  maxTrials?: number;
}) =>
  api<AutoOptimizerStatus>('/backtest/optimize', { method: 'POST', body: JSON.stringify(body) });

export const fetchAutoOptimizerStatus = (atgTrackId?: number) =>
  api<AutoOptimizerStatus>(
    `/backtest/auto${atgTrackId != null ? `?atgTrackId=${atgTrackId}` : ''}`,
  );
export const runAutoOptimizer = (
  goal: BacktestGoal = DEFAULT_BACKTEST_GOAL,
  atgTrackId?: number,
  maxTrials?: number,
) =>
  api<AutoOptimizerStatus>('/backtest/auto/run', {
    method: 'POST',
    body: JSON.stringify({ goal, atgTrackId, maxTrials }),
  });

export const fetchKnownTracks = () => api<KnownTrack[]>('/tracks/known');
export const fetchTrackProfiles = () => api<TrackProfileSummary[]>('/track-profiles');
export const fetchTrackProfile = (atgTrackId: number) =>
  api<Parameter[]>(`/track-profiles/${atgTrackId}`);
export const saveTrackProfile = (atgTrackId: number, trackName: string, parameters: Parameter[]) =>
  api<Parameter[]>(`/track-profiles/${atgTrackId}`, {
    method: 'PUT',
    body: JSON.stringify({ trackName, parameters }),
  });

export const fetchBulkImportStatus = () => api<BulkImportStatus>('/import/bulk/status');
export const startBulkImport = (body: {
  atgTrackId: number;
  trackSlug: string;
  trackName: string;
  months?: number;
}) =>
  api<BulkImportStatus>('/import/bulk', { method: 'POST', body: JSON.stringify(body) });

export const fetchGameSessions = () => api<GameSessionListItem[]>('/game-sessions');
export const deleteGameSession = (id: number) =>
  api<{ ok: true }>(`/game-sessions/${id}`, { method: 'DELETE' });
export const fetchGameSession = (id: number) => api<GameSession>(`/game-sessions/${id}`);
export const saveGameUserSystem = (
  id: number,
  legs: Array<{ legId: number; startNumbers: number[] }>,
) =>
  api<GameSession>(`/game-sessions/${id}/user-system`, {
    method: 'PUT',
    body: JSON.stringify({ legs }),
  });
export const refreshGameRaceInfo = (id: number) =>
  api<{ game: GameSession; updated: number }>(`/game-sessions/${id}/refresh-race-info`, {
    method: 'POST',
    body: '{}',
  });
export const submitGameTip = (id: number) =>
  api<GameSession>(`/game-sessions/${id}/submit-tip`, { method: 'POST', body: '{}' });
export const recalculateGame = (id: number, useGlobal = false) =>
  api<GameSession>(`/game-sessions/${id}/recalculate`, {
    method: 'POST',
    body: JSON.stringify({ useGlobal }),
  });
export const restoreGameTip = (id: number) =>
  api<GameSession>(`/game-sessions/${id}/restore-tip`, { method: 'POST', body: '{}' });

export async function fetchGameResults(
  id: number,
): Promise<{ game: GameSession; errors: string[] }> {
  const res = await fetch(`/api/game-sessions/${id}/fetch-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json();
  if (!res.ok && res.status !== 207) {
    throw new Error(data.error ?? 'Kunde inte hämta resultat');
  }
  return data as { game: GameSession; errors: string[] };
}

export interface WatchlistEntry {
  atgHorseId: number;
  horseName: string;
  markedAt: string;
  expiresAt: string;
  sourceSessionId: number | null;
}

export const fetchWatchlist = () =>
  api<{ entries: WatchlistEntry[]; days: number }>('/watchlist');

export const addToWatchlist = (
  atgHorseId: number,
  horseName: string,
  sourceSessionId?: number,
) =>
  api<{ ok: true; days: number }>('/watchlist', {
    method: 'POST',
    body: JSON.stringify({ atgHorseId, horseName, sourceSessionId }),
  });

export const removeFromWatchlist = (atgHorseId: number) =>
  api<{ ok: true }>(`/watchlist/${atgHorseId}`, { method: 'DELETE' });
