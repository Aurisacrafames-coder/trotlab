import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeTrackMisses } from '../trackMissAnalysis.js';
import { loadGameSession } from '../gameSessions.js';
import { buildGameLegPrepComments } from '../../shared/legPrepComment.js';
import { DEFAULT_BACKTEST_GOAL } from '../../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '../../data/travkalkyl.db'));
const gameId = Number(process.argv[2] ?? 1032);

const game = loadGameSession(db, gameId);
if (!game) {
  console.error('Game not found:', gameId);
  process.exit(1);
}

const analysis = analyzeTrackMisses(db, game.atgTrackId ?? 6, DEFAULT_BACKTEST_GOAL);
const comments = buildGameLegPrepComments(game, analysis);

console.log(`\n${game.gameType} ${game.trackName} ${game.date}\n`);
for (const row of comments) {
  console.log(`${row.label} — ${row.profile}`);
  console.log(`Gardering: ${row.comment}\n`);
}

console.log('--- Lopptyper på Åby (svagast först) ---');
for (const b of analysis.byRaceCategory.slice(0, 12)) {
  console.log(`${b.label}: ${b.hitRate}% (${b.hits}/${b.total}, ${b.misses} missar)`);
}

db.close();
