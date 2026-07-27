import type Database from 'better-sqlite3';
import { atgFetch } from './atg.js';
import { normalizeStartMethod } from '../shared/scoring.js';

const V85_START_DATE = '2025-10-25';
const TRACK_LOOKBACK_DAYS = 365;
const STATS_CACHE_HOURS = 24;

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
    driver?: { id: number };
    result?: { place?: number; finishOrder?: number };
  }>;
}

interface StatsGame {
  races: Array<StatsRace & { status?: string }>;
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

let driverV85RefreshPromise: Promise<void> | null = null;

async function refreshDriverV85Cache(db: Database.Database): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const byDriver = new Map<number, { wins: number; starts: number }>();

  for (const date of dateRange(V85_START_DATE, today)) {
    let calendar: CalendarDay;
    try {
      calendar = await atgFetch<CalendarDay>(`/calendar/day/${date}`);
    } catch {
      continue;
    }

    const v85Games = calendar.games?.V85 ?? calendar.games?.v85 ?? [];
    if (v85Games.length === 0) continue;

    for (const game of v85Games) {
      try {
        const gameData = await atgFetch<StatsGame>(`/games/${game.id}`);
        for (const race of gameData.races) {
          if (race.status !== 'results') continue;
          for (const start of race.starts) {
            const driverId = start.driver?.id;
            if (!driverId) continue;
            const row = byDriver.get(driverId) ?? { wins: 0, starts: 0 };
            row.starts++;
            if (extractWinPlace(start.result)) row.wins++;
            byDriver.set(driverId, row);
          }
        }
      } catch {
        /* skip game */
      }
      await sleep(30);
    }
    await sleep(20);
  }

  const upsert = db.prepare(
    `INSERT INTO driver_v85_stats (driver_id, starts, wins, win_percent, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(driver_id) DO UPDATE SET
       starts = excluded.starts, wins = excluded.wins,
       win_percent = excluded.win_percent, updated_at = excluded.updated_at`,
  );

  db.transaction(() => {
    for (const [driverId, row] of byDriver) {
      upsert.run(driverId, row.starts, row.wins, atgWinPercent(row.wins, row.starts));
    }
  })();
}

async function ensureDriverV85Cache(db: Database.Database): Promise<void> {
  const latest = db
    .prepare(`SELECT updated_at as updatedAt FROM driver_v85_stats ORDER BY updated_at DESC LIMIT 1`)
    .get() as { updatedAt: string } | undefined;

  if (latest && isCacheFresh(latest.updatedAt)) return;

  if (!driverV85RefreshPromise) {
    driverV85RefreshPromise = refreshDriverV85Cache(db).finally(() => {
      driverV85RefreshPromise = null;
    });
  }
  await driverV85RefreshPromise;
}

async function computeTrackPostStatsFromAtg(
  trackId: number,
): Promise<Map<string, { wins: number; starts: number }>> {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - TRACK_LOOKBACK_DAYS);
  const fromDate = start.toISOString().slice(0, 10);

  const byPost = new Map<string, { wins: number; starts: number }>();

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

        for (const start of race.starts) {
          const post = start.postPosition;
          if (post == null || post <= 0) continue;
          const key = `${post}:${startMethod}`;
          const row = byPost.get(key) ?? { wins: 0, starts: 0 };
          row.starts++;
          if (extractWinPlace(start.result)) row.wins++;
          byPost.set(key, row);
        }
      } catch {
        /* skip race */
      }
      await sleep(20);
    }
    await sleep(15);
  }

  return byPost;
}

function saveTrackPostCache(
  db: Database.Database,
  trackId: number,
  byPost: Map<string, { wins: number; starts: number }>,
) {
  const del = db.prepare('DELETE FROM track_post_win_stats WHERE track_id = ?');
  const ins = db.prepare(
    `INSERT INTO track_post_win_stats (track_id, post_position, start_method, starts, wins, win_percent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  db.transaction(() => {
    del.run(trackId);
    for (const [key, row] of byPost) {
      const [postStr, startMethod] = key.split(':');
      ins.run(
        trackId,
        Number(postStr),
        startMethod,
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

export async function ensureTrackPostStatsForTrack(
  db: Database.Database,
  trackId: number,
  force = false,
): Promise<void> {
  if (!force) {
    const cached = db
      .prepare(
        `SELECT updated_at as updatedAt FROM track_post_win_stats WHERE track_id = ? LIMIT 1`,
      )
      .get(trackId) as { updatedAt: string } | undefined;
    if (cached && isCacheFresh(cached.updatedAt)) return;
  }

  const byPost = await computeTrackPostStatsFromAtg(trackId);
  saveTrackPostCache(db, trackId, byPost);
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
        `SELECT id, post_position as postPosition FROM race_entries WHERE session_id = ?`,
      )
      .all(session.id) as Array<{ id: number; postPosition: number | null }>;

    for (const entry of entries) {
      const pct = getTrackPostWinPercentCached(
        session.atgTrackId,
        entry.postPosition,
        session.startMethod,
        db,
      );
      update.run(pct, entry.id);
      updated++;
    }
  }

  return updated;
}

export function getDriverV85WinPercentCached(
  driverId: number,
  db: Database.Database,
): number | null {
  const row = db
    .prepare(`SELECT win_percent as winPercent FROM driver_v85_stats WHERE driver_id = ?`)
    .get(driverId) as { winPercent: number | null } | undefined;
  return row?.winPercent ?? null;
}

export function getTrackPostWinPercentCached(
  trackId: number,
  postPosition: number | null,
  startMethod: string | null,
  db: Database.Database,
): number | null {
  if (postPosition == null || postPosition <= 0) return null;
  const method = normalizeStartMethod(startMethod);
  if (!method) return null;

  const row = db
    .prepare(
      `SELECT win_percent as winPercent FROM track_post_win_stats
       WHERE track_id = ? AND post_position = ? AND start_method = ?`,
    )
    .get(trackId, postPosition, method) as { winPercent: number | null } | undefined;
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
    await refreshDriverV85Cache(db);
    await runTrackPostStatsSync(db);
    backfillTrackPostWinPct(db);
    setSyncMeta(db, 'last_full_sync', new Date().toISOString());
  } finally {
    setSyncMeta(db, 'sync_running', '0');
  }
}

export function scheduleBackgroundStatsSync(db: Database.Database): void {
  const status = getStatsSyncStatus(db);
  if (status.running) return;

  const missingTracks = tracksMissingPostStats(db);
  const latest = db
    .prepare(`SELECT updated_at as updatedAt FROM stats_sync_meta WHERE key = 'last_full_sync'`)
    .get() as { updatedAt: string } | undefined;
  const fullSyncFresh = latest != null && isCacheFresh(latest.updatedAt);
  if (fullSyncFresh && missingTracks.length === 0) return;

  if (!backgroundSyncPromise) {
    backgroundSyncPromise = (async () => {
      if (!fullSyncFresh) {
        await runFullStatsSync(db);
        return;
      }
      await runTrackPostStatsSync(db, missingTracks);
      backfillTrackPostWinPct(db);
    })()
      .catch((err) => console.error('Bakgrundssync misslyckades:', err))
      .finally(() => {
        backgroundSyncPromise = null;
      });
  }
}

export async function getDriverV85WinPercent(
  driverId: number,
  db: Database.Database,
): Promise<number | null> {
  await ensureDriverV85Cache(db);

  const row = db
    .prepare(`SELECT win_percent as winPercent FROM driver_v85_stats WHERE driver_id = ?`)
    .get(driverId) as { winPercent: number | null } | undefined;

  return row?.winPercent ?? null;
}

export async function getTrackPostWinPercent(
  trackId: number,
  postPosition: number | null,
  startMethod: string | null,
  db: Database.Database,
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
    const byPost = await computeTrackPostStatsFromAtg(trackId);
    saveTrackPostCache(db, trackId, byPost);
  }

  const row = db
    .prepare(
      `SELECT win_percent as winPercent FROM track_post_win_stats
       WHERE track_id = ? AND post_position = ? AND start_method = ?`,
    )
    .get(trackId, postPosition, method) as { winPercent: number | null } | undefined;

  return row?.winPercent ?? null;
}

export function prefetchImportStats(
  trackId: number,
  _driverIds: number[],
  db: Database.Database,
): void {
  scheduleBackgroundStatsSync(db);
  void ensureTrackPostStatsForTrack(db, trackId).then(() => {
    backfillTrackPostWinPct(db);
  });
}
