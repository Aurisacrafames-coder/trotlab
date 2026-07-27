import { useEffect, useState } from 'react';

import { Link, useParams } from 'react-router-dom';

import {

  fetchGameResults,

  fetchGameSession,

  recalculateGame,

  refreshGameRaceInfo,

  restoreGameTip,

  submitGameTip,

} from '../api';

import type { GameSession, GameSessionLeg } from '../../shared/types';

import {

  formatDistance,

  formatGameLegLabel,

  formatScheduledStart,

  formatTrackRaceLabel,

  formatWeightSummary,

} from '../../shared/format';

import { formatStartMethodLabel } from '../../shared/scoring';

import { MIN_SPIKE_MARGIN, MIN_SPIKE_TOP_SCORE } from '../../shared/spikeSuggestions';



function formatDateTime(iso: string) {

  const d = new Date(iso.replace(' ', 'T'));

  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });

}



function hitLabel(hit: GameSessionLeg['hit']) {

  switch (hit) {

    case 'win':

      return 'Träff';

    case 'top3':

      return 'Topp 3';

    case 'miss':

      return 'Miss';

    case 'pending':

      return 'Väntar';

    default:

      return '—';

  }

}



function hitClass(hit: GameSessionLeg['hit']) {

  switch (hit) {

    case 'win':

      return 'hit-win';

    case 'top3':

      return 'hit-top3';

    case 'miss':

      return 'hit-miss';

    default:

      return 'muted';

  }

}



function LegRaceInfo({ leg }: { leg: GameSessionLeg }) {

  const info = leg.raceInfo;

  if (!info) {

    return (

      <p className="muted leg-race-empty">

        Loppinfo saknas — hämta från ATG eller importera om avdelningen.

      </p>

    );

  }



  const metaParts = [

    formatDistance(info.distance),

    formatStartMethodLabel(info.startMethod),

    formatScheduledStart(info.scheduledStartTime),

  ].filter(Boolean);



  return (

    <div className="leg-race-info">

      {info.name && <p className="leg-race-name">{info.name}</p>}

      {metaParts.length > 0 && (

        <p className="muted leg-race-meta">{metaParts.join(' · ')}</p>

      )}

      {info.prize && <p className="muted leg-race-prize">{info.prize}</p>}

      {info.terms.length > 0 && (

        <ul className="leg-race-terms">

          {info.terms.map((term) => (

            <li key={term}>{term}</li>

          ))}

        </ul>

      )}

    </div>

  );

}



function LegSystemHint({ leg }: { leg: GameSessionLeg }) {
  const sys = leg.systemSuggestion;
  if (!sys) return null;

  const picks =
    leg.rankedHorses.length > 0
      ? leg.rankedHorses.slice(0, sys.recommendedPickCount)
      : sys.picks;

  return (
    <div className="leg-system-hint">
      <div className="leg-system-header">
        <span className={`badge ${sys.strategy === 'spik' ? 'badge-spike' : 'badge-gardering'}`}>
          {sys.strategy === 'spik' ? 'Spik' : `Gardera ${picks.length}`}
        </span>
        {sys.strategy !== 'spik' && (
          <span className="muted">Fält-osäkerhet {sys.uncertaintyScore.toFixed(1)}</span>
        )}
      </div>

      <div className="leg-system-picks">
        {picks.map((p) => (
          <span key={p.startNumber} className="leg-system-pick">
            #{p.startNumber} {p.horseName}{' '}
            <span className="score-cell">{p.trotScore.toFixed(1)}</span>
          </span>
        ))}
      </div>

      {sys.reasons.length > 0 && (

        <p className="muted leg-system-reasons">{sys.reasons.join(' · ')}</p>

      )}

    </div>

  );

}



export default function GamePage() {

  const { id } = useParams();

  const [game, setGame] = useState<GameSession | null>(null);

  const [loading, setLoading] = useState(true);

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);



  useEffect(() => {

    if (!id) return;

    fetchGameSession(parseInt(id, 10))

      .then(setGame)

      .catch((e) => setError(e.message))

      .finally(() => setLoading(false));

  }, [id]);



  const missingRaceInfo = game?.legs.some((leg) => !leg.raceInfo?.name) ?? false;



  async function runAction(

    action: () => Promise<GameSession>,

    successMsg: string,

  ) {

    setBusy(true);

    setError(null);

    setMessage(null);

    try {

      const updated = await action();

      setGame(updated);

      setMessage(successMsg);

    } catch (e) {

      setError(e instanceof Error ? e.message : 'Något gick fel');

    } finally {

      setBusy(false);

    }

  }



  async function handleFetchResults() {

    if (!game) return;

    setBusy(true);

    setError(null);

    setMessage(null);

    try {

      const { game: updated, errors } = await fetchGameResults(game.id);

      setGame(updated);

      if (errors.length > 0) {

        setError(errors.join(' · '));

        setMessage('Delvis hämtat — vissa avdelningar saknar resultat än.');

      } else {

        setMessage('Alla resultat hämtade från ATG.');

      }

    } catch (e) {

      setError(e instanceof Error ? e.message : 'Kunde inte hämta resultat');

    } finally {

      setBusy(false);

    }

  }



  async function handleRefreshRaceInfo() {

    if (!game) return;

    setBusy(true);

    setError(null);

    setMessage(null);

    try {

      const { game: updated, updated: count } = await refreshGameRaceInfo(game.id);

      setGame(updated);

      setMessage(count > 0 ? `Loppinfo hämtad för ${count} avdelningar.` : 'All loppinfo fanns redan.');

    } catch (e) {

      setError(e instanceof Error ? e.message : 'Kunde inte hämta loppinfo');

    } finally {

      setBusy(false);

    }

  }



  if (loading) return <p className="muted">Laddar omgång…</p>;

  if (error && !game) return <p className="error">{error}</p>;

  if (!game) return <p className="muted">Omgång hittades inte.</p>;



  const spikeLegIds = new Set(game.suggestedSpikes.map((s) => s.legId));



  return (

    <>

      <div className="card">

        <h2>

          <span className="badge">{game.gameType}</span> {game.trackName}

        </h2>

        <p className="muted" style={{ marginTop: 0 }}>

          {game.date} · {game.legCount} avdelning{game.legCount === 1 ? '' : 'ar'} importerade

        </p>

        {game.legsWithResults > 0 && (

          <p className="muted" style={{ marginBottom: 0 }}>

            Träff: {game.hitsWin}/{game.legsWithResults} vinst

            {game.hitsTop3 > game.hitsWin

              ? ` · ${game.hitsTop3 - game.hitsWin} till i topp 3`

              : ''}

          </p>

        )}

        {game.systemPlan && game.legCount > 0 && (

          <div className="import-row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>

            <Link to={`/omgang/${game.id}/system`} className="button-link">

              {game.userSystem ? 'Redigera spelsystem' : 'Bygg spelsystem'}

            </Link>

            {game.userSystem && (

              <span className="muted" style={{ fontSize: '0.88rem' }}>

                System sparat

              </span>

            )}

          </div>

        )}

      </div>



      {game.legs.length > 0 && (

        <div className="card">

          <h2>Föreslagna spikar</h2>

          <p className="muted" style={{ marginTop: 0 }}>

            De två avdelningar där ettan har tydligast övertag: marginal ≥ {MIN_SPIKE_MARGIN} poäng

            till tvåan och Trot Score ≥ {MIN_SPIKE_TOP_SCORE}.

            Spik-poäng = marginal + 0,25 × score.

          </p>

          {game.suggestedSpikes.length === 0 ? (

            <p className="muted" style={{ marginBottom: 0 }}>

              Ingen avdelning uppfyller spik-kriterierna just nu — överväg gardering på fler lopp.

            </p>

          ) : (

            <div className="spike-suggestions">

              {game.suggestedSpikes.map((spike) => (

                <div key={spike.legId} className="spike-suggestion-card">

                  <div className="spike-suggestion-rank">Spik {spike.rank}</div>

                  <div className="spike-suggestion-main">

                    <Link to={`/lopp/${spike.legId}`}>

                      {formatGameLegLabel(game.gameType, spike.legNumber, spike.trackRaceNumber)}

                    </Link>

                    <div className="spike-suggestion-horse">

                      #{spike.startNumber} {spike.horseName}

                    </div>

                  </div>

                  <div className="spike-suggestion-stats">

                    <div>

                      <span className="muted">Score</span> {spike.topScore.toFixed(1)}

                    </div>

                    <div>

                      <span className="muted">Marginal</span> +{spike.marginToSecond.toFixed(1)}

                    </div>

                    <div>

                      <span className="muted">Spik-poäng</span> {spike.spikeScore.toFixed(1)}

                    </div>

                  </div>

                  {spike.secondHorseName && (

                    <p className="muted spike-suggestion-second" style={{ margin: 0 }}>

                      Tvåa: #{spike.secondStartNumber} {spike.secondHorseName} ({spike.secondScore.toFixed(1)})

                    </p>

                  )}

                </div>

              ))}

            </div>

          )}

        </div>

      )}



      <div className="card">

        <h2>Tips & omgång</h2>

        <p className="muted" style={{ marginTop: 0 }}>

          Lås hela omgången när du lämnat in tips — alla avdelningar sparar samma parametervikter.

        </p>



        {game.tipSubmittedAt ? (

          <div className="tip-snapshot">

            <p className="tip-snapshot-label">

              Omgång låst {formatDateTime(game.tipSubmittedAt)}

            </p>

            {game.tipParameters && (

              <p className="muted" style={{ margin: '0.25rem 0 0' }}>

                Sparade vikter: {formatWeightSummary(game.tipParameters)}

              </p>

            )}

          </div>

        ) : (

          <p className="muted">Omgången är inte låst ännu.</p>

        )}



        <div className="import-row" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>

          <button onClick={() => runAction(() => submitGameTip(game.id), 'Omgång låst.')} disabled={busy}>

            {busy ? 'Sparar…' : game.tipSubmittedAt ? 'Uppdatera omgångstips' : 'Lås omgång — tips inlämnat'}

          </button>

          <button type="button" className="secondary" onClick={handleFetchResults} disabled={busy}>

            {busy ? 'Hämtar…' : 'Hämta alla resultat'}

          </button>

          {missingRaceInfo && (

            <button type="button" className="secondary" onClick={handleRefreshRaceInfo} disabled={busy}>

              {busy ? 'Hämtar…' : 'Hämta loppinfo'}

            </button>

          )}

          {game.tipSubmittedAt && (

            <>

              <button

                type="button"

                className="secondary"

                onClick={() =>

                  runAction(() => recalculateGame(game.id), 'Omgång omräknad med globala vikter.')

                }

                disabled={busy}

              >

                Räkna om alla

              </button>

              {!game.usesTipParameters && (

                <button

                  type="button"

                  className="secondary"

                  onClick={() =>

                    runAction(() => restoreGameTip(game.id), 'Tips-vikter återställda.')

                  }

                  disabled={busy}

                >

                  Återställ tips-vikter

                </button>

              )}

            </>

          )}

        </div>

        {message && <p className="muted" style={{ marginTop: '0.75rem' }}>{message}</p>}

        {error && <p className="error">{error}</p>}

      </div>



      <div className="card">

        <div className="leg-section-header">

          <h2>Avdelningar</h2>

          {missingRaceInfo && (

            <button type="button" className="secondary" onClick={handleRefreshRaceInfo} disabled={busy}>

              Hämta loppinfo från ATG

            </button>

          )}

        </div>

        <p className="muted" style={{ marginTop: 0 }}>

          Importera fler avdelningar via{' '}

          <Link to="/import">Importera</Link> — de grupperas automatiskt hit om samma spelform, datum och bana.

        </p>

        {game.legs.length === 0 ? (

          <p className="muted">Inga avdelningar ännu.</p>

        ) : (

          <div className="game-legs">

            {game.legs.map((leg) => {

              const spikeRank = game.suggestedSpikes.find((s) => s.legId === leg.id)?.rank;

              return (

                <article

                  key={leg.id}

                  className={[

                    'game-leg-card',

                    spikeLegIds.has(leg.id) ? 'spike-leg-row' : '',

                    leg.hit === 'win' ? 'leg-hit-win' : '',

                  ]

                    .filter(Boolean)

                    .join(' ')}

                >

                  <div className="game-leg-card-header">

                    <div>

                      <strong>Avd {leg.legNumber}</strong>

                      {formatTrackRaceLabel(leg.trackRaceNumber) && (

                        <span className="muted"> · {formatTrackRaceLabel(leg.trackRaceNumber)}</span>

                      )}

                      {spikeRank != null && (

                        <span className="badge badge-spike" title="Föreslagen spik">

                          Spik {spikeRank}

                        </span>

                      )}

                    </div>

                    <div className="game-leg-card-actions">

                      <span className={hitClass(leg.hit)}>{hitLabel(leg.hit)}</span>

                      <Link to={`/lopp/${leg.id}`}>Öppna lopp</Link>

                    </div>

                  </div>



                  <LegRaceInfo leg={leg} />

                  <LegSystemHint leg={leg} />



                  <div className="game-leg-score-row">

                    <span>

                      Topp: {leg.topStartNumber != null && `#${leg.topStartNumber} `}

                      {leg.topHorseName ?? '—'}

                    </span>

                    <span className="score-cell">{leg.topScore?.toFixed(1) ?? '—'}</span>

                    <span className={leg.meetsSpikeCriteria ? 'spike-margin-ok' : 'muted'}>

                      {leg.marginToSecond != null ? `+${leg.marginToSecond.toFixed(1)}` : '—'}

                    </span>

                    <span>

                      Plats:{' '}

                      {leg.topPosition === 0

                        ? 'Ute'

                        : leg.topPosition && leg.topPosition > 0

                          ? leg.topPosition

                          : '—'}

                    </span>

                  </div>

                </article>

              );

            })}

          </div>

        )}

      </div>

    </>

  );

}


