import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchParameters,
  fetchResultsFromAtg,
  fetchSession,
  recalculateSession,
  restoreTipWeights,
  saveEntryManualScore,
  submitTip,
} from '../api';
import {
  calculateScoreBreakdown,
  countQualifyingFormStarts,
  formConfidenceForStartCount,
  formatStartMethodLabel,
  FORM_LOOKBACK_MONTHS,
  isFormStartQualifying,
} from '../../shared/scoring';
import {
  formatKmTimeLabel,
  formatActualPosition,
  formatPostPositionLabel,
  formatTrackRaceLabel,
  formatWeightShare,
  formatWeightSummary,
  formatWeightValue,
} from '../../shared/format';
import type { Parameter, RaceEntry, RaceSession } from '../../shared/types';
import { VARMNING_PARAMETER_ID, VARMNING_SCORES } from '../../shared/types';

function formatKr(n: number | null) {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('sv-SE')} kr`;
}

function formatResult(position: number | null | undefined) {
  return formatActualPosition(position);
}

function formatDateTime(iso: string) {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function formatPct(n: number | null) {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function varmningLabel(score: number | undefined): string {
  if (score === VARMNING_SCORES.winner) return 'Värmningsvinnare';
  if (score === VARMNING_SCORES.goodReport) return 'Bra rapport';
  return '—';
}

export default function RacePage() {
  const { id } = useParams();
  const [session, setSession] = useState<RaceSession | null>(null);
  const [globalParameters, setGlobalParameters] = useState<Parameter[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [tipSaving, setTipSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tipError, setTipError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingVarmning, setSavingVarmning] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetchSession(parseInt(id, 10)),
      fetchParameters(),
    ])
      .then(([s, params]) => {
        setSession(s);
        setGlobalParameters(params);
        setResultUrl(s.sourceUrl ?? '');
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!session) return <p className="muted">Laddar lopp…</p>;

  const scoringParameters = session.scoringParameters;
  const varmningParam =
    scoringParameters.find((p) => p.id === VARMNING_PARAMETER_ID) ??
    scoringParameters.find((p) => !p.autoKey && p.name === 'Värmning');
  const sorted = [...session.entries].sort(
    (a, b) => (b.trotScore ?? 0) - (a.trotScore ?? 0),
  );

  const startMethodLabel = formatStartMethodLabel(session.startMethod);

  const hasResults = session.entries.some(
    (e) => e.actualPosition != null && e.actualPosition > 0,
  );

  const topEntry = sorted[0];
  const topHit =
    hasResults && topEntry?.actualPosition != null && topEntry.actualPosition === 1;
  const topTop3 =
    hasResults &&
    topEntry?.actualPosition != null &&
    topEntry.actualPosition <= 3;

  async function handleFetchResults() {
    if (!session) return;
    setFetching(true);
    setFetchError(null);
    setMessage(null);
    try {
      const updated = await fetchResultsFromAtg(
        session.id,
        resultUrl.trim() || undefined,
      );
      setSession(updated);
      setMessage('Resultat hämtade från ATG.');
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Kunde inte hämta resultat');
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmitTip() {
    if (!session) return;
    setTipSaving(true);
    setTipError(null);
    setMessage(null);
    try {
      const updated = await submitTip(session.id);
      setSession(updated);
      setMessage('Tips sparat med aktuella parametervikter.');
    } catch (e) {
      setTipError(e instanceof Error ? e.message : 'Kunde inte spara tips');
    } finally {
      setTipSaving(false);
    }
  }

  async function handleRecalculate() {
    if (!session) return;
    setRecalculating(true);
    setTipError(null);
    setMessage(null);
    try {
      const updated = await recalculateSession(session.id);
      setSession(updated);
      setMessage('Omräknat med nuvarande globala vikter.');
    } catch (e) {
      setTipError(e instanceof Error ? e.message : 'Kunde inte räkna om');
    } finally {
      setRecalculating(false);
    }
  }

  async function handleRestoreTip() {
    if (!session) return;
    setRecalculating(true);
    setTipError(null);
    setMessage(null);
    try {
      const updated = await restoreTipWeights(session.id);
      setSession(updated);
      setMessage('Återställt till sparade tips-vikter.');
    } catch (e) {
      setTipError(e instanceof Error ? e.message : 'Kunde inte återställa tips-vikter');
    } finally {
      setRecalculating(false);
    }
  }

  async function handleVarmningChange(entryId: number, score: number) {
    if (!session || !varmningParam) return;
    setSavingVarmning(entryId);
    setTipError(null);
    try {
      const updated = await saveEntryManualScore(
        session.id,
        entryId,
        varmningParam.id,
        score,
      );
      setSession(updated);
    } catch (e) {
      setTipError(e instanceof Error ? e.message : 'Kunde inte spara värmning');
    } finally {
      setSavingVarmning(null);
    }
  }

  return (
    <>
      <div className="card">
        <h2>
          <span className="badge">{session.gameType} avd {session.legNumber}</span>{' '}
          {session.trackName}
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {formatTrackRaceLabel(session.trackRaceNumber) && `${formatTrackRaceLabel(session.trackRaceNumber)} · `}
          {session.date}
          {session.distance ? ` · ${session.distance} m` : ''}
          {startMethodLabel ? ` · ${startMethodLabel}` : ''}
          {session.status ? ` · ${session.status}` : ''}
        </p>
        {scoringParameters.length > 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {session.usesTipParameters ? 'Tips-vikter' : 'Aktiva vikter'}:{' '}
            {formatWeightSummary(scoringParameters)}
            {' · '}
            <Link to="/installningar">Globala vikter</Link>
          </p>
        )}
        {session.gameSessionId && (
          <p className="muted" style={{ marginBottom: 0, marginTop: '0.5rem' }}>
            <Link to={`/omgang/${session.gameSessionId}`}>← Tillbaka till omgången</Link>
          </p>
        )}
      </div>

      <div className="card">
        <h2>Tips & parametrar</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          När du lämnat in tips sparas de vikter som gäller just nu. Du kan sedan
          ändra globala vikter och räkna om loppet utan att tappa tips-snapshotet.
          Tips kan också låsas för hela omgången på omgångssidan.
        </p>

        {session.tipSubmittedAt ? (
          <div className="tip-snapshot">
            <p className="tip-snapshot-label">
              Tips sparat {formatDateTime(session.tipSubmittedAt)}
            </p>
            {session.tipParameters && (
              <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                Sparade vikter: {formatWeightSummary(session.tipParameters)}
              </p>
            )}
            {!session.usesTipParameters && (
              <p className="muted" style={{ margin: '0.5rem 0 0' }}>
                Visar omräknat med globala vikter:{' '}
                {formatWeightSummary(globalParameters)}
              </p>
            )}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            Aktuella globala vikter: {formatWeightSummary(globalParameters)}
          </p>
        )}

        <div className="import-row" style={{ marginTop: '0.75rem' }}>
          <button
            onClick={handleSubmitTip}
            disabled={tipSaving || recalculating}
          >
            {tipSaving
              ? 'Sparar…'
              : session.tipSubmittedAt
                ? 'Uppdatera tips-vikter'
                : 'Jag har lämnat in tips'}
          </button>
          {session.tipSubmittedAt && !session.usesTipParameters && (
            <button
              type="button"
              className="secondary"
              onClick={handleRestoreTip}
              disabled={tipSaving || recalculating}
            >
              {recalculating ? 'Återställer…' : 'Återställ tips-vikter'}
            </button>
          )}
          {session.tipSubmittedAt && (
            <button
              type="button"
              className="secondary"
              onClick={handleRecalculate}
              disabled={tipSaving || recalculating}
            >
              {recalculating ? 'Räknar om…' : 'Räkna om med globala vikter'}
            </button>
          )}
        </div>
        {tipError && <p className="error">{tipError}</p>}
      </div>

      <div className="card">
        <h2>Resultat från ATG</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Hämtar placeringar från samma ATG-länk som vid import. Loppet måste vara avslutat.
        </p>
        <div className="import-row">
          <input
            type="url"
            placeholder="ATG-länk till avdelningen"
            value={resultUrl}
            onChange={(e) => setResultUrl(e.target.value)}
            disabled={fetching}
          />
          <button onClick={handleFetchResults} disabled={fetching}>
            {fetching ? 'Hämtar…' : 'Hämta resultat'}
          </button>
        </div>
        {message && <p className="muted" style={{ marginTop: '0.75rem' }}>{message}</p>}
        {fetchError && <p className="error">{fetchError}</p>}
        {!hasResults && !fetchError && (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            Inga resultat sparade ännu.
          </p>
        )}
        {hasResults && topEntry && (
          <p
            className={topHit ? 'hit-win' : topTop3 ? 'hit-top3' : 'hit-miss'}
            style={{ marginTop: '0.75rem', marginBottom: 0 }}
          >
            {topHit
              ? `Träff — ${topEntry.horseName} hade högst Trot Score och vann (plats ${topEntry.actualPosition}).`
              : topTop3
                ? `Nära — ${topEntry.horseName} hade högst Trot Score och kom ${topEntry.actualPosition}:a.`
                : `Miss — ${topEntry.horseName} hade högst Trot Score men kom ${formatResult(topEntry.actualPosition)}.`}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Trot Score — sorterat</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Klicka på en häst för poäng per parameter och formrader.
          {' '}
          <strong>Kusk %</strong> = kusken vinstprocent i spelformen ·{' '}
          <strong>Spel %</strong> = andel spelad i denna avdelning ·{' '}
          <strong>Spår %</strong> = spårets vinstprocent på banan
          {startMethodLabel ? ` (${startMethodLabel.toLowerCase()})` : ''} — styr parametern <strong>Spår</strong>
          {varmningParam && (
            <>
              {' '}
              <strong>Värmning</strong> markeras manuellt per häst — sätt vikt under{' '}
              <Link to="/installningar">Inställningar</Link>.
            </>
          )}
        </p>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Häst</th>
              <th>Spår</th>
              <th>Startpoäng</th>
              <th>Kr/start</th>
              <th>Kusk</th>
              <th>Kusk %</th>
              <th>Spel %</th>
              <th>Spår %</th>
              {varmningParam && <th>Värmning</th>}
              <th>Score</th>
              <th>Plats</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, idx) => (
              <Fragment key={entry.id}>
                <tr className={idx === 0 ? 'rank-1' : ''}>
                  <td>{entry.startNumber}</td>
                  <td>{entry.horseName}</td>
                  <td>{formatPostPositionLabel(entry.postPosition, session.startMethod, entry.volteRow)}</td>
                  <td>{entry.startPoints ?? '—'}</td>
                  <td>{formatKr(entry.earningsPerStart)}</td>
                  <td>{entry.driverName ?? '—'}</td>
                  <td>{formatPct(entry.driverV85WinPct)}</td>
                  <td>{formatPct(entry.betDistributionPct)}</td>
                  <td>{formatPct(entry.trackPostWinPct)}</td>
                  {varmningParam && (
                    <td>
                      <select
                        className="varmning-select"
                        value={entry.scores?.[varmningParam.id] ?? 0}
                        disabled={savingVarmning === entry.id}
                        onChange={(e) =>
                          handleVarmningChange(entry.id, parseInt(e.target.value, 10))
                        }
                        title={varmningLabel(entry.scores?.[varmningParam.id])}
                      >
                        <option value={0}>—</option>
                        <option value={VARMNING_SCORES.goodReport}>Bra rapport</option>
                        <option value={VARMNING_SCORES.winner}>Värmningsvinnare</option>
                      </select>
                    </td>
                  )}
                  <td className="score-cell">{entry.trotScore?.toFixed(1) ?? '—'}</td>
                  <td>{formatResult(entry.actualPosition)}</td>
                  <td>
                    <button
                      type="button"
                      className="expand-btn"
                      onClick={() =>
                        setExpanded(expanded === entry.id ? null : entry.id)
                      }
                    >
                      {expanded === entry.id ? '▲' : '▼'} Detaljer
                    </button>
                  </td>
                </tr>
                {expanded === entry.id && (
                  <tr>
                    <td colSpan={varmningParam ? 13 : 12}>
                      <ScoreBreakdown entry={entry} parameters={scoringParameters} />
                      <FormRows entry={entry} raceDate={session.date} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

function ScoreBreakdown({
  entry,
  parameters,
}: {
  entry: RaceEntry;
  parameters: Parameter[];
}) {
  if (!parameters.length || !entry.scores) {
    return null;
  }

  const breakdown = calculateScoreBreakdown(entry.scores, parameters);
  if (breakdown.items.length === 0) return null;

  return (
    <div className="score-breakdown">
      <h3 className="breakdown-title">Trot Score — uppdelning</h3>
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Poäng (0–10)</th>
            <th>Relativ vikt</th>
            <th>Andel</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.items.map((item) => (
            <tr key={item.parameterId}>
              <td>{item.name}</td>
              <td>{item.rawScore.toFixed(1)}</td>
              <td>
                {formatWeightValue(item.weight)}
                <span className="muted" style={{ marginLeft: '0.35rem' }}>
                  ({formatWeightShare(item.weight, breakdown.totalWeight)})
                </span>
              </td>
              <td>{((item.contribution / breakdown.totalWeight) * 100).toFixed(1)}%</td>
            </tr>
          ))}
          <tr className="breakdown-total">
            <td colSpan={3}>
              <strong>Trot Score</strong>
            </td>
            <td>
              <strong>{breakdown.totalScore.toFixed(1)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}

function FormRows({ entry, raceDate }: { entry: RaceEntry; raceDate: string }) {
  if (!entry.formStarts?.length) {
    return <span className="muted">Ingen formdata</span>;
  }

  const qualifyingCount = countQualifyingFormStarts(entry.formStarts, raceDate);
  const confidence = formConfidenceForStartCount(qualifyingCount);

  return (
    <div className="form-section">
      <h3 className="breakdown-title">Senaste starter</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Markering = räknas in i form (senaste {FORM_LOOKBACK_MONTHS} mån).
        {qualifyingCount === 0
          ? ' Inga starter i fönstret → neutral formpoäng 5,0.'
          : qualifyingCount < 3
            ? ` ${qualifyingCount} start${qualifyingCount === 1 ? '' : 'er'} i fönstret → form till ${Math.round(confidence * 100)} % (resten neutral 5).`
            : ` ${qualifyingCount} starter i fönstret → full form.`}
      </p>
      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Bana</th>
            <th>Dist</th>
            <th>Spår</th>
            <th>Tid</th>
            <th>Plats</th>
            <th>Kusk</th>
            <th>1:a pris</th>
          </tr>
        </thead>
        <tbody>
          {entry.formStarts.map((f) => {
            const countsForForm = isFormStartQualifying(f, raceDate);
            return (
            <tr key={f.formOrder} className={countsForForm ? 'form-row-active' : 'form-row-outside'}>
              <td>
                {f.date ?? '—'}
                {countsForForm && (
                  <span className="badge badge-form" title="Räknas in i form">Form</span>
                )}
              </td>
              <td>{f.trackName ?? '—'}</td>
              <td>{f.distance ?? '—'}</td>
              <td>{f.postPosition ?? '—'}</td>
              <td>{formatKmTimeLabel(f.kmTime) ?? '—'}</td>
              <td>{f.place && f.place !== '0' ? f.place : f.place === '0' ? '0' : '—'}</td>
              <td>{f.driverName ?? '—'}</td>
              <td>{f.prizeFirst != null ? formatKr(f.prizeFirst) : '—'}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
