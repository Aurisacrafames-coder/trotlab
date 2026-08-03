import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchSession, fetchSessions, type SessionListItem } from '../api';
import {
  calculateScoreBreakdown,
  countQualifyingFormStarts,
  formConfidenceForStartCount,
  formatStartMethodLabel,
  FORM_LOOKBACK_MONTHS,
  isFormStartQualifying,
} from '../../shared/scoring';
import {
  formatActualPosition,
  formatKmTimeLabel,
  formatPostPositionLabel,
  formatTrackRaceLabel,
  formatWeightValue,
} from '../../shared/format';
import type { Parameter, RaceEntry, RaceSession } from '../../shared/types';
import { VARMNING_PARAMETER_ID, VARMNING_SCORES } from '../../shared/types';

function formatKr(n: number | null) {
  if (n == null) return '—';
  return `${Math.round(n).toLocaleString('sv-SE')} kr`;
}

function formatPct(n: number | null) {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function formatDriverTrackPct(entry: RaceEntry): string {
  return formatPct(entry.driverTrackWinPct);
}

function formatDriverGlobalPct(entry: RaceEntry): string {
  if (entry.driverV85WinPctOverride != null) {
    return `${entry.driverV85WinPctOverride.toFixed(1)}% (man)`;
  }
  return formatPct(entry.driverGlobalWinPct);
}

function effectiveTrainerPct(entry: RaceEntry): number | null {
  return entry.trainerWinPctOverride ?? entry.trainerWinPct;
}

function varmningLabel(score: number | undefined): string {
  if (score === VARMNING_SCORES.winner) return 'Värmningsvinnare';
  if (score === VARMNING_SCORES.goodReport) return 'Bra rapport';
  return '—';
}

function diffClass(
  a: number | null | undefined,
  b: number | null | undefined,
  higherIsBetter = true,
): string {
  if (a == null || b == null || a === b) return '';
  const aWins = higherIsBetter ? a > b : a < b;
  return aWins ? 'compare-better' : 'compare-worse';
}

function formatDiff(
  a: number | null | undefined,
  b: number | null | undefined,
  decimals = 1,
  suffix = '',
): string {
  if (a == null || b == null) return '—';
  const d = a - b;
  if (Math.abs(d) < 0.05) return '±0';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(decimals)}${suffix}`;
}

function sessionLabel(s: SessionListItem): string {
  const race = formatTrackRaceLabel(s.trackRaceNumber);
  const racePart = race ? ` · ${race}` : '';
  return `${s.date} · ${s.trackName}${racePart} · ${s.gameType} avd ${s.legNumber}`;
}

function horseOptionLabel(entry: RaceEntry): string {
  return `#${entry.startNumber} ${entry.horseName}${entry.trotScore != null ? ` (${entry.trotScore.toFixed(1)})` : ''}`;
}

interface StatRow {
  label: string;
  a: string;
  b: string;
  diff: string;
  aClass?: string;
  bClass?: string;
}

function buildStatRows(
  session: RaceSession,
  horseA: RaceEntry,
  horseB: RaceEntry,
  varmningParam: Parameter | undefined,
): StatRow[] {
  const startMethodLabel = formatStartMethodLabel(session.startMethod);
  const rows: StatRow[] = [
    {
      label: 'Startnummer',
      a: String(horseA.startNumber),
      b: String(horseB.startNumber),
      diff: '—',
    },
    {
      label: 'Spår',
      a: formatPostPositionLabel(horseA.postPosition, session.startMethod, horseA.volteRow),
      b: formatPostPositionLabel(horseB.postPosition, session.startMethod, horseB.volteRow),
      diff: '—',
    },
    {
      label: 'Startpoäng',
      a: horseA.startPoints != null ? String(horseA.startPoints) : '—',
      b: horseB.startPoints != null ? String(horseB.startPoints) : '—',
      diff: formatDiff(horseA.startPoints, horseB.startPoints, 0),
      aClass: diffClass(horseA.startPoints, horseB.startPoints),
      bClass: diffClass(horseB.startPoints, horseA.startPoints),
    },
    {
      label: 'Kr/start',
      a: formatKr(horseA.earningsPerStart),
      b: formatKr(horseB.earningsPerStart),
      diff: formatDiff(horseA.earningsPerStart, horseB.earningsPerStart, 0, ' kr'),
      aClass: diffClass(horseA.earningsPerStart, horseB.earningsPerStart),
      bClass: diffClass(horseB.earningsPerStart, horseA.earningsPerStart),
    },
    {
      label: 'Kusk',
      a: horseA.driverName ?? '—',
      b: horseB.driverName ?? '—',
      diff: '—',
    },
    {
      label: 'Kusk % bana',
      a: formatDriverTrackPct(horseA),
      b: formatDriverTrackPct(horseB),
      diff: formatDiff(horseA.driverTrackWinPct, horseB.driverTrackWinPct, 1, '%'),
      aClass: diffClass(horseA.driverTrackWinPct, horseB.driverTrackWinPct),
      bClass: diffClass(horseB.driverTrackWinPct, horseA.driverTrackWinPct),
    },
    {
      label: 'Kusk % tot',
      a: formatDriverGlobalPct(horseA),
      b: formatDriverGlobalPct(horseB),
      diff: formatDiff(
        horseA.driverV85WinPctOverride ?? horseA.driverGlobalWinPct,
        horseB.driverV85WinPctOverride ?? horseB.driverGlobalWinPct,
        1,
        '%',
      ),
      aClass: diffClass(
        horseA.driverV85WinPctOverride ?? horseA.driverGlobalWinPct,
        horseB.driverV85WinPctOverride ?? horseB.driverGlobalWinPct,
      ),
      bClass: diffClass(
        horseB.driverV85WinPctOverride ?? horseB.driverGlobalWinPct,
        horseA.driverV85WinPctOverride ?? horseA.driverGlobalWinPct,
      ),
    },
    {
      label: 'Tränare',
      a: horseA.trainerName ?? '—',
      b: horseB.trainerName ?? '—',
      diff: '—',
    },
    {
      label: 'Tränare %',
      a: formatPct(effectiveTrainerPct(horseA)),
      b: formatPct(effectiveTrainerPct(horseB)),
      diff: formatDiff(effectiveTrainerPct(horseA), effectiveTrainerPct(horseB), 1, '%'),
      aClass: diffClass(effectiveTrainerPct(horseA), effectiveTrainerPct(horseB)),
      bClass: diffClass(effectiveTrainerPct(horseB), effectiveTrainerPct(horseA)),
    },
    {
      label: 'Spel %',
      a: formatPct(horseA.betDistributionPct),
      b: formatPct(horseB.betDistributionPct),
      diff: formatDiff(horseA.betDistributionPct, horseB.betDistributionPct, 1, '%'),
      aClass: diffClass(horseA.betDistributionPct, horseB.betDistributionPct),
      bClass: diffClass(horseB.betDistributionPct, horseA.betDistributionPct),
    },
    {
      label: startMethodLabel ? `Spår % (${startMethodLabel.toLowerCase()})` : 'Spår %',
      a: formatPct(horseA.trackPostWinPct),
      b: formatPct(horseB.trackPostWinPct),
      diff: formatDiff(horseA.trackPostWinPct, horseB.trackPostWinPct, 1, '%'),
      aClass: diffClass(horseA.trackPostWinPct, horseB.trackPostWinPct),
      bClass: diffClass(horseB.trackPostWinPct, horseA.trackPostWinPct),
    },
  ];

  if (varmningParam) {
    const scoreA = horseA.scores?.[varmningParam.id];
    const scoreB = horseB.scores?.[varmningParam.id];
    rows.push({
      label: 'Värmning',
      a: varmningLabel(scoreA),
      b: varmningLabel(scoreB),
      diff: '—',
    });
  }

  rows.push({
    label: 'Trot Score',
    a: horseA.trotScore != null ? horseA.trotScore.toFixed(1) : '—',
    b: horseB.trotScore != null ? horseB.trotScore.toFixed(1) : '—',
    diff: formatDiff(horseA.trotScore, horseB.trotScore, 1),
    aClass: diffClass(horseA.trotScore, horseB.trotScore),
    bClass: diffClass(horseB.trotScore, horseA.trotScore),
  });

  const hasResults =
    (horseA.actualPosition != null && horseA.actualPosition > 0) ||
    (horseB.actualPosition != null && horseB.actualPosition > 0);

  if (hasResults) {
    rows.push({
      label: 'Plats',
      a: formatActualPosition(horseA.actualPosition),
      b: formatActualPosition(horseB.actualPosition),
      diff: '—',
      aClass: diffClass(horseB.actualPosition, horseA.actualPosition, true),
      bClass: diffClass(horseA.actualPosition, horseB.actualPosition, true),
    });
  }

  return rows;
}

function ParameterCompareTable({
  horseA,
  horseB,
  parameters,
}: {
  horseA: RaceEntry;
  horseB: RaceEntry;
  parameters: Parameter[];
}) {
  const breakdownA = calculateScoreBreakdown(horseA.scores ?? {}, parameters);
  const breakdownB = calculateScoreBreakdown(horseB.scores ?? {}, parameters);
  const byIdA = new Map(breakdownA.items.map((i) => [i.parameterId, i]));
  const byIdB = new Map(breakdownB.items.map((i) => [i.parameterId, i]));

  const rows = parameters
    .map((p) => {
      const itemA = byIdA.get(p.id);
      const itemB = byIdB.get(p.id);
      if (!itemA && !itemB) return null;
      return {
        parameterId: p.id,
        name: p.name,
        scoreA: itemA?.rawScore ?? null,
        scoreB: itemB?.rawScore ?? null,
        contribA: itemA?.contribution ?? null,
        contribB: itemB?.contribution ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (rows.length === 0) return null;

  return (
    <div className="score-breakdown">
      <h3 className="breakdown-title">Parameterpoäng</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th className="compare-col-a">Häst A</th>
              <th className="compare-col-b">Häst B</th>
              <th>Diff (A−B)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.parameterId}>
                <td>{row.name}</td>
                <td className={diffClass(row.scoreA, row.scoreB)}>
                  {row.scoreA != null ? row.scoreA.toFixed(1) : '—'}
                </td>
                <td className={diffClass(row.scoreB, row.scoreA)}>
                  {row.scoreB != null ? row.scoreB.toFixed(1) : '—'}
                </td>
                <td className="compare-diff-cell">{formatDiff(row.scoreA, row.scoreB)}</td>
              </tr>
            ))}
            <tr className="breakdown-total">
              <td>
                <strong>Trot Score</strong>
              </td>
              <td className={diffClass(breakdownA.totalScore, breakdownB.totalScore)}>
                <strong>{breakdownA.totalScore.toFixed(1)}</strong>
              </td>
              <td className={diffClass(breakdownB.totalScore, breakdownA.totalScore)}>
                <strong>{breakdownB.totalScore.toFixed(1)}</strong>
              </td>
              <td className="compare-diff-cell">
                <strong>{formatDiff(breakdownA.totalScore, breakdownB.totalScore)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
        Vikter: {parameters.map((p) => `${p.name} ${formatWeightValue(p.weight)}`).join(' · ')}
      </p>
    </div>
  );
}

function FormComparePanel({
  entry,
  label,
  raceDate,
}: {
  entry: RaceEntry;
  label: string;
  raceDate: string;
}) {
  if (!entry.formStarts?.length) {
    return (
      <div className="compare-form-panel">
        <h3 className="breakdown-title">{label}</h3>
        <p className="muted">Ingen formdata</p>
      </div>
    );
  }

  const qualifyingCount = countQualifyingFormStarts(entry.formStarts, raceDate);
  const confidence = formConfidenceForStartCount(qualifyingCount);

  return (
    <div className="compare-form-panel">
      <h3 className="breakdown-title">{label}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {qualifyingCount === 0
          ? 'Inga starter i fönstret → neutral form 5,0.'
          : qualifyingCount < 3
            ? `${qualifyingCount} start${qualifyingCount === 1 ? '' : 'er'} i fönstret → form till ${Math.round(confidence * 100)} %.`
            : `${qualifyingCount} starter i fönstret → full form.`}
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
            </tr>
          </thead>
          <tbody>
            {entry.formStarts.map((f) => {
              const countsForForm = isFormStartQualifying(f, raceDate);
              return (
                <tr
                  key={f.formOrder}
                  className={countsForForm ? 'form-row-active' : 'form-row-outside'}
                >
                  <td>
                    {f.date ?? '—'}
                    {countsForForm && (
                      <span className="badge badge-form" title="Räknas in i form">
                        Form
                      </span>
                    )}
                  </td>
                  <td>{f.trackName ?? '—'}</td>
                  <td>{f.distance ?? '—'}</td>
                  <td>{f.postPosition ?? '—'}</td>
                  <td>
                    {formatKmTimeLabel(f.kmTime) ?? '—'}
                    {f.isRecordTime && (
                      <span className="badge badge-form" title="Rekordtid">
                        R
                      </span>
                    )}
                  </td>
                  <td>{f.place && f.place !== '0' ? f.place : f.place === '0' ? '0' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [session, setSession] = useState<RaceSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);

  const sessionIdParam = searchParams.get('session');
  const startAParam = searchParams.get('a');
  const startBParam = searchParams.get('b');

  const sessionId = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
  const startA = startAParam ? parseInt(startAParam, 10) : null;
  const startB = startBParam ? parseInt(startBParam, 10) : null;

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    if (sessionId == null || Number.isNaN(sessionId)) {
      setSession(null);
      return;
    }
    setLoadingSession(true);
    setLoadError(null);
    fetchSession(sessionId)
      .then(setSession)
      .catch((e) => {
        setSession(null);
        setLoadError(e.message);
      })
      .finally(() => setLoadingSession(false));
  }, [sessionId]);

  const sortedEntries = useMemo(
    () => (session ? [...session.entries].sort((a, b) => a.startNumber - b.startNumber) : []),
    [session],
  );

  const horseA = useMemo(
    () => sortedEntries.find((e) => e.startNumber === startA) ?? null,
    [sortedEntries, startA],
  );
  const horseB = useMemo(
    () => sortedEntries.find((e) => e.startNumber === startB) ?? null,
    [sortedEntries, startB],
  );

  const varmningParam = useMemo(() => {
    if (!session) return undefined;
    return (
      session.scoringParameters.find((p) => p.id === VARMNING_PARAMETER_ID) ??
      session.scoringParameters.find((p) => !p.autoKey && p.name === 'Värmning')
    );
  }, [session]);

  function updateParams(next: { session?: number | null; a?: number | null; b?: number | null }) {
    const params = new URLSearchParams(searchParams);
    if (next.session !== undefined) {
      if (next.session == null) params.delete('session');
      else params.set('session', String(next.session));
    }
    if (next.a !== undefined) {
      if (next.a == null) params.delete('a');
      else params.set('a', String(next.a));
    }
    if (next.b !== undefined) {
      if (next.b == null) params.delete('b');
      else params.set('b', String(next.b));
    }
    setSearchParams(params, { replace: true });
  }

  const statRows =
    session && horseA && horseB
      ? buildStatRows(session, horseA, horseB, varmningParam)
      : [];

  const startMethodLabel = session ? formatStartMethodLabel(session.startMethod) : null;

  return (
    <>
      <div className="card">
        <h2>Jämför hästar</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Välj ett importerat lopp och två hästar för att se poäng, parametrar och form sida vid
          sida. Du kan också markera två hästar på loppsidan och klicka &quot;Jämför valda&quot;.
        </p>

        <div className="compare-picker">
          <label>
            Lopp
            <select
              value={sessionId ?? ''}
              onChange={(e) => {
                const id = e.target.value ? parseInt(e.target.value, 10) : null;
                updateParams({ session: id, a: null, b: null });
              }}
            >
              <option value="">Välj lopp…</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {sessionLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Häst A
            <select
              value={startA ?? ''}
              disabled={!session || loadingSession}
              onChange={(e) => {
                const n = e.target.value ? parseInt(e.target.value, 10) : null;
                updateParams({ a: n });
              }}
            >
              <option value="">Välj häst…</option>
              {sortedEntries.map((e) => (
                <option key={e.id} value={e.startNumber} disabled={e.startNumber === startB}>
                  {horseOptionLabel(e)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Häst B
            <select
              value={startB ?? ''}
              disabled={!session || loadingSession}
              onChange={(e) => {
                const n = e.target.value ? parseInt(e.target.value, 10) : null;
                updateParams({ b: n });
              }}
            >
              <option value="">Välj häst…</option>
              {sortedEntries.map((e) => (
                <option key={e.id} value={e.startNumber} disabled={e.startNumber === startA}>
                  {horseOptionLabel(e)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadError && <p className="error">{loadError}</p>}
        {loadingSession && <p className="muted">Laddar lopp…</p>}
        {session && !loadingSession && (
          <p className="muted" style={{ marginBottom: 0 }}>
            <Link to={`/lopp/${session.id}`}>Öppna loppet</Link>
            {session.gameSessionId && (
              <>
                {' '}
                · <Link to={`/omgang/${session.gameSessionId}`}>Till omgången</Link>
              </>
            )}
          </p>
        )}
      </div>

      {session && horseA && horseB && (
        <>
          <div className="card">
            <p className="muted" style={{ marginTop: 0 }}>
              <span className="badge">{session.gameType} avd {session.legNumber}</span>{' '}
              {session.trackName}
              {formatTrackRaceLabel(session.trackRaceNumber) &&
                ` · ${formatTrackRaceLabel(session.trackRaceNumber)}`}
              {' · '}
              {session.date}
              {session.distance ? ` · ${session.distance} m` : ''}
              {startMethodLabel ? ` · ${startMethodLabel}` : ''}
            </p>

            <div className="backtest-compare horse-compare-hero">
              <div className="backtest-compare-box backtest-compare-box-highlight">
                <div className="muted">Häst A · #{horseA.startNumber}</div>
                <div className="horse-compare-name">{horseA.horseName}</div>
                <div className="backtest-compare-value">
                  {horseA.trotScore?.toFixed(1) ?? '—'}
                </div>
                <div className="muted">Trot Score</div>
              </div>
              <div className="backtest-compare-arrow">↔</div>
              <div className="backtest-compare-box backtest-compare-box-highlight">
                <div className="muted">Häst B · #{horseB.startNumber}</div>
                <div className="horse-compare-name">{horseB.horseName}</div>
                <div className="backtest-compare-value">
                  {horseB.trotScore?.toFixed(1) ?? '—'}
                </div>
                <div className="muted">Trot Score</div>
              </div>
            </div>

            <div className="table-scroll">
              <table className="compare-stats-table">
                <thead>
                  <tr>
                    <th></th>
                    <th className="compare-col-a">Häst A</th>
                    <th className="compare-col-b">Häst B</th>
                    <th>Diff (A−B)</th>
                  </tr>
                </thead>
                <tbody>
                  {statRows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className={row.aClass}>{row.a}</td>
                      <td className={row.bClass}>{row.b}</td>
                      <td className="compare-diff-cell">{row.diff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <ParameterCompareTable
              horseA={horseA}
              horseB={horseB}
              parameters={session.scoringParameters}
            />
          </div>

          <div className="card">
            <h2>Senaste starter</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Markering = räknas in i form (senaste {FORM_LOOKBACK_MONTHS} mån).
            </p>
            <div className="compare-form-grid">
              <FormComparePanel entry={horseA} label={`${horseA.horseName} (A)`} raceDate={session.date} />
              <FormComparePanel entry={horseB} label={`${horseB.horseName} (B)`} raceDate={session.date} />
            </div>
          </div>
        </>
      )}

      {session && (!horseA || !horseB) && !loadingSession && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Välj två olika hästar ovan för att se jämförelsen.
          </p>
        </div>
      )}
    </>
  );
}
