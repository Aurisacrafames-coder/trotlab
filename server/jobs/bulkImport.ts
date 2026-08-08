import type Database from 'better-sqlite3';
import {
  bulkImportTrackLegs,
  dateMonthsAgo,
  discoverTrackLegsForRange,
  loadImportedRaceIds,
  resolveDiscoveryFromDate,
} from '../importService.js';
import { scheduleAutoOptimize } from './autoOptimize.js';
import { getTrackStats } from '../trackStats.js';
import type { BulkImportStatus } from '../../shared/types.js';
import { BULK_IMPORT_LOOKBACK_MONTHS } from '../../shared/types.js';

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

export function resetStaleBulkImportStatus(db: Database.Database) {
  if (importPromise) return;
  const stored = loadStoredStatus(db);
  if (!stored?.running) return;

  liveStatus = {
    ...stored,
    running: false,
    message: `${stored.message ?? 'Import avbruten'} (server omstartad)`,
    finishedAt: new Date().toISOString(),
  };
  saveStatus(db, liveStatus);
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
    const alreadyImported = loadImportedRaceIds(db, options.atgTrackId, fromDate, toDate);
    const discoveryFromDate = resolveDiscoveryFromDate(
      db,
      options.atgTrackId,
      fromDate,
      alreadyImported,
    );

    liveStatus = {
      ...liveStatus,
      message:
        alreadyImported.size > 0
          ? discoveryFromDate > fromDate
            ? `Söker nya lopp på ${options.trackName} sedan ${discoveryFromDate} (${alreadyImported.size} redan importerade)…`
            : `Söker nya lopp på ${options.trackName} (${alreadyImported.size} redan importerade)…`
          : `Söker avslutade lopp på ${options.trackName}…`,
    };
    saveStatus(db, liveStatus);

    const targets = await discoverTrackLegsForRange({
      trackId: options.atgTrackId,
      trackSlug: options.trackSlug,
      fromDate: discoveryFromDate,
      toDate,
      onlyWithResults: true,
      skipRaceIds: alreadyImported,
    });

    liveStatus = {
      ...liveStatus,
      total: targets.length,
      message:
        targets.length === 0
          ? alreadyImported.size > 0
            ? `Inga nya lopp att importera — ${alreadyImported.size} avdelningar fanns redan sedan ${fromDate}.`
            : `Inga avslutade lopp hittades på ${options.trackName} sedan ${fromDate}.`
          : `Importerar ${targets.length} nya avdelningar…`,
    };
    saveStatus(db, liveStatus);

    if (targets.length === 0) {
      liveStatus = { ...liveStatus, running: false, finishedAt: new Date().toISOString() };
      saveStatus(db, liveStatus);
      return;
    }

    const result = await bulkImportTrackLegs(
      db,
      targets,
      (done, total, _target, stats, error) => {
        liveStatus = {
          ...liveStatus,
          done,
          total,
          imported: stats.imported,
          skipped: stats.skipped,
          message: `Importerar ${done}/${total}… (${stats.imported} nya, ${stats.skipped} hoppade)`,
        };
        if (error) {
          liveStatus.errors = [...liveStatus.errors, error].slice(-20);
        }
        saveStatus(db, liveStatus);
      },
      { atgTrackId: options.atgTrackId },
    );

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

    // Skip auto-optimize after large bulk imports — it blocks the server for minutes.
    const trackStats = getTrackStats(db, options.atgTrackId);
    if (trackStats && trackStats.racesWithResult <= 150) {
      scheduleAutoOptimize(db, 'win', options.atgTrackId);
    }
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
  const request = { ...options, months: options.months ?? BULK_IMPORT_LOOKBACK_MONTHS };

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
