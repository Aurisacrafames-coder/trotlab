import type Database from 'better-sqlite3';
import { atgFetch, importFromUrl } from './atg.js';
import { ensureTrackPostStatsForTrack, getDriverV85WinPercentCached, getTrackPostWinPercentCached, prefetchImportStats } from './atgStats.js';
import { findOrCreateGameSession, linkRaceToGameSession } from './gameSessions.js';
import { recalculateSessionScores } from './sessionScores.js';

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

export async function discoverTrackLegsForRange(options: {
  trackId: number;
  trackSlug: string;
  fromDate: string;
  toDate?: string;
  gameTypes?: string[];
  onlyWithResults?: boolean;
}): Promise<LegImportTarget[]> {
  const {
    trackId,
    trackSlug,
    fromDate,
    toDate,
    gameTypes = DEFAULT_GAME_TYPES,
    onlyWithResults = true,
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

    for (const gameType of gameTypes) {
      const games = calendar.games?.[gameType] ?? calendar.games?.[gameType.toUpperCase()] ?? [];
      for (const game of games) {
        if (!game.id.includes(`_${trackId}_`)) continue;

        for (let leg = 1; leg <= game.races.length; leg++) {
          const raceId = game.races[leg - 1];
          if (!raceId || seenRaceIds.has(raceId)) continue;

          if (onlyWithResults) {
            try {
              const race = await atgFetch<{ status: string }>(`/races/${raceId}`);
              if (race.status !== 'results') continue;
            } catch {
              continue;
            }
            await sleep(15);
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

export async function persistImportedRace(
  db: Database.Database,
  sourceUrl: string,
): Promise<number> {
  const imported = await importFromUrl(sourceUrl.trim());

  prefetchImportStats(imported.atgTrackId, [], db);

  if (imported.atgTrackId != null) {
    await ensureTrackPostStatsForTrack(db, imported.atgTrackId);
  }

  for (const entry of imported.entries) {
    if (entry.atgDriverId != null) {
      entry.driverV85WinPct = getDriverV85WinPercentCached(entry.atgDriverId, db);
    }
    entry.trackPostWinPct = getTrackPostWinPercentCached(
      imported.atgTrackId,
      entry.postPosition,
      imported.startMethod,
      db,
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
    INSERT INTO race_entries (session_id, atg_horse_id, atg_driver_id, horse_name, start_number, post_position,
      start_distance, volte_row, driver_name, start_points, earnings_per_start, horse_sex, career_starts,
      driver_apprentice, driver_v85_win_pct, bet_distribution_pct, track_post_win_pct, actual_position)
    VALUES (@sessionId, @atgHorseId, @atgDriverId, @horseName, @startNumber, @postPosition,
      @startDistance, @volteRow, @driverName, @startPoints, @earningsPerStart, @horseSex, @careerStarts,
      @driverApprentice, @driverV85WinPct, @betDistributionPct, @trackPostWinPct, @actualPosition)
  `);

  const insertForm = db.prepare(`
    INSERT INTO form_starts (entry_id, form_order, date, distance, post_position, km_time, place, driver_name, prize_first, track_name)
    VALUES (@entryId, @formOrder, @date, @distance, @postPosition, @kmTime, @place, @driverName, @prizeFirst, @trackName)
  `);

  for (const e of imported.entries) {
    const entryResult = insertEntry.run({
      sessionId,
      atgHorseId: e.atgHorseId,
      atgDriverId: e.atgDriverId,
      horseName: e.horseName,
      startNumber: e.startNumber,
      postPosition: e.postPosition,
      startDistance: e.startDistance,
      volteRow: e.volteRow,
      driverName: e.driverName,
      startPoints: e.startPoints,
      earningsPerStart: e.earningsPerStart,
      horseSex: e.horseSex,
      careerStarts: e.careerStarts,
      driverApprentice: e.driverApprentice ? 1 : 0,
      driverV85WinPct: e.driverV85WinPct,
      betDistributionPct: e.betDistributionPct,
      trackPostWinPct: e.trackPostWinPct,
      actualPosition: e.actualPosition,
    });
    const entryId = Number(entryResult.lastInsertRowid);
    for (const f of e.formStarts) {
      insertForm.run({ entryId, ...f });
    }
  }

  recalculateSessionScores(db, sessionId);

  const gameSessionId = findOrCreateGameSession(db, {
    gameType: imported.gameType,
    date: imported.date,
    trackName: imported.trackName,
    atgTrackId: imported.atgTrackId,
  });
  linkRaceToGameSession(db, sessionId, gameSessionId);

  return sessionId;
}

export async function bulkImportTrackLegs(
  db: Database.Database,
  targets: LegImportTarget[],
  onProgress?: (done: number, total: number, target: LegImportTarget, error?: string) => void,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    try {
      const exists = db
        .prepare('SELECT id FROM race_sessions WHERE atg_race_id = ?')
        .get(target.raceId) as { id: number } | undefined;

      if (exists) {
        skipped++;
        onProgress?.(i + 1, targets.length, target);
        continue;
      }

      await persistImportedRace(db, target.url);
      imported++;
      onProgress?.(i + 1, targets.length, target);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${target.date} ${target.gameType} avd ${target.leg}: ${message}`);
      onProgress?.(i + 1, targets.length, target, message);
    }

    await sleep(250);
  }

  return { imported, skipped, errors };
}
