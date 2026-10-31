import { clusterPalettes, contrastRatio, deltaE, parseHex, readableInk, toHex, toHsl, type PaletteSwatch } from './bookColour'
import {
  BOOK_COLOR_TOKENS, BOOK_FONT_SLOTS,
  type BookColorToken, type BookDocument, type BookElement, type BookFontFamily, type BookFontSlot, type BookPalette,
  type BookSpread, type BookTextElement, type BookTheme, type BookThemeDecoration, type BookThemeFont, type BookThemeMotif,
} from '../../types/book'
import { BOOK_FONTS } from './bookFonts'

/**
 * Book themes (5.7.6) — ported from liketrek/TREK's shared/src/book/theme/
 * (book-theme.ts, book-themes.data.ts, book-theme-apply.ts, book-theme-adopt.ts,
 * book-theme-links.ts and book-theme-photos.ts).
 *
 * A theme is a palette, a face per role and the motifs that belong to it,
 * kept on the document. Elements keep their real colours and fonts; a link
 * beside them (`token`, `strokeToken`, `accentToken`, `fontRole`, a page's
 * `backgroundToken`) says which entry they follow. Applying a theme rewrites
 * what is linked and leaves the rest alone, and with "adopt" links first what
 * a book made before themes (or by hand) never linked.
 *
 * The faces are the families upstream names, all shipped by Trek since 5.7.10
 * (bookFonts.ts).
 */

export interface BookThemeFontPick { font: BookFontFamily; weight?: number }

export interface BookThemePreset {
  id: string
  /** What the Studio calls it. */
  labelKey: string
  /** One line on what it looks like, for the Studio's card. */
  descrKey: string
  descr: string
  palette: BookPalette
  fonts: { display: BookThemeFontPick; heading: BookThemeFontPick; body: BookThemeFontPick; script: BookThemeFontPick | null }
  motifs: readonly BookThemeMotif[]
  decoration: BookThemeDecoration
  frameStyle: BookTheme['frameStyle']
  tilt: number
}

export const BOOK_THEME_PRESETS: readonly BookThemePreset[] = [
  {
    id: 'poster-pop',
    labelKey: 'studio.theme.name.posterPop',
    descrKey: 'studio.theme.descr.posterPop',
    descr:
      'Loud travel poster: cream paper, hot coral and sunflower blocks, heavy condensed titles, tropical stickers.',
    palette: { paper: '#fbf1de', ink: '#1d1a2f', accent: '#ef4e45', accent2: '#ffbf3c', accent3: '#13807b' },
    fonts: {
      display: { font: 'archivo', weight: 400 },
      heading: { font: 'anton', weight: 400 },
      body: { font: 'inter' },
      script: { font: 'kaushan', weight: 400 },
    },
    motifs: ['tropical', 'doodles'],
    decoration: 'rich',
    frameStyle: 'white',
    tilt: 4,
  },
  {
    id: 'cutout',
    labelKey: 'studio.theme.name.cutout',
    descrKey: 'studio.theme.descr.cutout',
    descr: 'Matisse cut-outs: cobalt paper, coral and sand shapes, white type, spaced condensed caps.',
    palette: { paper: '#2445b8', ink: '#fdf8ef', accent: '#ff7a59', accent2: '#f1d9b5', accent3: '#9fd3ff' },
    fonts: {
      display: { font: 'shoulders', weight: 800 },
      heading: { font: 'oswald', weight: 500 },
      body: { font: 'inter' },
      script: { font: 'caveat', weight: 400 },
    },
    motifs: ['sea', 'doodles'],
    decoration: 'light',
    frameStyle: 'white',
    tilt: 2,
  },
  {
    id: 'postcard',
    labelKey: 'studio.theme.name.postcard',
    descrKey: 'studio.theme.descr.postcard',
    descr:
      'Illustrated postcard: pastel mint paper, navy ink, stamp red and peach, a display serif with a script subtitle.',
    palette: { paper: '#e3f1e8', ink: '#1f2d4d', accent: '#c8453d', accent2: '#ec8f6a', accent3: '#f3d58a' },
    fonts: {
      display: { font: 'dmserif', weight: 400 },
      heading: { font: 'montserrat', weight: 600 },
      body: { font: 'inter' },
      script: { font: 'dancing', weight: 400 },
    },
    motifs: ['landmarks', 'mediterranean'],
    decoration: 'light',
    frameStyle: 'white',
    tilt: 0,
  },
  {
    id: 'riviera',
    labelKey: 'studio.theme.name.riviera',
    descrKey: 'studio.theme.descr.riviera',
    descr: 'Mediterranean summer: warm white paper, azure, olive and lemon yellow, a soft serif with a flowing script.',
    palette: { paper: '#fffaf0', ink: '#22324a', accent: '#2a78bd', accent2: '#6f7f34', accent3: '#e9b824' },
    fonts: {
      display: { font: 'fraunces', weight: 600 },
      heading: { font: 'montserrat', weight: 500 },
      body: { font: 'serif' },
      script: { font: 'vibes', weight: 400 },
    },
    motifs: ['mediterranean', 'sea'],
    decoration: 'light',
    frameStyle: 'none',
    tilt: 0,
  },
  {
    id: 'fabric-classic',
    labelKey: 'studio.theme.name.fabricClassic',
    descrKey: 'studio.theme.descr.fabricClassic',
    descr:
      'Linen-bound classic: linen paper, dusty blue and terracotta, an elegant serif over Garamond, fine ornaments.',
    palette: { paper: '#efe8db', ink: '#2e2a26', accent: '#5f7d99', accent2: '#b0603c', accent3: '#97a184' },
    fonts: {
      display: { font: 'cormorant', weight: 500 },
      heading: { font: 'montserrat', weight: 500 },
      body: { font: 'garamond' },
      script: { font: 'sacramento', weight: 400 },
    },
    motifs: ['nordic', 'ornaments'],
    decoration: 'light',
    frameStyle: 'none',
    tilt: 0,
  },
  {
    id: 'minimal-serif',
    labelKey: 'studio.theme.name.minimalSerif',
    descrKey: 'studio.theme.descr.minimalSerif',
    descr:
      'Gallery minimal: white paper, warm grey and sand, a very large thin serif title, hairline ornaments, no script.',
    palette: { paper: '#ffffff', ink: '#222222', accent: '#857d72', accent2: '#cbbda6', accent3: '#54504a' },
    fonts: {
      display: { font: 'cormorant', weight: 300 },
      heading: { font: 'montserrat', weight: 300 },
      body: { font: 'inter' },
      script: null,
    },
    motifs: ['ornaments'],
    decoration: 'none',
    frameStyle: 'none',
    tilt: 0,
  },
  {
    id: 'grid-badge',
    labelKey: 'studio.theme.name.gridBadge',
    descrKey: 'studio.theme.descr.gridBadge',
    descr: 'Photo grid with a badge: white paper, black ink, one red accent, heavy geometric caps, travel ephemera.',
    palette: { paper: '#ffffff', ink: '#141414', accent: '#e2412f', accent2: '#f2eee7', accent3: '#6f6f6f' },
    fonts: {
      display: { font: 'montserrat', weight: 800 },
      heading: { font: 'montserrat', weight: 600 },
      body: { font: 'inter' },
      script: { font: 'allura', weight: 400 },
    },
    motifs: ['ephemera'],
    decoration: 'light',
    frameStyle: 'none',
    tilt: 0,
  },
  {
    id: 'scrapbook-script',
    labelKey: 'studio.theme.name.scrapbookScript',
    descrKey: 'studio.theme.descr.scrapbookScript',
    descr: 'Handmade scrapbook: kraft paper, cream and red, marker titles, handwriting, tape, doodles and tickets.',
    palette: { paper: '#dcc6a2', ink: '#2b2118', accent: '#c2342a', accent2: '#f8f1e1', accent3: '#2f4f7a' },
    fonts: {
      display: { font: 'marker', weight: 400 },
      heading: { font: 'caveat', weight: 700 },
      body: { font: 'serif' },
      script: { font: 'homemade', weight: 400 },
    },
    motifs: ['paper', 'doodles', 'ephemera'],
    decoration: 'rich',
    frameStyle: 'polaroid',
    tilt: 3,
  },
  {
    id: 'tropical',
    labelKey: 'studio.theme.name.tropical',
    descrKey: 'studio.theme.descr.tropical',
    descr: 'Tropical holiday: cream paper, jungle green, hibiscus red and mango, a fat retro title and a beach script.',
    palette: { paper: '#fbf5e6', ink: '#13382a', accent: '#1d7a4c', accent2: '#dc3446', accent3: '#f29d34' },
    fonts: {
      display: { font: 'shrikhand', weight: 400 },
      heading: { font: 'oswald', weight: 500 },
      body: { font: 'sans' },
      script: { font: 'pacifico', weight: 400 },
    },
    motifs: ['tropical'],
    decoration: 'rich',
    frameStyle: 'white',
    tilt: 2,
  },
  {
    id: 'nordic',
    labelKey: 'studio.theme.name.nordic',
    descrKey: 'studio.theme.descr.nordic',
    descr: 'Nordic calm: pale grey paper, slate ink, ochre and rose, a friendly grotesque, row houses and pines.',
    palette: { paper: '#f3f1ec', ink: '#2e3a45', accent: '#a8741c', accent2: '#cf7d7d', accent3: '#566d83' },
    fonts: {
      display: { font: 'bricolage', weight: 700 },
      heading: { font: 'montserrat', weight: 600 },
      body: { font: 'inter' },
      script: { font: 'satisfy', weight: 400 },
    },
    motifs: ['nordic', 'mountains'],
    decoration: 'light',
    frameStyle: 'none',
    tilt: 0,
  },
  {
    id: 'alpine',
    labelKey: 'studio.theme.name.alpine',
    descrKey: 'studio.theme.descr.alpine',
    descr: 'Alpine lodge: snow white paper, forest green ink, rust and sky blue, a slab title over condensed caps.',
    palette: { paper: '#f7f7f2', ink: '#1e3a2c', accent: '#b0502a', accent2: '#2f5d46', accent3: '#6f9cbd' },
    fonts: {
      display: { font: 'alfa', weight: 400 },
      heading: { font: 'oswald', weight: 500 },
      body: { font: 'inter' },
      script: { font: 'caveat', weight: 400 },
    },
    motifs: ['mountains'],
    decoration: 'light',
    frameStyle: 'white',
    tilt: 0,
  },
  {
    id: 'india-stamp',
    labelKey: 'studio.theme.name.indiaStamp',
    descrKey: 'studio.theme.descr.indiaStamp',
    descr: 'Stamp collage: warm paper, magenta, saffron and teal, a high-contrast display serif, stamps and postmarks.',
    palette: { paper: '#fbf2e2', ink: '#2a1b2e', accent: '#bd2275', accent2: '#e9801a', accent3: '#12807f' },
    fonts: {
      display: { font: 'abril', weight: 400 },
      heading: { font: 'montserrat', weight: 600 },
      body: { font: 'serif' },
      script: { font: 'parisienne', weight: 400 },
    },
    motifs: ['asia', 'ephemera'],
    decoration: 'rich',
    frameStyle: 'white',
    tilt: 2,
  },
  {
    id: 'riso',
    labelKey: 'studio.theme.name.riso',
    descrKey: 'studio.theme.descr.riso',
    descr: 'Riso print: cream paper, riso blue, fluo pink, yellow and teal inks overprinted, a bold grotesque.',
    palette: { paper: '#f4efe4', ink: '#23306b', accent: '#ed4981', accent2: '#ffd23f', accent3: '#00a39a' },
    fonts: {
      display: { font: 'bricolage', weight: 800 },
      heading: { font: 'montserrat', weight: 700 },
      body: { font: 'inter' },
      script: { font: 'marker', weight: 400 },
    },
    motifs: ['doodles', 'paper'],
    decoration: 'rich',
    frameStyle: 'none',
    tilt: 2,
  },
  {
    id: 'magazine',
    labelKey: 'studio.theme.name.magazine',
    descrKey: 'studio.theme.descr.magazine',
    descr: 'Travel magazine: off white paper, black ink, one signal red, a huge Bodoni masthead over Garamond.',
    palette: { paper: '#f7f4ee', ink: '#111111', accent: '#d7261e', accent2: '#e9e2d6', accent3: '#6b6b6b' },
    fonts: {
      display: { font: 'bodoni', weight: 800 },
      heading: { font: 'montserrat', weight: 600 },
      body: { font: 'garamond' },
      script: null,
    },
    motifs: ['ornaments'],
    decoration: 'light',
    frameStyle: 'none',
    tilt: 0,
  },
  {
    id: 'retro-travel',
    labelKey: 'studio.theme.name.retroTravel',
    descrKey: 'studio.theme.descr.retroTravel',
    descr:
      'Retro travel poster: aged cream paper, brown ink, orange, teal and mustard, a slab title over condensed caps.',
    palette: { paper: '#f3e7cf', ink: '#3b2a1e', accent: '#d56129', accent2: '#2f7f7a', accent3: '#f2b33d' },
    fonts: {
      display: { font: 'alfa', weight: 400 },
      heading: { font: 'oswald', weight: 500 },
      body: { font: 'serif' },
      script: { font: 'yellowtail', weight: 400 },
    },
    motifs: ['mountains', 'mediterranean', 'landmarks'],
    decoration: 'rich',
    frameStyle: 'white',
    tilt: 0,
  },
  {
    id: 'midnight',
    labelKey: 'studio.theme.name.midnight',
    descrKey: 'studio.theme.descr.midnight',
    descr: 'Midnight film: near black paper, warm white ink, neon orange and cyan, tall condensed capitals.',
    palette: { paper: '#121417', ink: '#f2efe8', accent: '#ff6b3d', accent2: '#39d0c4', accent3: '#8a8f98' },
    fonts: {
      display: { font: 'league', weight: 400 },
      heading: { font: 'oswald', weight: 500 },
      body: { font: 'inter' },
      script: { font: 'satisfy', weight: 400 },
    },
    motifs: ['doodles'],
    decoration: 'light',
    frameStyle: 'none',
    tilt: 0,
  },
  {
    id: 'field-notes',
    labelKey: 'studio.theme.name.fieldNotes',
    descrKey: 'studio.theme.descr.fieldNotes',
    descr: 'Field notes: kraft paper, moss green ink, rust and sage, a soft serif title, handwriting, tape and leaves.',
    palette: { paper: '#e9dcc3', ink: '#2f3a2b', accent: '#b5532c', accent2: '#f8f2e4', accent3: '#6f8a5a' },
    fonts: {
      display: { font: 'fraunces', weight: 700 },
      heading: { font: 'montserrat', weight: 600 },
      body: { font: 'serif' },
      script: { font: 'caveat', weight: 400 },
    },
    motifs: ['paper', 'mountains', 'nordic'],
    decoration: 'rich',
    frameStyle: 'polaroid',
    tilt: 3,
  },
]

export const BOOK_THEME_IDS = BOOK_THEME_PRESETS.map(p => p.id)

/** Whether this build sets type in a family. */
export const isBookFontFamily = (id: string): id is BookFontFamily => id in BOOK_FONTS

/** The built-in theme of an id, or undefined. */
export function bookThemePreset(id: string): BookThemePreset | undefined {
  return BOOK_THEME_PRESETS.find(p => p.id === id)
}

/** A built-in theme as the document keeps it. */
export function bookThemeFromPreset(preset: BookThemePreset): BookTheme {
  return {
    id: preset.id,
    palette: { ...preset.palette },
    fonts: {
      display: { ...preset.fonts.display },
      heading: { ...preset.fonts.heading },
      body: { ...preset.fonts.body },
      script: preset.fonts.script ? { ...preset.fonts.script } : null,
    },
    motifs: [...preset.motifs],
    decoration: preset.decoration,
    frameStyle: preset.frameStyle,
    tilt: preset.tilt,
  }
}

/** A built-in theme by id, as the document keeps it. */
export function bookThemeOf(id: string): BookTheme {
  const preset = bookThemePreset(id)
  if (!preset) throw new Error(`no built-in theme ${id}`)
  return bookThemeFromPreset(preset)
}

/** A colour part way from `a` to `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  if (!ca || !cb) return a
  return toHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t })
}

/** The ink, unless it reads under 4.5:1 on the paper; then whichever of near black and white reads better. */
export function readableOn(paper: string, ink: string): string {
  return contrastRatio(ink, paper) >= 4.5 ? ink : readableInk(paper)
}

/** The softer ink of captions: a third of the way to the paper, as long as it still reads at 4.6:1, else the ink. */
export function mutedOn(paper: string, ink: string): string {
  const softer = mixHex(ink, paper, 0.3)
  return contrastRatio(softer, paper) >= 4.6 ? softer : ink
}

/** The colour a token stands for in a theme. */
export function bookThemeColor(theme: BookTheme, token: BookColorToken): string {
  const { palette } = theme
  if (token === 'muted') return mutedOn(palette.paper, readableOn(palette.paper, palette.ink))
  return palette[token]
}

/** A theme's paper as a page background: none for white, which is the paper itself. */
export const themePaperBackground = (theme: BookTheme): string | null =>
  theme.palette.paper.toLowerCase() === '#ffffff' ? null : theme.palette.paper.toLowerCase()

/* ── Applying (book-theme-apply.ts) ─────────────────────────────────────── */

const TEXT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

/** The weight a face asks for, onto the nearest one Trek's text takes; none keeps the element's own. */
function weightOf(face: BookThemeFont): Partial<Pick<BookTextElement, 'weight'>> {
  if (face.weight === undefined) return {}
  const w = TEXT_WEIGHTS.reduce((best, v) => (Math.abs(v - face.weight!) < Math.abs(best - face.weight!) ? v : best), 400 as BookTextElement['weight'])
  return { weight: w }
}

/** The fields a face sets on a typeset element. */
function faceFields(face: BookThemeFont | null): Record<string, unknown> {
  // A family this build does not set (a theme from a newer one) leaves the text in its own.
  if (!face || !isBookFontFamily(face.font)) return {}
  return { font: face.font, ...weightOf(face), ...(face.italic !== undefined ? { italic: face.italic } : {}) }
}

/** A face for a slot; a theme without a script sets script words in its heading face, upright. */
function slotFace(theme: BookTheme, slot: BookFontSlot): BookThemeFont | null {
  return theme.fonts[slot] ?? { ...theme.fonts.heading, italic: false }
}

function tokenColour(next: Record<string, unknown>, theme: BookTheme, key: string, token: BookColorToken | undefined): void {
  if (token) next[key] = bookThemeColor(theme, token)
}

/** One element as the theme sets it: its linked colours and its linked face, the rest as it was. */
export function themedElement<E extends BookElement>(el: E, theme: BookTheme): E {
  if (el.locked) return el
  const next: Record<string, unknown> = { ...el }
  switch (el.kind) {
    // Pictures keep their own colours; a line keeps the colour it was drawn in (it has no theme link).
    case 'photo':
    case 'image':
    case 'map':
    case 'line':
    case 'sticker':
      return el
    case 'text':
      tokenColour(next, theme, 'color', el.token)
      if (el.fontRole) Object.assign(next, faceFields(slotFace(theme, el.fontRole)))
      break
    case 'shape':
      if (el.token && el.fill !== null) {
        tokenColour(next, theme, 'fill', el.token)
        // A flat paint is the fill with an alpha: it follows too. A gradient or a pattern stays the person's.
        const color = bookThemeColor(theme, el.token)
        if (el.paint?.type === 'solid' && el.paint.color !== color) next.paint = { ...el.paint, color }
      }
      if (el.strokeToken && el.stroke !== null) tokenColour(next, theme, 'stroke', el.strokeToken)
      break
    case 'icon':
      tokenColour(next, theme, 'color', el.token)
      break
    default: {
      tokenColour(next, theme, 'color', el.token)
      tokenColour(next, theme, 'accent', el.accentToken)
      if (el.fontRole) {
        const { italic: _upright, weight: _w, ...face } = faceFields(slotFace(theme, el.fontRole))
        Object.assign(next, face)
      }
    }
  }
  const changed = Object.keys(next).some(k => next[k] !== (el as unknown as Record<string, unknown>)[k])
  return changed ? (next as E) : el
}

/** A page as the theme sets it; the very same object when nothing on it is linked. */
export function themedSpread(spread: BookSpread, theme: BookTheme): BookSpread {
  const elements = spread.elements.map(e => themedElement(e, theme))
  const parked = spread.parked.map(e => themedElement(e, theme))
  const background = spread.backgroundToken
    ? spread.backgroundToken === 'paper' ? themePaperBackground(theme) : bookThemeColor(theme, spread.backgroundToken)
    : spread.background
  // A flat paint on the page follows its link too; on a white paper it goes, the paper being the page.
  const paint = spread.backgroundPaint
  const flat = spread.backgroundToken !== undefined && paint?.type === 'solid'
  const backgroundPaint = flat && paint?.type === 'solid'
    ? background === null ? undefined : paint.color === background ? paint : { ...paint, color: background }
    : paint
  const same = background === spread.background && backgroundPaint === spread.backgroundPaint
    && elements.every((e, i) => e === spread.elements[i]) && parked.every((e, i) => e === spread.parked[i])
  if (same) return spread
  const { backgroundPaint: _old, ...rest } = spread
  return { ...rest, background, ...(backgroundPaint ? { backgroundPaint } : {}), elements, parked }
}

export interface ApplyBookThemeOptions {
  /** Only these pages; every page when left out. */
  spreadIds?: readonly string[]
  /** Link what is not linked yet before recolouring. */
  adopt?: boolean
}

/** The book with the theme applied to the pages named (all by default) and kept as the book's theme. */
export function applyBookTheme(doc: BookDocument, theme: BookTheme, options: ApplyBookThemeOptions = {}): BookDocument {
  const only = options.spreadIds ? new Set(options.spreadIds) : null
  const map = options.adopt ? adoptionMap(doc, doc.theme ?? null) : null
  const spreads = doc.spreads.map(spread => {
    if (only && !only.has(spread.id)) return spread
    const linked = map ? adoptSpread(spread, map, doc.theme ?? null) : spread
    return themedSpread(linked, theme)
  })
  return { ...doc, theme, spreads }
}

/** The ids of the pages whose content differs between two versions of a book, by identity. */
export function changedSpreadIds(before: BookDocument, after: BookDocument): string[] {
  return after.spreads.filter((s, i) => before.spreads[i] !== s).map(s => s.id)
}

/* ── Adopting (book-theme-adopt.ts) ─────────────────────────────────────── */

/** Colours closer than this (CIE76) are the same entry of a palette. */
const SAME = 6
type BookAdoptionMap = ReadonlyMap<string, BookColorToken>
const ACCENTS = ['accent', 'accent2', 'accent3'] as const

function isNeutral(hex: string): boolean {
  const c = parseHex(hex)
  if (!c) return true
  const { s, l } = toHsl(c)
  return s < 0.15 || l < 0.08 || l > 0.95
}

/** The token of a previous theme a colour already is, near enough. */
function previousToken(hex: string, prev: BookTheme | null): BookColorToken | undefined {
  if (!prev) return undefined
  return BOOK_COLOR_TOKENS.find(t => deltaE(bookThemeColor(prev, t), hex) < SAME)
}

/** The coloured inks an element is drawn in, as adoption would read them. */
function chromaticInks(el: BookElement): string[] {
  switch (el.kind) {
    case 'photo': case 'image': case 'map': case 'line': case 'sticker':
      return []
    case 'text': case 'icon':
      return [el.color]
    case 'shape':
      return el.gradient !== 'none' ? [] : [el.fill, el.stroke].filter((c): c is string => c !== null)
    default:
      return [el.color, el.accent]
  }
}

/** The book's coloured inks to accent tokens, most used first; the previous theme's accents keep theirs. */
export function adoptionMap(doc: BookDocument, prev: BookTheme | null): BookAdoptionMap {
  const counts = new Map<string, number>()
  for (const spread of doc.spreads) {
    for (const el of [...spread.elements, ...spread.parked]) {
      for (const ink of chromaticInks(el)) {
        const key = ink.toLowerCase()
        if (!isNeutral(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  const map = new Map<string, BookColorToken>()
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c)
  for (const c of ranked) {
    const known = previousToken(c, prev)
    if (known) map.set(c, known)
  }
  const free = ACCENTS.filter(t => ![...map.values()].includes(t))
  const firsts: [string, BookColorToken][] = []
  for (const c of ranked) {
    if (map.has(c)) continue
    const token = free.shift()
    if (token) { map.set(c, token); firsts.push([c, token]); continue }
    const pool = firsts.length ? firsts : [...map.entries()]
    const nearest = pool.reduce((best, cur) => (deltaE(cur[0], c) < deltaE(best[0], c) ? cur : best), pool[0])
    map.set(c, nearest[1])
  }
  return map
}

/** What a colour on a page links to, or undefined to leave it as it is. */
function inkToken(hex: string, ground: string, map: BookAdoptionMap, prev: BookTheme | null, small = false): BookColorToken | undefined {
  const key = hex.toLowerCase()
  if (!isNeutral(key)) return map.get(key) ?? previousToken(key, prev)
  const known = previousToken(key, prev)
  if (known && known !== 'paper') return known
  const contrast = contrastRatio(key, ground)
  if (contrast < 3) return undefined
  return small && contrast < 9 ? 'muted' : 'ink'
}

/** The slot a text is set in, by the face it has under the previous theme, else by its size. */
function textSlot(font: string, size: number, cover: boolean, prev: BookTheme | null): BookFontSlot {
  const own = prev ? BOOK_FONT_SLOTS.find(s => prev.fonts[s]?.font === font) : undefined
  if (own && !(own === 'display' && size < 15)) return own
  if (size >= 36) return cover ? 'display' : 'heading'
  return size >= 15 ? 'heading' : 'body'
}

/** The background link a page takes, or none. */
function backgroundToken(spread: BookSpread, map: BookAdoptionMap, prev: BookTheme | null): BookColorToken | undefined {
  if (spread.backgroundPaint && spread.backgroundPaint.type !== 'solid') return undefined
  if (spread.background === null) return 'paper'
  const known = previousToken(spread.background, prev)
  if (known) return known
  if (isNeutral(spread.background)) return 'paper'
  return map.get(spread.background.toLowerCase())
}

function adoptElement(el: BookElement, ground: string, cover: boolean, map: BookAdoptionMap, prev: BookTheme | null): BookElement {
  if (el.locked) return el
  switch (el.kind) {
    case 'photo': case 'image': case 'map': case 'line': case 'sticker':
      return el
    case 'text': {
      const token = el.token ?? inkToken(el.color, ground, map, prev, el.size <= 9)
      const fontRole = el.fontRole ?? textSlot(el.font, el.size, cover, prev)
      return token === el.token && fontRole === el.fontRole ? el : { ...el, token, fontRole }
    }
    case 'shape': {
      // A scrim over a photo, or a gradient or pattern of the person's own: not the theme's to recolour.
      if (el.gradient !== 'none' || (el.paint && el.paint.type !== 'solid')) return el
      const token = el.token ?? (el.fill !== null ? inkToken(el.fill, ground, map, prev) : undefined)
      const strokeToken = el.strokeToken ?? (el.stroke !== null ? inkToken(el.stroke, ground, map, prev) : undefined)
      return token === el.token && strokeToken === el.strokeToken ? el : { ...el, token, strokeToken }
    }
    case 'icon': {
      const token = el.token ?? inkToken(el.color, ground, map, prev)
      return token === el.token ? el : { ...el, token }
    }
    default: {
      const token = el.token ?? inkToken(el.color, ground, map, prev)
      const accentToken = el.accentToken ?? inkToken(el.accent, ground, map, prev)
      const fontRole = el.fontRole ?? (prev?.fonts.body.font === el.font ? 'body' : 'heading')
      if (token === el.token && accentToken === el.accentToken && fontRole === el.fontRole) return el
      return { ...el, token, accentToken, fontRole }
    }
  }
}

/** Drop the links adoption left undefined, so a document carries no empty keys. */
function clean<T extends object>(el: T): T {
  const out = { ...el } as Record<string, unknown>
  for (const key of ['token', 'strokeToken', 'accentToken', 'fontRole', 'backgroundToken']) {
    if (key in out && out[key] === undefined) delete out[key]
  }
  return out as T
}

/** A page with links for everything adoption can read; the same object when it links nothing new. */
export function adoptSpread(spread: BookSpread, map: BookAdoptionMap, prev: BookTheme | null): BookSpread {
  const ground = spread.background ?? '#ffffff'
  const cover = spread.role === 'cover'
  const adopt = (el: BookElement) => {
    const next = adoptElement(el, ground, cover, map, prev)
    return next === el ? el : clean(next)
  }
  const elements = spread.elements.map(adopt)
  const parked = spread.parked.map(adopt)
  const bg = spread.backgroundToken ?? backgroundToken(spread, map, prev)
  const same = bg === spread.backgroundToken && elements.every((e, i) => e === spread.elements[i]) && parked.every((e, i) => e === spread.parked[i])
  return same ? spread : clean({ ...spread, backgroundToken: bg, elements, parked })
}

/* ── Keeping links honest on an edit (book-theme-links.ts) ──────────────── */

const LINKS: Record<string, readonly (readonly [field: string, link: string])[]> = {
  text: [['color', 'token'], ['font', 'fontRole']],
  icon: [['color', 'token']],
  photo: [], image: [], map: [], line: [], sticker: [],
  shape: [['fill', 'token'], ['paint', 'token'], ['stroke', 'strokeToken']],
  typeset: [['color', 'token'], ['accent', 'accentToken'], ['font', 'fontRole']],
}
const linksOf = (kind: BookElement['kind']) => LINKS[kind] ?? LINKS.typeset

/**
 * The element as an edit leaves it, its links kept in step: a colour or face
 * set by hand without its link unlinks it (the next theme must not take it
 * away); a link set takes the theme's value at once; a link set to null goes.
 */
export function withThemeLinks<E extends BookElement>(el: E, change: Readonly<Record<string, unknown>>, theme: BookTheme | undefined): E {
  const next: Record<string, unknown> = { ...el }
  let linked = false
  for (const [field, link] of linksOf(el.kind)) {
    const asked = change[link]
    if (asked === null) delete next[link]
    else if (asked !== undefined) linked = true
    else if (change[field] !== undefined) delete next[link]
  }
  const out = next as E
  return linked && theme ? themedElement(out, theme) : out
}

/* ── Accents from the photos (book-theme-photos.ts) ─────────────────────── */

const DISTINCT = 18

function isColour(hex: string): boolean {
  const c = parseHex(hex)
  if (!c) return false
  const { s, l } = toHsl(c)
  return s > 0.22 && l > 0.18 && l < 0.82
}

function readableAccent(hex: string, palette: BookPalette, ratio = 3): string {
  let out = hex
  for (let step = 1; step <= 8 && contrastRatio(out, palette.paper) < ratio; step++) out = mixHex(hex, palette.ink, step / 10)
  return out
}

/** The palette with accents from the photos' palettes, or null when the photos are too grey to give even one. */
export function bookPaletteFromPhotos(palette: BookPalette, photos: readonly PaletteSwatch[][]): BookPalette | null {
  const picked: string[] = []
  for (const swatch of clusterPalettes(photos)) {
    if (picked.length === 3) break
    if (!isColour(swatch.hex) || picked.some(p => deltaE(p, swatch.hex) < DISTINCT)) continue
    picked.push(swatch.hex)
  }
  const [first, second, third] = picked
  if (!first) return null
  return {
    ...palette,
    accent: readableAccent(first, palette),
    accent2: second ?? mixHex(first, palette.paper, 0.45),
    accent3: third ?? mixHex(palette.ink, first, 0.5),
  }
}

/* ── Auto-layout in the book's theme (5.7.6) ────────────────────────────── */

/**
 * Pages auto-layout just made, dressed in the book's theme: their colours and
 * faces linked and set by the theme (adopt + apply), and their photos given the
 * theme's frame and, for a scrapbook theme, a small alternating tilt. Only the
 * named pages are touched (every page when left out); without a theme the
 * book is returned as it was.
 */
export function layoutWithTheme(doc: BookDocument, theme: BookTheme | undefined, spreadIds?: readonly string[]): BookDocument {
  if (!theme) return doc
  const only = spreadIds ? new Set(spreadIds) : null
  const pageW = doc.page.pageWidth
  const spreads = doc.spreads.map(sp => {
    if (only && !only.has(sp.id)) return sp
    let turn = 0
    const elements = sp.elements.map(e => {
      if (e.kind !== 'photo' || e.locked) return e
      const framed = e.frameStyle === 'none' && theme.frameStyle !== 'none' ? { ...e, frameStyle: theme.frameStyle } : e
      // A photo that fills most of a page stays square to it; the smaller ones lean, one way then the other.
      if (!theme.tilt || framed.rotation !== 0 || framed.frame.w > pageW * 0.8) return framed
      turn += 1
      return { ...framed, rotation: turn % 2 ? -theme.tilt : theme.tilt }
    })
    return elements.every((e, i) => e === sp.elements[i]) ? sp : { ...sp, elements }
  })
  return applyBookTheme({ ...doc, spreads, theme }, theme, { spreadIds, adopt: true })
}
