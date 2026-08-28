import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchGameSession,
  fetchResultsFromAtg,
  fetchSession,
  recalculateSession,
  restoreTipWeights,
  saveEntryManualScore,
  saveEntryDriverWinPct,
  saveEntryTrainerWinPct,
  submitTip,
  addToWatchlist,
  removeFromWatchlist,
} from '../api';
import {
  calculateScoreBreakdown,
  countQualifyingFormStarts,
  DRIVER_GLOBAL_WIN_WEIGHT,
  DRIVER_TRACK_WIN_WEIGHT,
  formConfidenceForStartCount,
  formatStartMethodLabel,
  FORM_LOOKBACK_MONTHS,
  isFormStartQualifying,
} from '../../shared/scoring';
import {
  formatKmTimeLabel,
  formatActualPosition,
  actualPositionTitle,
  formatPostPositionLabel,
  formatTrackRaceLabel,
  formatWeightShare,
  formatWeightSummary,
  formatWeightValue,
} from '../../shared/format';
import type { GameSessionLeg, Parameter, RaceEntry, RaceSession } from '../../shared/types';
import { VARMNING_PARAMETER_ID, VARMNING_SCORES } from '../../shared/types';
import LegPrepComment, { legPrepInputFromSession } from '../components/LegPrepComment';
import LegSpikeHint from '../components/LegSpikeHint';
import { classifyRaceProfile } from '../../shared/raceProfile';

function formatKr(n: number | null) {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('sv-SE')} kr`;
}

function formatKrCompact(n: number | null) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function formatStartPointsCompact(n: number | null) {
  if (n == null) return '—';
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
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

function formatPctShort(n: number | null) {
  if (n == null) return '—';
  return n.toFixed(1);
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

function scoringProfileLabel(session: RaceSession): string {
  if (session.scoringProfileSource === 'tip') return 'Tips-vikter';
  if (session.scoringProfileSource === 'track') return `${session.trackName}-profil`;
  return 'Global standard';
}

function settingsLinkForSession(session: RaceSession): string {
  if (session.atgTrackId != null) {
    return `/installningar?bana=${session.atgTrackId}`;
  }
  return '/installningar';
}

export default function RacePage() {
  const { id } = useParams();
  const [session, setSession] = useState<RaceSession | null>(null);
  const [siblingLegs, setSiblingLegs] = useState<GameSessionLeg[] | null>(null);
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
  const [savingDriverPct, setSavingDriverPct] = useState<number | null>(null);
  const [savingTrainerPct, setSavingTrainerPct] = useState<number | null>(null);
  const [watchSaving, setWatchSaving] = useState<number | null>(null);
  const [compareSelection, setCompareSelection] = useState<number[]>([]);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetchSession(parseInt(id, 10)),
    ])
      .then(([s]) => {
        setSession(s);
        setResultUrl(s.sourceUrl ?? '');
        setCompareSelection([]);
      })
      .catch((e) => setLoadError(e.message));
  }, [id]);

  useEffect(() => {
    if (!session?.gameSessionId) {
      setSiblingLegs(null);
      return;
    }
    fetchGameSession(session.gameSessionId)
      .then((game) => setSiblingLegs(game.legs))
      .catch(() => setSiblingLegs(null));
  }, [session?.gameSessionId, session?.id]);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!session) return <p className="muted">Laddar lopp…</p>;

  const scoringParameters = session.scoringParameters;
  const varmningParam =
    scoringParameters.find((p) => p.id === VARMNING_PARAMETER_ID) ??
    scoringParameters.find((p) => !p.autoKey && p.name === 'Värmning');
  const sorted = [...session.entries].sort((a, b) => {
    if (a.scratched && !b.scratched) return 1;
    if (!a.scratched && b.scratched) return -1;
    return (b.trotScore ?? 0) - (a.trotScore ?? 0);
  });

  const startMethodLabel = formatStartMethodLabel(session.startMethod);

  const hasResults = session.entries.some((e) => e.actualPosition != null);
  const watchedInRace = session.entries.filter((e) => e.isWatched).length;
  const scratchedInRace = session.entries.filter((e) => e.scratched).length;

  const topEntry = sorted[0];
  const topHit =
    hasResults && topEntry?.actualPosition != null && topEntry.actualPosition === 1;
  const topTop3 =
    hasResults &&
    topEntry?.actualPosition != null &&
    topEntry.actualPosition <= 3;

  const legIndex = siblingLegs?.findIndex((leg) => leg.id === session.id) ?? -1;
  const currentLeg = legIndex >= 0 ? siblingLegs![legIndex] : null;
  const prevLeg = legIndex > 0 ? siblingLegs![legIndex - 1] : null;
  const nextLeg =
    siblingLegs && legIndex >= 0 && legIndex < siblingLegs.length - 1
      ? siblingLegs[legIndex + 1]
      : null;

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

  async function handleRecalculate(useGlobal = false) {
    if (!session) return;
    setRecalculating(true);
    setTipError(null);
    setMessage(null);
    try {
      const updated = await recalculateSession(session.id, useGlobal);
      setSession(updated);
      setMessage(
        useGlobal
          ? 'Omräknat med global standard.'
          : `Omräknat med ${scoringProfileLabel(updated).toLowerCase()}.`,
      );
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

  async function handleDriverPctBlur(entry: RaceEntry, raw: string) {
    if (!session) return;

    const trimmed = raw.trim().replace(',', '.');
    let winPct: number | null = null;

    if (trimmed !== '') {
      const n = parseFloat(trimmed);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        setTipError('Kusk % måste vara 0–100');
        return;
      }
      winPct = Math.round(n * 10) / 10;
    }

    const currentOverride = entry.driverV85WinPctOverride;
    if (winPct == null && currentOverride == null) return;
    if (winPct != null && currentOverride != null && winPct === currentOverride) return;

    setSavingDriverPct(entry.id);
    setTipError(null);
    try {
      const updated = await saveEntryDriverWinPct(session.id, entry.id, winPct);
      setSession(updated);
    } catch (e) {
      setTipError(e instanceof Error ? e.message : 'Kunde inte spara kusk %');
    } finally {
      setSavingDriverPct(null);
    }
  }

  async function handleTrainerPctBlur(entry: RaceEntry, raw: string) {
    if (!session) return;

    const trimmed = raw.trim().replace(',', '.');
    let winPct: number | null = null;

    if (trimmed !== '') {
      const n = parseFloat(trimmed);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        setTipError('Tränare % måste vara 0–100');
        return;
      }
      winPct = Math.round(n * 10) / 10;
    }

    const currentOverride = entry.trainerWinPctOverride;
    if (winPct == null && currentOverride == null) return;
    if (winPct != null && currentOverride != null && winPct === currentOverride) return;

    setSavingTrainerPct(entry.id);
    setTipError(null);
    try {
      const updated = await saveEntryTrainerWinPct(session.id, entry.id, winPct);
      setSession(updated);
    } catch (e) {
      setTipError(e instanceof Error ? e.message : 'Kunde inte spara tränare %');
    } finally {
      setSavingTrainerPct(null);
    }
  }

  function toggleCompare(startNumber: number) {
    setCompareSelection((prev) => {
      if (prev.includes(startNumber)) {
        return prev.filter((n) => n !== startNumber);
      }
      if (prev.length >= 2) {
        return [prev[1], startNumber];
      }
      return [...prev, startNumber];
    });
  }

  async function toggleWatch(entry: RaceEntry) {
    if (!session) return;
    setWatchSaving(entry.id);
    setTipError(null);
    try {
      if (entry.isWatched) {
        await removeFromWatchlist(entry.atgHorseId);
      } else {
        await addToWatchlist(entry.atgHorseId, entry.horseName, session.id);
      }
      setSession((prev) =>
        prev
          ? {
              ...prev,
              entries: prev.entries.map((e) =>
                e.atgHorseId === entry.atgHorseId
                  ? { ...e, isWatched: !e.isWatched }
                  : e,
              ),
            }
          : null,
      );
    } catch (e) {
      setTipError(e instanceof Error ? e.message : 'Kunde inte uppdatera bevakning');
    } finally {
      setWatchSaving(null);
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

  const activeProfileLabel = scoringProfileLabel(session);
  const settingsHref = settingsLinkForSession(session);
  const raceProfile = classifyRaceProfile(
    session.raceName,
    session.raceTerms,
    session.distance,
    session.startMethod,
  );

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
            Aktiva vikter ({activeProfileLabel}):{' '}
            {formatWeightSummary(scoringParameters)}
            {' · '}
            <Link to={settingsHref}>
              {session.atgTrackId != null ? `${session.trackName}-inställningar` : 'Inställningar'}
            </Link>
          </p>
        )}
        {session.gameSessionId && (
          <p className="muted" style={{ marginBottom: 0, marginTop: '0.5rem' }}>
            <Link to={`/omgang/${session.gameSessionId}`}>← Tillbaka till omgången</Link>
          </p>
        )}
      </div>

      {session.atgTrackId != null && (
        <div className="card">
          <h2>Gardering inför lopp</h2>
          {session.raceName && <p className="leg-race-name" style={{ marginTop: 0 }}>{session.raceName}</p>}
          <p className="muted" style={{ marginTop: session.raceName ? '0.35rem' : 0 }}>
            {raceProfile.summary}
          </p>
          {session.raceTerms.length > 0 && (
            <ul className="leg-race-terms">
              {session.raceTerms.map((term) => (
                <li key={term}>{term}</li>
              ))}
            </ul>
          )}
          <LegPrepComment
            atgTrackId={session.atgTrackId}
            gameType={session.gameType}
            leg={legPrepInputFromSession({ ...session, entries: session.entries }, currentLeg)}
            label=""
          />
          <LegSpikeHint
            atgTrackId={session.atgTrackId}
            gameType={session.gameType}
            leg={legPrepInputFromSession({ ...session, entries: session.entries }, currentLeg)}
          />
        </div>
      )}

      <div className="card">
        <h2>Trot Score — sorterat</h2>
        <details className="race-table-legend">
          <summary className="muted">Förklaring kolumner</summary>
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Klicka på en häst för poäng per parameter och formrader.
            Markera två hästar under <strong>Jämför</strong> för att jämföra dem sida vid sida.
            {' '}
            <strong>K%</strong> = kusk vinst%: <strong>B</strong> bana · <strong>T</strong> tot (12 mån).
            Poäng = {Math.round(DRIVER_TRACK_WIN_WEIGHT * 100)}&nbsp;% bana + {Math.round(DRIVER_GLOBAL_WIN_WEIGHT * 100)}&nbsp;% totalt.
            {' '}
            <strong>Tr%</strong> = tränare vinst% (2 mån, alla banor) ·{' '}
            <strong>Spel</strong> = spelad andel ·{' '}
            <strong>Spår</strong> = spårvinst% på banan
            {startMethodLabel === 'Voltstart'
              ? ' (frams-/bakspår räknas separat)'
              : startMethodLabel
                ? ` (${startMethodLabel.toLowerCase()})`
                : ''}
            {varmningParam && (
              <>
                {' '}
                · <strong>Värm</strong> = värmning (manuell)
              </>
            )}
          </p>
        </details>
        {scratchedInRace > 0 && (
          <p className="race-watch-summary muted">
            {scratchedInRace} struken{scratchedInRace === 1 ? '' : 'a'} — score 0 och genomstryket namn.
          </p>
        )}
        {watchedInRace > 0 && (
          <p className="race-watch-summary muted">
            {watchedInRace} bevakad{watchedInRace === 1 ? '' : 'e'} häst
            {watchedInRace === 1 ? '' : 'ar'} i detta lopp (gäller 1 månad).
          </p>
        )}
        {compareSelection.length > 0 && (
          <div className="compare-selection-bar">
            <span className="muted">
              Valda för jämförelse:{' '}
              {compareSelection.map((n) => `#${n}`).join(' och ')}
            </span>
            {compareSelection.length === 2 ? (
              <Link
                to={`/jämför?session=${session.id}&a=${Math.min(...compareSelection)}&b=${Math.max(...compareSelection)}`}
                className="compare-selection-link"
              >
                Jämför valda →
              </Link>
            ) : (
              <span className="muted">Välj en till häst</span>
            )}
            <button
              type="button"
              className="secondary compare-selection-clear"
              onClick={() => setCompareSelection([])}
            >
              Rensa
            </button>
          </div>
        )}
        {siblingLegs && siblingLegs.length > 1 && (
          <nav className="leg-nav leg-nav-table" aria-label="Bläddra avdelningar">
            {prevLeg ? (
              <Link to={`/lopp/${prevLeg.id}`} className="leg-nav-btn">
                ← Avd {prevLeg.legNumber}
              </Link>
            ) : (
              <span className="leg-nav-btn leg-nav-btn-disabled">← Föregående</span>
            )}
            <span className="leg-nav-current">
              Avd {session.legNumber} av {siblingLegs.length}
            </span>
            {nextLeg ? (
              <Link to={`/lopp/${nextLeg.id}`} className="leg-nav-btn leg-nav-btn-primary">
                Avd {nextLeg.legNumber} →
              </Link>
            ) : (
              <span className="leg-nav-btn leg-nav-btn-disabled">Nästa →</span>
            )}
          </nav>
        )}
        <div className="table-scroll">
        <table className="race-entry-table">
          <thead>
            <tr>
              <th className="col-compare" title="Jämför">⇔</th>
              <th className="col-num">#</th>
              <th className="col-horse">Häst</th>
              <th className="col-num" title="Spår">Sp</th>
              <th className="col-num" title="Startpoäng">St.p</th>
              <th className="col-num" title="Kr per start">Kr/st</th>
              <th className="col-person" title="Kusk">Kusk</th>
              <th className="col-kusk" title="Kusk vinst% bana (B) och totalt (T), 12 mån">
                K%
              </th>
              <th className="col-person" title="Tränare">Tr</th>
              <th className="col-pct" title="Tränare vinst%">Tr%</th>
              <th className="col-pct" title="Spelad andel">Spel</th>
              <th className="col-pct" title="Spårvinst%">Spår</th>
              {varmningParam && <th className="col-varm" title="Värmning">Värm</th>}
              <th className="col-score">Scr</th>
              <th className="col-num" title="Placering">Pl</th>
              <th className="col-expand"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, idx) => (
              <Fragment key={entry.id}>
                <tr
                  className={[
                    idx === 0 && !entry.scratched ? 'rank-1' : '',
                    entry.isWatched ? 'row-watched' : '',
                    entry.scratched ? 'row-scratched' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td className="col-compare">
                    <input
                      type="checkbox"
                      className="compare-checkbox"
                      checked={compareSelection.includes(entry.startNumber)}
                      onChange={() => toggleCompare(entry.startNumber)}
                      title="Välj för jämförelse"
                      aria-label={`Jämför ${entry.horseName}`}
                    />
                  </td>
                  <td className="col-num">{entry.startNumber}</td>
                  <td className="col-horse" title={entry.scratched ? `${entry.horseName} (struken)` : entry.horseName}>
                    <span className="horse-name-cell">
                      {!entry.scratched && (hasResults || entry.isWatched) && (
                        <button
                          type="button"
                          className={`watch-btn${entry.isWatched ? ' watch-btn-active' : ''}`}
                          onClick={() => toggleWatch(entry)}
                          disabled={watchSaving === entry.id}
                          title={
                            entry.isWatched
                              ? 'Ta bort bevakning (gäller 1 månad från markering)'
                              : 'Bevaka till nästa start (gäller 1 månad)'
                          }
                          aria-label={
                            entry.isWatched
                              ? `Ta bort bevakning av ${entry.horseName}`
                              : `Bevaka ${entry.horseName}`
                          }
                        >
                          {entry.isWatched ? '★' : '☆'}
                        </button>
                      )}
                      <span className={`horse-name-text${entry.scratched ? ' horse-name-scratched' : ''}`}>
                        {entry.horseName}
                      </span>
                    </span>
                  </td>
                  <td className="col-num">{formatPostPositionLabel(entry.postPosition, session.startMethod, entry.volteRow)}</td>
                  <td className="col-num" title={entry.startPoints != null ? String(entry.startPoints) : undefined}>
                    {formatStartPointsCompact(entry.startPoints)}
                  </td>
                  <td className="col-num" title={entry.earningsPerStart != null ? formatKr(entry.earningsPerStart) : undefined}>
                    {formatKrCompact(entry.earningsPerStart)}
                  </td>
                  <td className="col-person" title={entry.driverName ?? undefined}>
                    {entry.atgDriverId != null && entry.driverName ? (
                      <Link
                        to={`/statistik/kusk-tranare?type=driver&id=${entry.atgDriverId}&trackId=${session.atgTrackId ?? ''}&sessionId=${session.id}&entryId=${entry.id}`}
                        title="Verifiera kuskstatistik"
                      >
                        {entry.driverName}
                      </Link>
                    ) : (
                      entry.driverName ?? '—'
                    )}
                  </td>
                  <td
                    className="col-kusk race-kusk-pct-cell"
                    title={`Bana: ${formatPct(entry.driverTrackWinPct)} · Tot: ${formatPct(entry.driverGlobalWinPct)}`}
                  >
                    <div className="race-kusk-stack">
                      <span className="race-kusk-line">
                        <span className="race-kusk-tag">B</span>
                        {formatPctShort(entry.driverTrackWinPct)}
                      </span>
                      <span className="race-kusk-line">
                        <span className="race-kusk-tag">T</span>
                        {formatPctShort(entry.driverGlobalWinPct)}
                      </span>
                    </div>
                    <input
                      type="number"
                      className={`driver-pct-input driver-pct-override${entry.driverV85WinPctOverride != null ? ' driver-pct-manual' : ''}`}
                      step="0.1"
                      min="0"
                      max="100"
                      inputMode="decimal"
                      placeholder="man"
                      defaultValue={entry.driverV85WinPctOverride ?? ''}
                      key={`driver-override-${entry.id}-${entry.driverV85WinPctOverride ?? 'a'}`}
                      disabled={savingDriverPct === entry.id}
                      onBlur={(e) => handleDriverPctBlur(entry, e.target.value)}
                      title={
                        entry.driverV85WinPctOverride != null
                          ? 'Manuell override — töm för auto'
                          : 'Valfri manuell kusk % (ersätter auto poäng)'
                      }
                    />
                  </td>
                  <td className="col-person" title={entry.trainerName ?? undefined}>
                    {entry.atgTrainerId != null && entry.trainerName ? (
                      <Link
                        to={`/statistik/kusk-tranare?type=trainer&id=${entry.atgTrainerId}&sessionId=${session.id}&entryId=${entry.id}`}
                        title="Verifiera tränarstatistik"
                      >
                        {entry.trainerName}
                      </Link>
                    ) : (
                      entry.trainerName ?? '—'
                    )}
                  </td>
                  <td className="col-pct">
                    <input
                      type="number"
                      className={`driver-pct-input${entry.trainerWinPctOverride != null ? ' driver-pct-manual' : ''}`}
                      step="0.1"
                      min="0"
                      max="100"
                      inputMode="decimal"
                      placeholder="—"
                      defaultValue={
                        entry.trainerWinPctOverride ??
                        entry.trainerWinPct ??
                        ''
                      }
                      key={`trainer-pct-${entry.id}-${entry.trainerWinPctOverride ?? 'a'}-${entry.trainerWinPct ?? 'n'}`}
                      disabled={savingTrainerPct === entry.id}
                      onBlur={(e) => handleTrainerPctBlur(entry, e.target.value)}
                      title={
                        entry.trainerWinPctOverride != null
                          ? 'Manuellt satt — töm fältet för auto'
                          : entry.trainerWinPct != null
                            ? 'Auto: tränare vinst% totalt alla banor (2 mån)'
                            : 'Ange tränare vinst% manuellt'
                      }
                    />
                  </td>
                  <td className="col-pct" title={formatPct(entry.betDistributionPct)}>
                    {formatPctShort(entry.betDistributionPct)}
                  </td>
                  <td className="col-pct" title={formatPct(entry.trackPostWinPct)}>
                    {formatPctShort(entry.trackPostWinPct)}
                  </td>
                  {varmningParam && (
                    <td className="col-varm">
                      <select
                        className="varmning-select varmning-select-compact"
                        value={entry.scores?.[varmningParam.id] ?? 0}
                        disabled={savingVarmning === entry.id}
                        onChange={(e) =>
                          handleVarmningChange(entry.id, parseInt(e.target.value, 10))
                        }
                        title={varmningLabel(entry.scores?.[varmningParam.id])}
                      >
                        <option value={0}>—</option>
                        <option value={VARMNING_SCORES.goodReport}>Bra</option>
                        <option value={VARMNING_SCORES.winner}>Vinn</option>
                      </select>
                    </td>
                  )}
                  <td className="score-cell col-score">
                    {entry.scratched ? '0.0' : (entry.trotScore?.toFixed(1) ?? '—')}
                  </td>
                  <td
                    className={`col-num${entry.actualPosition === 0 ? ' col-pl-galopp' : ''}`}
                    title={actualPositionTitle(entry.actualPosition)}
                  >
                    {formatResult(entry.actualPosition)}
                  </td>
                  <td className="col-expand">
                    <button
                      type="button"
                      className="expand-btn expand-btn-compact"
                      onClick={() =>
                        setExpanded(expanded === entry.id ? null : entry.id)
                      }
                      title={expanded === entry.id ? 'Stäng detaljer' : 'Visa detaljer'}
                      aria-label={expanded === entry.id ? 'Stäng detaljer' : 'Visa detaljer'}
                    >
                      {expanded === entry.id ? '▲' : '▼'}
                    </button>
                  </td>
                </tr>
                {expanded === entry.id && (
                  <tr>
                    <td colSpan={varmningParam ? 16 : 15}>
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

      <div className="card">
        <h2>Tips & parametrar</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          När du lämnat in tips sparas de vikter som gäller just nu (banprofil eller global).
          Du kan sedan räkna om med banprofil eller global standard utan att tappa tips-snapshotet.
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
                Visar omräknat med {activeProfileLabel.toLowerCase()}:{' '}
                {formatWeightSummary(scoringParameters)}
              </p>
            )}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            Aktiva vikter ({activeProfileLabel}): {formatWeightSummary(scoringParameters)}
            {session.scoringProfileSource === 'global' && session.atgTrackId != null && (
              <>
                {' '}
                · <Link to={settingsHref}>Skapa {session.trackName}-profil</Link>
              </>
            )}
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
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => handleRecalculate(false)}
                disabled={tipSaving || recalculating}
              >
                {recalculating
                  ? 'Räknar om…'
                  : session.atgTrackId != null
                    ? `Räkna om med ${session.trackName}-profil`
                    : 'Räkna om med aktiva vikter'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleRecalculate(true)}
                disabled={tipSaving || recalculating}
              >
                Räkna om med global standard
              </button>
            </>
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
        {hasResults && (
          <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            Klicka på ☆ vid en häst i tabellen ovan för att bevaka den i 1 månad.
            Bevakade hästar markeras med ★ när de startar igen.
          </p>
        )}
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
              <td>
                {formatKmTimeLabel(f.kmTime) ?? '—'}
                {f.isRecordTime && (
                  <span className="badge badge-form" title="Rekordtid">R</span>
                )}
              </td>
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
