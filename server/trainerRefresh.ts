import type Database from 'better-sqlite3';
import { atgFetch, driverName } from './atg.js';
import {
  backfillTrainerWinPct,
  ensureGlobalTrainerCache,
  refreshSessionTrainerWinPct,
} from './atgStats.js';
import { recalculateSessionScores } from './sessionScores.js';

interface AtgRaceTrainers {
  starts: Array<{
    number: number;
    scratched?: boolean;
    horse: {
      trainer?: {
        id: number;
        firstName: string;
        lastName: string;
        shortName?: string;
      };
    };
  }>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sessionNeedsTrainerBackfill(db: Database.Database, sessionId: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 as ok FROM race_entries
       WHERE session_id = ? AND atg_trainer_id IS NULL
       LIMIT 1`,
    )
    .get(sessionId) as { ok: number } | undefined;
  return row != null;
}

export async function refreshSessionTrainersFromAtg(
  db: Database.Database,
  sessionId: number,
): Promise<boolean> {
  const session = db
    .prepare(`SELECT atg_race_id as atgRaceId FROM race_sessions WHERE id = ?`)
    .get(sessionId) as { atgRaceId: string | null } | undefined;

  if (!session?.atgRaceId) return false;

  const race = await atgFetch<AtgRaceTrainers>(`/races/${session.atgRaceId}`);
  const update = db.prepare(
    `UPDATE race_entries
     SET atg_trainer_id = ?, trainer_name = ?
     WHERE session_id = ? AND start_number = ?`,
  );

  let changed = false;
  for (const start of race.starts) {
    if (start.scratched) continue;
    const trainerId = start.horse?.trainer?.id ?? null;
    const trainerName = driverName(start.horse?.trainer);
    update.run(trainerId, trainerName, sessionId, start.number);
    changed = true;
  }

  return changed;
}

export async function refreshSessionTrainerData(
  db: Database.Database,
  sessionId: number,
): Promise<void> {
  if (sessionNeedsTrainerBackfill(db, sessionId)) {
    await refreshSessionTrainersFromAtg(db, sessionId);
  }
  if (refreshSessionTrainerWinPct(db, sessionId)) {
    recalculateSessionScores(db, sessionId);
  }
}

export async function backfillAllSessionTrainers(db: Database.Database): Promise<{
  sessionsUpdated: number;
  entriesBackfilled: number;
}> {
  const sessions = db
    .prepare(
      `SELECT DISTINCT rs.id
       FROM race_sessions rs
       JOIN race_entries re ON re.session_id = rs.id
       WHERE re.atg_trainer_id IS NULL AND rs.atg_race_id IS NOT NULL
       ORDER BY rs.id`,
    )
    .all() as Array<{ id: number }>;

  let sessionsUpdated = 0;
  for (const session of sessions) {
    try {
      if (await refreshSessionTrainersFromAtg(db, session.id)) {
        sessionsUpdated++;
      }
    } catch (err) {
      console.error(`Tränare-backfill misslyckades för lopp ${session.id}:`, err);
    }
    await sleep(40);
  }

  await ensureGlobalTrainerCache(db);
  const { entriesUpdated } = backfillTrainerWinPct(db);

  return { sessionsUpdated, entriesBackfilled: entriesUpdated };
}

export function startTrainerBackfillJob(getDb: () => Database.Database) {
  void (async () => {
    const db = getDb();
    const needs = db
      .prepare(
        `SELECT 1 as ok FROM race_entries WHERE atg_trainer_id IS NULL LIMIT 1`,
      )
      .get() as { ok: number } | undefined;
    if (!needs) return;

    console.log('Backfill: hämtar tränare för importerade lopp…');
    try {
      const result = await backfillAllSessionTrainers(db);
      console.log(
        `Backfill klar: ${result.sessionsUpdated} lopp, ${result.entriesBackfilled} tränare % uppdaterade`,
      );
    } catch (err) {
      console.error('Tränare-backfill misslyckades:', err);
    }
  })();
}
