import type { BookDocument, BookElement, BookImageElement, BookPageSetup, BookSpread, BookTextElement } from '../../types/book'
import { TEMPLATES, COVER_TEMPLATES, applyTemplate, type Template } from './templates'
import { elementId } from './bookIds'
import type { RouteImages } from './buildRouteImages'

/**
 * Auto layout: turn a journey's own material into a populated book.
 *
 * This is a from-scratch, deliberately narrower reimplementation of
 * liketrek/trek's autoLayout.ts (1650+ lines) — that version scores entries
 * against six hand-drawn reference templates *and* a travel-specific
 * element vocabulary (route maps, country lists, stat badges, flags) that
 * this fork hasn't ported yet (see the schema's comment on why `map`/
 * `stats`/`countries`/`badge`/`icon`/`list` element kinds are deferred).
 *
 * What's kept, and why it's still real auto-layout rather than a stub:
 * every entry's actual photos, title, story and date land on the page
 * through the SAME template-and-reflow mechanism `templates.ts` already
 * gives "This spread" — an entry's content is seeded as plain elements,
 * scored against the 12 programmatic spread templates by photo count and
 * story presence, and poured into the best fit via `applyTemplate`. A
 * follow-up phase can add the hand-drawn templates and travel elements on
 * top of this without changing the shape of `buildBook`.
 */

export interface AutoPhoto {
  photoId: number
}

export interface AutoEntry {
  id: number
  title: string | null
  story: string | null
  location: string | null
  date: string | null
  photos: AutoPhoto[]
}

export interface AutoInput {
  locale: string
  title: string
  subtitle: string | null
  coverPhotoId: number | null
  entries: AutoEntry[]
  page: BookPageSetup
  /** Pre-computed — buildBook does no fetching or aggregation of its own. */
  journeyStats: { days: number; entries: number; photos: number; places: number }
  /**
   * A day's route map + elevation profile, pre-rendered by
   * buildRouteImagesByDate (async — network tile fetches — which is why
   * buildBook itself stays synchronous and takes the result rather than
   * the raw tracks). Keyed by the same ISO date entries carry. Omitted
   * entirely, a book built without it just has no route spreads — this is
   * additive, not a new requirement on every caller.
   */
  routeImagesByDate?: Map<string, RouteImages>
}

function photoEl(id: string, photoId: number | null): BookElement {
  return {
    id, kind: 'photo', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false,
    photoId, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null,
  }
}

function imageEl(id: string, src: string, frame: { x: number; y: number; w: number; h: number }, fit: BookImageElement['fit'] = 'cover'): BookImageElement {
  return { id, kind: 'image', frame, rotation: 0, opacity: 1, locked: false, src, fit, radius: 0 }
}

/** Size is what `applyTemplate`'s heuristic uses to tell heading/body/meta apart — see templates.ts. */
function textEl(id: string, text: string, size: number): BookTextElement {
  return {
    id, kind: 'text', frame: { x: 0, y: 0, w: 10, h: 10 }, rotation: 0, opacity: 1, locked: false,
    text, font: 'sans', size, weight: size >= 14 ? 700 : 400, italic: false, align: 'left',
    leading: 1.4, tracking: 0, color: '#1a1a1a', binding: null, overridden: true,
  }
}

function seedSpread(id: string, role: BookSpread['role'], elements: BookElement[], entryId: number | null = null): BookSpread {
  return { id, role, background: null, elements, parked: [], entryId }
}

/** How well a template suits an entry's content: more is better, -1 means it would leave a hole or need words that aren't there. */
function templateFit(tpl: Template, photos: number, hasStory: boolean, page: BookPageSetup): number {
  const slots = tpl.build(page)
  const frames = slots.filter(s => s.kind === 'photo').length
  const wantsBody = slots.some(s => s.kind === 'body')
  if (frames > photos + 1) return -1
  if (wantsBody && !hasStory) return -1
  return 100 - Math.abs(frames - photos) * 10 - (wantsBody === hasStory ? 0 : 5)
}

function bestTemplate(candidates: Template[], photos: number, hasStory: boolean, page: BookPageSetup, seed: number): Template {
  const scored = candidates.map(t => ({ t, score: templateFit(t, photos, hasStory, page) }))
  const best = Math.max(...scored.map(s => s.score))
  // Ties within 5 points of the best pick by a rotating index, so a run of
  // similarly-shaped entries doesn't all land on the identical layout.
  const ties = scored.filter(s => s.score >= best - 5)
  return ties[seed % ties.length].t
}

function formatMeta(date: string | null, location: string | null, locale: string): string {
  const parts: string[] = []
  if (date) {
    const d = new Date(`${date}T00:00:00`)
    if (!Number.isNaN(d.getTime())) parts.push(d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }))
  }
  if (location) parts.push(location)
  return parts.join(' · ')
}

/** One spread for one journal entry: seed its content, pick the best-fit layout, pour it in. */
function entrySpread(entry: AutoEntry, page: BookPageSetup, locale: string, seed: number): BookSpread {
  const elements: BookElement[] = []
  entry.photos.forEach(p => elements.push(photoEl(elementId('p'), p.photoId)))
  const heading = entry.title || entry.location || ''
  if (heading) elements.push(textEl(elementId('t'), heading, 22))
  const meta = formatMeta(entry.date, entry.title ? entry.location : null, locale)
  if (meta) elements.push(textEl(elementId('t'), meta, 7.5))
  if (entry.story?.trim()) elements.push(textEl(elementId('t'), entry.story.trim(), 10))

  const hasStory = !!entry.story?.trim()
  const tpl = bestTemplate(TEMPLATES, entry.photos.length, hasStory, page, seed)
  const raw = seedSpread(elementId('sp'), 'inner', elements, entry.id)
  return applyTemplate(raw, tpl, page)
}

/**
 * The cover skips `applyTemplate`'s generic pool heuristic (heading = the
 * one large text, body = the longest of what's left, meta = whatever's
 * left after that): with only a title and a subtitle to place, and no
 * cover template that has a `body` slot, the subtitle would be classified
 * as "body" — the longest (only) leftover text — and then dropped for
 * having nowhere to go. A cover has exactly three roles and no ambiguity
 * about which is which, so they're placed directly against the template's
 * own slots instead.
 */
function coverSpread(input: AutoInput): BookSpread {
  const tpl = input.coverPhotoId
    ? COVER_TEMPLATES.find(t => t.id === 'cover-band')!
    : COVER_TEMPLATES.find(t => t.id === 'cover-quiet')!
  const slots = tpl.build(input.page)
  const elements: BookElement[] = []
  for (const slot of slots) {
    if (slot.kind === 'photo' && input.coverPhotoId) {
      elements.push({ ...photoEl(elementId('p'), input.coverPhotoId), frame: slot.frame })
    } else if (slot.kind === 'heading' && input.title) {
      elements.push({ ...textEl(elementId('t'), input.title, 28), frame: slot.frame, weight: 700 })
    } else if ((slot.kind === 'meta' || slot.kind === 'body') && input.subtitle) {
      elements.push({ ...textEl(elementId('t'), input.subtitle, 9), frame: slot.frame, weight: 400 })
    }
  }
  return seedSpread(elementId('sp'), 'cover', elements)
}

/**
 * A day's route map + elevation profile, full-bleed across the spread —
 * the same content JourneyBookPDF.tsx's fixed route pages already show,
 * pre-rendered by buildRouteImagesByDate into the self-contained `image`
 * elements this needs (see BookImageElement's own comment on why).
 */
function routeSpread(date: string, images: RouteImages, page: BookPageSetup, locale: string): BookSpread {
  const W = page.pageWidth
  const H = page.pageHeight
  const elements: BookElement[] = []

  const parsed = new Date(`${date}T00:00:00`)
  const label = Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  if (images.mapSrc) {
    elements.push(imageEl(elementId('im'), images.mapSrc, { x: -page.bleed, y: -page.bleed, w: W * 2 + page.bleed * 2, h: H * 0.6 + page.bleed }, 'cover'))
  }
  if (label) {
    elements.push({
      ...textEl(elementId('t'), label, 15),
      frame: { x: W * 0.15, y: H * 0.6 + 10, w: W * 1.7, h: 10 },
      weight: 700,
      color: '#1a1a1a',
    })
  }
  if (images.elevationSrc) {
    elements.push(imageEl(elementId('im'), images.elevationSrc, { x: W * 0.1, y: H * 0.6 + 22, w: W * 1.8, h: H * 0.3 }, 'contain'))
  }

  return seedSpread(elementId('sp'), 'inner', elements)
}

/** A plain, non-templated closing spread — trip figures as styled text, no dedicated stats element yet. */
function summarySpread(input: AutoInput, dateRange: string): BookSpread {
  const s = input.journeyStats
  const parts = [
    `${s.days} ${s.days === 1 ? 'day' : 'days'}`,
    `${s.entries} ${s.entries === 1 ? 'entry' : 'entries'}`,
    `${s.photos} photos`,
    s.places > 0 ? `${s.places} places` : null,
  ].filter(Boolean)

  const W = input.page.pageWidth
  const H = input.page.pageHeight
  const elements: BookElement[] = [
    { id: elementId('s'), kind: 'shape', frame: { x: -input.page.bleed, y: -input.page.bleed, w: W * 2 + input.page.bleed * 2, h: H + input.page.bleed * 2 },
      rotation: 0, opacity: 1, locked: false, shape: 'rect', fill: '#0a0a0f', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0 },
    { id: elementId('t'), kind: 'text', frame: { x: W * 0.3, y: H * 0.38, w: W * 1.4, h: 20 },
      rotation: 0, opacity: 1, locked: false, text: input.title, font: 'display', size: 26, weight: 700, italic: false,
      align: 'center', leading: 1.1, tracking: -0.01, color: '#ffffff', binding: null, overridden: true },
    { id: elementId('t'), kind: 'text', frame: { x: W * 0.3, y: H * 0.38 + 26, w: W * 1.4, h: 10 },
      // opacity carries the fade — `color` is validated server-side as plain #rrggbb, no alpha.
      rotation: 0, opacity: 0.5, locked: false, text: dateRange, font: 'sans', size: 9, weight: 500, italic: false,
      align: 'center', leading: 1.4, tracking: 0.04, color: '#ffffff', binding: null, overridden: true },
    { id: elementId('t'), kind: 'text', frame: { x: W * 0.3, y: H * 0.38 + 44, w: W * 1.4, h: 10 },
      rotation: 0, opacity: 1, locked: false, text: parts.join('   ·   '), font: 'sans', size: 10, weight: 700, italic: false,
      align: 'center', leading: 1.4, tracking: 0.08, color: '#2dd4bf', binding: null, overridden: true },
  ]
  return seedSpread(elementId('sp'), 'inner', elements)
}

/** Empty book: one cover, one inner spread, no elements — the non-auto-layout starting state. */
export function emptyBook(page: BookPageSetup, title = ''): BookDocument {
  return {
    version: 1,
    title,
    page,
    spreads: [
      seedSpread(elementId('sp'), 'cover', []),
      seedSpread(elementId('sp'), 'inner', []),
    ],
  }
}

/** Regenerate one spread from the entry it came from (re-picks a template — different from applying one by hand). Null if the spread has no entryId, or the entry no longer exists. */
export function relayoutSpread(spread: BookSpread, input: AutoInput, seed = 0): BookSpread | null {
  if (spread.entryId == null) return null
  const entry = input.entries.find(e => e.id === spread.entryId)
  if (!entry) return null
  return { ...entrySpread(entry, input.page, input.locale, seed), id: spread.id }
}

export function buildBook(input: AutoInput): BookDocument {
  const withContent = input.entries.filter(e => e.photos.length > 0 || !!e.story?.trim())
  const dates = withContent.map(e => e.date).filter((d): d is string => !!d).sort()
  const dateRange = dates.length
    ? (dates[0] === dates[dates.length - 1]
      ? new Date(`${dates[0]}T00:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'long', year: 'numeric' })
      : `${new Date(`${dates[0]}T00:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'short' })} – ${new Date(`${dates[dates.length - 1]}T00:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'short', year: 'numeric' })}`)
    : ''

  const spreads: BookSpread[] = [coverSpread(input)]
  const routeImages = input.routeImagesByDate
  // The last entry (in withContent's own order) for each date, so a day's
  // route spread lands right after that day's own last entry rather than
  // wherever iteration happens to be when its date is first seen.
  const lastIndexForDate = new Map<string, number>()
  withContent.forEach((entry, i) => { if (entry.date) lastIndexForDate.set(entry.date, i) })

  withContent.forEach((entry, i) => {
    spreads.push(entrySpread(entry, input.page, input.locale, i))
    if (entry.date && routeImages?.has(entry.date) && lastIndexForDate.get(entry.date) === i) {
      spreads.push(routeSpread(entry.date, routeImages.get(entry.date)!, input.page, input.locale))
    }
  })
  spreads.push(summarySpread(input, dateRange))

  return { version: 1, title: input.title, page: input.page, spreads: spreads.slice(0, 150) }
}
