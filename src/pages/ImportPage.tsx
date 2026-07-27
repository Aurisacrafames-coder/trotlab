import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchBulkImportStatus,
  fetchKnownTracks,
  importRace,
  startBulkImport,
} from '../api';
import type { BulkImportStatus, KnownTrack } from '../../shared/types';

export default function ImportPage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<KnownTrack[]>([]);
  const [bulkTrackId, setBulkTrackId] = useState<number | ''>('');
  const [bulkStatus, setBulkStatus] = useState<BulkImportStatus | null>(null);
  const [bulkStarting, setBulkStarting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchKnownTracks()
      .then(setTracks)
      .catch(() => setTracks([]));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const status = await fetchBulkImportStatus();
        if (!cancelled) setBulkStatus(status);
      } catch {
        // ignore
      }
    }

    poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectedBulkTrack = tracks.find((t) => t.atgTrackId === bulkTrackId);

  async function handleImport() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const session = await importRace(url.trim());
      if (session.gameSessionId) {
        navigate(`/omgang/${session.gameSessionId}`);
      } else {
        navigate(`/lopp/${session.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import misslyckades');
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkImport() {
    if (!selectedBulkTrack) return;
    setBulkStarting(true);
    setError(null);
    try {
      const status = await startBulkImport({
        atgTrackId: selectedBulkTrack.atgTrackId,
        trackSlug: selectedBulkTrack.slug,
        trackName: selectedBulkTrack.name,
        months: 6,
      });
      setBulkStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk-import misslyckades');
    } finally {
      setBulkStarting(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Importera historik för optimering</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Hämta avslutade lopp från en bana (senaste 6 månaderna) för att kunna optimera
          viktprofilen under Inställningar. Importen körs i bakgrunden och kan ta flera minuter.
        </p>

        <label className="backtest-field">
          <span className="muted">Bana</span>
          <select
            value={bulkTrackId}
            onChange={(e) => setBulkTrackId(e.target.value ? Number(e.target.value) : '')}
            disabled={bulkStatus?.running || bulkStarting}
          >
            <option value="">Välj bana…</option>
            {tracks.map((t) => (
              <option key={t.atgTrackId} value={t.atgTrackId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <div className="backtest-actions" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            onClick={handleBulkImport}
            disabled={!selectedBulkTrack || bulkStatus?.running || bulkStarting}
          >
            {bulkStatus?.running
              ? 'Importerar…'
              : bulkStarting
                ? 'Startar…'
                : 'Importera senaste 6 månaderna'}
          </button>
        </div>

        {bulkStatus && (bulkStatus.running || bulkStatus.message) && (
          <div
            className={`auto-opt-banner${bulkStatus.running ? ' auto-opt-running' : ' auto-opt-done'}`}
            style={{ marginTop: '1rem' }}
          >
            {bulkStatus.running ? (
              <>
                <strong>Importerar {bulkStatus.trackName ?? 'bana'}</strong>
                <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                  {bulkStatus.message}
                </p>
                {bulkStatus.total > 0 && (
                  <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                    {bulkStatus.done}/{bulkStatus.total} avdelningar
                    {bulkStatus.imported > 0 ? ` · ${bulkStatus.imported} nya` : ''}
                  </p>
                )}
              </>
            ) : (
              <>
                <strong>Historikimport</strong>
                <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                  {bulkStatus.message}
                </p>
                {bulkStatus.fromDate && (
                  <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                    Period: {bulkStatus.fromDate} – {bulkStatus.toDate ?? 'idag'}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Importera lopp från ATG</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Klistra in en länk till en avdelning (V86, V85, GS75, V64 …) — t.ex. tisdagens V86 på Jägersro.
          Första importen kan ta några sekunder.
        </p>
        <div className="import-row">
          <input
            type="url"
            placeholder="https://www.atg.se/spel/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleImport()}
            disabled={loading}
          />
          <button onClick={handleImport} disabled={loading || !url.trim()}>
            {loading ? 'Hämtar…' : 'Importera'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
}
