import type Database from 'better-sqlite3';
import { fetchRaceMetadata } from './atg.js';

export async function refreshGameSessionRaceInfo(
  db: Database.Database,
  gameSessionId: number,
): Promise<number> {
  const races = db
    .prepare(
      `SELECT id, atg_race_id as atgRaceId, race_name as raceName
       FROM race_sessions WHERE game_session_id = ? ORDER BY leg_number`,
    )
    .all(gameSessionId) as Array<{ id: number; atgRaceId: string; raceName: string | null }>;

  const update = db.prepare(`
    UPDATE race_sessions
    SET race_name = @raceName, race_prize = @racePrize, race_terms = @raceTerms,
        scheduled_start_time = @scheduledStartTime, distance = @distance,
        start_method = @startMethod, status = @status
    WHERE id = @id
  `);

  let updated = 0;

  for (const race of races) {
    if (race.raceName) continue;

    try {
      const meta = await fetchRaceMetadata(race.atgRaceId);
      update.run({
        id: race.id,
        raceName: meta.raceName,
        racePrize: meta.racePrize,
        raceTerms: JSON.stringify(meta.raceTerms),
        scheduledStartTime: meta.scheduledStartTime,
        distance: meta.distance,
        startMethod: meta.startMethod,
        status: meta.status,
      });
      updated++;
      await new Promise((r) => setTimeout(r, 80));
    } catch (err) {
      console.error(`Kunde inte hämta loppinfo för ${race.atgRaceId}:`, err);
    }
  }

  return updated;
}

export async function refreshAllGameSessionRaceInfo(
  db: Database.Database,
  gameSessionId: number,
): Promise<number> {
  const races = db
    .prepare(
      `SELECT id, atg_race_id as atgRaceId
       FROM race_sessions WHERE game_session_id = ? ORDER BY leg_number`,
    )
    .all(gameSessionId) as Array<{ id: number; atgRaceId: string }>;

  const update = db.prepare(`
    UPDATE race_sessions
    SET race_name = @raceName, race_prize = @racePrize, race_terms = @raceTerms,
        scheduled_start_time = @scheduledStartTime, distance = @distance,
        start_method = @startMethod, status = @status
    WHERE id = @id
  `);

  let updated = 0;

  for (const race of races) {
    try {
      const meta = await fetchRaceMetadata(race.atgRaceId);
      update.run({
        id: race.id,
        raceName: meta.raceName,
        racePrize: meta.racePrize,
        raceTerms: JSON.stringify(meta.raceTerms),
        scheduledStartTime: meta.scheduledStartTime,
        distance: meta.distance,
        startMethod: meta.startMethod,
        status: meta.status,
      });
      updated++;
      await new Promise((r) => setTimeout(r, 80));
    } catch (err) {
      console.error(`Kunde inte hämta loppinfo för ${race.atgRaceId}:`, err);
    }
  }

  return updated;
}
