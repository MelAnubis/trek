import type { BookElement, BookSpread, BookTextElement } from '../../../types/book'
import { BOOK_TEMPLATE_TEXT_ROLES, type BookTemplateTextRole } from './templateFormat'

/*
 * Which of a page's words go into which of a template's text roles, and the
 * words a role takes when the page has none. Ported from liketrek/TREK's
 * template-words.ts (AGPLv3).
 *
 * A text bound to the journal says what it is (an entry's title is a title,
 * a place a subtitle, a date a date, a story the body, a caption a caption).
 * The rest are read as Trek's layouts read a page: the largest type is the
 * title, the longest of the rest the story, the next a date line. A long text
 * only ever goes into the body. A role the page has no words for takes the
 * book's (a cover: its title, subtitle and year; a page of an entry: that
 * entry's), and a role with no words at all is left off the page.
 */

type TextEl = BookTextElement
type Binding = TextEl['binding']

export interface BookTemplateWord { text: string; binding?: Binding }
export type BookTemplateWords = Partial<Record<BookTemplateTextRole, BookTemplateWord>>

const SHORT = 120
const MAX_TEXT_LENGTH = 8000

const ROLE_OF_SOURCE: Record<NonNullable<Binding>['source'], BookTemplateTextRole> = {
  'journey.title': 'title',
  'entry.title': 'title',
  'journey.subtitle': 'subtitle',
  'entry.location': 'subtitle',
  'entry.date': 'date',
  'entry.story': 'body',
  'photo.caption': 'caption',
}

export function templateRoleOfBinding(binding: Binding | undefined): BookTemplateTextRole | undefined {
  return binding ? ROLE_OF_SOURCE[binding.source] : undefined
}

const SPARE_ORDER: readonly BookTemplateTextRole[] = ['subtitle', 'date', 'caption', 'title', 'body']
const DATE_LIKE = /\b(1[89]|20)\d{2}\b|\b\d{1,2}[./]\d{1,2}\b/

const isText = (e: BookElement | null | undefined): e is TextEl => !!e && e.kind === 'text' && !!e.text.trim()

/** A text that is only punctuation or figures drawn as design (a rule of dots, a timecode). */
export const isOrnamentText = (e: BookElement): boolean =>
  e.kind === 'text' && e.text.trim() !== '' && !/[\p{L}\p{N}]/u.test(e.text)

/** Figures a template drew as its design (a film's timecode, a plate number): not the page's words. */
export const isTemplateFigureText = (e: BookElement): boolean =>
  e.kind === 'text' && !e.binding && !/\p{L}/u.test(e.text) && !DATE_LIKE.test(e.text)

const isLong = (t: TextEl) => t.text.trim().length > SHORT
const readsAs = (t: TextEl): BookTemplateTextRole => (DATE_LIKE.test(t.text) ? 'date' : 'subtitle')

/** Heading, story and date line, as Trek's layouts read a page: size decides the heading, length the story. */
export function classifyTexts(texts: readonly TextEl[]): { heading: TextEl | null; body: TextEl | null; meta: TextEl | null } {
  const heading = [...texts].filter(t => t.size >= 14).sort((a, b) => b.size - a.size)[0] ?? null
  const rest = texts.filter(t => t !== heading)
  const body = [...rest].sort((a, b) => b.text.length - a.text.length)[0] ?? null
  const meta = rest.find(t => t !== body) ?? null
  return { heading, body, meta }
}

/** The page's texts by the role each takes, of the roles the template has. */
export function assignTemplateTexts(texts: readonly BookElement[], roles: ReadonlySet<BookTemplateTextRole>): Map<BookTemplateTextRole, TextEl> {
  const out = new Map<BookTemplateTextRole, TextEl>()
  const used = new Set<TextEl>()
  const free = (role: BookTemplateTextRole) => roles.has(role) && !out.has(role)
  const put = (role: BookTemplateTextRole, t: TextEl) => { out.set(role, t); used.add(t) }
  const pool = texts.filter(isText)

  for (const t of pool) {
    const role = templateRoleOfBinding(t.binding)
    if (role && free(role)) put(role, t)
  }
  const rest = pool.filter(t => !used.has(t))
  const place = (t: TextEl, first: BookTemplateTextRole) => {
    if (used.has(t)) return
    const role = (isLong(t) ? (['body'] as const) : [first, ...SPARE_ORDER]).find(free)
    if (role) put(role, t)
  }
  const { heading, body, meta } = classifyTexts(rest)
  const title = heading ?? (free('title') ? rest.find(t => !isLong(t)) : undefined)
  if (title) place(title, 'title')
  for (const t of [body, meta, ...rest]) if (isText(t)) place(t, isLong(t) ? 'body' : readsAs(t))
  return out
}

export interface BookTemplateWordSource {
  bookTitle: string
  subtitle?: string | null
  locale: string
  entries?: readonly { id: number; title?: string | null; story?: string | null; location?: string | null; date?: string | null }[]
}

const clip = (s: string) => s.trim().slice(0, MAX_TEXT_LENGTH)

export function formatBookDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  try { return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return iso.slice(0, 10) }
}

/** A date as a date mark shows it: the day as a numeral and the month in capitals. */
export function bookDateMarkValue(iso: string | null | undefined, locale: string): { text: string; sub: string } | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  let month: string
  try { month = d.toLocaleDateString(locale, { month: 'long' }) } catch { month = d.toLocaleDateString('en', { month: 'long' }) }
  return { text: String(d.getDate()), sub: month.toUpperCase() }
}

function singlePageWords(src: BookTemplateWordSource): BookTemplateWords {
  const out: BookTemplateWords = {}
  if (src.bookTitle.trim()) out.title = { text: clip(src.bookTitle) }
  if (src.subtitle?.trim()) out.subtitle = { text: clip(src.subtitle), binding: { source: 'journey.subtitle' } }
  const dated = src.entries?.find(e => e.date && /^\d{4}/.test(e.date))?.date
  if (dated) out.date = { text: dated.slice(0, 4) }
  return out
}

function entryWords(entry: NonNullable<BookTemplateWordSource['entries']>[number], locale: string): BookTemplateWords {
  const out: BookTemplateWords = {}
  const title = entry.title?.trim() || entry.location?.trim()
  if (title) {
    const source = entry.title?.trim() ? 'entry.title' : 'entry.location'
    out.title = { text: clip(title), binding: { source, entryId: entry.id } }
  }
  if (entry.title?.trim() && entry.location?.trim()) {
    out.subtitle = { text: clip(entry.location), binding: { source: 'entry.location', entryId: entry.id } }
  }
  const date = formatBookDate(entry.date, locale)
  if (date && entry.date) out.date = { text: date, binding: { source: 'entry.date', entryId: entry.id, value: entry.date } }
  if (entry.story?.trim()) out.body = { text: clip(entry.story), binding: { source: 'entry.story', entryId: entry.id } }
  return out
}

/** The words a template's empty roles take on this page. */
export function bookTemplateWords(spread: BookSpread, src: BookTemplateWordSource): BookTemplateWords {
  if (spread.role !== 'inner') return singlePageWords(src)
  const entry = spread.entryId === null ? undefined : src.entries?.find(e => e.id === spread.entryId)
  return entry ? entryWords(entry, src.locale) : {}
}

export function textRolesOf(roles: readonly string[]): Set<BookTemplateTextRole> {
  return new Set(roles.filter((r): r is BookTemplateTextRole => (BOOK_TEMPLATE_TEXT_ROLES as readonly string[]).includes(r)))
}
