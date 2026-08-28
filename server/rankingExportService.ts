import type Database from 'better-sqlite3';
import { fetchBetDistributionForGameLeg, fetchLegBetDistribution, parseAtgUrl } from './atg.js';
import { loadGameSession } from './gameSessions.js';
import { analyzeTrackMisses } from './trackMissAnalysis.js';
import { buildLegPrepComment } from '../shared/legPrepComment.js';
import { buildLegSpikeRecommendation, formatLegSpikeRecommendation } from '../shared/legSpikeRecommendation.js';
import {
  buildRankingHtmlDocument,
  buildRankingPlainText,
  rankingExportFilename,
  rankingExportTitle,
} from '../shared/rankingExport.js';
import { buildTrackPrepBriefHtml, buildTrackPrepBriefText } from '../shared/trackPrepBrief.js';
import type { GameSession, TrackMissAnalysis } from '../shared/types.js';
import { DEFAULT_BACKTEST_GOAL } from '../shared/types.js';

export interface GameRankingExport {
  title: string;
  filename: string;
  html: string;
  plainText: string;
}

export async function buildGameRankingExport(
  db: Database.Database,
  gameSessionId: number,
): Promise<GameRankingExport | null> {
  const game = loadGameSession(db, gameSessionId);
  if (!game) return null;

  const gameWithBetPct = await enrichGameWithCurrentBetDistribution(db, game);
  const { prepBriefText, prepBriefHtml, legPrepComments, legSpikeComments } = buildPrepForGame(
    db,
    gameWithBetPct,
  );

  return {
    title: rankingExportTitle(gameWithBetPct),
    filename: rankingExportFilename(gameWithBetPct),
    html: buildRankingHtmlDocument(gameWithBetPct, prepBriefHtml, legPrepComments, legSpikeComments),
    plainText: buildRankingPlainText(
      gameWithBetPct,
      Infinity,
      prepBriefText,
      legPrepComments,
      legSpikeComments,
    ),
  };
}

async function enrichGameWithCurrentBetDistribution(
  db: Database.Database,
  game: GameSession,
): Promise<GameSession> {
  const sourceUrls = new Map(
    (
      db
        .prepare(
          `SELECT id, source_url as sourceUrl FROM race_sessions WHERE game_session_id = ?`,
        )
        .all(game.id) as Array<{ id: number; sourceUrl: string | null }>
    ).map((row) => [row.id, row.sourceUrl]),
  );

  const legs = await Promise.all(
    game.legs.map(async (leg) => {
      let distribution = new Map<number, number>();

      if (game.atgGameId) {
        distribution = await fetchBetDistributionForGameLeg(
          game.atgGameId,
          game.gameType,
          leg.legNumber,
        );
      }

      if (distribution.size === 0) {
        const sourceUrl = sourceUrls.get(leg.id);
        const parsed = sourceUrl ? parseAtgUrl(sourceUrl) : null;
        if (parsed) {
          distribution = await fetchLegBetDistribution(parsed);
        }
      }

      return {
        ...leg,
        rankedHorses: leg.rankedHorses.map((horse) => ({
          ...horse,
          betDistributionPct:
            distribution.get(horse.startNumber) ?? horse.betDistributionPct ?? null,
        })),
      };
    }),
  );

  return { ...game, legs };
}

function buildPrepForGame(db: Database.Database, game: GameSession) {
  const trackIds = [
    ...new Set(
      game.legs.map((leg) => leg.atgTrackId).filter((id): id is number => id != null),
    ),
  ];

  if (trackIds.length === 0) {
    return {
      prepBriefText: undefined as string | undefined,
      prepBriefHtml: undefined as string | undefined,
      legPrepComments: undefined as Map<number, string> | undefined,
      legSpikeComments: undefined as Map<number, string> | undefined,
    };
  }

  const analysisByTrack = new Map<number, TrackMissAnalysis>();
  for (const trackId of trackIds) {
    analysisByTrack.set(trackId, analyzeTrackMisses(db, trackId, DEFAULT_BACKTEST_GOAL));
  }

  const legPrepComments = new Map<number, string>();
  const legSpikeComments = new Map<number, string>();

  for (const leg of game.legs) {
    if (leg.atgTrackId == null) continue;
    const analysis = analysisByTrack.get(leg.atgTrackId);
    if (!analysis) continue;

    legPrepComments.set(leg.legNumber, buildLegPrepComment(leg, game.gameType, analysis));
    const rec = buildLegSpikeRecommendation(leg, game.gameType, analysis.topPickWin);
    if (rec) {
      legSpikeComments.set(leg.legNumber, formatLegSpikeRecommendation(rec));
    }
  }

  const briefSections = trackIds.map((trackId) => {
    const analysis = analysisByTrack.get(trackId)!;
    return {
      text: buildTrackPrepBriefText(analysis, game.gameType),
      html: buildTrackPrepBriefHtml(analysis, game.gameType),
    };
  });

  return {
    prepBriefText: briefSections.map((section) => section.text).join('\n\n'),
    prepBriefHtml: briefSections.map((section) => section.html).join('\n'),
    legPrepComments,
    legSpikeComments,
  };
}
