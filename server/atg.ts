import type { ParsedAtgUrl } from '../shared/types.js';
import { parseVenueSlug, venueMatchesGameTracks, type GameVenue } from '../shared/gameVenue.js';
import {
  formatKmTimeForStorage,
  detectFormRecordTime,
  resolveActualPlacement,
  resolveFormPlace,
  type VolteRow,
} from '../shared/format.js';
import { normalizeStartMethod } from '../shared/scoring.js';
import {
  getTrackSlugById,
  knownTrackNameById,
  TRACK_DISPLAY_NAMES,
  TRACK_SLUGS,
} from '../shared/tracks.js';

export interface KnownTrack {
  atgTrackId: number;
  slug: string;
  name: string;
}

export { TRACK_SLUGS, TRACK_DISPLAY_NAMES, getTrackSlugById, knownTrackNameById };

const ATG_BASE = 'https://www.atg.se/services/racinginfo/v1/api';

/** ATG URL segments for single-race pages (vinnare, vinnare/plats, plats). */
const SINGLE_RACE_URL_PRODUCTS = new Set(['vinnare', 'vp', 'plats']);

function isSingleRaceUrlProduct(product: string | undefined): boolean {
  return SINGLE_RACE_URL_PRODUCTS.has(product?.toLowerCase() ?? '');
}

export function listKnownTracks(): KnownTrack[] {
  return Object.entries(TRACK_SLUGS)
    .map(([slug, atgTrackId]) => ({
      atgTrackId,
      slug,
      name: TRACK_DISPLAY_NAMES[slug] ?? slug,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

export function parseAtgUrl(url: string): (ParsedAtgUrl & { raceId?: string }) | null {
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.split('/').filter(Boolean);

    const spelIdx = parts.indexOf('spel');
    if (spelIdx >= 0 && parts.length >= spelIdx + 5) {
      const avdIdx = parts.indexOf('avd', spelIdx);
      if (avdIdx >= 0) {
        const leg = parseInt(parts[avdIdx + 1], 10);
        if (Number.isNaN(leg)) return null;

        const seg1 = parts[spelIdx + 1];
        const seg2 = parts[spelIdx + 2];
        const trackSlug = parts[spelIdx + 3];
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;

        let gameType: string;
        let date: string;

        if (datePattern.test(seg1)) {
          // /spel/2026-07-26/GS75/lindesberg/avd/1
          date = seg1;
          gameType = seg2.toUpperCase();
        } else if (datePattern.test(seg2)) {
          // /spel/gs75/2026-07-26/lindesberg/avd/4
          gameType = seg1.toUpperCase();
          date = seg2;
        } else {
          return null;
        }

        if (datePattern.test(date) && trackSlug) {
          return { gameType, date, trackSlug, leg };
        }
      }
    }

    // /spel/2026-07-27/vinnare/ostersund/lopp/2  (also /vp/ and /plats/)
    if (spelIdx >= 0 && parts.length >= spelIdx + 6) {
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const date = parts[spelIdx + 1];
      const product = parts[spelIdx + 2]?.toLowerCase();
      const trackSlug = parts[spelIdx + 3];
      const loppMarker = parts[spelIdx + 4]?.toLowerCase();
      const raceNumber = parseInt(parts[spelIdx + 5], 10);
      if (
        isSingleRaceUrlProduct(product) &&
        loppMarker === 'lopp' &&
        datePattern.test(date) &&
        trackSlug &&
        !Number.isNaN(raceNumber)
      ) {
        return { gameType: 'VINNARE', date, trackSlug, leg: raceNumber };
      }
    }

    const raceMatch = u.pathname.match(/(\d{4}-\d{2}-\d{2}_\d+_\d+)/);
    if (raceMatch) {
      const raceId = raceMatch[1];
      const [, date, , legStr] = raceId.split('_');
      return {
        gameType: 'UNKNOWN',
        date,
        trackSlug: '',
        leg: parseInt(legStr, 10),
        raceId,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function atgFetch<T>(path: string, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ATG_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ATG API fel ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`ATG API timeout (${timeoutMs / 1000}s): ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface CalendarDay {
  tracks?: Array<{
    id: number;
    name: string;
    races?: Array<{ id: string; number: number; status?: string }>;
  }>;
  games: Record<
    string,
    Array<{ id: string; races: string[]; tracks?: number[] }>
  >;
}

async function resolveVinnareRaceId(parsed: ParsedAtgUrl): Promise<string> {
  const trackId = TRACK_SLUGS[parsed.trackSlug.toLowerCase()];
  if (trackId == null) {
    throw new Error(`Okänd bana: ${parsed.trackSlug}. Kontrollera länken.`);
  }

  const expectedRaceId = `${parsed.date}_${trackId}_${parsed.leg}`;
  const calendar = await atgFetch<CalendarDay>(`/calendar/day/${parsed.date}`);

  const track = calendar.tracks?.find((t) => t.id === trackId);
  const race = track?.races?.find((r) => r.number === parsed.leg);
  if (race?.id) return race.id;

  const vinnareGames = [
    ...(calendar.games.vinnare ??
      calendar.games.Vinnare ??
      calendar.games.VINNARE ??
      []),
    ...(calendar.games.vp ?? calendar.games.VP ?? []),
    ...(calendar.games.plats ?? calendar.games.PLATS ?? []),
  ];
  const game = vinnareGames.find((g) => g.races?.includes(expectedRaceId));
  if (game?.races?.[0]) return game.races[0];

  return expectedRaceId;
}

interface CalendarGame {
  id: string;
  races: string[];
  tracks?: number[];
}

export function findCalendarGameForVenue(
  games: CalendarGame[],
  venue: GameVenue,
): CalendarGame | undefined {
  const byTracks = games.find((game) => venueMatchesGameTracks(venue, game.tracks));
  if (byTracks) return byTracks;

  if (!venue.isMultiTrack) {
    const trackId = venue.trackIds[0];
    return games.find((game) => game.id.includes(`_${trackId}_`));
  }

  return undefined;
}

export async function resolveCalendarGameFromUrl(sourceUrl: string): Promise<{
  parsed: ParsedAtgUrl;
  venue: GameVenue;
  game: CalendarGame;
}> {
  const parsed = parseAtgUrl(sourceUrl.trim());
  if (!parsed || parsed.gameType === 'VINNARE' || parsed.gameType === 'UNKNOWN') {
    throw new Error('Ogiltig spel-länk för hel omgång.');
  }

  const venue = parseVenueSlug(parsed.trackSlug);
  const calendar = await atgFetch<CalendarDay>(`/calendar/day/${parsed.date}`);
  const keyLower = parsed.gameType.toLowerCase();
  const games =
    calendar.games[parsed.gameType] ??
    calendar.games[keyLower] ??
    calendar.games[keyLower.toUpperCase()] ??
    [];

  const normalizedGames = (Array.isArray(games) ? games : [games]).filter(Boolean) as CalendarGame[];
  const game = findCalendarGameForVenue(normalizedGames, venue);
  if (!game?.races.length) {
    throw new Error(
      `Kunde inte hitta ${parsed.gameType} på ${parsed.date} (${venue.displayName}). Kontrollera länken.`,
    );
  }

  return { parsed, venue, game };
}

export async function resolveRaceId(parsed: ParsedAtgUrl & { raceId?: string }): Promise<string> {
  if (parsed.raceId) return parsed.raceId;
  if (parsed.gameType === 'VINNARE') return resolveVinnareRaceId(parsed);

  const venue = parseVenueSlug(parsed.trackSlug);
  const calendar = await atgFetch<CalendarDay>(`/calendar/day/${parsed.date}`);
  const keyLower = parsed.gameType.toLowerCase();
  const games =
    calendar.games[parsed.gameType] ??
    calendar.games[keyLower] ??
    calendar.games[keyLower.toUpperCase()] ??
    [];

  const normalizedGames = (Array.isArray(games) ? games : [games]).filter(Boolean) as CalendarGame[];
  const game = findCalendarGameForVenue(normalizedGames, venue);
  if (game) {
    const raceId = game.races[parsed.leg - 1];
    if (raceId) return raceId;
  }

  for (const fallbackGame of normalizedGames) {
    const raceId = fallbackGame.races[parsed.leg - 1];
    if (raceId) return raceId;
  }

  throw new Error(
    `Kunde inte hitta lopp ${parsed.leg} för ${parsed.gameType} ${parsed.date}. Kontrollera länken.`,
  );
}

interface AtgRace {
  id: string;
  name?: string;
  number?: number;
  date: string;
  distance: number;
  startMethod: string;
  status: string;
  prize?: string;
  terms?: string[];
  scheduledStartTime?: string;
  track: { id: number; name: string };
  starts: AtgStart[];
}

interface AtgStart {
  number: number;
  postPosition: number;
  distance?: number;
  scratched?: boolean;
  horse: {
    id: number;
    name: string;
    sex?: string;
    money?: number;
    trainer?: {
      id: number;
      firstName: string;
      lastName: string;
      shortName?: string;
    };
    statistics?: {
      life?: { startPoints?: number; earningsPerStart?: number; starts?: number };
    };
  };
  driver?: {
    id: number;
    firstName: string;
    lastName: string;
    shortName?: string;
    license?: string;
  };
  result?: { place?: number; finishOrder?: number; galloped?: boolean; disqualified?: boolean };
}

interface StartDetail {
  horse: {
    sex?: string;
    money?: number;
    trainer?: {
      id: number;
      firstName: string;
      lastName: string;
      shortName?: string;
    };
    statistics?: {
      life?: { startPoints?: number; earningsPerStart?: number; starts?: number };
    };
    results?: { records?: FormRecord[] };
  };
  driver?: { license?: string };
}

interface FormRecord {
  date: string;
  kmTime?: { minutes: number; seconds: number; tenths: number; code?: string };
  place?: string;
  race?: { firstPrize?: number };
  track?: { name: string };
  start?: {
    distance?: number;
    postPosition?: number;
    driver?: { firstName: string; lastName: string; shortName?: string };
  };
}

export async function fetchLegBetDistribution(
  parsed: ParsedAtgUrl & { raceId?: string },
): Promise<Map<number, number>> {
  if (parsed.gameType === 'UNKNOWN') return new Map();

  try {
    const calendar = await atgFetch<CalendarDay>(`/calendar/day/${parsed.date}`);

    if (parsed.gameType === 'VINNARE') {
      const trackId = TRACK_SLUGS[parsed.trackSlug.toLowerCase()];
      const expectedRaceId =
        trackId != null ? `${parsed.date}_${trackId}_${parsed.leg}` : null;
      const vinnareGames = [
        ...(calendar.games.vinnare ??
          calendar.games.Vinnare ??
          calendar.games.VINNARE ??
          []),
        ...(calendar.games.vp ?? calendar.games.VP ?? []),
        ...(calendar.games.plats ?? calendar.games.PLATS ?? []),
      ];
      const game = vinnareGames.find(
        (g) =>
          g.races?.includes(expectedRaceId ?? '') ||
          (trackId != null && g.tracks?.includes(trackId) && g.races?.length === 1),
      );
      if (!game?.id) return new Map();

      const raceData = await atgFetch<{
        races: Array<{
          starts: Array<{
            number: number;
            pools?: Record<string, { betDistribution?: number }>;
          }>;
        }>;
      }>(`/games/${game.id}`);

      const legRace = raceData.races[0];
      if (!legRace) return new Map();

      return betDistributionFromLegRace(legRace, 'vinnare');
    }

    const keyLower = parsed.gameType.toLowerCase();
    const games =
      calendar.games[parsed.gameType] ??
      calendar.games[keyLower] ??
      calendar.games[keyLower.toUpperCase()] ??
      [];

    const normalizedGames = (Array.isArray(games) ? games : [games]).filter(Boolean) as CalendarGame[];
    const venue = parseVenueSlug(parsed.trackSlug);
    let gameId = findCalendarGameForVenue(normalizedGames, venue)?.id;
    if (!gameId) {
      const trackId = TRACK_SLUGS[parsed.trackSlug.toLowerCase()];
      for (const game of normalizedGames) {
        if (trackId && !game.id.includes(`_${trackId}_`)) continue;
        gameId = game.id;
        break;
      }
      gameId ??= normalizedGames[0]?.id;
    }
    if (!gameId) return new Map();

    const game = await atgFetch<{
      races: Array<{
        starts: Array<{
          number: number;
          pools?: Record<string, { betDistribution?: number }>;
        }>;
      }>;
    }>(`/games/${gameId}`);

    const legRace = game.races[parsed.leg - 1];
    if (!legRace) return new Map();

    return betDistributionFromLegRace(legRace, parsed.gameType);
  } catch {
    /* spel% är valfri */
  }
  return new Map();
}

type LegRacePools = {
  starts: Array<{
    number: number;
    pools?: Record<string, { betDistribution?: number }>;
  }>;
};

function betDistributionFromLegRace(legRace: LegRacePools, gameType: string): Map<number, number> {
  const result = new Map<number, number>();
  const poolKeys = [gameType, gameType.toUpperCase(), gameType.toLowerCase(), 'vinnare', 'vp', 'plats'];
  for (const start of legRace.starts) {
    if (!start.pools) continue;
    for (const key of poolKeys) {
      const raw = start.pools[key]?.betDistribution;
      if (raw != null) {
        result.set(start.number, raw / 100);
        break;
      }
    }
  }
  return result;
}

export async function fetchBetDistributionForGameLeg(
  atgGameId: string,
  gameType: string,
  legNumber: number,
): Promise<Map<number, number>> {
  try {
    const game = await atgFetch<{ races: LegRacePools[] }>(`/games/${atgGameId}`);
    const legRace = game.races[legNumber - 1];
    if (!legRace) return new Map();
    return betDistributionFromLegRace(legRace, gameType);
  } catch {
    return new Map();
  }
}

function formatKmTime(km?: FormRecord['kmTime']): string | null {
  return formatKmTimeForStorage(km);
}

function detectVolteRows(
  starts: AtgStart[],
  startMethod: string | null,
): Map<number, VolteRow> {
  const rows = new Map<number, VolteRow>();
  if (normalizeStartMethod(startMethod) !== 'volte') return rows;

  const distances = starts
    .map((s) => s.distance)
    .filter((d): d is number => d != null);
  if (distances.length === 0) return rows;

  const minDistance = Math.min(...distances);
  for (const start of starts) {
    if (start.distance == null) continue;
    rows.set(start.number, start.distance > minDistance ? 'back' : 'front');
  }
  return rows;
}

export function isApprenticeDriver(license: string | null | undefined): boolean {
  if (!license) return false;
  const lower = license.toLowerCase();
  return lower.includes('lärling') || /\bl-kör|\bl kör/.test(lower);
}

function driverName(d?: { firstName: string; lastName: string; shortName?: string }): string | null {
  if (!d) return null;
  return d.shortName ?? `${d.firstName} ${d.lastName}`.trim();
}

export { driverName };

/** ATG returns earnings per start in öre (1/100 kr). */
export function normalizeEarningsPerStartFromAtg(ore: number | null | undefined): number | null {
  if (ore == null || Number.isNaN(ore)) return null;
  return ore / 100;
}

function extractActualPosition(result?: AtgStart['result']): number | null {
  return resolveActualPlacement(result);
}

export interface RaceResultUpdate {
  atgRaceId: string;
  status: string;
  results: Array<{ startNumber: number; actualPosition: number | null }>;
}

export async function fetchRaceResults(raceId: string): Promise<RaceResultUpdate> {
  const race = await atgFetch<AtgRace>(`/races/${raceId}`);

  if (race.status !== 'results') {
    throw new Error(
      `Loppet har inga resultat än (status: ${race.status}). Hämta igen efter att loppet körts.`,
    );
  }

  return {
    atgRaceId: race.id,
    status: race.status,
    results: race.starts.map((start) => ({
      startNumber: start.number,
      actualPosition: extractActualPosition(start.result),
    })),
  };
}

export async function fetchRaceResultsFromUrl(url: string): Promise<RaceResultUpdate> {
  const parsed = parseAtgUrl(url);
  if (!parsed) {
    throw new Error('Ogiltig ATG-länk.');
  }
  const raceId = await resolveRaceId(parsed);
  return fetchRaceResults(raceId);
}

export interface ImportedRace {
  atgRaceId: string;
  atgTrackId: number;
  gameType: string;
  legNumber: number;
  trackRaceNumber: number | null;
  date: string;
  trackName: string;
  distance: number | null;
  startMethod: string | null;
  status: string | null;
  raceName: string | null;
  racePrize: string | null;
  raceTerms: string[];
  scheduledStartTime: string | null;
  entries: ImportedEntry[];
}

export interface ImportedEntry {
  atgHorseId: number;
  atgDriverId: number | null;
  atgTrainerId: number | null;
  horseName: string;
  startNumber: number;
  postPosition: number | null;
  startDistance: number | null;
  volteRow: VolteRow | null;
  driverName: string | null;
  trainerName: string | null;
  startPoints: number | null;
  earningsPerStart: number | null;
  horseSex: string | null;
  careerStarts: number | null;
  driverApprentice: boolean;
  actualPosition: number | null;
  driverTrackWinPct: number | null;
  driverGlobalWinPct: number | null;
  trainerWinPct: number | null;
  betDistributionPct: number | null;
  trackPostWinPct: number | null;
  scratched: boolean;
  formStarts: Array<{
    formOrder: number;
    date: string | null;
    distance: number | null;
    postPosition: number | null;
    kmTime: string | null;
    place: string | null;
    driverName: string | null;
    prizeFirst: number | null;
    trackName: string | null;
    isRecordTime: boolean;
  }>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) break;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export async function importFromUrl(
  sourceUrl: string,
  options?: { startFetchConcurrency?: number },
): Promise<ImportedRace> {
  const parsed = parseAtgUrl(sourceUrl);
  if (!parsed) {
    throw new Error(
      'Ogiltig ATG-länk. Använd t.ex. atg.se/spel/gs75/2026-07-26/bana/avd/3, atg.se/spel/2026-07-27/vinnare/ostersund/lopp/2, atg.se/spel/2026-08-28/vp/bergsaker/lopp/2 eller en länk med race-id.',
    );
  }

  const raceId = await resolveRaceId(parsed);
  const race = await atgFetch<AtgRace>(`/races/${raceId}`);

  const entries: ImportedEntry[] = [];
  const volteRows = detectVolteRows(race.starts, race.startMethod ?? null);
  const betDistribution = await fetchLegBetDistribution(parsed);
  const concurrency = options?.startFetchConcurrency ?? 5;

  for (const start of race.starts) {
    if (start.scratched) {
      entries.push({
        atgHorseId: start.horse.id,
        atgDriverId: start.driver?.id ?? null,
        atgTrainerId: start.horse.trainer?.id ?? null,
        horseName: start.horse.name,
        startNumber: start.number,
        postPosition: start.postPosition ?? null,
        startDistance: start.distance ?? null,
        volteRow: volteRows.get(start.number) ?? null,
        driverName: driverName(start.driver),
        trainerName: driverName(start.horse.trainer),
        startPoints: null,
        earningsPerStart: null,
        horseSex: start.horse.sex ?? null,
        careerStarts: null,
        driverApprentice: isApprenticeDriver(start.driver?.license),
        actualPosition: null,
        driverTrackWinPct: null,
        driverGlobalWinPct: null,
        trainerWinPct: null,
        betDistributionPct: betDistribution.get(start.number) ?? null,
        trackPostWinPct: null,
        formStarts: [],
        scratched: true,
      });
    }
  }

  const activeStarts = race.starts.filter((start) => !start.scratched);
  const activeEntries = await mapWithConcurrency(activeStarts, concurrency, async (start) => {
    let startPoints = start.horse.statistics?.life?.startPoints ?? null;
    let earningsPerStart = normalizeEarningsPerStartFromAtg(
      start.horse.statistics?.life?.earningsPerStart,
    );
    let horseSex = start.horse.sex ?? null;
    let careerStarts = start.horse.statistics?.life?.starts ?? null;
    let driverApprentice = isApprenticeDriver(start.driver?.license);
    let formRecords: FormRecord[] = [];
    let horseStatistics: StartDetail['horse']['statistics'] | null = null;

    let trainerId = start.horse.trainer?.id ?? null;
    let trainerName = driverName(start.horse.trainer);

    try {
      const detail = await atgFetch<StartDetail>(`/races/${raceId}/start/${start.number}`);
      startPoints = detail.horse.statistics?.life?.startPoints ?? startPoints;
      earningsPerStart = normalizeEarningsPerStartFromAtg(
        detail.horse.statistics?.life?.earningsPerStart ?? start.horse.statistics?.life?.earningsPerStart,
      );
      horseSex = detail.horse.sex ?? horseSex;
      careerStarts = detail.horse.statistics?.life?.starts ?? careerStarts;
      driverApprentice = isApprenticeDriver(detail.driver?.license) || driverApprentice;
      formRecords = detail.horse.results?.records?.slice(0, 5) ?? [];
      horseStatistics = detail.horse.statistics ?? null;
      trainerId = detail.horse.trainer?.id ?? trainerId;
      trainerName = driverName(detail.horse.trainer) ?? trainerName;
    } catch {
      // keep race-level statistics
    }

    const actualPosition = extractActualPosition(start.result);

    return {
      atgHorseId: start.horse.id,
      atgDriverId: start.driver?.id ?? null,
      atgTrainerId: trainerId,
      horseName: start.horse.name,
      startNumber: start.number,
      postPosition: start.postPosition ?? null,
      startDistance: start.distance ?? null,
      volteRow: volteRows.get(start.number) ?? null,
      driverName: driverName(start.driver),
      trainerName,
      startPoints,
      earningsPerStart,
      horseSex,
      careerStarts,
      driverApprentice,
      actualPosition,
      driverTrackWinPct: null,
      driverGlobalWinPct: null,
      trainerWinPct: null,
      betDistributionPct: betDistribution.get(start.number) ?? null,
      trackPostWinPct: null,
      formStarts: formRecords.map((r, i) => {
        const place = resolveFormPlace(r.place, r.kmTime?.code);
        return {
          formOrder: i + 1,
          date: r.date ?? null,
          distance: r.start?.distance ?? null,
          postPosition: r.start?.postPosition ?? null,
          kmTime: formatKmTime(r.kmTime),
          place,
          driverName: driverName(r.start?.driver),
          prizeFirst: r.race?.firstPrize != null ? r.race.firstPrize / 100 : null,
          trackName: r.track?.name ?? null,
          isRecordTime: detectFormRecordTime(
            { date: r.date, place, kmTime: r.kmTime },
            horseStatistics,
          ),
        };
      }),
      scratched: false,
    } satisfies ImportedEntry;
  });

  entries.push(...activeEntries);
  entries.sort((a, b) => a.startNumber - b.startNumber);

  return {
    atgRaceId: race.id,
    atgTrackId: race.track.id,
    gameType: parsed.gameType === 'UNKNOWN' ? 'LOPP' : parsed.gameType,
    legNumber: parsed.leg,
    trackRaceNumber: race.number ?? null,
    date: race.date,
    trackName: race.track.name,
    distance: race.distance ?? null,
    startMethod: race.startMethod ?? null,
    status: race.status ?? null,
    raceName: race.name ?? null,
    racePrize: race.prize ?? null,
    raceTerms: race.terms ?? [],
    scheduledStartTime: race.scheduledStartTime ?? null,
    entries,
  };
}

export async function fetchRaceMetadata(raceId: string): Promise<{
  raceName: string | null;
  racePrize: string | null;
  raceTerms: string[];
  scheduledStartTime: string | null;
  distance: number | null;
  startMethod: string | null;
  status: string | null;
}> {
  const race = await atgFetch<AtgRace>(`/races/${raceId}`);
  return {
    raceName: race.name ?? null,
    racePrize: race.prize ?? null,
    raceTerms: race.terms ?? [],
    scheduledStartTime: race.scheduledStartTime ?? null,
    distance: race.distance ?? null,
    startMethod: race.startMethod ?? null,
    status: race.status ?? null,
  };
}

export async function refreshSessionScratchStatus(
  db: import('better-sqlite3').Database,
  sessionId: number,
): Promise<boolean> {
  const session = db
    .prepare('SELECT atg_race_id as atgRaceId, status FROM race_sessions WHERE id = ?')
    .get(sessionId) as { atgRaceId: string; status: string | null } | undefined;

  if (!session) return false;
  if (session.status === 'results') return false;

  const race = await atgFetch<AtgRace>(`/races/${session.atgRaceId}`);
  const scratchedByNumber = new Map(
    race.starts.map((start) => [start.number, Boolean(start.scratched)]),
  );

  const entries = db
    .prepare('SELECT id, start_number as startNumber, scratched FROM race_entries WHERE session_id = ?')
    .all(sessionId) as Array<{ id: number; startNumber: number; scratched: number }>;

  const update = db.prepare('UPDATE race_entries SET scratched = ? WHERE id = ?');
  let changed = false;

  for (const entry of entries) {
    const scratched = scratchedByNumber.get(entry.startNumber) ?? false;
    const next = scratched ? 1 : 0;
    if (entry.scratched !== next) {
      update.run(next, entry.id);
      changed = true;
    }
  }

  return changed;
}
