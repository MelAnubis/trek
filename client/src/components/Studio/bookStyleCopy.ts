import type { BookElement } from '../../types/book'

/**
 * Copy and paste style: the look of one element taken onto others. Ported
 * from liketrek/TREK's shared/src/book/book-style-copy.ts (same AGPLv3
 * license), with the per-kind look fields listed here by hand — upstream
 * derives them from its `style` operation's zod schema, which this fork has
 * no client-side copy of.
 *
 * The look is what changes how an element *looks*, never what it shows: a
 * text's words, a photo's picture, a list's items, a stats block's figures
 * stay where they are. Onto an element of another kind only the fields both
 * kinds read the same way travel (a text's colour onto an icon, the opacity
 * onto anything); a field whose values mean something else per kind (a
 * `layout`) stays behind.
 */

export interface BookCopiedStyle {
  kind: BookElement['kind']
  props: Record<string, unknown>
}

const TYPESET = ['font', 'color', 'accent']

const STYLE_KEYS: Record<BookElement['kind'], readonly string[]> = {
  photo: ['opacity', 'fit', 'radius', 'filter', 'frameStyle', 'mask', 'border', 'shadow', 'zoom', 'flipX', 'adjust', 'duotone', 'cutout', 'edge', 'edgeSize'],
  text: ['opacity', 'font', 'size', 'weight', 'italic', 'align', 'leading', 'tracking', 'color', 'effect', 'highlight', 'uppercase'],
  shape: ['opacity', 'fill', 'gradient', 'paint', 'stroke', 'strokeWidth', 'strokeStyle', 'radius', 'edge', 'edgeSize'],
  image: ['opacity', 'fit', 'radius'],
  map: ['opacity', 'fit', 'radius'],
  stats: ['opacity', ...TYPESET, 'layout', 'showIcons', 'units'],
  places: ['opacity', ...TYPESET, 'layout', 'align'],
  countries: ['opacity', ...TYPESET, 'layout', 'showOutline', 'showFlag', 'showName', 'align'],
  badge: ['opacity', ...TYPESET, 'style'],
  icon: ['opacity', 'color', 'lineWidth'],
  list: ['opacity', ...TYPESET, 'layout', 'showMarks'],
  packing: ['opacity', ...TYPESET, 'groupByCategory', 'showQuantity', 'columns'],
  accommodation: ['opacity', ...TYPESET, 'showConfirmation', 'layout'],
  sticker: ['opacity', 'colors', 'flipX'],
  line: ['opacity', 'stroke', 'strokeWidth', 'dash', 'curve', 'squiggle', 'startCap', 'endCap', 'wobble', 'ornament'],
}

/** Fields that mean the same thing on every kind that has them, so they may cross kinds. */
const CROSS_KIND = new Set(['opacity', 'font', 'color', 'accent', 'radius', 'fit'])

/** The look fields an element of a kind takes from a pasted style. */
export function bookStyleKeys(kind: BookElement['kind']): readonly string[] {
  return STYLE_KEYS[kind] ?? []
}

/** The look of an element, as the style clipboard keeps it. */
export function bookElementStyle(el: BookElement): BookCopiedStyle {
  const source = el as unknown as Record<string, unknown>
  const props: Record<string, unknown> = {}
  for (const key of bookStyleKeys(el.kind)) if (source[key] !== undefined) props[key] = source[key]
  return { kind: el.kind, props }
}

/** What a copied look sets on an element of `kind`: what both kinds have, or null when they share nothing. */
export function pastableStyle(style: BookCopiedStyle, kind: BookElement['kind']): Record<string, unknown> | null {
  const sameKind = style.kind === kind
  const set: Record<string, unknown> = {}
  let any = false
  for (const key of bookStyleKeys(kind)) {
    if (style.props[key] === undefined) continue
    if (!sameKind && !CROSS_KIND.has(key)) continue
    set[key] = style.props[key]
    any = true
  }
  return any ? set : null
}

/** The element with a copied look on it; the same object when nothing applies. */
export function withPastedStyle(el: BookElement, style: BookCopiedStyle): BookElement {
  const look = pastableStyle(style, el.kind)
  if (!look) return el
  const next = { ...el, ...look } as Record<string, unknown>
  // Within a kind, an optional part the source does not wear (a paint, an edge, a photo look) is taken off too.
  if (style.kind === el.kind) for (const key of OPTIONAL_LOOK) if (style.props[key] === undefined && key in next && bookStyleKeys(el.kind).includes(key)) delete next[key]
  return next as unknown as BookElement
}

/** Look fields that are absent when off, rather than set to a neutral value. */
const OPTIONAL_LOOK = ['paint', 'edge', 'edgeSize', 'border', 'shadow', 'zoom', 'flipX', 'adjust', 'duotone', 'cutout']
