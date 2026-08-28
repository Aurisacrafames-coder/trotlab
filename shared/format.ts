import { normalizeStartMethod, type StartMethod } from './scoring.js';

export type VolteRow = 'front' | 'back';

const KM_TIME_CODES: Record<string, string> = {
  u: 'Ute',
  ut: 'Ute',
  utg: 'Ute',
  dist: 'Dist',
  str: 'Str',
  d: 'Disk',
  disk: 'Disk',
  tr: 'Tr',
  tr1: 'Tr',
  k: 'K',
};

/** Distansband för bananalys — 1640 m räknas som kort. */
export function distanceBandLabel(distance: number | null): string {
  if (distance == null) return 'Okänd distans';
  if (distance <= 1640) return `Kort (${distance} m)`;
  if (distance <= 2140) return `Mellan (${distance} m)`;
  return `Lång (${distance} m)`;
}

export function formatKmTimeLabel(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const mapped = KM_TIME_CODES[value.toLowerCase()];
  if (mapped) return mapped;
  if (/^\d+$/.test(value)) return `${value}:e`;
  return value;
}

export function formatPostPositionLabel(
  postPosition: number | null,
  startMethod: StartMethod,
  volteRow: VolteRow | null,
): string {
  if (postPosition == null) return '—';
  if (normalizeStartMethod(startMethod) === 'volte' && volteRow) {
    return `${postPosition} (${volteRow === 'front' ? 'fr' : 'bak'})`;
  }
  return String(postPosition);
}

export function formatGameLegLabel(
  gameType: string,
  legNumber: number,
  trackRaceNumber?: number | null,
): string {
  const leg = `${gameType} avd ${legNumber}`;
  if (trackRaceNumber != null) {
    return `${leg} · lopp ${trackRaceNumber}`;
  }
  return leg;
}

export function formatTrackRaceLabel(trackRaceNumber: number | null | undefined): string | null {
  if (trackRaceNumber == null) return null;
  return `Lopp ${trackRaceNumber}`;
}

export function formatScheduledStart(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null) return null;
  return `${meters} m`;
}

/** ATG kmTime.code indicating personal record (rekordtid). */
export function isRecordTimeCode(code: string | null | undefined): boolean {
  const value = (code ?? '').trim().toLowerCase();
  return value === 'r' || value === 'rr' || value === 'rek' || value === 'rec';
}

/** Stored/display km time ending with r after the tenths digit, e.g. 1.12,3r. */
export function isRecordTimeLabel(kmTime: string | null | undefined): boolean {
  if (!kmTime) return false;
  return /^\d+\.\d{2},\dr$/i.test(kmTime.trim());
}

export interface RecentFormStartInput {
  date: string | null;
  place: string | null;
  kmTime?: string | null;
  prizeFirst?: number | null;
  isRecordTime?: boolean | null;
}

/** Prissumma (1:a pris) som skiljer låg/hög poäng för vinst senaste start. */
export const RECENT_WIN_HIGH_PRIZE_KR = 70_000;

export function resolveRecentWinIsRecordTime(start: RecentFormStartInput): boolean {
  if (start.isRecordTime === true) return true;
  if (start.isRecordTime === false) return false;
  return isRecordTimeLabel(start.kmTime);
}

export function kmTimePartsToMs(km?: {
  minutes?: number;
  seconds?: number;
  tenths?: number;
} | null): number | null {
  if (km?.minutes == null || km.seconds == null || km.tenths == null) return null;
  return km.minutes * 60_000 + km.seconds * 1000 + km.tenths * 100;
}

export function kmTimeStringToMs(kmTime: string | null | undefined): number | null {
  if (!kmTime) return null;
  const m = kmTime.trim().match(/^(\d+)\.(\d{2}),(\d)r?$/i);
  if (!m) return null;
  return parseInt(m[1], 10) * 60_000 + parseInt(m[2], 10) * 1000 + parseInt(m[3], 10) * 100;
}

/** Format ATG kmTime for storage/display, preserving record marker as trailing r. */
export function formatKmTimeForStorage(km?: {
  minutes?: number;
  seconds?: number;
  tenths?: number;
  code?: string;
} | null): string | null {
  if (!km) return null;
  const code = km.code ?? null;
  const isRecord = isRecordTimeCode(code);
  const { minutes, seconds, tenths } = km;
  const hasTime = minutes != null && seconds != null && tenths != null;
  const timeStr = hasTime
    ? `${minutes}.${seconds.toString().padStart(2, '0')},${tenths}`
    : null;

  if (isRecord && timeStr) return `${timeStr}r`;
  if (code && !hasTime) return formatKmTimeLabel(code);
  return timeStr;
}

/** Detect if a form row was a record-time win using ATG code or horse statistics. */
export function detectFormRecordTime(
  form: {
    date?: string | null;
    place?: string | null;
    kmTime?: { minutes?: number; seconds?: number; tenths?: number; code?: string };
  },
  horseStats?: {
    life?: {
      records?: Array<{
        time?: { minutes?: number; seconds?: number; tenths?: number };
        place?: number;
        year?: string;
      }>;
    };
  } | null,
): boolean {
  if (isRecordTimeCode(form.kmTime?.code)) return true;

  if (form.place !== '1') return false;

  const formMs = kmTimePartsToMs(form.kmTime);
  if (formMs == null) return false;

  const year = form.date?.slice(0, 4);
  for (const rec of horseStats?.life?.records ?? []) {
    const recMs = kmTimePartsToMs(rec.time);
    if (recMs == null || rec.place !== 1) continue;
    if (recMs === formMs && (!rec.year || rec.year === year)) return true;
  }

  return false;
}

/** ATG kmTime.code or stored form label indicating galopp (counts as plats 0 in form). */
export function isGaloppFormIndicator(
  place: string | null | undefined,
  kmTimeOrCode: string | null | undefined,
): boolean {
  if (place === '0') return true;
  const value = (kmTimeOrCode ?? '').trim().toLowerCase();
  if (!value) return false;
  if (value.startsWith('kub')) return true;
  if (value === 'vänd' || value === 'vand') return true;
  if (value === 'g' || value === 'gal') return true;
  return false;
}

/** Placement used for form scoring — galopp → "0" even when ATG only sends kmTime code. */
export function effectiveFormPlace(
  place: string | null | undefined,
  kmTimeOrCode?: string | null | undefined,
): string | null {
  if (isGaloppFormIndicator(place, kmTimeOrCode)) return '0';
  if (place != null && place !== '') return place;
  const code = (kmTimeOrCode ?? '').trim();
  if (code && /^\d+$/.test(code)) return code;
  return null;
}

export function resolveFormPlace(
  place: string | null | undefined,
  kmTimeCode: string | null | undefined,
): string | null {
  return effectiveFormPlace(place, kmTimeCode);
}

/** Max realistic finish position in a harness race. */
export const MAX_REALISTIC_PLACEMENT = 15;

export interface AtgResultPlacement {
  place?: number;
  finishOrder?: number;
  galloped?: boolean;
  disqualified?: boolean;
}

/** Normalize ATG result to a displayable placement (0 = DQ/galopp utan placering, null = unknown). */
export function resolveActualPlacement(result?: AtgResultPlacement | null): number | null {
  if (!result) return null;
  if (result.disqualified) return 0;
  if (
    result.place != null &&
    result.place > 0 &&
    result.place <= MAX_REALISTIC_PLACEMENT
  ) {
    return result.place;
  }
  if (
    result.finishOrder != null &&
    result.finishOrder > 0 &&
    result.finishOrder <= MAX_REALISTIC_PLACEMENT
  ) {
    return result.finishOrder;
  }
  if (result.galloped) return 0;
  if (
    (result.finishOrder != null && result.finishOrder > MAX_REALISTIC_PLACEMENT) ||
    (result.place != null && result.place > MAX_REALISTIC_PLACEMENT)
  ) {
    return 0;
  }
  return null;
}

export function formatActualPosition(position: number | null | undefined): string {
  if (position === 0) return 'G';
  if (position == null) return '—';
  if (position > MAX_REALISTIC_PLACEMENT) return 'G';
  return String(position);
}

export function actualPositionTitle(position: number | null | undefined): string | undefined {
  if (position === 0) return 'Diskvalificerad eller galopp utan godkänd placering';
  if (position == null) return 'Resultat saknas';
  return `Placering ${position}`;
}

/** Stored weight value (0–100). Not a percentage budget — only ratios matter. */
export function formatWeightValue(weight: number): string {
  return String(Math.round(weight));
}

/** Parameter's share of total influence when weights are relative. */
export function formatWeightShare(weight: number, totalWeight: number): string {
  if (totalWeight <= 0) return '0%';
  return `${Math.round((weight / totalWeight) * 100)}%`;
}

export function formatWeightSummary(
  params: Array<{ name: string; weight: number }>,
): string {
  const active = params.filter((p) => p.weight > 0);
  const total = active.reduce((s, p) => s + p.weight, 0);
  if (total === 0) return '—';
  return active
    .map((p) => `${p.name} ${formatWeightShare(p.weight, total)}`)
    .join(' · ');
}
