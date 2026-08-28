import {
  buildLegSpikeRecommendation,
  formatLegSpikeRecommendation,
  spikeLabelCssClass,
} from '../../shared/legSpikeRecommendation';
import type { GameSessionLeg } from '../../shared/types';
import { useTrackPrepAnalysis } from './TrackPrepBrief';

type LegSpikeInput = Pick<
  GameSessionLeg,
  'distance' | 'startMethod' | 'raceInfo' | 'systemSuggestion' | 'marginToSecond' | 'rankedHorses'
>;

export default function LegSpikeHint({
  atgTrackId,
  gameType,
  leg,
}: {
  atgTrackId: number | null | undefined;
  gameType: string;
  leg: LegSpikeInput;
}) {
  const { analysis, loading, error } = useTrackPrepAnalysis(atgTrackId, gameType);

  if (atgTrackId == null) return null;
  if (loading) return <p className="muted leg-prep-loading">Laddar spik-råd…</p>;
  if (error) return null;
  if (!analysis?.topPickWin) return null;

  const rec = buildLegSpikeRecommendation(leg, gameType, analysis.topPickWin);
  if (!rec) return null;

  const text = formatLegSpikeRecommendation(rec);

  return (
    <p className={`leg-spike-hint ${spikeLabelCssClass(rec.label)}`}>
      <strong>Spik ettan?</strong> {text}
    </p>
  );
}
