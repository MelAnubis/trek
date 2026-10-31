/**
 * TREK Studio book document — plain-TS mirror of the server's zod schema
 * (server/src/services/journeyBook/bookSchema.ts, itself ported from
 * liketrek/trek's shared/src/book/book.schema.ts).
 *
 * No zod here: the server is the validation boundary (it normalizes on every
 * read and write), so the client only needs the shapes to type against.
 * Keep this in sync with the server schema by hand.
 */

/** Mirrors the server's own BOOK_SHAPES — see shapes.ts for the path data. */
/** The second shelf of shapes (5.7.10); components/Studio/shapes-more.ts draws them. */
export const BOOK_SHAPES_MORE = [
  // Arches, the frames a Mediterranean page is built from.
  'arch-tall',
  'arch-pointed',
  'arch-double',
  'arch-half',
  'arch-rainbow',

  // Paper cut-outs: leaves, coral and weed, wonky stars and suns.
  'leaf-palm',
  'leaf-oak',
  'leaf-long',
  'leaf-monstera',
  'coral-1',
  'coral-2',
  'seaweed',
  'star-organic',
  'sun-cutout',
  'organic-1',
  'organic-2',
  'organic-3',

  // Stamps, badges and the things a travel scrapbook is stuck with.
  'stamp-rect',
  'stamp-circle',
  'postmark',
  'rosette',
  'scallop-circle',
  'badge-shield',
  'label-tab',
  'ticket-stub',
  'sunburst-12',
  'sunburst-24',

  // Ribbons and bands.
  'ribbon-ends',
  'ribbon-arc',
  'wavy-band',
  'torn-strip',

  // Speech.
  'bubble-shout',
  'bubble-side',
  'bubble-capsule',

  // Arrows that are drawn rather than ruled.
  'arrow-curve',
  'arrow-circle',
  'arrow-notched',
  'arrow-thin',

  // Hearts and stars.
  'heart-round',
  'heart-pair',
  'star-rounded',
  'star-twinkle',
  'flower-8',

  // Photo frames.
  'frame-notched',
  'frame-chamfer',
  'frame-cushion',

  // Ornaments.
  'flourish-scroll',
  'laurel',
  'fleuron',
  'corner-flourish',
] as const

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
  // 5.7.10: the second shelf (liketrek/TREK's book-shapes-more.ts).
  ...BOOK_SHAPES_MORE,
] as const;
export type BookShapeId = (typeof BOOK_SHAPES)[number];
export type BookFontFamily = 'sans' | 'serif' | 'display' | 'inter' | 'garamond' | 'playfair' | 'bebas'
  | 'montserrat' | 'oswald' | 'merriweather' | 'cormorant' | 'caveat' | 'dancing' | 'typewriter' | 'jost'
  // 5.7.10: the rest of liketrek/TREK's catalogue (book-fonts.data.ts).
  | 'fraunces' | 'dmserif' | 'bodoni' | 'anton' | 'league' | 'shoulders' | 'archivo' | 'shrikhand' | 'alfa' | 'bricolage' | 'abril' | 'pacifico' | 'vibes' | 'sacramento' | 'kaushan' | 'allura' | 'parisienne' | 'satisfy' | 'yellowtail' | 'homemade' | 'marker' | 'mono';

/** A text's weight: the nine CSS weights; a family without one draws the nearest it ships. */
export type BookWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900

export interface BookFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BookElementBase {
  id: string;
  frame: BookFrame;
  rotation: number;
  opacity: number;
  locked: boolean;
  /**
   * Layer fields (schema rev 2, ported from liketrek/TREK's book-groups.ts).
   * All optional and left out when unset, so an element nobody named,
   * grouped or hid stores exactly what it stored before.
   */
  /** What the layers panel calls it — none means "its first words, or its kind". */
  name?: string;
  /** The group it belongs to, an id meaningful only on its own spread. */
  group?: string;
  /** Kept in the layers panel, off the page — on screen and in print. */
  hidden?: boolean;
}

export interface BookPhotoElement extends BookElementBase {
  kind: 'photo';
  photoId: number | null;
  fit: 'cover' | 'contain';
  focalX: number;
  focalY: number;
  radius: number;
  filter: 'none' | 'bw' | 'warm' | 'cool' | 'fade' | 'contrast' | 'sepia' | 'vintage' | 'vivid' | 'matte' | 'noir' | 'golden' | 'dramatic';
  frameStyle: 'none' | 'polaroid' | 'white' | 'shadow' | 'film' | 'tape' | 'thin' | 'double' | 'stamp' | 'corners' | 'vignette';
  mask: BookShapeId | null;
  /*
   * The photo look (schema rev 3, 5.7.2; see photoLook.ts). Each part
   * optional — absent or null is off — so a photo nobody restyled stores
   * exactly what it stored before.
   */
  /** A band inside the frame edge, following the mask. */
  border?: BookPhotoEdge | null;
  /** A hard (unblurred) copy of the outline, offset by dx/dy mm. */
  shadow?: BookPhotoShadow | null;
  /** 1–4× the crop the fit gives, about the focal point. */
  zoom?: number;
  /** Mirrored left to right inside the frame. */
  flipX?: boolean;
  /** Each -1..1, 0 as shot. Drawn as filters, so prints as a raster. */
  adjust?: BookPhotoAdjust | null;
  /** Tones mapped from `dark` to `light`. Prints as a raster. */
  duotone?: BookPhotoDuotone | null;
  /** A die-cut edge grown `width` mm around the shape, behind the picture. */
  cutout?: BookPhotoEdge | null;
  /** A cut edge along the mask or the rectangle (schema rev 4, 5.7.6). */
  edge?: BookEdge;
  /** Millimetres the cut bites in, and the length of one tooth. */
  edgeSize?: number;
}

export interface BookPhotoEdge { width: number; color: string }
export interface BookPhotoShadow { dx: number; dy: number; color: string; alpha: number }
export interface BookPhotoAdjust { brightness?: number; contrast?: number; saturation?: number; warmth?: number }
export interface BookPhotoDuotone { dark: string; light: string }

export interface BookTextBinding {
  source: 'journey.title' | 'journey.subtitle' | 'entry.title' | 'entry.story' | 'entry.location' | 'entry.date' | 'photo.caption';
  entryId?: number;
  photoId?: number;
  format?: 'dms' | 'decimal';
  value?: string;
}

export type BookTextTransform = 'none' | 'upper' | 'lower' | 'smallcaps'
export interface BookTextOutline { color: string; width: number }
export interface BookTextShadow { dx: number; dy: number; color: string; alpha: number }
export interface BookTextBand { color: string; alpha: number; padX: number; padY: number; radius: number }
export interface BookTextCurve { type: 'arc' | 'circle'; bend: number; start: number }
export interface BookTextPhotoFill { type: 'photo'; photoId: number; focalX: number; focalY: number; zoom: number }
/** What fills the letters: a colour (alpha 0 is hollow), a photograph, or a gradient or pattern. */
export type BookTextFill = BookPaint | BookTextPhotoFill

export interface BookTextElement extends BookElementBase, BookThemedColour {
  kind: 'text';
  fontRole?: BookFontSlot;
  text: string;
  font: BookFontFamily;
  size: number;
  weight: BookWeight;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  leading: number;
  tracking: number;
  color: string;
  /** Optional — absent on text saved before these existed. */
  effect?: 'none' | 'shadow' | 'outline' | 'highlight';
  uppercase?: boolean;
  /*
   * Text effects (rev 5, liketrek/TREK's book-text-effects.schema.ts). All
   * optional; null or absent is off. `highlight` is a band behind the words;
   * when `effect` is the old marker it is that marker's colour instead.
   */
  transform?: BookTextTransform;
  vAlign?: 'top' | 'middle' | 'bottom';
  outline?: BookTextOutline | null;
  shadow?: BookTextShadow | null;
  highlight?: BookTextBand | null;
  curve?: BookTextCurve | null;
  fillPaint?: BookTextFill | null;
  fit?: 'none' | 'shrink';
  /** The size a fitted text is set at when its frame holds it: the size chosen. */
  fitMax?: number;
  binding: BookTextBinding | null;
  overridden: boolean;
}

export interface BookShapeElement extends BookElementBase, BookThemedColour {
  kind: 'shape';
  shape: BookShapeId;
  fill: string | null;
  gradient: 'none' | 'up' | 'down';
  stroke: string | null;
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  radius: number;
  /** Gradient, see-through colour or pattern (rev 4, see bookPaint.ts); `fill` holds the colour standing for it. */
  paint?: BookPaint;
  edge?: BookEdge;
  edgeSize?: number;
  strokeToken?: BookColorToken;
}

/*
 * ── Paint (schema rev 4, 5.7.6) — port of liketrek/TREK book-paint.schema.ts ──
 */
export const BOOK_PATTERNS = ['checker', 'gingham', 'stripes', 'pinstripe', 'dots', 'polka', 'zigzag', 'waves', 'grid', 'scales', 'sunburst', 'confetti', 'linen', 'grain'] as const
export type BookPattern = (typeof BOOK_PATTERNS)[number]
export const MAX_PAINT_STOPS = 6
export const PATTERN_SCALE = { min: 0.25, max: 4 } as const
export const RADIAL_RADIUS = { min: 0.05, max: 2 } as const
export interface BookPaintStop { at: number; color: string; alpha?: number }
export type BookPaint =
  | { type: 'solid'; color: string; alpha?: number }
  | { type: 'linear'; angle: number; stops: BookPaintStop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: BookPaintStop[] }
  | { type: 'pattern'; pattern: BookPattern; fg: string; bg: string | null; scale: number; angle: number }
export type BookGradientPaint = Extract<BookPaint, { type: 'linear' | 'radial' }>
export type BookPatternPaint = Extract<BookPaint, { type: 'pattern' }>

/** Cut edges (rev 4) — see shapeOutline.ts. */
export const BOOK_EDGES = ['straight', 'zigzag', 'scallop', 'perforated', 'wavy', 'torn', 'deckle'] as const
export type BookEdge = (typeof BOOK_EDGES)[number]
export const BOOK_EDGE_SIZE = { min: 0.5, max: 30 } as const

/*
 * ── Themes (rev 4) — port of liketrek/TREK book-theme.schema.ts ──
 * Elements keep their real colours and fonts; a link beside them names the
 * palette entry or face slot it came from (bookTheme.ts).
 */
export const BOOK_PALETTE_KEYS = ['paper', 'ink', 'accent', 'accent2', 'accent3'] as const
export type BookPaletteKey = (typeof BOOK_PALETTE_KEYS)[number]
export const BOOK_COLOR_TOKENS = ['paper', 'ink', 'muted', 'accent', 'accent2', 'accent3'] as const
export type BookColorToken = (typeof BOOK_COLOR_TOKENS)[number]
export const BOOK_FONT_SLOTS = ['display', 'heading', 'body', 'script'] as const
export type BookFontSlot = (typeof BOOK_FONT_SLOTS)[number]
export const BOOK_THEME_MOTIFS = ['ephemera', 'landmarks', 'tropical', 'mediterranean', 'sea', 'mountains', 'nordic', 'asia', 'food', 'paper', 'doodles', 'ornaments'] as const
export type BookThemeMotif = (typeof BOOK_THEME_MOTIFS)[number]
export const BOOK_THEME_DECORATIONS = ['none', 'light', 'rich'] as const
export type BookThemeDecoration = (typeof BOOK_THEME_DECORATIONS)[number]
export type BookPalette = Record<BookPaletteKey, string>
export interface BookThemeFont { font: string; weight?: number; italic?: boolean }
export interface BookTheme {
  id: string | null
  palette: BookPalette
  fonts: { display: BookThemeFont; heading: BookThemeFont; body: BookThemeFont; script: BookThemeFont | null }
  motifs: BookThemeMotif[]
  decoration: BookThemeDecoration
  frameStyle: 'none' | 'polaroid' | 'white' | 'shadow' | 'film' | 'tape'
  tilt: number
}
/** The colour link most kinds carry. */
interface BookThemedColour { token?: BookColorToken }

/*
 * ── A drawn line (rev 4) — port of liketrek/TREK book-line.schema.ts ──
 * Points are fractions of the frame (bookLine.ts keeps the two in step).
 */
export const MAX_LINE_POINTS = 32
export const BOOK_LINE_CAPS = ['none', 'arrow', 'open', 'dot', 'bar'] as const
export type BookLineCap = (typeof BOOK_LINE_CAPS)[number]
export const BOOK_LINE_ORNAMENTS = ['none', 'diamond', 'dot', 'star', 'sun', 'heart'] as const
export type BookLineOrnament = (typeof BOOK_LINE_ORNAMENTS)[number]
export interface BookLineElement extends BookElementBase {
  kind: 'line'
  points: { x: number; y: number }[]
  curve: 'straight' | 'smooth'
  stroke: string
  strokeWidth: number
  dash: 'solid' | 'dashed' | 'dotted'
  squiggle: 'none' | 'wave' | 'zigzag'
  startCap: BookLineCap
  endCap: BookLineCap
  wobble: number
  ornament: BookLineOrnament
}

/**
 * A self-contained image — a data: URI, not a reference like `photo`'s
 * `photoId`. Auto-layout's only user today: a day's route map (a raster PNG
 * from gpxDrawing's canvas renderer) or elevation profile (its SVG markup,
 * base64-encoded) baked in once when the book is built. Self-contained on
 * purpose — the print export's sandboxed iframe has no script execution
 * (see printSheets.ts), so anything drawn there must already be a plain
 * `<img src>` the browser can paint without running any code, the same
 * reason `photo` elements switch to a plain URL in print mode.
 */
export interface BookImageElement extends BookElementBase {
  kind: 'image';
  src: string;
  fit: 'cover' | 'contain';
  radius: number;
}

/** Fields several travel elements share — see the server schema's own comment on `typeset`. */
interface BookTypeset {
  font: BookFontFamily;
  color: string;
  accent: string;
  token?: BookColorToken;
  accentToken?: BookColorToken;
  fontRole?: BookFontSlot;
}

export const BOOK_METRICS = ['distance', 'days', 'steps', 'photos', 'countries', 'places', 'furthest', 'elevationGain', 'elevationLoss', 'budget'] as const;
export type BookMetric = (typeof BOOK_METRICS)[number];

export interface BookStatsElement extends BookElementBase, BookTypeset {
  kind: 'stats';
  metrics: BookMetric[];
  layout: 'grid' | 'row' | 'column';
  showIcons: boolean;
  units: 'metric' | 'imperial';
  /** ISO 4217 code for the `budget` metric only — null when the element has no budget figure. */
  currency: string | null;
  values: Partial<Record<BookMetric, number>>;
}

export interface BookPlaceItem {
  name: string;
  note?: string;
}

/**
 * Replaces the earlier `countries` element (removed, not kept alongside
 * this one — see bookSchema.ts's own note on why a straight swap is safe
 * here): a per-journey place, with an optional short note, rather than an
 * ISO-code country list. Auto-fillable from the journey's linked trips'
 * real places (see JourneyStudioPage.tsx's `onGeneratePlaces`), same
 * fetch-then-update pattern the `map` element already uses.
 */
export interface BookPlacesElement extends BookElementBase, BookTypeset {
  kind: 'places';
  places: BookPlaceItem[];
  layout: 'list' | 'grid' | 'column';
  align: 'left' | 'center' | 'right';
}

/** Countries a journey went through, each name over its outline (and optionally its flag) — see the server schema. */
export interface BookCountriesElement extends BookElementBase, BookTypeset {
  kind: 'countries';
  /** ISO-3166-1 alpha-2, in visit order. */
  codes: string[];
  names: string[];
  layout: 'list' | 'grid' | 'column';
  showOutline: boolean;
  showFlag: boolean;
  showName: boolean;
  align: 'left' | 'center' | 'right';
}

export const BOOK_BADGES = [
  'flag', 'date', 'day', 'coords', 'country', 'distance', 'weather', 'altitude', 'mood',
] as const;
export type BookBadgeVariant = (typeof BOOK_BADGES)[number];

export interface BookBadgeElement extends BookElementBase, BookTypeset {
  kind: 'badge';
  variant: BookBadgeVariant;
  text: string;
  sub: string;
  code: string | null;
  style: 'plain' | 'chip' | 'outline' | 'stacked';
}

export interface BookIconElement extends BookElementBase, BookThemedColour {
  kind: 'icon';
  /** A lucide export name, PascalCase — "Compass", "Plane", "MountainSnow". */
  name: string;
  color: string;
  lineWidth: number;
}

export interface BookListItem {
  text: string;
  tone: 'pro' | 'con' | 'plain';
}

export interface BookListElement extends BookElementBase, BookTypeset {
  kind: 'list';
  items: BookListItem[];
  layout: 'columns' | 'stacked';
  showMarks: boolean;
  proLabel: string;
  conLabel: string;
}

/**
 * A pre-rendered raster snapshot rather than upstream's live vector/tile
 * map — see the server schema's own comment for why. `src` is null right
 * after the element is added and before the first render finishes (the
 * inspector's "Regenerate map" is what fills it), the one travel element
 * kind that can legitimately be empty on the page for a moment.
 */
export interface BookMapElement extends BookElementBase {
  kind: 'map';
  src: string | null;
  fit: 'cover' | 'contain';
  radius: number;
}

export interface BookPackingItem {
  name: string;
  category?: string;
  checked?: boolean;
  quantity?: number;
}

/**
 * A trip's packing list (packing_items, per-trip — see packingService.ts),
 * baked in at add time the same way `places` is: a snapshot of what was
 * packed, not a live view that would drift from the book's own printed copy
 * every time someone reopens the trip planner and ticks another box.
 */
export interface BookPackingElement extends BookElementBase, BookTypeset {
  kind: 'packing';
  items: BookPackingItem[];
  groupByCategory: boolean;
  showQuantity: boolean;
  columns: 1 | 2;
}

export interface BookAccommodationItem {
  name: string;
  address?: string;
  checkIn?: string | null;
  checkOut?: string | null;
  confirmation?: string;
}

/**
 * A trip's stays (day_accommodations, joined to their place — see
 * dayService.listAccommodations), same snapshot-at-add-time reasoning as
 * `packing` above.
 */
export interface BookAccommodationElement extends BookElementBase, BookTypeset {
  kind: 'accommodation';
  stays: BookAccommodationItem[];
  showConfirmation: boolean;
  layout: 'list' | 'cards';
}

export type BookElement =
  | BookPhotoElement | BookTextElement | BookShapeElement | BookImageElement
  | BookStatsElement | BookPlacesElement | BookCountriesElement | BookBadgeElement | BookIconElement | BookListElement | BookMapElement
  | BookPackingElement | BookAccommodationElement | BookLineElement | BookStickerElement;

/** An illustration from the sticker library (rev 5, 5.7.10; stickers/catalogue.ts). */
export interface BookStickerElement extends BookElementBase {
  kind: 'sticker'
  stickerId: string
  /** Its colour slots repainted in order; empty for its own colours. */
  colors: string[]
  flipX: boolean
}

/** A group's name; membership lives on the elements' own `group`. */
export interface BookGroup {
  id: string;
  name?: string;
}

export interface BookSpread {
  id: string;
  /** 'inner' is a double spread; 'cover', 'first', 'last' and 'back' are single pages. */
  role: 'cover' | 'first' | 'inner' | 'last' | 'back';
  background: string | null;
  /** Gradient, see-through colour or pattern on the page (rev 4); `background` holds the colour standing for it. */
  backgroundPaint?: BookPaint;
  backgroundToken?: BookColorToken;
  /** Back to front — elements[0] paints first. */
  elements: BookElement[];
  parked: BookElement[];
  entryId: number | null;
  /** Names of the groups on this spread (schema rev 2). Absent when none is named. */
  groups?: BookGroup[];
}

/** Folio settings — mirrors the server's bookPageNumbersSchema. Only `show` is required: a book saved before the rest existed reads as the defaults (see FOLIO_DEFAULTS). */
export interface BookPageNumbers {
  show: boolean;
  startAt?: number;
  position?: 'outer' | 'inner' | 'centre';
  /** Millimetres from the trim edge. */
  margin?: number;
  /** Points. */
  size?: number;
  autoColor?: boolean;
  color?: string;
  font?: BookFontFamily;
}

export interface BookPageSetup {
  preset: 'square-210' | 'square-300' | 'a4-landscape' | 'a4-portrait' | 'a5-landscape' | 'custom';
  pageWidth: number;
  pageHeight: number;
  bleed: number;
  safe: number;
  /** Optional — a document saved before this existed just has none, same as no bleed/safe override before those had a default. */
  pageNumbers?: BookPageNumbers;
}

export interface BookDocument {
  version: 1;
  /**
   * Which revision of the format wrote it — see bookSchemaRev.ts. Absent on
   * every book saved before revisions existed, which reads as 1.
   */
  schemaRev?: number;
  title: string;
  page: BookPageSetup;
  spreads: BookSpread[];
  /** The book's theme (rev 4, bookTheme.ts). */
  theme?: BookTheme;
}

export interface BookSummary {
  id: number;
  journeyId: number;
  title: string;
  version: number;
  updatedAt: string | null;
  updatedBy: number | null;
}

export interface BookRecord extends BookSummary {
  document: BookDocument;
}

export interface BookConflict {
  error: string;
  current?: BookRecord;
  /** 'book_schema_newer' when the stored book was written by a newer Studio. */
  code?: string;
}
