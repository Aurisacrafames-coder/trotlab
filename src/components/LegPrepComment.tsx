import { buildLegPrepComment } from '../../shared/legPrepComment';
import type { GameSessionLeg } from '../../shared/types';
import { useTrackPrepAnalysis } from './TrackPrepBrief';

type LegPrepInput = Pick<
  GameSessionLeg,
  'distance' | 'startMethod' | 'raceInfo' | 'systemSuggestion' | 'marginToSecond' | 'rankedHorses'
>;

export default function LegPrepComment({
  atgTrackId,
  gameType,
  leg,
  label = 'Gardering inför lopp',
}: {
  atgTrackId: number | null | undefined;
  gameType: string;
  leg: LegPrepInput;
  label?: string;
}) {
  const { analysis, loading, error } = useTrackPrepAnalysis(atgTrackId, gameType);

  if (atgTrackId == null) return null;
  if (loading) return <p className="muted leg-prep-loading">Laddar garderingsförslag…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!analysis) return null;

  const comment = buildLegPrepComment(leg, gameType, analysis);
  if (!comment) return null;

  return (
    <p className="leg-prep-comment">
      {label ? (
        <>
          <strong>{label}:</strong> {comment}
        </>
      ) : (
        comment
      )}
    </p>
  );
}

export function legPrepInputFromSession(
  session: {
    distance: number | null;
    startMethod: string | null;
    raceName: string | null;
    racePrize: string | null;
    raceTerms: string[];
    scheduledStartTime: string | null;
    entries?: Array<{ startNumber: number; horseName: string; trotScore: number | null; betDistributionPct?: number | null; scratched?: boolean }>;
  },
  siblingLeg?: GameSessionLeg | null,
): LegPrepInput {
  if (siblingLeg) return siblingLeg;

  const raceInfo =
    session.raceName || session.racePrize || session.raceTerms.length > 0 || session.scheduledStartTime
      ? {
          name: session.raceName,
          prize: session.racePrize,
          terms: session.raceTerms,
          startMethod: session.startMethod,
          distance: session.distance,
          scheduledStartTime: session.scheduledStartTime,
        }
      : null;

  const rankedHorses =
    session.entries
      ?.filter((entry): entry is typeof entry & { trotScore: number } => entry.trotScore != null)
      .map((entry) => ({
        startNumber: entry.startNumber,
        horseName: entry.horseName,
        trotScore: entry.trotScore,
        betDistributionPct: entry.betDistributionPct ?? null,
        scratched: entry.scratched ?? false,
        isWatched: false,
      })) ?? [];

  return {
    distance: session.distance,
    startMethod: session.startMethod,
    raceInfo,
    systemSuggestion: null,
    marginToSecond: null,
    rankedHorses,
  };
}
