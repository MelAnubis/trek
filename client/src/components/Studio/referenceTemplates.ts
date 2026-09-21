import type { BookElement, BookMetric, BookPageSetup, BookSpread } from '../../types/book'
import { SPREAD_TEMPLATES, type SpreadTemplate } from './bookTemplates.data'
import { formatBookCoords, formatBookDate } from './entryText'
import { coordValue } from './resolveBindings'

/**
 * Laying an entry out on a template somebody drew — ported from
 * liketrek/trek's client/src/components/Studio/applyTemplate.ts (same
 * AGPLv3 license) and adapted to this fork's narrower `AutoEntry`/
 * `AutoInput` (no country codes, day numbers or per-journey step/weather
 * data — see bookTemplates.data.ts's own note on what that means for the
 * badges and stats a reference template can carry).
 *
 * Tried before autoLayout.ts's own 12 programmatic templates, and that
 * order is the point: a page somebody designed beats a page a function
 * reasoned its way to, whenever one of the six fits.
 */

export interface ReferenceEntry {
  id: number
  title: string | null
  story: string | null
  location: string | null
  date: string | null
  photos: { photoId: number }[]
  lat?: number | null
  lng?: number | null
}

export interface ReferenceContext {
  page: BookPageSetup
  locale: string
  /** Only the figures this fork actually has — see fillStats/fillBadge below for what stays as drawn. */
  journeyStats?: { days?: number; photos?: number; places?: number; distanceKm?: number }
}

let seq = 0
const uid = (p: string) => `${p}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`

/** Mirrors the server's MAX_TEXT_LENGTH — see resolveBindings.ts's own copy of this note. */
const MAX_TEXT_LENGTH = 8000

/**
 * Whether any element's frame crosses the page gutter, in the fraction
 * space these templates are drawn in — the gutter sits at x = 1.0, one page
 * width in. See bookTemplates.data.ts's header for which two templates
 * this excludes and why.
 */
function crossesGutter(template: SpreadTemplate): boolean {
  return template.elements.some(el => el.frame.x < 1 && el.frame.x + el.frame.w > 1)
}

/** How well a template suits an entry: more is better, -1 means unusable. */
export function referenceTemplateFit(template: SpreadTemplate, entry: ReferenceEntry): number {
  if (crossesGutter(template)) return -1

  const frames = template.elements.filter(e => e.kind === 'photo').length
  const photos = entry.photos.length
  const wantsStory = template.elements.some(e => e.kind === 'text' && e.binding?.source === 'entry.story')
  const hasStory = !!(entry.story || '').trim()

  // A template is a template *for an entry* when it uses one — a bound
  // text or an empty photo frame is what says a page expects one.
  const usesEntry = template.elements.some(e => ('binding' in e && e.binding) || (e.kind === 'photo' && e.photoId == null))
  if (!usesEntry) return -1

  // More photos than frames is fine (the extras are parked); fewer leaves
  // placeholders on a finished page, which is worse than a simpler layout.
  if (frames > photos + 1) return -1
  if (wantsStory && !hasStory) return -1

  return 100 - Math.abs(frames - photos) * 10 - (wantsStory === hasStory ? 0 : 5)
}

/**
 * Pick a reference template for an entry, or null if none of the six fit.
 * Rotated among near-equal fits by `seed` (the entry's position in the
 * book) so a run of similar entries doesn't all land on the same design —
 * the same reasoning autoLayout.ts's own `bestTemplate` rotation uses for
 * the 12 programmatic templates.
 */
export function pickReferenceTemplate(entry: ReferenceEntry, seed: number): SpreadTemplate | null {
  const scored = SPREAD_TEMPLATES.map(t => ({ t, fit: referenceTemplateFit(t, entry) })).filter(x => x.fit >= 0)
  if (!scored.length) return null
  scored.sort((a, b) => b.fit - a.fit)
  const best = scored[0].fit
  const ties = scored.filter(x => x.fit >= best - 5)
  return ties[seed % ties.length].t
}

/** Fill a template with an entry, and hand back the spread it makes. */
export function applyReferenceTemplate(template: SpreadTemplate, entry: ReferenceEntry, ctx: ReferenceContext): BookSpread {
  const PW = ctx.page.pageWidth
  const PH = ctx.page.pageHeight

  let nextPhoto = 0
  const story = (entry.story || '').trim().slice(0, MAX_TEXT_LENGTH)
  const heading = (entry.title || entry.location || '').slice(0, MAX_TEXT_LENGTH)

  const elements = template.elements.map(el => {
    const out = {
      ...el,
      id: uid(el.kind[0]),
      frame: {
        x: round2(el.frame.x * PW),
        y: round2(el.frame.y * PH),
        w: round2(el.frame.w * PW),
        h: round2(el.frame.h * PH),
      },
    } as BookElement

    // Sizes came out as fractions of the page height, so they go back up.
    if ('size' in out) out.size = round2(out.size * PH)
    if ('radius' in out) out.radius = round2(out.radius * PW)
    if ('strokeWidth' in out) out.strokeWidth = round2(out.strokeWidth * PW)

    if (out.kind === 'text' && out.binding) {
      const source = out.binding.source
      const format = out.binding.format
      // What the words were made from, where they were made rather than copied — see resolveBindings.ts's own note.
      let value: string | undefined
      if (source === 'entry.title') out.text = heading
      else if (source === 'entry.story') out.text = story
      else if (source === 'entry.date') {
        out.text = formatBookDate(entry.date, ctx.locale)
        value = entry.date ?? undefined
      } else if (source === 'entry.location') {
        if (format && entry.lat != null && entry.lng != null) {
          out.text = formatBookCoords(entry.lat, entry.lng, format)
          value = coordValue(entry.lat, entry.lng)
        } else if (!format && entry.location) {
          out.text = entry.location
        }
      }
      out.binding = { ...out.binding, entryId: entry.id, ...(value ? { value } : {}) }
    }

    if (out.kind === 'photo' && out.photoId == null) {
      const photo = entry.photos[nextPhoto++]
      if (photo) out.photoId = photo.photoId
    }

    if (out.kind === 'badge') fillBadge(out, entry, ctx)
    if (out.kind === 'stats') fillStats(out, ctx)

    return out
  })

  return { id: uid('sp'), role: 'inner', background: template.background, elements, parked: [], entryId: entry.id }
}

/**
 * The small marks, filled from what this fork can actually answer. A badge
 * whose value it cannot — day, flag, country, weather, altitude, mood, all
 * of which need data this fork's journal entries don't carry yet — keeps
 * the text it was drawn with, same as upstream's own fillBadge does for a
 * mark the entry cannot answer.
 */
function fillBadge(el: BookElement & { kind: 'badge' }, entry: ReferenceEntry, ctx: ReferenceContext) {
  if (el.variant === 'coords' && entry.lat != null && entry.lng != null) {
    el.text = formatBookCoords(entry.lat, entry.lng)
  }
  if (el.variant === 'distance' && ctx.journeyStats?.distanceKm) {
    el.text = `${Math.round(ctx.journeyStats.distanceKm).toLocaleString(ctx.locale)} km`
  }
}

/**
 * The figures this fork tracks — days, photos, places and (when a linked
 * trip has a GPX track) distance. `steps`, `countries` and `furthest` have
 * no source here yet, so they're left at whatever the template was drawn
 * showing, the same bargain every other unanswerable figure gets.
 */
function fillStats(el: BookElement & { kind: 'stats' }, ctx: ReferenceContext) {
  if (!ctx.journeyStats) return
  const values: Partial<Record<BookMetric, number>> = { ...el.values }
  if (ctx.journeyStats.days != null) values.days = ctx.journeyStats.days
  if (ctx.journeyStats.photos != null) values.photos = ctx.journeyStats.photos
  if (ctx.journeyStats.places != null) values.places = ctx.journeyStats.places
  if (ctx.journeyStats.distanceKm != null) values.distance = Math.round(ctx.journeyStats.distanceKm * 1000)
  el.values = values
}

const round2 = (n: number) => Math.round(n * 100) / 100
