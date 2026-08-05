import { useMemo, useState } from 'react';
import type { GameSession } from '../../shared/types';
import {
  buildRankingHtmlDocument,
  buildRankingMailtoUrl,
  buildRankingPlainText,
  downloadRankingHtml,
  openRankingPrintPreview,
  rankingExportTitle,
  RANKING_EXPORT_EMAIL,
} from '../../shared/rankingExport';

interface RankingExportPanelProps {
  game: GameSession;
}

export default function RankingExportPanel({ game }: RankingExportPanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const html = useMemo(() => buildRankingHtmlDocument(game), [game]);
  const title = rankingExportTitle(game);

  async function handleCopy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(buildRankingPlainText(game));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kunde inte kopiera — prova att ladda ner HTML istället.');
    }
  }

  function handleEmail() {
    window.location.href = buildRankingMailtoUrl(game);
  }

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Exportera ranking
      </button>
    );
  }

  return (
    <div className="ranking-export">
      <div className="ranking-export-toolbar">
        <div>
          <strong>Ranking — {title}</strong>
          <p className="muted" style={{ margin: '0.25rem 0 0' }}>
            Snygg lista att spara, skriva ut eller skicka till {RANKING_EXPORT_EMAIL}.
          </p>
        </div>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Stäng
        </button>
      </div>

      <div className="ranking-export-actions">
        <button type="button" onClick={() => downloadRankingHtml(game)}>
          Ladda ner HTML
        </button>
        <button type="button" className="secondary" onClick={() => openRankingPrintPreview(game)}>
          Skriv ut / PDF
        </button>
        <button type="button" className="secondary" onClick={handleEmail}>
          Skicka e-post
        </button>
        <button type="button" className="secondary" onClick={handleCopy}>
          {copied ? 'Kopierad!' : 'Kopiera text'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <p className="muted ranking-export-hint">
        Tips: Ladda ner HTML-filen och bifoga den i mailet om du vill skicka hela listan snyggt
        formaterad.
      </p>

      <iframe
        className="ranking-export-preview"
        title={`Ranking ${title}`}
        srcDoc={html}
        sandbox="allow-same-origin"
      />
    </div>
  );
}
