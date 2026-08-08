import { getDb } from '../db.js';
import {
  bulkImportTrackLegs,
  discoverTrackLegsForYear,
} from '../importService.js';

const TRACK_ID = 21;
const TRACK_SLUG = 'lindesberg';
const YEAR = 2026;

const db = getDb();

console.log(`Söker avslutade lopp på Lindesberg under ${YEAR}…`);
const targets = await discoverTrackLegsForYear({
  trackId: TRACK_ID,
  trackSlug: TRACK_SLUG,
  year: YEAR,
  onlyWithResults: true,
});

console.log(`Hittade ${targets.length} avdelningar att importera.`);

if (targets.length === 0) {
  process.exit(0);
}

const byDate = targets.reduce<Record<string, number>>((acc, t) => {
  acc[t.date] = (acc[t.date] ?? 0) + 1;
  return acc;
}, {});
console.log('Omgångar per datum:', byDate);

let lastLog = '';
const result = await bulkImportTrackLegs(db, targets, (done, total, target, _stats, error) => {
  const line = `[${done}/${total}] ${target.date} ${target.gameType} avd ${target.leg}${error ? ` — FEL: ${error}` : ''}`;
  if (line !== lastLog) {
    console.log(line);
    lastLog = line;
  }
});

console.log('\nKlart!');
console.log(`Importerade: ${result.imported}`);
console.log(`Redan fanns: ${result.skipped}`);
if (result.errors.length > 0) {
  console.log(`Fel (${result.errors.length}):`);
  for (const err of result.errors.slice(0, 20)) console.log(' -', err);
  if (result.errors.length > 20) console.log(` … och ${result.errors.length - 20} till`);
}

const summary = db
  .prepare(
    `SELECT COUNT(*) as races,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM race_entries re
              WHERE re.session_id = race_sessions.id AND re.actual_position > 0
            ) THEN 1 ELSE 0 END) as withResults
     FROM race_sessions WHERE atg_track_id = ? AND date LIKE ?`,
  )
  .get(TRACK_ID, `${YEAR}-%`) as { races: number; withResults: number };

console.log(`\nLindesberg ${YEAR} i databasen: ${summary.races} lopp (${summary.withResults} med resultat)`);
