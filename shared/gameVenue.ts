import { getTrackSlugById, TRACK_DISPLAY_NAMES, TRACK_SLUGS } from './tracks.js';

export interface CalendarGameRef {
  id?: string;
  races?: string[];
  tracks?: number[];
}

export interface GameVenue {
  venueSlug: string;
  trackIds: number[];
  displayName: string;
  isMultiTrack: boolean;
}

export function parseVenueSlug(rawSlug: string): GameVenue {
  const slug = rawSlug.toLowerCase().trim();
  const singleId = TRACK_SLUGS[slug];
  if (singleId != null) {
    return {
      venueSlug: slug,
      trackIds: [singleId],
      displayName: TRACK_DISPLAY_NAMES[slug] ?? rawSlug,
      isMultiTrack: false,
    };
  }

  const parts = slug.split('-').filter(Boolean);
  const trackIds: number[] = [];
  const names: string[] = [];
  let index = 0;

  while (index < parts.length) {
    let matched = false;
    for (let len = parts.length - index; len >= 1; len--) {
      const key = parts.slice(index, index + len).join('-');
      const id = TRACK_SLUGS[key];
      if (id != null) {
        trackIds.push(id);
        names.push(TRACK_DISPLAY_NAMES[key] ?? key);
        index += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new Error(`Okänd bana i länken: ${rawSlug}`);
    }
  }

  if (trackIds.length === 0) {
    throw new Error(`Okänd bana i länken: ${rawSlug}`);
  }

  return {
    venueSlug: slug,
    trackIds,
    displayName: names.join(' / '),
    isMultiTrack: trackIds.length > 1,
  };
}

export function venueMatchesGameTracks(venue: GameVenue, gameTracks: number[] | undefined): boolean {
  if (!gameTracks?.length) {
    return !venue.isMultiTrack;
  }
  if (gameTracks.length !== venue.trackIds.length) return false;
  const trackSet = new Set(gameTracks);
  return venue.trackIds.every((id) => trackSet.has(id));
}

export function venueFromTrackIds(trackIds: number[]): GameVenue {
  const slugs: string[] = [];
  const names: string[] = [];
  for (const id of trackIds) {
    const slug = getTrackSlugById(id);
    if (!slug) continue;
    slugs.push(slug);
    names.push(TRACK_DISPLAY_NAMES[slug] ?? slug);
  }
  if (slugs.length === 0) {
    return {
      venueSlug: trackIds.join('-'),
      trackIds: [...trackIds],
      displayName: trackIds.map(String).join(' / '),
      isMultiTrack: trackIds.length > 1,
    };
  }
  return {
    venueSlug: slugs.join('-'),
    trackIds: [...trackIds],
    displayName: names.join(' / '),
    isMultiTrack: trackIds.length > 1,
  };
}

/** När länken bara nämner en bana men ATG-spelet är multibana (t.ex. V4 Halmstad + Bjerke). */
export function alignVenueWithCalendarGame(urlVenue: GameVenue, game: CalendarGameRef): GameVenue {
  const gameTracks = game.tracks;
  if (!gameTracks?.length) return urlVenue;
  if (venueMatchesGameTracks(urlVenue, gameTracks)) return urlVenue;
  if (!urlVenue.isMultiTrack && gameTracks.includes(urlVenue.trackIds[0]!)) {
    return venueFromTrackIds(gameTracks);
  }
  return urlVenue;
}

export function findCalendarGameForVenue(
  games: CalendarGameRef[],
  venue: GameVenue,
): CalendarGameRef | undefined {
  const byTracks = games.find((game) => venueMatchesGameTracks(venue, game.tracks));
  if (byTracks) return byTracks;

  if (!venue.isMultiTrack) {
    const trackId = venue.trackIds[0];

    const singleTrackGames = games.filter(
      (g) => g.tracks?.length === 1 && g.tracks[0] === trackId,
    );
    if (singleTrackGames.length === 1) return singleTrackGames[0];
    if (singleTrackGames.length > 1) {
      return (
        singleTrackGames.find((g) => g.id?.includes(`_${trackId}_`)) ?? singleTrackGames[0]
      );
    }

    const multiTrackGames = games.filter(
      (g) => (g.tracks?.length ?? 0) > 1 && g.tracks?.includes(trackId),
    );
    if (multiTrackGames.length === 1) return multiTrackGames[0];
    if (multiTrackGames.length > 1) {
      return multiTrackGames.find((g) => g.id?.includes(`_${trackId}_`)) ?? multiTrackGames[0];
    }

    return games.find((g) => g.id?.includes(`_${trackId}_`));
  }

  return undefined;
}
