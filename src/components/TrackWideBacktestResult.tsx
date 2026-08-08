import type { BacktestGoal, BacktestSummary } from '../../shared/types';

export function goalLabel(goal: BacktestGoal): string {
  return goal === 'win' ? 'vinstträff' : 'topp 3-träff';
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

export function TrackWideResultPanel({
  trackName,
  goal,
  baseline,
  session,
  sessionWeightsLabel = 'Omgångens vikter',
}: {
  trackName: string;
  goal: BacktestGoal;
  baseline: BacktestSummary | null;
  session: BacktestSummary;
  sessionWeightsLabel?: string;
}) {
  const goalText = goalLabel(goal);
  const improved = baseline != null && session.hits > baseline.hits;
  const sameHits = baseline != null && session.hits === baseline.hits;

  return (
    <div className={`track-wide-result-banner${improved ? ' track-wide-result-improved' : ''}`}>
      <p className="track-wide-result-kicker">Hela banan — historik</p>
      <strong className="track-wide-result-title">
        {sessionWeightsLabel}: {session.hits}/{session.racesWithResult} {goalText}
        {session.hitRate != null ? ` (${session.hitRate}%)` : ''}
      </strong>
      <p className="muted track-wide-result-explainer">
        Vikterna från optimeringen testas mot{' '}
        <strong>alla {session.racesWithResult} importerade avdelningar</strong> med resultat på{' '}
        {trackName} — alla V86, V85, GS75 osv. i databasen, inte bara den valda omgången. Mål:{' '}
        {goalText} (någon av topp 3 i Trot Score).
      </p>

      {baseline && (
        <>
          <div className="backtest-compare" style={{ marginTop: '0.85rem' }}>
            <CompareBox
              label="Nuvarande banprofil"
              subtitle="Sparade vikter idag"
              hits={baseline.hits}
              total={baseline.racesWithResult}
              hitRate={baseline.hitRate}
            />
            <div className="backtest-compare-arrow">→</div>
            <CompareBox
              label={sessionWeightsLabel}
              subtitle={baseline ? 'Optimerade för denna omgång' : undefined}
              hits={session.hits}
              total={session.racesWithResult}
              hitRate={session.hitRate}
              highlight={improved}
            />
          </div>
          {!sameHits && (
            <p className={improved ? 'hit-win' : 'hit-miss'} style={{ margin: '0.75rem 0 0' }}>
              {improved ? '+' : ''}
              {session.hits - baseline.hits} träffar jämfört med nuvarande banprofil.
            </p>
          )}
          {sameHits && (
            <p className="muted" style={{ margin: '0.75rem 0 0' }}>
              Samma träff som nuvarande banprofil på alla importerade lopp.
            </p>
          )}
        </>
      )}
    </div>
  );
}
