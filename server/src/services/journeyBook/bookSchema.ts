import { z } from 'zod';

/**
 * The TREK Studio book document — what a photo book *is*, independent of how
 * it is edited or rendered.
 *
 * Ported from liketrek/trek's shared/src/book/book.schema.ts (same AGPLv3
 * license). `photo`, `text` and a small `shape` subset (rect/ellipse only —
 * the rest of the decorative shape library lands in a later phase) came
 * first; `image` (a self-contained data: URI, used for auto-layout's route
 * map/elevation profile) was added outside that plan. The travel-specific
 * kinds — `stats`, `places`, `badge`, `icon`, `list`, `map` — are ported
 * here too, each simplified where upstream's own version depends on assets
 * or live rendering this fork doesn't carry (see `bookMapElementSchema`'s
 * own comment for the biggest of those). Extending the discriminated union
 * is additive and does not require a document migration — `version` stays 1.
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

/** Ported from upstream's own shapes.ts decorative library — see the client's shapes.ts for the path data and generator functions. */
export const BOOK_SHAPES = [
  'rect', 'ellipse', 'line', 'triangle',
  'triangle-down', 'diamond', 'parallelogram', 'trapezoid',
  'pentagon', 'hexagon', 'hexagon-flat', 'heptagon', 'octagon',
  'arch', 'half-circle', 'quarter-circle', 'capsule', 'squircle',
  'star-4', 'star-5', 'star-6', 'star-8', 'star-12', 'burst', 'seal', 'sparkle',
  'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-both',
  'chevron-right', 'chevron-left', 'arrow-bent',
  'bubble-round', 'bubble-square', 'bubble-oval', 'bubble-think',
  'heart', 'cloud', 'cloud-puffy', 'drop', 'moon', 'sun',
  'flower-5', 'flower-6', 'leaf', 'cross', 'plus', 'shield', 'gear',
  'ticket', 'wave', 'mountain', 'compass', 'pin',
  'blob-1', 'blob-2', 'blob-3', 'blob-4',
  'banner-ribbon', 'banner-pennant', 'banner-bookmark', 'banner-flag',
] as const;
export type BookShapeId = (typeof BOOK_SHAPES)[number];

/**
 * `sans`, `serif` and `display` are the three original slots upstream keeps
 * for back-compat. `inter`/`garamond`/`playfair`/`bebas` are the fuller
 * font library's remaining four families (client/src/components/Studio/
 * bookFonts.ts), self-hosted via @fontsource rather than a Google Fonts
 * CDN request.
 */
export const BOOK_FONTS_IDS = ['sans', 'serif', 'display', 'inter', 'garamond', 'playfair', 'bebas'] as const;
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

/**
 * Fields several travel elements share — a stat, a country list and a
 * pros/cons list are all "typography plus one accent colour" rather than a
 * bespoke style system each. Mirrors upstream's own `typeset` mixin, minus
 * the `weight`/`textScale` fields this fork doesn't expose a control for
 * yet (text elements don't either — see bookTextElementSchema's own size).
 */
const typeset = {
  font: z.enum(BOOK_FONTS_IDS).default('sans'),
  color: hex.default('#1a1a1a'),
  /** The one colour that carries emphasis — the figure in a stat, the fill of a chip. */
  accent: hex.default('#111111'),
};

export const BOOK_METRICS = ['distance', 'days', 'steps', 'photos', 'countries', 'places', 'furthest', 'elevationGain', 'elevationLoss'] as const;
export type BookMetric = (typeof BOOK_METRICS)[number];

export const bookStatsElementSchema = z.object({
  ...elementBase,
  ...typeset,
  kind: z.literal('stats'),
  /** Which figures, in the order they are drawn. */
  metrics: z.array(z.enum(BOOK_METRICS)).max(7).default(['distance', 'days', 'photos']),
  layout: z.enum(['grid', 'row', 'column']).default('grid'),
  showIcons: z.boolean().default(true),
  units: z.enum(['metric', 'imperial']).default('metric'),
  /**
   * Metric to value, baked in at placement time — same reasoning as
   * `bookImageElement`'s self-contained `src`: a page whose figures update
   * from live trip data every time someone reopens the book is a page that
   * silently disagrees with whatever was actually printed.
   *
   * Filtered rather than typed as an exhaustive record: a stray key from a
   * future metric this build doesn't know about would otherwise fail the
   * whole element instead of just being dropped.
   */
  values: z.record(z.string(), z.number().finite()).default({})
    .transform(v => Object.fromEntries(
      Object.entries(v).filter(([k]) => (BOOK_METRICS as readonly string[]).includes(k)),
    )),
});

export const MAX_BOOK_PLACES = 60;
export const MAX_PLACE_NAME = 80;
export const MAX_PLACE_NOTE = 240;

/**
 * Replaces the earlier `countries` element (an ISO-code list with a flag
 * toggle) — removed rather than kept alongside this one, since the
 * discriminated union's salvage pass (see normalizeBookDocument below)
 * already drops an unreadable element kind without failing the whole
 * document, so an old book that still has one just loses that element on
 * next load. A per-journey place with an optional short note, not tied to
 * a country's political borders.
 */
export const bookPlacesElementSchema = z.object({
  ...elementBase,
  ...typeset,
  kind: z.literal('places'),
  places: z.array(z.object({
    name: z.string().max(MAX_PLACE_NAME),
    note: z.string().max(MAX_PLACE_NOTE).default(''),
  })).max(MAX_BOOK_PLACES).default([]),
  layout: z.enum(['list', 'grid', 'column']).default('list'),
  align: z.enum(['left', 'center', 'right']).default('center'),
});

export const BOOK_BADGES = [
  'flag', 'date', 'day', 'coords', 'country', 'distance', 'weather', 'altitude', 'mood',
] as const;
export type BookBadgeVariant = (typeof BOOK_BADGES)[number];

export const bookBadgeElementSchema = z.object({
  ...elementBase,
  ...typeset,
  kind: z.literal('badge'),
  variant: z.enum(BOOK_BADGES).default('date'),
  /** The resolved value — "13", "48°51'N 2°21'E", "ICELAND". */
  text: z.string().max(200).default(''),
  /** The line under it — a month, a place, a unit. */
  sub: z.string().max(200).default(''),
  /** ISO-3166-1 alpha-2 for a flag/country badge, or the journal's own mood/weather key. */
  code: z.string().max(24).nullable().default(null),
  style: z.enum(['plain', 'chip', 'outline', 'stacked']).default('plain'),
});

export const bookIconElementSchema = z.object({
  ...elementBase,
  kind: z.literal('icon'),
  /** A lucide export name, PascalCase — "Compass", "Plane", "MountainSnow". */
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'expected a lucide icon name').max(60),
  color: hex.default('#111827'),
  /** Against lucide's own 24-unit grid, not millimetres — an icon's weight is not a length. */
  lineWidth: z.number().min(0.25).max(4).default(2),
});

export const MAX_LIST_ITEMS = 60;

/**
 * A journal entry's pros and cons, set as a page — two lists is exactly
 * what a `text` element cannot express: run together as a paragraph they
 * lose the pairing, and run as one column they lose which side each line
 * is on.
 */
export const bookListElementSchema = z.object({
  ...elementBase,
  ...typeset,
  kind: z.literal('list'),
  items: z
    .array(z.object({
      text: z.string().max(400),
      tone: z.enum(['pro', 'con', 'plain']).default('plain'),
    }))
    .max(MAX_LIST_ITEMS)
    .default([]),
  layout: z.enum(['columns', 'stacked']).default('columns'),
  showMarks: z.boolean().default(true),
  proLabel: z.string().max(80).default(''),
  conLabel: z.string().max(80).default(''),
});

/**
 * Simplified from upstream's live vector/raster map (mapTiles.ts,
 * mapSources.ts, countryShapes.ts — pan/zoom state, a bundled country-outline
 * dataset, on-demand tile fetches): a pre-rendered raster snapshot, baked in
 * once (and re-bakeable on demand) the same way auto-layout's route-map
 * image already is. The print export's sandboxed iframe runs no script and
 * fetches nothing at export time regardless (see printSheets.ts), so a
 * "live" map element would still have to fall back to a static image the
 * moment it's printed — this just skips straight to that, and reuses
 * gpxDrawing's already-tested, rate-limited tile renderer instead of a
 * second one.
 */
export const bookMapElementSchema = z.object({
  ...elementBase,
  kind: z.literal('map'),
  src: z.string().max(MAX_IMAGE_SRC_LENGTH).regex(/^data:image\/(png|jpeg|svg\+xml);base64,/, 'expected a data: URI').nullable().default(null),
  fit: z.enum(['cover', 'contain']).default('cover'),
  radius: mm.default(0),
});

export const bookElementSchema = z.discriminatedUnion('kind', [
  bookPhotoElementSchema,
  bookTextElementSchema,
  bookShapeElementSchema,
  bookImageElementSchema,
  bookStatsElementSchema,
  bookPlacesElementSchema,
  bookBadgeElementSchema,
  bookIconElementSchema,
  bookListElementSchema,
  bookMapElementSchema,
]);
export type BookElement = z.infer<typeof bookElementSchema>;
export type BookPhotoElement = z.infer<typeof bookPhotoElementSchema>;
export type BookTextElement = z.infer<typeof bookTextElementSchema>;
export type BookShapeElement = z.infer<typeof bookShapeElementSchema>;
export type BookImageElement = z.infer<typeof bookImageElementSchema>;
export type BookStatsElement = z.infer<typeof bookStatsElementSchema>;
export type BookPlacesElement = z.infer<typeof bookPlacesElementSchema>;
export type BookBadgeElement = z.infer<typeof bookBadgeElementSchema>;
export type BookIconElement = z.infer<typeof bookIconElementSchema>;
export type BookListElement = z.infer<typeof bookListElementSchema>;
export type BookMapElement = z.infer<typeof bookMapElementSchema>;

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
  pageNumbers: z.object({ show: z.boolean().default(false) }).default(() => ({ show: false })),
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
