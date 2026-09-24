import { db } from '../db/database';
import { canAccessJourney, canEdit, broadcastJourneyEvent } from './journeyService';
import { normalizeBookDocument, type BookDocument } from './journeyBook/bookSchema';
import type { BookRecord, BookSummary } from './journeyBook/bookStoreSchema';

/**
 * Storing TREK Studio books — ported from liketrek/trek's
 * server/src/nest/journey/journey-book.service.ts (same AGPLv3 license),
 * adapted from NestJS/injected-DatabaseService to this codebase's plain
 * db.prepare() style.
 *
 * ── Access ───────────────────────────────────────────────────────────────
 *
 * A book belongs to its journey, so it inherits the journey's access
 * exactly: every contributor can open it, and only those who may edit the
 * journey may save or delete it. There is no separate book permission.
 *
 * ── Concurrency ──────────────────────────────────────────────────────────
 *
 * Optimistic, on a version column. Every save states the version it was made
 * against; the update only lands if that is still the current one, in one
 * statement so two saves arriving together cannot both decide they are
 * first. The loser is told, and told *with* the current record, so it can
 * show the other version rather than only announcing one exists.
 */

interface BookRow {
  id: number;
  journey_id: number;
  title: string;
  document: string;
  version: number;
  updated_at: string | null;
  updated_by: number | null;
}

function toRecord(row: BookRow): BookRecord {
  return {
    id: row.id,
    journeyId: row.journey_id,
    title: row.title,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    document: normalizeBookDocument(safeParse(row.document)),
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function byId(id: number): BookRecord | null {
  const row = db.prepare(`
    SELECT id, journey_id, title, document, version, updated_at, updated_by
      FROM journey_books WHERE id = ?
  `).get(id) as BookRow | undefined;
  return row ? toRecord(row) : null;
}

/** Null when the journey does not exist or the user cannot reach it. */
function canAccess(journeyId: number, userId: number): boolean {
  return !!canAccessJourney(journeyId, userId);
}

function canWrite(journeyId: number, userId: number): boolean {
  return canEdit(journeyId, userId);
}

/** Whether this user may open the journey's book at all. */
export function canOpenBook(journeyId: number, userId: number): boolean {
  return canAccess(journeyId, userId);
}

export function listBooks(journeyId: number, userId: number): BookSummary[] | null {
  if (!canAccess(journeyId, userId)) return null;
  const rows = db.prepare(`
    SELECT id, journey_id, title, version, updated_at, updated_by
      FROM journey_books
     WHERE journey_id = ?
     ORDER BY updated_at DESC, id DESC
  `).all(journeyId) as Omit<BookRow, 'document'>[];
  return rows.map(r => ({
    id: r.id,
    journeyId: r.journey_id,
    title: r.title,
    version: r.version,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  }));
}

/**
 * The journey's book. One per journey for now — the table allows more,
 * because a second book of the same trip is an obvious thing to want and
 * adding a column later is harder than not needing to.
 */
export function getBook(journeyId: number, userId: number): BookRecord | null {
  if (!canAccess(journeyId, userId)) return null;
  const row = db.prepare(`
    SELECT id, journey_id, title, document, version, updated_at, updated_by
      FROM journey_books
     WHERE journey_id = ?
     ORDER BY id ASC
     LIMIT 1
  `).get(journeyId) as BookRow | undefined;
  return row ? toRecord(row) : null;
}

/**
 * Same lookup as getBook, without the owner/contributor access check — for
 * the public share-link path (journeyShareService.getPublicBook), which
 * gates access by the share token and its own share_book flag instead of
 * journey membership.
 */
export function getBookForPublicShare(journeyId: number): BookRecord | null {
  const row = db.prepare(`
    SELECT id, journey_id, title, document, version, updated_at, updated_by
      FROM journey_books
     WHERE journey_id = ?
     ORDER BY id ASC
     LIMIT 1
  `).get(journeyId) as BookRow | undefined;
  return row ? toRecord(row) : null;
}

/**
 * Create or update, against a version.
 *
 * Returns the saved record, or `{ conflict }` when the base version has
 * moved. A conflict is an ordinary outcome of two people working, not an
 * exception.
 */
export function saveBook(
  journeyId: number,
  userId: number,
  input: { title: string; document: unknown; baseVersion?: number },
): { record: BookRecord } | { conflict: BookRecord } | null {
  if (!canWrite(journeyId, userId)) return null;

  const document = JSON.stringify(normalizeBookDocument(input.document));
  const existing = db.prepare(
    'SELECT id, version FROM journey_books WHERE journey_id = ? ORDER BY id ASC LIMIT 1'
  ).get(journeyId) as { id: number; version: number } | undefined;

  if (!existing) {
    const result = db.prepare(`
      INSERT INTO journey_books (journey_id, title, document, version, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
    `).run(journeyId, input.title, document, userId, userId);
    return { record: byId(Number(result.lastInsertRowid))! };
  }

  /*
   * The version goes in the WHERE clause rather than being checked first.
   * Read-then-write leaves a window between the two in which another save
   * can land — one UPDATE that matches on the version cannot lose that race
   * with itself.
   *
   * A save with no base version is a first write from a client that has not
   * loaded one; it is allowed to take the current version, since refusing it
   * would break "open Studio and start editing" for the second person to
   * arrive.
   */
  const base = input.baseVersion ?? existing.version;
  const result = db.prepare(`
    UPDATE journey_books
       SET title = ?, document = ?, version = version + 1,
           updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND version = ?
  `).run(input.title, document, userId, existing.id, base);

  if (result.changes === 0) {
    return { conflict: byId(existing.id)! };
  }
  return { record: byId(existing.id)! };
}

export function deleteBook(journeyId: number, userId: number): boolean | null {
  if (!canWrite(journeyId, userId)) return null;
  const result = db.prepare('DELETE FROM journey_books WHERE journey_id = ?').run(journeyId);
  return result.changes > 0;
}

/**
 * Tell the other editors the book moved on.
 *
 * The version travels, not the document — everyone with it open needs to
 * know theirs is behind, and can ask for the rest if they want it.
 * Broadcasting the whole document on every autosave would make the
 * notification the size of the thing being edited.
 */
export function broadcastBookSaved(journeyId: number, userId: number, record: BookRecord, socketId?: string) {
  broadcastJourneyEvent(
    journeyId,
    'journey:book:saved',
    { version: record.version, savedBy: userId },
    socketId,
  );
}

/** Empty book: one cover, one inner spread — enough to open Studio into something. */
export function emptyBookDocument(): BookDocument {
  return normalizeBookDocument({
    version: 1,
    title: '',
    page: { preset: 'square-210', pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 },
    spreads: [
      { id: 'cover', role: 'cover', elements: [], parked: [], entryId: null },
      { id: 'spread-1', role: 'inner', elements: [], parked: [], entryId: null },
    ],
  });
}
