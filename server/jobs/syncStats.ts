import type Database from 'better-sqlite3';
import { scheduleBackgroundStatsSync } from '../atgStats.js';

export function startStatsSyncJob(getDb: () => Database.Database) {
  setTimeout(() => {
    scheduleBackgroundStatsSync(getDb());
  }, 3000);
}
