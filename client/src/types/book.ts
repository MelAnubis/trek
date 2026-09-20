/**
 * TREK Studio book document — plain-TS mirror of the server's zod schema
 * (server/src/services/journeyBook/bookSchema.ts, itself ported from
 * liketrek/trek's shared/src/book/book.schema.ts).
 *
 * No zod here: the server is the validation boundary (it normalizes on every
 * read and write), so the client only needs the shapes to type against.
 * Keep this in sync with the server schema by hand.
 */

export type BookShapeId = 'rect' | 'ellipse';
export type BookFontFamily = 'sans' | 'serif' | 'display';

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
}

export interface BookPhotoElement extends BookElementBase {
  kind: 'photo';
  photoId: number | null;
  fit: 'cover' | 'contain';
  focalX: number;
  focalY: number;
  radius: number;
  filter: 'none' | 'bw' | 'warm' | 'cool' | 'fade' | 'contrast';
  frameStyle: 'none' | 'polaroid' | 'white' | 'shadow' | 'film' | 'tape';
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
  weight: 400 | 500 | 600 | 700;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  leading: number;
  tracking: number;
  color: string;
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

export const BOOK_METRICS = ['distance', 'days', 'steps', 'photos', 'countries', 'places', 'furthest'] as const;
export type BookMetric = (typeof BOOK_METRICS)[number];

export interface BookStatsElement extends BookElementBase, BookTypeset {
  kind: 'stats';
  metrics: BookMetric[];
  layout: 'grid' | 'row' | 'column';
  showIcons: boolean;
  units: 'metric' | 'imperial';
  values: Partial<Record<BookMetric, number>>;
}

export interface BookCountriesElement extends BookElementBase, BookTypeset {
  kind: 'countries';
  /** ISO-3166-1 alpha-2, in visit order. */
  codes: string[];
  /** Names as resolved when placed (Intl.DisplayNames) — the page does not depend on a lookup at render time. */
  names: string[];
  layout: 'list' | 'grid' | 'column';
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

export type BookElement =
  | BookPhotoElement | BookTextElement | BookShapeElement | BookImageElement
  | BookStatsElement | BookCountriesElement | BookBadgeElement | BookIconElement | BookListElement | BookMapElement;

export interface BookSpread {
  id: string;
  role: 'cover' | 'back' | 'inner';
  background: string | null;
  /** Back to front — elements[0] paints first. */
  elements: BookElement[];
  parked: BookElement[];
  entryId: number | null;
}

export interface BookPageSetup {
  preset: 'square-210' | 'square-300' | 'a4-landscape' | 'a4-portrait' | 'a5-landscape' | 'custom';
  pageWidth: number;
  pageHeight: number;
  bleed: number;
  safe: number;
  /** Optional — a document saved before this existed just has none, same as no bleed/safe override before those had a default. */
  pageNumbers?: { show: boolean };
}

export interface BookDocument {
  version: 1;
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
  current: BookRecord;
}
