export interface RaceTermFlags {
  mareRace: boolean;
  apprenticeRace: boolean;
  earningsRestricted: boolean;
  mixedClass: boolean;
  /** Homogeneous age group (not "och äldre"). */
  youngAgeRace: '3' | '4' | null;
}

function hasYoungAgeOnly(text: string, age: '3' | '4'): boolean {
  const agePattern = new RegExp(`\\b${age}-åringa?\\b`, 'i');
  if (!agePattern.test(text)) return false;
  const andOlder = new RegExp(`\\b${age}-åringa?\\s+och\\s+äldre\\b`, 'i');
  return !andOlder.test(text);
}

/** Detect when horses from different classes/divisions meet in the same race. */
function detectMixedClass(text: string, terms: string[]): boolean {
  if (/\bklass\s*i\b[^.]{0,40}\bklass\s*ii\b/i.test(text)) return true;
  if (/\bgulddivisionen\b[^.]{0,30}\bmöter\b|\bsilverdivisionen\b[^.]{0,30}\bmöter\b|\bbronsdivisionen\b[^.]{0,30}\bmöter\b/i.test(text)) {
    return true;
  }
  if (/(intjänat|förvärvad)[^.]{0,80}\blägst\b[^.]{0,40}\d[^.]{0,40}\bhögst\b/i.test(text)) {
    return true;
  }

  const firstTerm = (terms[0] ?? '').toLowerCase();
  const openClassHints =
    /\blägst\b[^.]{0,30}\d[\d\s.]*kr[^.]{0,30}\bhögst\b|\bhögst\b[^.]{0,30}\d[\d\s.]*kr[^.]{0,30}\blägst\b/;
  if (openClassHints.test(firstTerm)) return true;

  return false;
}

export function analyzeRaceTerms(terms: string[]): RaceTermFlags {
  const text = terms.join(' ').toLowerCase();
  const firstTerm = (terms[0] ?? '').toLowerCase();

  let youngAgeRace: '3' | '4' | null = null;
  if (hasYoungAgeOnly(firstTerm, '4') || hasYoungAgeOnly(text, '4')) youngAgeRace = '4';
  else if (hasYoungAgeOnly(firstTerm, '3') || hasYoungAgeOnly(text, '3')) youngAgeRace = '3';

  const earningsRestricted =
    /intjänat|förvärvad|förvärvade pengar/.test(firstTerm) &&
    /\blägst\b|\bhögst\b/.test(firstTerm);

  return {
    mareRace: /\bston\b|stolopp|\bsto\b|fillies|\bmares\b/.test(text) && !/oavsett kön|hingstar och ston/.test(text),
    apprenticeRace: /lärling|lärlingslopp/.test(text),
    earningsRestricted,
    mixedClass: detectMixedClass(text, terms),
    youngAgeRace,
  };
}
