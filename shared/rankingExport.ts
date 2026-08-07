import type { GameSession, GameSessionLeg } from './types.js';
import { formatGameLegLabel, formatTrackRaceLabel } from './format.js';

const DEFAULT_EMAIL = 'andersper.ek@gmail.com';
const MAILTO_BODY_LIMIT = 1800;

export function rankingExportTitle(game: GameSession): string {
  return `${game.gameType} ${game.trackName} ${game.date}`;
}

export function rankingExportFilename(game: GameSession): string {
  const slug = `${game.gameType}-${game.trackName}-${game.date}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `trotlab-ranking-${slug}.html`;
}

function legHeading(game: GameSession, leg: GameSessionLeg): string {
  return formatGameLegLabel(game.gameType, leg.legNumber, leg.trackRaceNumber);
}

function formatLegPlain(game: GameSession, leg: GameSessionLeg, maxHorses = Infinity): string {
  const lines: string[] = [legHeading(game, leg)];
  const raceLabel = formatTrackRaceLabel(leg.trackRaceNumber);
  if (raceLabel) lines[0] += ` (${raceLabel})`;
  if (leg.raceInfo?.name) lines.push(leg.raceInfo.name);

  const horses = leg.rankedHorses.slice(0, maxHorses);
  horses.forEach((horse) => {
    const watch = horse.isWatched ? ' ★' : '';
    const scratch = horse.scratched ? ' (struken)' : '';
    lines.push(
      `  #${horse.startNumber} ${horse.horseName}${watch}${scratch} — ${horse.trotScore.toFixed(1)}`,
    );
  });

  if (leg.rankedHorses.length > maxHorses) {
    lines.push(`  … +${leg.rankedHorses.length - maxHorses} till (se HTML-version)`);
  }

  return lines.join('\n');
}

export function buildRankingPlainText(game: GameSession, maxHorsesPerLeg = Infinity): string {
  const header = [
    rankingExportTitle(game),
    `${game.legCount} avdelningar · TrotLab ranking`,
    game.tipSubmittedAt ? `Tips låst: ${game.tipSubmittedAt}` : '',
    '',
  ].filter(Boolean);

  const legs = game.legs.map((leg) => formatLegPlain(game, leg, maxHorsesPerLeg));
  return [...header, ...legs].join('\n\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function legTableHtml(game: GameSession, leg: GameSessionLeg): string {
  const spike = game.suggestedSpikes.find((s) => s.legId === leg.id);
  const rows = leg.rankedHorses
    .map((horse, index) => {
      const rowClass = [
        index === 0 && !horse.scratched ? 'rank-top' : '',
        horse.scratched ? 'rank-scratched' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<tr class="${rowClass}">
        <td class="col-num">#${horse.startNumber}</td>
        <td class="col-horse">${escapeHtml(horse.horseName)}${horse.isWatched ? ' <span class="watch">★</span>' : ''}${horse.scratched ? ' <span class="muted">struken</span>' : ''}</td>
        <td class="col-score">${horse.trotScore.toFixed(1)}</td>
      </tr>`;
    })
    .join('\n');

  const meta: string[] = [];
  if (leg.raceInfo?.name) meta.push(escapeHtml(leg.raceInfo.name));
  if (leg.raceInfo?.scheduledStartTime) {
    const start = new Date(leg.raceInfo.scheduledStartTime.replace(' ', 'T'));
    if (!Number.isNaN(start.getTime())) {
      meta.push(start.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }));
    }
  }
  if (spike) meta.push(`Spik ${spike.rank}`);

  return `<section class="leg">
    <header class="leg-header">
      <h2>${escapeHtml(legHeading(game, leg))}</h2>
      ${meta.length > 0 ? `<p class="leg-meta">${meta.join(' · ')}</p>` : ''}
    </header>
    <table>
      <thead>
        <tr>
          <th>Nr</th>
          <th>Häst</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </section>`;
}

export function buildRankingHtmlDocument(game: GameSession): string {
  const title = rankingExportTitle(game);
  const legs = game.legs.map((leg) => legTableHtml(game, leg)).join('\n');
  const exportedAt = new Date().toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' });

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — TrotLab ranking</title>
  <style>
    :root {
      --ink: #0f172a;
      --muted: #64748b;
      --line: #e2e8f0;
      --accent: #2563eb;
      --accent-soft: #eff6ff;
      --top: #15803d;
      --top-bg: #f0fdf4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: var(--ink);
      background: #f8fafc;
      line-height: 1.45;
    }
    .page {
      max-width: 720px;
      margin: 0 auto;
      padding: 2rem 1.25rem 3rem;
    }
    .hero {
      background: linear-gradient(135deg, #1e3a8a, #2563eb);
      color: #fff;
      border-radius: 16px;
      padding: 1.5rem 1.75rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 10px 30px rgba(37, 99, 235, 0.18);
    }
    .hero-kicker {
      margin: 0 0 0.35rem;
      font-size: 0.82rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.85;
    }
    .hero h1 {
      margin: 0;
      font-size: 1.75rem;
      letter-spacing: -0.03em;
    }
    .hero-sub {
      margin: 0.65rem 0 0;
      opacity: 0.92;
    }
    .leg {
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
    }
    .leg-header {
      padding: 1rem 1.1rem 0.75rem;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .leg-header h2 {
      margin: 0;
      font-size: 1.05rem;
    }
    .leg-meta {
      margin: 0.35rem 0 0;
      color: var(--muted);
      font-size: 0.92rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 0.62rem 0.85rem;
      text-align: left;
      border-bottom: 1px solid var(--line);
    }
    th {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      background: #f8fafc;
    }
    tr:last-child td { border-bottom: none; }
    .col-num { width: 4rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .col-score { width: 4.5rem; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    .rank-top { background: var(--top-bg); }
    .rank-top .col-score { color: var(--top); }
    .rank-scratched { opacity: 0.55; }
    .watch { color: #ca8a04; }
    .muted { color: var(--muted); font-size: 0.88rem; }
    .footer {
      margin-top: 1.5rem;
      text-align: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
    @media print {
      body { background: #fff; }
      .page { max-width: none; padding: 0; }
      .hero { box-shadow: none; }
      .leg { break-inside: avoid; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <p class="hero-kicker">TrotLab ranking</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="hero-sub">${game.legCount} avdelningar${game.tipSubmittedAt ? ' · Tips låst' : ''}</p>
    </header>
    ${legs}
    <p class="footer">Exporterad ${escapeHtml(exportedAt)} · TrotLab</p>
  </div>
</body>
</html>`;
}

export function buildRankingEmailBody(game: GameSession): string {
  let body = buildRankingPlainText(game);
  if (body.length <= MAILTO_BODY_LIMIT) return body;

  body = buildRankingPlainText(game, 5);
  if (body.length <= MAILTO_BODY_LIMIT) {
    return `${body}\n\n(Full ranking med alla hästar — ladda ner HTML-filen från TrotLab och bifoga i mailet.)`;
  }

  return `${rankingExportTitle(game)}\n\nRankingen är för lång för e-posttext. Ladda ner HTML-filen från TrotLab och bifoga den i mailet till ${DEFAULT_EMAIL}.`;
}

export function buildRankingMailtoUrl(game: GameSession, email = DEFAULT_EMAIL): string {
  const subject = encodeURIComponent(`${rankingExportTitle(game)} — TrotLab ranking`);
  const body = encodeURIComponent(buildRankingEmailBody(game));
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export function downloadRankingHtml(game: GameSession): void {
  const html = buildRankingHtmlDocument(game);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = rankingExportFilename(game);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openRankingPrintPreview(game: GameSession): void {
  const html = buildRankingHtmlDocument(game);
  const preview = window.open('', '_blank');
  if (!preview) return;
  preview.document.write(html);
  preview.document.close();
  preview.focus();
  preview.onload = () => preview.print();
}

export { DEFAULT_EMAIL as RANKING_EXPORT_EMAIL };
