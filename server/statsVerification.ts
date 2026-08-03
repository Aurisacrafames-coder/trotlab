import type Database from 'better-sqlite3';
import { resolveActualPlacement } from '../shared/format.js';
import { atgFetch, getTrackSlugById } from './atg.js';
import {
  DRIVER_LOOKBACK_DAYS,
  TRAINER_LOOKBACK_DAYS,
  getDriverWinPercentCached,
  getTrainerWinPercentCached,
} from './atgStats.js';

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

interface CalendarDay {
  tracks?: Array<{
    id: number;
    name: string;
    races?: Array<{ id: string; status: string; number?: number }>;
  }>;
}

interface VerificationRace {
  id: string;
  date: string;
  number?: number;
  status: string;
  track: { id: number; name: string };
  starts: Array<{
    postPosition?: number;
    driver?: { id: number; firstName?: string; lastName?: string; shortName?: string };
    horse?: {
      name?: string;
      trainer?: { id: number; firstName?: string; lastName?: string; shortName?: string };
    };
    result?: { place?: number; finishOrder?: number; galloped?: boolean; disqualified?: boolean };
  }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function atgWinPercent(wins: number, starts: number): number | null {
  if (starts === 0) return null;
  return Math.round((wins / starts) * 1000) / 10;
}

function extractWinPlace(result?: {
  place?: number;
  finishOrder?: number;
  galloped?: boolean;
  disqualified?: boolean;
}): boolean {
  if (!result || result.galloped || result.disqualified) return false;
  if (result.place === 1) return true;
  return result.finishOrder === 1;
}

function extractPlace(result?: {
  place?: number;
  finishOrder?: number;
  galloped?: boolean;
  disqualified?: boolean;
}): number | null {
  return resolveActualPlacement(result);
}

function* dateRange(startDate: string, endDate: string): Generator<string> {
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cursor <= end) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function buildAtgRaceUrl(date: string, trackId: number, raceNumber: number | null): string | null {
  if (raceNumber == null) return null;
  const slug = getTrackSlugById(trackId);
  if (!slug) return null;
  return `https://www.atg.se/spel/${date}/vinnare/${slug}/lopp/${raceNumber}`;
}

function normalizeSearchQuery(q: string): string {
  return q.trim().toLowerCase();
}

export function searchStatEntities(db: Database.Database, query?: string): StatEntityOption[] {
  const q = query ? normalizeSearchQuery(query) : '';
  const like = q ? `%${q}%` : null;

  const drivers = (like
    ? db
        .prepare(
          `SELECT atg_driver_id as id, driver_name as name, COUNT(*) as appearances
           FROM race_entries
           WHERE atg_driver_id IS NOT NULL AND driver_name IS NOT NULL
             AND LOWER(driver_name) LIKE ?
           GROUP BY atg_driver_id
           ORDER BY appearances DESC, name COLLATE NOCASE
           LIMIT 30`,
        )
        .all(like)
    : db
        .prepare(
          `SELECT atg_driver_id as id, driver_name as name, COUNT(*) as appearances
           FROM race_entries
           WHERE atg_driver_id IS NOT NULL AND driver_name IS NOT NULL
           GROUP BY atg_driver_id
           ORDER BY appearances DESC, name COLLATE NOCASE
           LIMIT 30`,
        )
        .all()) as Array<{ id: number; name: string; appearances: number }>;

  const trainers = (like
    ? db
        .prepare(
          `SELECT atg_trainer_id as id, trainer_name as name, COUNT(*) as appearances
           FROM race_entries
           WHERE atg_trainer_id IS NOT NULL AND trainer_name IS NOT NULL
             AND LOWER(trainer_name) LIKE ?
           GROUP BY atg_trainer_id
           ORDER BY appearances DESC, name COLLATE NOCASE
           LIMIT 30`,
        )
        .all(like)
    : db
        .prepare(
          `SELECT atg_trainer_id as id, trainer_name as name, COUNT(*) as appearances
           FROM race_entries
           WHERE atg_trainer_id IS NOT NULL AND trainer_name IS NOT NULL
           GROUP BY atg_trainer_id
           ORDER BY appearances DESC, name COLLATE NOCASE
           LIMIT 30`,
        )
        .all()) as Array<{ id: number; name: string; appearances: number }>;

  return [
    ...drivers.map((d) => ({ type: 'driver' as const, ...d })),
    ...trainers.map((t) => ({ type: 'trainer' as const, ...t })),
  ].sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name, 'sv'));
}

function resolveEntityName(
  db: Database.Database,
  type: 'driver' | 'trainer',
  id: number,
): string | null {
  if (type === 'driver') {
    const row = db
      .prepare(
        `SELECT driver_name as name FROM race_entries
         WHERE atg_driver_id = ? AND driver_name IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(id) as { name: string } | undefined;
    return row?.name ?? null;
  }
  const row = db
    .prepare(
      `SELECT trainer_name as name FROM race_entries
       WHERE atg_trainer_id = ? AND trainer_name IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(id) as { name: string } | undefined;
  return row?.name ?? null;
}

function readDriverTrackCache(
  db: Database.Database,
  driverId: number,
  trackId: number,
): CachedStatRow | null {
  const row = db
    .prepare(
      `SELECT starts, wins, win_percent as winPercent, updated_at as updatedAt
       FROM driver_track_win_stats WHERE driver_id = ? AND track_id = ?`,
    )
    .get(driverId, trackId) as
    | { starts: number; wins: number; winPercent: number | null; updatedAt: string }
    | undefined;
  if (!row || row.starts === 0) return null;
  return { ...row, source: 'driver_track_win_stats' };
}

function readDriverGlobalCache(db: Database.Database, driverId: number): CachedStatRow | null {
  const row = db
    .prepare(
      `SELECT starts, wins, win_percent as winPercent, updated_at as updatedAt
       FROM driver_win_stats WHERE driver_id = ?`,
    )
    .get(driverId) as
    | { starts: number; wins: number; winPercent: number | null; updatedAt: string }
    | undefined;
  if (!row) return null;
  return { ...row, source: 'driver_win_stats' };
}

function readTrainerCache(db: Database.Database, trainerId: number): CachedStatRow | null {
  const row = db
    .prepare(
      `SELECT starts, wins, win_percent as winPercent, updated_at as updatedAt
       FROM trainer_win_stats WHERE trainer_id = ?`,
    )
    .get(trainerId) as
    | { starts: number; wins: number; winPercent: number | null; updatedAt: string }
    | undefined;
  if (!row) return null;
  return { ...row, source: 'trainer_win_stats' };
}

function readEntryDriverValue(
  db: Database.Database,
  sessionId: number | null,
  entryId: number | null,
  driverId: number,
): { trackValue: number | null; globalValue: number | null; override: number | null } {
  if (sessionId != null && entryId != null) {
    const row = db
      .prepare(
        `SELECT driver_track_win_pct as trackValue, driver_global_win_pct as globalValue,
                driver_v85_win_pct_override as override
         FROM race_entries WHERE id = ? AND session_id = ? AND atg_driver_id = ?`,
      )
      .get(entryId, sessionId, driverId) as
      | { trackValue: number | null; globalValue: number | null; override: number | null }
      | undefined;
    if (row) return row;
  }
  return { trackValue: null, globalValue: null, override: null };
}

function readEntryTrainerValue(
  db: Database.Database,
  sessionId: number | null,
  entryId: number | null,
  trainerId: number,
): { value: number | null; override: number | null } {
  if (sessionId != null && entryId != null) {
    const row = db
      .prepare(
        `SELECT trainer_win_pct as value, trainer_win_pct_override as override
         FROM race_entries WHERE id = ? AND session_id = ? AND atg_trainer_id = ?`,
      )
      .get(entryId, sessionId, trainerId) as { value: number | null; override: number | null } | undefined;
    if (row) return row;
  }
  return { value: null, override: null };
}

function resolveTrackName(db: Database.Database, trackId: number | null): string | null {
  if (trackId == null) return null;
  const row = db
    .prepare(
      `SELECT track_name as trackName FROM race_sessions
       WHERE atg_track_id = ? AND track_name IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(trackId) as { trackName: string } | undefined;
  return row?.trackName ?? null;
}

export function getDriverStatSummary(
  db: Database.Database,
  driverId: number,
  options?: { trackId?: number | null; sessionId?: number | null; entryId?: number | null },
): StatSummary {
  const trackId = options?.trackId ?? null;
  const trackCached = trackId != null ? readDriverTrackCache(db, driverId, trackId) : null;
  const globalCached = readDriverGlobalCache(db, driverId);
  const usedScope: 'track' | 'global' = trackCached ? 'track' : 'global';
  const cached = trackCached ?? globalCached;
  const entry = readEntryDriverValue(db, options?.sessionId ?? null, options?.entryId ?? null, driverId);
  const usedWinPercent = getDriverWinPercentCached(driverId, trackId, db);

  const trackName = resolveTrackName(db, trackId);
  const description =
    usedScope === 'track'
      ? `Kusk vinst% på ${trackName ?? `bana ${trackId}`} (senaste ${DRIVER_LOOKBACK_DAYS} dagar) och totalt alla banor — poäng = 60 % bana + 40 % totalt`
      : `Kusk vinst% totalt alla banor (senaste ${DRIVER_LOOKBACK_DAYS} dagar)`;

  return {
    entityType: 'driver',
    entityId: driverId,
    name: resolveEntityName(db, 'driver', driverId),
    scope: usedScope,
    trackId,
    trackName,
    lookbackDays: DRIVER_LOOKBACK_DAYS,
    usedWinPercent,
    cached,
    globalCached,
    entryTrackValue: entry.trackValue,
    entryGlobalValue: entry.globalValue,
    entryOverride: entry.override,
    description,
  };
}

export function getTrainerStatSummary(
  db: Database.Database,
  trainerId: number,
  options?: { sessionId?: number | null; entryId?: number | null },
): StatSummary {
  const cached = readTrainerCache(db, trainerId);
  const entry = readEntryTrainerValue(
    db,
    options?.sessionId ?? null,
    options?.entryId ?? null,
    trainerId,
  );
  const usedWinPercent = getTrainerWinPercentCached(trainerId, db);

  return {
    entityType: 'trainer',
    entityId: trainerId,
    name: resolveEntityName(db, 'trainer', trainerId),
    scope: 'global',
    trackId: null,
    trackName: null,
    lookbackDays: TRAINER_LOOKBACK_DAYS,
    usedWinPercent,
    cached,
    globalCached: null,
    entryValue: entry.override ?? entry.value,
    entryOverride: entry.override,
    description: `Tränare vinst% totalt alla banor (senaste ${TRAINER_LOOKBACK_DAYS} dagar)`,
  };
}

async function iterateContributingStarts(
  fromDate: string,
  toDate: string,
  trackId: number | null,
  matchStart: (race: VerificationRace, start: VerificationRace['starts'][number]) => boolean,
  mapStart: (
    race: VerificationRace,
    start: VerificationRace['starts'][number],
  ) => StatContributingStart | null,
): Promise<StatContributingStart[]> {
  const results: StatContributingStart[] = [];

  for (const date of dateRange(fromDate, toDate)) {
    let calendar: CalendarDay;
    try {
      calendar = await atgFetch<CalendarDay>(`/calendar/day/${date}`);
    } catch {
      continue;
    }

    const tracks =
      trackId != null
        ? (calendar.tracks ?? []).filter((t) => t.id === trackId)
        : (calendar.tracks ?? []);

    for (const track of tracks) {
      for (const raceRef of track.races ?? []) {
        if (raceRef.status !== 'results') continue;
        try {
          const race = await atgFetch<VerificationRace>(`/races/${raceRef.id}`);
          if (race.status !== 'results') continue;

          for (const start of race.starts) {
            if (!matchStart(race, start)) continue;
            const row = mapStart(race, start);
            if (row) results.push(row);
          }
        } catch {
          /* skip race */
        }
        await sleep(15);
      }
    }
    await sleep(10);
  }

  return results.sort((a, b) => b.date.localeCompare(a.date) || (b.raceNumber ?? 0) - (a.raceNumber ?? 0));
}

export async function fetchDriverContributingStarts(
  driverId: number,
  scope: 'track' | 'global' | 'auto',
  trackId: number | null,
): Promise<StatRacesResult> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - DRIVER_LOOKBACK_DAYS);
  const fromDate = start.toISOString().slice(0, 10);

  const effectiveScope: 'track' | 'global' =
    scope === 'auto' ? (trackId != null ? 'track' : 'global') : scope;
  const filterTrackId = effectiveScope === 'track' ? trackId : null;

  const starts = await iterateContributingStarts(
    fromDate,
    today,
    filterTrackId,
    (_race, start) => start.driver?.id === driverId,
    (race, start) => {
      const won = extractWinPlace(start.result);
      const place = extractPlace(start.result);
      return {
        date: race.date,
        raceId: race.id,
        trackId: race.track.id,
        trackName: race.track.name,
        raceNumber: race.number ?? null,
        postPosition: start.postPosition ?? null,
        won,
        place,
        horseName: start.horse?.name ?? null,
        atgUrl: buildAtgRaceUrl(race.date, race.track.id, race.number ?? null),
      };
    },
  );

  const wins = starts.filter((s) => s.won).length;
  return {
    starts,
    computed: { starts: starts.length, wins, winPercent: atgWinPercent(wins, starts.length) },
    lookbackDays: DRIVER_LOOKBACK_DAYS,
    fromDate,
    toDate: today,
    scope: effectiveScope,
    trackId: filterTrackId,
    trackName: filterTrackId != null ? (starts[0]?.trackName ?? null) : null,
  };
}

export async function fetchTrainerContributingStarts(trainerId: number): Promise<StatRacesResult> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - TRAINER_LOOKBACK_DAYS);
  const fromDate = start.toISOString().slice(0, 10);

  const starts = await iterateContributingStarts(
    fromDate,
    today,
    null,
    (_race, start) => start.horse?.trainer?.id === trainerId,
    (race, start) => {
      const won = extractWinPlace(start.result);
      const place = extractPlace(start.result);
      return {
        date: race.date,
        raceId: race.id,
        trackId: race.track.id,
        trackName: race.track.name,
        raceNumber: race.number ?? null,
        postPosition: start.postPosition ?? null,
        won,
        place,
        horseName: start.horse?.name ?? null,
        atgUrl: buildAtgRaceUrl(race.date, race.track.id, race.number ?? null),
      };
    },
  );

  const wins = starts.filter((s) => s.won).length;
  return {
    starts,
    computed: { starts: starts.length, wins, winPercent: atgWinPercent(wins, starts.length) },
    lookbackDays: TRAINER_LOOKBACK_DAYS,
    fromDate,
    toDate: today,
    scope: 'global',
    trackId: null,
    trackName: null,
  };
}
