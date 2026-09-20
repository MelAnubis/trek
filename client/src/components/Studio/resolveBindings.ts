import type { BookDocument, BookTextBinding } from '../../types/book'
import { formatBookCoords, formatBookDate } from './entryText'

/**
 * Reading a book's bound text back out of the journey. Ported from
 * liketrek/trek's client/src/components/Studio/resolveBindings.ts (same
 * AGPLv3 license) — this fork's schema already carried `binding`/
 * `overridden` on text elements, but nothing ever read `binding` back out
 * again; auto-layout only ever wrote plain, already-overridden text. This
 * is what makes "fixing a typo in the journal fixes it in the book" true.
 *
 * ── Three rules, all of them load-bearing ────────────────────────────────
 *
 * **A missing value never blanks a page.** An entry that has been deleted, a
 * title that has been cleared, a photo whose caption is gone: the element keeps
 * the words it has. Overwriting them with an empty string would turn a data
 * change in the journal into a hole in a printed book, and nobody would connect
 * the two.
 *
 * **`overridden` wins.** Editing the text in Studio is a decision, and after it
 * the journal stops being the source. That flag is set by the canvas editor and
 * by the inspector, and read here — its only reader.
 *
 * **A formatted source is only re-read when the fact behind it moved.** A title
 * is its own value, so comparing the words is enough. A date is not: the same
 * day is "28 de mayo de 2026" here and "May 28, 2026" on a page set in another
 * language, and a resolver that compared the words would rewrite every such
 * line the moment somebody with another language opened the book. So date and
 * coordinate bindings carry the raw value they were set from and are compared
 * against that.
 *
 * **Nothing changed means the same object.** Not an optimisation: the
 * autosave recognises the document it has agreed with the server by
 * identity, so a resolver that always returned a fresh object would make
 * every open count as an edit and write the book back every time somebody
 * looked at it. Spreads and elements are shared through untouched, too.
 */

/** Mirrors the server's MAX_TEXT_LENGTH — a journal entry has no length limit and a text element does. */
const MAX_TEXT_LENGTH = 8000

/**
 * What the journey can answer with. Declared structurally rather than
 * imported from a store type: this module knows about the journal, not
 * about whatever panel browses it.
 */
export interface BindingSource {
  title: string
  subtitle: string | null
  entries: {
    id: number
    title: string | null
    story: string | null
    location: string | null
    date: string | null
    lat: number | null
    lng: number | null
  }[]
  photos: { photoId: number; caption?: string | null }[]
}

export function resolveBindings(doc: BookDocument, src: BindingSource, locale: string): BookDocument {
  let documentChanged = false

  const spreads = doc.spreads.map(spread => {
    let spreadChanged = false

    const elements = spread.elements.map(el => {
      if (el.kind !== 'text' || !el.binding || el.overridden) return el

      const next = resolveOne(el.binding, src, locale)
      const value = next?.text.slice(0, MAX_TEXT_LENGTH)
      // An empty answer is not an answer — see the first rule above.
      if (!next || !value || value === el.text) return el

      spreadChanged = true
      return next.value === undefined
        ? { ...el, text: value }
        : { ...el, text: value, binding: { ...el.binding, value: next.value } }
    })

    if (!spreadChanged) return spread
    documentChanged = true
    return { ...spread, elements }
  })

  return documentChanged ? { ...doc, spreads } : doc
}

interface Resolved {
  text: string
  value?: string
}

function resolveOne(binding: BookTextBinding, src: BindingSource, locale: string): Resolved | null {
  if (binding.source === 'journey.title') return { text: src.title }
  if (binding.source === 'journey.subtitle') return { text: src.subtitle ?? '' }

  if (binding.source === 'photo.caption') {
    const photo = src.photos.find(p => p.photoId === binding.photoId)
    return { text: photo?.caption ?? '' }
  }

  const entry = src.entries.find(e => e.id === binding.entryId)
  if (!entry) return null

  switch (binding.source) {
    // The same fallback auto-layout's own heading uses: a stop nobody has written about is known by where it is.
    case 'entry.title': return { text: entry.title || entry.location || '' }
    case 'entry.story': return { text: (entry.story || '').trim() }

    case 'entry.date':
      if (!binding.value || !entry.date || binding.value === entry.date) return null
      return { text: formatBookDate(entry.date, locale), value: entry.date }

    case 'entry.location': {
      if (!binding.format) return { text: entry.location ?? '' }
      if (entry.lat == null || entry.lng == null) return null
      const value = coordValue(entry.lat, entry.lng)
      if (!binding.value || binding.value === value) return null
      return { text: formatBookCoords(entry.lat, entry.lng, binding.format), value }
    }

    default: return null
  }
}

/** What a point is, as one string, for the comparison above. */
export function coordValue(lat: number, lng: number): string {
  return `${lat},${lng}`
}
