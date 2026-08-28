import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrackMissAnalysis, saveTrackProfile } from '../api';
import { buildTrackPrepBriefSections } from '../../shared/trackPrepBrief';
import type { TrackMissAnalysis } from '../../shared/types';
import { DEFAULT_BACKTEST_GOAL } from '../../shared/types';

export function useTrackPrepAnalysis(atgTrackId: number | null | undefined, gameType?: string) {
  const [analysis, setAnalysis] = useState<TrackMissAnalysis | null>(null);
  const [loading, setLoading] = useState(atgTrackId != null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (atgTrackId == null) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTrackMissAnalysis({ atgTrackId, goal: DEFAULT_BACKTEST_GOAL })
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Kunde inte ladda bananalys');
          setAnalysis(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [atgTrackId]);

  const sections =
    analysis != null ? buildTrackPrepBriefSections(analysis, gameType) : [];

  return { analysis, sections, loading, error };
}

export default function TrackPrepBrief({
  atgTrackId,
  trackName,
  gameType,
  showSaveButton = true,
  compact = false,
  analysis: analysisProp,
}: {
  atgTrackId: number | null | undefined;
  trackName: string;
  gameType?: string;
  showSaveButton?: boolean;
  compact?: boolean;
  analysis?: TrackMissAnalysis | null;
}) {
  const fetched = useTrackPrepAnalysis(analysisProp != null ? null : atgTrackId, gameType);
  const analysis = analysisProp ?? fetched.analysis;
  const sections =
    analysis != null ? buildTrackPrepBriefSections(analysis, gameType) : fetched.sections;
  const loading = analysisProp == null && fetched.loading;
  const error = analysisProp == null ? fetched.error : null;
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  if (atgTrackId == null) return null;
  if (loading) return <p className="muted">Laddar bananalys…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!analysis || sections.length === 0) return null;

  async function handleSaveSuggested() {
    if (!analysis?.suggestedWeights) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      await saveTrackProfile(atgTrackId!, trackName, analysis.suggestedWeights);
      setSaveMessage(`Sparat — ${trackName} använder nu de optimerade vikterna.`);
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : 'Kunde inte spara vikter');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`track-prep-brief${compact ? ' track-prep-brief-compact' : ''}`}>
      {sections.map((section) => (
        <div key={section.title} className="track-prep-brief-section">
          <h3 className="breakdown-title">{section.title}</h3>
          <ul className="prep-insights">
            {section.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}

      {showSaveButton && analysis.suggestedWeights && (
        <div className="backtest-actions" style={{ marginTop: '0.75rem' }}>
          <button type="button" onClick={handleSaveSuggested} disabled={saving}>
            {saving ? 'Sparar…' : `Spara optimerade vikter på ${trackName}`}
          </button>
          <Link to={`/forbered?bana=${atgTrackId}`} className="muted">
            Full analys →
          </Link>
        </div>
      )}

      {saveMessage && (
        <p className={saveMessage.startsWith('Sparat') ? 'hit-win' : 'error'} style={{ marginTop: '0.75rem' }}>
          {saveMessage}
        </p>
      )}
    </div>
  );
}

export function buildPrepBriefFromAnalysis(
  analysis: TrackMissAnalysis | null,
  gameType?: string,
) {
  if (!analysis) return { text: '', html: '' };
  const sections = buildTrackPrepBriefSections(analysis, gameType);
  const text = sections.map((s) => [s.title, ...s.lines.map((l) => `• ${l}`)].join('\n')).join('\n\n');
  const html = sections
    .map(
      (s) =>
        `<section class="prep-brief-section"><h2>${s.title.replace(/&/g, '&amp;')}</h2><ul>${s.lines.map((l) => `<li>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('')}</ul></section>`,
    )
    .join('\n');
  return { text, html };
}
