import type { GameSystemPlan } from './types.js';
import { systemRowProduct } from './systemOptimizer.js';
import type { SessionLegPlanInput } from './systemOptimizer.js';

export type LegSelections = Record<number, number[]>;

export function planToSelections(plan: GameSystemPlan): LegSelections {
  const out: LegSelections = {};
  for (const leg of plan.legs) {
    out[leg.legId] = leg.picks.map((p) => p.startNumber);
  }
  return out;
}

export function selectionsToPickCounts(
  eligibleLegs: SessionLegPlanInput[],
  selections: LegSelections,
): number[] {
  return eligibleLegs.map((leg) => {
    const nums = selections[leg.id];
    return nums?.length ? nums.length : 1;
  });
}

export function buildPlanFromSelections(
  eligibleLegs: SessionLegPlanInput[],
  selections: LegSelections,
  spikeLegIds: Set<number> = new Set(),
): GameSystemPlan {
  const planLegs = eligibleLegs.map((leg) => {
    const ranked =
      leg.rankedHorses.length > 0 ? leg.rankedHorses : leg.systemSuggestion!.picks;
    const selectedNumbers = selections[leg.id] ?? [];
    const selectedSet = new Set(selectedNumbers);
    let picks = ranked.filter((h) => selectedSet.has(h.startNumber));

    if (picks.length === 0 && ranked.length > 0) {
      picks = [ranked[0]];
    }

    const base = leg.systemSuggestion!;
    const lockedSpik = spikeLegIds.has(leg.id);
    const isSpik = lockedSpik || (picks.length === 1 && base.strategy === 'spik');

    return {
      legId: leg.id,
      legNumber: leg.legNumber,
      trackRaceNumber: leg.trackRaceNumber,
      strategy: isSpik ? ('spik' as const) : ('gardering' as const),
      recommendedPickCount: picks.length,
      picks,
      uncertaintyScore: base.uncertaintyScore,
      reasons: base.reasons,
      scoreMarginTop2: base.scoreMarginTop2,
      scoreMarginTop3: base.scoreMarginTop3,
    };
  });

  const pickCounts = planLegs.map((l) => l.picks.length);
  let spikeCount = 0;
  let garderingCount = 0;
  for (const leg of planLegs) {
    if (leg.strategy === 'spik') spikeCount++;
    else garderingCount++;
  }

  return {
    legs: planLegs,
    totalRowsEstimate: systemRowProduct(pickCounts),
    spikeCount,
    garderingCount,
  };
}

export function toggleLegHorse(
  selections: LegSelections,
  legId: number,
  startNumber: number,
): LegSelections {
  const current = selections[legId] ?? [];
  const has = current.includes(startNumber);
  if (has && current.length <= 1) return selections;

  const next = has
    ? current.filter((n) => n !== startNumber)
    : [...current, startNumber].sort((a, b) => a - b);

  return { ...selections, [legId]: next };
}
