import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  fetchAutoOptimizerStatus,
  fetchBacktestTracks,
  fetchKnownTracks,
  fetchParameters,
  fetchTrackProfile,
  fetchTrackProfiles,
  optimizeBacktest,
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
import { DEFAULT_PARAMETERS, mergeTrackParameterWeights, OPTIMIZE_TRIAL_OPTIONS, OPTIMIZE_TRIALS_DEFAULT, DEFAULT_BACKTEST_GOAL } from '../../shared/types';

function hitLabel(hit: 'win' | 'top3' | 'miss') {
  if (hit === 'win') return <span className="hit-win">Träff</span>;
  if (hit === 'top3') return <span className="hit-top3">Topp 3</span>;
  return <span className="hit-miss">Miss</span>;
}

function AutoOptimizeBanner({
  status,
  activeProfileTrackId,
  activeTrackName,
  onApplyWeights,
  onUseResult,
}: {
  status: AutoOptimizerStatus;
  activeProfileTrackId: number | null;
  activeTrackName: string | null;
  onApplyWeights: (weights: Parameter[]) => void;
  onUseResult: (result: BacktestOptimizeResult) => void;
}) {
  if (status.running) {
    return (
      <div className="auto-opt-banner auto-opt-running">
        <strong>Optimerar {status.trackName ?? 'banan'}</strong>
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
          {activeTrackName && activeProfileTrackId != null && (
            <p className="muted" style={{ margin: '0.5rem 0 0' }}>
              Kör <strong>Optimera {activeTrackName} i bakgrunden</strong> nedan när du har minst 3 lopp med resultat.
            </p>
          )}
        </div>
      );
    }
    return null;
  }

  const result = status.lastResult;
  return (
    <div className="auto-opt-banner auto-opt-done">
      <strong>Optimering klar — {result.trackName}</strong>
      {status.lastRunAt && (
        <p className="muted" style={{ margin: '0.35rem 0 0' }}>
          Senast körd {new Date(status.lastRunAt).toLocaleString('sv-SE')}
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
  profileMode,
  profileTrackId,
  activeTrackName,
  onApplyWeights,
  onSelectProfileTrack,
}: {
  params: Parameter[];
  profileMode: 'global' | number;
  profileTrackId: number | null;
  activeTrackName: string | null;
  onApplyWeights: (weights: Parameter[]) => void;
  onSelectProfileTrack: (atgTrackId: number) => void;
}) {
  const [tracks, setTracks] = useState<BacktestTrackOption[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [atgTrackId, setAtgTrackId] = useState<number | ''>('');
  const [startMethod, setStartMethod] = useState<'' | 'auto' | 'volte'>('');
  const [goal, setGoal] = useState<BacktestGoal>(DEFAULT_BACKTEST_GOAL);
  const [maxTrials, setMaxTrials] = useState<number>(OPTIMIZE_TRIALS_DEFAULT);
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
        } else if (profileTrackId == null) {
          setAtgTrackId('');
        }
      })
      .finally(() => setTracksLoading(false));
  }, [profileTrackId]);

  useEffect(() => {
    if (profileTrackId != null) {
      setAtgTrackId(profileTrackId);
    }
  }, [profileTrackId]);

  useEffect(() => {
    let cancelled = false;
    const trackFilter =
      profileTrackId ?? (atgTrackId === '' ? undefined : Number(atgTrackId));

    setAutoStatus(null);

    async function pollAutoStatus() {
      try {
        const status = await fetchAutoOptimizerStatus(trackFilter);
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
  }, [profileTrackId, atgTrackId]);

  const selectedTrack = tracks.find((t) => t.atgTrackId === atgTrackId);
  const workingTrackName =
    profileTrackId != null ? activeTrackName : selectedTrack?.trackName ?? null;
  const canOptimize = atgTrackId !== '' && (selectedTrack?.racesWithResult ?? 0) >= 3;
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
      const trackId = Number(atgTrackId);
      let status = await optimizeBacktest({ ...filterBody, maxTrials });
      setAutoStatus(status);

      while (status.running) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        status = await fetchAutoOptimizerStatus(trackId);
        setAutoStatus(status);
      }

      if (status.lastResult) {
        setOptimizeResult(status.lastResult);
      } else if (status.phase === 'error') {
        setError(status.message ?? 'Optimering misslyckades');
      }
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
      <ol className="settings-workflow muted">
        <li>Välj bana ovan (inte &quot;Global standard&quot; om du vill optimera en specifik bana).</li>
        <li>Testa eller optimera vikter mot importerade lopp med resultat.</li>
        <li>Klicka <strong>Använd föreslagna vikter</strong> — reglagen fylls i ovan.</li>
        <li>Klicka <strong>Spara …-profil</strong> längst upp för att aktivera.</li>
      </ol>

      {profileMode === 'global' && (
        <p className="profile-context-box">
          Du redigerar <strong>global standard</strong>. Välj t.ex. Tingsryd ovan om du vill spara egna vikter per bana.
        </p>
      )}

      {profileTrackId != null && workingTrackName && (
        <p className="profile-context-box">
          Optimering och test gäller <strong>{workingTrackName}</strong>
          {selectedTrack
            ? ` · ${selectedTrack.racesWithResult} lopp med resultat i databasen`
            : ' · inga importerade lopp ännu — '}
          {!selectedTrack && <Link to="/import">importera historik</Link>}
        </p>
      )}

      <p className="muted" style={{ marginTop: 0 }}>
        Träff räknas om <strong>någon av de tre hästar med högst Trot Score</strong> vunnit
        (vinstmål) eller kommit topp 3 (topp 3-mål). Värmning exkluderas.
      </p>

      {autoStatus && (
        <AutoOptimizeBanner
          status={autoStatus}
          activeProfileTrackId={profileTrackId}
          activeTrackName={activeTrackName}
          onApplyWeights={onApplyWeights}
          onUseResult={(result) => {
            setOptimizeResult(result);
            setAtgTrackId(result.atgTrackId);
            onSelectProfileTrack(result.atgTrackId);
          }}
        />
      )}

      {tracks.length === 0 ? (
        <p className="muted">
          Inga banor med importerade lopp ännu. Gå till{' '}
          <Link to="/import">Importera</Link> och hämta historik för banan du vill optimera.
        </p>
      ) : profileTrackId != null && !selectedTrack ? (
        <p className="backtest-warn">
          {workingTrackName ?? 'Banan'} finns i listan men har inga importerade lopp ännu.
          {' '}<Link to="/import">Importera historik</Link> under Importera (bulk-import) innan du kan optimera.
        </p>
      ) : (
        <>
          {profileMode === 'global' && (
            <div className="backtest-filters">
              <label className="backtest-field">
                <span className="muted">Bana att testa</span>
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
            </div>
          )}

          <div className="backtest-filters">
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
                <option value="win">Vinstträff</option>
                <option value="top3">Topp 3-träff</option>
              </select>
            </label>

            <label className="backtest-field">
              <span className="muted">Optimeringsförsök</span>
              <select
                value={maxTrials}
                onChange={(e) => setMaxTrials(Number(e.target.value))}
                disabled={running || optimizing || autoStatus?.running}
              >
                {OPTIMIZE_TRIAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {(() => {
            const selected = OPTIMIZE_TRIAL_OPTIONS.find((o) => o.value === maxTrials);
            return selected ? (
              <p className="muted" style={{ marginTop: '-0.25rem' }}>
                {selected.hint}. Optimeringen körs i bakgrunden — du kan fortsätta surfa medan den pågår.
              </p>
            ) : null;
          })()}

          <div className="backtest-actions">
            <button
              type="button"
              className="secondary"
              onClick={handleRun}
              disabled={running || optimizing || !canOptimize}
            >
              {running ? 'Kör…' : 'Testa nuvarande vikter'}
            </button>
            <button
              type="button"
              onClick={handleOptimize}
              disabled={running || optimizing || autoStatus?.running || !canOptimize}
            >
              {optimizing || autoStatus?.running
                ? `Optimerar… (${maxTrials.toLocaleString('sv-SE')} försök)`
                : 'Optimera vikter'}
            </button>
          </div>

          {!canOptimize && selectedTrack && selectedTrack.racesWithResult > 0 && selectedTrack.racesWithResult < 3 && (
            <p className="backtest-warn">
              Minst 3 lopp med resultat krävs för optimering ({selectedTrack.racesWithResult} hittills).
            </p>
          )}

          {selectedTrack && selectedTrack.racesWithResult >= 3 && selectedTrack.racesWithResult < 5 && (
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
  const [searchParams] = useSearchParams();
  const [params, setParams] = useState<Parameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [profileMode, setProfileMode] = useState<'global' | number>(() => {
    const bana = searchParams.get('bana');
    if (!bana) return 'global';
    const id = Number(bana);
    return Number.isFinite(id) ? id : 'global';
  });
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
        ? fetchParameters().then((globalParams) => globalParams)
        : Promise.all([fetchParameters(), fetchTrackProfile(profileMode)]).then(
            ([globalParams, trackParams]) =>
              mergeTrackParameterWeights(trackParams, globalParams),
          );
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
        <h2>1. Viktprofil per bana</h2>
        <p className="muted">
          Varje parameter får poäng 0–10 (auto från ATG, eller manuellt för Värmning).
          Du styr inflytande med <strong>relativ vikt</strong> (0–100).
        </p>

        <label className="backtest-field profile-select-field">
          <span className="profile-context-label">Aktiv bana</span>
          <select
            value={profileMode === 'global' ? 'global' : String(profileMode)}
            onChange={(e) => {
              const v = e.target.value;
              setProfileMode(v === 'global' ? 'global' : Number(v));
            }}
          >
            <option value="global">Global standard (fallback för alla banor)</option>
            {knownTracks.map((t) => (
              <option key={t.atgTrackId} value={t.atgTrackId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <div className="profile-active-banner" aria-live="polite">
          <div className="profile-active-banner-label">Du redigerar nu</div>
          <div className="profile-active-banner-name">
            {profileMode === 'global' ? 'Global standard' : activeTrack?.name ?? 'Bana'}
          </div>
          {profileMode !== 'global' && (
            <div className="profile-active-banner-meta muted">
              {activeProfileSummary
                ? `Sparad profil · uppdaterad ${new Date(activeProfileSummary.updatedAt).toLocaleString('sv-SE')}`
                : 'Ingen sparad profil ännu — justera vikter och spara nedan'}
            </div>
          )}
        </div>

        {trackProfiles.length > 0 && (
          <p className="muted profile-saved-list">
            Sparade banprofiler:{' '}
            {trackProfiles.map((p) => p.trackName).join(', ')}
            {profileMode !== 'global' && activeTrack && !activeProfileSummary
              ? ` (${activeTrack.name} saknas här tills du sparar)`
              : ''}
          </p>
        )}

        {profileMode === 'global' ? (
          <p className="muted" style={{ marginTop: 0 }}>
            Används för banor utan egen sparad profil. Välj t.ex. Tingsryd i listan ovan för en ban-specifik profil.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            Gäller alla lopp på <strong>{activeTrack?.name}</strong> som inte har sparat tips.
            {activeProfileSummary && (
              <>
                {' '}
                {activeProfileSummary.racesWithResult} lopp med resultat i databasen.
              </>
            )}
            {!activeProfileSummary && (
              <>
                {' '}
                <Link to="/import">Importera historik</Link> om banan saknar data för optimering.
              </>
            )}
          </p>
        )}

        <p className="muted">
          <strong>Form</strong> räknar snitt av upp till 5 starter inom 4 månader före loppdagen.
          Galopp räknas med (plats 0 → låg formpoäng).
          Få starter drar poängen mot neutral 5 (1 start = 50&nbsp;%, 2 starter = 75&nbsp;%, 3+ = full form).
          Gamla starter utanför fönstret räknas inte.
          <strong> Startpoäng</strong> och <strong>kr/start</strong> räknas per lopp: 70&nbsp;% jämfört med fältet, 30&nbsp;% absolut skala.
          <strong> Vinst senaste start</strong> ger poäng om senaste formraden är vinst inom 2 månader före loppdagen:
          3 (vinst under 70&nbsp;000&nbsp;kr i 1:a pris), 7 (70&nbsp;000&nbsp;kr eller mer), +2 vid rekordtid eller två raka segrar inom samma fönster (max 5 resp. 9).
          Rekordtid detekteras från ATG (km-tid med r eller hästens livsrekord).
          {' '}
          <strong>Startstraff</strong> drar ner poäng vid volt/autostart när hästen står
          ≥20&nbsp;m bakom kortaste distansen i fältet (neutral 5 under 20&nbsp;m).
          {' '}
          <strong>Kusk vinst%</strong> använder två siffror: bana (12 mån på aktuell bana) och totalt (12 mån alla banor).
          Poäng = 60&nbsp;% bana + 40&nbsp;% totalt (varje siffra mappas 0–25&nbsp;% → 0–10 poäng).
          {' '}
          <strong>Tränare vinst%</strong> använder global tränarstat (2 mån, alla banor) —
          här styr du bara <em>vikten</em> per bana.
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
              {p.autoKey === 'trainerWin' ? (
                <span className="muted param-auto">
                  Auto från ATG — global tränarstat (2 mån, alla banor)
                </span>
              ) : p.autoKey ? (
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
        <p className="muted settings-save-hint">
          Steg 4 efter optimering: spara här för att Trot Score ska använda vikterna på banan.
        </p>
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
        <h2>2. Testa &amp; optimera</h2>
        <BacktestPanel
          params={params}
          profileMode={profileMode}
          profileTrackId={profileMode === 'global' ? null : profileMode}
          activeTrackName={activeTrack?.name ?? null}
          onApplyWeights={applySuggestedWeights}
          onSelectProfileTrack={(atgTrackId) => setProfileMode(atgTrackId)}
        />
      </div>

      <p className="muted">
        <Link to="/">← Tillbaka till lopp</Link>
      </p>
    </>
  );
}
