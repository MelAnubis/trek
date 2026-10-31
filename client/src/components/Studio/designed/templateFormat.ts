import type { BookColorToken, BookElement, BookPaint } from '../../../types/book'

/*
 * Designed pages (5.7.10): whole pages somebody designed, with the pictures
 * and the words left out, that any page of any book can be laid out on.
 * Ported from liketrek/TREK's shared/src/book/templates/template-format.ts
 * (AGPLv3); the data files in ./data are upstream's, as drawn.
 *
 * Every number that is a measure is a fraction of the page it was drawn on:
 * a frame's x and w of one page's width (an inner spread runs 0 to 2), y and
 * h of its height, and every other length (a type size, a stroke, a radius,
 * an outline) of the page's shorter side. An edge at or past the trim bleeds.
 *
 * What a template adds to the document's elements: `role` (what the page's
 * content goes into: `photo:n`, `title`, `subtitle`, `date`, `body`,
 * `caption`, `map`), `tint` (theme links for colours the document links
 * nowhere), `keep` (keeps its proportions), `fillPhoto` (letters filled with
 * the picture a photo role took) and `on` (the colour a text sits on, so it is
 * made to read there in any theme). None of these is a document field.
 */

export const BOOK_COVER_ARCHETYPES = [
  'spine-band', 'poster-pop', 'cutout', 'postcard', 'grid-badge', 'minimal-serif',
  'stamp-collage', 'riso', 'editorial', 'vintage-poster', 'night-film', 'field-notes',
] as const
export type BookCoverArchetype = (typeof BOOK_COVER_ARCHETYPES)[number]

export const BOOK_TEMPLATE_TEXT_ROLES = ['title', 'subtitle', 'date', 'body', 'caption'] as const
export type BookTemplateTextRole = (typeof BOOK_TEMPLATE_TEXT_ROLES)[number]
export type BookTemplatePhotoRole = `photo:${number}`
export type BookTemplateRole = BookTemplateTextRole | BookTemplatePhotoRole | 'map'

const PHOTO_ROLE = /^photo:([1-9][0-9]?)$/

/** The place a photo role pours from, 1 for `photo:1`; null for any other role. */
export function templatePhotoIndex(role: string | undefined): number | null {
  const n = role ? PHOTO_ROLE.exec(role)?.[1] : undefined
  return n === undefined ? null : Number(n)
}

/** Colour links a template sets when it is laid, for the colours the document links nowhere. */
export interface BookTemplateTint {
  border?: BookColorToken
  shadow?: BookColorToken
  cutout?: BookColorToken
  outline?: BookColorToken
  highlight?: BookColorToken
  fill?: BookColorToken
  stroke?: BookColorToken
  fg?: BookColorToken
  bg?: BookColorToken
  stops?: readonly (BookColorToken | null)[]
  colors?: readonly (BookColorToken | null)[]
}

/**
 * One element of a template, as drawn: upstream's element in fractions. Kept
 * loose on purpose: a few kinds (a date mark, a map) are upstream's shape and
 * are turned into Trek's when laid (templateLay.ts).
 */
export type BookTemplateElement = {
  id: string
  kind: string
  frame: { x: number; y: number; w: number; h: number }
  rotation: number
  role?: BookTemplateRole | string
  tint?: BookTemplateTint
  keep?: true
  fillPhoto?: BookTemplatePhotoRole | string
  on?: BookColorToken
  [field: string]: unknown
}

export type BookTemplateKind = 'single' | 'inner'

export interface BookDecoratedTemplate {
  id: string
  /** upstream's `studio.templates.name.*`; Trek reads it as `journey.studio.designed.name.*`. */
  labelKey: string
  kind: BookTemplateKind
  archetype: BookCoverArchetype
  tags: readonly string[]
  descr: string
  background: string | null
  backgroundToken?: BookColorToken
  backgroundPaint?: BookPaint
  backgroundTint?: BookTemplateTint
  /** Back to front, as a page paints them. */
  elements: readonly (BookTemplateElement | (BookElement & Omit<BookTemplateElement, keyof BookElement>))[]
}

/** The roles a template's elements carry, in paint order. */
export function templateRoles(tpl: Pick<BookDecoratedTemplate, 'elements'>): string[] {
  return tpl.elements.flatMap(e => (typeof e.role === 'string' ? [e.role] : []))
}

/** How many pictures a template pours. */
export function templatePhotoSlots(tpl: Pick<BookDecoratedTemplate, 'elements'>): number {
  return tpl.elements.filter(e => e.kind === 'photo' && templatePhotoIndex(e.role as string | undefined) !== null).length
}

/** The i18n key Trek names a template by. */
export const templateNameKey = (tpl: Pick<BookDecoratedTemplate, 'labelKey'>): string =>
  tpl.labelKey.replace(/^studio\.templates\.name\./, 'journey.studio.designed.name.')
