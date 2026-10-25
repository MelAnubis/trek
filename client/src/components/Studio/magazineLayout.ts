/**
 * La revista #ESTODOBAJADA — formato bolsillo al estilo Far Ride (120 × 170
 * mm, muchas páginas, papel sin estucar): portada a sangre con la cabecera
 * pegatina, sumario con nota del editor, cada travesía como reportaje
 * (apertura a doble página, sus entradas con el motor editorial del libro y
 * la ruta al final), cada relato como pieza (apertura, texto a una columna en
 * serif y fotos a página completa), colofón y contraportada.
 *
 * Pure and synchronous like buildBook: everything that needs the network
 * (journeys, stories, route images) is fetched by the caller.
 */
import type { BookDocument, BookElement, BookPageSetup, BookSpread, BookTextElement, BookFontFamily } from '../../types/book'
import { elementId } from './bookIds'
import { entrySpread, estimateTextHeight, hasSubstance, type AutoEntry, type AutoInput } from './autoLayout'
import type { RouteImages } from './buildRouteImages'

export const MAGAZINE_PAGE: BookPageSetup = {
  preset: 'custom', pageWidth: 120, pageHeight: 170, bleed: 3, safe: 8,
  pageNumbers: { show: true, startAt: 1, position: 'outer', margin: 7, size: 6.5, autoColor: true, font: 'jost' },
}

const INK = '#111111'
const GREY = '#71717a'
const PAPER = '#ffffff'

export interface MagazinePhoto { photoId: number; width?: number | null; height?: number | null }

export interface MagazineJourney {
  kind: 'journey'
  title: string
  subtitle: string | null
  author: string | null
  coverPhotoId: number | null
  entries: AutoEntry[]
  days: number
  distanceKm?: number
  gainM?: number
  route?: RouteImages | null
}

export type StoryPiece =
  | { type: 'p'; text: string }
  /** A journal entry's title inside the running text (photo-less entries). */
  | { type: 't'; text: string }
  | { type: 'h'; text: string }
  | { type: 'q'; text: string; cite?: string | null }
  | { type: 'photo'; photo: MagazinePhoto; caption?: string | null; contain?: boolean }

export interface MagazineStory {
  kind: 'story'
  title: string
  standfirst: string | null
  author: string | null
  date: string | null
  coverPhotoId: number | null
  pieces: StoryPiece[]
}

export type MagazineFeature = MagazineJourney | MagazineStory

export interface MagazineInput {
  locale: string
  title: string
  volume: number
  /** "Otoño 2026" — shown on the cover and colophon. */
  season: string
  editorNote: string
  features: MagazineFeature[]
  labels: {
    feature: string; story: string; contents: string; route: string; days: string; by: string
    colophon: string; madeWith: string; editorNote: string
  }
  page?: BookPageSetup
  /** Editorial ("open book") designs for journey entries, as in the book's Auto layout. */
  entryStyle?: 'classic' | 'editorial'
}

// ── Element helpers ─────────────────────────────────────────────────────────

const base = { rotation: 0, opacity: 1, locked: false }

function text(t: string, frame: BookElement['frame'], o: Partial<BookTextElement> & { font?: BookFontFamily } = {}): BookTextElement {
  return {
    id: elementId('t'), kind: 'text', frame, ...base, text: t, font: 'inter', size: 9, weight: 400, italic: false, align: 'left',
    leading: 1.4, tracking: 0, color: INK, binding: null, overridden: true, ...o,
  }
}

function rect(frame: BookElement['frame'], fill: string, o: Partial<{ opacity: number; gradient: 'none' | 'up' | 'down' }> = {}): BookElement {
  return { id: elementId('s'), kind: 'shape', frame, ...base, opacity: o.opacity ?? 1, shape: 'rect', fill, gradient: o.gradient ?? 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0 } as BookElement
}

function photo(photoId: number, frame: BookElement['frame'], fit: 'cover' | 'contain' = 'cover'): BookElement {
  return { id: elementId('p'), kind: 'photo', frame, ...base, photoId, fit, focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null } as BookElement
}

function image(src: string, frame: BookElement['frame'], fit: 'cover' | 'contain' = 'cover'): BookElement {
  return { id: elementId('im'), kind: 'image', frame, ...base, src, fit, radius: 0 } as BookElement
}

/** Rough width of a Jost Light caps line with 0.1em tracking, in mm. */
function stickerWidth(label: string, sizePt: number): number {
  return label.length * sizePt * 0.3528 * 0.74
}

/** The #ESTODOBAJADA sticker: a black (or white) box hugging the word. */
function sticker(x: number, y: number, sizePt: number, inverted = false, label = '#ESTODOBAJADA'): BookElement[] {
  const padX = sizePt * 0.42, padY = sizePt * 0.3
  const w = stickerWidth(label, sizePt) + padX * 2
  const h = sizePt * 0.3528 * 1.25 + padY * 2
  return [
    rect({ x, y, w, h }, inverted ? PAPER : INK),
    text(label, { x: x + padX * 0.6, y: y + padY * 0.85, w: w - padX * 1.2, h: h - padY }, { font: 'jost', size: sizePt, weight: 300, tracking: 0.1, leading: 1, color: inverted ? INK : PAPER, align: 'center' }),
  ]
}

const kicker = (t: string, frame: BookElement['frame'], color = INK) =>
  text(t.toUpperCase(), frame, { font: 'jost', size: 6.5, weight: 400, tracking: 0.22, leading: 1.2, color })

// ── Pages ───────────────────────────────────────────────────────────────────

/** One page's elements, in that page's own coordinates (0…W). */
type Page = { els: BookElement[]; tag?: string }
type Item = { page: Page } | { spread: BookSpread }

function shift(els: BookElement[], dx: number): BookElement[] {
  return els.map(e => ({ ...e, frame: { ...e.frame, x: e.frame.x + dx } }))
}

function fullBleedPhoto(p: MagazinePhoto, pg: BookPageSetup, contain = false): BookElement[] {
  const { pageWidth: W, pageHeight: H, bleed: B } = pg
  if (contain) return [photo(p.photoId, { x: 10, y: 14, w: W - 20, h: H - 34 }, 'contain')]
  return [photo(p.photoId, { x: -B, y: -B, w: W + B * 2, h: H + B * 2 })]
}

function blackPage(pg: BookPageSetup): BookElement[] {
  const { pageWidth: W, pageHeight: H, bleed: B } = pg
  return [rect({ x: -B, y: -B, w: W + B * 2, h: H + B * 2 }, INK)]
}

/** The brand filler: closes a spread so the next feature opens on a left page. */
function stickerPage(pg: BookPageSetup, n: number): Page {
  const { pageWidth: W, pageHeight: H } = pg
  const size = 9
  const w = stickerWidth('#ESTODOBAJADA', size) + size * 0.84
  return n % 2 === 0
    ? { els: [...blackPage(pg), ...sticker((W - w) / 2, H / 2 - 4, size, true)], tag: 'filler' }
    : { els: [...sticker((W - w) / 2, H / 2 - 4, size)], tag: 'filler' }
}

function openerRight(pg: BookPageSetup, k: string, title: string, standfirst: string | null, meta: string, byline: string | null): BookElement[] {
  const { pageWidth: W, pageHeight: H } = pg
  const M = 11
  const titleSize = title.length > 40 ? 17 : title.length > 22 ? 20 : 24
  const titleH = estimateTextHeight(title, W - M * 2, titleSize, 1.02) + 4
  const els: BookElement[] = [
    kicker(k, { x: M, y: M + 2, w: W - M * 2, h: 5 }),
    rect({ x: M, y: M + 9, w: 10, h: 0.6 }, INK),
    text(title, { x: M, y: M + 16, w: W - M * 2, h: titleH }, { size: titleSize, weight: 700, leading: 1.02, tracking: -0.02 }),
  ]
  let y = M + 16 + titleH + 4
  if (standfirst) {
    const s = standfirst.length > 320 ? `${standfirst.slice(0, 317).trimEnd()}…` : standfirst
    const h = estimateTextHeight(s, W - M * 2, 9, 1.45) + 3
    els.push(text(s, { x: M, y, w: W - M * 2, h }, { font: 'serif', size: 9, italic: true, leading: 1.45, color: '#3f3f46' }))
    y += h
  }
  els.push(rect({ x: M, y: H - M - 20, w: W - M * 2, h: 0.25 }, INK))
  if (meta) els.push(text(meta.toUpperCase(), { x: M, y: H - M - 16, w: W - M * 2, h: 5 }, { font: 'jost', size: 6.5, tracking: 0.16, leading: 1.2 }))
  if (byline) els.push(text(byline, { x: M, y: H - M - 9, w: W - M * 2, h: 5 }, { size: 7, color: GREY }))
  return els
}

/** Body text for a story, one column of serif per page; photos get their own page. */
function storyPages(story: MagazineStory, pg: BookPageSetup): Page[] {
  const { pageWidth: W, pageHeight: H } = pg
  const M = 13, top = 16, bottom = 18
  const boxW = W - M * 2
  const boxH = H - top - bottom
  const SIZE = 8.6, LEAD = 1.52
  const pages: Page[] = []
  let cur: BookElement[] = []
  let y = top
  const flush = () => { if (cur.length) pages.push({ els: cur }); cur = []; y = top }

  const put = (t: string, o: Partial<BookTextElement>, size: number, lead: number, gapAfter: number) => {
    let rest = t.trim()
    while (rest) {
      const room = top + boxH - y
      const h = estimateTextHeight(rest, boxW, size, lead)
      if (h <= room) {
        cur.push(text(rest, { x: M, y, w: boxW, h: h + 1.5 }, { ...o, size, leading: lead }))
        y += h + gapAfter
        return
      }
      // Fit as many words as the page has room for; the rest continues overleaf.
      const words = rest.split(/\s+/)
      let lo = 0, hi = words.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (estimateTextHeight(words.slice(0, mid).join(' '), boxW, size, lead) <= room) lo = mid
        else hi = mid - 1
      }
      if (lo < 4) { flush(); continue }
      const head = words.slice(0, lo).join(' ')
      cur.push(text(head, { x: M, y, w: boxW, h: room }, { ...o, size, leading: lead }))
      flush()
      rest = words.slice(lo).join(' ')
    }
  }

  for (const piece of story.pieces) {
    if (piece.type === 'photo') {
      flush()
      const els = fullBleedPhoto(piece.photo, pg, piece.contain)
      if (piece.caption) els.push(text(piece.caption, { x: M, y: H - 12, w: boxW, h: 6 }, { size: 6.5, italic: true, color: piece.contain ? GREY : PAPER, font: 'serif' }))
      pages.push({ els })
      continue
    }
    if (piece.type === 't') {
      if (top + boxH - y < 36) flush()
      if (y > top) y += 4
      put(piece.text, { font: 'inter', weight: 700, tracking: -0.01 }, 12, 1.12, 2.5)
      continue
    }
    if (piece.type === 'h') {
      if (top + boxH - y < 30) flush()
      put(piece.text.toUpperCase(), { font: 'jost', weight: 400, tracking: 0.16 }, 7.5, 1.3, 3)
      continue
    }
    if (piece.type === 'q') {
      if (top + boxH - y < 40) flush()
      put(`«${piece.text.replace(/^[«"“]|[»"”]$/g, '')}»`, { font: 'serif', italic: true }, 12, 1.25, piece.cite ? 1.5 : 5)
      if (piece.cite) put(`— ${piece.cite}`, { color: GREY }, 7, 1.3, 5)
      continue
    }
    put(piece.text, { font: 'serif' }, SIZE, LEAD, 3.2)
  }
  flush()
  return pages
}

function journeyRoutePages(j: MagazineJourney, pg: BookPageSetup, labels: MagazineInput['labels'], locale: string): Page[] {
  if (!j.route?.mapSrc && !j.route?.elevationSrc) return []
  const { pageWidth: W, pageHeight: H, bleed: B } = pg
  const M = 11
  const left: BookElement[] = j.route.mapSrc
    ? [image(j.route.mapSrc, { x: -B, y: -B, w: W + B * 2, h: H + B * 2 })]
    : blackPage(pg)
  const s = j.route.stats
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const lines = [
    s.totalDist ? `${nf.format(s.totalDist)} km` : null,
    s.gain ? `+${nf.format(s.gain)} m` : null,
    s.loss ? `−${nf.format(s.loss)} m` : null,
    s.maxEle != null ? `${nf.format(s.maxEle)} m máx.` : null,
  ].filter(Boolean) as string[]
  const right: BookElement[] = [
    kicker(labels.route, { x: M, y: M + 2, w: W - M * 2, h: 5 }),
    rect({ x: M, y: M + 9, w: 10, h: 0.6 }, INK),
    text(j.title, { x: M, y: M + 15, w: W - M * 2, h: 22 }, { size: 13, weight: 700, leading: 1.05, tracking: -0.01 }),
  ]
  lines.forEach((l, i) => right.push(text(l, { x: M, y: M + 42 + i * 11, w: W - M * 2, h: 10 }, { size: 15, weight: 700, tracking: -0.01, leading: 1 })))
  if (j.route.elevationSrc) right.push(image(j.route.elevationSrc, { x: M, y: H - M - 52, w: W - M * 2, h: 44 }, 'contain'))
  return [{ els: left, tag: 'route' }, { els: right }]
}

/** An inner spread as two single pages (left, right), in each page's own coordinates. */
function splitSpread(sp: BookSpread, pg: BookPageSetup): Page[] {
  const { pageWidth: W, pageHeight: H, bleed: B } = pg
  // A frame the entry has no photo for would print as a placeholder: leave white space instead.
  const els = sp.elements.filter(el => !(el.kind === 'photo' && (el as { photoId: number | null }).photoId == null))
  const bg = (x: number) => (sp.background ? [rect({ x, y: -B, w: W + B, h: H + B * 2 }, sp.background)] : [])
  const left = els.filter(e => e.frame.x + e.frame.w / 2 < W)
  const right = els.filter(e => e.frame.x + e.frame.w / 2 >= W)
  // A half left with nothing on it (its only frame had no photo) is skipped, not printed blank.
  return [left.length ? { els: [...bg(-B), ...left] } : null, right.length ? { els: [...bg(0), ...shift(right, -W)] } : null].filter((p): p is Page => !!p)
}

// ── Build ───────────────────────────────────────────────────────────────────

function seed(role: BookSpread['role'], elements: BookElement[], background: string | null = null): BookSpread {
  return { id: elementId('sp'), role, background, elements, parked: [], entryId: null }
}

export function buildMagazine(input: MagazineInput): BookDocument {
  const pg = input.page ?? MAGAZINE_PAGE
  const { pageWidth: W, pageHeight: H, bleed: B } = pg
  const M = 11
  const L = input.labels
  const items: Item[] = []
  let pagesSoFar = 0 // inner pages placed (0 = next is a left page)
  let fillers = 0
  const starts: { title: string; kind: 'journey' | 'story'; page: number }[] = []

  const pushPage = (p: Page) => { items.push({ page: p }); pagesSoFar++ }
  const alignLeft = () => { if (pagesSoFar % 2 === 1) pushPage(stickerPage(pg, fillers++)) }

  input.features.forEach((f, fi) => {
    alignLeft()
    starts.push({ title: f.title, kind: f.kind, page: 2 + pagesSoFar })
    const k = `${f.kind === 'journey' ? L.feature : L.story} · ${String(fi + 1).padStart(2, '0')}`
    const left = f.coverPhotoId ? fullBleedPhoto({ photoId: f.coverPhotoId }, pg) : [...blackPage(pg), ...sticker(M, M, 8, true)]
    if (f.kind === 'journey') {
      const meta = [f.days ? `${f.days} ${L.days}` : null, f.distanceKm ? `${Math.round(f.distanceKm)} km` : null, f.gainM ? `+${Math.round(f.gainM)} m` : null].filter(Boolean).join(' · ')
      pushPage({ els: left, tag: 'opener' })
      pushPage({ els: openerRight(pg, k, f.title, f.subtitle, meta, f.author ? `${L.by} ${f.author}` : null) })
      const auto: AutoInput = {
        locale: input.locale, title: f.title, subtitle: f.subtitle, coverPhotoId: f.coverPhotoId, entries: f.entries, page: pg,
        style: input.entryStyle ?? 'classic', dayLabel: L.days.toUpperCase(),
        journeyStats: { days: f.days, entries: f.entries.length, photos: f.entries.reduce((n, e) => n + e.photos.length, 0), places: 0 },
      }
      // Entries without photos run on as text (one column of serif, like a
      // story) instead of each getting a spread of empty frames; entries
      // with photos get the book's own entry layouts.
      let run: StoryPiece[] = []
      const flushRun = () => {
        if (!run.length) return
        storyPages({ kind: 'story', title: f.title, standfirst: null, author: null, date: null, coverPhotoId: null, pieces: run }, pg).forEach(pushPage)
        run = []
      }
      f.entries.filter(hasSubstance).forEach((e, i) => {
        // The cover photo already opened the feature: an entry whose only photo it is goes on as text.
        const entry = e.photos.length === 1 && e.photos[0].photoId === f.coverPhotoId && e.story?.trim() ? { ...e, photos: [] } : e
        if (!hasSubstance(entry)) return
        if (!entry.photos.length) {
          const meta = [entry.date ? new Date(`${entry.date}T12:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'long' }) : null, entry.location].filter(Boolean).join(' · ')
          if (meta) run.push({ type: 'h', text: meta })
          if (entry.title) run.push({ type: 't', text: entry.title })
          ;(entry.story || '').split(/\n{2,}/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean).forEach(p => run.push({ type: 'p', text: p }))
          return
        }
        flushRun()
        // The book's entry layouts never cross the gutter (each page stands on
        // its own), so the spread goes in as two pages: it can start on either
        // side and no filler is needed to line it up.
        splitSpread(entrySpread(entry, auto, i), pg).forEach(pushPage)
      })
      flushRun()
      journeyRoutePages(f, pg, L, input.locale).forEach((p, i) => { if (i === 0) alignLeft(); pushPage(p) })
    } else {
      const meta = f.date ? new Date(`${f.date}T12:00:00`).toLocaleDateString(input.locale, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
      pushPage({ els: left, tag: 'opener' })
      pushPage({ els: openerRight(pg, k, f.title, f.standfirst, meta, f.author ? `${L.by} ${f.author}` : null) })
      const pieces = f.coverPhotoId ? f.pieces.filter(p => !(p.type === 'photo' && p.photo.photoId === f.coverPhotoId)) : f.pieces
      storyPages({ ...f, pieces }, pg).forEach(pushPage)
    }
  })
  alignLeft()

  // Pages → inner spreads (left at 0…W, right at W…2W).
  const spreads: BookSpread[] = []
  let pending: Page | null = null
  for (const it of items) {
    if ('spread' in it) { spreads.push(it.spread); continue }
    if (!pending) { pending = it.page; continue }
    spreads.push(seed('inner', [...pending.els, ...shift(it.page.els, W)]))
    pending = null
  }
  if (pending) spreads.push(seed('inner', [...pending.els, ...shift(stickerPage(pg, fillers++).els, W)]))

  // ── Cover ──
  const coverPhoto = input.features.find(f => f.coverPhotoId)?.coverPhotoId ?? null
  const cover: BookElement[] = coverPhoto
    ? [photo(coverPhoto, { x: -B, y: -B, w: W + B * 2, h: H + B * 2 }), rect({ x: -B, y: H * 0.5, w: W + B * 2, h: H * 0.5 + B }, '#000000', { gradient: 'up', opacity: 0.75 })]
    : blackPage(pg)
  cover.push(...sticker(M, M, 13))
  cover.push(text(`TREK WANDERER · VOL. ${input.volume} · ${input.season.toUpperCase()}`, { x: M, y: M + 14, w: W - M * 2, h: 5 }, { font: 'jost', size: 5.6, tracking: 0.3, color: PAPER, leading: 1.2 }))
  const lines = input.features.slice(0, 4).map(f => f.title)
  lines.forEach((t, i) => cover.push(text(t, { x: M, y: H - M - (lines.length - i) * 9.5, w: W - M * 2, h: 9 }, { size: 8.5, weight: 700, color: PAPER, leading: 1.1 })))

  // ── First page: contents + editor's note ──
  const first: BookElement[] = [
    kicker(L.contents, { x: M, y: M + 2, w: W - M * 2, h: 5 }),
    rect({ x: M, y: M + 9, w: 10, h: 0.6 }, INK),
    text(input.title, { x: M, y: M + 14, w: W - M * 2, h: 14 }, { size: 15, weight: 700, leading: 1.05, tracking: -0.02 }),
  ]
  let cy = M + 34
  starts.slice(0, 12).forEach((s, i) => {
    first.push(text(String(s.page).padStart(2, '0'), { x: M, y: cy, w: 10, h: 6 }, { font: 'jost', size: 8, weight: 400, color: GREY }))
    first.push(text(s.title, { x: M + 12, y: cy, w: W - M * 2 - 12, h: 9 }, { size: 8.5, weight: 600, leading: 1.15 }))
    first.push(text((s.kind === 'journey' ? L.feature : L.story).toUpperCase(), { x: M + 12, y: cy + (s.title.length > 34 ? 9 : 5.2), w: 60, h: 4 }, { font: 'jost', size: 5.5, tracking: 0.18, color: GREY }))
    cy += s.title.length > 34 ? 16 : 12.5
    if (i < starts.length - 1) first.push(rect({ x: M, y: cy - 2.5, w: W - M * 2, h: 0.15 }, '#d4d4d8'))
  })
  const noteY = Math.max(cy + 6, H - M - 46)
  first.push(kicker(L.editorNote, { x: M, y: noteY, w: W - M * 2, h: 5 }, GREY))
  first.push(text(input.editorNote, { x: M, y: noteY + 7, w: W - M * 2, h: H - M - noteY - 8 }, { font: 'serif', size: 7.5, italic: true, leading: 1.45, color: '#3f3f46' }))

  // ── Last page: colophon ──
  const authors = [...new Set(input.features.map(f => f.author).filter(Boolean))] as string[]
  const last: BookElement[] = [
    ...sticker(M, M, 9),
    text(`${input.title} · Vol. ${input.volume} · ${input.season}`, { x: M, y: M + 16, w: W - M * 2, h: 6 }, { size: 7.5, weight: 600 }),
    kicker(L.colophon, { x: M, y: H - M - 44, w: W - M * 2, h: 5 }, GREY),
    text(authors.length ? `${L.by} ${authors.join(', ')}.` : '', { x: M, y: H - M - 36, w: W - M * 2, h: 10 }, { font: 'serif', size: 7.5, leading: 1.45 }),
    text(L.madeWith, { x: M, y: H - M - 22, w: W - M * 2, h: 14 }, { font: 'serif', size: 7.5, italic: true, leading: 1.45, color: GREY }),
  ]

  // ── Back cover ──
  const bw = stickerWidth('#ESTODOBAJADA', 12) + 12 * 0.84
  const back: BookElement[] = [
    ...blackPage(pg),
    ...sticker((W - bw) / 2, H * 0.42, 12, true),
    text('TREK WANDERER', { x: M, y: H * 0.42 + 16, w: W - M * 2, h: 5 }, { font: 'jost', size: 6, tracking: 0.5, color: PAPER, align: 'center' }),
    text(`VOL. ${input.volume} · ${input.season.toUpperCase()} · TREKWANDERER.INFO`, { x: M, y: H - M - 6, w: W - M * 2, h: 5 }, { font: 'jost', size: 5.5, tracking: 0.25, color: '#a1a1aa', align: 'center' }),
  ]

  const all = [seed('cover', cover), seed('first', first), ...spreads, seed('last', last), seed('back', back)]
  const capped = all.length > 150 ? [...all.slice(0, 147), ...all.slice(-3)] : all
  return { version: 1, title: input.title, page: pg, spreads: capped }
}

/** A season label for the issue date, e.g. "Otoño 2026". */
export function seasonLabel(date: Date, names: [string, string, string, string]): string {
  const m = date.getMonth()
  const i = m < 2 || m === 11 ? 0 : m < 5 ? 1 : m < 8 ? 2 : 3 // winter, spring, summer, autumn
  const year = m === 11 ? date.getFullYear() + 1 : date.getFullYear()
  return `${names[i]} ${year}`
}
