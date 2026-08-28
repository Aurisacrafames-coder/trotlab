import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteGameSession, fetchGameRankingExport, fetchGameSessions, fetchStatsSync, syncTrackStats, type GameSessionListItem } from '../api';
import { downloadHtmlFile } from '../../shared/rankingExport';

export default function HomePage() {
  const [games, setGames] = useState<GameSessionListItem[]>([]);
  const [syncStatus, setSyncStatus] = useState<{ lastSyncAt: string | null; running: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    Promise.all([fetchGameSessions(), fetchStatsSync()])
      .then(([g, sync]) => {
        setGames(g);
        setSyncStatus(sync);
      })
      .catch((e) => {
        setError(
          e instanceof Error
            ? e.message
            : 'Kunde inte hämta data — kontrollera att servern kör (npm run dev)',
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleExportRanking(game: GameSessionListItem) {
    setExportingId(game.id);
    setError(null);
    try {
      const data = await fetchGameRankingExport(game.id);
      downloadHtmlFile(data.filename, data.html);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte exportera ranking');
    } finally {
      setExportingId(null);
    }
  }

  async function handleDelete(game: GameSessionListItem) {
    const label = `${game.gameType} ${game.trackName} ${game.date} (${game.legCount} avd)`;
    if (!window.confirm(`Ta bort omgången ${label}? Alla importerade avdelningar raderas.`)) {
      return;
    }

    setDeletingId(game.id);
    setError(null);
    try {
      await deleteGameSession(game.id);
      setGames((prev) => prev.filter((g) => g.id !== game.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort omgången');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSyncStats() {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncTrackStats();
      setSyncStatus(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte synka statistik');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Spelomgångar</h2>
        {syncStatus && (
          <div className="import-row" style={{ marginTop: 0, marginBottom: '0.75rem', alignItems: 'center' }}>
            <p className="muted" style={{ margin: 0 }}>
              ATG-statistik (spår %, kusk %):{' '}
              {syncStatus.running
                ? 'uppdateras…'
                : syncStatus.lastSyncAt
                  ? `senast ${new Date(syncStatus.lastSyncAt.replace(' ', 'T')).toLocaleString('sv-SE')}`
                  : 'inte synkad ännu'}
            </p>
            <button type="button" className="secondary" onClick={handleSyncStats} disabled={syncing || syncStatus.running}>
              {syncing ? 'Synkar…' : 'Synka statistik'}
            </button>
          </div>
        )}
        {!syncStatus && (
          <p className="muted" style={{ marginTop: 0 }}>
            ATG-statistik: laddar…
          </p>
        )}
        {loading && <p className="muted">Laddar…</p>}
        {!loading && games.length === 0 && (
          <p className="muted">
            Inga omgångar ännu.{' '}
            <Link to="/import">Importera från ATG-länk</Link>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <ul className="session-list">
          {games.map((g) => (
            <li key={g.id} className="session-list-item">
              <Link to={`/omgang/${g.id}`} className="session-list-link">
                <span>
                  <span className="badge">{g.gameType}</span> {g.trackName} · {g.date}
                  <span className="muted" style={{ marginLeft: '0.5rem' }}>
                    {g.legCount} avd
                  </span>
                  {g.tipSubmittedAt && (
                    <span className="badge badge-tip">Tips låst</span>
                  )}
                </span>
                <span className="muted">
                  {g.legsWithResults > 0
                    ? `${g.hitsWin}/${g.legsWithResults} träff`
                    : '—'}
                </span>
              </Link>
              <button
                type="button"
                className="secondary session-delete-btn"
                disabled={exportingId === g.id}
                onClick={() => handleExportRanking(g)}
                title="Ladda ner ranking"
              >
                {exportingId === g.id ? '…' : 'Ranking'}
              </button>
              <button
                type="button"
                className="secondary session-delete-btn"
                disabled={deletingId === g.id}
                onClick={() => handleDelete(g)}
                title="Ta bort omgång"
              >
                {deletingId === g.id ? '…' : 'Ta bort'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
