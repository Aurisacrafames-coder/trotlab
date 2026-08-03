import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatActualPosition } from '../../shared/format';
import {
  DRIVER_GLOBAL_WIN_WEIGHT,
  DRIVER_TRACK_WIN_WEIGHT,
  autoDriverWinCombined,
} from '../../shared/scoring';
import {
  fetchDriverStatRaces,
  fetchDriverStatSummary,
  fetchStatEntities,
  fetchTrainerStatRaces,
  fetchTrainerStatSummary,
  type StatContributingStart,
  type StatEntityOption,
  type StatRacesResult,
  type StatSummary,
} from '../api';

type EntityTab = 'driver' | 'trainer';

function pctLabel(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1)} %`;
}

function combinedDriverScoreLabel(
  trackPct: number | null | undefined,
  globalPct: number | null | undefined,
): string {
  const score = autoDriverWinCombined(trackPct ?? null, globalPct ?? null);
  return `${score.toFixed(1)} / 10`;
}

function DriverStatOverview({ summary }: { summary: StatSummary }) {
  const trackPct = summary.entryTrackValue ?? null;
  const globalPct = summary.entryGlobalValue ?? null;

  return (
    <div className="stat-driver-overview">
      <div className="stat-driver-stat">
        <span className="stat-driver-stat-label">Bana</span>
        <span className="stat-driver-stat-value">{pctLabel(trackPct)}</span>
        {summary.trackName && (
          <span className="stat-driver-stat-meta">{summary.trackName}</span>
        )}
      </div>
      <div className="stat-driver-stat">
        <span className="stat-driver-stat-label">Totalt</span>
        <span className="stat-driver-stat-value">{pctLabel(globalPct)}</span>
        <span className="stat-driver-stat-meta">Alla banor, 12 mån</span>
      </div>
      <div className="stat-driver-stat stat-driver-stat-highlight">
        <span className="stat-driver-stat-label">Poäng i lopp</span>
        <span className="stat-driver-stat-value">
          {summary.entryOverride != null
            ? `${summary.entryOverride.toFixed(1)} % (manuell)`
            : combinedDriverScoreLabel(trackPct, globalPct)}
        </span>
        <span className="stat-driver-stat-meta">
          {summary.entryOverride != null
            ? 'Manuell override'
            : `${Math.round(DRIVER_TRACK_WIN_WEIGHT * 100)} % bana + ${Math.round(DRIVER_GLOBAL_WIN_WEIGHT * 100)} % totalt`}
        </span>
      </div>
    </div>
  );
}

function statRowLabel(row: StatSummary['cached']): string {
  if (!row) return '—';
  return `${row.wins}/${row.starts} (${pctLabel(row.winPercent)})`;
}

function cacheMatch(
  cached: StatSummary['cached'],
  computed: StatRacesResult['computed'] | null,
): 'match' | 'mismatch' | 'unknown' {
  if (!cached || !computed) return 'unknown';
  if (cached.starts !== computed.starts || cached.wins !== computed.wins) return 'mismatch';
  return 'match';
}

function StartsTable({ starts }: { starts: StatContributingStart[] }) {
  if (starts.length === 0) {
    return <p className="muted">Inga starter hittades i perioden.</p>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Bana</th>
            <th>Lopp</th>
            <th>Spår</th>
            <th>Häst</th>
            <th>Plats</th>
            <th>Vinst</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {starts.map((s) => (
            <tr key={`${s.raceId}-${s.postPosition}`} className={s.won ? 'rank-1' : ''}>
              <td>{s.date}</td>
              <td>{s.trackName}</td>
              <td>{s.raceNumber ?? '—'}</td>
              <td>{s.postPosition ?? '—'}</td>
              <td>{s.horseName ?? '—'}</td>
              <td>{formatActualPosition(s.place)}</td>
              <td>{s.won ? 'Ja' : 'Nej'}</td>
              <td>
                {s.atgUrl ? (
                  <a href={s.atgUrl} target="_blank" rel="noreferrer">
                    ATG
                  </a>
                ) : (
                  <span className="muted" title={s.raceId}>
                    —
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntityList({
  items,
  emptyLabel,
  onSelect,
}: {
  items: StatEntityOption[];
  emptyLabel: string;
  onSelect: (entity: StatEntityOption) => void;
}) {
  if (items.length === 0) {
    return <p className="muted stat-entity-empty">{emptyLabel}</p>;
  }

  return (
    <ul className="stat-entity-grid">
      {items.map((entity) => (
        <li key={entity.id}>
          <button type="button" className="stat-entity-card" onClick={() => onSelect(entity)}>
            <span className="stat-entity-name">{entity.name}</span>
            <span className="stat-entity-meta">
              {entity.appearances} {entity.appearances === 1 ? 'lopp' : 'lopp'} i databasen
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function StatsVerifyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const typeParam = searchParams.get('type');
  const idParam = searchParams.get('id');
  const trackIdParam = searchParams.get('trackId');
  const sessionIdParam = searchParams.get('sessionId');
  const entryIdParam = searchParams.get('entryId');

  const entityType =
    typeParam === 'driver' || typeParam === 'trainer' ? typeParam : null;
  const entityId = idParam ? parseInt(idParam, 10) : null;
  const isDetailView = entityType != null && entityId != null && !Number.isNaN(entityId);

  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<EntityTab>(entityType ?? 'driver');
  const [entities, setEntities] = useState<StatEntityOption[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [summary, setSummary] = useState<StatSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [races, setRaces] = useState<StatRacesResult | null>(null);
  const [racesLoading, setRacesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driverScope, setDriverScope] = useState<'auto' | 'track' | 'global'>('auto');

  useEffect(() => {
    if (entityType) setActiveTab(entityType);
  }, [entityType]);

  useEffect(() => {
    setEntitiesLoading(true);
    fetchStatEntities(query.trim() || undefined)
      .then(setEntities)
      .catch((e) => setError(e instanceof Error ? e.message : 'Kunde inte söka'))
      .finally(() => setEntitiesLoading(false));
  }, [query]);

  const { drivers, trainers } = useMemo(
    () => ({
      drivers: entities.filter((e) => e.type === 'driver'),
      trainers: entities.filter((e) => e.type === 'trainer'),
    }),
    [entities],
  );

  const loadSummary = useCallback(async () => {
    if (!entityType || entityId == null || Number.isNaN(entityId)) {
      setSummary(null);
      return;
    }

    setSummaryLoading(true);
    setError(null);
    try {
      if (entityType === 'driver') {
        const trackId =
          trackIdParam && !Number.isNaN(parseInt(trackIdParam, 10))
            ? parseInt(trackIdParam, 10)
            : undefined;
        const sessionId =
          sessionIdParam && !Number.isNaN(parseInt(sessionIdParam, 10))
            ? parseInt(sessionIdParam, 10)
            : undefined;
        const entryId =
          entryIdParam && !Number.isNaN(parseInt(entryIdParam, 10))
            ? parseInt(entryIdParam, 10)
            : undefined;
        setSummary(
          await fetchDriverStatSummary(entityId, { trackId, sessionId, entryId }),
        );
      } else {
        const sessionId =
          sessionIdParam && !Number.isNaN(parseInt(sessionIdParam, 10))
            ? parseInt(sessionIdParam, 10)
            : undefined;
        const entryId =
          entryIdParam && !Number.isNaN(parseInt(entryIdParam, 10))
            ? parseInt(entryIdParam, 10)
            : undefined;
        setSummary(
          await fetchTrainerStatSummary(entityId, { sessionId, entryId }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte hämta sammanfattning');
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [entityType, entityId, trackIdParam, sessionIdParam, entryIdParam]);

  useEffect(() => {
    loadSummary();
    setRaces(null);
  }, [loadSummary]);

  async function handleLoadRaces() {
    if (!entityType || entityId == null || Number.isNaN(entityId)) return;

    setRacesLoading(true);
    setError(null);
    try {
      if (entityType === 'driver') {
        const trackId =
          trackIdParam && !Number.isNaN(parseInt(trackIdParam, 10))
            ? parseInt(trackIdParam, 10)
            : undefined;
        setRaces(await fetchDriverStatRaces(entityId, { trackId, scope: driverScope }));
      } else {
        setRaces(await fetchTrainerStatRaces(entityId));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte hämta lopp från ATG');
    } finally {
      setRacesLoading(false);
    }
  }

  function buildContextParams(): URLSearchParams {
    const next = new URLSearchParams();
    if (trackIdParam) next.set('trackId', trackIdParam);
    if (sessionIdParam) next.set('sessionId', sessionIdParam);
    if (entryIdParam) next.set('entryId', entryIdParam);
    return next;
  }

  function selectEntity(entity: StatEntityOption) {
    const next = buildContextParams();
    next.set('type', entity.type);
    next.set('id', String(entity.id));
    setSearchParams(next);
    setActiveTab(entity.type);
  }

  function goBackToList() {
    setSearchParams(buildContextParams());
    setRaces(null);
    setSummary(null);
    setError(null);
  }

  const matchStatus = useMemo(
    () => cacheMatch(summary?.cached ?? null, races?.computed ?? null),
    [summary, races],
  );

  const raceReturnLink =
    sessionIdParam && !Number.isNaN(parseInt(sessionIdParam, 10))
      ? `/lopp/${sessionIdParam}`
      : null;

  return (
    <>
      <div className="card stat-verify-header">
        <nav className="stat-verify-nav" aria-label="Navigation">
          {isDetailView ? (
            <button type="button" className="stat-verify-back" onClick={goBackToList}>
              ← Tillbaka till listan
            </button>
          ) : (
            <Link to="/statistik" className="stat-verify-back">
              ← Spelstatistik
            </Link>
          )}
          {raceReturnLink && (
            <Link to={raceReturnLink} className="stat-verify-back">
              ← Tillbaka till loppet
            </Link>
          )}
        </nav>

        <h2>
          {isDetailView && summary
            ? `${summary.entityType === 'driver' ? 'Kusk' : 'Tränare'}: ${summary.name ?? `#${summary.entityId}`}`
            : 'Kusk- & tränarstatistik'}
        </h2>
        {!isDetailView && (
          <p className="muted">
            Verifiera vinstprocenten som visas i loppen och se vilka starter siffran bygger på.
          </p>
        )}
      </div>

      {error && (
        <div className="card error-box">
          <p>{error}</p>
        </div>
      )}

      {!isDetailView && (
        <div className="card">
          <label className="backtest-field">
            <span className="muted">Sök namn</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrera kusk eller tränare…"
              autoComplete="off"
            />
          </label>

          <div className="stat-verify-tabs" role="tablist" aria-label="Kusk eller tränare">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'driver'}
              className={`stat-verify-tab${activeTab === 'driver' ? ' stat-verify-tab-active' : ''}`}
              onClick={() => setActiveTab('driver')}
            >
              Kusk
              <span className="stat-verify-tab-count">{drivers.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'trainer'}
              className={`stat-verify-tab${activeTab === 'trainer' ? ' stat-verify-tab-active' : ''}`}
              onClick={() => setActiveTab('trainer')}
            >
              Tränare
              <span className="stat-verify-tab-count">{trainers.length}</span>
            </button>
          </div>

          {entitiesLoading ? (
            <p className="muted">Laddar…</p>
          ) : activeTab === 'driver' ? (
            <EntityList
              items={drivers}
              emptyLabel={query ? 'Ingen kusk matchade sökningen.' : 'Inga kusk hittades i importerade lopp.'}
              onSelect={selectEntity}
            />
          ) : (
            <EntityList
              items={trainers}
              emptyLabel={query ? 'Ingen tränare matchade sökningen.' : 'Inga tränare hittades i importerade lopp.'}
              onSelect={selectEntity}
            />
          )}
        </div>
      )}

      {isDetailView && summaryLoading && <p className="muted">Laddar sammanfattning…</p>}

      {isDetailView && summary && (
        <>
          <div className="card">
            <p className="muted">{summary.description}</p>

            {summary.entityType === 'driver' && (
              <DriverStatOverview summary={summary} />
            )}

            <div className="backtest-compare-box stat-verify-summary">
              <div>
                <span className="muted">Används i lopp</span>
                <div className="backtest-compare-value">{pctLabel(summary.usedWinPercent)}</div>
                {summary.entryOverride != null && (
                  <span className="muted">Manuell override aktiv</span>
                )}
              </div>
              <div>
                <span className="muted">Cache ({summary.cached?.source ?? '—'})</span>
                <div className="backtest-compare-value">{statRowLabel(summary.cached)}</div>
                {summary.cached?.updatedAt && (
                  <span className="muted">Uppdaterad {summary.cached.updatedAt}</span>
                )}
              </div>
              {summary.entityType === 'driver' && summary.globalCached && summary.scope === 'track' && (
                <div>
                  <span className="muted">Global cache</span>
                  <div className="backtest-compare-value">{statRowLabel(summary.globalCached)}</div>
                </div>
              )}
              {summary.entityType === 'trainer' && summary.entryValue != null && (
                <div>
                  <span className="muted">Värde i valt lopp</span>
                  <div className="backtest-compare-value">{pctLabel(summary.entryValue)}</div>
                </div>
              )}
            </div>

            {summary.entityType === 'driver' && (
              <div className="backtest-filters" style={{ marginTop: '1rem' }}>
                <label className="backtest-field">
                  <span className="muted">Visa starter för</span>
                  <select
                    value={driverScope}
                    onChange={(e) =>
                      setDriverScope(e.target.value as 'auto' | 'track' | 'global')
                    }
                  >
                    <option value="auto">
                      Auto ({summary.scope === 'track' ? 'bana' : 'global'})
                    </option>
                    <option value="track">Bana{summary.trackName ? `: ${summary.trackName}` : ''}</option>
                    <option value="global">Alla banor</option>
                  </select>
                </label>
              </div>
            )}

            <button
              type="button"
              style={{ marginTop: '1rem' }}
              onClick={handleLoadRaces}
              disabled={racesLoading}
            >
              {racesLoading ? 'Hämtar lopp från ATG…' : 'Hämta underliggande lopp'}
            </button>
            {racesLoading && (
              <p className="muted">
                Detta kan ta flera minuter — vi går igenom ATG:s resultat dag för dag.
              </p>
            )}
          </div>

          {races && (
            <div className="card">
              <h2>Underliggande starter</h2>
              <p className="muted">
                Period {races.fromDate} – {races.toDate} ({races.lookbackDays} dagar)
                {races.trackName ? ` · ${races.trackName}` : ' · alla banor'}
              </p>

              <div
                className={`backtest-compare-box${matchStatus === 'match' ? ' backtest-compare-box-highlight' : ''}`}
              >
                <div>
                  <span className="muted">Beräknat från ATG</span>
                  <div className="backtest-compare-value">
                    {races.computed.wins}/{races.computed.starts} ({pctLabel(races.computed.winPercent)})
                  </div>
                </div>
                <div>
                  <span className="muted">Cache</span>
                  <div className="backtest-compare-value">{statRowLabel(summary.cached)}</div>
                </div>
                <div>
                  <span className="muted">Match</span>
                  <div className="backtest-compare-value">
                    {matchStatus === 'match' && 'Ja'}
                    {matchStatus === 'mismatch' && 'Nej — cache kan vara gammal, synka statistik'}
                    {matchStatus === 'unknown' && '—'}
                  </div>
                </div>
              </div>

              <StartsTable starts={races.starts} />
            </div>
          )}
        </>
      )}
    </>
  );
}
