import type Database from 'better-sqlite3';
import {
  bulkImportTrackLegs,
  dateMonthsAgo,
  discoverTrackLegsForRange,
} from '../importService.js';
import { scheduleAutoOptimize } from './autoOptimize.js';
import type { BulkImportStatus } from '../shared/types.js';

const META_KEY = 'bulk_import_status';

let liveStatus: BulkImportStatus = {
  running: false,
  atgTrackId: null,
  trackName: null,
  fromDate: null,
  toDate: null,
  total: 0,
  done: 0,
  imported: 0,
  skipped: 0,
  errors: [],
  message: null,
  finishedAt: null,
};

let importPromise: Promise<void> | null = null;
let queuedRequest: { atgTrackId: number; trackSlug: string; trackName: string; months: number } | null =
  null;

function saveStatus(db: Database.Database, status: BulkImportStatus) {
  db.prepare(
    `INSERT INTO stats_sync_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(META_KEY, JSON.stringify(status));
}

function loadStoredStatus(db: Database.Database): BulkImportStatus | null {
  const row = db.prepare(`SELECT value FROM stats_sync_meta WHERE key = ?`).get(META_KEY) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as BulkImportStatus;
  } catch {
    return null;
  }
}

export function getBulkImportStatus(db: Database.Database): BulkImportStatus {
  if (liveStatus.running) return liveStatus;
  return loadStoredStatus(db) ?? liveStatus;
}

async function runBulkImport(
  db: Database.Database,
  options: { atgTrackId: number; trackSlug: string; trackName: string; months: number },
) {
  const fromDate = dateMonthsAgo(options.months);
  const toDate = new Date().toISOString().slice(0, 10);

  liveStatus = {
    running: true,
    atgTrackId: options.atgTrackId,
    trackName: options.trackName,
    fromDate,
    toDate,
    total: 0,
    done: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    message: `Söker avslutade lopp på ${options.trackName}…`,
    finishedAt: null,
  };
  saveStatus(db, liveStatus);

  try {
    const targets = await discoverTrackLegsForRange({
      trackId: options.atgTrackId,
      trackSlug: options.trackSlug,
      fromDate,
      toDate,
      onlyWithResults: true,
    });

    liveStatus = {
      ...liveStatus,
      total: targets.length,
      message:
        targets.length === 0
          ? `Inga avslutade lopp hittades på ${options.trackName} sedan ${fromDate}.`
          : `Importerar ${targets.length} avdelningar…`,
    };
    saveStatus(db, liveStatus);

    if (targets.length === 0) {
      liveStatus = { ...liveStatus, running: false, finishedAt: new Date().toISOString() };
      saveStatus(db, liveStatus);
      return;
    }

    const result = await bulkImportTrackLegs(db, targets, (done, total, _target, error) => {
      liveStatus = {
        ...liveStatus,
        done,
        total,
        message: `Importerar ${done}/${total}…`,
      };
      if (error) {
        liveStatus.errors = [...liveStatus.errors, error].slice(-20);
      }
      saveStatus(db, liveStatus);
    });

    liveStatus = {
      ...liveStatus,
      running: false,
      done: targets.length,
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors.slice(0, 20),
      message: `Klart — ${result.imported} nya, ${result.skipped} fanns redan.`,
      finishedAt: new Date().toISOString(),
    };
    saveStatus(db, liveStatus);

    scheduleAutoOptimize(db);
  } catch (err) {
    liveStatus = {
      ...liveStatus,
      running: false,
      message: err instanceof Error ? err.message : 'Bulk-import misslyckades',
      finishedAt: new Date().toISOString(),
    };
    saveStatus(db, liveStatus);
  }
}

export function scheduleBulkImport(
  db: Database.Database,
  options: { atgTrackId: number; trackSlug: string; trackName: string; months?: number },
) {
  const request = { ...options, months: options.months ?? 6 };

  if (importPromise) {
    queuedRequest = request;
    return;
  }

  importPromise = runBulkImport(db, request)
    .catch((err) => console.error('Bulk-import misslyckades:', err))
    .finally(() => {
      importPromise = null;
      if (queuedRequest) {
        const next = queuedRequest;
        queuedRequest = null;
        scheduleBulkImport(db, next);
      }
    });
}
