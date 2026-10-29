import type { BookDocument } from '../../types/book'

/**
 * Which revision of the book format a document was written by, and what a
 * reader does with one newer than it knows. Ported from liketrek/TREK's
 * shared/src/book/book-schema-rev.ts (same AGPLv3 license).
 *
 * ── Why a revision beside `version` ──────────────────────────────────────
 *
 * `version` is the format itself and stays 1. What grows is the vocabulary
 * inside it — a new element field, a new kind — and an older reader cannot
 * tell those from noise: the server's normalizeBookDocument drops what it
 * cannot read and strips fields it does not know, on purpose, so a damaged
 * book still opens. *Saving* what is left is what must not happen: an old
 * tab, an offline draft or a cached client would write the loss down for
 * everyone. So the document says which revision wrote it; a Studio that
 * meets a newer one opens it read-only, and the server refuses a save from a
 * writer older than the book it would replace.
 *
 * ── When to bump ─────────────────────────────────────────────────────────
 *
 * In the change that adds a field or kind an older reader would lose. Keep
 * it equal to the server's own constant (server/src/services/journeyBook/
 * bookSchemaRev.ts) — a test checks the two agree.
 *
 * - 2 (5.7): layers — `name`, `group`, `hidden` on elements, a spread's `groups`.
 * - 3 (5.7.2): the photo look — `border`, `shadow`, `zoom`, `flipX`, `adjust`, `duotone`, `cutout`.
 * - 4 (5.7.6): paint (`paint`, `backgroundPaint`), cut edges (`edge`, `edgeSize`), the `line` element, and themes (`theme`, `token`, `strokeToken`, `accentToken`, `fontRole`, `backgroundToken`).
 */
export const BOOK_SCHEMA_REV = 4

/** The `code` a refused save carries when the stored book is newer than the writer. */
export const BOOK_SCHEMA_NEWER_CODE = 'book_schema_newer'

/** The revision a document says it was written by; anything else, and every older book, reads as 1. */
export function bookSchemaRev(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 1
  const rev = (raw as { schemaRev?: unknown }).schemaRev
  return typeof rev === 'number' && Number.isInteger(rev) && rev >= 1 ? rev : 1
}

/** Whether a document was written by a newer revision than `readerRev` (this build's by default). */
export function isBookNewerThanReader(raw: unknown, readerRev: number = BOOK_SCHEMA_REV): boolean {
  return bookSchemaRev(raw) > readerRev
}

/** The document as this build saves it: stamped with its revision, unless it already says as much or more. */
export function stampBookSchemaRev<T extends BookDocument>(doc: T, writerRev: number = BOOK_SCHEMA_REV): T {
  return bookSchemaRev(doc) >= writerRev ? doc : { ...doc, schemaRev: writerRev }
}
