import { z } from 'zod';
import { bookDocumentSchema } from './bookSchema';

/**
 * Storing a book — ported from liketrek/trek's book-store.schema.ts.
 *
 * ── Why a version rather than a lock ──────────────────────────────────────
 *
 * Every contributor of a journey can open its book, and several may be
 * editing at once. A lock would mean one person at a time; last-write-wins
 * would mean the second person silently erases the first.
 *
 * So every write carries the version it was made against. The server
 * increments on success and refuses a save whose base version has moved —
 * turning "your work vanished" into "someone else changed this", which the
 * client can actually show. Same shape as an HTTP ETag, same reason.
 */

export const bookSummarySchema = z.object({
  id: z.number().int().positive(),
  journeyId: z.number().int().positive(),
  title: z.string(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  updatedBy: z.number().int().nullable(),
});
export type BookSummary = z.infer<typeof bookSummarySchema>;

export const bookRecordSchema = bookSummarySchema.extend({
  document: bookDocumentSchema,
});
export type BookRecord = z.infer<typeof bookRecordSchema>;

export const bookSaveRequestSchema = z.object({
  title: z.string().max(200).default(''),
  document: bookDocumentSchema,
  /** Omitted only when creating the first book for a journey. */
  baseVersion: z.number().int().nonnegative().optional(),
});
export type BookSaveRequest = z.infer<typeof bookSaveRequestSchema>;
