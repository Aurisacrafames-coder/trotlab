import { distanceBandLabel } from './format.js';
import type { GameTypeTopPickWinProfile, TopPickWinAnalysis, TopPickWinBucket } from './types.js';

export interface TopPickWinRaceRow {
  gameType: string;
  startMethod: string | null;
  distance: number | null;
  fieldSize: number;
  margin12: number | null;
  topWon: boolean;
  tags: string[];
}

export function marginBandLabel(margin: number | null): string {
  if (margin == null) return 'Okänd marginal';
  if (margin >= 8) return 'Tydlig etta (≥8 p)';
  if (margin >= 4) return 'Mellan (4–8 p)';
  if (margin >= 2) return 'Snäv (2–4 p)';
  return 'Jämn topp (<2 p)';
}

export function fieldBandLabel(fieldSize: number): string {
  if (fieldSize <= 8) return 'Litet fält (≤8)';
  if (fieldSize <= 11) return 'Medel (9–11)';
  return 'Stort (12+)';
}

function startMethodBucketLabel(method: string | null): string {
  if (method === 'volte') return 'Voltstart';
  if (method === 'auto') return 'Autostart';
  return 'Okänd startmetod';
}

function topWinBucket(label: string, rows: TopPickWinRaceRow[]): TopPickWinBucket {
  const topWins = rows.filter((r) => r.topWon).length;
  const total = rows.length;
  return {
    label,
    topWins,
    total,
    topWinRate: total > 0 ? Math.round((topWins / total) * 1000) / 10 : null,
  };
}

function buildProfileBuckets(rows: TopPickWinRaceRow[]) {
  const startLabels = [...new Set(rows.map((r) => startMethodBucketLabel(r.startMethod)))];
  const distanceLabels = [...new Set(rows.map((r) => distanceBandLabel(r.distance)))];
  const marginLabels = ['Tydlig etta (≥8 p)', 'Mellan (4–8 p)', 'Snäv (2–4 p)', 'Jämn topp (<2 p)'];
  const fieldLabels = ['Litet fält (≤8)', 'Medel (9–11)', 'Stort (12+)'];

  const tagGroups = new Map<string, TopPickWinRaceRow[]>();
  for (const row of rows) {
    for (const tag of row.tags) {
      const list = tagGroups.get(tag) ?? [];
      list.push(row);
      tagGroups.set(tag, list);
    }
  }

  return {
    byStartMethod: startLabels
      .map((label) =>
        topWinBucket(
          label,
          rows.filter((r) => startMethodBucketLabel(r.startMethod) === label),
        ),
      )
      .filter((b) => b.total > 0),
    byDistance: distanceLabels
      .map((label) => topWinBucket(label, rows.filter((r) => distanceBandLabel(r.distance) === label)))
      .filter((b) => b.total > 0),
    byMarginBand: marginLabels
      .map((label) => topWinBucket(label, rows.filter((r) => marginBandLabel(r.margin12) === label)))
      .filter((b) => b.total > 0),
    byFieldSize: fieldLabels
      .map((label) => topWinBucket(label, rows.filter((r) => fieldBandLabel(r.fieldSize) === label)))
      .filter((b) => b.total > 0),
    byRaceCategory: [...tagGroups.entries()]
      .map(([label, subset]) => topWinBucket(label, subset))
      .filter((b) => b.total >= 3)
      .sort((a, b) => (b.topWinRate ?? 0) - (a.topWinRate ?? 0)),
  };
}

export function buildTopPickWinAnalysis(rows: TopPickWinRaceRow[]): TopPickWinAnalysis {
  const topWins = rows.filter((r) => r.topWon).length;
  const total = rows.length;
  const buckets = buildProfileBuckets(rows);

  const gameGroups = new Map<string, TopPickWinRaceRow[]>();
  for (const row of rows) {
    const list = gameGroups.get(row.gameType) ?? [];
    list.push(row);
    gameGroups.set(row.gameType, list);
  }

  const gameTypeProfiles: GameTypeTopPickWinProfile[] = [...gameGroups.entries()]
    .map(([gameType, subset]) => {
      const wins = subset.filter((r) => r.topWon).length;
      const subsetTotal = subset.length;
      const profileBuckets = buildProfileBuckets(subset);
      return {
        gameType,
        topWins: wins,
        total: subsetTotal,
        topWinRate: subsetTotal > 0 ? Math.round((wins / subsetTotal) * 1000) / 10 : null,
        ...profileBuckets,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    topWins,
    total,
    topWinRate: total > 0 ? Math.round((topWins / total) * 1000) / 10 : null,
    ...buckets,
    gameTypeProfiles,
  };
}
