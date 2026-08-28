import type Database from 'better-sqlite3';
import { atgFetch, importFromUrl, parseAtgUrl, resolveCalendarGameFromUrl, resolveRaceId, TRACK_SLUGS } from './atg.js';
import {
  beginImportProgress,
  clearImportProgress,
  finishImportProgress,
  updateImportProgress,
} from './importProgress.js';
import { ensureGlobalTrainerCache, ensureTrackPostStatsForTrack, getDriverGlobalWinPercentCached, getDriverTrackWinPercentCached, getTrainerWinPercentCached, getTrackPostWinPercentCached, prefetchImportStats } from './atgStats.js';
import { findOrCreateGameSession, linkRaceToGameSession } from './gameSessions.js';
import { recalculateSessionScores } from './sessionScores.js';
import { invalidateTrackStatsCache } from './trackStats.js';

export interface LegImportTarget {
  url: string;
  date: string;
  gameType: string;
  leg: number;
  raceId: string;
}

const DEFAULT_GAME_TYPES = ['GS75', 'V86', 'V85', 'V75', 'V64', 'V65', 'V5', 'V4', 'V3'];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function* dateRange(from: string, to: string): Generator<string> {
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function loadRaceStatusFromCalendar(
  calendar: { tracks?: Array<{ id: number; races?: Array<{ id: string; status?: string }> }> },
  trackId: number,
): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  const track = calendar.tracks?.find((t) => t.id === trackId);
  for (const race of track?.races ?? []) {
    map.set(race.id, race.status);
  }
  return map;
}

export function loadImportedRaceIds(
  db: Database.Database,
  trackId: number,
  fromDate: string,
  toDate: string,
): Set<string> {
  const rows = db
    .prepare(
      `SELECT atg_race_id AS id FROM race_sessions
       WHERE atg_track_id = ? AND date >= ? AND date <= ?`,
    )
    .all(trackId, fromDate, toDate) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/** When history is already loaded, only scan recent dates for new races. */
export function resolveDiscoveryFromDate(
  db: Database.Database,
  trackId: number,
  fromDate: string,
  alreadyImported: Set<string>,
): string {
  if (alreadyImported.size === 0) return fromDate;

  const row = db
    .prepare(
      `SELECT MIN(date) AS minDate FROM race_sessions
       WHERE atg_track_id = ? AND date >= ? AND status = 'results'`,
    )
    .get(trackId, fromDate) as { minDate: string | null } | undefined;

  if (!row?.minDate) return fromDate;

  const minImported = new Date(`${row.minDate}T12:00:00`);
  const rangeStart = new Date(`${fromDate}T12:00:00`);
  const daysFromStart = (minImported.getTime() - rangeStart.getTime()) / 86_400_000;

  if (daysFromStart <= 45) {
    const recentFrom = dateMonthsAgo(1);
    return recentFrom > fromDate ? recentFrom : fromDate;
  }

  return fromDate;
}

export async function discoverTrackLegsForRange(options: {
  trackId: number;
  trackSlug: string;
  fromDate: string;
  toDate?: string;
  gameTypes?: string[];
  onlyWithResults?: boolean;
  skipRaceIds?: Set<string>;
}): Promise<LegImportTarget[]> {
  const {
    trackId,
    trackSlug,
    fromDate,
    toDate,
    gameTypes = DEFAULT_GAME_TYPES,
    onlyWithResults = true,
    skipRaceIds,
  } = options;

  const today = new Date().toISOString().slice(0, 10);
  const rangeEnd = (toDate ?? today) < today ? (toDate ?? today) : today;
  const targets: LegImportTarget[] = [];
  const seenRaceIds = new Set<string>();

  for (const date of dateRange(fromDate, rangeEnd)) {
    let calendar: {
      games?: Record<string, Array<{ id: string; races: string[] }>>;
    };
    try {
      calendar = await atgFetch(`/calendar/day/${date}`);
    } catch {
      continue;
    }

    const raceStatusById = loadRaceStatusFromCalendar(calendar, trackId);

    for (const gameType of gameTypes) {
      const games = calendar.games?.[gameType] ?? calendar.games?.[gameType.toUpperCase()] ?? [];
      for (const game of games) {
        if (!game.id.includes(`_${trackId}_`)) continue;

        for (let leg = 1; leg <= game.races.length; leg++) {
          const raceId = game.races[leg - 1];
          if (!raceId || seenRaceIds.has(raceId)) continue;
          if (skipRaceIds?.has(raceId)) continue;

          if (onlyWithResults) {
            let status = raceStatusById.get(raceId);
            if (status == null) {
              try {
                const race = await atgFetch<{ status: string }>(`/races/${raceId}`);
                status = race.status;
              } catch {
                continue;
              }
              await sleep(15);
            }
            if (status !== 'results') continue;
          }

          seenRaceIds.add(raceId);
          targets.push({
            url: `https://www.atg.se/spel/${date}/${gameType}/${trackSlug}/avd/${leg}`,
            date,
            gameType,
            leg,
            raceId,
          });
        }
      }
    }

    await sleep(10);
  }

  return targets.sort((a, b) =>
    a.date.localeCompare(b.date) || a.gameType.localeCompare(b.gameType) || a.leg - b.leg,
  );
}

export async function discoverTrackLegsForYear(options: {
  trackId: number;
  trackSlug: string;
  year: number;
  endDate?: string;
  gameTypes?: string[];
  onlyWithResults?: boolean;
}): Promise<LegImportTarget[]> {
  const { year, endDate, ...rest } = options;
  const today = new Date().toISOString().slice(0, 10);
  const rangeEnd = endDate && endDate < today ? endDate : today;
  return discoverTrackLegsForRange({
    ...rest,
    fromDate: `${year}-01-01`,
    toDate: rangeEnd,
  });
}

export function dateMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function isGameDivisionUrl(url: string): boolean {
  const parsed = parseAtgUrl(url);
  return parsed != null && parsed.gameType !== 'VINNARE' && parsed.gameType !== 'UNKNOWN';
}

export async function discoverGameLegsFromUrl(sourceUrl: string): Promise<LegImportTarget[]> {
  const { parsed, venue, game } = await resolveCalendarGameFromUrl(sourceUrl);

  return game.races.map((raceId, index) => ({
    url: `https://www.atg.se/spel/${parsed.date}/${parsed.gameType}/${venue.venueSlug}/avd/${index + 1}`,
    date: parsed.date,
    gameType: parsed.gameType,
    leg: index + 1,
    raceId,
  }));
}

export async function importAllGameLegsFromUrl(
  db: Database.Database,
  sourceUrl: string,
): Promise<{ gameSessionId: number; imported: number; total: number; errors: string[] }> {
  const { parsed, venue, game } = await resolveCalendarGameFromUrl(sourceUrl);
  const targets = game.races.map((raceId, index) => ({
    url: `https://www.atg.se/spel/${parsed.date}/${parsed.gameType}/${venue.venueSlug}/avd/${index + 1}`,
    date: parsed.date,
    gameType: parsed.gameType,
    leg: index + 1,
    raceId,
  }));

  beginImportProgress(targets.length, `Importerar ${parsed.gameType} ${venue.displayName}`);

  const gameSessionId = findOrCreateGameSession(db, {
    gameType: parsed.gameType,
    date: parsed.date,
    trackName: venue.displayName,
    atgTrackId: venue.isMultiTrack ? null : venue.trackIds[0] ?? null,
    venueSlug: venue.venueSlug,
    atgGameId: game.id,
  });

  let imported = 0;
  const errors: string[] = [];
  const warmedTrackIds = new Set<number>();

  try {
    for (const target of targets) {
      updateImportProgress({
        currentLeg: target.leg,
        importedLegs: imported,
        phase: `Avd ${target.leg} av ${targets.length} — hämtar hästar från ATG`,
      });

      try {
        await persistImportedRace(db, target.url, { gameSessionId, skipStatsWarmup: true });
        imported++;
        updateImportProgress({ importedLegs: imported });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Avd ${target.leg}: ${message}`);
      }
    }

    if (imported === 0) {
      throw new Error(
        errors.length > 0
          ? errors.join('; ')
          : 'Importen misslyckades — inga avdelningar kunde importeras.',
      );
    }

    const trackIds = db
      .prepare(
        `SELECT DISTINCT atg_track_id as atgTrackId
         FROM race_sessions WHERE game_session_id = ? AND atg_track_id IS NOT NULL`,
      )
      .all(gameSessionId) as Array<{ atgTrackId: number }>;
    for (const row of trackIds) {
      if (!warmedTrackIds.has(row.atgTrackId)) {
        warmedTrackIds.add(row.atgTrackId);
        prefetchImportStats(row.atgTrackId, [], db);
      }
    }

    finishImportProgress(imported);
    return { gameSessionId, imported, total: targets.length, errors };
  } finally {
    setTimeout(() => clearImportProgress(), 8000);
  }
}

export async function persistImportedRace(
  db: Database.Database,
  sourceUrl: string,
  options?: { skipStatsWarmup?: boolean; gameSessionId?: number },
): Promise<number> {
  const imported = await importFromUrl(sourceUrl.trim(), {
    startFetchConcurrency: options?.skipStatsWarmup ? 6 : 5,
  });

  if (!options?.skipStatsWarmup) {
    prefetchImportStats(imported.atgTrackId, [], db);
  }

  if (!options?.skipStatsWarmup) {
    if (imported.atgTrackId != null) {
      const hasDriverTrack = db
        .prepare('SELECT 1 as ok FROM driver_track_win_stats WHERE track_id = ? LIMIT 1')
        .get(imported.atgTrackId) as { ok: number } | undefined;
      await ensureTrackPostStatsForTrack(db, imported.atgTrackId, !hasDriverTrack);
    }

    await ensureGlobalTrainerCache(db);
  }

  for (const entry of imported.entries) {
    if (entry.atgDriverId != null) {
      entry.driverTrackWinPct = getDriverTrackWinPercentCached(
        entry.atgDriverId,
        imported.atgTrackId,
        db,
      );
      entry.driverGlobalWinPct = getDriverGlobalWinPercentCached(entry.atgDriverId, db);
    }
    if (entry.atgTrainerId != null) {
      entry.trainerWinPct = getTrainerWinPercentCached(entry.atgTrainerId, db);
    }
    entry.trackPostWinPct = getTrackPostWinPercentCached(
      imported.atgTrackId,
      entry.postPosition,
      imported.startMethod,
      db,
      entry.volteRow,
    );
  }

  const existing = db
    .prepare('SELECT id FROM race_sessions WHERE atg_race_id = ?')
    .get(imported.atgRaceId) as { id: number } | undefined;

  if (existing) {
    db.prepare('DELETE FROM race_sessions WHERE id = ?').run(existing.id);
  }

  const insertSession = db.prepare(`
    INSERT INTO race_sessions (atg_race_id, atg_track_id, game_type, leg_number, track_race_number, date, track_name, distance, start_method, source_url, status, race_name, race_prize, race_terms, scheduled_start_time)
    VALUES (@atgRaceId, @atgTrackId, @gameType, @legNumber, @trackRaceNumber, @date, @trackName, @distance, @startMethod, @sourceUrl, @status, @raceName, @racePrize, @raceTerms, @scheduledStartTime)
  `);

  const sessionResult = insertSession.run({
    atgRaceId: imported.atgRaceId,
    atgTrackId: imported.atgTrackId,
    gameType: imported.gameType,
    legNumber: imported.legNumber,
    trackRaceNumber: imported.trackRaceNumber,
    date: imported.date,
    trackName: imported.trackName,
    distance: imported.distance,
    startMethod: imported.startMethod,
    sourceUrl: sourceUrl.trim(),
    status: imported.status,
    raceName: imported.raceName,
    racePrize: imported.racePrize,
    raceTerms: JSON.stringify(imported.raceTerms),
    scheduledStartTime: imported.scheduledStartTime,
  });

  const sessionId = Number(sessionResult.lastInsertRowid);

  const insertEntry = db.prepare(`
    INSERT INTO race_entries (session_id, atg_horse_id, atg_driver_id, atg_trainer_id, horse_name, start_number, post_position,
      start_distance, volte_row, driver_name, trainer_name, start_points, earnings_per_start, horse_sex, career_starts,
      driver_apprentice, driver_track_win_pct, driver_global_win_pct, trainer_win_pct, bet_distribution_pct, track_post_win_pct, actual_position, scratched)
    VALUES (@sessionId, @atgHorseId, @atgDriverId, @atgTrainerId, @horseName, @startNumber, @postPosition,
      @startDistance, @volteRow, @driverName, @trainerName, @startPoints, @earningsPerStart, @horseSex, @careerStarts,
      @driverApprentice, @driverTrackWinPct, @driverGlobalWinPct, @trainerWinPct, @betDistributionPct, @trackPostWinPct, @actualPosition, @scratched)
  `);

  const insertForm = db.prepare(`
    INSERT INTO form_starts (entry_id, form_order, date, distance, post_position, km_time, place, driver_name, prize_first, track_name, is_record_time)
    VALUES (@entryId, @formOrder, @date, @distance, @postPosition, @kmTime, @place, @driverName, @prizeFirst, @trackName, @isRecordTime)
  `);

  for (const e of imported.entries) {
    const entryResult = insertEntry.run({
      sessionId,
      atgHorseId: e.atgHorseId,
      atgDriverId: e.atgDriverId,
      atgTrainerId: e.atgTrainerId,
      horseName: e.horseName,
      startNumber: e.startNumber,
      postPosition: e.postPosition,
      startDistance: e.startDistance,
      volteRow: e.volteRow,
      driverName: e.driverName,
      trainerName: e.trainerName,
      startPoints: e.startPoints,
      earningsPerStart: e.earningsPerStart,
      horseSex: e.horseSex,
      careerStarts: e.careerStarts,
      driverApprentice: e.driverApprentice ? 1 : 0,
      driverTrackWinPct: e.driverTrackWinPct,
      driverGlobalWinPct: e.driverGlobalWinPct,
      trainerWinPct: e.trainerWinPct,
      betDistributionPct: e.betDistributionPct,
      trackPostWinPct: e.trackPostWinPct,
      actualPosition: e.actualPosition,
      scratched: e.scratched ? 1 : 0,
    });
    const entryId = Number(entryResult.lastInsertRowid);
    for (const f of e.formStarts) {
      insertForm.run({
        entryId,
        ...f,
        isRecordTime: f.isRecordTime ? 1 : 0,
      });
    }
  }

  recalculateSessionScores(db, sessionId);

  if (options?.gameSessionId != null) {
    linkRaceToGameSession(db, sessionId, options.gameSessionId);
  } else {
    const parsed = parseAtgUrl(sourceUrl.trim());
    let venueSlug: string | null = null;
    let atgGameId: string | null = null;
    let trackName = imported.trackName;
    let atgTrackId: number | null = imported.atgTrackId;

    if (parsed && parsed.gameType !== 'VINNARE' && parsed.gameType !== 'UNKNOWN') {
      try {
        const resolved = await resolveCalendarGameFromUrl(sourceUrl);
        venueSlug = resolved.venue.venueSlug;
        atgGameId = resolved.game.id;
        trackName = resolved.venue.displayName;
        atgTrackId = resolved.venue.isMultiTrack ? null : resolved.venue.trackIds[0] ?? null;
      } catch {
        // Enstaka avdelning utan hel omgång i kalendern — fall back till loppets bana.
      }
    }

    const gameSessionId = findOrCreateGameSession(db, {
      gameType: imported.gameType,
      date: imported.date,
      trackName,
      atgTrackId,
      venueSlug,
      atgGameId,
    });
    linkRaceToGameSession(db, sessionId, gameSessionId);
  }

  invalidateTrackStatsCache();
  return sessionId;
}

export async function bulkImportTrackLegs(
  db: Database.Database,
  targets: LegImportTarget[],
  onProgress?: (
    done: number,
    total: number,
    target: LegImportTarget,
    stats: { imported: number; skipped: number },
    error?: string,
  ) => void,
  options?: { atgTrackId?: number },
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (options?.atgTrackId != null) {
    const hasDriverTrack = db
      .prepare('SELECT 1 as ok FROM driver_track_win_stats WHERE track_id = ? LIMIT 1')
      .get(options.atgTrackId) as { ok: number } | undefined;
    await ensureTrackPostStatsForTrack(db, options.atgTrackId, !hasDriverTrack);
    await ensureGlobalTrainerCache(db);
  }

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    try {
      const exists = db
        .prepare('SELECT id FROM race_sessions WHERE atg_race_id = ?')
        .get(target.raceId) as { id: number } | undefined;

      if (exists) {
        skipped++;
        onProgress?.(i + 1, targets.length, target, { imported, skipped });
        continue;
      }

      await persistImportedRace(db, target.url, { skipStatsWarmup: true });
      imported++;
      onProgress?.(i + 1, targets.length, target, { imported, skipped });
      await sleep(250);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${target.date} ${target.gameType} avd ${target.leg}: ${message}`);
      onProgress?.(i + 1, targets.length, target, { imported, skipped }, message);
      await sleep(250);
    }

    if ((i + 1) % 5 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return { imported, skipped, errors };
}
