import { formatGameLegLabel, distanceBandLabel } from './format.js';
import { classifyRaceProfile } from './raceProfile.js';
import type { GameSession, GameSessionLeg, MissAnalysisBucket, TrackMissAnalysis } from './types.js';

function startMethodLabel(method: string | null): string {
  if (method === 'volte') return 'Voltstart';
  if (method === 'auto') return 'Autostart';
  return 'Okänd startmetod';
}

function findBucket(buckets: MissAnalysisBucket[], label: string): MissAnalysisBucket | null {
  return buckets.find((b) => b.label === label) ?? null;
}

function bucketComment(
  bucket: MissAnalysisBucket | null,
  trackHitRate: number | null,
  context: string,
  trackName: string,
): string | null {
  if (!bucket || bucket.total < 3 || bucket.hitRate == null) return null;

  const diff = trackHitRate != null ? trackHitRate - bucket.hitRate : 0;

  if (diff >= 8) {
    return `${context}: ${bucket.hitRate}% träff på ${trackName} (${bucket.misses}/${bucket.total} missar) — gardera extra brett här.`;
  }
  if (diff >= 4) {
    return `${context}: ${bucket.hitRate}% träff (${bucket.misses} missar) — överväg rank 4–5 som gardering.`;
  }
  if (bucket.hitRate >= (trackHitRate ?? 0) + 5) {
    return `${context}: stark ${bucket.hitRate}% träff historiskt — spik kan fungera om rankingen är tydlig.`;
  }
  return null;
}

function pickWeakestCategory(
  analysis: TrackMissAnalysis,
  tags: string[],
): { tag: string; bucket: MissAnalysisBucket } | null {
  let worst: { tag: string; bucket: MissAnalysisBucket; diff: number } | null = null;

  for (const tag of tags) {
    const bucket = findBucket(analysis.byRaceCategory, tag);
    if (!bucket || bucket.total < 3 || bucket.hitRate == null) continue;
    const diff = (analysis.hitRate ?? 100) - bucket.hitRate;
    if (diff >= 4 && (!worst || diff > worst.diff)) {
      worst = { tag, bucket, diff };
    }
  }

  return worst ? { tag: worst.tag, bucket: worst.bucket } : null;
}

export function buildLegPrepComment(
  leg: Pick<GameSessionLeg, 'distance' | 'startMethod' | 'raceInfo' | 'systemSuggestion' | 'marginToSecond'>,
  gameType: string,
  analysis: TrackMissAnalysis,
): string {
  const trackName = analysis.trackName;

  if (analysis.racesWithResult === 0) {
    return `Saknar historik för ${trackName} — använd rankingens topp 3 och ta med rank 4–5 som gardering.`;
  }

  const terms = leg.raceInfo?.terms ?? [];
  const profile = classifyRaceProfile(
    leg.raceInfo?.name ?? null,
    terms,
    leg.distance,
    leg.startMethod,
  );

  const parts: string[] = [];
  const trackHit = analysis.hitRate;

  const gameBucket = findBucket(analysis.byGameType, gameType);
  if (gameBucket && gameBucket.total >= 5) {
    const gameComment = bucketComment(gameBucket, trackHit, `${gameType} på ${trackName}`, trackName);
    if (gameComment) parts.push(gameComment);
  }

  const startBucket = findBucket(analysis.byStartMethod, startMethodLabel(leg.startMethod));
  const startComment = bucketComment(startBucket, trackHit, startMethodLabel(leg.startMethod), trackName);
  if (startComment) parts.push(startComment);

  const distBucket = findBucket(analysis.byDistance, distanceBandLabel(leg.distance));
  const distComment = bucketComment(distBucket, trackHit, distanceBandLabel(leg.distance), trackName);
  if (distComment) parts.push(distComment);

  const categoryMatch = pickWeakestCategory(analysis, profile.tags);
  if (categoryMatch) {
    const { tag, bucket } = categoryMatch;
    parts.push(
      `${tag}-lopp på ${trackName}: ${bucket.hitRate}% träff (${bucket.misses}/${bucket.total} missar) — lopptypen har varit svårare än snittet.`,
    );
  } else if (profile.tags.length > 0) {
    const matched = profile.tags
      .map((tag) => ({ tag, bucket: findBucket(analysis.byRaceCategory, tag) }))
      .filter((m): m is { tag: string; bucket: MissAnalysisBucket } => m.bucket != null && m.bucket.total >= 3);

    if (matched.length > 0) {
      const best = matched.sort((a, b) => (b.bucket.hitRate ?? 0) - (a.bucket.hitRate ?? 0))[0];
      if (best.bucket.hitRate != null && best.bucket.hitRate >= (trackHit ?? 0)) {
        parts.push(`${best.tag}: ${best.bucket.hitRate}% träff historiskt — inget extra varningsmönster för den lopptypen.`);
      }
    }
  }

  const closeMisses = findBucket(analysis.byWinnerRank, 'Rank 4–5');
  const margin = leg.marginToSecond ?? leg.systemSuggestion?.scoreMarginTop2 ?? null;
  const isTight = margin != null && margin < 3;
  const isGardering = leg.systemSuggestion?.strategy === 'gardering';

  if (
    closeMisses &&
    analysis.misses > 0 &&
    closeMisses.misses >= analysis.misses * 0.3 &&
    (isTight || isGardering)
  ) {
    parts.push(
      `Jämn topp i rankingen — på ${trackName} ligger vinnaren ofta rank 4–5 vid miss, ta med minst en häst till.`,
    );
  } else if (parts.length === 0 && leg.systemSuggestion?.strategy === 'spik') {
    parts.push('Ingen tydlig svaghet i historiken för denna loppprofil — ettan i rankingen kan spikas om marginalen håller.');
  } else if (parts.length === 0) {
    parts.push('Loppprofilen matchar inget starkt missmönster — utgå från ranking topp 3 och gardera vid tvekan.');
  }

  return parts.slice(0, 3).join(' ');
}

export function buildGameLegPrepComments(
  game: GameSession,
  analysis: TrackMissAnalysis,
): Array<{ legNumber: number; trackRaceNumber: number | null; label: string; profile: string; comment: string }> {
  return game.legs.map((leg) => {
    const profile = classifyRaceProfile(
      leg.raceInfo?.name ?? null,
      leg.raceInfo?.terms ?? [],
      leg.distance,
      leg.startMethod,
    );
    return {
      legNumber: leg.legNumber,
      trackRaceNumber: leg.trackRaceNumber,
      label: formatGameLegLabel(game.gameType, leg.legNumber, leg.trackRaceNumber),
      profile: profile.summary,
      comment: buildLegPrepComment(leg, game.gameType, analysis),
    };
  });
}

export function formatGameLegPrepCommentsText(
  game: GameSession,
  analysis: TrackMissAnalysis,
): string {
  const rows = buildGameLegPrepComments(game, analysis);
  if (rows.length === 0) return '';
  const lines = rows.map((row) => `${row.label} (${row.profile})\n  Gardering: ${row.comment}`);
  return [`Gardering per avdelning — ${analysis.trackName}`, ...lines].join('\n\n');
}
