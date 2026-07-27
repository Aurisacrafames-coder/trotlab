import type Database from 'better-sqlite3';
import { atgFetch, normalizeEarningsPerStartFromAtg } from '../atg.js';
import { recalculateSessionScores } from '../sessionScores.js';

const META_KEY = 'earnings_per_start_v2';

interface AtgRaceStarts {
  starts: Array<{
    number: number;
    horse: { statistics?: { life?: { earningsPerStart?: number } } };
  }>;
}

function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM stats_sync_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setMeta(db: Database.Database, key: string, value: string) {
  db.prepare(
    `INSERT INTO stats_sync_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value);
}

let refreshPromise: Promise<void> | null = null;

async function refreshAllEarningsPerStart(db: Database.Database) {
  if (getMeta(db, META_KEY)) return;

  const sessions = db
    .prepare(`SELECT id, atg_race_id as atgRaceId FROM race_sessions ORDER BY id`)
    .all() as Array<{ id: number; atgRaceId: string }>;

  const update = db.prepare(
    `UPDATE race_entries SET earnings_per_start = ? WHERE session_id = ? AND start_number = ?`,
  );

  for (const session of sessions) {
    try {
      const race = await atgFetch<AtgRaceStarts>(`/races/${session.atgRaceId}`);
      db.transaction(() => {
        for (const start of race.starts) {
          const earningsPerStart = normalizeEarningsPerStartFromAtg(
            start.horse.statistics?.life?.earningsPerStart,
          );
          if (earningsPerStart != null) {
            update.run(earningsPerStart, session.id, start.number);
          }
        }
      })();
      recalculateSessionScores(db, session.id);
    } catch (err) {
      console.error(`Kunde inte uppdatera kr/start för lopp ${session.atgRaceId}:`, err);
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  setMeta(db, META_KEY, new Date().toISOString());
  console.log('Kr/start uppdaterat från ATG för alla importerade lopp.');
}

export function scheduleEarningsRefresh(getDb: () => Database.Database) {
  if (refreshPromise) return;

  refreshPromise = refreshAllEarningsPerStart(getDb())
    .catch((err) => console.error('Uppdatering av kr/start misslyckades:', err))
    .finally(() => {
      refreshPromise = null;
    });
}

export function startEarningsRefreshJob(getDb: () => Database.Database) {
  setTimeout(() => {
    scheduleEarningsRefresh(getDb);
  }, 6000);
}
