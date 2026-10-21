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
  /** Pixel size, when known (journey_photos.width/height) — lets the layout match portrait photos to tall frames. Omitted or null: treated as unknown and never penalised. */
  width?: number | null
  height?: number | null
}

/*
 * ── Shape-aware placement ──────────────────────────────────────────────────
 *
 * Upstream picks templates by what the photos *are* — portrait, landscape,
 * panorama — not just how many there are, and that is most of the difference
 * between a book that looks arranged and one that looks poured in. It matters
 * most right after a page-size change: the same three photos want a different
 * grid on an A4 portrait page than on a 30 × 30 square.
 *
 * Cost is the crop: |ln(frame aspect / photo aspect)|, 0 for a perfect fit,
 * ~0.4 for a 3:2 landscape in a square, ~0.8 for a portrait in a 3:2 slot.
 * Photos and frames are paired by rank (narrowest photo to narrowest frame),
 * which minimises the summed crop for this cost.
 */
function aspectOf(p: AutoPhoto): number | null {
  return p.width && p.height && p.width > 0 && p.height > 0 ? p.width / p.height : null
}

/** For each frame (in slot order), the index into `photos` that should fill it. Unknown-shape photos fill whatever is left, in their original order. */
export function pairPhotosToFrames(frames: { w: number; h: number }[], photos: AutoPhoto[]): number[] {
  const n = Math.min(frames.length, photos.length)
  const use = photos.slice(0, n).map((p, i) => ({ i, a: aspectOf(p) }))
  const known = use.filter(u => u.a != null).sort((x, y) => x.a! - y.a!)
  const unknown = use.filter(u => u.a == null)
  const slots = frames.slice(0, n).map((f, i) => ({ i, a: f.w / Math.max(0.01, f.h) }))
  // Known shapes take the frames whose shape is most extreme at each end
  // first — sorting frames and photos together pairs rank to rank.
  const out = new Array<number>(n).fill(-1)
  if (known.length) {
    const order = [...slots].sort((x, y) => x.a - y.a)
    // Spread the known photos across the sorted frames proportionally so a
    // single portrait among landscapes still gets the tallest frame.
    const picks = known.map((_, k) => Math.round(known.length === 1 ? (known[0].a! < 1 ? 0 : order.length - 1) : (k * (order.length - 1)) / (known.length - 1)))
    const taken = new Set<number>()
    known.forEach((ph, k) => {
      let j = picks[k]
      while (taken.has(j)) j = (j + 1) % order.length
      taken.add(j)
      out[order[j].i] = ph.i
    })
  }
  let u = 0
  for (let i = 0; i < n; i++) if (out[i] === -1) out[i] = unknown[u++].i
  return out
}

/** Summed crop of pairing these photos into these frames — 0 when every shape is unknown. */
export function cropCost(frames: { w: number; h: number }[], photos: AutoPhoto[]): number {
  const pairs = pairPhotosToFrames(frames, photos)
  let cost = 0
  pairs.forEach((pi, fi) => {
    const a = aspectOf(photos[pi])
    if (a == null) return
    const f = frames[fi]
    cost += Math.abs(Math.log((f.w / Math.max(0.01, f.h)) / a))
  })
  return cost
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
    /** Summed trip expenses in budgetCurrency (the earliest-linked trip's own currency) — see journeyService.ts's getJourneyDetail. */
    budgetTotal?: number
    budgetCurrency?: string
    /** Distinct countries across every entry's location, resolved from lat/lng — see journeyService.ts's getJourneyFull. */
    countries?: number
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
  /**
   * The whole-journey map + elevation profile for the closing summary
   * spread, pre-rendered the same way routeImagesByDate's per-day entries
   * are (see buildOverviewRouteImages). Set when no track could be matched
   * to a specific day at all (the "no gpx file per jornada" case — the
   * summary is then the only route content the book gets), or from
   * whatever tracks were left over after the ones that did match a day
   * got their own routeSpread, so the closing spread doesn't repeat a day
   * already shown. Omitted entirely, summarySpread falls back to its
   * plain text-only closing card.
   */
  overviewRoute?: RouteImages | null
  /** Heading over a list of bare stops, already translated ("Etapas"). Omitted: the English word. */
  stationsLabel?: string
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
function templateFit(tpl: Template, photos: AutoPhoto[], hasStory: boolean, page: BookPageSetup): number {
  const slots = tpl.build(page)
  const frames = slots.filter(s => s.kind === 'photo')
  const wantsBody = slots.some(s => s.kind === 'body')
  const count = photos.length
  if (frames.length > count + 1) return -1
  if (wantsBody && !hasStory) return -1
  // A slot that straddles the gutter reads as one picture (or one line of
  // text) only when the spread is viewed uncut. Auto-layout targets
  // single-leaf export — what a print vendor's PDF uploader actually
  // requires — so a template that depends on the facing page is never a
  // candidate: each generated page has to stand on its own.
  if (crossesGutter(tpl, page)) return -1
  // Up to ~12 points for shape fit: enough to choose between two grids of the
  // right size, never enough to make a 2-photo layout win for 5 photos.
  const crop = cropCost(frames.map(f => f.frame), photos)
  const shapePenalty = Math.min(12, (crop / Math.max(1, Math.min(frames.length, count))) * 15)
  return 100 - Math.abs(frames.length - count) * 10 - (wantsBody === hasStory ? 0 : 5) - shapePenalty
}

function bestTemplate(candidates: Template[], photos: AutoPhoto[], hasStory: boolean, page: BookPageSetup, seed: number): Template {
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
    const hasStory = !!entry.story?.trim()
    const tpl = bestTemplate(TEMPLATES, entry.photos, hasStory, layoutPage, seed)
    // applyTemplate fills photo frames in pool order, so hand it the photos
    // already in the order that puts each into its best-shaped frame; the
    // ones that don't fit go after, and end up parked as before.
    const frames = tpl.build(layoutPage).filter(sl => sl.kind === 'photo').map(sl => sl.frame)
    const order = pairPhotosToFrames(frames, entry.photos)
    const placed = new Set(order)
    ;[...order.map(i => entry.photos[i]), ...entry.photos.filter((_, i) => !placed.has(i))]
      .forEach(p => elements.push(photoEl(elementId('p'), p.photoId)))
    const heading = entry.title || entry.location || ''
    if (heading) elements.push(boundTextEl(elementId('t'), heading, 22, { source: 'entry.title', entryId: entry.id }))
    const meta = formatMeta(entry.date, entry.title ? entry.location : null, locale)
    if (meta) elements.push(textEl(elementId('t'), meta, 7.5))
    if (entry.story?.trim()) elements.push(boundTextEl(elementId('t'), entry.story.trim(), 10, { source: 'entry.story', entryId: entry.id }))

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

/**
 * The closing spread — trip figures as styled text over a dark card, same
 * as before when there's no route data to show.
 *
 * When `overviewRoute` is given (see AutoInput's own comment on when that
 * is: no track could be matched to any specific day at all, or the
 * leftover after the ones that did), the map goes full-bleed on the left
 * page and the card narrows to the right page alone — the same
 * single-leaf reasoning routeSpread's own comment gives for never letting
 * a map cross the gutter. Without it, the dark card still spans both
 * pages as one poster, unchanged.
 */
function summarySpread(input: AutoInput, dateRange: string): BookSpread {
  const s = input.journeyStats
  const parts = [
    `${s.days} ${s.days === 1 ? 'day' : 'days'}`,
    `${s.entries} ${s.entries === 1 ? 'entry' : 'entries'}`,
    `${s.photos} photos`,
    s.places > 0 ? `${s.places} places` : null,
    s.countries && s.countries > 0 ? `${s.countries} ${s.countries === 1 ? 'country' : 'countries'}` : null,
  ].filter(Boolean)
  const routeStats = formatRouteStats({
    totalDist: s.distanceKm || 0, gain: s.elevationGainM || 0, loss: s.elevationLossM || 0,
    minEle: null, maxEle: null, maxSlope: 0, ibp: null,
  })

  const W = input.page.pageWidth
  const H = input.page.pageHeight
  const B = input.page.bleed
  const overview = input.overviewRoute
  const hasMapLeaf = !!overview

  // Centered across both pages as one poster when there's no map; confined
  // to the right leaf alone (and centered within it) when there is.
  const textX = hasMapLeaf ? W : W * 0.3
  const textW = hasMapLeaf ? W : W * 1.4

  const elements: BookElement[] = []
  if (hasMapLeaf) {
    if (overview!.mapSrc) {
      elements.push(imageEl(elementId('im'), overview!.mapSrc, { x: -B, y: -B, w: W + B, h: H + B * 2 }, 'cover'))
    } else {
      elements.push({ id: elementId('s'), kind: 'shape', frame: { x: -B, y: -B, w: W + B, h: H + B * 2 },
        rotation: 0, opacity: 1, locked: false, shape: 'rect', fill: '#0a0a0f', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0 })
    }
    elements.push({ id: elementId('s'), kind: 'shape', frame: { x: W, y: -B, w: W + B, h: H + B * 2 },
      rotation: 0, opacity: 1, locked: false, shape: 'rect', fill: '#0a0a0f', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0 })
  } else {
    elements.push({ id: elementId('s'), kind: 'shape', frame: { x: -B, y: -B, w: W * 2 + B * 2, h: H + B * 2 },
      rotation: 0, opacity: 1, locked: false, shape: 'rect', fill: '#0a0a0f', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0 })
  }

  elements.push(
    { id: elementId('t'), kind: 'text', frame: { x: textX, y: H * 0.38, w: textW, h: 20 },
      rotation: 0, opacity: 1, locked: false, text: input.title, font: 'display', size: 26, weight: 700, italic: false,
      align: 'center', leading: 1.1, tracking: -0.01, color: '#ffffff', binding: null, overridden: true },
    { id: elementId('t'), kind: 'text', frame: { x: textX, y: H * 0.38 + 26, w: textW, h: 10 },
      // opacity carries the fade — `color` is validated server-side as plain #rrggbb, no alpha.
      rotation: 0, opacity: 0.5, locked: false, text: dateRange, font: 'sans', size: 9, weight: 500, italic: false,
      align: 'center', leading: 1.4, tracking: 0.04, color: '#ffffff', binding: null, overridden: true },
    { id: elementId('t'), kind: 'text', frame: { x: textX, y: H * 0.38 + 44, w: textW, h: 10 },
      rotation: 0, opacity: 1, locked: false, text: parts.join('   ·   '), font: 'sans', size: 10, weight: 700, italic: false,
      align: 'center', leading: 1.4, tracking: 0.08, color: '#2dd4bf', binding: null, overridden: true },
  )

  // The trip's true grand total — always from journeyStats (the whole
  // journey's tracks), never just the overview map's own subset, so the
  // figure reads right even when the map above is a leftover-only route.
  if (routeStats) {
    elements.push({ id: elementId('t'), kind: 'text', frame: { x: textX, y: H * 0.38 + 60, w: textW, h: 10 },
      rotation: 0, opacity: 0.7, locked: false, text: routeStats, font: 'sans', size: 8.5, weight: 500, italic: false,
      align: 'center', leading: 1.4, tracking: 0.04, color: '#ffffff', binding: null, overridden: true })
  }

  if (hasMapLeaf && overview!.elevationSrc) {
    const eleY = H * 0.38 + (routeStats ? 76 : 60)
    elements.push(imageEl(elementId('im'), overview!.elevationSrc, { x: W + 16, y: eleY, w: W - 32, h: H - eleY - 16 }, 'contain'))
  }

  return seedSpread(elementId('sp'), 'inner', elements)
}

/**
 * The page setup for a book that opens on a single first page: that page is
 * page 1. A book from before the first page existed opened onto a spread and
 * started at 2; only the count moves with the page, the rest of the setup is
 * the person's.
 */
function withFirstPage(page: BookPageSetup): BookPageSetup {
  return { ...page, pageNumbers: { show: false, ...page.pageNumbers, startAt: 1 } }
}

/**
 * Empty book: the outside and the opening/closing pages of a bound book —
 * cover, single first page (where a title page or dedication goes), one
 * inner spread, single last page (a colophon), back cover — all blank.
 */
export function emptyBook(page: BookPageSetup, title = ''): BookDocument {
  return {
    version: 1,
    title,
    page: withFirstPage(page),
    spreads: [
      seedSpread(elementId('sp'), 'cover', []),
      seedSpread(elementId('sp'), 'first', []),
      seedSpread(elementId('sp'), 'inner', []),
      seedSpread(elementId('sp'), 'last', []),
      seedSpread(elementId('sp'), 'back', []),
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

/*
 * ── Stations ──────────────────────────────────────────────────────────────
 *
 * Ported from upstream's stationsSpread: a stop with a name but no photos and
 * no story used to vanish from the book entirely — it isn't worth a spread of
 * its own, but a journey's itinerary is part of its story. Consecutive bare
 * stops are set as a printed itinerary instead: date and place, two columns
 * of up to 13 rows each (13 × 3 elements × 2 + heading stays under the
 * schema's 90-element cap per spread).
 */
const STATIONS_PER_PAGE = 13

export function hasSubstance(entry: AutoEntry): boolean {
  return entry.photos.length > 0 || !!entry.story?.trim()
}

function stationShape(frame: { x: number; y: number; w: number; h: number }, fill: string): BookElement {
  return {
    id: elementId('s'), kind: 'shape', frame, rotation: 0, opacity: 1, locked: false,
    shape: 'rect', fill, gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
  } as BookElement
}

export function stationsSpread(entries: AutoEntry[], input: AutoInput): BookSpread {
  const { page, locale } = input
  const W = page.pageWidth
  const H = page.pageHeight
  const m = Math.max(12, Math.min(18, W * 0.085))
  const els: BookElement[] = []
  els.push(stationShape({ x: m, y: m + 12, w: 14, h: 0.5 }, '#c2410c'))
  els.push({ ...textEl(elementId('t'), (input.stationsLabel || 'Stations').toUpperCase(), 8), frame: { x: m, y: m + 18, w: W - m * 2, h: 8 }, weight: 600, tracking: 0.16, color: '#8a8578' })

  const top = m + 34
  const step = Math.min(13, (H - top - m) / STATIONS_PER_PAGE)
  // Type scales with the row height a small page leaves, never above 11pt.
  const nameSize = Math.max(7, Math.min(11, step * 0.85))
  ;[entries.slice(0, STATIONS_PER_PAGE), entries.slice(STATIONS_PER_PAGE, STATIONS_PER_PAGE * 2)].forEach((column, side) => {
    const x = side * W + m
    const w = W - m * 2
    column.forEach((entry, i) => {
      const y = top + i * step
      if (entry.date) {
        const d = new Date(`${entry.date}T00:00:00`)
        const label = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).toUpperCase()
        if (label) els.push({ ...textEl(elementId('t'), label, 7), frame: { x, y, w: w * 0.3, h: 5 }, weight: 600, tracking: 0.1, color: '#a09a8e' })
      }
      const name = entry.title || entry.location || ''
      if (name) {
        els.push({ ...boundTextEl(elementId('t'), name, nameSize, entry.title ? { source: 'entry.title', entryId: entry.id } : { source: 'entry.location', entryId: entry.id }), frame: { x: x + w * 0.32, y: y - 1.5, w: w * 0.68, h: Math.max(5, step - 4) }, weight: 600, color: '#141414' })
      }
      els.push(stationShape({ x, y: y + step - 4.5, w, h: 0.15 }, '#ddd8cf'))
    })
  })
  return { id: elementId('sp'), role: 'inner', background: '#faf8f4', elements: els, parked: [], entryId: null }
}

export function buildBook(input: AutoInput): BookDocument {
  const withContent = input.entries.filter(hasSubstance)
  const dates = withContent.map(e => e.date).filter((d): d is string => !!d).sort()
  const dateRange = dates.length
    ? (dates[0] === dates[dates.length - 1]
      ? new Date(`${dates[0]}T00:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'long', year: 'numeric' })
      : `${new Date(`${dates[0]}T00:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'short' })} – ${new Date(`${dates[dates.length - 1]}T00:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'short', year: 'numeric' })}`)
    : ''

  const spreads: BookSpread[] = [coverSpread(input), seedSpread(elementId('sp'), 'first', [])]
  const routeImages = input.routeImagesByDate
  // The first entry (in withContent's own order) for each date, so a day's
  // route spread — its map and elevation profile — opens that day, the same
  // place JourneyBookPDF.tsx's own per-day route pages already sit, rather
  // than trailing behind it where it reads as a coda to the last entry.
  const firstIndexForDate = new Map<string, number>()
  withContent.forEach((entry, i) => { if (entry.date && !firstIndexForDate.has(entry.date)) firstIndexForDate.set(entry.date, i) })

  // Walk every entry in journey order: entries with substance get their own
  // spread as before; runs of bare named stops between them become station
  // lists (see stationsSpread) instead of disappearing.
  let bare: AutoEntry[] = []
  const flushBare = () => {
    for (let k = 0; k < bare.length; k += STATIONS_PER_PAGE * 2) spreads.push(stationsSpread(bare.slice(k, k + STATIONS_PER_PAGE * 2), input))
    bare = []
  }
  let i = 0
  input.entries.forEach(entry => {
    if (!hasSubstance(entry)) {
      if (entry.title?.trim() || entry.location?.trim()) bare.push(entry)
      return
    }
    flushBare()
    if (entry.date && routeImages?.has(entry.date) && firstIndexForDate.get(entry.date) === i) {
      spreads.push(routeSpread(entry.date, routeImages.get(entry.date)!, input.page, input.locale))
    }
    spreads.push(entrySpread(entry, input, i))
    i++
  })
  flushBare()
  spreads.push(summarySpread(input, dateRange))
  // A bound book's closing pages. Laid down empty on purpose, like the first
  // page after the cover: a colophon or a dedication is the author's call.
  spreads.push(seedSpread(elementId('sp'), 'last', []), seedSpread(elementId('sp'), 'back', []))

  // Cap inner content, never the closing pages.
  const capped = spreads.length > 150 ? [...spreads.slice(0, 148), ...spreads.slice(-2)] : spreads
  return { version: 1, title: input.title, page: withFirstPage(input.page), spreads: capped }
}
