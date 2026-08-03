import type Database from 'better-sqlite3';
import { atgFetch } from './atg.js';
import { normalizeStartMethod, trackPostVolteRowKey, volteRowFromDistance } from '../shared/scoring.js';
import { recalculateSessionScores } from './sessionScores.js';

const TRACK_LOOKBACK_DAYS = 365;
const TRAINER_LOOKBACK_DAYS = 60;
export { TRACK_LOOKBACK_DAYS as DRIVER_LOOKBACK_DAYS, TRAINER_LOOKBACK_DAYS };
const STATS_CACHE_HOURS = 24;

type DriverCounts = { wins: number; starts: number };

interface CalendarDay {
  tracks?: Array<{
    id: number;
    races?: Array<{ id: string; status: string }>;
  }>;
  games?: Record<string, Array<{ id: string; races: string[] }>>;
}

interface StatsRace {
  status: string;
  startMethod?: string;
  starts: Array<{
    postPosition?: number;
    distance?: number;
    driver?: { id: number };
    horse?: { trainer?: { id: number } };
    result?: { place?: number; finishOrder?: number };
  }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCacheFresh(updatedAt: string): boolean {
  const updated = new Date(updatedAt.includes('T') ? updatedAt : `${updatedAt.replace(' ', 'T')}`);
  if (Number.isNaN(updated.getTime())) return false;
  return Date.now() - updated.getTime() < STATS_CACHE_HOURS * 60 * 60 * 1000;
}

function atgWinPercent(wins: number, starts: number): number | null {
  if (starts === 0) return null;
  return Math.round((wins / starts) * 1000) / 10;
}

function extractWinPlace(result?: { place?: number; finishOrder?: number }): boolean {
  if (!result) return false;
  if (result.place === 1) return true;
  return result.finishOrder === 1;
}

function* dateRange(startDate: string, endDate: string): Generator<string> {
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cursor <= end) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function addWinStart(byId: Map<number, DriverCounts>, id: number, won: boolean) {
  const row = byId.get(id) ?? { wins: 0, starts: 0 };
  row.starts++;
  if (won) row.wins++;
  byId.set(id, row);
}

function collectTrainersFromRace(race: StatsRace, byTrainer: Map<number, DriverCounts>) {
  if (race.status !== 'results') return;
  for (const start of race.starts) {
    const trainerId = start.horse?.trainer?.id;
    if (trainerId) addWinStart(byTrainer, trainerId, extractWinPlace(start.result));
  }
}

function collectDriversFromRace(race: StatsRace, byDriver: Map<number, DriverCounts>) {
  if (race.status !== 'results') return;
  for (const start of race.starts) {
    const driverId = start.driver?.id;
    if (driverId) addWinStart(byDriver, driverId, extractWinPlace(start.result));
  }
}

let globalDriverRefreshPromise: Promise<void> | null = null;
let globalTrainerRefreshPromise: Promise<void> | null = null;

async function iterateRaceResults(fromDate: string, today: string, onRace: (race: StatsRace) => void) {
  for (const date of dateRange(fromDate, today)) {
    let calendar: CalendarDay;
    try {
      calendar = await atgFetch<CalendarDay>(`/calendar/day/${date}`);
    } catch {
      continue;
    }

    for (const track of calendar.tracks ?? []) {
      for (const raceRef of track.races ?? []) {
        if (raceRef.status !== 'results') continue;
        try {
          const race = await atgFetch<StatsRace>(`/races/${raceRef.id}`);
          onRace(race);
        } catch {
          /* skip race */
        }
        await sleep(20);
      }
    }
    await sleep(15);
  }
}

async function refreshGlobalDriverCache(db: Database.Database): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - TRACK_LOOKBACK_DAYS);
  const fromDate = start.toISOString().slice(0, 10);
  const byDriver = new Map<number, DriverCounts>();

  await iterateRaceResults(fromDate, today, (race) => collectDriversFromRace(race, byDriver));

  const upsertDriver = db.prepare(
    `INSERT INTO driver_win_stats (driver_id, starts, wins, win_percent, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(driver_id) DO UPDATE SET
       starts = excluded.starts, wins = excluded.wins,
       win_percent = excluded.win_percent, updated_at = excluded.updated_at`,
  );

  db.transaction(() => {
    for (const [driverId, row] of byDriver) {
      upsertDriver.run(driverId, row.starts, row.wins, atgWinPercent(row.wins, row.starts));
    }
  })();
}

async function refreshGlobalTrainerCache(db: Database.Database): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - TRAINER_LOOKBACK_DAYS);
  const fromDate = start.toISOString().slice(0, 10);
  const byTrainer = new Map<number, DriverCounts>();

  await iterateRaceResults(fromDate, today, (race) => collectTrainersFromRace(race, byTrainer));

  const upsertTrainer = db.prepare(
    `INSERT INTO trainer_win_stats (trainer_id, starts, wins, win_percent, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(trainer_id) DO UPDATE SET
       starts = excluded.starts, wins = excluded.wins,
       win_percent = excluded.win_percent, updated_at = excluded.updated_at`,
  );

  db.transaction(() => {
    for (const [trainerId, row] of byTrainer) {
      upsertTrainer.run(trainerId, row.starts, row.wins, atgWinPercent(row.wins, row.starts));
    }
  })();

  setSyncMeta(db, 'trainer_lookback_days', String(TRAINER_LOOKBACK_DAYS));
}

async function ensureGlobalDriverCache(db: Database.Database): Promise<void> {
  const latest = db
    .prepare(`SELECT updated_at as updatedAt FROM driver_win_stats ORDER BY updated_at DESC LIMIT 1`)
    .get() as { updatedAt: string } | undefined;

  if (latest && isCacheFresh(latest.updatedAt)) return;

  if (!globalDriverRefreshPromise) {
    globalDriverRefreshPromise = refreshGlobalDriverCache(db).finally(() => {
      globalDriverRefreshPromise = null;
    });
  }
  await globalDriverRefreshPromise;
}

function trainerLookbackChanged(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT value FROM stats_sync_meta WHERE key = 'trainer_lookback_days'`)
    .get() as { value: string } | undefined;
  return row?.value !== String(TRAINER_LOOKBACK_DAYS);
}

export async function ensureGlobalTrainerCache(db: Database.Database): Promise<void> {
  if (trainerLookbackChanged(db)) {
    db.prepare('DELETE FROM trainer_win_stats').run();
  }

  const latest = db
    .prepare(`SELECT updated_at as updatedAt FROM trainer_win_stats ORDER BY updated_at DESC LIMIT 1`)
    .get() as { updatedAt: string } | undefined;

  if (latest && isCacheFresh(latest.updatedAt)) return;

  if (!globalTrainerRefreshPromise) {
    globalTrainerRefreshPromise = refreshGlobalTrainerCache(db).finally(() => {
      globalTrainerRefreshPromise = null;
    });
  }
  await globalTrainerRefreshPromise;
}

async function computeTrackStatsFromAtg(
  trackId: number,
): Promise<{
  byPost: Map<string, DriverCounts>;
  byDriver: Map<number, DriverCounts>;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - TRACK_LOOKBACK_DAYS);
  const fromDate = start.toISOString().slice(0, 10);

  const byPost = new Map<string, DriverCounts>();
  const byDriver = new Map<number, DriverCounts>();

  for (const date of dateRange(fromDate, today)) {
    let calendar: CalendarDay;
    try {
      calendar = await atgFetch<CalendarDay>(`/calendar/day/${date}`);
    } catch {
      continue;
    }

    const track = calendar.tracks?.find((t) => t.id === trackId);
    if (!track?.races?.length) continue;

    for (const raceRef of track.races) {
      if (raceRef.status !== 'results') continue;
      try {
        const race = await atgFetch<StatsRace>(`/races/${raceRef.id}`);
        if (race.status !== 'results') continue;
        const startMethod = normalizeStartMethod(race.startMethod);
        if (!startMethod) continue;

        const fieldDistances =
          startMethod === 'volte'
            ? race.starts.map((s) => s.distance ?? null)
            : [];

        for (const start of race.starts) {
          const post = start.postPosition;
          if (post != null && post > 0) {
            const volteRow =
              startMethod === 'volte'
                ? volteRowFromDistance(startMethod, start.distance ?? null, fieldDistances)
                : null;
            const key = `${post}:${startMethod}:${trackPostVolteRowKey(volteRow)}`;
            const row = byPost.get(key) ?? { wins: 0, starts: 0 };
            row.starts++;
            if (extractWinPlace(start.result)) row.wins++;
            byPost.set(key, row);
          }

          const driverId = start.driver?.id;
          if (driverId) {
            addWinStart(byDriver, driverId, extractWinPlace(start.result));
          }
        }
      } catch {
        /* skip race */
      }
      await sleep(20);
    }
    await sleep(15);
  }

  return { byPost, byDriver };
}

function saveDriverTrackCache(
  db: Database.Database,
  trackId: number,
  byDriver: Map<number, DriverCounts>,
) {
  const del = db.prepare('DELETE FROM driver_track_win_stats WHERE track_id = ?');
  const ins = db.prepare(
    `INSERT INTO driver_track_win_stats (driver_id, track_id, starts, wins, win_percent, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  );
  db.transaction(() => {
    del.run(trackId);
    for (const [driverId, row] of byDriver) {
      ins.run(driverId, trackId, row.starts, row.wins, atgWinPercent(row.wins, row.starts));
    }
  })();
}

function saveTrackPostCache(
  db: Database.Database,
  trackId: number,
  byPost: Map<string, DriverCounts>,
) {
  const del = db.prepare('DELETE FROM track_post_win_stats WHERE track_id = ?');
  const ins = db.prepare(
    `INSERT INTO track_post_win_stats (track_id, post_position, start_method, volte_row, starts, wins, win_percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  db.transaction(() => {
    del.run(trackId);
    for (const [key, row] of byPost) {
      const [postStr, startMethod, volteRow = ''] = key.split(':');
      ins.run(
        trackId,
        Number(postStr),
        startMethod,
        volteRow,
        row.starts,
        row.wins,
        atgWinPercent(row.wins, row.starts),
      );
    }
  })();
}

export function tracksMissingPostStats(db: Database.Database): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT rs.atg_track_id as trackId
       FROM race_sessions rs
       WHERE rs.atg_track_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM track_post_win_stats t WHERE t.track_id = rs.atg_track_id
         )`,
    )
    .all() as Array<{ trackId: number }>;
  return rows.map((r) => r.trackId);
}

export function tracksMissingDriverTrackStats(db: Database.Database): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT rs.atg_track_id as trackId
       FROM race_sessions rs
       WHERE rs.atg_track_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM driver_track_win_stats d WHERE d.track_id = rs.atg_track_id
         )`,
    )
    .all() as Array<{ trackId: number }>;
  return rows.map((r) => r.trackId);
}

export async function ensureTrackPostStatsForTrack(
  db: Database.Database,
  trackId: number,
  force = false,
): Promise<void> {
  if (!force) {
    const postCached = db
      .prepare(
        `SELECT updated_at as updatedAt FROM track_post_win_stats WHERE track_id = ? LIMIT 1`,
      )
      .get(trackId) as { updatedAt: string } | undefined;
    const driverTrackCached = db
      .prepare(
        `SELECT updated_at as updatedAt FROM driver_track_win_stats WHERE track_id = ? LIMIT 1`,
      )
      .get(trackId) as { updatedAt: string } | undefined;
    const postFresh = postCached != null && isCacheFresh(postCached.updatedAt);
    const driverFresh = driverTrackCached != null && isCacheFresh(driverTrackCached.updatedAt);
    if (postFresh && driverFresh) return;
  }

  const { byPost, byDriver } = await computeTrackStatsFromAtg(trackId);
  saveTrackPostCache(db, trackId, byPost);
  saveDriverTrackCache(db, trackId, byDriver);
}

export async function runTrackPostStatsSync(
  db: Database.Database,
  trackIds?: number[],
): Promise<void> {
  const ids =
    trackIds ??
    (
      db
        .prepare(
          `SELECT DISTINCT atg_track_id as trackId FROM race_sessions WHERE atg_track_id IS NOT NULL`,
        )
        .all() as Array<{ trackId: number }>
    ).map((r) => r.trackId);

  for (const trackId of ids) {
    await ensureTrackPostStatsForTrack(db, trackId);
  }
}

export function backfillTrackPostWinPct(db: Database.Database): number {
  const sessions = db
    .prepare(
      `SELECT id, atg_track_id as atgTrackId, start_method as startMethod
       FROM race_sessions WHERE atg_track_id IS NOT NULL`,
    )
    .all() as Array<{ id: number; atgTrackId: number; startMethod: string | null }>;

  const update = db.prepare('UPDATE race_entries SET track_post_win_pct = ? WHERE id = ?');
  let updated = 0;

  for (const session of sessions) {
    const entries = db
      .prepare(
        `SELECT id, post_position as postPosition, volte_row as volteRow
         FROM race_entries WHERE session_id = ?`,
      )
      .all(session.id) as Array<{ id: number; postPosition: number | null; volteRow: string | null }>;

    for (const entry of entries) {
      const pct = getTrackPostWinPercentCached(
        session.atgTrackId,
        entry.postPosition,
        session.startMethod,
        db,
        entry.volteRow === 'front' || entry.volteRow === 'back' ? entry.volteRow : null,
      );
      update.run(pct, entry.id);
      updated++;
    }
  }

  return updated;
}

export function backfillDriverV85WinPct(db: Database.Database): {
  entriesUpdated: number;
  sessionIds: number[];
} {
  const entries = db
    .prepare(
      `SELECT re.id, re.session_id as sessionId, re.atg_driver_id as atgDriverId,
              re.driver_track_win_pct as currentTrackPct,
              re.driver_global_win_pct as currentGlobalPct,
              rs.atg_track_id as atgTrackId
       FROM race_entries re
       JOIN race_sessions rs ON rs.id = re.session_id
       WHERE re.atg_driver_id IS NOT NULL AND re.driver_v85_win_pct_override IS NULL`,
    )
    .all() as Array<{
    id: number;
    sessionId: number;
    atgDriverId: number;
    currentTrackPct: number | null;
    currentGlobalPct: number | null;
    atgTrackId: number | null;
  }>;

  const update = db.prepare(
    `UPDATE race_entries SET driver_track_win_pct = ?, driver_global_win_pct = ? WHERE id = ?`,
  );
  const affectedSessions = new Set<number>();
  let entriesUpdated = 0;

  for (const entry of entries) {
    const trackPct = getDriverTrackWinPercentCached(
      entry.atgDriverId,
      entry.atgTrackId,
      db,
    );
    const globalPct = getDriverGlobalWinPercentCached(entry.atgDriverId, db);
    if (trackPct === entry.currentTrackPct && globalPct === entry.currentGlobalPct) continue;
    update.run(trackPct, globalPct, entry.id);
    entriesUpdated++;
    affectedSessions.add(entry.sessionId);
  }

  return { entriesUpdated, sessionIds: [...affectedSessions] };
}

export function refreshSessionDriverV85WinPct(db: Database.Database, sessionId: number): boolean {
  const session = db
    .prepare('SELECT atg_track_id as atgTrackId FROM race_sessions WHERE id = ?')
    .get(sessionId) as { atgTrackId: number | null } | undefined;

  const entries = db
    .prepare(
      `SELECT id, atg_driver_id as atgDriverId,
              driver_track_win_pct as currentTrackPct,
              driver_global_win_pct as currentGlobalPct
       FROM race_entries
       WHERE session_id = ? AND atg_driver_id IS NOT NULL AND driver_v85_win_pct_override IS NULL`,
    )
    .all(sessionId) as Array<{
    id: number;
    atgDriverId: number;
    currentTrackPct: number | null;
    currentGlobalPct: number | null;
  }>;

  const update = db.prepare(
    `UPDATE race_entries SET driver_track_win_pct = ?, driver_global_win_pct = ? WHERE id = ?`,
  );
  let changed = false;

  for (const entry of entries) {
    const trackPct = getDriverTrackWinPercentCached(
      entry.atgDriverId,
      session?.atgTrackId ?? null,
      db,
    );
    const globalPct = getDriverGlobalWinPercentCached(entry.atgDriverId, db);
    if (trackPct === entry.currentTrackPct && globalPct === entry.currentGlobalPct) continue;
    update.run(trackPct, globalPct, entry.id);
    changed = true;
  }

  return changed;
}

export function backfillTrainerWinPct(db: Database.Database): {
  entriesUpdated: number;
  sessionIds: number[];
} {
  const entries = db
    .prepare(
      `SELECT re.id, re.session_id as sessionId, re.atg_trainer_id as atgTrainerId,
              re.trainer_win_pct as currentPct
       FROM race_entries re
       WHERE re.atg_trainer_id IS NOT NULL AND re.trainer_win_pct_override IS NULL`,
    )
    .all() as Array<{
    id: number;
    sessionId: number;
    atgTrainerId: number;
    currentPct: number | null;
  }>;

  const update = db.prepare('UPDATE race_entries SET trainer_win_pct = ? WHERE id = ?');
  const affectedSessions = new Set<number>();
  let entriesUpdated = 0;

  for (const entry of entries) {
    const pct = getTrainerWinPercentCached(entry.atgTrainerId, db);
    if (pct === entry.currentPct) continue;
    update.run(pct, entry.id);
    entriesUpdated++;
    affectedSessions.add(entry.sessionId);
  }

  return { entriesUpdated, sessionIds: [...affectedSessions] };
}

export function refreshSessionTrainerWinPct(db: Database.Database, sessionId: number): boolean {
  const entries = db
    .prepare(
      `SELECT id, atg_trainer_id as atgTrainerId, trainer_win_pct as currentPct
       FROM race_entries
       WHERE session_id = ? AND atg_trainer_id IS NOT NULL AND trainer_win_pct_override IS NULL`,
    )
    .all(sessionId) as Array<{ id: number; atgTrainerId: number; currentPct: number | null }>;

  const update = db.prepare('UPDATE race_entries SET trainer_win_pct = ? WHERE id = ?');
  let changed = false;

  for (const entry of entries) {
    const pct = getTrainerWinPercentCached(entry.atgTrainerId, db);
    if (pct === entry.currentPct) continue;
    update.run(pct, entry.id);
    changed = true;
  }

  return changed;
}

function recalculateSessions(db: Database.Database, sessionIds: number[]) {
  for (const sessionId of sessionIds) {
    recalculateSessionScores(db, sessionId);
  }
}

export function getDriverTrackWinPercentCached(
  driverId: number,
  trackId: number | null,
  db: Database.Database,
): number | null {
  if (trackId == null) return null;
  const trackRow = db
    .prepare(
      `SELECT win_percent as winPercent, starts
       FROM driver_track_win_stats
       WHERE driver_id = ? AND track_id = ?`,
    )
    .get(driverId, trackId) as { winPercent: number | null; starts: number } | undefined;
  if (!trackRow || trackRow.starts === 0 || trackRow.winPercent == null) return null;
  return trackRow.winPercent;
}

export function getDriverGlobalWinPercentCached(
  driverId: number,
  db: Database.Database,
): number | null {
  const globalRow = db
    .prepare(`SELECT win_percent as winPercent FROM driver_win_stats WHERE driver_id = ?`)
    .get(driverId) as { winPercent: number | null } | undefined;
  if (globalRow?.winPercent != null) return globalRow.winPercent;

  const legacyRow = db
    .prepare(`SELECT win_percent as winPercent FROM driver_v85_stats WHERE driver_id = ?`)
    .get(driverId) as { winPercent: number | null } | undefined;
  return legacyRow?.winPercent ?? null;
}

export function getDriverWinPercentCached(
  driverId: number,
  trackId: number | null,
  db: Database.Database,
): number | null {
  return (
    getDriverTrackWinPercentCached(driverId, trackId, db) ??
    getDriverGlobalWinPercentCached(driverId, db)
  );
}

/** @deprecated Use getDriverWinPercentCached with trackId */
export function getDriverV85WinPercentCached(
  driverId: number,
  db: Database.Database,
): number | null {
  return getDriverWinPercentCached(driverId, null, db);
}

export function getTrainerWinPercentCached(
  trainerId: number,
  db: Database.Database,
): number | null {
  const globalRow = db
    .prepare(`SELECT win_percent as winPercent FROM trainer_win_stats WHERE trainer_id = ?`)
    .get(trainerId) as { winPercent: number | null } | undefined;
  return globalRow?.winPercent ?? null;
}

export function getTrackPostWinPercentCached(
  trackId: number,
  postPosition: number | null,
  startMethod: string | null,
  db: Database.Database,
  volteRow?: 'front' | 'back' | null,
): number | null {
  if (postPosition == null || postPosition <= 0) return null;
  const method = normalizeStartMethod(startMethod);
  if (!method) return null;

  const rowKey = method === 'volte' ? trackPostVolteRowKey(volteRow) : '';

  const row = db
    .prepare(
      `SELECT win_percent as winPercent FROM track_post_win_stats
       WHERE track_id = ? AND post_position = ? AND start_method = ? AND volte_row = ?`,
    )
    .get(trackId, postPosition, method, rowKey) as { winPercent: number | null } | undefined;
  return row?.winPercent ?? null;
}

function setSyncMeta(db: Database.Database, key: string, value: string) {
  db.prepare(
    `INSERT INTO stats_sync_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value);
}

export function getStatsSyncStatus(db: Database.Database): {
  lastSyncAt: string | null;
  running: boolean;
} {
  const row = db
    .prepare(`SELECT value, updated_at as updatedAt FROM stats_sync_meta WHERE key = 'last_full_sync'`)
    .get() as { value: string; updatedAt: string } | undefined;
  const running = db
    .prepare(`SELECT value FROM stats_sync_meta WHERE key = 'sync_running'`)
    .get() as { value: string } | undefined;
  return {
    lastSyncAt: row?.updatedAt ?? null,
    running: running?.value === '1',
  };
}

let backgroundSyncPromise: Promise<void> | null = null;

export async function runFullStatsSync(db: Database.Database): Promise<void> {
  setSyncMeta(db, 'sync_running', '1');
  try {
    await Promise.all([refreshGlobalDriverCache(db), refreshGlobalTrainerCache(db)]);
    const driverBackfill = backfillDriverV85WinPct(db);
    const trainerBackfill = backfillTrainerWinPct(db);
    await runTrackPostStatsSync(db);
    backfillTrackPostWinPct(db);
    recalculateSessions(
      db,
      [...new Set([...driverBackfill.sessionIds, ...trainerBackfill.sessionIds])],
    );
    setSyncMeta(db, 'last_full_sync', new Date().toISOString());
  } finally {
    setSyncMeta(db, 'sync_running', '0');
  }
}

export function scheduleBackgroundStatsSync(db: Database.Database): void {
  const status = getStatsSyncStatus(db);
  if (status.running) return;

  const missingTracks = tracksMissingPostStats(db);
  const missingDriverTracks = tracksMissingDriverTrackStats(db);
  const globalDriverCount = (
    db.prepare('SELECT COUNT(*) as c FROM driver_win_stats').get() as { c: number }
  ).c;
  const globalTrainerCount = (
    db.prepare('SELECT COUNT(*) as c FROM trainer_win_stats').get() as { c: number }
  ).c;
  const needsGlobalDrivers = globalDriverCount === 0;
  const needsGlobalTrainers = globalTrainerCount === 0;
  const latest = db
    .prepare(`SELECT updated_at as updatedAt FROM stats_sync_meta WHERE key = 'last_full_sync'`)
    .get() as { updatedAt: string } | undefined;
  const fullSyncFresh = latest != null && isCacheFresh(latest.updatedAt);
  if (
    fullSyncFresh &&
    missingTracks.length === 0 &&
    missingDriverTracks.length === 0 &&
    !needsGlobalDrivers &&
    !needsGlobalTrainers &&
    !trainerLookbackChanged(db)
  ) {
    return;
  }

  if (!backgroundSyncPromise) {
    backgroundSyncPromise = (async () => {
      if (!fullSyncFresh) {
        await runFullStatsSync(db);
        return;
      }
      if (needsGlobalDrivers) {
        await refreshGlobalDriverCache(db);
      } else {
        await ensureGlobalDriverCache(db);
      }
      if (needsGlobalTrainers || trainerLookbackChanged(db)) {
        await refreshGlobalTrainerCache(db);
      } else {
        await ensureGlobalTrainerCache(db);
      }
      const tracksToSync = [...new Set([...missingTracks, ...missingDriverTracks])];
      const driverBackfill = backfillDriverV85WinPct(db);
      const trainerBackfill = backfillTrainerWinPct(db);
      if (tracksToSync.length > 0) {
        await runTrackPostStatsSync(db, tracksToSync);
      }
      backfillTrackPostWinPct(db);
      recalculateSessions(
        db,
        [...new Set([...driverBackfill.sessionIds, ...trainerBackfill.sessionIds])],
      );
    })()
      .catch((err) => console.error('Bakgrundssync misslyckades:', err))
      .finally(() => {
        backgroundSyncPromise = null;
      });
  }
}

export async function getDriverWinPercent(
  driverId: number,
  trackId: number | null,
  db: Database.Database,
): Promise<number | null> {
  await ensureGlobalDriverCache(db);
  if (trackId != null) {
    const cachedTrack = db
      .prepare(
        `SELECT updated_at as updatedAt FROM driver_track_win_stats
         WHERE track_id = ? LIMIT 1`,
      )
      .get(trackId) as { updatedAt: string } | undefined;
    if (!cachedTrack || !isCacheFresh(cachedTrack.updatedAt)) {
      await ensureTrackPostStatsForTrack(db, trackId);
    }
  }
  return getDriverWinPercentCached(driverId, trackId, db);
}

/** @deprecated Use getDriverWinPercent */
export async function getDriverV85WinPercent(
  driverId: number,
  db: Database.Database,
): Promise<number | null> {
  return getDriverWinPercent(driverId, null, db);
}

export async function getTrackPostWinPercent(
  trackId: number,
  postPosition: number | null,
  startMethod: string | null,
  db: Database.Database,
  volteRow?: 'front' | 'back' | null,
): Promise<number | null> {
  if (postPosition == null || postPosition <= 0) return null;
  const method = normalizeStartMethod(startMethod);
  if (!method) return null;

  const cachedTrack = db
    .prepare(
      `SELECT updated_at as updatedAt FROM track_post_win_stats
       WHERE track_id = ? LIMIT 1`,
    )
    .get(trackId) as { updatedAt: string } | undefined;

  if (!cachedTrack || !isCacheFresh(cachedTrack.updatedAt)) {
    const { byPost } = await computeTrackStatsFromAtg(trackId);
    saveTrackPostCache(db, trackId, byPost);
  }

  return getTrackPostWinPercentCached(trackId, postPosition, startMethod, db, volteRow);
}

export function prefetchImportStats(
  trackId: number,
  _driverIds: number[],
  db: Database.Database,
): void {
  scheduleBackgroundStatsSync(db);
  void ensureTrackPostStatsForTrack(db, trackId).then(async () => {
    backfillTrackPostWinPct(db);
    await ensureGlobalDriverCache(db);
    await ensureGlobalTrainerCache(db);
    const driverBackfill = backfillDriverV85WinPct(db);
    const trainerBackfill = backfillTrainerWinPct(db);
    recalculateSessions(
      db,
      [...new Set([...driverBackfill.sessionIds, ...trainerBackfill.sessionIds])],
    );
  });
}
