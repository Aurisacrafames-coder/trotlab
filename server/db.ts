import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PARAMETERS, VARMNING_PARAMETER_ID } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return path.join(__dirname, '..', 'data');
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, 'travkalkyl.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS parameters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 25,
      min_score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 10,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auto_key TEXT
    );

    CREATE TABLE IF NOT EXISTS race_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      atg_race_id TEXT NOT NULL UNIQUE,
      game_type TEXT NOT NULL,
      leg_number INTEGER NOT NULL,
      date TEXT NOT NULL,
      track_name TEXT NOT NULL,
      distance INTEGER,
      start_method TEXT,
      source_url TEXT,
      status TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS race_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES race_sessions(id) ON DELETE CASCADE,
      atg_horse_id INTEGER NOT NULL,
      horse_name TEXT NOT NULL,
      start_number INTEGER NOT NULL,
      post_position INTEGER,
      driver_name TEXT,
      start_points REAL,
      earnings_per_start REAL,
      trot_score REAL,
      actual_position INTEGER,
      UNIQUE(session_id, start_number)
    );

    CREATE TABLE IF NOT EXISTS entry_scores (
      entry_id INTEGER NOT NULL REFERENCES race_entries(id) ON DELETE CASCADE,
      parameter_id TEXT NOT NULL REFERENCES parameters(id) ON DELETE CASCADE,
      score REAL NOT NULL,
      PRIMARY KEY (entry_id, parameter_id)
    );

    CREATE TABLE IF NOT EXISTS form_starts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL REFERENCES race_entries(id) ON DELETE CASCADE,
      form_order INTEGER NOT NULL,
      date TEXT,
      distance INTEGER,
      post_position INTEGER,
      km_time TEXT,
      place TEXT,
      driver_name TEXT,
      prize_first INTEGER,
      track_name TEXT,
      is_record_time INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_date ON race_sessions(date);
    CREATE INDEX IF NOT EXISTS idx_sessions_track ON race_sessions(atg_track_id);
    CREATE INDEX IF NOT EXISTS idx_entries_session ON race_entries(session_id);

    CREATE TABLE IF NOT EXISTS session_parameters (
      session_id INTEGER NOT NULL REFERENCES race_sessions(id) ON DELETE CASCADE,
      parameter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      weight REAL NOT NULL,
      min_score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 10,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auto_key TEXT,
      PRIMARY KEY (session_id, parameter_id)
    );

    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_type TEXT NOT NULL,
      date TEXT NOT NULL,
      track_name TEXT NOT NULL,
      atg_track_id INTEGER,
      tip_submitted_at TEXT,
      uses_tip_parameters INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(game_type, date, atg_track_id)
    );

    CREATE TABLE IF NOT EXISTS game_session_parameters (
      game_session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
      parameter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      weight REAL NOT NULL,
      min_score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 10,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auto_key TEXT,
      PRIMARY KEY (game_session_id, parameter_id)
    );

    CREATE TABLE IF NOT EXISTS game_session_user_systems (
      game_session_id INTEGER PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
      legs_json TEXT NOT NULL,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS track_weight_profiles (
      atg_track_id INTEGER NOT NULL,
      parameter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      weight REAL NOT NULL,
      min_score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 10,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auto_key TEXT,
      PRIMARY KEY (atg_track_id, parameter_id)
    );

    CREATE TABLE IF NOT EXISTS track_profile_meta (
      atg_track_id INTEGER PRIMARY KEY,
      track_name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stats_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS driver_v85_stats (
      driver_id INTEGER PRIMARY KEY,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS driver_win_stats (
      driver_id INTEGER PRIMARY KEY,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS driver_track_win_stats (
      driver_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (driver_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS trainer_win_stats (
      trainer_id INTEGER PRIMARY KEY,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trainer_track_win_stats (
      trainer_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (trainer_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS track_post_win_stats (
      track_id INTEGER NOT NULL,
      post_position INTEGER NOT NULL,
      start_method TEXT NOT NULL,
      volte_row TEXT NOT NULL DEFAULT '',
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (track_id, post_position, start_method, volte_row)
    );

    CREATE TABLE IF NOT EXISTS horse_watchlist (
      atg_horse_id INTEGER PRIMARY KEY,
      horse_name TEXT NOT NULL,
      source_session_id INTEGER REFERENCES race_sessions(id) ON DELETE SET NULL,
      marked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_horse_watchlist_marked ON horse_watchlist(marked_at);
  `);

  migrateSchema(database);

  const count = database.prepare('SELECT COUNT(*) as c FROM parameters').get() as { c: number };
  if (count.c === 0) {
    const insert = database.prepare(`
      INSERT INTO parameters (id, name, weight, min_score, max_score, sort_order, auto_key)
      VALUES (@id, @name, @weight, @minScore, @maxScore, @sortOrder, @autoKey)
    `);
    DEFAULT_PARAMETERS.forEach((p, i) => {
      insert.run({
        id: `param-${i}`,
        name: p.name,
        weight: p.weight,
        minScore: p.minScore,
        maxScore: p.maxScore,
        sortOrder: p.sortOrder,
        autoKey: p.autoKey,
      });
    });
  }
}

function migrateSchema(database: Database.Database) {
  const cols = database
    .prepare('PRAGMA table_info(race_sessions)')
    .all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));

  if (!colNames.has('tip_submitted_at')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN tip_submitted_at TEXT`);
  }
  if (!colNames.has('uses_tip_parameters')) {
    database.exec(
      `ALTER TABLE race_sessions ADD COLUMN uses_tip_parameters INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.has('atg_track_id')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN atg_track_id INTEGER`);
  }

  const entryCols = database
    .prepare('PRAGMA table_info(race_entries)')
    .all() as Array<{ name: string }>;
  const entryColNames = new Set(entryCols.map((c) => c.name));

  if (!entryColNames.has('atg_driver_id')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN atg_driver_id INTEGER`);
  }
  if (!entryColNames.has('driver_v85_win_pct')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN driver_v85_win_pct REAL`);
  }
  if (!entryColNames.has('driver_v85_win_pct_override')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN driver_v85_win_pct_override REAL`);
  }
  if (!entryColNames.has('driver_track_win_pct')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN driver_track_win_pct REAL`);
  }
  if (!entryColNames.has('driver_global_win_pct')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN driver_global_win_pct REAL`);
    database.exec(`
      UPDATE race_entries
      SET driver_global_win_pct = driver_v85_win_pct
      WHERE driver_global_win_pct IS NULL AND driver_v85_win_pct IS NOT NULL
    `);
    database.exec(`
      UPDATE race_entries
      SET driver_track_win_pct = (
        SELECT d.win_percent
        FROM driver_track_win_stats d
        JOIN race_sessions rs ON rs.id = race_entries.session_id
        WHERE d.driver_id = race_entries.atg_driver_id
          AND d.track_id = rs.atg_track_id
          AND d.starts > 0
      )
      WHERE atg_driver_id IS NOT NULL AND driver_track_win_pct IS NULL
    `);
    database.exec(`
      UPDATE race_entries
      SET driver_global_win_pct = (
        SELECT win_percent FROM driver_win_stats WHERE driver_id = race_entries.atg_driver_id
      )
      WHERE atg_driver_id IS NOT NULL AND driver_global_win_pct IS NULL
    `);
  }
  if (!entryColNames.has('track_post_win_pct')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN track_post_win_pct REAL`);
  }
  if (!entryColNames.has('start_distance')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN start_distance INTEGER`);
  }
  if (!entryColNames.has('volte_row')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN volte_row TEXT`);
  }
  if (!entryColNames.has('bet_distribution_pct')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN bet_distribution_pct REAL`);
  }
  if (!entryColNames.has('atg_trainer_id')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN atg_trainer_id INTEGER`);
  }
  if (!entryColNames.has('trainer_name')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN trainer_name TEXT`);
  }
  if (!entryColNames.has('trainer_win_pct')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN trainer_win_pct REAL`);
  }
  if (!entryColNames.has('trainer_win_pct_override')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN trainer_win_pct_override REAL`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS trainer_win_stats (
      trainer_id INTEGER PRIMARY KEY,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS trainer_track_win_stats (
      trainer_id INTEGER NOT NULL,
      track_id INTEGER NOT NULL,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (trainer_id, track_id)
    );
  `);

  const raceCols = database
    .prepare('PRAGMA table_info(race_sessions)')
    .all() as Array<{ name: string }>;
  const raceColNames = new Set(raceCols.map((c) => c.name));
  if (!raceColNames.has('game_session_id')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN game_session_id INTEGER REFERENCES game_sessions(id) ON DELETE SET NULL`);
  }
  if (!raceColNames.has('track_race_number')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN track_race_number INTEGER`);
  }
  if (!raceColNames.has('race_name')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN race_name TEXT`);
  }
  if (!raceColNames.has('race_prize')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN race_prize TEXT`);
  }
  if (!raceColNames.has('race_terms')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN race_terms TEXT`);
  }
  if (!raceColNames.has('scheduled_start_time')) {
    database.exec(`ALTER TABLE race_sessions ADD COLUMN scheduled_start_time TEXT`);
  }

  if (!entryColNames.has('horse_sex')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN horse_sex TEXT`);
  }
  if (!entryColNames.has('career_starts')) {
    database.exec(`ALTER TABLE race_entries ADD COLUMN career_starts INTEGER`);
  }
  if (!entryColNames.has('driver_apprentice')) {
    database.exec(
      `ALTER TABLE race_entries ADD COLUMN driver_apprentice INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!entryColNames.has('scratched')) {
    database.exec(
      `ALTER TABLE race_entries ADD COLUMN scratched INTEGER NOT NULL DEFAULT 0`,
    );
  }

  database.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_track ON race_sessions(atg_track_id)`);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_entries_session_position ON race_entries(session_id, actual_position)`,
  );

  const formCols = database
    .prepare('PRAGMA table_info(form_starts)')
    .all() as Array<{ name: string }>;
  const formColNames = new Set(formCols.map((c) => c.name));
  if (!formColNames.has('is_record_time')) {
    database.exec(
      `ALTER TABLE form_starts ADD COLUMN is_record_time INTEGER NOT NULL DEFAULT 0`,
    );
    database.exec(
      `UPDATE form_starts SET is_record_time = 1 WHERE km_time GLOB '[0-9].[0-9][0-9],[0-9]r'`,
    );
  }

  seedNewParameters(database);
  backfillGameSessions(database);
  migrateTrackPostStats(database);
  migrateTrackPostVolteRow(database);
  backfillTrackRaceNumbers(database);
  renameDriverGamePercentParameter(database);
  fixParameterNameEncoding(database);
  mergePostParameters(database);
  fixInvalidActualPositions(database);
  reconcileDriverWinPctFromCache(database);
}

/** Fix global kusk % that was wrongly copied from track-only legacy column. */
function reconcileDriverWinPctFromCache(database: Database.Database) {
  const done = database
    .prepare(`SELECT value FROM stats_sync_meta WHERE key = 'driver_pct_reconciled_v1'`)
    .get() as { value: string } | undefined;
  if (done?.value === '1') return;

  database.exec(`
    UPDATE race_entries
    SET driver_global_win_pct = (
      SELECT win_percent FROM driver_win_stats
      WHERE driver_id = race_entries.atg_driver_id
    )
    WHERE atg_driver_id IS NOT NULL
      AND driver_v85_win_pct_override IS NULL
  `);

  database.exec(`
    UPDATE race_entries
    SET driver_track_win_pct = (
      SELECT d.win_percent
      FROM driver_track_win_stats d
      JOIN race_sessions rs ON rs.id = race_entries.session_id
      WHERE d.driver_id = race_entries.atg_driver_id
        AND d.track_id = rs.atg_track_id
        AND d.starts > 0
    )
    WHERE atg_driver_id IS NOT NULL
      AND driver_v85_win_pct_override IS NULL
  `);

  database.prepare(
    `INSERT INTO stats_sync_meta (key, value, updated_at) VALUES ('driver_pct_reconciled_v1', '1', datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run();
}

/** One Spår parameter: track lane win % only. Removes theoretical "Spår idag". */
function mergePostParameters(database: Database.Database) {
  const post = database
    .prepare(`SELECT id, weight FROM parameters WHERE auto_key = 'postPosition'`)
    .get() as { id: string; weight: number } | undefined;

  if (!post) {
    database.prepare(`UPDATE parameters SET name = 'Spår' WHERE auto_key = 'trackPostWin' AND name != 'Spår'`).run();
    database
      .prepare(`UPDATE session_parameters SET name = 'Spår' WHERE auto_key = 'trackPostWin' AND name != 'Spår'`)
      .run();
    database
      .prepare(
        `UPDATE game_session_parameters SET name = 'Spår' WHERE auto_key = 'trackPostWin' AND name != 'Spår'`,
      )
      .run();
    return;
  }

  const track = database
    .prepare(`SELECT id, weight FROM parameters WHERE auto_key = 'trackPostWin'`)
    .get() as { id: string; weight: number } | undefined;

  database.transaction(() => {
    if (track) {
      database
        .prepare(
          `UPDATE parameters SET weight = ?, name = 'Spår', sort_order = 3 WHERE auto_key = 'trackPostWin'`,
        )
        .run(track.weight + post.weight);
      database
        .prepare(`UPDATE session_parameters SET name = 'Spår' WHERE auto_key = 'trackPostWin'`)
        .run();
      database
        .prepare(`UPDATE game_session_parameters SET name = 'Spår' WHERE auto_key = 'trackPostWin'`)
        .run();
    }

    database.prepare(`DELETE FROM entry_scores WHERE parameter_id = ?`).run(post.id);
    database.prepare(`DELETE FROM session_parameters WHERE parameter_id = ?`).run(post.id);
    database.prepare(`DELETE FROM game_session_parameters WHERE parameter_id = ?`).run(post.id);
    database.prepare(`DELETE FROM parameters WHERE auto_key = 'postPosition'`).run();

    database.prepare(`UPDATE parameters SET sort_order = 4 WHERE auto_key = 'driverV85Win'`).run();
    database.prepare(`UPDATE parameters SET sort_order = 5 WHERE auto_key = 'recentWin'`).run();
    database.prepare(`UPDATE parameters SET sort_order = 6 WHERE id = ?`).run(VARMNING_PARAMETER_ID);
  })();
}

/** Correct parameter names that were seeded with broken UTF-8 (å/ä/ö). */
function fixParameterNameEncoding(database: Database.Database) {
  for (const param of DEFAULT_PARAMETERS) {
    if (!param.autoKey) continue;
    database
      .prepare(`UPDATE parameters SET name = ? WHERE auto_key = ? AND name != ?`)
      .run(param.name, param.autoKey, param.name);
    database
      .prepare(`UPDATE session_parameters SET name = ? WHERE auto_key = ? AND name != ?`)
      .run(param.name, param.autoKey, param.name);
    database
      .prepare(`UPDATE game_session_parameters SET name = ? WHERE auto_key = ? AND name != ?`)
      .run(param.name, param.autoKey, param.name);
  }

  database
    .prepare(`UPDATE parameters SET name = ? WHERE id = ? AND name != ?`)
    .run('Värmning', VARMNING_PARAMETER_ID, 'Värmning');
  database
    .prepare(`UPDATE session_parameters SET name = ? WHERE parameter_id = ? AND name != ?`)
    .run('Värmning', VARMNING_PARAMETER_ID, 'Värmning');
  database
    .prepare(`UPDATE game_session_parameters SET name = ? WHERE parameter_id = ? AND name != ?`)
    .run('Värmning', VARMNING_PARAMETER_ID, 'Värmning');
}

/** finishOrder from ATG for galopp/DQ horses can be 34+ — not a real placement. */
function fixInvalidActualPositions(database: Database.Database) {
  database
    .prepare(
      `UPDATE race_entries SET actual_position = 0
       WHERE actual_position IS NOT NULL AND actual_position > 15`,
    )
    .run();
}

function renameDriverGamePercentParameter(database: Database.Database) {
  const names = ['Kusk vinst%', 'Kusk spel %', 'Kusk V85 %'];
  for (const oldName of names.slice(1)) {
    database
      .prepare(`UPDATE parameters SET name = ? WHERE auto_key = 'driverV85Win' AND name = ?`)
      .run(names[0], oldName);
    database
      .prepare(`UPDATE session_parameters SET name = ? WHERE auto_key = 'driverV85Win' AND name = ?`)
      .run(names[0], oldName);
    database
      .prepare(
        `UPDATE game_session_parameters SET name = ? WHERE auto_key = 'driverV85Win' AND name = ?`,
      )
      .run(names[0], oldName);
  }
}

function backfillTrackRaceNumbers(database: Database.Database) {
  const rows = database
    .prepare(
      `SELECT id, atg_race_id as atgRaceId FROM race_sessions WHERE track_race_number IS NULL`,
    )
    .all() as Array<{ id: number; atgRaceId: string }>;

  const update = database.prepare(
    'UPDATE race_sessions SET track_race_number = ? WHERE id = ?',
  );

  for (const row of rows) {
    const parts = row.atgRaceId.split('_');
    const num = parseInt(parts[parts.length - 1] ?? '', 10);
    if (!Number.isNaN(num)) update.run(num, row.id);
  }
}

function migrateTrackPostStats(database: Database.Database) {
  const cols = database
    .prepare('PRAGMA table_info(track_post_win_stats)')
    .all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === 'start_method')) return;

  database.exec(`
    CREATE TABLE track_post_win_stats_new (
      track_id INTEGER NOT NULL,
      post_position INTEGER NOT NULL,
      start_method TEXT NOT NULL,
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (track_id, post_position, start_method)
    );
    DROP TABLE track_post_win_stats;
    ALTER TABLE track_post_win_stats_new RENAME TO track_post_win_stats;
  `);
}

function migrateTrackPostVolteRow(database: Database.Database) {
  const cols = database
    .prepare('PRAGMA table_info(track_post_win_stats)')
    .all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === 'volte_row')) return;

  database.exec(`
    CREATE TABLE track_post_win_stats_new (
      track_id INTEGER NOT NULL,
      post_position INTEGER NOT NULL,
      start_method TEXT NOT NULL,
      volte_row TEXT NOT NULL DEFAULT '',
      starts INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      win_percent REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (track_id, post_position, start_method, volte_row)
    );
    DROP TABLE track_post_win_stats;
    ALTER TABLE track_post_win_stats_new RENAME TO track_post_win_stats;
  `);
}

function backfillGameSessions(database: Database.Database) {
  const unlinked = database
    .prepare('SELECT COUNT(*) as c FROM race_sessions WHERE game_session_id IS NULL')
    .get() as { c: number };
  if (unlinked.c === 0) return;

  const races = database
    .prepare(
      `SELECT id, game_type as gameType, date, track_name as trackName,
              atg_track_id as atgTrackId
       FROM race_sessions WHERE game_session_id IS NULL`,
    )
    .all() as Array<{
    id: number;
    gameType: string;
    date: string;
    trackName: string;
    atgTrackId: number | null;
  }>;

  const findGame = database.prepare(
    `SELECT id FROM game_sessions
     WHERE game_type = ? AND date = ? AND (atg_track_id = ? OR (atg_track_id IS NULL AND ? IS NULL))`,
  );
  const insertGame = database.prepare(
    `INSERT INTO game_sessions (game_type, date, track_name, atg_track_id)
     VALUES (?, ?, ?, ?)`,
  );
  const linkRace = database.prepare('UPDATE race_sessions SET game_session_id = ? WHERE id = ?');

  database.transaction(() => {
    for (const race of races) {
      let gameId = findGame.get(race.gameType, race.date, race.atgTrackId, race.atgTrackId) as
        | { id: number }
        | undefined;
      if (!gameId) {
        const result = insertGame.run(race.gameType, race.date, race.trackName, race.atgTrackId);
        gameId = { id: Number(result.lastInsertRowid) };
      }
      linkRace.run(gameId.id, race.id);
    }
  })();
}

function seedNewParameters(database: Database.Database) {
  const extra = [
    {
      id: 'param-4',
      name: 'Kusk vinst%',
      weight: 10,
      minScore: 0,
      maxScore: 10,
      sortOrder: 4,
      autoKey: 'driverV85Win',
    },
    {
      id: 'param-5',
      name: 'Spår',
      weight: 15,
      minScore: 0,
      maxScore: 10,
      sortOrder: 3,
      autoKey: 'trackPostWin',
    },
    {
      id: 'param-6',
      name: 'Värmning',
      weight: 0,
      minScore: 0,
      maxScore: 10,
      sortOrder: 7,
      autoKey: null,
    },
    {
      id: 'param-7',
      name: 'Vinst senaste start',
      weight: 0,
      minScore: 0,
      maxScore: 10,
      sortOrder: 6,
      autoKey: 'recentWin',
    },
    {
      id: 'param-8',
      name: 'Tränare vinst%',
      weight: 0,
      minScore: 0,
      maxScore: 10,
      sortOrder: 5,
      autoKey: 'trainerWin',
    },
    {
      id: 'param-9',
      name: 'Startstraff',
      weight: 0,
      minScore: 0,
      maxScore: 10,
      sortOrder: 8,
      autoKey: 'startDistancePenalty',
    },
  ];

  const insert = database.prepare(`
    INSERT INTO parameters (id, name, weight, min_score, max_score, sort_order, auto_key)
    VALUES (@id, @name, @weight, @minScore, @maxScore, @sortOrder, @autoKey)
  `);

  for (const p of extra) {
    const exists = database.prepare('SELECT 1 FROM parameters WHERE id = ?').get(p.id);
    if (!exists) insert.run(p);
  }

  backfillTrackProfileParameters(database);
}

function backfillTrackProfileParameters(database: Database.Database) {
  const globalParams = database
    .prepare(
      `SELECT id, name, weight, min_score as minScore, max_score as maxScore,
              sort_order as sortOrder, auto_key as autoKey
       FROM parameters ORDER BY sort_order`,
    )
    .all() as Array<{
    id: string;
    name: string;
    weight: number;
    minScore: number;
    maxScore: number;
    sortOrder: number;
    autoKey: string | null;
  }>;

  const tracks = database
    .prepare(`SELECT atg_track_id as atgTrackId FROM track_profile_meta`)
    .all() as Array<{ atgTrackId: number }>;

  const existing = database.prepare(
    `SELECT 1 FROM track_weight_profiles WHERE atg_track_id = ? AND parameter_id = ?`,
  );
  const insert = database.prepare(`
    INSERT INTO track_weight_profiles
      (atg_track_id, parameter_id, name, weight, min_score, max_score, sort_order, auto_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const track of tracks) {
    for (const param of globalParams) {
      if (existing.get(track.atgTrackId, param.id)) continue;
      insert.run(
        track.atgTrackId,
        param.id,
        param.name,
        param.weight,
        param.minScore,
        param.maxScore,
        param.sortOrder,
        param.autoKey,
      );
    }
  }
}

export function closeDb() {
  db?.close();
  db = null;
}
