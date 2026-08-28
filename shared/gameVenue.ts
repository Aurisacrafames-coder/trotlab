import { TRACK_DISPLAY_NAMES, TRACK_SLUGS } from './tracks.js';

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
