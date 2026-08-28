import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runBacktest } from '../backtest.js';
import { getTrackProfileOrGlobal } from '../trackWeightProfiles.js';
import { resolveTrackName } from '../trackStats.js';
import { distanceBandLabel } from '../../shared/format.js';
import { raceProfileTags } from '../../shared/raceProfile.js';
import { DEFAULT_BACKTEST_GOAL } from '../../shared/types.js';

const atgTrackId = Number(process.argv[2] ?? 6);
const gameTypeFilter = process.argv[3] ?? 'V85';

const db = new Database(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/travkalkyl.db'));
const params = getTrackProfileOrGlobal(db, atgTrackId);
const trackName = resolveTrackName(db, atgTrackId) ?? 'Banan';
const summary = runBacktest(db, params, { atgTrackId }, DEFAULT_BACKTEST_GOAL);

interface RaceRow {
  sessionId: number;
  gameType: string;
  startMethod: string | null;
  distance: number | null;
  fieldSize: number;
  margin12: number | null;
  winnerRank: number | null;
  tags: string[];
  topWon: boolean;
}

function parseTerms(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    return Array.isArray(p) ? p.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

const rows: RaceRow[] = [];

for (const race of summary.races) {
  const session = db
    .prepare(
      `SELECT distance, start_method as startMethod, race_name as raceName, race_terms as raceTerms
       FROM race_sessions WHERE id = ?`,
    )
    .get(race.sessionId) as {
    distance: number | null;
    startMethod: string | null;
    raceName: string | null;
    raceTerms: string | null;
  };

  const fieldSize = (
    db
      .prepare(`SELECT COUNT(*) as c FROM race_entries WHERE session_id = ? AND scratched = 0`)
      .get(race.sessionId) as { c: number }
  ).c;

  const top = race.topPicks[0];
  const second = race.topPicks[1];
  const margin12 =
    top && second ? Math.round((top.trotScore - second.trotScore) * 10) / 10 : null;

  const terms = parseTerms(session.raceTerms);
  rows.push({
    sessionId: race.sessionId,
    gameType: race.gameType,
    startMethod: session.startMethod ?? race.startMethod,
    distance: session.distance,
    fieldSize,
    margin12,
    winnerRank: race.winnerRank,
    tags: raceProfileTags(session.raceName, terms),
    topWon: race.winnerRank === 1,
  });
}

function bucket(label: string, subset: RaceRow[]) {
  const topWins = subset.filter((r) => r.topWon).length;
  const total = subset.length;
  return {
    label,
    total,
    topWins,
    topWinRate: total > 0 ? Math.round((topWins / total) * 1000) / 10 : null,
  };
}

function marginBand(m: number | null): string {
  if (m == null) return 'Okänd marginal';
  if (m >= 8) return 'Tydlig etta (≥8 p)';
  if (m >= 4) return 'Mellan (4–8 p)';
  if (m >= 2) return 'Snäv (2–4 p)';
  return 'Jämn topp (<2 p)';
}

function fieldBand(n: number): string {
  if (n <= 8) return 'Litet fält (≤8)';
  if (n <= 11) return 'Medel (9–11)';
  return 'Stort (12+)';
}

function reportGroup(title: string, groups: ReturnType<typeof bucket>[]) {
  const filtered = groups.filter((g) => g.total >= 5).sort((a, b) => (b.topWinRate ?? 0) - (a.topWinRate ?? 0));
  if (filtered.length === 0) return;
  console.log(`\n${title}`);
  for (const g of filtered) {
    console.log(`  ${g.label}: ${g.topWinRate}% etta vinner (${g.topWins}/${g.total})`);
  }
}

const all = rows;
const v85 = rows.filter((r) => r.gameType === gameTypeFilter);
const baseline = all.filter((r) => r.winnerRank != null);
const baselineRate = baseline.length > 0 ? baseline.filter((r) => r.topWon).length / baseline.length : 0;

console.log(`\n${trackName} — när ettan i Trot Score vinner`);
console.log(`All historik: ${Math.round(baselineRate * 1000) / 10}% (${baseline.filter((r) => r.topWon).length}/${baseline.length} lopp)`);
if (v85.length > 0) {
  const v85w = v85.filter((r) => r.topWon).length;
  console.log(`${gameTypeFilter}: ${Math.round((v85w / v85.length) * 1000) / 10}% (${v85w}/${v85.length} lopp)`);
}

const analyze = (subset: RaceRow[], label: string) => {
  if (subset.length < 5) return;
  console.log(`\n--- ${label} (${subset.length} lopp) ---`);

  reportGroup('Startmetod', [...new Set(subset.map((r) => r.startMethod ?? '?'))].map((m) =>
    bucket(m === 'volte' ? 'Voltstart' : m === 'auto' ? 'Autostart' : String(m), subset.filter((r) => r.startMethod === m)),
  ));

  reportGroup('Distans', [...new Set(subset.map((r) => distanceBandLabel(r.distance)))].map((d) =>
    bucket(d, subset.filter((r) => distanceBandLabel(r.distance) === d)),
  ));

  reportGroup('Marginal etta–tvåa', ['Tydlig etta (≥8 p)', 'Mellan (4–8 p)', 'Snäv (2–4 p)', 'Jämn topp (<2 p)'].map((b) =>
    bucket(b, subset.filter((r) => marginBand(r.margin12) === b)),
  ));

  reportGroup('Fältstorlek', ['Litet fält (≤8)', 'Medel (9–11)', 'Stort (12+)'].map((b) =>
    bucket(b, subset.filter((r) => fieldBand(r.fieldSize) === b)),
  ));

  const tagCounts = new Map<string, RaceRow[]>();
  for (const r of subset) {
    for (const tag of r.tags) {
      const list = tagCounts.get(tag) ?? [];
      list.push(r);
      tagCounts.set(tag, list);
    }
  }
  reportGroup(
    'Lopptyp',
    [...tagCounts.entries()].map(([tag, list]) => bucket(tag, list)),
  );
};

analyze(all, `All historik — ${trackName}`);
analyze(v85, `${gameTypeFilter} på ${trackName}`);

// Upcoming V85 legs
const upcoming = db
  .prepare(
    `SELECT rs.id, rs.leg_number as legNumber, rs.track_race_number as trackRaceNumber,
            rs.distance, rs.start_method as startMethod, rs.race_name as raceName, rs.race_terms as raceTerms,
            (SELECT trot_score FROM race_entries WHERE session_id = rs.id AND scratched = 0 ORDER BY trot_score DESC LIMIT 1) as topScore,
            (SELECT trot_score FROM race_entries WHERE session_id = rs.id AND scratched = 0 ORDER BY trot_score DESC LIMIT 1 OFFSET 1) as secondScore,
            (SELECT COUNT(*) FROM race_entries WHERE session_id = rs.id AND scratched = 0) as fieldSize
     FROM race_sessions rs
     JOIN game_sessions gs ON gs.id = rs.game_session_id
     WHERE gs.atg_track_id = ? AND gs.game_type = ? AND gs.date >= date('now')
       AND NOT EXISTS (SELECT 1 FROM race_entries re WHERE re.session_id = rs.id AND re.actual_position = 1)
     ORDER BY rs.leg_number`,
  )
  .all(atgTrackId, gameTypeFilter) as Array<{
  id: number;
  legNumber: number;
  trackRaceNumber: number | null;
  distance: number | null;
  startMethod: string | null;
  raceName: string | null;
  raceTerms: string | null;
  topScore: number | null;
  secondScore: number | null;
  fieldSize: number;
}>;

if (upcoming.length > 0) {
  console.log(`\n--- Tips inför ${gameTypeFilter} ${trackName} (kommande avdelningar) ---`);
  for (const leg of upcoming) {
    const terms = parseTerms(leg.raceTerms);
    const tags = raceProfileTags(leg.raceName, terms);
    const margin =
      leg.topScore != null && leg.secondScore != null
        ? Math.round((leg.topScore - leg.secondScore) * 10) / 10
        : null;
    const start = leg.startMethod === 'volte' ? 'Voltstart' : 'Autostart';
    const dist = distanceBandLabel(leg.distance);

    const matchRows = v85.length > 0 ? v85 : all;
    let rateParts: string[] = [];

    const startRows = matchRows.filter((r) => (r.startMethod === 'volte' ? 'Voltstart' : 'Autostart') === start);
    if (startRows.length >= 5) {
      const w = startRows.filter((r) => r.topWon).length;
      rateParts.push(`${start} ${Math.round((w / startRows.length) * 1000) / 10}%`);
    }
    const distRows = matchRows.filter((r) => distanceBandLabel(r.distance) === dist);
    if (distRows.length >= 5) {
      const w = distRows.filter((r) => r.topWon).length;
      rateParts.push(`${dist} ${Math.round((w / distRows.length) * 1000) / 10}%`);
    }
    if (margin != null) {
      const band = marginBand(margin);
      const mRows = matchRows.filter((r) => marginBand(r.margin12) === band);
      if (mRows.length >= 5) {
        const w = mRows.filter((r) => r.topWon).length;
        rateParts.push(`${band} ${Math.round((w / mRows.length) * 1000) / 10}%`);
      }
    }
    for (const tag of tags.slice(0, 2)) {
      const tRows = matchRows.filter((r) => r.tags.includes(tag));
      if (tRows.length >= 3) {
        const w = tRows.filter((r) => r.topWon).length;
        rateParts.push(`${tag} ${Math.round((w / tRows.length) * 1000) / 10}%`);
      }
    }

    const marginHint =
      margin != null
        ? margin >= 8
          ? 'Tydlig etta — spik-kandidat om mönstret stödjer.'
          : margin < 2
            ? 'Jämn topp — ettan vinner sällan, gardera.'
            : 'Måttlig marginal — ettan vinner ibland, överväg tvåan.'
        : '';

    console.log(
      `\nAvd ${leg.legNumber} · lopp ${leg.trackRaceNumber ?? '?'} — ${dist}, ${start}${leg.raceName ? `, ${leg.raceName.replace(/\s*-\s*.+$/, '')}` : ''}`,
    );
    console.log(`  Marginal etta–tvåa: ${margin ?? '—'} · Fält: ${leg.fieldSize}`);
    if (rateParts.length) console.log(`  Etta vinner historiskt: ${rateParts.join(' · ')}`);
    if (marginHint) console.log(`  ${marginHint}`);
  }
}

db.close();
