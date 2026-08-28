import { goalLabel } from './TrackWideBacktestResult';

export { goalLabel };

export function TrackHitSummary({
  trackName,
  goal,
  result,
  onSave,
  saving,
  saveMessage,
}: {
  trackName: string;
  goal: 'win' | 'top3';
  result: { hits: number; racesWithResult: number; hitRate: number | null };
  onSave: () => void;
  saving: boolean;
  saveMessage: string | null;
}) {
  const goalText = goalLabel(goal);

  return (
    <div className="track-hit-summary">
      <p className="track-hit-summary-label">
        Träffprocent på all historik — {trackName}
      </p>
      <p className="track-hit-summary-value">
        {result.hitRate != null ? `${result.hitRate}%` : '—'}
      </p>
      <p className="muted track-hit-summary-detail">
        {result.hits}/{result.racesWithResult} {goalText} med de nya vikterna
        {' '}· {result.racesWithResult} importerade lopp totalt
      </p>
      <div className="backtest-actions" style={{ marginTop: '1rem' }}>
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? 'Sparar…' : `Spara vikter på ${trackName}`}
        </button>
      </div>
      {saveMessage && (
        <p className={saveMessage.startsWith('Sparat') ? 'hit-win' : 'error'} style={{ margin: '0.75rem 0 0' }}>
          {saveMessage}
        </p>
      )}
    </div>
  );
}
