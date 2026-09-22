import type { BookDocument, BookElement, BookImageElement, BookPageSetup, BookSpread, BookTextElement } from '../../types/book'
import { TEMPLATES, COVER_TEMPLATES, applyTemplate, crossesGutter, type Template } from './templates'
import { pickReferenceTemplate, applyReferenceTemplate, type ReferenceEntry } from './referenceTemplates'
import { elementId } from './bookIds'
import type { RouteImages } from './buildRouteImages'

/**
 * Auto layout: turn a journey's own material into a populated book.
 *
 * Every entry is first tried against the six hand-drawn reference templates
 * (bookTemplates.data.ts + referenceTemplates.ts, ported from upstream
 * liketrek/trek) — a page somebody designed beats a page a function
 * reasoned its way to. When none of the six fit an entry's photo count or
 * lack of a story, it falls back to this file's own 12 programmatic
 * templates (templates.ts): an entry's content is seeded as plain elements,
 * scored by photo count and story presence, and poured into the best fit
 * via `applyTemplate`. The day's route gets its own dedicated spread
 * (`routeSpread`) rather than being squeezed into either template set's
 * fixed slots — a full map and elevation profile has its own shape neither
 * was drawn for. Pros and cons instead ride along on the entry's own page,
 * as a compact footer (`prosConsFooterElements`) below whatever the entry's
 * own template drew: a spread of their own was two pages for two or three
 * lines of text on most entries.
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
  /** Omitted or both-empty entries just don't get a pros/cons spread — additive, not a new requirement on every caller. */
  prosCons?: { pros: string[]; cons: string[] } | null
  /** For a reference template's `coords` badge or a coordinate-format `entry.location` binding — see referenceTemplates.ts. Omitted entries just don't fill those, same as a missing story. */
  lat?: number | null
  lng?: number | null
}

export interface AutoInput {
  locale: string
  title: string
  subtitle: string | null
  coverPhotoId: number | null
  entries: AutoEntry[]
  page: BookPageSetup
  /** Pre-computed — buildBook does no fetching or aggregation of its own. */
  journeyStats: {
    days: number; entries: number; photos: number; places: number
    /** From the linked trip(s)' GPX tracks, when any exist — see referenceTemplates.ts's `distance` badge/stat. */
    distanceKm?: number
    /** Total climb/descent across the linked trip(s)' GPX tracks, in metres — see referenceTemplates.ts's `fillStats`. */
    elevationGainM?: number
    elevationLossM?: number
  }
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

/**
 * A text element tied to a live fact about the journey — `overridden: false`
 * is what tells resolveBindings.ts it's still allowed to re-read the
 * source, so fixing a typo in the journal fixes it in the book without
 * regenerating the whole spread. Editing the text by hand in Studio flips
 * `overridden` to true and the link ends there, same as upstream.
 */
function boundTextEl(id: string, text: string, size: number, binding: BookTextElement['binding']): BookTextElement {
  return { ...textEl(id, text, size), binding, overridden: false }
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
  // A slot that straddles the gutter reads as one picture (or one line of
  // text) only when the spread is viewed uncut. Auto-layout targets
  // single-leaf export — what a print vendor's PDF uploader actually
  // requires — so a template that depends on the facing page is never a
  // candidate: each generated page has to stand on its own.
  if (crossesGutter(tpl, page)) return -1
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

/**
 * Rough estimate of how tall a block of body text will render, in
 * millimetres, before it's actually laid out. Word-wrapped against an
 * average character width rather than measured in a real font — exact
 * wrapping depends on font metrics the layout step doesn't have — but close
 * enough to tell a three-line story from a three-paragraph one, which is
 * all `entrySpread` needs it for: deciding whether a template's fixed-height
 * text box would leave most of itself blank.
 */
export function estimateTextHeight(text: string, boxWidthMm: number, fontSizePt: number, leading: number): number {
  const MM_PER_PT = 0.3528
  // A proportional sans-serif's average character advance is close to half
  // its em size — narrow letters and wide ones average out.
  const avgCharWidthMm = fontSizePt * MM_PER_PT * 0.5
  const charsPerLine = Math.max(1, Math.floor(boxWidthMm / avgCharWidthMm))

  const words = text.trim().split(/\s+/).filter(Boolean)
  let lines = words.length ? 1 : 0
  let lineLen = 0
  for (const word of words) {
    const wordLen = word.length + 1
    if (lineLen && lineLen + wordLen > charsPerLine) { lines++; lineLen = wordLen } else { lineLen += wordLen }
  }
  return lines * fontSizePt * MM_PER_PT * leading
}

/**
 * hero-story pins its small photo grid to the bottom of the page, with the
 * story's text box filling everything above it — sized for a long story. A
 * short one leaves most of that box blank, and the grid stays pinned at the
 * bottom regardless, so the page reads as mostly empty.
 *
 * Pulling the grid all the way up to sit right under the text just moves
 * the blank space rather than removing it — worse still on a page taller
 * than the ~210mm the template was tuned against (a real photo-book trim
 * size, e.g. Blurb's 8x10in, can be noticeably taller than wide), where the
 * gap between a short story and the template's own bottom-pinned position
 * is largest: the grid ends up stranded in the upper half with an even
 * bigger empty band below it than there was above it before.
 *
 * Split the difference instead: move the grid up by half of what tight
 * spacing would free, so the leftover room reads as a bottom margin instead
 * of a dead zone, on any page shape. A long story still fills the box (no
 * room to free) and the grid stays exactly at its template position.
 */
export function tightenHeroStory(spread: BookSpread, page: BookPageSetup): BookSpread {
  const body = spread.elements.find((e): e is BookTextElement => e.kind === 'text' && e.size === 10)
  const grid = spread.elements.filter(e => e.kind === 'photo' && e.frame.w < page.pageWidth * 0.4)
  if (!body || grid.length < 3 || !body.text.trim()) return spread

  const needed = estimateTextHeight(body.text, body.frame.w, 10, 1.6)
  const gap = 10
  const minY = body.frame.y + needed + gap
  const originalY = Math.min(...grid.map(e => e.frame.y))
  const y = Math.min(originalY, Math.max(minY, (originalY + minY) / 2))
  if (y >= originalY) return spread

  return {
    ...spread,
    elements: spread.elements.map(e => (e.kind === 'photo' && grid.includes(e) ? { ...e, frame: { ...e.frame, y: y + (e.frame.y - originalY) } } : e)),
  }
}

function toReferenceEntry(entry: AutoEntry): ReferenceEntry {
  return { id: entry.id, title: entry.title, story: entry.story, location: entry.location, date: entry.date, photos: entry.photos, lat: entry.lat, lng: entry.lng }
}

/**
 * One spread for one journal entry: a hand-drawn reference template first
 * (see this file's own header), then this file's programmatic templates
 * when none of the six fit.
 */
function entrySpread(entry: AutoEntry, input: AutoInput, seed: number): BookSpread {
  const { page, locale } = input
  const pros = (entry.prosCons?.pros ?? []).map(s => s.trim()).filter(Boolean)
  const cons = (entry.prosCons?.cons ?? []).map(s => s.trim()).filter(Boolean)
  const footerH = prosConsFooterHeight(pros, cons)
  // A page this much shorter is what keeps the main layout below drawn from
  // ever reaching into the footer strip — every template here computes its
  // frames from `page.pageHeight`, so handing it a smaller one is enough,
  // with no need to know what any given template actually drew.
  const layoutPage: BookPageSetup = footerH > 0 ? { ...page, pageHeight: page.pageHeight - footerH } : page

  const refEntry = toReferenceEntry(entry)
  const refTemplate = pickReferenceTemplate(refEntry, seed)
  let spread: BookSpread
  if (refTemplate) {
    spread = applyReferenceTemplate(refTemplate, refEntry, { page: layoutPage, locale, journeyStats: input.journeyStats })
  } else {
    const elements: BookElement[] = []
    entry.photos.forEach(p => elements.push(photoEl(elementId('p'), p.photoId)))
    const heading = entry.title || entry.location || ''
    if (heading) elements.push(boundTextEl(elementId('t'), heading, 22, { source: 'entry.title', entryId: entry.id }))
    const meta = formatMeta(entry.date, entry.title ? entry.location : null, locale)
    if (meta) elements.push(textEl(elementId('t'), meta, 7.5))
    if (entry.story?.trim()) elements.push(boundTextEl(elementId('t'), entry.story.trim(), 10, { source: 'entry.story', entryId: entry.id }))

    const hasStory = !!entry.story?.trim()
    const tpl = bestTemplate(TEMPLATES, entry.photos.length, hasStory, layoutPage, seed)
    const raw = seedSpread(elementId('sp'), 'inner', elements, entry.id)
    const laidOut = applyTemplate(raw, tpl, layoutPage)
    spread = tpl.id === 'hero-story' ? tightenHeroStory(laidOut, layoutPage) : laidOut
  }

  if (footerH > 0) {
    spread = { ...spread, elements: [...spread.elements, ...prosConsFooterElements(pros, cons, page, footerH)] }
  }
  return spread
}

const PROS_CONS_MAX_ITEMS = 6
const PROS_CONS_LINE_H = 6
const PROS_CONS_HEADING_H = 10
const PROS_CONS_MARGIN = 16
const PROS_CONS_MAX_FOOTER_H = 70

/**
 * How tall a footer needs to be for this many pros/cons — 0 when there are
 * none, which is what tells `entrySpread` not to shrink the layout page at
 * all. Capped: a very long list still gets a compact footer rather than
 * growing to swallow the page, on the theory that the journal entry itself
 * (where the full list still lives) is the place to read all of it — the
 * printed page just needs to say pros and cons existed, not reproduce them
 * verbatim. `pickReferenceTemplate`/`bestTemplate` see the shrunk page
 * before this runs, so a long list never fights the main layout for room.
 */
function prosConsFooterHeight(pros: string[], cons: string[]): number {
  if (!pros.length && !cons.length) return 0
  const maxItems = Math.min(Math.max(pros.length, cons.length), PROS_CONS_MAX_ITEMS)
  return Math.min(PROS_CONS_HEADING_H + maxItems * PROS_CONS_LINE_H + PROS_CONS_MARGIN, PROS_CONS_MAX_FOOTER_H)
}

/**
 * A journal entry's pros and cons, as a compact strip along the bottom of
 * the entry's own page — not a spread of their own, which for the two or
 * three lines an entry usually carries meant two almost entirely blank
 * pages (see the report this replaced: "un gasto ridículo de espacio").
 * `entrySpread` already shrank the page these sit below before laying out
 * the entry's own photo/text/reference-template content, so this never
 * overlaps it.
 *
 * Pros on the left page, cons on the right — never both on the same page,
 * the same reason `routeSpread` splits its map and label: a spread built
 * for uncut reading is still exported one leaf at a time for a real print
 * vendor, so nothing here may depend on the facing page. An entry with
 * only one side filled just leaves the other page's footer blank rather
 * than stretching one list across the gutter to fill it.
 */
function prosConsFooterElements(pros: string[], cons: string[], page: BookPageSetup, footerH: number): BookElement[] {
  const W = page.pageWidth
  const M = PROS_CONS_MARGIN
  const y = page.pageHeight - footerH
  const elements: BookElement[] = []

  const column = (items: string[], x: number, heading: string, tone: 'pro' | 'con', accent: string) => {
    if (!items.length) return
    elements.push({
      ...textEl(elementId('t'), heading, 11),
      frame: { x, y: y + 4, w: W - M * 2, h: 6 },
      weight: 700,
      color: accent,
    })
    elements.push({
      id: elementId('el'), kind: 'list', frame: { x, y: y + 12, w: W - M * 2, h: footerH - 16 },
      rotation: 0, opacity: 1, locked: false,
      font: 'sans', color: '#1a1a1a', accent,
      items: items.slice(0, PROS_CONS_MAX_ITEMS).map(text => ({ text, tone })), layout: 'stacked', showMarks: true, proLabel: '', conLabel: '',
    })
  }

  column(pros, M, 'Pros', 'pro', '#16a34a')
  column(cons, W + M, 'Cons', 'con', '#dc2626')

  return elements
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
      elements.push({ ...boundTextEl(elementId('t'), input.title, 28, { source: 'journey.title' }), frame: slot.frame, weight: 700 })
    } else if ((slot.kind === 'meta' || slot.kind === 'body') && input.subtitle) {
      elements.push({ ...boundTextEl(elementId('t'), input.subtitle, 9, { source: 'journey.subtitle' }), frame: slot.frame, weight: 400 })
    }
  }
  return seedSpread(elementId('sp'), 'cover', elements)
}

/**
 * A day's route map + elevation profile — the same content
 * JourneyBookPDF.tsx's fixed route pages already show, pre-rendered by
 * buildRouteImagesByDate into the self-contained `image` elements this
 * needs (see BookImageElement's own comment on why).
 *
 * The map is full-bleed on the left page only, and the label + elevation
 * profile sit entirely on the right page — never spanning both, the same
 * reason entrySpread only ever picks a template that passes
 * `crossesGutter`. A map crossing the gutter reads as one continuous route
 * only when the spread is viewed uncut; cut into single leaves for
 * "Páginas sueltas" export (what a real print vendor's PDF uploader
 * requires), it comes out as two unrelated fragments on two sheets.
 */
/**
 * The same headline figures ElevationDetail's own stats grid shows for a
 * trip's stages (Distancia, Desnivel +/-, Alt. máx/mín, Pend. máx, IBP) —
 * as one line rather than a grid of cards, since a route spread's `text`
 * element is plain text, not a layout of its own. Empty stats (a day with
 * no elevation data on its track) return '' so routeSpread can skip the
 * line entirely rather than showing a row of dashes.
 */
function formatRouteStats(stats: RouteImages['stats']): string {
  const parts: string[] = []
  if (stats.totalDist > 0) parts.push(`${stats.totalDist.toFixed(1)} km`)
  if (stats.gain > 0) parts.push(`↑ ${Math.round(stats.gain)} m`)
  if (stats.loss > 0) parts.push(`↓ ${Math.round(stats.loss)} m`)
  if (stats.minEle != null && stats.maxEle != null) parts.push(`Alt. ${Math.round(stats.minEle)}–${Math.round(stats.maxEle)} m`)
  if (stats.maxSlope > 0) parts.push(`Max slope ${stats.maxSlope}%`)
  if (stats.ibp != null) parts.push(`IBP ${stats.ibp}`)
  return parts.join('   ·   ')
}

function routeSpread(date: string, images: RouteImages, page: BookPageSetup, locale: string): BookSpread {
  const W = page.pageWidth
  const H = page.pageHeight
  const M = 16
  const elements: BookElement[] = []

  const parsed = new Date(`${date}T00:00:00`)
  const label = Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

  if (images.mapSrc) {
    elements.push(imageEl(elementId('im'), images.mapSrc, { x: -page.bleed, y: -page.bleed, w: W + page.bleed, h: H + page.bleed * 2 }, 'cover'))
  }
  if (label) {
    elements.push({
      ...textEl(elementId('t'), label, 15),
      frame: { x: W + M, y: M, w: W - M * 2, h: 10 },
      weight: 700,
      color: '#1a1a1a',
    })
  }

  // Stats line pushes the elevation chart down by however much room it
  // needs — a day whose track has no elevation data at all keeps the
  // original layout (chart right under the date).
  const statsLine = formatRouteStats(images.stats)
  let eleY = M + 20
  if (statsLine) {
    elements.push({
      ...textEl(elementId('t'), statsLine, 9),
      frame: { x: W + M, y: M + 12, w: W - M * 2, h: 12 },
      weight: 600,
      color: '#4a4a4a',
    })
    eleY = M + 27
  }

  if (images.elevationSrc) {
    elements.push(imageEl(elementId('im'), images.elevationSrc, { x: W + M, y: eleY, w: W - M * 2, h: H - M - eleY }, 'contain'))
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
  return { ...entrySpread(entry, input, seed), id: spread.id }
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
  // The first entry (in withContent's own order) for each date, so a day's
  // route spread — its map and elevation profile — opens that day, the same
  // place JourneyBookPDF.tsx's own per-day route pages already sit, rather
  // than trailing behind it where it reads as a coda to the last entry.
  const firstIndexForDate = new Map<string, number>()
  withContent.forEach((entry, i) => { if (entry.date && !firstIndexForDate.has(entry.date)) firstIndexForDate.set(entry.date, i) })

  withContent.forEach((entry, i) => {
    if (entry.date && routeImages?.has(entry.date) && firstIndexForDate.get(entry.date) === i) {
      spreads.push(routeSpread(entry.date, routeImages.get(entry.date)!, input.page, input.locale))
    }
    spreads.push(entrySpread(entry, input, i))
  })
  spreads.push(summarySpread(input, dateRange))

  return { version: 1, title: input.title, page: input.page, spreads: spreads.slice(0, 150) }
}
