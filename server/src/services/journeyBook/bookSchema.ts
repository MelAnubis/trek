import { z } from 'zod';

/**
 * The TREK Studio book document — what a photo book *is*, independent of how
 * it is edited or rendered.
 *
 * Ported from liketrek/trek's shared/src/book/book.schema.ts (same AGPLv3
 * license), trimmed to what Phase 1 needs: `photo`, `text` and a small
 * `shape` subset (rect/ellipse only — the rest of the decorative shape
 * library, plus `stats`/`countries`/`badge`/`icon`/`list`, land in later
 * phases). `image` (a self-contained data: URI, used for auto-layout's
 * route map/elevation profile) was added outside that plan — see its own
 * comment for why it doesn't need upstream's live `map` element kind.
 * Extending the discriminated union later is additive and does not require
 * a document migration — `version` stays 1.
 *
 * Two decisions carry the rest of the format (kept from upstream):
 *
 * 1. Everything geometric is in millimetres, not pixels — a pixel means
 *    nothing to a print shop. CSS maps mm onto in/pt with a fixed ratio, so
 *    the editor can render at `transform: scale()` and the print renderer at
 *    1:1 and land on the same page.
 * 2. The paint order is the array order. `elements[0]` is at the back — no
 *    `zIndex` field that could disagree with itself.
 */

const mm = z.number().finite().min(-10000).max(10000).transform(v => Math.round(v * 100) / 100);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

export const MAX_SPREADS = 150;
export const MAX_BOOK_TITLE = 200;
export const MAX_TEXT_LENGTH = 8000;
export const MAX_SPREAD_ELEMENTS = 90;

/** Phase 1 subset. The full BOOK_SHAPES decorative library arrives in Phase 2. */
export const BOOK_SHAPES = ['rect', 'ellipse'] as const;
export type BookShapeId = (typeof BOOK_SHAPES)[number];

/**
 * `sans`, `serif` and `display` are the three original slots upstream keeps
 * for back-compat — we start with just those three; the extra named families
 * (Inter, Garamond, Playfair, Bebas) arrive with the font library in a later
 * phase.
 */
export const BOOK_FONTS_IDS = ['sans', 'serif', 'display'] as const;
export type BookFontFamily = (typeof BOOK_FONTS_IDS)[number];

export const bookFrameSchema = z.object({
  x: mm,
  y: mm,
  w: mm.refine(v => v > 0, 'width must be positive'),
  h: mm.refine(v => v > 0, 'height must be positive'),
});
export type BookFrame = z.infer<typeof bookFrameSchema>;

const elementBase = {
  id: z.string().min(1),
  frame: bookFrameSchema,
  rotation: z.number().finite().default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
};

export const bookPhotoElementSchema = z.object({
  ...elementBase,
  kind: z.literal('photo'),
  /** `trek_photos.id` — never a resolved URL, so the document survives a provider change. */
  photoId: z.number().int().positive().nullable().default(null),
  fit: z.enum(['cover', 'contain']).default('cover'),
  focalX: z.number().min(0).max(1).default(0.5),
  focalY: z.number().min(0).max(1).default(0.5),
  radius: mm.default(0),
  filter: z.enum(['none', 'bw', 'warm', 'cool', 'fade', 'contrast']).default('none'),
  frameStyle: z.enum(['none', 'polaroid', 'white', 'shadow', 'film', 'tape']).default('none'),
  /** Cut the picture to a shape. Null is the plain rectangle every photo starts as. */
  mask: z.enum(BOOK_SHAPES).nullable().default(null),
});

export const bookTextElementSchema = z.object({
  ...elementBase,
  kind: z.literal('text'),
  text: z.string().max(MAX_TEXT_LENGTH).default(''),
  font: z.enum(BOOK_FONTS_IDS).default('sans'),
  size: z.number().min(4).max(200).default(11),
  weight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).default(400),
  italic: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  leading: z.number().min(0.7).max(3).default(1.45),
  tracking: z.number().min(-0.2).max(1).default(0),
  color: hex.default('#1a1a1a'),
  binding: z
    .object({
      source: z.enum(['journey.title', 'journey.subtitle', 'entry.title', 'entry.story', 'entry.location', 'entry.date', 'photo.caption']),
      entryId: z.number().int().optional(),
      photoId: z.number().int().optional(),
      format: z.enum(['dms', 'decimal']).optional(),
      value: z.string().max(200).optional(),
    })
    .nullable()
    .default(null),
  overridden: z.boolean().default(false),
});

export const bookShapeElementSchema = z.object({
  ...elementBase,
  kind: z.literal('shape'),
  shape: z.enum(BOOK_SHAPES).default('rect'),
  fill: hex.nullable().default('#111827'),
  gradient: z.enum(['none', 'up', 'down']).default('none'),
  stroke: hex.nullable().default(null),
  strokeWidth: mm.default(0),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  radius: mm.default(0),
});

/** Max length of an `image` element's data: URI — generous enough for a
 *  reasonable-quality route map PNG (gpxDrawing's default canvas size),
 *  bounded so a handful of oversized images per spread can't blow up the
 *  document (MAX_SPREAD_ELEMENTS × MAX_IMAGE_SRC_LENGTH is the real cap). */
export const MAX_IMAGE_SRC_LENGTH = 2_000_000;

export const bookImageElementSchema = z.object({
  ...elementBase,
  kind: z.literal('image'),
  /** Self-contained by design — see the client type's comment on why (the print export's sandboxed iframe runs no scripts, so a live-fetched image can't work there). */
  src: z.string().max(MAX_IMAGE_SRC_LENGTH).regex(/^data:image\/(png|jpeg|svg\+xml);base64,/, 'expected a data: URI'),
  fit: z.enum(['cover', 'contain']).default('cover'),
  radius: mm.default(0),
});

export const bookElementSchema = z.discriminatedUnion('kind', [
  bookPhotoElementSchema,
  bookTextElementSchema,
  bookShapeElementSchema,
  bookImageElementSchema,
]);
export type BookElement = z.infer<typeof bookElementSchema>;
export type BookPhotoElement = z.infer<typeof bookPhotoElementSchema>;
export type BookTextElement = z.infer<typeof bookTextElementSchema>;
export type BookShapeElement = z.infer<typeof bookShapeElementSchema>;
export type BookImageElement = z.infer<typeof bookImageElementSchema>;

export const bookSpreadSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['cover', 'back', 'inner']).default('inner'),
  background: hex.nullable().default(null),
  elements: z.array(bookElementSchema).max(MAX_SPREAD_ELEMENTS).default([]),
  parked: z.array(bookElementSchema).max(MAX_SPREAD_ELEMENTS).default([]),
  entryId: z.number().int().nullable().default(null),
});
export type BookSpread = z.infer<typeof bookSpreadSchema>;

export const bookPageSetupSchema = z.object({
  preset: z.enum(['square-210', 'square-300', 'a4-landscape', 'a4-portrait', 'a5-landscape', 'custom']).default('square-210'),
  pageWidth: mm.refine(v => v > 0, 'page width must be positive').catch(210).default(210),
  pageHeight: mm.refine(v => v > 0, 'page height must be positive').catch(210).default(210),
  bleed: mm.refine(v => v >= 0, 'bleed cannot be negative').catch(3).default(3),
  safe: mm.refine(v => v >= 0, 'safe margin cannot be negative').catch(5).default(5),
});
export type BookPageSetup = z.infer<typeof bookPageSetupSchema>;

export const bookDocumentSchema = z.object({
  /** In the document, not in a column: a format bump must not need a migration. */
  version: z.literal(1).catch(1).default(1),
  title: z.string().max(MAX_BOOK_TITLE).default(''),
  page: bookPageSetupSchema.default(() => bookPageSetupSchema.parse({})),
  spreads: z.array(bookSpreadSchema).max(MAX_SPREADS).default([]),
});
export type BookDocument = z.infer<typeof bookDocumentSchema>;

/**
 * Read a stored document without ever throwing.
 *
 * A book that cannot be parsed must still open — an editor that refuses to
 * load someone's work because one field drifted is worse than one that drops
 * the field. Tried whole first; on failure, retried with any element that
 * fails the union stripped out (so one bad decoration doesn't take the whole
 * book down); only a document that fails even then falls back to empty.
 */
export function normalizeBookDocument(raw: unknown): BookDocument {
  const parsed = bookDocumentSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const salvaged = bookDocumentSchema.safeParse(withoutUnreadableElements(raw));
  if (salvaged.success) return salvaged.data;

  return bookDocumentSchema.parse({});
}

function withoutUnreadableElements(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const doc = raw as { spreads?: unknown };
  if (!Array.isArray(doc.spreads)) return raw;

  const readable = (list: unknown) =>
    (Array.isArray(list)
      ? list.filter(el => bookElementSchema.safeParse(el).success).slice(0, MAX_SPREAD_ELEMENTS)
      : list);

  return {
    ...doc,
    spreads: doc.spreads.map(sp => {
      if (!sp || typeof sp !== 'object') return sp;
      const spread = sp as { elements?: unknown; parked?: unknown };
      return { ...spread, elements: readable(spread.elements), parked: readable(spread.parked) };
    }),
  };
}
