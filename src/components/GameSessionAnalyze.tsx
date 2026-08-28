import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  optimizeGameSessionBacktest,
  runBacktest,
  runGameSessionBacktest,
  saveTrackProfile,
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
import { TrackHitSummary } from './TrackHitSummary';

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<BacktestSummary | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<BacktestOptimizeResult | null>(null);
  const [trackHitResult, setTrackHitResult] = useState<BacktestSummary | null>(null);

  if (game.legsWithResults === 0) return null;

  const sessionLabel = `${game.gameType} ${game.date}`;
  const newWeights = optimizeResult?.optimized.weights ?? null;

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

  async function runTrackHitTest(weights: Parameter[]) {
    setTrackTesting(true);
    setTrackHitResult(null);
    setSaveMessage(null);
    try {
      const result = await testWeightsOnTrack(weights);
      setTrackHitResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte beräkna träffprocent');
    } finally {
      setTrackTesting(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setError(null);
    setTrackHitResult(null);
    setSaveMessage(null);
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
    setTrackHitResult(null);
    setSaveMessage(null);
    try {
      const result = await optimizeGameSessionBacktest(game.id, { goal, maxTrials });
      setOptimizeResult(result);
      setRunResult(null);
      if (game.atgTrackId != null) {
        await runTrackHitTest(result.optimized.weights);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimering misslyckades');
    } finally {
      setOptimizing(false);
    }
  }

  async function handleSaveTrackWeights() {
    if (game.atgTrackId == null || !newWeights) return;
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      await saveTrackProfile(game.atgTrackId, game.trackName, newWeights);
      setSaveMessage(`Sparat — ${game.trackName} använder nu de nya vikterna.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte spara vikter');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Analysera omgång</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {sessionLabel} · {game.trackName} · {game.legsWithResults} avdelningar med resultat
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
          Få avdelningar med resultat — optimering kan ge overanpassade vikter.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {trackTesting && (
        <p className="muted" style={{ marginTop: '1rem' }}>
          Beräknar träffprocent på all historik på {game.trackName}…
        </p>
      )}

      {trackHitResult && newWeights && game.atgTrackId != null && (
        <TrackHitSummary
          trackName={game.trackName}
          goal={goal}
          result={trackHitResult}
          onSave={handleSaveTrackWeights}
          saving={saving}
          saveMessage={saveMessage}
        />
      )}

      {runResult && runResult.racesWithResult > 0 && (
        <div className="backtest-result" style={{ marginTop: '1rem' }}>
          <p className="muted">
            Nuvarande vikter på denna omgång: {runResult.hits}/{runResult.racesWithResult} träffar
            {runResult.hitRate != null ? ` (${runResult.hitRate}%)` : ''}
          </p>
          <details style={{ marginTop: '0.75rem' }}>
            <summary className="muted">Visa detalj per avdelning</summary>
            <ResultTable summary={runResult} />
          </details>
        </div>
      )}

      {optimizeResult && optimizeResult.racesWithResult > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p className="muted">Träff på denna omgång med optimerade vikter:</p>
          <div className="backtest-compare">
            <CompareBox
              label="Nuvarande"
              hits={optimizeResult.baseline.hits}
              total={optimizeResult.baseline.racesWithResult}
              hitRate={optimizeResult.baseline.hitRate}
            />
            <div className="backtest-compare-arrow">→</div>
            <CompareBox
              label="Nya vikter"
              hits={optimizeResult.optimized.hits}
              total={optimizeResult.optimized.racesWithResult}
              hitRate={optimizeResult.optimized.hitRate}
              highlight
            />
          </div>

          {optimizeResult.improved && (
            <details style={{ marginTop: '0.75rem' }}>
              <summary className="muted">Visa ändrade vikter</summary>
              <ul className="backtest-weight-list" style={{ marginTop: '0.5rem' }}>
                {optimizeResult.optimized.weights.map((p) => {
                  const prev = optimizeResult.baseline.weights.find((b) => b.id === p.id);
                  const changed = prev && prev.weight !== p.weight;
                  if (!changed) return null;
                  return (
                    <li key={p.id} className="backtest-weight-changed">
                      <span>{p.name}</span>
                      <span>
                        {formatWeightValue(prev?.weight ?? 0)} →{' '}
                        <strong>{formatWeightValue(p.weight)}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <details style={{ marginTop: '0.75rem' }}>
            <summary className="muted">Visa detalj per avdelning</summary>
            <p className="muted">Nuvarande vikter</p>
            <ResultTable summary={optimizeResult.baseline} />
            <p className="muted" style={{ marginTop: '1rem' }}>
              Nya vikter
            </p>
            <ResultTable summary={optimizeResult.optimized} />
          </details>
        </div>
      )}
    </div>
  );
}
