/** Spelformer som kan ha egna viktprofiler per bana (tom sträng = alla lopp på banan). */
export const PROFILE_GAME_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Alla spelformer' },
  { value: 'V86', label: 'V86' },
  { value: 'V85', label: 'V85' },
  { value: 'V64', label: 'V64' },
  { value: 'V75', label: 'V75' },
  { value: 'GS75', label: 'GS75' },
  { value: 'V65', label: 'V65' },
];

export function normalizeProfileGameType(value: string | null | undefined): string {
  if (value == null || !String(value).trim()) return '';
  return String(value).trim().toUpperCase();
}

export function formatProfileGameTypeLabel(gameType: string): string {
  const normalized = normalizeProfileGameType(gameType);
  if (!normalized) return 'Alla spelformer';
  return normalized;
}
