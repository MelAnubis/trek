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
export type BookFontFamily = 'sans' | 'serif' | 'display' | 'inter' | 'garamond' | 'playfair' | 'bebas'
  | 'montserrat' | 'oswald' | 'merriweather' | 'cormorant' | 'caveat' | 'dancing' | 'typewriter' | 'jost';

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
}

export interface BookTextBinding {
  source: 'journey.title' | 'journey.subtitle' | 'entry.title' | 'entry.story' | 'entry.location' | 'entry.date' | 'photo.caption';
  entryId?: number;
  photoId?: number;
  format?: 'dms' | 'decimal';
  value?: string;
}

export interface BookTextElement extends BookElementBase {
  kind: 'text';
  text: string;
  font: BookFontFamily;
  size: number;
  weight: 300 | 400 | 500 | 600 | 700;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  leading: number;
  tracking: number;
  color: string;
  /** Optional — absent on text saved before these existed. */
  effect?: 'none' | 'shadow' | 'outline' | 'highlight';
  highlight?: string;
  uppercase?: boolean;
  binding: BookTextBinding | null;
  overridden: boolean;
}

export interface BookShapeElement extends BookElementBase {
  kind: 'shape';
  shape: BookShapeId;
  fill: string | null;
  gradient: 'none' | 'up' | 'down';
  stroke: string | null;
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  radius: number;
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

export interface BookIconElement extends BookElementBase {
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
  | BookPackingElement | BookAccommodationElement;

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
