export interface TravLeagueClassInfo {
  label: string;
  description: string;
  order: number;
}

/** Svenska Travligan — klasser (STL+). */
export const TRAV_LEAGUE_CLASSES: TravLeagueClassInfo[] = [
  {
    label: 'Gulddivisionen',
    description: 'Den högsta klassen för de absolut bästa, äldre hästarna.',
    order: 1,
  },
  {
    label: 'Silverdivisionen',
    description: 'Klassen direkt under eliten.',
    order: 2,
  },
  {
    label: 'Bronsdivisionen',
    description: 'För hästar som kommit en bra bit på vägen i sina karriärer.',
    order: 3,
  },
  {
    label: 'Klass I',
    description: 'En av grundklasserna för etablerade hästar under utveckling.',
    order: 4,
  },
  {
    label: 'Klass II',
    description: 'Den lägsta ordinarie klassen för unga eller mindre rutinerade hästar.',
    order: 5,
  },
  {
    label: 'Klass III',
    description: 'En nyare instegsklass som tillkom för att bredda underlaget.',
    order: 6,
  },
  {
    label: 'Diamantstoet',
    description: 'En prestigefylld division exklusivt för ston.',
    order: 7,
  },
  {
    label: 'Stodivisionen',
    description: 'Ytterligare en renodlad klass för enbart ston.',
    order: 8,
  },
];

const CLASS_BY_LABEL = new Map(TRAV_LEAGUE_CLASSES.map((c) => [c.label, c]));

function searchText(raceName: string | null, terms: string[]): string {
  return [raceName ?? '', ...terms].join(' ').toLowerCase();
}

/** Match STL+ class labels from loppnamn and ATG terms (several can match). */
export function matchTravLeagueClasses(raceName: string | null, terms: string[]): string[] {
  const text = searchText(raceName, terms);
  const found: string[] = [];

  if (/gulddivision/.test(text)) found.push('Gulddivisionen');
  if (/silverdivision/.test(text)) found.push('Silverdivisionen');
  if (/bronsdivision/.test(text)) found.push('Bronsdivisionen');
  if (/diamantsto/.test(text)) found.push('Diamantstoet');
  if (/stodivision/.test(text)) found.push('Stodivisionen');
  if (/klass\s*iii\b/.test(text)) found.push('Klass III');
  else if (/klass\s*ii\b/.test(text)) found.push('Klass II');
  else if (/klass\s*i\b/.test(text)) found.push('Klass I');

  return found;
}

export function sortTravLeagueClassLabels(labels: string[]): string[] {
  return [...new Set(labels)].sort(
    (a, b) => (CLASS_BY_LABEL.get(a)?.order ?? 99) - (CLASS_BY_LABEL.get(b)?.order ?? 99),
  );
}

export function formatLegTravClassHint(raceName: string | null, terms: string[]): string {
  const labels = sortTravLeagueClassLabels(matchTravLeagueClasses(raceName, terms));
  if (labels.length === 0) return '';
  return labels
    .map((label) => {
      const info = CLASS_BY_LABEL.get(label);
      return info ? `${info.label} — ${info.description}` : label;
    })
    .join(' ');
}
