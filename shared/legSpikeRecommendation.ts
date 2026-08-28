import { distanceBandLabel } from './format.js';
import { classifyRaceProfile } from './raceProfile.js';
import { fieldBandLabel, marginBandLabel } from './topPickWin.js';
import type {
  GameSessionLeg,
  GameTypeTopPickWinProfile,
  LegSpikeRecommendation,
  SpikeEttaLabel,
  TopPickWinAnalysis,
  TopPickWinBucket,
} from './types.js';

type LegSpikeInput = Pick<
  GameSessionLeg,
  'distance' | 'startMethod' | 'raceInfo' | 'systemSuggestion' | 'marginToSecond' | 'rankedHorses'
>;

function startMethodLabel(method: string | null): string {
  if (method === 'volte') return 'Voltstart';
  if (method === 'auto') return 'Autostart';
  return 'Okänd startmetod';
}

function profileForGameType(
  analysis: TopPickWinAnalysis,
  gameType: string,
): GameTypeTopPickWinProfile | TopPickWinAnalysis {
  return analysis.gameTypeProfiles.find((p) => p.gameType === gameType) ?? analysis;
}

function findBucket(buckets: TopPickWinBucket[], label: string): TopPickWinBucket | null {
  return buckets.find((b) => b.label === label) ?? null;
}

function resolveMargin(leg: LegSpikeInput): number | null {
  if (leg.marginToSecond != null) return leg.marginToSecond;
  if (leg.systemSuggestion?.scoreMarginTop2 != null) return leg.systemSuggestion.scoreMarginTop2;

  const active = leg.rankedHorses
    .filter((h) => !h.scratched)
    .sort((a, b) => b.trotScore - a.trotScore);
  if (active.length >= 2) {
    return Math.round((active[0].trotScore - active[1].trotScore) * 10) / 10;
  }
  return null;
}

function activeFieldSize(leg: LegSpikeInput): number {
  return leg.rankedHorses.filter((h) => !h.scratched).length;
}

export function buildLegSpikeRecommendation(
  leg: LegSpikeInput,
  gameType: string,
  topPickWin: TopPickWinAnalysis,
): LegSpikeRecommendation | null {
  if (topPickWin.total === 0) return null;

  const profile = profileForGameType(topPickWin, gameType);
  const historicalRates: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  const margin = resolveMargin(leg);
  const start = startMethodLabel(leg.startMethod);
  const dist = distanceBandLabel(leg.distance);
  const fieldSize = activeFieldSize(leg);
  const fieldBand = fieldBandLabel(fieldSize);
  const raceProfile = classifyRaceProfile(
    leg.raceInfo?.name ?? null,
    leg.raceInfo?.terms ?? [],
    leg.distance,
    leg.startMethod,
  );

  if (margin != null) {
    if (margin >= 8) {
      score += 3;
      reasons.push(`Tydlig etta (+${margin.toFixed(1)} p) — ettan vinner ofta vid stor marginal.`);
    } else if (margin >= 4) {
      score += 1;
      reasons.push(`Måttlig marginal (+${margin.toFixed(1)} p) — ettan vinner ungefär hälften av gångerna.`);
    } else if (margin >= 2) {
      reasons.push(`Snäv marginal (+${margin.toFixed(1)} p) — tvåan ligger nära.`);
    } else {
      score -= 2;
      reasons.push(`Jämn topp (+${margin.toFixed(1)} p) — ettan vinner sällan historiskt.`);
    }

    const marginBucket = findBucket(profile.byMarginBand, marginBandLabel(margin));
    if (marginBucket && marginBucket.total >= 5 && marginBucket.topWinRate != null) {
      historicalRates.push(`${marginBandLabel(margin)} ${marginBucket.topWinRate}%`);
      if (marginBucket.topWinRate >= 55) score += 1;
      else if (marginBucket.topWinRate < 40) score -= 1;
    }
  } else {
    reasons.push('Marginal etta–tvåa okänd — var försiktig med spik.');
    score -= 1;
  }

  const startBucket = findBucket(profile.byStartMethod, start);
  if (startBucket && startBucket.total >= 5 && startBucket.topWinRate != null) {
    historicalRates.push(`${start} ${startBucket.topWinRate}%`);
    if (startBucket.topWinRate >= 55) {
      score += 1;
      if (start === 'Autostart') reasons.push('Autostart: ettan vinner oftare än volt.');
    } else if (startBucket.topWinRate < 40) {
      score -= 2;
      reasons.push(`${start}: ettan vinner bara ${startBucket.topWinRate}% historiskt.`);
    }
  }

  const distBucket = findBucket(profile.byDistance, dist);
  if (distBucket && distBucket.total >= 5 && distBucket.topWinRate != null) {
    historicalRates.push(`${dist} ${distBucket.topWinRate}%`);
    if (distBucket.topWinRate >= 52) score += 1;
    else if (distBucket.topWinRate < 38) {
      score -= 1;
      reasons.push(`${dist}: ettan vinner sällan (${distBucket.topWinRate}%).`);
    }
  }

  const fieldBucket = findBucket(profile.byFieldSize, fieldBand);
  if (fieldBucket && fieldBucket.total >= 5 && fieldBucket.topWinRate != null && fieldSize >= 12) {
    score -= 1;
    if (fieldBucket.topWinRate < 45) {
      reasons.push(`Stort fält (${fieldSize}) — ettan vinner ${fieldBucket.topWinRate}%.`);
    }
  } else if (fieldBucket && fieldSize <= 8 && (fieldBucket.topWinRate ?? 0) >= 50) {
    score += 1;
  }

  const weakTags = ['Stodivisionen', 'Klass I', 'Bronsdivisionen'];
  for (const tag of raceProfile.tags) {
    const tagBucket = findBucket(profile.byRaceCategory, tag);
    if (!tagBucket || tagBucket.total < 3 || tagBucket.topWinRate == null) continue;
    if (weakTags.includes(tag) && tagBucket.topWinRate < 45) {
      score -= 2;
      reasons.push(`${tag}: ettan vinner ${tagBucket.topWinRate}% — gardera.`);
      historicalRates.push(`${tag} ${tagBucket.topWinRate}%`);
      break;
    }
    if (tag === 'Stolopp' && tagBucket.topWinRate >= 52) {
      score += 1;
      historicalRates.push(`${tag} ${tagBucket.topWinRate}%`);
    }
  }

  let label: SpikeEttaLabel;
  let summary: string;
  if (score >= 4) {
    label = 'Stark spik';
    summary = 'Ettan i Trot Score är en stark spik-kandidat utifrån marginal och banhistorik.';
  } else if (score >= 2) {
    label = 'Spik-kandidat';
    summary = 'Ettan kan spikas om du vill spela säkrare — mönstret stödjer oftast ettan.';
  } else if (score >= 0) {
    label = 'Tveksam';
    summary = 'Blandat underlag — överväg tvåan eller gardera med rank 3–4.';
  } else {
    label = 'Gardera';
    summary = 'Ettan vinner sällan i denna profil — gardera brett och ta med tvåan.';
  }

  return {
    label,
    summary,
    reasons: reasons.slice(0, 3),
    margin12: margin,
    historicalRates: historicalRates.slice(0, 4),
  };
}

export function formatLegSpikeRecommendation(rec: LegSpikeRecommendation): string {
  const hist = rec.historicalRates.length > 0 ? ` Historiskt (${rec.historicalRates.join(' · ')}).` : '';
  const detail = rec.reasons.length > 0 ? ` ${rec.reasons.join(' ')}` : '';
  return `${rec.label} — ${rec.summary}${hist}${detail}`;
}

export function spikeLabelCssClass(label: SpikeEttaLabel): string {
  switch (label) {
    case 'Stark spik':
      return 'spike-stark';
    case 'Spik-kandidat':
      return 'spike-kandidat';
    case 'Tveksam':
      return 'spike-tveksam';
    default:
      return 'spike-gardera';
  }
}
