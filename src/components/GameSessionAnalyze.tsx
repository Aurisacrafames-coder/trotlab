import { useState } from 'react';
import { Link } from 'react-router-dom';
import { optimizeGameSessionBacktest, runBacktest, runGameSessionBacktest } from '../api';
import { formatActualPosition, formatGameLegLabel, formatWeightValue } from '../../shared/format';
import type {
  BacktestGoal,
  BacktestOptimizeResult,
  BacktestSummary,
  GameSession,
  Parameter,
} from '../../shared/types';
import { DEFAULT_BACKTEST_GOAL, OPTIMIZE_TRIAL_OPTIONS, OPTIMIZE_TRIALS_DEFAULT } from '../../shared/types';

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
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<BacktestSummary | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<BacktestOptimizeResult | null>(null);
  const [trackBaselineResult, setTrackBaselineResult] = useState<BacktestSummary | null>(null);
  const [trackSessionResult, setTrackSessionResult] = useState<BacktestSummary | null>(null);
  const [trackTesting, setTrackTesting] = useState(false);

  if (game.legsWithResults === 0) return null;

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

  async function handleTestCurrentOnTrack() {
    if (!runResult) return;
    setTrackTesting(true);
    setError(null);
    clearTrackResults();
    try {
      const result = await testWeightsOnTrack(runResult.weights);
      setTrackBaselineResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ban-test misslyckades');
    } finally {
      setTrackTesting(false);
    }
  }

  async function handleTestSessionWeightsOnTrack() {
    if (!optimizeResult) return;
    setTrackTesting(true);
    setError(null);
    clearTrackResults();
    try {
      const [baseline, sessionWeights] = await Promise.all([
        testWeightsOnTrack(optimizeResult.baseline.weights),
        testWeightsOnTrack(optimizeResult.optimized.weights),
      ]);
      setTrackBaselineResult(baseline);
      setTrackSessionResult(sessionWeights);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ban-test misslyckades');
    } finally {
      setTrackTesting(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const result = await runGameSessionBacktest(game.id, { goal });
      setRunResult(result);
      setOptimizeResult(null);
      clearTrackResults();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analys misslyckades');
    } finally {
      setRunning(false);
    }
  }

  async function handleOptimize() {
    setOptimizing(true);
    setError(null);
    try {
      const result = await optimizeGameSessionBacktest(game.id, { goal, maxTrials });
      setOptimizeResult(result);
      setRunResult(null);
      clearTrackResults();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimering misslyckades');
    } finally {
      setOptimizing(false);
    }
  }

  const settingsLink =
    game.atgTrackId != null
      ? `/installningar?bana=${game.atgTrackId}`
      : '/installningar';

  return (
    <div className="card">
      <h2>Analysera omgång</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Testa om nuvarande vikter hade gett träff på alla {game.legsWithResults} avdelningar med resultat,
        eller optimera vikterna <strong>enbart mot denna omgång</strong>.
        Träff = någon av topp 3 i Trot Score träffar enligt valt mål.
      </p>

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
        <button type="button" onClick={handleRun} disabled={running || optimizing}>
          {running ? 'Testar…' : 'Testa nuvarande vikter'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleOptimize}
          disabled={running || optimizing}
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
          <h3 className="breakdown-title">Nuvarande vikter</h3>
          <p className="muted">
            {runResult.hits}/{runResult.racesWithResult} träffar
            {runResult.hitRate != null ? ` (${runResult.hitRate}%)` : ''}
            {runResult.hits === runResult.racesWithResult ? ' — alla rätt!' : ''}
          </p>
          <ResultTable summary={runResult} />
          {game.atgTrackId != null && (
            <div className="backtest-actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="secondary"
                onClick={handleTestCurrentOnTrack}
                disabled={trackTesting || running || optimizing}
              >
                {trackTesting
                  ? 'Testar mot banan…'
                  : `Testa mot alla lopp på ${game.trackName}`}
              </button>
            </div>
          )}
          {trackBaselineResult && !trackSessionResult && (
            <div style={{ marginTop: '1rem' }}>
              <h3 className="breakdown-title">Nuvarande vikter — hela {game.trackName}</h3>
              <p className="muted">
                {trackBaselineResult.hits}/{trackBaselineResult.racesWithResult} träffar
                {trackBaselineResult.hitRate != null ? ` (${trackBaselineResult.hitRate}%)` : ''}
                {' '}· {trackBaselineResult.racesWithResult} avdelningar med resultat i databasen
              </p>
            </div>
          )}
        </div>
      )}

      {optimizeResult && optimizeResult.racesWithResult > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div className="backtest-compare">
            <CompareBox
              label="Nuvarande"
              hits={optimizeResult.baseline.hits}
              total={optimizeResult.baseline.racesWithResult}
              hitRate={optimizeResult.baseline.hitRate}
            />
            <div className="backtest-compare-arrow">→</div>
            <CompareBox
              label="Optimerade"
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
              <p className="muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                Gå till <Link to={settingsLink}>Inställningar</Link> för att spara vikterna på banan.
              </p>
            </div>
          )}

          {game.atgTrackId != null && (
            <div className="backtest-actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="secondary"
                onClick={handleTestSessionWeightsOnTrack}
                disabled={trackTesting || running || optimizing}
              >
                {trackTesting
                  ? 'Testar mot banan…'
                  : `Testa omgångens vikter mot alla lopp på ${game.trackName}`}
              </button>
            </div>
          )}

          {trackBaselineResult && trackSessionResult && (
            <div style={{ marginTop: '1rem' }}>
              <h3 className="breakdown-title">Träff på hela {game.trackName}</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                {trackSessionResult.racesWithResult} avdelningar med resultat i databasen
              </p>
              <div className="backtest-compare" style={{ marginTop: '0.75rem' }}>
                <CompareBox
                  label="Nuvarande banprofil"
                  hits={trackBaselineResult.hits}
                  total={trackBaselineResult.racesWithResult}
                  hitRate={trackBaselineResult.hitRate}
                />
                <div className="backtest-compare-arrow">→</div>
                <CompareBox
                  label="Omgångens vikter"
                  hits={trackSessionResult.hits}
                  total={trackSessionResult.racesWithResult}
                  hitRate={trackSessionResult.hitRate}
                  highlight={trackSessionResult.hits > trackBaselineResult.hits}
                />
              </div>
              {trackSessionResult.hits !== trackBaselineResult.hits && (
                <p
                  className={trackSessionResult.hits > trackBaselineResult.hits ? 'hit-win' : 'hit-miss'}
                  style={{ marginTop: '0.75rem', marginBottom: 0 }}
                >
                  {trackSessionResult.hits > trackBaselineResult.hits ? '+' : ''}
                  {trackSessionResult.hits - trackBaselineResult.hits} träffar jämfört med nuvarande
                  banprofil på alla importerade lopp.
                </p>
              )}
            </div>
          )}

          <h3 className="breakdown-title" style={{ marginTop: '1rem' }}>
            Nuvarande vikter (denna omgång)
          </h3>
          <ResultTable summary={optimizeResult.baseline} />

          <h3 className="breakdown-title" style={{ marginTop: '1rem' }}>
            Optimerade vikter (denna omgång)
          </h3>
          <ResultTable summary={optimizeResult.optimized} />
        </div>
      )}
    </div>
  );
}
