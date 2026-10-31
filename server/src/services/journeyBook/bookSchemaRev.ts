/**
 * Which revision of the book format a document was written by — the server
 * half of liketrek/TREK's shared/src/book/book-schema-rev.ts (same AGPLv3
 * license). See the client's components/Studio/bookSchemaRev.ts for the why;
 * the two constants must stay equal (a client test checks it).
 *
 * - 2 (5.7): layers — `name`, `group`, `hidden` on elements, a spread's `groups`.
 * - 3 (5.7.2): the photo look — `border`, `shadow`, `zoom`, `flipX`, `adjust`, `duotone`, `cutout`.
 * - 6 (5.7.12): the book's own layouts (`layouts`).
 * - 5 (5.7.10): the sticker element, text effects (`transform`, `vAlign`, `outline`, `shadow`, `highlight` as a band, `curve`, `fillPaint`, `fit`, `fitMax`), weights 100–900, the rest of the font catalogue and the second shelf of shapes.
 * - 4 (5.7.6): paint (`paint`, `backgroundPaint`), cut edges (`edge`, `edgeSize`), the `line` element, and themes (`theme`, `token`, `strokeToken`, `accentToken`, `fontRole`, `backgroundToken`).
 */
export const BOOK_SCHEMA_REV = 6;

/** The `code` a refused save carries in its body when the book is newer than the writer (or this server). */
export const BOOK_SCHEMA_NEWER_CODE = 'book_schema_newer';

/**
 * The revision a document says it was written by, read from the raw value
 * rather than the parsed one. Anything that is not a whole number from 1 up,
 * and every document from before the field, reads as 1.
 */
export function bookSchemaRev(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 1;
  const rev = (raw as { schemaRev?: unknown }).schemaRev;
  return typeof rev === 'number' && Number.isInteger(rev) && rev >= 1 ? rev : 1;
}
