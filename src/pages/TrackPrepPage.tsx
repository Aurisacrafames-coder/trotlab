import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchBacktestTracks, fetchKnownTracks, fetchTrackMissAnalysis, saveTrackProfile } from '../api';
import { formatGameLegLabel } from '../../shared/format';
import type { BacktestGoal, MissAnalysisBucket, TrackMissAnalysis } from '../../shared/types';
import { DEFAULT_BACKTEST_GOAL } from '../../shared/types';
import TrackPrepBrief from '../components/TrackPrepBrief';
import { formatWeightValue } from '../../shared/format';

function goalText(goal: BacktestGoal): string {
  return goal === 'win' ? 'vinstträff' : 'topp 3-träff';
}

function BucketTable({ title, buckets }: { title: string; buckets: MissAnalysisBucket[] }) {
  if (buckets.length === 0) return null;

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3 className="breakdown-title">{title}</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Typ</th>
              <th>Träff</th>
              <th>Miss</th>
              <th>Totalt</th>
              <th>Träff %</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>{b.hits}</td>
                <td>{b.misses}</td>
                <td>{b.total}</td>
                <td>{b.hitRate != null ? `${b.hitRate}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TrackPrepPage() {
  const [searchParams] = useSearchParams();
  const initialTrackId = (() => {
    const raw = searchParams.get('bana');
    if (!raw) return 6;
    const id = Number(raw);
    return Number.isFinite(id) ? id : 6;
  })();

  const [knownTracks, setKnownTracks] = useState<Array<{ atgTrackId: number; name: string }>>([]);
  const [backtestTracks, setBacktestTracks] = useState<Array<{ atgTrackId: number; racesWithResult: number; raceCount: number }>>([]);
  const [atgTrackId, setAtgTrackId] = useState(initialTrackId);
  const [goal, setGoal] = useState<BacktestGoal>(DEFAULT_BACKTEST_GOAL);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TrackMissAnalysis | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchKnownTracks(), fetchBacktestTracks()])
      .then(([known, backtest]) => {
        setKnownTracks(known.map((t) => ({ atgTrackId: t.atgTrackId, name: t.name })));
        setBacktestTracks(backtest);
      })
      .finally(() => setLoading(false));
  }, []);

  const trackOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const t of knownTracks) byId.set(t.atgTrackId, t.name);
    for (const t of backtestTracks) {
      if (!byId.has(t.atgTrackId)) byId.set(t.atgTrackId, `Bana ${t.atgTrackId}`);
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ atgTrackId: id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }, [knownTracks, backtestTracks]);

  const selectedTrackName = trackOptions.find((t) => t.atgTrackId === atgTrackId)?.name ?? 'Banan';
  const trackStats = backtestTracks.find((t) => t.atgTrackId === atgTrackId);

  async function runAnalysis(trackId = atgTrackId, analysisGoal = goal) {
    setAnalyzing(true);
    setError(null);
    try {
      const result = await fetchTrackMissAnalysis({ atgTrackId: trackId, goal: analysisGoal });
      setAnalysis(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analys misslyckades');
      setAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSaveSuggested() {
    if (!analysis?.suggestedWeights) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await saveTrackProfile(atgTrackId, analysis.trackName, analysis.suggestedWeights);
      setSaveMessage(`Sparat — ${analysis.trackName} använder nu de optimerade vikterna.`);
      setAnalysis({ ...analysis, usesTrackProfile: true });
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : 'Kunde inte spara vikter');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (loading || !atgTrackId) return;
    runAnalysis(atgTrackId, goal);
  }, [loading, atgTrackId, goal]);

  if (loading) return <p className="muted">Laddar banor…</p>;

  return (
    <>
      <div className="card">
        <h2>Bananalys inför spel</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Se var nuvarande vikter missar på en bana — vilken typ av lopp det gäller och vad du kan göra åt det.
          Använder sparad banprofil om den finns, annars globala vikter.
        </p>

        <div className="backtest-filters">
          <label className="backtest-field">
            <span className="muted">Bana</span>
            <select
              value={atgTrackId}
              onChange={(e) => setAtgTrackId(Number(e.target.value))}
            >
              {trackOptions.map((t) => (
                <option key={t.atgTrackId} value={t.atgTrackId}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="backtest-field">
            <span className="muted">Mål</span>
            <select value={goal} onChange={(e) => setGoal(e.target.value as BacktestGoal)}>
              <option value="win">Vinstträff</option>
              <option value="top3">Topp 3-träff</option>
            </select>
          </label>
        </div>

        <div className="backtest-actions">
          <button type="button" onClick={() => runAnalysis()} disabled={analyzing}>
            {analyzing ? 'Analyserar…' : 'Uppdatera analys'}
          </button>
          <Link to={`/installningar?bana=${atgTrackId}`} className="secondary button-link">
            Inställningar för {selectedTrackName}
          </Link>
        </div>

        {trackStats && (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            {trackStats.racesWithResult} lopp med resultat importerade
            {trackStats.raceCount > trackStats.racesWithResult
              ? ` (${trackStats.raceCount - trackStats.racesWithResult} utan resultat ännu)`
              : ''}
            .
          </p>
        )}

        {error && <p className="error">{error}</p>}
      </div>

      {analysis && (
        <>
          <div className="card">
            <h2>Inför spel — sammanfattning</h2>
            <TrackPrepBrief
              atgTrackId={atgTrackId}
              trackName={analysis.trackName}
              analysis={analysis}
              showSaveButton={false}
            />

            {analysis.suggestedWeights && (
              <div style={{ marginTop: '1rem' }}>
                <h3 className="breakdown-title">Föreslagna vikter från djup optimering</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  {analysis.suggestedHitRate != null && (
                    <>
                      Backtest: {analysis.suggestedHitRate}% träff
                      {analysis.suggestedHitsGained != null && analysis.suggestedHitsGained > 0
                        ? ` (+${analysis.suggestedHitsGained} träffar mot nuvarande)`
                        : ''}
                      .
                    </>
                  )}
                </p>
                <p className="muted" style={{ marginTop: '0.5rem' }}>
                  {analysis.suggestedWeights
                    .filter((p) => p.weight > 0)
                    .sort((a, b) => b.weight - a.weight)
                    .map((p) => `${p.name} ${formatWeightValue(p.weight)}`)
                    .join(' · ')}
                </p>
                <div className="backtest-actions" style={{ marginTop: '0.75rem' }}>
                  <button type="button" onClick={handleSaveSuggested} disabled={saving}>
                    {saving ? 'Sparar…' : `Spara optimerade vikter på ${analysis.trackName}`}
                  </button>
                </div>
                {saveMessage && (
                  <p className={saveMessage.startsWith('Sparat') ? 'hit-win' : 'error'} style={{ marginTop: '0.75rem' }}>
                    {saveMessage}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <h2>{analysis.trackName} — nuvarande vikter</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {analysis.usesTrackProfile ? 'Sparad banprofil' : 'Globala vikter (ingen sparad banprofil)'}
              {' · '}
              {goalText(analysis.goal)}
            </p>

            {analysis.upcomingRaceCount > 0 && (
              <p className="profile-context-box">
                {analysis.upcomingRaceCount} kommande lopp på {analysis.trackName} utan resultat
                (t.ex. helgens V85). Analysen nedan gäller <strong>historik</strong> — importera fler
                avslutade omgångar för bättre underlag.
              </p>
            )}

            {analysis.racesWithResult === 0 ? (
              <p className="backtest-warn">
                Ingen historik med resultat på {analysis.trackName}.{' '}
                <Link to="/import">Importera avslutade omgångar</Link> (bulk-import med Åby) innan du kan
                se missmönster.
              </p>
            ) : (
              <div className="track-hit-summary" style={{ textAlign: 'left' }}>
                <p className="track-hit-summary-label">Träff på all importerad historik</p>
                <p className="track-hit-summary-value" style={{ textAlign: 'left' }}>
                  {analysis.hitRate != null ? `${analysis.hitRate}%` : '—'}
                </p>
                <p className="muted track-hit-summary-detail">
                  {analysis.hits}/{analysis.racesWithResult} träffar · {analysis.misses} missar
                </p>
              </div>
            )}

            {analysis.insights.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h3 className="breakdown-title">Vad kan vi göra?</h3>
                <ul className="prep-insights">
                  {analysis.insights.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </div>
            )}

            <BucketTable title="Per lopptyp (klass, ålder, stolopp m.m.)" buckets={analysis.byRaceCategory} />
            <BucketTable title="Per startmetod" buckets={analysis.byStartMethod} />
            <BucketTable title="Per distans" buckets={analysis.byDistance} />
            <BucketTable title="Per spelform" buckets={analysis.byGameType} />
            {analysis.byWinnerRank.length > 0 && (
              <BucketTable title="Missar — var rankade vinnaren?" buckets={analysis.byWinnerRank} />
            )}
          </div>

          {analysis.missRaces.length > 0 && (
            <div className="card">
              <h2>Missade lopp ({analysis.missRaces.length})</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Lopp där ingen av topp 3 i Trot Score träffade enligt {goalText(analysis.goal)}.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Lopp</th>
                      <th>Start</th>
                      <th>Distans</th>
                      <th>Fält</th>
                      <th>Vinnare</th>
                      <th>Vinnare rank</th>
                      <th>Topp 3 val</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.missRaces.map((race) => (
                      <tr key={race.sessionId}>
                        <td>
                          <Link to={`/lopp/${race.sessionId}`}>
                            {formatGameLegLabel(race.gameType, race.legNumber, race.trackRaceNumber)}
                          </Link>
                          <div className="muted">{race.date}</div>
                        </td>
                        <td>{race.startMethod === 'volte' ? 'Volt' : race.startMethod === 'auto' ? 'Auto' : '—'}</td>
                        <td>{race.distance != null ? `${race.distance} m` : '—'}</td>
                        <td>{race.fieldSize || '—'}</td>
                        <td>
                          {race.winnerName ? (
                            <>
                              #{race.winnerStartNumber} {race.winnerName}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{race.winnerRank ?? '—'}</td>
                        <td>
                          <div className="backtest-top-picks">
                            {race.topPicks.map((pick) => (
                              <div key={pick.startNumber} className="backtest-top-pick">
                                <span>
                                  #{pick.startNumber} {pick.horseName}
                                </span>
                                <span className="muted">
                                  {pick.trotScore.toFixed(1)} · pl. {pick.actualPosition ?? '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
