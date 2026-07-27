import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { fetchGameSession, saveGameUserSystem } from '../api';
import type { GameSession, GameSessionLeg, GameSystemPlan } from '../../shared/types';
import { formatDistance, formatGameLegLabel, formatTrackRaceLabel } from '../../shared/format';
import { formatStartMethodLabel } from '../../shared/scoring';
import {
  buildPlanFromSelections,
  planToSelections,
  toggleLegHorse,
  type LegSelections,
} from '../../shared/customSystem';
import {
  buildPlanFromSessionLegs,
  optimizeSystemForRowTarget,
  type RowTargetSystemPlan,
  type SessionLegPlanInput,
} from '../../shared/systemOptimizer';

function formatDateTime(iso: string) {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

function userSystemToSelections(
  userSystem: NonNullable<GameSession['userSystem']>,
): LegSelections {
  const out: LegSelections = {};
  for (const leg of userSystem.legs) {
    out[leg.legId] = [...leg.startNumbers];
  }
  return out;
}

function getEligibleLegs(game: GameSession): GameSessionLeg[] {
  return game.legs.filter(
    (leg) =>
      leg.systemSuggestion &&
      (leg.rankedHorses.length > 0 || leg.systemSuggestion.picks.length > 0),
  );
}

function toSessionLegInputs(eligibleLegs: GameSessionLeg[]): SessionLegPlanInput[] {
  return eligibleLegs.map((leg) => ({
    id: leg.id,
    legNumber: leg.legNumber,
    trackRaceNumber: leg.trackRaceNumber,
    rankedHorses: leg.rankedHorses,
    systemSuggestion: leg.systemSuggestion,
  }));
}

function formatLegMeta(leg: GameSessionLeg | undefined): string | null {
  if (!leg) return null;
  const distance = leg.raceInfo?.distance ?? leg.distance;
  const startMethod = leg.raceInfo?.startMethod ?? leg.startMethod;
  const parts = [formatDistance(distance), formatStartMethodLabel(startMethod)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function EditableSystemView({
  game,
  plan,
  selections,
  onToggleHorse,
  title,
  savedAt,
  isDirty,
  saving,
  saveError,
  onSave,
  onApplySuggestion,
}: {
  game: GameSession;
  plan: GameSystemPlan;
  selections: LegSelections;
  onToggleHorse: (legId: number, startNumber: number) => void;
  title: string;
  savedAt: string | null;
  isDirty: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: () => void;
  onApplySuggestion: () => void;
}) {
  return (
    <>
      <div className="card">
        <div className="system-editor-header">
          <div>
            <h2>{title}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {plan.spikeCount} spikar · {plan.garderingCount} garderingar ·{' '}
              <strong>{plan.totalRowsEstimate.toLocaleString('sv-SE')} rader</strong>
            </p>
          </div>
          <div className="system-editor-actions">
            <button type="button" className="secondary" onClick={onApplySuggestion}>
              Uppdatera från förslag
            </button>
            <button type="button" onClick={onSave} disabled={saving || !isDirty}>
              {saving ? 'Sparar…' : 'Spara mitt system'}
            </button>
          </div>
        </div>
        {savedAt && (
          <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
            Senast sparat {formatDateTime(savedAt)}
            {isDirty && ' · osparade ändringar'}
          </p>
        )}
        {!savedAt && isDirty && (
          <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
            Osparade ändringar
          </p>
        )}
        {saveError && <p className="error">{saveError}</p>}
      </div>

      <div className="card system-matrix-card">
        <h2>Radmatris</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Uppdateras direkt när du väljer hästar.
        </p>
        <div className="system-matrix">
          {plan.legs.map((leg) => {
            const sessionLeg = game.legs.find((l) => l.id === leg.legId);
            const meta = formatLegMeta(sessionLeg);
            return (
            <div key={leg.legId} className="system-matrix-leg">
              <div className="muted">Avd {leg.legNumber}</div>
              {meta && <div className="system-matrix-meta">{meta}</div>}
              <div className="system-matrix-picks">
                {leg.picks.length > 0 ? (
                  leg.picks.map((p) => (
                    <span key={p.startNumber} className="system-matrix-pick">
                      {p.startNumber}
                    </span>
                  ))
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            </div>
            );
          })}
        </div>
        <p className="system-row-total">
          {plan.legs.map((l) => l.recommendedPickCount).join(' × ')} ={' '}
          <strong>{plan.totalRowsEstimate.toLocaleString('sv-SE')} rader</strong>
        </p>
      </div>

      <div className="card">
        <h2>Välj hästar per avdelning</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Klicka för att lägga till eller ta bort hästar. Minst en häst krävs per avdelning.
        </p>
        <div className="system-legs">
          {plan.legs.map((leg) => {
            const sessionLeg = game.legs.find((l) => l.id === leg.legId);
            const candidates =
              sessionLeg && sessionLeg.rankedHorses.length > 0
                ? sessionLeg.rankedHorses
                : leg.picks;
            const selected = new Set(selections[leg.legId] ?? []);
            const meta = formatLegMeta(sessionLeg);

            return (
              <div key={leg.legId} className="system-leg-card">
                <div className="system-leg-header">
                  <div>
                    <strong>
                      {formatGameLegLabel(game.gameType, leg.legNumber, leg.trackRaceNumber)}
                    </strong>
                    {formatTrackRaceLabel(leg.trackRaceNumber) && (
                      <span className="muted"> · {formatTrackRaceLabel(leg.trackRaceNumber)}</span>
                    )}
                    {meta && <p className="muted system-leg-meta">{meta}</p>}
                  </div>
                  <span
                    className={`badge ${leg.strategy === 'spik' ? 'badge-spike' : 'badge-gardering'}`}
                  >
                    {leg.strategy === 'spik' ? 'Spik' : `Gardering ×${leg.recommendedPickCount}`}
                  </span>
                </div>

                <div className="system-horse-grid">
                  {candidates.map((horse) => {
                    const isSelected = selected.has(horse.startNumber);
                    return (
                      <button
                        key={horse.startNumber}
                        type="button"
                        className={`system-horse-btn${isSelected ? ' system-horse-btn-selected' : ''}`}
                        onClick={() => onToggleHorse(leg.legId, horse.startNumber)}
                        aria-pressed={isSelected}
                      >
                        <span className="system-horse-btn-num">#{horse.startNumber}</span>
                        <span className="system-horse-btn-name">{horse.horseName}</span>
                        <span className="score-cell">{horse.trotScore.toFixed(1)}</span>
                      </button>
                    );
                  })}
                </div>

                {(leg.scoreMarginTop2 != null || leg.scoreMarginTop3 != null) && (
                  <p className="muted system-meta">
                    Marginal: {leg.scoreMarginTop2 != null ? `1–2: ${leg.scoreMarginTop2}` : '—'}
                    {leg.scoreMarginTop3 != null ? ` · 2–3: ${leg.scoreMarginTop3}` : ''}
                    {leg.strategy !== 'spik' && (
                      <> · Fält-osäkerhet: {leg.uncertaintyScore.toFixed(1)}</>
                    )}
                  </p>
                )}

                <Link to={`/lopp/${leg.legId}`} className="system-leg-link">
                  Öppna lopp →
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function SystemPage() {
  const { id } = useParams();
  const [game, setGame] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minRows, setMinRows] = useState(1800);
  const [maxRows, setMaxRows] = useState(2200);
  const [showBase, setShowBase] = useState(false);
  const [selections, setSelections] = useState<LegSelections>({});
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadedFromSave, setLoadedFromSave] = useState(false);

  const gameId = id ? parseInt(id, 10) : NaN;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchGameSession(gameId)
      .then((g) => {
        setGame(g);
        if (g.userSystem) {
          setSelections(userSystemToSelections(g.userSystem));
          setLoadedFromSave(true);
          setIsDirty(false);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, gameId]);

  const eligibleLegs = useMemo(() => (game ? getEligibleLegs(game) : []), [game]);
  const sessionLegInputs = useMemo(() => toSessionLegInputs(eligibleLegs), [eligibleLegs]);
  const spikeLegIds = useMemo(
    () => new Set(game?.suggestedSpikes.map((s) => s.legId) ?? []),
    [game],
  );

  const targetPlan: RowTargetSystemPlan | null = useMemo(() => {
    if (!game?.legs.length) return null;

    const inputs = eligibleLegs.map((leg) => ({
      legId: leg.id,
      legNumber: leg.legNumber,
      trackRaceNumber: leg.trackRaceNumber,
      rankedHorses:
        leg.rankedHorses.length > 0 ? leg.rankedHorses : leg.systemSuggestion!.picks,
      baseSuggestion: leg.systemSuggestion!,
      lockedSpik: spikeLegIds.has(leg.id),
    }));

    if (inputs.length === 0) return null;
    return optimizeSystemForRowTarget(inputs, minRows, maxRows);
  }, [game, eligibleLegs, minRows, maxRows, spikeLegIds]);

  const basePlan = useMemo(() => {
    if (!game?.systemPlan || eligibleLegs.length === 0) return null;
    return buildPlanFromSessionLegs(
      sessionLegInputs,
      eligibleLegs.map((leg) => leg.systemSuggestion!.recommendedPickCount),
      spikeLegIds,
    );
  }, [game, eligibleLegs, sessionLegInputs, spikeLegIds]);

  const suggestionPlan = useMemo(() => {
    if (!game?.systemPlan || !basePlan) return null;

    if (!showBase && targetPlan) {
      return buildPlanFromSessionLegs(
        sessionLegInputs,
        targetPlan.pickCounts,
        spikeLegIds,
        { minRows: targetPlan.minRows, maxRows: targetPlan.maxRows },
      ) as RowTargetSystemPlan;
    }

    return basePlan;
  }, [game, targetPlan, showBase, basePlan, sessionLegInputs, spikeLegIds]);

  useEffect(() => {
    if (!suggestionPlan || loadedFromSave) return;
    setSelections(planToSelections(suggestionPlan));
    setIsDirty(false);
  }, [suggestionPlan, loadedFromSave]);

  useEffect(() => {
    if (loadedFromSave || isDirty || !suggestionPlan) return;
    setSelections(planToSelections(suggestionPlan));
  }, [suggestionPlan, showBase, loadedFromSave, isDirty]);

  const myPlan = useMemo(
    () => buildPlanFromSelections(sessionLegInputs, selections, spikeLegIds),
    [sessionLegInputs, selections, spikeLegIds],
  );

  const rowTargetPlan =
    !showBase && suggestionPlan && 'inTargetRange' in suggestionPlan
      ? (suggestionPlan as RowTargetSystemPlan)
      : null;

  function handleToggleHorse(legId: number, startNumber: number) {
    setSelections((prev) => {
      const next = toggleLegHorse(prev, legId, startNumber);
      if (next === prev) return prev;
      setIsDirty(true);
      setSaveError(null);
      return next;
    });
  }

  function handleApplySuggestion() {
    if (!suggestionPlan) return;
    setSelections(planToSelections(suggestionPlan));
    setIsDirty(true);
    setLoadedFromSave(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!game) return;
    setSaving(true);
    setSaveError(null);
    try {
      const legs = eligibleLegs.map((leg) => ({
        legId: leg.id,
        startNumbers: selections[leg.id] ?? [],
      }));
      const updated = await saveGameUserSystem(game.id, legs);
      setGame(updated);
      setSelections(userSystemToSelections(updated.userSystem!));
      setIsDirty(false);
      setLoadedFromSave(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Kunde inte spara systemet');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Laddar spelsystem…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!game?.systemPlan || !suggestionPlan) return <p className="muted">Ingen omgång hittades.</p>;

  return (
    <>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          <Link to={`/omgang/${game.id}`}>← Tillbaka till omgång</Link>
        </p>
        <h2>
          Spelsystem — {game.gameType} {game.trackName}
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {game.date} · {game.legCount} avdelningar
        </p>
      </div>

      <div className="card">
        <h2>Radmål & förslag</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Justera radmål för att få ett startförslag — klicka sedan &quot;Uppdatera från förslag&quot;
          eller välj hästar manuellt nedan.
        </p>
        <div className="backtest-filters">
          <label className="backtest-field">
            <span className="muted">Min rader</span>
            <input
              type="number"
              min={1}
              step={100}
              value={minRows}
              onChange={(e) => setMinRows(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </label>
          <label className="backtest-field">
            <span className="muted">Max rader</span>
            <input
              type="number"
              min={1}
              step={100}
              value={maxRows}
              onChange={(e) =>
                setMaxRows(Math.max(minRows, parseInt(e.target.value, 10) || minRows))
              }
            />
          </label>
        </div>

        {rowTargetPlan && rowTargetPlan.pickCounts.length > 0 && (
          <div
            className={`system-target-result${rowTargetPlan.inTargetRange ? '' : ' system-target-warn'}`}
          >
            <p style={{ margin: '0.75rem 0 0' }}>
              {rowTargetPlan.inTargetRange ? (
                <>
                  Förslagsradmål:{' '}
                  <strong>{rowTargetPlan.totalRowsEstimate.toLocaleString('sv-SE')} rader</strong>{' '}
                  (mål {rowTargetPlan.minRows.toLocaleString('sv-SE')}–
                  {rowTargetPlan.maxRows.toLocaleString('sv-SE')})
                </>
              ) : (
                <>
                  Närmaste förslag:{' '}
                  <strong>{rowTargetPlan.totalRowsEstimate.toLocaleString('sv-SE')} rader</strong> —{' '}
                  {rowTargetPlan.message}
                </>
              )}
            </p>
            <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.88rem' }}>
              Förslag: {rowTargetPlan.pickCounts.join(' × ')} hästar per avdelning
              {game.suggestedSpikes.length > 0 && (
                <> · Spikar låsta: avd {game.suggestedSpikes.map((s) => s.legNumber).join(', avd ')}</>
              )}
            </p>
          </div>
        )}

        <div className="import-row" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className={showBase ? 'secondary' : undefined}
            onClick={() => setShowBase(false)}
          >
            Radmål-förslag
          </button>
          <button
            type="button"
            className={showBase ? undefined : 'secondary'}
            onClick={() => setShowBase(true)}
          >
            Grundsystem ({basePlan?.totalRowsEstimate.toLocaleString('sv-SE') ?? '—'} rader)
          </button>
        </div>
      </div>

      <EditableSystemView
        game={game}
        plan={myPlan}
        selections={selections}
        onToggleHorse={handleToggleHorse}
        title="Mitt system"
        savedAt={game.userSystem?.updatedAt ?? null}
        isDirty={isDirty}
        saving={saving}
        saveError={saveError}
        onSave={handleSave}
        onApplySuggestion={() => handleApplySuggestion()}
      />
    </>
  );
}
