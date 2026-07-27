import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAutoOptimizerStatus,
  fetchBacktestTracks,
  fetchKnownTracks,
  fetchParameters,
  fetchTrackProfile,
  fetchTrackProfiles,
  optimizeBacktest,
  runAutoOptimizer,
  runBacktest,
  saveParameters,
  saveTrackProfile,
} from '../api';
import { formatGameLegLabel, formatWeightShare, formatWeightValue, formatActualPosition } from '../../shared/format';
import type {
  AutoOptimizerStatus,
  BacktestGoal,
  BacktestOptimizeResult,
  BacktestSummary,
  BacktestTrackOption,
  KnownTrack,
  Parameter,
  TrackProfileSummary,
} from '../../shared/types';
import { DEFAULT_PARAMETERS } from '../../shared/types';

function hitLabel(hit: 'win' | 'top3' | 'miss') {
  if (hit === 'win') return <span className="hit-win">Träff</span>;
  if (hit === 'top3') return <span className="hit-top3">Topp 3</span>;
  return <span className="hit-miss">Miss</span>;
}

function AutoOptimizeBanner({
  status,
  onApplyWeights,
  onUseResult,
}: {
  status: AutoOptimizerStatus;
  onApplyWeights: (weights: Parameter[]) => void;
  onUseResult: (result: BacktestOptimizeResult) => void;
}) {
  if (status.running) {
    return (
      <div className="auto-opt-banner auto-opt-running">
        <strong>Optimerar i bakgrunden</strong>
        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
          {status.message ??
            `Testar viktkombinationer mot ${status.trackName ?? 'banan'}…`}
        </p>
        {status.trialsRun > 0 && (
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {status.trialsRun} alternativ provade
            {status.bestHits != null && status.racesWithResult != null
              ? ` · bästa hittills ${status.bestHits}/${status.racesWithResult}`
              : ''}
          </p>
        )}
      </div>
    );
  }

  if (!status.lastResult || status.lastResult.racesWithResult === 0) {
    if (status.message) {
      return (
        <div className="auto-opt-banner">
          <p className="muted" style={{ margin: 0 }}>{status.message}</p>
        </div>
      );
    }
    return null;
  }

  const result = status.lastResult;
  return (
    <div className="auto-opt-banner auto-opt-done">
      <strong>Automatisk optimering klar</strong>
      {status.lastRunAt && (
        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
          Senast körd {new Date(status.lastRunAt).toLocaleString('sv-SE')}
          {status.trackName ? ` · ${status.trackName}` : ''}
          {status.goal === 'win' ? ' · vinstträff' : ' · topp 3-träff'}
        </p>
      )}
      {result.message && (
        <p className="muted" style={{ margin: '0.35rem 0 0' }}>{result.message}</p>
      )}
      <div className="backtest-compare" style={{ marginTop: '0.75rem' }}>
        <BacktestCompareBox
          label="Nuvarande"
          hits={result.baseline.hits}
          total={result.baseline.racesWithResult}
          hitRate={result.baseline.hitRate}
        />
        <div className="backtest-compare-arrow">→</div>
        <BacktestCompareBox
          label="Bästa hittade"
          hits={result.optimized.hits}
          total={result.optimized.racesWithResult}
          hitRate={result.optimized.hitRate}
          highlight
        />
      </div>
      <div className="backtest-actions" style={{ marginTop: '0.75rem' }}>
        {result.improved ? (
          <>
            <button type="button" onClick={() => onApplyWeights(result.optimized.weights)}>
              Använd bästa vikter
            </button>
            <button type="button" className="secondary" onClick={() => onUseResult(result)}>
              Visa detaljer
            </button>
          </>
        ) : (
          <button type="button" className="secondary" onClick={() => onUseResult(result)}>
            Visa resultat
          </button>
        )}
      </div>
    </div>
  );
}

function BacktestPanel({
  params,
  profileTrackId,
  onApplyWeights,
}: {
  params: Parameter[];
  profileTrackId: number | null;
  onApplyWeights: (weights: Parameter[]) => void;
}) {
  const [tracks, setTracks] = useState<BacktestTrackOption[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [atgTrackId, setAtgTrackId] = useState<number | ''>('');
  const [startMethod, setStartMethod] = useState<'' | 'auto' | 'volte'>('');
  const [goal, setGoal] = useState<BacktestGoal>('top3');
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [runResult, setRunResult] = useState<BacktestSummary | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<BacktestOptimizeResult | null>(null);
  const [autoStatus, setAutoStatus] = useState<AutoOptimizerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBacktestTracks()
      .then((list) => {
        setTracks(list);
        if (profileTrackId != null && list.some((t) => t.atgTrackId === profileTrackId)) {
          setAtgTrackId(profileTrackId);
        } else if (list.length === 1) {
          setAtgTrackId(list[0].atgTrackId);
        }
      })
      .finally(() => setTracksLoading(false));
  }, [profileTrackId]);

  useEffect(() => {
    let cancelled = false;

    async function pollAutoStatus() {
      try {
        const status = await fetchAutoOptimizerStatus();
        if (!cancelled) setAutoStatus(status);
      } catch {
        // ignore polling errors
      }
    }

    pollAutoStatus();
    const timer = window.setInterval(pollAutoStatus, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectedTrack = tracks.find((t) => t.atgTrackId === atgTrackId);
  const filterBody = {
    atgTrackId: Number(atgTrackId),
    startMethod: startMethod || null,
    goal,
  };

  async function handleRun() {
    if (atgTrackId === '') return;
    setRunning(true);
    setError(null);
    setRunResult(null);
    setOptimizeResult(null);
    try {
      const result = await runBacktest({ ...filterBody, weights: params });
      setRunResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest misslyckades');
    } finally {
      setRunning(false);
    }
  }

  async function handleOptimize() {
    if (atgTrackId === '') return;
    setOptimizing(true);
    setError(null);
    setRunResult(null);
    setOptimizeResult(null);
    try {
      const result = await optimizeBacktest(filterBody);
      setOptimizeResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimering misslyckades');
    } finally {
      setOptimizing(false);
    }
  }

  if (tracksLoading) {
    return <p className="muted">Laddar banor…</p>;
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Testa dina vikter mot importerade lopp med resultat på samma bana.
        Träff räknas om <strong>någon av de tre hästar med högst Trot Score</strong> vunnit
        (vinstmål) eller kommit topp 3 (topp 3-mål).
        Appen optimerar automatiskt i bakgrunden när du importerar lopp eller hämtar resultat.
        Värmning exkluderas (kräver manuell markering).
      </p>

      {autoStatus && (
        <AutoOptimizeBanner
          status={autoStatus}
          onApplyWeights={onApplyWeights}
          onUseResult={(result) => {
            setOptimizeResult(result);
            setAtgTrackId(result.atgTrackId);
          }}
        />
      )}

      {tracks.length === 0 ? (
        <p className="muted">
          Inga banor med importerade lopp ännu. Gå till{' '}
          <Link to="/import">Importera</Link> och hämta historik (senaste 6 månaderna) för banan du vill optimera.
        </p>
      ) : (
        <>
          <div className="backtest-filters">
            <label className="backtest-field">
              <span className="muted">Bana</span>
              <select
                value={atgTrackId}
                onChange={(e) =>
                  setAtgTrackId(e.target.value ? Number(e.target.value) : '')
                }
              >
                <option value="">Välj bana…</option>
                {tracks.map((t) => (
                  <option key={t.atgTrackId} value={t.atgTrackId}>
                    {t.trackName} ({t.racesWithResult}/{t.raceCount} med resultat)
                  </option>
                ))}
              </select>
            </label>

            <label className="backtest-field">
              <span className="muted">Startmetod</span>
              <select
                value={startMethod}
                onChange={(e) => setStartMethod(e.target.value as '' | 'auto' | 'volte')}
              >
                <option value="">Alla</option>
                <option value="auto">Autostart</option>
                <option value="volte">Voltstart</option>
              </select>
            </label>

            <label className="backtest-field">
              <span className="muted">Mål</span>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value as BacktestGoal)}
              >
                <option value="top3">Topp 3-träff</option>
                <option value="win">Vinstträff</option>
              </select>
            </label>
          </div>

          <div className="backtest-actions">
            <button
              type="button"
              className="secondary"
              onClick={handleRun}
              disabled={running || optimizing || atgTrackId === '' || !selectedTrack?.racesWithResult}
            >
              {running ? 'Kör…' : 'Testa nuvarande vikter'}
            </button>
            <button
              type="button"
              onClick={handleOptimize}
              disabled={running || optimizing || atgTrackId === '' || !selectedTrack?.racesWithResult}
            >
              {optimizing ? 'Optimerar…' : 'Optimera manuellt'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => runAutoOptimizer(goal).then(setAutoStatus)}
              disabled={running || optimizing || autoStatus?.running || !selectedTrack?.racesWithResult}
            >
              Kör bakgrundsoptimering
            </button>
          </div>

          {selectedTrack && selectedTrack.racesWithResult < 5 && (
            <p className="muted backtest-warn">
              Bara {selectedTrack.racesWithResult} lopp med resultat — resultatet kan vara opålitligt.
              Importera fler avslutade omgångar på banan för bättre underlag.
            </p>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      {runResult && runResult.racesWithResult > 0 && (
        <BacktestResultCard title="Nuvarande vikter" summary={runResult} />
      )}

      {optimizeResult && optimizeResult.racesWithResult > 0 && (
        <>
          <div className="backtest-compare">
            <BacktestCompareBox
              label="Nuvarande"
              hits={optimizeResult.baseline.hits}
              total={optimizeResult.baseline.racesWithResult}
              hitRate={optimizeResult.baseline.hitRate}
            />
            <div className="backtest-compare-arrow">→</div>
            <BacktestCompareBox
              label="Optimerade"
              hits={optimizeResult.optimized.hits}
              total={optimizeResult.optimized.racesWithResult}
              hitRate={optimizeResult.optimized.hitRate}
              highlight
            />
          </div>

          {optimizeResult.message && (
            <p className={optimizeResult.improved ? 'muted' : 'backtest-warn'}>
              {optimizeResult.message}
            </p>
          )}

          {optimizeResult.hitsGained !== 0 && (
            <p className={optimizeResult.hitsGained > 0 ? 'hit-win' : 'hit-miss'}>
              {optimizeResult.hitsGained > 0 ? '+' : ''}
              {optimizeResult.hitsGained} träffar jämfört med nuvarande vikter.
            </p>
          )}

          {optimizeResult.improved ? (
            <div className="backtest-suggested">
              <h3 className="breakdown-title">Föreslagna vikter</h3>
              <ul className="backtest-weight-list">
                {optimizeResult.optimized.weights.map((p) => {
                  const prev = optimizeResult.baseline.weights.find((b) => b.id === p.id);
                  const changed = prev && prev.weight !== p.weight;
                  return (
                    <li key={p.id} className={changed ? 'backtest-weight-changed' : undefined}>
                      <span>{p.name}</span>
                      <span>
                        {formatWeightValue(prev?.weight ?? 0)} → <strong>{formatWeightValue(p.weight)}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button type="button" onClick={() => onApplyWeights(optimizeResult.optimized.weights)}>
                Använd föreslagna vikter
              </button>
              <p className="muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Vikterna fylls i ovan — klicka &quot;Spara &amp; omräkna&quot; för att aktivera dem.
              </p>
            </div>
          ) : (
            <p className="muted">
              Nuvarande vikter är bäst bland testade alternativ. Prova fler importerade lopp eller ett annat mål
              (vinst vs topp 3).
            </p>
          )}

          {optimizeResult.improved && (
            <BacktestResultCard title="Per lopp (optimerade vikter)" summary={optimizeResult.optimized} />
          )}
        </>
      )}
    </>
  );
}

function BacktestCompareBox({
  label,
  hits,
  total,
  hitRate,
  highlight,
}: {
  label: string;
  hits: number;
  total: number;
  hitRate: number | null;
  highlight?: boolean;
}) {
  return (
    <div className={`backtest-compare-box${highlight ? ' backtest-compare-box-highlight' : ''}`}>
      <div className="muted">{label}</div>
      <div className="backtest-compare-value">
        {hits}/{total}
      </div>
      <div className="muted">{hitRate != null ? `${hitRate}%` : '—'}</div>
    </div>
  );
}

function BacktestResultCard({
  title,
  summary,
}: {
  title: string;
  summary: BacktestSummary;
}) {
  return (
    <div className="backtest-result">
      <h3 className="breakdown-title">{title}</h3>
      <p className="muted">
        {summary.trackName} · {summary.hits}/{summary.racesWithResult} träffar
        {summary.hitRate != null ? ` (${summary.hitRate}%)` : ''}
      </p>
      {summary.races.length > 0 && (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Lopp</th>
              <th>Datum</th>
              <th>Topp 3 val</th>
              <th>Träff</th>
            </tr>
          </thead>
          <tbody>
            {summary.races.map((race) => (
              <tr key={race.sessionId}>
                <td>
                  <Link to={`/lopp/${race.sessionId}`}>
                    {formatGameLegLabel(race.gameType, race.legNumber, race.trackRaceNumber)}
                  </Link>
                </td>
                <td>{race.date}</td>
                <td>
                  <div className="backtest-top-picks">
                    {race.topPicks.map((pick) => (
                      <div key={pick.startNumber} className="backtest-top-pick">
                        <span>
                          #{pick.startNumber} {pick.horseName}
                        </span>
                        <span className="muted">
                          {pick.trotScore.toFixed(1)} · pl. {formatActualPosition(pick.actualPosition)}
                        </span>
                      </div>
                    ))}
                  </div>
                </td>
                <td>{hitLabel(race.hit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [params, setParams] = useState<Parameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profileMode, setProfileMode] = useState<'global' | number>('global');
  const [knownTracks, setKnownTracks] = useState<KnownTrack[]>([]);
  const [trackProfiles, setTrackProfiles] = useState<TrackProfileSummary[]>([]);

  const activeTrack =
    profileMode === 'global'
      ? null
      : knownTracks.find((t) => t.atgTrackId === profileMode) ?? null;

  const activeProfileSummary =
    profileMode === 'global'
      ? null
      : trackProfiles.find((p) => p.atgTrackId === profileMode) ?? null;

  useEffect(() => {
    Promise.all([fetchKnownTracks(), fetchTrackProfiles()]).then(([tracks, profiles]) => {
      setKnownTracks(tracks);
      setTrackProfiles(profiles);
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    setMessage(null);
    const load =
      profileMode === 'global'
        ? fetchParameters()
        : fetchTrackProfile(profileMode);
    load
      .then(setParams)
      .catch((e) => setMessage(e instanceof Error ? e.message : 'Kunde inte ladda vikter'))
      .finally(() => setLoading(false));
  }, [profileMode]);

  function updateWeight(id: string, weight: number) {
    setParams((prev) =>
      prev.map((p) => (p.id === id ? { ...p, weight: Math.max(0, weight) } : p)),
    );
  }

  function applySuggestedWeights(weights: Parameter[]) {
    setParams((prev) =>
      prev.map((p) => {
        const suggested = weights.find((w) => w.id === p.id);
        return suggested ? { ...p, weight: suggested.weight } : p;
      }),
    );
    setMessage(
      profileMode === 'global'
        ? 'Föreslagna vikter införda — spara för att aktivera.'
        : `Föreslagna vikter införda — spara ${activeTrack?.name ?? 'banan'}-profilen.`,
    );
  }

  const totalWeight = params.reduce((s, p) => s + p.weight, 0);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      if (profileMode === 'global') {
        const saved = await saveParameters(params);
        setParams(saved);
        setMessage('Global profil sparad — lopp utan banprofil/tips omräknade.');
      } else if (activeTrack) {
        const saved = await saveTrackProfile(activeTrack.atgTrackId, activeTrack.name, params);
        setParams(saved);
        const profiles = await fetchTrackProfiles();
        setTrackProfiles(profiles);
        setMessage(`${activeTrack.name}-profil sparad — lopp på banan utan tips omräknade.`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Kunde inte spara');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Laddar…</p>;

  return (
    <>
      <div className="card">
        <h2>Parametrar för Trot Score</h2>
        <p className="muted">
          Varje parameter får ett poäng 0–10 (räknas ut automatiskt från ATG-data, eller markeras manuellt för Värmning).
          Du styr hur mycket varje parameter påverkar slutpoängen med en <strong>relativ vikt</strong> (0–100).
        </p>

        <label className="backtest-field" style={{ marginBottom: '1rem' }}>
          <span className="muted">Viktprofil</span>
          <select
            value={profileMode === 'global' ? 'global' : String(profileMode)}
            onChange={(e) => {
              const v = e.target.value;
              setProfileMode(v === 'global' ? 'global' : Number(v));
            }}
          >
            <option value="global">Global standard (fallback)</option>
            {knownTracks.map((t) => (
              <option key={t.atgTrackId} value={t.atgTrackId}>
                {t.name}
                {trackProfiles.some((p) => p.atgTrackId === t.atgTrackId) ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>

        {profileMode === 'global' ? (
          <p className="muted" style={{ marginTop: 0 }}>
            Används för banor utan egen sparad profil. Skapa banprofiler under val av bana ovan.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            Gäller alla lopp på <strong>{activeTrack?.name}</strong> som inte har sparat tips.
            {activeProfileSummary ? (
              <>
                {' '}
                Profil sparad {new Date(activeProfileSummary.updatedAt).toLocaleString('sv-SE')}
                {' · '}
                {activeProfileSummary.racesWithResult} lopp med resultat i databasen.
              </>
            ) : (
              <>
                {' '}
                Ingen sparad profil ännu — justera vikter och spara, eller optimera via backtest nedan.
                {' '}
                <Link to="/import">Importera historik</Link> först om banan saknar data.
              </>
            )}
          </p>
        )}

        <p className="muted">
          <strong>Form</strong> räknar snitt av upp till 5 starter inom 4 månader före loppdagen.
          Få starter drar poängen mot neutral 5 (1 start = 50&nbsp;%, 2 starter = 75&nbsp;%, 3+ = full form).
          Gamla starter utanför fönstret räknas inte.
          <strong> Startpoäng</strong> och <strong>kr/start</strong> räknas per lopp: 70&nbsp;% jämfört med fältet, 30&nbsp;% absolut skala.
          <strong> Vinst senaste start</strong> ger 10 poäng om senaste formraden är vinst inom 2 månader före loppdagen.
        </p>

        <div className="weight-info-box">
          <strong>Vikterna behöver inte summera till 100.</strong>
          {' '}
          Det är <em>förhållandet</em> mellan vikterna som styr Trot Score — att dubbla alla vikter ger samma resultat.
          Värde 0 = parametern ignoreras.
        </div>

        <div className="formula-box">
          <code>Trot Score = Σ (poäng/10 × vikt) / Σ vikter × 100</code>
        </div>

        <div className="weight-bar" aria-hidden="true">
          {params.map((p) =>
            totalWeight > 0 && p.weight > 0 ? (
              <div
                key={p.id}
                className="weight-bar-segment"
                style={{ flex: p.weight }}
                title={`${p.name}: vikt ${formatWeightValue(p.weight)} (${formatWeightShare(p.weight, totalWeight)} av inflytande)`}
              />
            ) : null,
          )}
        </div>
        {totalWeight > 0 && (
          <p className="muted weight-legend">
            Relativ andel:{' '}
            {params
              .filter((p) => p.weight > 0)
              .map((p) => `${p.name} ${formatWeightShare(p.weight, totalWeight)}`)
              .join(' · ')}
          </p>
        )}

        {params.map((p) => (
          <div key={p.id} className="param-row">
            <div>
              <label htmlFor={`weight-${p.id}`}>{p.name}</label>
              {p.autoKey ? (
                <span className="muted param-auto">Auto från ATG</span>
              ) : (
                <span className="muted param-auto">Manuell — markera på loppsidan</span>
              )}
            </div>
            <input
              id={`weight-${p.id}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={p.weight}
              onChange={(e) => updateWeight(p.id, parseFloat(e.target.value))}
            />
            <div className="param-weight-input">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={p.weight}
                onChange={(e) => updateWeight(p.id, parseFloat(e.target.value) || 0)}
                aria-label={`Vikt för ${p.name}`}
              />
              <span className="muted param-weight-unit">vikt</span>
            </div>
          </div>
        ))}

        <p className="muted">
          Summa vikt: {totalWeight} (valfri — behöver inte bli 100).
          {totalWeight > 0 && (
            <>
              {' '}
              Form har t.ex. {formatWeightShare(
                params.find((p) => p.autoKey === 'formPlace')?.weight ?? 0,
                totalWeight,
              )}{' '}
              av inflytandet.
            </>
          )}
          {' '}
          Lopp där du sparat tips påverkas inte förrän du räknar om dem manuellt.
        </p>

        <button onClick={handleSave} disabled={saving || totalWeight === 0}>
          {saving
            ? 'Sparar…'
            : profileMode === 'global'
              ? 'Spara global profil'
              : `Spara ${activeTrack?.name ?? 'bana'}-profil`}
        </button>
        <button
          type="button"
          className="secondary"
          style={{ marginLeft: '0.75rem' }}
          disabled={saving}
          onClick={() => {
            setParams((prev) =>
              prev.map((p) => {
                const def = DEFAULT_PARAMETERS.find(
                  (d) => (d.autoKey && d.autoKey === p.autoKey) || (!d.autoKey && !p.autoKey),
                );
                return def ? { ...p, weight: def.weight } : p;
              }),
            );
            setMessage('Standardvikter införda — spara för att aktivera.');
          }}
        >
          Återställ standardvikter
        </button>
        {message && (
          <p className={message.startsWith('Sparat') || message.startsWith('Föreslagna') ? 'muted' : 'error'} style={{ marginTop: '0.75rem' }}>
            {message}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Optimera vikter (backtest)</h2>
        <BacktestPanel
          params={params}
          profileTrackId={profileMode === 'global' ? null : profileMode}
          onApplyWeights={applySuggestedWeights}
        />
      </div>

      <p className="muted">
        <Link to="/">← Tillbaka till lopp</Link>
      </p>
    </>
  );
}
