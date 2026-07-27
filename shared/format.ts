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

export function resolveFormPlace(
  place: string | null | undefined,
  kmTimeCode: string | null | undefined,
): string | null {
  if (place != null && place !== '') return place;
  if (kmTimeCode && /^\d+$/.test(kmTimeCode)) return kmTimeCode;
  return null;
}

/** Max realistic finish position in a harness race. */
export const MAX_REALISTIC_PLACEMENT = 15;

export function formatActualPosition(position: number | null | undefined): string {
  if (position == null || position === 0) return '—';
  if (position > MAX_REALISTIC_PLACEMENT) return '—';
  return String(position);
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
