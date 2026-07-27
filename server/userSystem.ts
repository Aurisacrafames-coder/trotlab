import type Database from 'better-sqlite3';
import type { UserSavedSystem } from '../shared/types.js';

export interface UserSystemLegInput {
  legId: number;
  startNumbers: number[];
}

interface StoredLeg {
  legId: number;
  startNumbers: number[];
}

export function loadUserSystem(
  db: Database.Database,
  gameSessionId: number,
): UserSavedSystem | null {
  const row = db
    .prepare(
      `SELECT legs_json as legsJson, saved_at as savedAt, updated_at as updatedAt
       FROM game_session_user_systems WHERE game_session_id = ?`,
    )
    .get(gameSessionId) as
    | { legsJson: string; savedAt: string; updatedAt: string }
    | undefined;

  if (!row) return null;

  let legs: StoredLeg[];
  try {
    const parsed = JSON.parse(row.legsJson) as unknown;
    if (!Array.isArray(parsed)) return null;
    legs = parsed
      .filter(
        (item): item is StoredLeg =>
          typeof item === 'object' &&
          item != null &&
          typeof (item as StoredLeg).legId === 'number' &&
          Array.isArray((item as StoredLeg).startNumbers),
      )
      .map((item) => ({
        legId: item.legId,
        startNumbers: item.startNumbers.filter((n): n is number => typeof n === 'number'),
      }));
  } catch {
    return null;
  }

  return {
    savedAt: row.savedAt,
    updatedAt: row.updatedAt,
    legs,
  };
}

export function saveUserSystem(
  db: Database.Database,
  gameSessionId: number,
  legs: UserSystemLegInput[],
): UserSavedSystem {
  const normalized = legs.map((leg) => ({
    legId: leg.legId,
    startNumbers: [...new Set(leg.startNumbers)].sort((a, b) => a - b),
  }));

  const legsJson = JSON.stringify(normalized);
  const existing = db
    .prepare('SELECT game_session_id FROM game_session_user_systems WHERE game_session_id = ?')
    .get(gameSessionId);

  if (existing) {
    db.prepare(
      `UPDATE game_session_user_systems
       SET legs_json = ?, updated_at = datetime('now')
       WHERE game_session_id = ?`,
    ).run(legsJson, gameSessionId);
  } else {
    db.prepare(
      `INSERT INTO game_session_user_systems (game_session_id, legs_json, saved_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))`,
    ).run(gameSessionId, legsJson);
  }

  return loadUserSystem(db, gameSessionId)!;
}

export function validateUserSystemLegs(
  db: Database.Database,
  gameSessionId: number,
  legs: UserSystemLegInput[],
): string | null {
  const raceIds = db
    .prepare('SELECT id FROM race_sessions WHERE game_session_id = ? ORDER BY leg_number')
    .all(gameSessionId) as Array<{ id: number }>;

  if (raceIds.length === 0) return 'Omgången har inga avdelningar.';

  const expectedIds = new Set(raceIds.map((r) => r.id));
  const seen = new Set<number>();

  for (const leg of legs) {
    if (!expectedIds.has(leg.legId)) {
      return `Okänd avdelning (id ${leg.legId}).`;
    }
    if (seen.has(leg.legId)) return `Dubbel avdelning (id ${leg.legId}).`;
    seen.add(leg.legId);

    if (!Array.isArray(leg.startNumbers) || leg.startNumbers.length === 0) {
      return 'Minst en häst krävs per avdelning.';
    }

    const entries = db
      .prepare(
        `SELECT start_number as startNumber FROM race_entries
         WHERE session_id = ? AND trot_score IS NOT NULL`,
      )
      .all(leg.legId) as Array<{ startNumber: number }>;

    const validNumbers = new Set(entries.map((e) => e.startNumber));
    for (const num of leg.startNumbers) {
      if (!validNumbers.has(num)) {
        return `Startnummer ${num} finns inte i avdelning ${leg.legId}.`;
      }
    }
  }

  for (const id of expectedIds) {
    if (!seen.has(id)) return 'Alla avdelningar måste ha minst en häst.';
  }

  return null;
}
