/* Port of liketrek/TREK shared/src/book/stickers (5.7.10): the sticker library, drawn in-house for TREK. */
import { ASIA_STICKERS } from './data/asia.data';
import { DOODLES_STICKERS } from './data/doodles.data';
import { EPHEMERA_STICKERS } from './data/ephemera.data';
import { FOOD_STICKERS } from './data/food.data';
import { LANDMARKS_STICKERS } from './data/landmarks.data';
import { MEDITERRANEAN_STICKERS } from './data/mediterranean.data';
import { MOUNTAINS_STICKERS } from './data/mountains.data';
import { NORDIC_STICKERS } from './data/nordic.data';
import { ORNAMENTS_STICKERS } from './data/ornaments.data';
import { PAPER_STICKERS } from './data/paper.data';
import { SEA_STICKERS } from './data/sea.data';
import { TROPICAL_STICKERS } from './data/tropical.data';
import { BOOK_STICKER_THEMES, type BookStickerDef, type BookStickerLayer, type BookStickerSlot, type BookStickerTheme } from './sticker-types';

/**
 * The sticker library: every drawing the Studio offers and the assistant may
 * place, in the order the Studio lists them, with the lookups both use.
 *
 * Behind its own entry point (`@trek/shared/stickers`) because it is data, a
 * lot of it: the client's Studio chunk imports it, and so does the server's
 * book engine context and its `list_book_assets` tool, but nothing that every
 * screen loads.
 *
 * The lists are built by pure calls, marked so a bundler can drop the whole
 * library from a chunk that never reads it.
 */

function byTheme(...lists: (readonly BookStickerDef[])[]): readonly BookStickerDef[] {
  const all = lists.flat();
  return BOOK_STICKER_THEMES.flatMap((theme) => all.filter((s) => s.theme === theme));
}

export const BOOK_STICKERS: readonly BookStickerDef[] = /* @__PURE__ */ byTheme(
  EPHEMERA_STICKERS,
  LANDMARKS_STICKERS,
  TROPICAL_STICKERS,
  MEDITERRANEAN_STICKERS,
  SEA_STICKERS,
  MOUNTAINS_STICKERS,
  NORDIC_STICKERS,
  ASIA_STICKERS,
  FOOD_STICKERS,
  PAPER_STICKERS,
  DOODLES_STICKERS,
  ORNAMENTS_STICKERS,
);

const BY_ID: ReadonlyMap<string, BookStickerDef> = /* @__PURE__ */ new Map(BOOK_STICKERS.map((s) => [s.id, s]));

/** One sticker by id, or undefined for an id this library does not hold (a newer book, a typo). */
export function bookSticker(id: string): BookStickerDef | undefined {
  return BY_ID.get(id);
}

/** The stickers of one theme, in catalogue order. */
export function bookStickersOf(theme: BookStickerTheme): BookStickerDef[] {
  return BOOK_STICKERS.filter((s) => s.theme === theme);
}

/* ── book-sticker.ts upstream: what a layer is painted with ── */

/** The near-black of a drawn outline and the white that stays white, whatever a book recolours. */
export const STICKER_INK = '#2b2522';
export const STICKER_PAPER = '#ffffff';
const SHADE_ALPHA = 0.18;
const LIGHT_ALPHA = 0.35;

/** The colour a slot is drawn in: the element's own choice for it, else the sticker's default. */
export function bookStickerSlotColor(slots: readonly BookStickerSlot[], colors: readonly string[], slot: number): string {
  return colors[slot] ?? slots[slot]?.color ?? STICKER_INK;
}

/** What one layer is painted with, resolved against the element's colours. */
export function bookStickerLayerPaint(layer: BookStickerLayer, slots: readonly BookStickerSlot[], colors: readonly string[]): { color: string; opacity: number } {
  const p = layer.p;
  if (typeof p === 'number') return { color: bookStickerSlotColor(slots, colors, p), opacity: layer.o ?? 1 };
  if (p === 'shade') return { color: '#000000', opacity: layer.o ?? SHADE_ALPHA };
  if (p === 'light') return { color: '#ffffff', opacity: layer.o ?? LIGHT_ALPHA };
  if (p === 'ink') return { color: STICKER_INK, opacity: layer.o ?? 1 };
  if (p === 'paper') return { color: STICKER_PAPER, opacity: layer.o ?? 1 };
  return { color: p, opacity: layer.o ?? 1 };
}
