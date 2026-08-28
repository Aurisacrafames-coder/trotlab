import { useEffect, useState } from 'react';
import type { GameSession } from '../../shared/types';
import { fetchGameRankingExport, type GameRankingExport } from '../api';
import { rankingExportTitle, RANKING_EXPORT_EMAIL, downloadHtmlFile } from '../../shared/rankingExport';

interface RankingExportPanelProps {
  game: GameSession;
}

function openPrintPreview(html: string) {
  const preview = window.open('', '_blank');
  if (!preview) return;
  preview.document.write(html);
  preview.document.close();
  preview.focus();
  preview.onload = () => preview.print();
}

export default function RankingExportPanel({ game }: RankingExportPanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportData, setExportData] = useState<GameRankingExport | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGameRankingExport(game.id)
      .then((data) => {
        if (!cancelled) setExportData(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Kunde inte skapa ranking-export');
          setExportData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, game.id]);

  const title = rankingExportTitle(game);
  const ready = exportData != null && !loading;

  async function handleCopy() {
    if (!exportData) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(exportData.plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kunde inte kopiera — prova att ladda ner HTML istället.');
    }
  }

  function handleEmail() {
    if (!exportData) return;
    const subject = encodeURIComponent(`${exportData.title} — TrotLab ranking`);
    const body = encodeURIComponent(exportData.plainText);
    window.location.href = `mailto:${RANKING_EXPORT_EMAIL}?subject=${subject}&body=${body}`;
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

      {loading && <p className="muted">Bygger ranking med bananalys och gardering…</p>}
      {error && <p className="error">{error}</p>}

      <div className="ranking-export-actions">
        <button
          type="button"
          onClick={() => exportData && downloadHtmlFile(exportData.filename, exportData.html)}
          disabled={!ready}
        >
          Ladda ner HTML
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => exportData && openPrintPreview(exportData.html)}
          disabled={!ready}
        >
          Skriv ut / PDF
        </button>
        <button type="button" className="secondary" onClick={handleEmail} disabled={!ready}>
          Skicka e-post
        </button>
        <button type="button" className="secondary" onClick={handleCopy} disabled={!ready}>
          {copied ? 'Kopierad!' : 'Kopiera text'}
        </button>
      </div>

      <p className="muted ranking-export-hint">
        Exporten byggs på servern med gardering per avdelning från banhistorik.
      </p>

      {exportData && (
        <iframe
          className="ranking-export-preview"
          title={`Ranking ${title}`}
          srcDoc={exportData.html}
          sandbox="allow-same-origin"
        />
      )}
    </div>
  );
}
