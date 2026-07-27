import type { SpikeSuggestion } from './types.js';

export type { SpikeSuggestion };

export const MIN_SPIKE_MARGIN = 3;
export const MIN_SPIKE_TOP_SCORE = 55;
export const SPIKE_SUGGESTION_COUNT = 2;

export interface SpikeLegInput {
  legId: number;
  legNumber: number;
  trackRaceNumber: number | null;
  topStartNumber: number | null;
  topHorseName: string | null;
  topScore: number | null;
  secondStartNumber: number | null;
  secondHorseName: string | null;
  secondScore: number | null;
}

export interface SpikeMetrics {
  marginToSecond: number | null;
  spikeScore: number | null;
  meetsSpikeCriteria: boolean;
}

export function computeSpikeMetrics(
  topScore: number | null,
  secondScore: number | null,
): SpikeMetrics {
  if (topScore == null || secondScore == null) {
    return { marginToSecond: null, spikeScore: null, meetsSpikeCriteria: false };
  }

  const marginToSecond = Math.round((topScore - secondScore) * 10) / 10;
  const spikeScore = Math.round((marginToSecond + 0.25 * topScore) * 10) / 10;
  const meetsSpikeCriteria =
    marginToSecond >= MIN_SPIKE_MARGIN && topScore >= MIN_SPIKE_TOP_SCORE;

  return { marginToSecond, spikeScore, meetsSpikeCriteria };
}

export function pickSpikeSuggestions(
  legs: SpikeLegInput[],
  count = SPIKE_SUGGESTION_COUNT,
): SpikeSuggestion[] {
  const candidates: SpikeSuggestion[] = [];

  for (const leg of legs) {
    if (
      leg.topStartNumber == null ||
      !leg.topHorseName ||
      leg.topScore == null ||
      leg.secondScore == null
    ) {
      continue;
    }

    const metrics = computeSpikeMetrics(leg.topScore, leg.secondScore);
    if (!metrics.meetsSpikeCriteria || metrics.spikeScore == null || metrics.marginToSecond == null) {
      continue;
    }

    candidates.push({
      legId: leg.legId,
      legNumber: leg.legNumber,
      trackRaceNumber: leg.trackRaceNumber,
      startNumber: leg.topStartNumber,
      horseName: leg.topHorseName,
      topScore: leg.topScore,
      secondStartNumber: leg.secondStartNumber,
      secondHorseName: leg.secondHorseName,
      secondScore: leg.secondScore,
      marginToSecond: metrics.marginToSecond,
      spikeScore: metrics.spikeScore,
      rank: 0,
    });
  }

  candidates.sort((a, b) => {
    if (b.spikeScore !== a.spikeScore) return b.spikeScore - a.spikeScore;
    if (b.marginToSecond !== a.marginToSecond) return b.marginToSecond - a.marginToSecond;
    return a.legNumber - b.legNumber;
  });

  return candidates.slice(0, count).map((s, i) => ({ ...s, rank: i + 1 }));
}
