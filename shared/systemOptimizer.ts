import type { GameSystemPlan, SystemLegSuggestion } from './types.js';

/** Ingen konstlad övre gräns — hela fältet med Trot Score. */
export const DEFAULT_MAX_PICKS_PER_LEG = 0;

export interface SystemLegOptimizeInput {
  legId: number;
  legNumber: number;
  trackRaceNumber: number | null;
  rankedHorses: Array<{ startNumber: number; horseName: string; trotScore: number }>;
  baseSuggestion: SystemLegSuggestion;
  /** Föreslagen spik — låst till 1 häst i radoptimering. */
  lockedSpik?: boolean;
}

export interface RowTargetSystemPlan extends GameSystemPlan {
  minRows: number;
  maxRows: number;
  inTargetRange: boolean;
  message: string | null;
  pickCounts: number[];
}

export function systemRowProduct(pickCounts: number[]): number {
  return pickCounts.reduce((product, count) => product * Math.max(1, count), 1);
}

function buildLegPlan(
  leg: SystemLegOptimizeInput,
  requestedPickCount: number,
): GameSystemPlan['legs'][number] {
  const ranked =
    leg.rankedHorses.length > 0 ? leg.rankedHorses : leg.baseSuggestion.picks;
  const maxAllowed = leg.lockedSpik ? 1 : ranked.length;
  const pickCount = Math.min(Math.max(1, requestedPickCount), maxAllowed);
  const picks = ranked.slice(0, pickCount);
  const base = leg.baseSuggestion;
  const isSpik = leg.lockedSpik || (picks.length === 1 && base.strategy === 'spik');

  return {
    legId: leg.legId,
    legNumber: leg.legNumber,
    trackRaceNumber: leg.trackRaceNumber,
    strategy: isSpik ? 'spik' : 'gardering',
    recommendedPickCount: picks.length,
    picks,
    uncertaintyScore: base.uncertaintyScore,
    reasons: base.reasons,
    scoreMarginTop2: base.scoreMarginTop2,
    scoreMarginTop3: base.scoreMarginTop3,
  };
}

export interface SessionLegPlanInput {
  id: number;
  legNumber: number;
  trackRaceNumber: number | null;
  rankedHorses: Array<{ startNumber: number; horseName: string; trotScore: number }>;
  systemSuggestion: SystemLegSuggestion | null;
}

export function buildPlanFromSessionLegs(
  legs: SessionLegPlanInput[],
  pickCounts: number[],
  spikeLegIds: Set<number> = new Set(),
  rowTarget?: { minRows: number; maxRows: number },
): GameSystemPlan | RowTargetSystemPlan {
  const eligible = legs.filter(
    (leg) =>
      leg.systemSuggestion &&
      (leg.rankedHorses.length > 0 || leg.systemSuggestion.picks.length > 0),
  );

  const optimizeInputs: SystemLegOptimizeInput[] = eligible.map((leg) => ({
    legId: leg.id,
    legNumber: leg.legNumber,
    trackRaceNumber: leg.trackRaceNumber,
    rankedHorses:
      leg.rankedHorses.length > 0 ? leg.rankedHorses : leg.systemSuggestion!.picks,
    baseSuggestion: leg.systemSuggestion!,
    lockedSpik: spikeLegIds.has(leg.id),
  }));

  const counts = eligible.map((_, i) => pickCounts[i] ?? 1);

  if (rowTarget) {
    return buildPlanFromPickCounts(
      optimizeInputs,
      counts,
      rowTarget.minRows,
      rowTarget.maxRows,
    );
  }

  const planLegs = optimizeInputs.map((leg, i) => buildLegPlan(leg, counts[i] ?? 1));
  const effectivePickCounts = planLegs.map((leg) => leg.picks.length);
  let spikeCount = 0;
  let garderingCount = 0;
  for (const leg of planLegs) {
    if (leg.strategy === 'spik') spikeCount++;
    else garderingCount++;
  }

  return {
    legs: planLegs,
    totalRowsEstimate: systemRowProduct(effectivePickCounts),
    spikeCount,
    garderingCount,
  };
}

function buildPlanFromPickCounts(
  legs: SystemLegOptimizeInput[],
  pickCounts: number[],
  minRows: number,
  maxRows: number,
): RowTargetSystemPlan {
  const planLegs = legs.map((leg, i) => buildLegPlan(leg, pickCounts[i] ?? 1));
  const effectivePickCounts = planLegs.map((leg) => leg.picks.length);
  const totalRowsEstimate = systemRowProduct(effectivePickCounts);
  const spikeCount = planLegs.filter((l) => l.strategy === 'spik').length;
  const garderingCount = planLegs.length - spikeCount;
  const inTargetRange = totalRowsEstimate >= minRows && totalRowsEstimate <= maxRows;

  let message: string | null = null;
  if (!inTargetRange) {
    const lockedCount = legs.filter((l) => l.lockedSpik).length;
    if (totalRowsEstimate < minRows) {
      message =
        lockedCount > 0
          ? `Kunde inte nå ${minRows.toLocaleString('sv-SE')} rader med ${lockedCount} låsta spikar och tillgängliga hästar i övriga avdelningar.`
          : `Kunde inte nå ${minRows.toLocaleString('sv-SE')} rader med tillgängliga hästar per avdelning.`;
    } else {
      message = `Kunde inte hålla sig under ${maxRows.toLocaleString('sv-SE')} rader.`;
    }
  }

  return {
    legs: planLegs,
    totalRowsEstimate,
    spikeCount,
    garderingCount,
    minRows,
    maxRows,
    inTargetRange,
    message,
    pickCounts: effectivePickCounts,
  };
}

function expandPriority(leg: SystemLegOptimizeInput, currentPicks: number): number {
  if (leg.lockedSpik) return -Infinity;

  const base = leg.baseSuggestion;
  let score = base.uncertaintyScore;

  if (base.scoreMarginTop2 != null && base.scoreMarginTop2 < 3) score += 2;
  if (currentPicks < base.recommendedPickCount) score += 1.5;
  if (base.strategy === 'gardering') score += 0.5;

  return score;
}

function shrinkPriority(leg: SystemLegOptimizeInput, currentPicks: number): number {
  const base = leg.baseSuggestion;
  let score = currentPicks * 2 - base.uncertaintyScore;

  if (leg.lockedSpik && currentPicks <= 1) return -Infinity;
  if (base.scoreMarginTop2 != null && base.scoreMarginTop2 >= 3) score += 1;

  return score;
}

export function optimizeSystemForRowTarget(
  legs: SystemLegOptimizeInput[],
  minRows: number,
  maxRows: number,
  maxPicksPerLeg = DEFAULT_MAX_PICKS_PER_LEG,
): RowTargetSystemPlan {
  if (legs.length === 0) {
    return {
      legs: [],
      totalRowsEstimate: 0,
      spikeCount: 0,
      garderingCount: 0,
      minRows,
      maxRows,
      inTargetRange: false,
      message: 'Inga avdelningar att bygga system från.',
      pickCounts: [],
    };
  }

  let lo = minRows;
  let hi = maxRows;
  if (lo > hi) [lo, hi] = [hi, lo];

  const maxPicks = legs.map((leg) => {
    const ranked =
      leg.rankedHorses.length > 0 ? leg.rankedHorses : leg.baseSuggestion.picks;
    if (leg.lockedSpik) return 1;
    const fieldCap = Math.max(1, ranked.length);
    return maxPicksPerLeg > 0 ? Math.min(maxPicksPerLeg, fieldCap) : fieldCap;
  });

  const pickCounts = legs.map((leg, i) => {
    if (leg.lockedSpik) return 1;
    return Math.max(1, Math.min(leg.baseSuggestion.recommendedPickCount, maxPicks[i]));
  });

  const targetMid = (lo + hi) / 2;

  let guard = 0;
  while (systemRowProduct(pickCounts) < lo && guard < 200) {
    guard++;
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < legs.length; i++) {
      if (legs[i].lockedSpik || pickCounts[i] >= maxPicks[i]) continue;

      const newProduct = systemRowProduct(
        pickCounts.map((count, j) => (j === i ? count + 1 : count)),
      );
      if (newProduct > hi * 2) continue;

      const inRange = newProduct >= lo && newProduct <= hi;
      const distanceImprovement =
        Math.abs(targetMid - systemRowProduct(pickCounts)) -
        Math.abs(targetMid - newProduct);

      const score =
        expandPriority(legs[i], pickCounts[i]) +
        (inRange ? 50 : 0) +
        distanceImprovement / Math.max(targetMid, 1) +
        (newProduct <= hi ? 5 : 0);

      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) break;
    pickCounts[bestIndex]++;
  }

  guard = 0;
  while (systemRowProduct(pickCounts) > hi && guard < 200) {
    guard++;
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < legs.length; i++) {
      if (legs[i].lockedSpik || pickCounts[i] <= 1) continue;

      const score = shrinkPriority(legs[i], pickCounts[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) break;
    pickCounts[bestIndex]--;
  }

  guard = 0;
  while (guard < 100) {
    guard++;
    const product = systemRowProduct(pickCounts);
    if (product >= lo && product <= hi) break;

    if (product < lo) {
      let bestIndex = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < legs.length; i++) {
        if (legs[i].lockedSpik || pickCounts[i] >= maxPicks[i]) continue;
        const newProduct = systemRowProduct(
          pickCounts.map((c, j) => (j === i ? c + 1 : c)),
        );
        if (newProduct > hi) continue;
        const score = expandPriority(legs[i], pickCounts[i]) - Math.abs(targetMid - newProduct);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      if (bestIndex === -1) break;
      pickCounts[bestIndex]++;
    } else if (product > hi) {
      let bestIndex = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < legs.length; i++) {
        if (legs[i].lockedSpik || pickCounts[i] <= 1) continue;
        const score = shrinkPriority(legs[i], pickCounts[i]);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      if (bestIndex === -1) break;
      pickCounts[bestIndex]--;
    }
  }

  return buildPlanFromPickCounts(legs, pickCounts, lo, hi);
}
