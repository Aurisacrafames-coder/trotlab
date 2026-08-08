import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchBacktestTracks,
  optimizeGameSessionBacktest,
  runBacktest,
  runGameSessionBacktest,
} from '../api';
import { formatActualPosition, formatGameLegLabel, formatWeightValue } from '../../shared/format';
import type {
  BacktestGoal,
  BacktestOptimizeResult,
  BacktestSummary,
  GameSession,
  Parameter,
} from '../../shared/types';
import { DEFAULT_BACKTEST_GOAL, OPTIMIZE_TRIAL_OPTIONS, OPTIMIZE_TRIALS_DEFAULT } from '../../shared/types';
import { TrackWideResultPanel } from './TrackWideBacktestResult';

function hitLabel(hit: 'win' | 'top3' | 'miss', winnerRank?: number | null) {
  const className = hit === 'win' ? 'hit-win' : hit === 'top3' ? 'hit-top3' : 'hit-miss';
  const text = hit === 'win' ? 'Träff' : hit === 'top3' ? 'Topp 3' : 'Miss';
  return (
    <>
      <span className={className}>{text}</span>
      {winnerRank != null && <span className="muted"> · Vinnare rank {winnerRank}</span>}
    </>
  );
}

function CompareBox({
  label,
  subtitle,
  hits,
  total,
  hitRate,
  highlight,
}: {
  label: string;
  subtitle?: string;
  hits: number;
  total: number;
  hitRate: number | null;
  highlight?: boolean;
}) {
  return (
    <div className={`backtest-compare-box${highlight ? ' backtest-compare-box-highlight' : ''}`}>
      <div className="muted">{label}</div>
      {subtitle && <div className="compare-box-subtitle">{subtitle}</div>}
      <div className="backtest-compare-value">
        {hits}/{total}
      </div>
      <div className="muted">{hitRate != null ? `${hitRate}% träff` : '—'}</div>
    </div>
  );
}

function ResultTable({ summary }: { summary: BacktestSummary }) {
  if (summary.races.length === 0) return null;

  return (
    <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
      <table>
        <thead>
          <tr>
            <th>Avd</th>
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
              <td>{hitLabel(race.hit, race.winnerRank)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GameSessionAnalyze({ game }: { game: GameSession }) {
  const [goal, setGoal] = useState<BacktestGoal>(DEFAULT_BACKTEST_GOAL);
  const [maxTrials, setMaxTrials] = useState(OPTIMIZE_TRIALS_DEFAULT);
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [trackTesting, setTrackTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<BacktestSummary | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<BacktestOptimizeResult | null>(null);
  const [trackBaselineResult, setTrackBaselineResult] = useState<BacktestSummary | null>(null);
  const [trackSessionResult, setTrackSessionResult] = useState<BacktestSummary | null>(null);
  const [trackRaceCount, setTrackRaceCount] = useState<number | null>(null);
  const trackResultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (game.atgTrackId == null) {
      setTrackRaceCount(null);
      return;
    }
    fetchBacktestTracks()
      .then((tracks) => {
        const track = tracks.find((t) => t.atgTrackId === game.atgTrackId);
        setTrackRaceCount(track?.racesWithResult ?? null);
      })
      .catch(() => setTrackRaceCount(null));
  }, [game.atgTrackId]);

  useEffect(() => {
    if ((trackSessionResult || trackBaselineResult) && trackResultRef.current) {
      trackResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [trackBaselineResult, trackSessionResult]);

  if (game.legsWithResults === 0) return null;

  const sessionLabel = `${game.gameType} ${game.date}`;
  const settingsLink =
    game.atgTrackId != null ? `/installningar?bana=${game.atgTrackId}` : '/installningar';

  function clearTrackResults() {
    setTrackBaselineResult(null);
    setTrackSessionResult(null);
  }

  async function testWeightsOnTrack(weights: Parameter[]) {
    if (game.atgTrackId == null) {
      throw new Error('Omgången saknar ban-id');
    }
    return runBacktest({
      atgTrackId: game.atgTrackId,
      goal,
      weights,
    });
  }

  async function handleTestOnTrack(weights: Parameter[], compareBaseline?: Parameter[]) {
    setTrackTesting(true);
    setError(null);
    clearTrackResults();
    try {
      if (compareBaseline) {
        const [baseline, sessionWeights] = await Promise.all([
          testWeightsOnTrack(compareBaseline),
          testWeightsOnTrack(weights),
        ]);
        setTrackBaselineResult(baseline);
        setTrackSessionResult(sessionWeights);
        setTrackRaceCount(sessionWeights.racesWithResult);
      } else {
        const result = await testWeightsOnTrack(weights);
        setTrackBaselineResult(result);
        setTrackRaceCount(result.racesWithResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ban-test misslyckades');
    } finally {
      setTrackTesting(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setError(null);
    clearTrackResults();
    try {
      const result = await runGameSessionBacktest(game.id, { goal });
      setRunResult(result);
      setOptimizeResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analys misslyckades');
    } finally {
      setRunning(false);
    }
  }

  async function handleOptimize() {
    setOptimizing(true);
    setError(null);
    clearTrackResults();
    try {
      const result = await optimizeGameSessionBacktest(game.id, { goal, maxTrials });
      setOptimizeResult(result);
      setRunResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimering misslyckades');
    } finally {
      setOptimizing(false);
    }
  }

  const weightsForTrackTest = optimizeResult?.optimized.weights ?? runResult?.weights ?? null;
  const baselineForTrackCompare = optimizeResult?.baseline.weights ?? null;
  const trackTestLabel =
    trackRaceCount != null
      ? `Testa mot all historik på ${game.trackName} (${trackRaceCount} lopp)`
      : `Testa mot all historik på ${game.trackName}`;

  return (
    <div className="card">
      <h2>Analysera omgång</h2>

      <div className="profile-context-box" style={{ marginTop: 0 }}>
        <strong>{sessionLabel}</strong>
        <span className="muted">
          {' '}· {game.trackName} · {game.legsWithResults}/{game.legCount} avdelningar med resultat
        </span>
        {trackRaceCount != null && (
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            {trackRaceCount} importerade lopp med resultat på {game.trackName} totalt (alla omgångar).
          </p>
        )}
      </div>

      <p className="muted">
        <strong>Steg 1</strong> testar vikter mot <em>denna omgång</em>.{' '}
        <strong>Steg 2</strong> simulerar samma vikter mot <em>hela banans historik</em> — oavsett
        vilken V86/V85-omgång du importerat.
      </p>

      <h3 className="breakdown-title">Steg 1 — denna omgång</h3>

      <div className="backtest-filters">
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
            disabled={optimizing}
          >
            {OPTIMIZE_TRIAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="backtest-actions">
        <button type="button" onClick={handleRun} disabled={running || optimizing || trackTesting}>
          {running ? 'Testar…' : 'Testa nuvarande vikter'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleOptimize}
          disabled={running || optimizing || trackTesting}
        >
          {optimizing
            ? `Optimerar… (${maxTrials.toLocaleString('sv-SE')} försök)`
            : 'Optimera för denna omgång'}
        </button>
      </div>

      {game.legsWithResults < 3 && (
        <p className="muted backtest-warn" style={{ marginTop: '0.75rem' }}>
          Få avdelningar med resultat — optimering kan ge overanpassade vikter. Använd främst som experiment.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {runResult && runResult.racesWithResult > 0 && (
        <div className="backtest-result" style={{ marginTop: '1rem' }}>
          <p className="muted">
            Nuvarande vikter: {runResult.hits}/{runResult.racesWithResult} träffar
            {runResult.hitRate != null ? ` (${runResult.hitRate}%)` : ''}
            {runResult.hits === runResult.racesWithResult ? ' — alla rätt!' : ''}
          </p>
          <ResultTable summary={runResult} />
        </div>
      )}

      {optimizeResult && optimizeResult.racesWithResult > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div className="backtest-compare">
            <CompareBox
              label="Nuvarande vikter"
              subtitle="Bara denna omgång"
              hits={optimizeResult.baseline.hits}
              total={optimizeResult.baseline.racesWithResult}
              hitRate={optimizeResult.baseline.hitRate}
            />
            <div className="backtest-compare-arrow">→</div>
            <CompareBox
              label="Optimerade vikter"
              subtitle="Bara denna omgång"
              hits={optimizeResult.optimized.hits}
              total={optimizeResult.optimized.racesWithResult}
              hitRate={optimizeResult.optimized.hitRate}
              highlight
            />
          </div>

          {optimizeResult.message && (
            <p
              className={
                optimizeResult.optimized.hits === optimizeResult.racesWithResult
                  ? 'hit-win'
                  : 'muted'
              }
              style={{ marginTop: '0.75rem' }}
            >
              {optimizeResult.message}
            </p>
          )}

          {optimizeResult.improved && (
            <div className="backtest-suggested" style={{ marginTop: '0.75rem' }}>
              <h3 className="breakdown-title">Föreslagna vikter (denna omgång)</h3>
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
            </div>
          )}
        </div>
      )}

      {game.atgTrackId != null && weightsForTrackTest && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 className="breakdown-title">Steg 2 — all historik på {game.trackName}</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Simulerar vikterna från <strong>{sessionLabel}</strong> mot alla importerade lopp på{' '}
            {game.trackName}. Öppna en annan omgång på banan om du vill testa med den istället.
          </p>
          <div className="backtest-actions">
            <button
              type="button"
              onClick={() =>
                handleTestOnTrack(
                  weightsForTrackTest,
                  baselineForTrackCompare ?? undefined,
                )
              }
              disabled={trackTesting || running || optimizing}
            >
              {trackTesting ? 'Testar mot banan…' : trackTestLabel}
            </button>
          </div>

          {(trackSessionResult || trackBaselineResult) && (
            <div ref={trackResultRef} style={{ marginTop: '1rem' }}>
              {trackSessionResult ? (
                <TrackWideResultPanel
                  trackName={game.trackName}
                  goal={goal}
                  baseline={trackBaselineResult}
                  session={trackSessionResult}
                  sessionWeightsLabel={
                    optimizeResult ? 'Optimerade vikter (denna omgång)' : 'Nuvarande vikter'
                  }
                />
              ) : trackBaselineResult ? (
                <TrackWideResultPanel
                  trackName={game.trackName}
                  goal={goal}
                  baseline={null}
                  session={trackBaselineResult}
                  sessionWeightsLabel="Nuvarande vikter"
                />
              ) : null}
              <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                Nöjd med vikterna?{' '}
                <Link to={settingsLink}>Spara som banprofil i Inställningar</Link>.
              </p>
            </div>
          )}
        </div>
      )}

      {(runResult || optimizeResult) && (
        <>
          <h3 className="breakdown-title" style={{ marginTop: '1.5rem' }}>
            Detalj per avdelning — {sessionLabel}
          </h3>
          {optimizeResult ? (
            <>
              <p className="muted">Nuvarande vikter</p>
              <ResultTable summary={optimizeResult.baseline} />
              <p className="muted" style={{ marginTop: '1rem' }}>
                Optimerade vikter
              </p>
              <ResultTable summary={optimizeResult.optimized} />
            </>
          ) : runResult ? (
            <ResultTable summary={runResult} />
          ) : null}
        </>
      )}
    </div>
  );
}
