export interface StatsFilters {
  trackName?: string | null;
  gameType?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export function sessionMatchesFilters(
  session: { trackName: string; gameType: string; date: string },
  filters: StatsFilters,
): boolean {
  if (filters.trackName && session.trackName !== filters.trackName) return false;
  if (filters.gameType && session.gameType !== filters.gameType) return false;
  if (filters.dateFrom && session.date < filters.dateFrom) return false;
  if (filters.dateTo && session.date > filters.dateTo) return false;
  return true;
}
