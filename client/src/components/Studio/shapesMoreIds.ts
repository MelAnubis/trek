/*
 * The second shelf of shapes (5.7.10), ported from liketrek/TREK's
 * shared/src/book/book-shapes-more.ts (AGPLv3): arches, paper cut-outs,
 * stamps, ribbons, bubbles, drawn arrows, frames and ornaments. The server
 * keeps the same list in bookSchema.ts (a test holds the two equal).
 */

export { BOOK_SHAPES_MORE } from '../../types/book'
import type { BOOK_SHAPES_MORE } from '../../types/book'
export type BookShapeMoreId = (typeof BOOK_SHAPES_MORE)[number]

/** How wide each is drawn against its height; what the panel places it at. */
export const BOOK_SHAPE_ASPECT: Readonly<Record<BookShapeMoreId, number>> = {
  'arch-tall': 0.5,
  'arch-pointed': 0.53,
  'arch-double': 1.25,
  'arch-half': 0.63,
  'arch-rainbow': 2,
  'stamp-rect': 0.81,
  'stamp-circle': 1,
  postmark: 1,
  rosette: 0.76,
  'scallop-circle': 1,
  'badge-shield': 1.04,
  'label-tab': 2,
  'ticket-stub': 2.22,
  'sunburst-12': 1,
  'sunburst-24': 1,
  'ribbon-ends': 3.7,
  'ribbon-arc': 3.09,
  'wavy-band': 3.13,
  'torn-strip': 4.78,
  'bubble-shout': 1.02,
  'bubble-side': 1.43,
  'bubble-capsule': 2.08,
  'arrow-curve': 3.59,
  'arrow-circle': 1.12,
  'arrow-notched': 2,
  'arrow-thin': 5.56,
  'heart-round': 1.06,
  'heart-pair': 1.25,
  'star-rounded': 1.05,
  'star-twinkle': 1,
  'flower-8': 1,
  'frame-notched': 1,
  'frame-chamfer': 1,
  'frame-cushion': 1,
  'leaf-palm': 1.06,
  'leaf-oak': 0.46,
  'leaf-long': 0.22,
  'leaf-monstera': 1.11,
  'coral-1': 1.58,
  'coral-2': 1.45,
  seaweed: 0.38,
  'star-organic': 1.05,
  'sun-cutout': 0.98,
  'organic-1': 1.14,
  'organic-2': 0.86,
  'organic-3': 1.11,
  'flourish-scroll': 7.32,
  laurel: 1.19,
  fleuron: 1.29,
  'corner-flourish': 0.99,
};

export function bookShapeSize(shape: string, side: number): { w: number; h: number } | null {
  const aspect = (BOOK_SHAPE_ASPECT as Readonly<Record<string, number>>)[shape];
  if (aspect === undefined) return null;
  // Very long ones (a scroll, a thin arrow) are held to a band rather than a needle.
  const root = Math.sqrt(Math.min(aspect, 4));
  const w = side * root;
  return { w, h: w / aspect };
}
