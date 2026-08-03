import type { Parameter } from '../shared/types.js';
import { effectiveFormPlace, resolveRecentWinIsRecordTime, RECENT_WIN_HIGH_PRIZE_KR } from './format.js';

export type StartMethod = 'auto' | 'volte' | string | null;

export function normalizeStartMethod(method: StartMethod): 'auto' | 'volte' | null {
  if (!method) return null;
  const m = method.toLowerCase();
  if (m === 'auto' || m === 'autostart') return 'auto';
  if (m === 'volte' || m === 'voltstart') return 'volte';
  return null;
}

export function formatStartMethodLabel(method: StartMethod): string | null {
  const normalized = normalizeStartMethod(method);
  if (normalized === 'auto') return 'Autostart';
  if (normalized === 'volte') return 'Voltstart';
  return method ? String(method) : null;
}

export type VolteRow = 'front' | 'back';

/** Fram- eller bakspår i volt utifrån startdistans jämfört med fältets kortaste. */
export function volteRowFromDistance(
  startMethod: StartMethod,
  distance: number | null,
  fieldDistances: Array<number | null>,
): VolteRow | null {
  if (normalizeStartMethod(startMethod) !== 'volte') return null;
  if (distance == null) return null;
  const numeric = fieldDistances.filter((d): d is number => d != null);
  if (numeric.length === 0) return null;
  return distance > Math.min(...numeric) ? 'back' : 'front';
}

/** Cache-/lookup-nyckel för spårvinst% (autostart = tom sträng). */
export function trackPostVolteRowKey(volteRow: VolteRow | null | undefined): string {
  return volteRow ?? '';
}

export interface ScoreInput {
  startPoints: number | null;
  earningsPerStart: number | null;
  /** All horses in the race — used for field-relative class scoring. */
  fieldStartPoints?: Array<number | null>;
  fieldEarningsPerStart?: Array<number | null>;
  startDistance: number | null;
  /** All horses' start distances — for volt handicap penalty. */
  fieldStartDistances?: Array<number | null>;
  formPlace: number | null;
  postPosition: number | null;
  startMethod?: StartMethod;
  fieldSize?: number;
  volteRow?: 'front' | 'back' | null;
  driverTrackWinPct: number | null;
  driverGlobalWinPct: number | null;
  driverWinPctOverride: number | null;
  trackPostWinPct: number | null;
  trainerWinPct: number | null;
  recentFormStarts?: Array<{
    date: string | null;
    place: string | null;
    kmTime?: string | null;
    prizeFirst?: number | null;
    isRecordTime?: boolean | null;
  }>;
  raceDate?: string;
  manualScores: Record<string, number>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/** Share of field-relative vs absolute when scoring class parameters within a race. */
export const CLASS_FIELD_WEIGHT = 0.7;
export const CLASS_ABSOLUTE_WEIGHT = 0.3;

/** Absolute scale caps (typical elite V86 horse ≈ 10). */
export const START_POINTS_ABSOLUTE_MAX = 60_000;
export const EARNINGS_PER_START_ABSOLUTE_MAX = 500_000;
export const FORM_NEUTRAL_SCORE = 5;

/** Map ATG startpoäng to 0–10 on an absolute scale. */
export function autoStartPointsAbsolute(points: number | null): number {
  if (points == null || points <= 0) return 0;
  return clamp((points / START_POINTS_ABSOLUTE_MAX) * 10, 0, 10);
}

/** Map kr/start to 0–10 on an absolute scale. */
export function autoEarningsPerStartAbsolute(kr: number | null): number {
  if (kr == null || kr <= 0) return 0;
  return clamp((kr / EARNINGS_PER_START_ABSOLUTE_MAX) * 10, 0, 10);
}

/** Rank a value 0–10 against other horses in the same race. */
export function fieldRelativeScore(
  value: number | null,
  field: Array<number | null>,
  neutral = FORM_NEUTRAL_SCORE,
): number {
  const values = field.filter((v): v is number => v != null && v > 0);
  if (value == null || value <= 0) return 0;
  if (values.length === 0) return neutral;
  if (values.length === 1) return value >= values[0]! ? 10 : 0;

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max <= min) return neutral;

  return clamp(((value - min) / (max - min)) * 10, 0, 10);
}

function blendClassScore(fieldScore: number, absoluteScore: number): number {
  const blended =
    fieldScore * CLASS_FIELD_WEIGHT + absoluteScore * CLASS_ABSOLUTE_WEIGHT;
  return Math.round(blended * 10) / 10;
}

function hybridClassScore(
  value: number | null,
  field: Array<number | null> | undefined,
  absoluteFn: (v: number | null) => number,
): number {
  const absolute = absoluteFn(value);
  if (!field?.length) return Math.round(absolute * 10) / 10;

  const positiveCount = field.filter((v) => v != null && v > 0).length;
  if (positiveCount <= 1) return Math.round(absolute * 10) / 10;

  const fieldScore = fieldRelativeScore(value, field);
  return blendClassScore(fieldScore, absolute);
}

/** Hybrid: 70 % field-relative + 30 % absolute startpoäng. */
export function autoStartPoints(
  points: number | null,
  field?: Array<number | null>,
): number {
  return hybridClassScore(points, field, autoStartPointsAbsolute);
}

/** Hybrid: 70 % field-relative + 30 % absolute kr/start. */
export function autoEarningsPerStart(
  kr: number | null,
  field?: Array<number | null>,
): number {
  return hybridClassScore(kr, field, autoEarningsPerStartAbsolute);
}

const FORM_LOOKBACK_MONTHS = 4;
const RECENT_WIN_LOOKBACK_MONTHS = 2;
/** Extra poäng on top of base win score when latest win was a record time or two wins in a row. */
export const RECENT_WIN_RECORD_BONUS = 2;
/** Meters behind shortest mark before start-distance penalty applies. */
export const START_DISTANCE_PENALTY_THRESHOLD_M = 20;

export { FORM_LOOKBACK_MONTHS };

function isStartWithinLookback(startDate: string, raceDate: string, months: number): boolean {
  const start = new Date(`${startDate}T12:00:00`);
  const race = new Date(`${raceDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(race.getTime())) return false;

  const cutoff = new Date(race);
  cutoff.setMonth(cutoff.getMonth() - months);
  return start >= cutoff && start <= race;
}

function placeToFormScore(place: string): number {
  const n = parseInt(place, 10);
  if (Number.isNaN(n) || n === 0) return 1;
  if (n === 1) return 10;
  if (n === 2) return 8;
  if (n === 3) return 6;
  if (n <= 5) return 4;
  return 2;
}

/** How much to trust raw form average from number of qualifying starts (4-month window). */
export function formConfidenceForStartCount(startCount: number): number {
  if (startCount <= 0) return 0;
  if (startCount === 1) return 0.5;
  if (startCount === 2) return 0.75;
  return 1;
}

export function isFormStartQualifying(
  start: { date: string | null; place: string | null; kmTime?: string | null },
  raceDate: string,
): boolean {
  const place = effectiveFormPlace(start.place, start.kmTime);
  return Boolean(
    start.date &&
      place != null &&
      isStartWithinLookback(start.date, raceDate, FORM_LOOKBACK_MONTHS),
  );
}

export function countQualifyingFormStarts(
  starts: Array<{ date: string | null; place: string | null; kmTime?: string | null }>,
  raceDate: string,
): number {
  return starts.filter((s) => isFormStartQualifying(s, raceDate)).slice(0, 5).length;
}

/** Average placement from recent starts within lookback months (max 5): 1st=10 … galopp=1 */
export function autoFormPlace(
  starts: Array<{ date: string | null; place: string | null; kmTime?: string | null }>,
  raceDate: string,
): number {
  const recent = starts
    .filter((s) => isFormStartQualifying(s, raceDate))
    .slice(0, 5);

  if (recent.length === 0) return FORM_NEUTRAL_SCORE;

  const rawAverage =
    recent
      .map((s) => placeToFormScore(effectiveFormPlace(s.place, s.kmTime)!))
      .reduce((a, b) => a + b, 0) / recent.length;

  const confidence = formConfidenceForStartCount(recent.length);
  const blended = rawAverage * confidence + FORM_NEUTRAL_SCORE * (1 - confidence);

  return Math.round(blended * 10) / 10;
}

/** Autostart: inner lanes score higher; volte: middle lanes score higher */
export function autoPostPosition(
  lane: number | null,
  startMethod: StartMethod = null,
  fieldSize = 12,
): number {
  if (lane == null) return 5;

  const size = Math.max(fieldSize, lane, 2);
  const method = normalizeStartMethod(startMethod);

  if (method === 'auto') {
    return clamp(10 - (lane - 1) * (9 / (size - 1)), 0, 10);
  }

  const mid = (size + 1) / 2;
  const dist = Math.abs(lane - mid);
  const maxDist = Math.max(mid - 1, size - mid);
  const penalty = maxDist > 0 ? (dist / maxDist) * 9 : 0;
  return clamp(10 - penalty, 0, 10);
}

/** Share of track vs global when combining kusk vinst% to a score. */
export const DRIVER_TRACK_WIN_WEIGHT = 0.6;
export const DRIVER_GLOBAL_WIN_WEIGHT = 0.4;

/** Map kusk/tränare vinst% (typical 0–25) to 0–10 */
export function autoDriverV85Win(winPercent: number | null): number {
  if (winPercent == null) return 5;
  return clamp((winPercent / 25) * 10, 0, 10);
}

/** Combine bana + totalt kusk vinst% till en poäng (0–10). */
export function autoDriverWinCombined(
  trackPct: number | null,
  globalPct: number | null,
): number {
  const trackScore = autoDriverV85Win(trackPct);
  const globalScore = autoDriverV85Win(globalPct);

  if (trackPct != null && globalPct != null) {
    return (
      trackScore * DRIVER_TRACK_WIN_WEIGHT + globalScore * DRIVER_GLOBAL_WIN_WEIGHT
    );
  }
  if (trackPct != null) return trackScore;
  if (globalPct != null) return globalScore;
  return 5;
}

export function autoDriverWinScore(input: {
  driverTrackWinPct: number | null;
  driverGlobalWinPct: number | null;
  driverWinPctOverride: number | null;
}): number {
  if (input.driverWinPctOverride != null) {
    return autoDriverV85Win(input.driverWinPctOverride);
  }
  return autoDriverWinCombined(input.driverTrackWinPct, input.driverGlobalWinPct);
}

export function autoTrainerWin(winPercent: number | null): number {
  return autoDriverV85Win(winPercent);
}

/** Map track lane win % (typical 0–20) to 0–10 */
export function autoTrackPostWin(winPercent: number | null): number {
  if (winPercent == null) return 5;
  return clamp((winPercent / 20) * 10, 0, 10);
}

/** Graded score if latest start was a win within lookback months before race day, else 0. */
function isRecentWinStart(
  start:
    | {
        date: string | null;
        place: string | null;
        kmTime?: string | null;
      }
    | null
    | undefined,
  raceDate: string,
): boolean {
  const placeStr = effectiveFormPlace(start?.place, start?.kmTime);
  if (!start?.date || placeStr == null) return false;
  const place = parseInt(placeStr, 10);
  if (place !== 1) return false;
  return isStartWithinLookback(start.date, raceDate, RECENT_WIN_LOOKBACK_MONTHS);
}

export function autoRecentWin(
  latestStart: {
    date: string | null;
    place: string | null;
    kmTime?: string | null;
    prizeFirst?: number | null;
    isRecordTime?: boolean | null;
  } | null | undefined,
  raceDate: string,
  previousStart?: {
    date: string | null;
    place: string | null;
    kmTime?: string | null;
    prizeFirst?: number | null;
    isRecordTime?: boolean | null;
  } | null,
): number {
  if (!isRecentWinStart(latestStart, raceDate)) return 0;

  const highPrize = (latestStart!.prizeFirst ?? 0) >= RECENT_WIN_HIGH_PRIZE_KR;
  const record = resolveRecentWinIsRecordTime(latestStart!);
  const twoWinsInRow = isRecentWinStart(previousStart, raceDate);
  const base = highPrize ? 7 : 3;
  if (!record && !twoWinsInRow) return base;
  return Math.min(10, base + RECENT_WIN_RECORD_BONUS);
}

/** Score 0–10 for volt/autostart distance handicap vs shortest mark in the field. */
export function autoStartDistancePenalty(
  startDistance: number | null,
  field?: Array<number | null>,
): number {
  if (startDistance == null) return FORM_NEUTRAL_SCORE;

  const distances = field?.filter((d): d is number => d != null) ?? [];
  if (distances.length === 0) return FORM_NEUTRAL_SCORE;

  const extra = startDistance - Math.min(...distances);
  if (extra < START_DISTANCE_PENALTY_THRESHOLD_M) return FORM_NEUTRAL_SCORE;
  if (extra >= 40) return 2;
  if (extra >= 30) return 3;
  return 4;
}

export function buildAutoScores(input: ScoreInput, parameters: Parameter[]): Record<string, number> {
  const scores: Record<string, number> = { ...input.manualScores };

  for (const param of parameters) {
    if (!param.autoKey || scores[param.id] != null) continue;

    switch (param.autoKey) {
      case 'startPoints':
        scores[param.id] = autoStartPoints(input.startPoints, input.fieldStartPoints);
        break;
      case 'earningsPerStart':
        scores[param.id] = autoEarningsPerStart(
          input.earningsPerStart,
          input.fieldEarningsPerStart,
        );
        break;
      case 'formPlace':
        scores[param.id] = input.formPlace ?? 5;
        break;
      case 'driverV85Win':
        scores[param.id] = autoDriverWinScore({
          driverTrackWinPct: input.driverTrackWinPct,
          driverGlobalWinPct: input.driverGlobalWinPct,
          driverWinPctOverride: input.driverWinPctOverride,
        });
        break;
      case 'trainerWin':
        scores[param.id] = autoTrainerWin(input.trainerWinPct);
        break;
      case 'trackPostWin':
        scores[param.id] = autoTrackPostWin(input.trackPostWinPct);
        break;
      case 'recentWin':
        scores[param.id] = autoRecentWin(
          input.recentFormStarts?.[0],
          input.raceDate ?? '',
          input.recentFormStarts?.[1],
        );
        break;
      case 'startDistancePenalty':
        scores[param.id] = autoStartDistancePenalty(
          input.startDistance,
          input.fieldStartDistances,
        );
        break;
    }
  }

  for (const param of parameters) {
    if (!param.autoKey && scores[param.id] == null) {
      scores[param.id] = 0;
    }
  }

  return scores;
}

export function calculateTrotScore(
  scores: Record<string, number>,
  parameters: Parameter[],
): number {
  const breakdown = calculateScoreBreakdown(scores, parameters);
  return breakdown.totalScore;
}

export interface ScoreBreakdownItem {
  parameterId: string;
  name: string;
  rawScore: number;
  normalizedScore: number;
  weight: number;
  contribution: number;
}

export interface ScoreBreakdown {
  items: ScoreBreakdownItem[];
  totalWeight: number;
  totalScore: number;
}

export function calculateScoreBreakdown(
  scores: Record<string, number>,
  parameters: Parameter[],
): ScoreBreakdown {
  const items: ScoreBreakdownItem[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const param of parameters) {
    const raw = scores[param.id];
    if (raw == null) continue;
    const normalized = normalize(raw, param.minScore, param.maxScore);
    const contribution = normalized * param.weight;
    weightedSum += contribution;
    totalWeight += param.weight;
    items.push({
      parameterId: param.id,
      name: param.name,
      rawScore: raw,
      normalizedScore: normalized,
      weight: param.weight,
      contribution,
    });
  }

  const totalScore =
    totalWeight === 0 ? 0 : Math.round((weightedSum / totalWeight) * 1000) / 10;

  return { items, totalWeight, totalScore };
}

/** Antal hästar med högst Trot Score som räknas vid träffbedömning. */
export const TOP_PICK_COUNT = 3;

export function evaluateTopPicksHit(
  actualPositions: Array<number | null | undefined>,
  goal: 'win' | 'top3',
): 'win' | 'top3' | 'miss' {
  const positions = actualPositions.filter((p): p is number => p != null && p > 0);
  if (positions.some((p) => p === 1)) return 'win';
  if (goal === 'top3' && positions.some((p) => p <= 3)) return 'top3';
  return 'miss';
}

export function isTopPicksHit(
  actualPositions: Array<number | null | undefined>,
  goal: 'win' | 'top3',
): boolean {
  return evaluateTopPicksHit(actualPositions, goal) !== 'miss';
}

export function evaluateTopPicksLegHit(
  actualPositions: Array<number | null | undefined>,
): 'win' | 'top3' | 'miss' {
  return evaluateTopPicksHit(actualPositions, 'top3');
}
