import type { ParsedAtgUrl } from '../shared/types.js';
import { normalizeStartMethod } from '../shared/scoring.js';
import { formatKmTimeLabel, MAX_REALISTIC_PLACEMENT, resolveFormPlace, type VolteRow } from '../shared/format.js';

const ATG_BASE = 'https://www.atg.se/services/racinginfo/v1/api';

export const TRACK_SLUGS: Record<string, number> = {
  solvalla: 5,
  jagersro: 7,
  axevalla: 8,
  bergsaker: 9,
  eskilstuna: 14,
  farjestad: 15,
  gavle: 16,
  halmstad: 17,
  kalmar: 18,
  lindesberg: 21,
  mantorp: 22,
  romme: 23,
  raby: 24,
  amal: 29,
  arjang: 31,
  orebro: 32,
  ovrevoll: 83,
  nykobing: 54,
  'goteborg-galopp': 45,
  'goteborg-trav': 47,
};

const TRACK_DISPLAY_NAMES: Record<string, string> = {
  solvalla: 'Solvalla',
  jagersro: 'Jägersro',
  axevalla: 'Axevalla',
  bergsaker: 'Bergsåker',
  eskilstuna: 'Eskilstuna',
  farjestad: 'Färjestad',
  gavle: 'Gävle',
  halmstad: 'Halmstad',
  kalmar: 'Kalmar',
  lindesberg: 'Lindesberg',
  mantorp: 'Mantorp',
  romme: 'Romme',
  raby: 'Rättvik',
  amal: 'Åmål',
  arjang: 'Arjang',
  orebro: 'Örebro',
  ovrevoll: 'Ovrevoll',
  nykobing: 'Nyköping',
  'goteborg-galopp': 'Göteborg Galopp',
  'goteborg-trav': 'Göteborg Trav',
};

export interface KnownTrack {
  atgTrackId: number;
  slug: string;
  name: string;
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

export function getTrackSlugById(atgTrackId: number): string | null {
  for (const [slug, id] of Object.entries(TRACK_SLUGS)) {
    if (id === atgTrackId) return slug;
  }
  return null;
}

export function parseAtgUrl(url: string): (ParsedAtgUrl & { raceId?: string }) | null {
  try {
    const u = new URL(url.trim());
    const parts = u.pathname.split('/').filter(Boolean);

    const spelIdx = parts.indexOf('spel');
    if (spelIdx >= 0 && parts.length >= spelIdx + 5) {
      const avdIdx = parts.indexOf('avd', spelIdx);
      if (avdIdx < 0) return null;

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

export async function atgFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${ATG_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ATG API fel ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

interface CalendarDay {
  games: Record<string, Array<{ id: string; races: string[] }>>;
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

export async function resolveRaceId(parsed: ParsedAtgUrl & { raceId?: string }): Promise<string> {
  if (parsed.raceId) return parsed.raceId;

  const calendar = await atgFetch<CalendarDay>(`/calendar/day/${parsed.date}`);
  const keyLower = parsed.gameType.toLowerCase();
  const games =
    calendar.games[parsed.gameType] ??
    calendar.games[keyLower] ??
    calendar.games[keyLower.toUpperCase()] ??
    [];

  const trackId = TRACK_SLUGS[parsed.trackSlug.toLowerCase()];

  for (const game of games) {
    if (trackId && !game.id.includes(`_${trackId}_`)) continue;
    const raceId = game.races[parsed.leg - 1];
    if (raceId) return raceId;
  }

  for (const game of games) {
    const raceId = game.races[parsed.leg - 1];
    if (raceId) return raceId;
  }

  throw new Error(
    `Kunde inte hitta lopp ${parsed.leg} för ${parsed.gameType} ${parsed.date}. Kontrollera länken.`,
  );
}

async function fetchLegBetDistribution(
  parsed: ParsedAtgUrl & { raceId?: string },
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (parsed.gameType === 'UNKNOWN') return result;

  try {
    const calendar = await atgFetch<CalendarDay>(`/calendar/day/${parsed.date}`);
    const keyLower = parsed.gameType.toLowerCase();
    const games =
      calendar.games[parsed.gameType] ??
      calendar.games[keyLower] ??
      calendar.games[keyLower.toUpperCase()] ??
      [];

    const trackId = TRACK_SLUGS[parsed.trackSlug.toLowerCase()];
    let gameId: string | undefined;
    for (const game of games) {
      if (trackId && !game.id.includes(`_${trackId}_`)) continue;
      gameId = game.id;
      break;
    }
    gameId ??= games[0]?.id;
    if (!gameId) return result;

    const game = await atgFetch<{
      races: Array<{
        starts: Array<{
          number: number;
          pools?: Record<string, { betDistribution?: number }>;
        }>;
      }>;
    }>(`/games/${gameId}`);

    const legRace = game.races[parsed.leg - 1];
    if (!legRace) return result;

    const poolKeys = [parsed.gameType, parsed.gameType.toUpperCase(), keyLower];
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
  } catch {
    /* spel% är valfri */
  }
  return result;
}

function formatKmTime(km?: FormRecord['kmTime']): string | null {
  if (!km) return null;
  if (km.code) return formatKmTimeLabel(km.code);
  if (km.minutes == null || km.seconds == null || km.tenths == null) return null;
  return `${km.minutes}.${km.seconds.toString().padStart(2, '0')},${km.tenths}`;
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

/** ATG returns earnings per start in öre (1/100 kr). */
export function normalizeEarningsPerStartFromAtg(ore: number | null | undefined): number | null {
  if (ore == null || Number.isNaN(ore)) return null;
  return ore / 100;
}

function extractActualPosition(result?: AtgStart['result']): number | null {
  if (!result) return null;
  if (result.galloped || result.disqualified) return 0;
  if (result.place != null && result.place > 0) return result.place;
  if (
    result.finishOrder != null &&
    result.finishOrder > 0 &&
    result.finishOrder <= MAX_REALISTIC_PLACEMENT
  ) {
    return result.finishOrder;
  }
  return null;
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
  horseName: string;
  startNumber: number;
  postPosition: number | null;
  startDistance: number | null;
  volteRow: VolteRow | null;
  driverName: string | null;
  startPoints: number | null;
  earningsPerStart: number | null;
  horseSex: string | null;
  careerStarts: number | null;
  driverApprentice: boolean;
  actualPosition: number | null;
  driverV85WinPct: number | null;
  betDistributionPct: number | null;
  trackPostWinPct: number | null;
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
  }>;
}

export async function importFromUrl(sourceUrl: string): Promise<ImportedRace> {
  const parsed = parseAtgUrl(sourceUrl);
  if (!parsed) {
    throw new Error(
      'Ogiltig ATG-länk. Använd t.ex. atg.se/spel/gs75/2026-07-26/bana/avd/3 eller atg.se/spel/2026-07-26/GS75/bana/avd/1',
    );
  }

  const raceId = await resolveRaceId(parsed);
  const race = await atgFetch<AtgRace>(`/races/${raceId}`);

  const entries: ImportedEntry[] = [];
  const volteRows = detectVolteRows(race.starts, race.startMethod ?? null);
  const betDistribution = await fetchLegBetDistribution(parsed);

  for (const start of race.starts) {
    if (start.scratched) continue;

    let startPoints = start.horse.statistics?.life?.startPoints ?? null;
    let earningsPerStart = normalizeEarningsPerStartFromAtg(
      start.horse.statistics?.life?.earningsPerStart,
    );
    let horseSex = start.horse.sex ?? null;
    let careerStarts = start.horse.statistics?.life?.starts ?? null;
    let driverApprentice = isApprenticeDriver(start.driver?.license);
    let formRecords: FormRecord[] = [];

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
    } catch {
      // keep race-level statistics
    }

    const actualPosition = extractActualPosition(start.result);

    entries.push({
      atgHorseId: start.horse.id,
      atgDriverId: start.driver?.id ?? null,
      horseName: start.horse.name,
      startNumber: start.number,
      postPosition: start.postPosition ?? null,
      startDistance: start.distance ?? null,
      volteRow: volteRows.get(start.number) ?? null,
      driverName: driverName(start.driver),
      startPoints,
      earningsPerStart,
      horseSex,
      careerStarts,
      driverApprentice,
      actualPosition,
      driverV85WinPct: null,
      betDistributionPct: betDistribution.get(start.number) ?? null,
      trackPostWinPct: null,
      formStarts: formRecords.map((r, i) => ({
        formOrder: i + 1,
        date: r.date ?? null,
        distance: r.start?.distance ?? null,
        postPosition: r.start?.postPosition ?? null,
        kmTime: formatKmTime(r.kmTime),
        place: resolveFormPlace(r.place, r.kmTime?.code),
        driverName: driverName(r.start?.driver),
        prizeFirst: r.race?.firstPrize != null ? r.race.firstPrize / 100 : null,
        trackName: r.track?.name ?? null,
      })),
    });

    await new Promise((r) => setTimeout(r, 50));
  }

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
