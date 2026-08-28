import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchBulkImportStatus,
  fetchImportProgress,
  fetchKnownTracks,
  importRace,
  startBulkImport,
  type ImportProgress,
} from '../api';
import type { BulkImportStatus, KnownTrack, RaceSession } from '../../shared/types';
import { BULK_IMPORT_LOOKBACK_MONTHS } from '../../shared/types';
import type { ImportGameResult } from '../api';

function isGameDivisionUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || /\/(vinnare|vp|plats)\//i.test(trimmed)) return false;
  return /\/avd\/\d+/i.test(trimmed) || /\/spel\/[^/]+\/\d{4}-\d{2}-\d{2}\/[^/]+\/avd\//i.test(trimmed);
}

export default function ImportPage() {
  const [url, setUrl] = useState('');
  const [importAllLegs, setImportAllLegs] = useState(true);
  const [loading, setLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
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
  const gameDivisionUrl = useMemo(() => isGameDivisionUrl(url), [url]);

  async function handleImport() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setImportProgress(null);

    const importAll = gameDivisionUrl && importAllLegs;
    const progressTimer = importAll
      ? window.setInterval(async () => {
          try {
            const progress = await fetchImportProgress();
            if (progress) setImportProgress(progress);
          } catch {
            // ignore polling errors
          }
        }, 1000)
      : null;

    try {
      if (importAll) {
        const result = await importRace(url.trim(), true) as ImportGameResult;
        if (result.errors.length > 0) {
          setError(
            `Importerade ${result.importedLegs}/${result.totalLegs} avdelningar. ${result.errors.slice(0, 3).join(' · ')}`,
          );
        }
        navigate(`/omgang/${result.gameSession.id}`);
        return;
      }

      const session = await importRace(url.trim(), false) as RaceSession;
      if (session.gameSessionId) {
        navigate(`/omgang/${session.gameSessionId}`);
      } else {
        navigate(`/lopp/${session.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import misslyckades');
    } finally {
      if (progressTimer != null) window.clearInterval(progressTimer);
      setImportProgress(null);
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
        months: BULK_IMPORT_LOOKBACK_MONTHS,
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
          Hämta avslutade lopp från en bana (senaste {BULK_IMPORT_LOOKBACK_MONTHS} månaderna) för att kunna optimera
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
                : `Importera senaste ${BULK_IMPORT_LOOKBACK_MONTHS} månaderna`}
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
          Klistra in en länk till en avdelning (V86, V85, GS75, V64 …) eller ett enstaka lopp
          (vinnarspelet), t.ex.{' '}
          <code>/spel/2026-07-27/vinnare/ostersund/lopp/2</code> eller{' '}
          <code>/spel/2026-08-28/vp/bergsaker/lopp/2</code>.
          För spelomgångar kan du importera alla avdelningar på en gång.
        </p>
        {gameDivisionUrl && (
          <label className="import-all-legs" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input
              type="checkbox"
              checked={importAllLegs}
              onChange={(e) => setImportAllLegs(e.target.checked)}
              disabled={loading}
            />
            <span>Importera alla avdelningar i omgången</span>
          </label>
        )}
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
            {loading
              ? gameDivisionUrl && importAllLegs
                ? 'Hämtar alla avdelningar…'
                : 'Hämtar…'
              : gameDivisionUrl && importAllLegs
                ? 'Importera hela omgången'
                : 'Importera'}
          </button>
        </div>
        {loading && importProgress && (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            {importProgress.phase}
            {importProgress.totalLegs > 0 && (
              <>
                {' '}
                ({Math.max(importProgress.importedLegs, importProgress.currentLeg)}/
                {importProgress.totalLegs})
              </>
            )}
            <br />
            Hela V86-omgången tar oftast 1–3 minuter — hämtar form och statistik per häst från ATG.
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </>
  );
}
