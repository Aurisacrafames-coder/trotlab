import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchGameSessions,
  optimizeGameSessionBacktest,
  runBacktest,
  type GameSessionListItem,
} from '../api';
import { formatWeightValue } from '../../shared/format';
import type { BacktestGoal, BacktestOptimizeResult, BacktestSummary, Parameter } from '../../shared/types';
import {
  DEFAULT_BACKTEST_GOAL,
  OPTIMIZE_TRIAL_OPTIONS,
  OPTIMIZE_TRIALS_DEFAULT,
} from '../../shared/types';
import { TrackWideResultPanel } from './TrackWideBacktestResult';

function formatSessionOption(game: GameSessionListItem): string {
  return `${game.gameType} ${game.date} · ${game.legsWithResults}/${game.legCount} avd med resultat`;
}

export default function SessionTrackBacktest({
  atgTrackId,
  trackName,
  initialSessionId,
  onApplyWeights,
}: {
  atgTrackId: number;
  trackName: string;
  initialSessionId?: number | null;
  onApplyWeights: (weights: Parameter[]) => void;
}) {
  const [sessions, setSessions] = useState<GameSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<number | ''>('');
  const [goal, setGoal] = useState<BacktestGoal>(DEFAULT_BACKTEST_GOAL);
  const [maxTrials, setMaxTrials] = useState(OPTIMIZE_TRIALS_DEFAULT);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<BacktestOptimizeResult | null>(null);
  const [trackBaseline, setTrackBaseline] = useState<BacktestSummary | null>(null);
  const [trackSession, setTrackSession] = useState<BacktestSummary | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetchGameSessions()
      .then((list) => {
        const onTrack = list.filter(
          (g) => g.atgTrackId === atgTrackId && g.legsWithResults > 0,
        );
        setSessions(onTrack);
        if (initialSessionId != null && onTrack.some((g) => g.id === initialSessionId)) {
          setSessionId(initialSessionId);
        } else if (onTrack.length === 1) {
          setSessionId(onTrack[0].id);
        } else {
          setSessionId('');
        }
      })
      .finally(() => setLoading(false));
  }, [atgTrackId, initialSessionId]);

  useEffect(() => {
    if ((trackSession || trackBaseline) && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [trackBaseline, trackSession]);

  const selectedSession = sessions.find((g) => g.id === sessionId);
  const canRun = sessionId !== '' && (selectedSession?.legsWithResults ?? 0) >= 1;

  async function handleRun() {
    if (sessionId === '') return;
    setRunning(true);
    setError(null);
    setOptimizeResult(null);
    setTrackBaseline(null);
    setTrackSession(null);
    try {
      const optimized = await optimizeGameSessionBacktest(Number(sessionId), { goal, maxTrials });
      setOptimizeResult(optimized);

      const [baselineTrack, sessionTrack] = await Promise.all([
        runBacktest({
          atgTrackId,
          goal,
          weights: optimized.baseline.weights,
        }),
        runBacktest({
          atgTrackId,
          goal,
          weights: optimized.optimized.weights,
        }),
      ]);
      setTrackBaseline(baselineTrack);
      setTrackSession(sessionTrack);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test misslyckades');
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return <p className="muted">Laddar omgångar…</p>;
  }

  if (sessions.length === 0) {
    return (
      <p className="muted">
        Inga omgångar med resultat på {trackName} ännu.{' '}
        <Link to="/import">Importera</Link> eller hämta resultat på en omgång först.
      </p>
    );
  }

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Optimera vikter <strong>enbart mot en vald omgång</strong>, sedan jämför hur de presterar mot{' '}
        <strong>all importerad historik</strong> på banan — samma test som banprofil-optimering men
        med utgångspunkt från en specifik V86/V85-omgång.
      </p>

      <div className="backtest-filters">
        <label className="backtest-field">
          <span className="muted">Omgång</span>
          <select
            value={sessionId}
            onChange={(e) => {
              setSessionId(e.target.value ? Number(e.target.value) : '');
              setOptimizeResult(null);
              setTrackBaseline(null);
              setTrackSession(null);
            }}
          >
            <option value="">Välj omgång…</option>
            {sessions.map((g) => (
              <option key={g.id} value={g.id}>
                {formatSessionOption(g)}
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

        <label className="backtest-field">
          <span className="muted">Optimeringsförsök</span>
          <select
            value={maxTrials}
            onChange={(e) => setMaxTrials(Number(e.target.value))}
            disabled={running}
          >
            {OPTIMIZE_TRIAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedSession && selectedSession.legsWithResults < 3 && (
        <p className="muted backtest-warn">
          Få avdelningar med resultat — optimering kan ge overanpassade vikter.
        </p>
      )}

      <div className="backtest-actions">
        <button type="button" onClick={handleRun} disabled={running || !canRun}>
          {running
            ? `Optimerar & testar… (${maxTrials.toLocaleString('sv-SE')} försök)`
            : 'Optimera omgång & testa mot all historik'}
        </button>
        {selectedSession && (
          <Link to={`/omgang/${selectedSession.id}`} className="muted">
            Öppna omgång →
          </Link>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {optimizeResult && optimizeResult.racesWithResult > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3 className="breakdown-title">
            Steg 1 — denna omgång ({selectedSession?.legsWithResults ?? optimizeResult.racesWithResult}{' '}
            avd)
          </h3>
          <div className="backtest-compare">
            <div className="backtest-compare-box">
              <div className="muted">Nuvarande vikter</div>
              <div className="compare-box-subtitle">Bara vald omgång</div>
              <div className="backtest-compare-value">
                {optimizeResult.baseline.hits}/{optimizeResult.baseline.racesWithResult}
              </div>
              <div className="muted">
                {optimizeResult.baseline.hitRate != null
                  ? `${optimizeResult.baseline.hitRate}% träff`
                  : '—'}
              </div>
            </div>
            <div className="backtest-compare-arrow">→</div>
            <div className="backtest-compare-box backtest-compare-box-highlight">
              <div className="muted">Optimerade vikter</div>
              <div className="compare-box-subtitle">Bara vald omgång</div>
              <div className="backtest-compare-value">
                {optimizeResult.optimized.hits}/{optimizeResult.optimized.racesWithResult}
              </div>
              <div className="muted">
                {optimizeResult.optimized.hitRate != null
                  ? `${optimizeResult.optimized.hitRate}% träff`
                  : '—'}
              </div>
            </div>
          </div>

          {optimizeResult.message && (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              {optimizeResult.message}
            </p>
          )}

          {optimizeResult.improved && (
            <div className="backtest-suggested" style={{ marginTop: '0.75rem' }}>
              <h3 className="breakdown-title">Föreslagna vikter (från omgången)</h3>
              <ul className="backtest-weight-list">
                {optimizeResult.optimized.weights.map((p) => {
                  const prev = optimizeResult.baseline.weights.find((b) => b.id === p.id);
                  const changed = prev && prev.weight !== p.weight;
                  return (
                    <li key={p.id} className={changed ? 'backtest-weight-changed' : undefined}>
                      <span>{p.name}</span>
                      <span>
                        {formatWeightValue(prev?.weight ?? 0)} →{' '}
                        <strong>{formatWeightValue(p.weight)}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button type="button" onClick={() => onApplyWeights(optimizeResult.optimized.weights)}>
                Använd omgångens vikter
              </button>
              <p className="muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Vikterna fylls i ovan — spara banprofilen för att aktivera.
              </p>
            </div>
          )}
        </div>
      )}

      {trackSession && (
        <div ref={resultRef} style={{ marginTop: '1rem' }}>
          <h3 className="breakdown-title">Steg 2 — all historik på {trackName}</h3>
          <TrackWideResultPanel
            trackName={trackName}
            goal={goal}
            baseline={trackBaseline}
            session={trackSession}
          />
        </div>
      )}
    </>
  );
}
