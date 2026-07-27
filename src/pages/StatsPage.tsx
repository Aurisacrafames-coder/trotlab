import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSessions, fetchStats, type SessionListItem, type StatsFilters } from '../api';
import type { StatsSummary } from '../../shared/types';
import { formatGameLegLabel } from '../../shared/format';
import { sessionMatchesFilters } from '../../shared/statsFilters';

const EMPTY_FILTERS: StatsFilters = {};

function hasActiveFilters(filters: StatsFilters): boolean {
  return Boolean(filters.trackName || filters.gameType || filters.dateFrom || filters.dateTo);
}

function filterSummary(filters: StatsFilters): string {
  const parts: string[] = [];
  if (filters.trackName) parts.push(filters.trackName);
  if (filters.gameType) parts.push(filters.gameType);
  if (filters.dateFrom && filters.dateTo) {
    parts.push(`${filters.dateFrom} – ${filters.dateTo}`);
  } else if (filters.dateFrom) {
    parts.push(`från ${filters.dateFrom}`);
  } else if (filters.dateTo) {
    parts.push(`t.o.m. ${filters.dateTo}`);
  }
  return parts.join(' · ');
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [filters, setFilters] = useState<StatsFilters>(EMPTY_FILTERS);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setStatsLoading(true);
    fetchStats(hasActiveFilters(filters) ? filters : undefined)
      .then(setStats)
      .finally(() => setStatsLoading(false));
  }, [filters]);

  const trackOptions = useMemo(
    () => [...new Set(sessions.map((s) => s.trackName))].sort((a, b) => a.localeCompare(b, 'sv')),
    [sessions],
  );

  const gameTypeOptions = useMemo(
    () => [...new Set(sessions.map((s) => s.gameType))].sort((a, b) => a.localeCompare(b, 'sv')),
    [sessions],
  );

  const dateBounds = useMemo(() => {
    if (sessions.length === 0) return { min: '', max: '' };
    const dates = sessions.map((s) => s.date).sort();
    return { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' };
  }, [sessions]);

  const filteredSessions = useMemo(
    () => sessions.filter((s) => sessionMatchesFilters(s, filters)),
    [sessions, filters],
  );

  function updateFilter<K extends keyof StatsFilters>(key: K, value: StatsFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
  }

  if (loading) return <p className="muted">Laddar statistik…</p>;
  if (!stats) return null;

  return (
    <>
      <div className="card">
        <h2>Filter</h2>
        <div className="backtest-filters">
          <label className="backtest-field">
            <span className="muted">Bana</span>
            <select
              value={filters.trackName ?? ''}
              onChange={(e) => updateFilter('trackName', e.target.value || undefined)}
            >
              <option value="">Alla banor</option>
              {trackOptions.map((track) => (
                <option key={track} value={track}>
                  {track}
                </option>
              ))}
            </select>
          </label>

          <label className="backtest-field">
            <span className="muted">Spelform</span>
            <select
              value={filters.gameType ?? ''}
              onChange={(e) => updateFilter('gameType', e.target.value || undefined)}
            >
              <option value="">Alla spelformer</option>
              {gameTypeOptions.map((gameType) => (
                <option key={gameType} value={gameType}>
                  {gameType}
                </option>
              ))}
            </select>
          </label>

          <label className="backtest-field">
            <span className="muted">Från datum</span>
            <input
              type="date"
              value={filters.dateFrom ?? ''}
              min={dateBounds.min || undefined}
              max={(filters.dateTo ?? dateBounds.max) || undefined}
              onChange={(e) => updateFilter('dateFrom', e.target.value || undefined)}
            />
          </label>

          <label className="backtest-field">
            <span className="muted">Till datum</span>
            <input
              type="date"
              value={filters.dateTo ?? ''}
              min={(filters.dateFrom ?? dateBounds.min) || undefined}
              max={dateBounds.max || undefined}
              onChange={(e) => updateFilter('dateTo', e.target.value || undefined)}
            />
          </label>
        </div>

        {hasActiveFilters(filters) && (
          <div className="import-row" style={{ marginTop: '0.75rem' }}>
            <p className="muted" style={{ margin: 0, flex: 1 }}>
              Visar: {filterSummary(filters)} ({filteredSessions.length} lopp)
            </p>
            <button type="button" className="secondary" onClick={clearFilters}>
              Rensa filter
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Träffsäkerhet</h2>
        {statsLoading && <p className="muted" style={{ marginTop: 0 }}>Uppdaterar…</p>}
        <div className="stats-grid">
          <div className="stat-box">
            <div className="value">{stats.totalRaces}</div>
            <div className="label">Importerade lopp</div>
          </div>
          <div className="stat-box">
            <div className="value">{stats.racesWithResult}</div>
            <div className="label">Med resultat</div>
          </div>
          <div className="stat-box">
            <div className="value">
              {stats.hitRateWin != null ? `${stats.hitRateWin}%` : '—'}
            </div>
            <div className="label">Topp 3 val vann</div>
          </div>
          <div className="stat-box">
            <div className="value">
              {stats.hitRateTop3 != null ? `${stats.hitRateTop3}%` : '—'}
            </div>
            <div className="label">Topp 3 val i topp 3</div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: '1rem', marginBottom: 0 }}>
          {stats.topScoreWins} vinstträffar · {stats.topScoreTop3} topp-3-träffar (någon av topp 3 val) av{' '}
          {stats.racesWithResult} lopp med registrerat resultat.
        </p>
      </div>

      <div className="card">
        <h2>Lopp</h2>
        {filteredSessions.length === 0 ? (
          <p className="muted">
            {sessions.length === 0
              ? 'Inga lopp importerade ännu.'
              : 'Inga lopp matchar filtret.'}
          </p>
        ) : (
          <ul className="session-list">
            {filteredSessions.map((s) => (
              <li key={s.id}>
                <Link to={`/lopp/${s.id}`}>
                  <span>
                    {formatGameLegLabel(s.gameType, s.legNumber, s.trackRaceNumber)} · {s.trackName} · {s.date}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
