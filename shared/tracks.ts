export const TRACK_SLUGS: Record<string, number> = {
  solvalla: 5,
  aby: 6,
  jagersro: 7,
  axevalla: 8,
  bergsaker: 9,
  boden: 11,
  dannero: 13,
  eskilstuna: 14,
  farjestad: 15,
  gavle: 16,
  halmstad: 17,
  kalmar: 18,
  lindesberg: 21,
  mantorp: 22,
  romme: 23,
  raby: 24,
  skelleftea: 25,
  visby: 28,
  tingsryd: 46,
  amal: 29,
  arjang: 31,
  orebro: 32,
  ostersund: 33,
  ovrevoll: 83,
  nykobing: 54,
  'goteborg-galopp': 45,
  'goteborg-trav': 47,
};

export const TRACK_DISPLAY_NAMES: Record<string, string> = {
  solvalla: 'Solvalla',
  aby: 'Åby',
  jagersro: 'Jägersro',
  axevalla: 'Axevalla',
  bergsaker: 'Bergsåker',
  boden: 'Boden',
  dannero: 'Dannero',
  eskilstuna: 'Eskilstuna',
  farjestad: 'Färjestad',
  gavle: 'Gävle',
  halmstad: 'Halmstad',
  kalmar: 'Kalmar',
  lindesberg: 'Lindesberg',
  mantorp: 'Mantorp',
  romme: 'Romme',
  raby: 'Rättvik',
  skelleftea: 'Skellefteå',
  visby: 'Visby',
  tingsryd: 'Tingsryd',
  amal: 'Åmål',
  arjang: 'Arjang',
  orebro: 'Örebro',
  ostersund: 'Östersund',
  ovrevoll: 'Ovrevoll',
  nykobing: 'Nyköping',
  'goteborg-galopp': 'Göteborg Galopp',
  'goteborg-trav': 'Göteborg Trav',
};

export function getTrackSlugById(atgTrackId: number): string | null {
  for (const [slug, id] of Object.entries(TRACK_SLUGS)) {
    if (id === atgTrackId) return slug;
  }
  return null;
}

export function knownTrackNameById(atgTrackId: number): string | null {
  const slug = getTrackSlugById(atgTrackId);
  if (!slug) return null;
  return TRACK_DISPLAY_NAMES[slug] ?? slug;
}
