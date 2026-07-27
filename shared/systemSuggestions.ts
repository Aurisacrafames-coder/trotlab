import { analyzeRaceTerms, type RaceTermFlags } from './raceTerms.js';
import { MIN_SPIKE_MARGIN, MIN_SPIKE_TOP_SCORE } from './spikeSuggestions.js';

export const SCORE_GARDER_MARGIN_TOP2 = 3;
export const SCORE_GARDER_MARGIN_TOP3 = 2;
export const MIN_CAREER_STARTS_EXPERIENCED = 8;
export const LOW_EARNINGS_PER_START_KR = 25_000;
export const CLASS_SPREAD_START_POINTS = 15_000;

export interface SystemLegEntryInput {
  startNumber: number;
  horseName: string;
  trotScore: number | null;
  startPoints: number | null;
  earningsPerStart: number | null;
  horseSex: string | null;
  careerStarts: number | null;
  driverApprentice: boolean;
}

export interface SystemLegInput {
  entries: SystemLegEntryInput[];
  terms: string[];
  raceFlags?: RaceTermFlags;
}

export interface SystemPick {
  startNumber: number;
  horseName: string;
  trotScore: number;
}

export interface SystemLegSuggestion {
  strategy: 'spik' | 'gardering';
  recommendedPickCount: number;
  picks: SystemPick[];
  uncertaintyScore: number;
  reasons: string[];
  scoreMarginTop2: number | null;
  scoreMarginTop3: number | null;
  raceFlags: RaceTermFlags;
}

export function analyzeSystemLeg(input: SystemLegInput): SystemLegSuggestion {
  const raceFlags = input.raceFlags ?? analyzeRaceTerms(input.terms);
  let uncertainty = 0;
  const reasons: string[] = [];

  if (raceFlags.mareRace) {
    uncertainty += 1.5;
    reasons.push('Stolopp / sto');
  }
  if (raceFlags.apprenticeRace) {
    uncertainty += 2;
    reasons.push('Lärlingslopp');
  }
  if (raceFlags.earningsRestricted) {
    uncertainty += 1.5;
    reasons.push('Intjäningskrav i loppet');
  }
  if (raceFlags.mixedClass) {
    uncertainty += 1.5;
    reasons.push('Blandade klasser');
  }
  if (raceFlags.youngAgeRace === '4') {
    uncertainty += 1;
    reasons.push('4-års lopp (oavsett kön)');
  } else if (raceFlags.youngAgeRace === '3') {
    uncertainty += 1.5;
    reasons.push('3-års lopp');
  }

  const inexperienced = input.entries.filter(
    (e) => e.careerStarts != null && e.careerStarts < MIN_CAREER_STARTS_EXPERIENCED,
  ).length;
  if (inexperienced >= 2) {
    uncertainty += 1.5;
    reasons.push(`${inexperienced} orutinerade hästar (färre än ${MIN_CAREER_STARTS_EXPERIENCED} starter)`);
  }

  const lowEarners = input.entries.filter(
    (e) => e.earningsPerStart != null && e.earningsPerStart < LOW_EARNINGS_PER_START_KR,
  ).length;
  if (lowEarners >= 3) {
    uncertainty += 1;
    reasons.push('Flera hästar med låg kr/start');
  }

  const mares = input.entries.filter((e) => e.horseSex === 'mare').length;
  if (mares >= 4 && !raceFlags.mareRace) {
    uncertainty += 1;
    reasons.push('Många ston i fältet');
  }

  const apprenticeDrivers = input.entries.filter((e) => e.driverApprentice).length;
  if (apprenticeDrivers >= 2) {
    uncertainty += 1;
    reasons.push('Flera lärlingar i loppet');
  }

  const startPointValues = input.entries
    .map((e) => e.startPoints)
    .filter((v): v is number => v != null && v > 0);
  if (startPointValues.length >= 3) {
    const spread = Math.max(...startPointValues) - Math.min(...startPointValues);
    if (spread >= CLASS_SPREAD_START_POINTS) {
      uncertainty += 2;
      reasons.push('Stor klasskillnad (startpoäng)');
    }
  }

  const sorted = [...input.entries]
    .filter((e) => e.trotScore != null)
    .sort((a, b) => b.trotScore! - a.trotScore! || a.startNumber - b.startNumber);

  const top = sorted[0];
  const second = sorted[1];
  const third = sorted[2];

  const margin12 =
    top?.trotScore != null && second?.trotScore != null
      ? Math.round((top.trotScore - second.trotScore) * 10) / 10
      : null;
  const margin23 =
    second?.trotScore != null && third?.trotScore != null
      ? Math.round((second.trotScore - third.trotScore) * 10) / 10
      : null;

  let pickCount = 1;

  const meetsSpikeCriteria =
    margin12 != null &&
    margin12 >= MIN_SPIKE_MARGIN &&
    (top?.trotScore ?? 0) >= MIN_SPIKE_TOP_SCORE;

  if (meetsSpikeCriteria) {
    pickCount = 1;
    const fieldNotes = [...reasons];
    reasons.length = 0;
    reasons.push(`Spik — marginal ${margin12} i Trot Score`);
    if (fieldNotes.length > 0) {
      reasons.push(`Ojämnt fält (${fieldNotes.join(' · ')}) — gardera andra avdelningar`);
    }
  } else {
    if (margin12 != null && margin12 < SCORE_GARDER_MARGIN_TOP2) {
      pickCount = 2;
      reasons.push(`Tight score-topp (marginal ${margin12} till tvåan)`);
    }
    if (margin23 != null && margin23 < SCORE_GARDER_MARGIN_TOP3 && pickCount >= 2) {
      pickCount = 3;
    }

    if (uncertainty >= 3) pickCount = Math.max(pickCount, 2);
    if (uncertainty >= 5) pickCount = Math.max(pickCount, 3);
    if (uncertainty >= 7) pickCount = Math.max(pickCount, 4);
  }

  pickCount = Math.min(Math.max(pickCount, 1), sorted.length, 5);

  const strategy: 'spik' | 'gardering' = meetsSpikeCriteria ? 'spik' : 'gardering';

  return {
    strategy,
    recommendedPickCount: pickCount,
    picks: sorted.slice(0, pickCount).map((e) => ({
      startNumber: e.startNumber,
      horseName: e.horseName,
      trotScore: e.trotScore!,
    })),
    uncertaintyScore: Math.round(uncertainty * 10) / 10,
    reasons: [...new Set(reasons)],
    scoreMarginTop2: margin12,
    scoreMarginTop3: margin23,
    raceFlags,
  };
}

export interface GameSystemPlan {
  legs: Array<SystemLegSuggestion & { legId: number; legNumber: number }>;
  totalRowsEstimate: number;
  spikeCount: number;
  garderingCount: number;
}

export function buildGameSystemPlan(
  legs: Array<SystemLegSuggestion & { legId: number; legNumber: number }>,
): GameSystemPlan {
  let totalRowsEstimate = 1;
  let spikeCount = 0;
  let garderingCount = 0;

  for (const leg of legs) {
    totalRowsEstimate *= leg.recommendedPickCount;
    if (leg.strategy === 'spik') spikeCount++;
    else garderingCount++;
  }

  return {
    legs,
    totalRowsEstimate,
    spikeCount,
    garderingCount,
  };
}
