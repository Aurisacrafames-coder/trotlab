import type { GameTypeProfile, TrackMissAnalysis } from './types.js';

function goalLabel(goal: TrackMissAnalysis['goal']): string {
  return goal === 'win' ? 'vinstträff' : 'topp 3-träff';
}

function garderingLines(analysis: TrackMissAnalysis): string[] {
  const lines: string[] = [];
  const close = analysis.byWinnerRank.find((b) => b.label === 'Rank 4–5');
  if (close && analysis.misses > 0 && close.misses >= analysis.misses * 0.3) {
    lines.push(
      `Ta med fler hästar på osäkra avdelningar — i ${close.misses} av ${analysis.misses} missar låg vinnaren rank 4–5 i Trot Score (nära miss).`,
    );
  }

  const volte = analysis.byStartMethod.find((b) => b.label === 'Voltstart');
  const auto = analysis.byStartMethod.find((b) => b.label === 'Autostart');
  if (volte && auto && volte.total >= 5 && auto.total >= 5 && (volte.hitRate ?? 0) + 5 < (auto.hitRate ?? 0)) {
    lines.push(
      `Voltstart (${volte.hitRate}% träff) svagare än autostart (${auto.hitRate}%) — gardera extra på volt-avdelningar.`,
    );
  }

  const longDistances = analysis.byDistance.filter(
    (d) => d.label.startsWith('Lång') && d.total >= 5 && (d.hitRate ?? 100) < (analysis.hitRate ?? 100) - 5,
  );
  if (longDistances.length > 0) {
    const worst = longDistances.sort((a, b) => (a.hitRate ?? 0) - (b.hitRate ?? 0))[0];
    lines.push(
      `Längre distanser (${worst.label.toLowerCase()}) har lägre träff (${worst.hitRate}%) — var försiktigare med spikar där.`,
    );
  }

  if (lines.length === 0 && analysis.misses > 0) {
    lines.push('Missarna är spridda — använd rankingens rank 4–5 som garderingskandidater när topp 3 känns jämnt.');
  }

  return lines;
}

function gameTypeSection(
  analysis: TrackMissAnalysis,
  gameType?: string,
): { title: string; lines: string[] } | null {
  if (!gameType) return null;

  const profile = analysis.gameTypeProfiles.find((p) => p.gameType === gameType);
  const overall = analysis.byGameType.find((g) => g.label === gameType);
  if (!profile && !overall) return null;

  const hitRate = profile?.hitRate ?? overall?.hitRate ?? null;
  const total = profile?.total ?? overall?.total ?? 0;
  const hits = profile?.hits ?? overall?.hits ?? 0;
  const misses = profile?.misses ?? overall?.misses ?? 0;
  if (total === 0) return null;

  const lines: string[] = [
    `${hits}/${total} ${goalLabel(analysis.goal)} (${hitRate ?? '—'}%) i importerad ${gameType}-historik på ${analysis.trackName}.`,
    `${misses} missade ${gameType}-avdelningar i historiken.`,
  ];

  if (analysis.hitRate != null && hitRate != null) {
    const diff = analysis.hitRate - hitRate;
    if (diff >= 5) {
      lines.push(
        `${gameType} ligger ${diff.toFixed(1)} procentenheter under banans snitt (${analysis.hitRate}%) — gardera extra i ${gameType}.`,
      );
    } else if (diff <= -5) {
      lines.push(
        `${gameType} har varit starkare än banans snitt (${analysis.hitRate}%) — spik kan fungera när rankingen är tydlig.`,
      );
    } else {
      lines.push(`${gameType} följer banans snitt ungefär.`);
    }
  }

  const otherForms = analysis.byGameType.filter(
    (g) => g.label !== gameType && g.total >= 5 && g.hitRate != null,
  );
  if (otherForms.length > 0 && hitRate != null) {
    const comparison = otherForms
      .map((g) => `${g.label} ${g.hitRate}% (${g.hits}/${g.total})`)
      .join(' · ');
    lines.push(`Övriga spelformer på samma bana: ${comparison}.`);
  }

  if (profile) {
    const volte = profile.byStartMethod.find((b) => b.label === 'Voltstart');
    const auto = profile.byStartMethod.find((b) => b.label === 'Autostart');
    if (volte && auto && volte.total >= 3 && auto.total >= 3 && (volte.hitRate ?? 0) + 5 < (auto.hitRate ?? 0)) {
      lines.push(
        `Inom ${gameType}: voltstart ${volte.hitRate}% (${volte.misses}/${volte.total} missar) vs autostart ${auto.hitRate}% — extra gardering på volt i ${gameType}.`,
      );
    }

    const weakDist = [...profile.byDistance]
      .filter((d) => d.total >= 3)
      .sort((a, b) => (a.hitRate ?? 0) - (b.hitRate ?? 0))[0];
    if (weakDist && hitRate != null && (weakDist.hitRate ?? 100) < hitRate - 5) {
      lines.push(
        `Svagast ${gameType}-träff på ${weakDist.label.toLowerCase()} (${weakDist.hitRate}%, ${weakDist.misses} missar).`,
      );
    }

    const close = profile.byWinnerRank.find((b) => b.label === 'Rank 4–5');
    if (close && profile.misses > 0 && close.misses >= profile.misses * 0.3) {
      lines.push(
        `I ${gameType}-missar ligger vinnaren ofta rank 4–5 (${close.misses} av ${profile.misses} missar) — ta med fler hästar per avdelning.`,
      );
    }

    const far = profile.byWinnerRank.find((b) => b.label === 'Rank 9+');
    if (far && profile.misses > 0 && far.misses >= profile.misses * 0.25) {
      lines.push(
        `${gameType} har ${far.misses} stora missar (vinnare rank 9+) — undvik för snäva garderingar i ${gameType}.`,
      );
    }
  }

  return {
    title: `${gameType} på ${analysis.trackName}`,
    lines,
  };
}

export function buildTrackPrepBriefSections(
  analysis: TrackMissAnalysis,
  gameType?: string,
): { title: string; lines: string[] }[] {
  const sections: { title: string; lines: string[] }[] = [];

  if (analysis.racesWithResult === 0) {
    sections.push({
      title: 'Bananalys',
      lines: [
        `Ingen avslutad historik med resultat på ${analysis.trackName} — importera fler omgångar för bananalys.`,
      ],
    });
    return sections;
  }

  sections.push({
    title: `Bananalys — ${analysis.trackName}`,
    lines: [
      `${analysis.hits}/${analysis.racesWithResult} ${goalLabel(analysis.goal)} (${analysis.hitRate ?? '—'}%).`,
      `${analysis.misses} missade lopp i historiken.`,
      ...analysis.insights,
    ],
  });

  const gameSection = gameTypeSection(analysis, gameType);
  if (gameSection) sections.push(gameSection);

  const gardering = garderingLines(analysis);
  if (gardering.length > 0) {
    sections.push({
      title: 'Gardering inför spel',
      lines: gardering,
    });
  }

  return sections;
}

export function buildTrackPrepBriefText(analysis: TrackMissAnalysis, gameType?: string): string {
  return buildTrackPrepBriefSections(analysis, gameType)
    .map((section) => [section.title, ...section.lines.map((l) => `• ${l}`)].join('\n'))
    .join('\n\n');
}

export function buildTrackPrepBriefHtml(analysis: TrackMissAnalysis, gameType?: string): string {
  const sections = buildTrackPrepBriefSections(analysis, gameType);
  return sections
    .map(
      (section) =>
        `<section class="prep-brief-section"><h2>${escapeHtml(section.title)}</h2><ul>${section.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></section>`,
    )
    .join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function findGameTypeProfile(
  analysis: TrackMissAnalysis,
  gameType: string,
): GameTypeProfile | null {
  return analysis.gameTypeProfiles.find((p) => p.gameType === gameType) ?? null;
}
