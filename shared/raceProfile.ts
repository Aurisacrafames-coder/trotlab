import { analyzeRaceTerms, type RaceTermFlags } from './raceTerms.js';
import { matchTravLeagueClasses } from './travLeagueClasses.js';

export interface RaceProfile {
  flags: RaceTermFlags;
  /** Bucket labels used in historical miss analysis. */
  tags: string[];
  /** Short human-readable lopp profile, e.g. "2140 m · volt · stolopp". */
  summary: string;
}

function divisionTags(raceName: string | null, terms: string[]): string[] {
  const tags = matchTravLeagueClasses(raceName, terms);
  const name = (raceName ?? '').toLowerCase();

  if (/fyraåringslopp|4-åringslopp/i.test(raceName ?? '')) tags.push('Fyraåringslopp');
  if (/femåringslopp|5-åringslopp/i.test(raceName ?? '')) tags.push('Femåringslopp');
  if (/stayer|stayers/i.test(name)) tags.push('Stayerlopp');

  return tags;
}

export function classifyRaceProfile(
  raceName: string | null,
  terms: string[],
  distance: number | null = null,
  startMethod: string | null = null,
): RaceProfile {
  const flags = analyzeRaceTerms(terms);
  const text = terms.join(' ').toLowerCase();
  const tags: string[] = [...divisionTags(raceName, terms)];

  if (flags.mareRace) tags.push('Stolopp');
  if (flags.youngAgeRace === '3') tags.push('3-års lopp');
  if (flags.youngAgeRace === '4') tags.push('4-års lopp');
  if (flags.apprenticeRace) tags.push('Lärlingslopp');
  if (flags.mixedClass) tags.push('Blandade klasser');
  if (flags.earningsRestricted) tags.push('Intjäningskrav');
  if (/\bkallblod\b/.test(text) || /\bkallblod\b/.test((raceName ?? '').toLowerCase())) {
    tags.push('Kallblod');
  }

  const summaryParts: string[] = [];
  if (distance != null) summaryParts.push(`${distance} m`);
  if (startMethod === 'volte') summaryParts.push('volt');
  else if (startMethod === 'auto') summaryParts.push('auto');
  if (raceName) {
    const shortName = raceName.replace(/\s*-\s*.+$/, '').trim();
    if (shortName.length <= 40) summaryParts.push(shortName);
  } else if (tags.length > 0) {
    summaryParts.push(tags[0]);
  }

  return {
    flags,
    tags: [...new Set(tags)],
    summary: summaryParts.join(' · ') || 'Lopp',
  };
}

export function raceProfileTags(raceName: string | null, terms: string[]): string[] {
  return classifyRaceProfile(raceName, terms).tags;
}
