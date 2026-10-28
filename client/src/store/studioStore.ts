import { create } from 'zustand'
import type { BookDocument, BookElement, BookFrame, BookPageNumbers, BookPageSetup, BookSpread } from '../types/book'
import { elementId } from '../components/Studio/bookIds'
import { PAGE_PRESETS, clampPageEdge, clampPageSize, presetMatching, reflowDocument } from '../components/Studio/pagePresets'
import { regroupCopies, tidyGroups, withCopies } from '../components/Studio/bookGroups'
import type { BookAlignTo } from '../components/Studio/bookArrange'
import { studioLayerActions, type StudioLayerActions } from './studioLayers'

/**
 * The book being edited. Ported from liketrek/trek's
 * client/src/store/studioStore.ts (same AGPLv3 license) — plain zustand, no
 * server/Nest coupling beyond the type import, swapped for our local mirror.
 *
 * History is snapshot-based rather than patch-based, and deliberately so: a
 * document is a few hundred kilobytes of plain JSON at most (the schema caps
 * it at 150 spreads of 60 elements), and a snapshot stack that cannot
 * possibly disagree with the document beats a patch stack that can. It is
 * capped so a long session does not grow without limit.
 *
 * Granularity is the part that matters for how it *feels*: a drag is one
 * undo step, not four hundred. Callers open a gesture before the first move
 * and close it on release; only that pair touches the stack.
 */

const HISTORY_LIMIT = 60

interface StudioState extends StudioLayerActions {
  doc: BookDocument | null
  /**
   * Nothing is written while this is set: a book saved by a newer Studio
   * (bookSchemaRev.ts), or a journey this user may only view. Every change
   * below goes through `commit`/`apply`, and both refuse — so the page stays
   * on screen, readable, and untouchable.
   */
  readOnly: boolean
  setReadOnly: (readOnly: boolean) => void
  /** What the arrange section lines things up with, as last picked. Null until somebody picks. */
  alignTo: BookAlignTo | null
  setAlignTo: (to: BookAlignTo) => void
  selection: string[]
  activeSpread: number
  past: BookDocument[]
  future: BookDocument[]
  /** The document as it was when the current gesture started. */
  gestureBase: BookDocument | null
  /** Elements most recently copied, held in memory only — not part of the document, not undoable. */
  clipboard: BookElement[]
  /** Which spread `clipboard` was copied from, so pasting back onto it can offset instead of exactly overlaying. */
  clipboardSource: number | null
  /** How many times `clipboard` has been pasted onto `clipboardSource` in a row, so repeated same-spread pastes cascade rather than stack. */
  clipboardPasteCount: number

  load: (doc: BookDocument) => void
  /** Back to the empty pre-load state — switching to a different journey's book, whose own load hasn't arrived yet, must not leave the previous journey's document on screen or open to edits. */
  reset: () => void
  setActiveSpread: (i: number) => void
  select: (ids: string[]) => void
  toggleSelect: (id: string, additive: boolean) => void

  beginGesture: () => void
  endGesture: () => void
  /** A single change that is its own undo step. */
  commit: (fn: (doc: BookDocument) => BookDocument) => void
  /** A change inside an open gesture — does not touch the stack by itself. */
  apply: (fn: (doc: BookDocument) => BookDocument) => void

  updateElement: (spreadIndex: number, id: string, patch: Partial<BookElement>) => void
  setFrame: (spreadIndex: number, id: string, frame: BookFrame) => void
  /** `apply`, not `commit`: a drag is one undo step, and the gesture that drives this calls it on every pointer move. */
  setRotation: (spreadIndex: number, id: string, rotation: number) => void
  addElement: (spreadIndex: number, el: BookElement) => void
  removeElements: (spreadIndex: number, ids: string[]) => void
  /** Snapshot the selected elements into the in-memory clipboard. */
  copy: (spreadIndex: number, ids: string[]) => void
  /** Paste the clipboard into a spread: offset when pasting back onto its source, exact position otherwise (placing a repeated element in the same spot across pages). */
  paste: (spreadIndex: number) => void

  /** Insert an empty spread after `index`, and select it. */
  addSpread: (index: number) => void
  /** Copy a spread, contents and all, directly after it. */
  duplicateSpread: (index: number) => void
  removeSpread: (index: number) => void
  /** Move a spread one place towards the front or the back of the book. */
  moveSpread: (index: number, dir: -1 | 1) => void
  /** Whether a spread may be moved, deleted or duplicated at all. */
  canEditSpread: (index: number) => boolean

  /**
   * Switch to a named page preset. With `reflow` (the default) every element
   * is re-placed proportionally onto the new sheet — see reflowDocument; with
   * it off, elements keep their own mm frames, the way upstream does it.
   * Either way it is one undo step.
   */
  setPagePreset: (preset: BookPageSetup['preset'], reflow?: boolean) => void
  /** A free trim size on one axis. Lands on whichever preset the new pair matches, `custom` otherwise. */
  setPageSize: (axis: 'w' | 'h', value: number, reflow?: boolean) => void
  /** Bleed or safe margin. A bleed change can reflow (full-bleed elements follow the new edge); the safe margin is a guide only. */
  setPageEdge: (which: 'bleed' | 'safe', value: number, reflow?: boolean) => void
  /** `true`/`false` toggles them (the old call shape); an object patches any folio setting. One undo step either way. */
  setPageNumbers: (patch: boolean | Partial<BookPageNumbers>) => void
  /** A spread's paper colour; null is plain white. One undo step. */
  setSpreadBackground: (index: number, color: string | null) => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

function replaceSpread(doc: BookDocument, index: number, fn: (s: BookSpread) => BookSpread): BookDocument {
  const spreads = doc.spreads.slice()
  if (!spreads[index]) return doc
  spreads[index] = fn(spreads[index])
  return { ...doc, spreads }
}

export const useStudioStore = create<StudioState>((set, get) => ({
  // Groups, layers, align, nudge, duplicate, raise and paste style: studioLayers.ts.
  ...studioLayerActions(set as never, get as never),
  readOnly: false,
  setReadOnly: readOnly => set({ readOnly, gestureBase: null }),
  alignTo: null,
  setAlignTo: to => set({ alignTo: to }),
  doc: null,
  selection: [],
  activeSpread: 0,
  past: [],
  future: [],
  gestureBase: null,
  clipboard: [],
  clipboardSource: null,
  clipboardPasteCount: 0,

  load: doc => set({ doc, selection: [], activeSpread: 0, past: [], future: [], gestureBase: null, enteredGroup: null }),
  reset: () => set({ doc: null, selection: [], activeSpread: 0, past: [], future: [], gestureBase: null, clipboard: [], clipboardSource: null, clipboardPasteCount: 0, enteredGroup: null, readOnly: false }),
  setActiveSpread: i => set({ activeSpread: i, selection: [], enteredGroup: null }),
  select: ids => set(s => ({ selection: ids, enteredGroup: ids.length ? s.enteredGroup : null })),
  toggleSelect: (id, additive) => set(s => {
    if (!additive) return { selection: [id] }
    return { selection: s.selection.includes(id) ? s.selection.filter(x => x !== id) : [...s.selection, id] }
  }),

  beginGesture: () => set(s => (s.readOnly ? {} : { gestureBase: s.doc })),
  endGesture: () => set(s => {
    // Nothing actually changed — a click that missed, a drag of zero pixels.
    if (!s.gestureBase || s.gestureBase === s.doc) return { gestureBase: null }
    return {
      past: [...s.past, s.gestureBase].slice(-HISTORY_LIMIT),
      future: [],
      gestureBase: null,
    }
  }),

  commit: fn => set(s => {
    if (!s.doc || s.readOnly) return {}
    const next = fn(s.doc)
    if (next === s.doc) return {}
    return { doc: next, past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [] }
  }),

  apply: fn => set(s => (s.doc && !s.readOnly ? { doc: fn(s.doc) } : {})),

  updateElement: (spreadIndex, id, patch) => get().apply(doc =>
    replaceSpread(doc, spreadIndex, sp => ({
      ...sp,
      elements: sp.elements.map(e => (e.id === id ? ({ ...e, ...patch } as BookElement) : e)),
    }))),

  setFrame: (spreadIndex, id, frame) => get().apply(doc =>
    replaceSpread(doc, spreadIndex, sp => ({
      ...sp,
      elements: sp.elements.map(e => (e.id === id ? { ...e, frame } : e)),
    }))),

  setRotation: (spreadIndex, id, rotation) => get().apply(doc =>
    replaceSpread(doc, spreadIndex, sp => ({
      ...sp,
      elements: sp.elements.map(e => (e.id === id ? { ...e, rotation } : e)),
    }))),

  addElement: (spreadIndex, el) => {
    get().commit(doc =>
      replaceSpread(doc, spreadIndex, sp => ({ ...sp, elements: [...sp.elements, el] })))
    // Selected on arrival — the inspector shows the selection, and placing an
    // element and then hunting for it on the page to click it is a step
    // nobody asked for.
    if (!get().readOnly) set({ selection: [el.id], enteredGroup: null })
  },

  removeElements: (spreadIndex, ids) => {
    // A group left with one member dissolves (bookGroups.ts's rule: a group has two at least).
    get().commit(doc => replaceSpread(doc, spreadIndex, sp => tidyGroups({
      ...sp,
      elements: sp.elements.filter(e => !ids.includes(e.id)),
    })))
    set({ selection: [], enteredGroup: null })
  },

  copy: (spreadIndex, ids) => {
    const sp = get().doc?.spreads[spreadIndex]
    if (!sp) return
    const elements = sp.elements.filter(e => ids.includes(e.id))
    if (!elements.length) return
    set({ clipboard: elements, clipboardSource: spreadIndex, clipboardPasteCount: 0 })
  },

  paste: (spreadIndex) => {
    const { clipboard, clipboardSource, clipboardPasteCount } = get()
    if (!clipboard.length) return
    // Offset the copy so it is visibly a second thing rather than an exact
    // overlay you cannot tell apart from the original — but only when
    // pasting back onto the spread it was copied from. Pasting onto another
    // page keeps the exact position, useful for placing a repeated element
    // (a badge, a page number) in the same spot across pages.
    const OFFSET = 4
    const sameSpread = clipboardSource === spreadIndex
    const factor = sameSpread ? clipboardPasteCount + 1 : 0
    if (get().readOnly) return
    const copies = clipboard.map(e => ({
      ...e,
      id: elementId(e.kind),
      frame: { ...e.frame, x: e.frame.x + OFFSET * factor, y: e.frame.y + OFFSET * factor },
    }) as BookElement)
    // Groups among the copies become new groups of their own (and keep their names), so a
    // paste never joins a group that happens to share an id on the page it lands on.
    const source = clipboardSource != null ? get().doc?.spreads[clipboardSource] : undefined
    const regrouped = regroupCopies(copies, source, elementId)
    get().commit(doc => replaceSpread(doc, spreadIndex, sp => withCopies(sp, regrouped)))
    if (regrouped.elements.length) {
      set({ selection: regrouped.elements.map(e => e.id), clipboardPasteCount: sameSpread ? clipboardPasteCount + 1 : 0, enteredGroup: null })
    }
  },

  /*
   * ── Spread management ────────────────────────────────────────────────
   *
   * The cover and the back cover are fixed points: a book has exactly one of
   * each, they are single pages rather than spreads. So everything here
   * operates on the inner spreads between them, and `canEditSpread` is the
   * one place that decides what counts as inner.
   */
  canEditSpread: index => {
    const sp = get().doc?.spreads[index]
    return !!sp && sp.role === 'inner'
  },

  setPagePreset: (preset, reflow = true) => get().commit(doc => {
    const next: BookPageSetup = preset === 'custom'
      ? { ...doc.page, preset }
      : { ...doc.page, preset, pageWidth: PAGE_PRESETS[preset].pageWidth, pageHeight: PAGE_PRESETS[preset].pageHeight, bleed: PAGE_PRESETS[preset].bleed }
    return reflow ? reflowDocument(doc, next) : { ...doc, page: next }
  }),

  setPageSize: (axis, value, reflow = true) => {
    const doc = get().doc
    if (!doc) return
    const pageWidth = axis === 'w' ? clampPageSize(value) : doc.page.pageWidth
    const pageHeight = axis === 'h' ? clampPageSize(value) : doc.page.pageHeight
    if (pageWidth === doc.page.pageWidth && pageHeight === doc.page.pageHeight) return
    get().commit(d => {
      const next: BookPageSetup = { ...d.page, preset: presetMatching(pageWidth, pageHeight), pageWidth, pageHeight }
      return reflow ? reflowDocument(d, next) : { ...d, page: next }
    })
  },

  setPageEdge: (which, value, reflow = true) => {
    const doc = get().doc
    if (!doc) return
    const v = clampPageEdge(which, value)
    if (v === doc.page[which]) return
    get().commit(d => {
      const next: BookPageSetup = { ...d.page, [which]: v }
      return reflow && which === 'bleed' ? reflowDocument(d, next) : { ...d, page: next }
    })
  },

  setSpreadBackground: (index, color) => {
    const sp = get().doc?.spreads[index]
    if (!sp || (sp.background ?? null) === color) return
    get().commit(d => ({ ...d, spreads: d.spreads.map((s, i) => (i === index ? { ...s, background: color } : s)) }))
  },

  setPageNumbers: patch => get().commit(doc => {
    const p = typeof patch === 'boolean' ? { show: patch } : patch
    return { ...doc, page: { ...doc.page, pageNumbers: { show: false, ...doc.page.pageNumbers, ...p } } }
  }),

  addSpread: index => {
    const doc = get().doc
    if (!doc) return
    // New spreads go between the opening pages (cover, then the single first
    // page if the book has one) and the closing ones (the single last page,
    // then the back cover) — never outside them.
    const opening = Math.max(doc.spreads.findIndex(sp => sp.role === 'cover'), doc.spreads.findIndex(sp => sp.role === 'first'))
    const lastPage = doc.spreads.findIndex(sp => sp.role === 'last')
    const back = doc.spreads.findIndex(sp => sp.role === 'back')
    const first = opening === -1 ? 0 : opening + 1
    const limit = lastPage !== -1 ? lastPage : back !== -1 ? back : doc.spreads.length
    const at = Math.min(Math.max(index + 1, first), limit)
    get().commit(d => ({
      ...d,
      spreads: [
        ...d.spreads.slice(0, at),
        { id: elementId('sp'), role: 'inner' as const, background: null, elements: [], parked: [], entryId: null },
        ...d.spreads.slice(at),
      ],
    }))
    set({ activeSpread: at, selection: [] })
  },

  duplicateSpread: index => {
    const doc = get().doc
    if (!doc || !get().canEditSpread(index)) return
    const source = doc.spreads[index]
    const at = index + 1
    get().commit(d => ({
      ...d,
      spreads: [
        ...d.spreads.slice(0, at),
        {
          ...source,
          id: elementId('sp'),
          // Fresh ids throughout: two elements sharing one id would confuse
          // selection and every lookup that follows it.
          elements: source.elements.map(e => ({ ...e, id: elementId(e.kind) })),
          parked: source.parked.map(e => ({ ...e, id: elementId(e.kind) })),
        },
        ...d.spreads.slice(at),
      ],
    }))
    set({ activeSpread: at, selection: [] })
  },

  removeSpread: index => {
    const doc = get().doc
    if (!doc || !get().canEditSpread(index)) return
    get().commit(d => ({ ...d, spreads: d.spreads.filter((_, i) => i !== index) }))
    // Land on the spread that took its place, or the one before it if the
    // deleted spread was the last inner one.
    const next = get().doc?.spreads ?? []
    set({ activeSpread: Math.min(index, Math.max(0, next.length - 1)), selection: [] })
  },

  moveSpread: (index, dir) => {
    const doc = get().doc
    if (!doc || !get().canEditSpread(index)) return
    const target = index + dir
    // Only ever swaps with another inner spread, so the cover and back cover
    // keep their places without needing to be special-cased anywhere else.
    if (!get().canEditSpread(target)) return
    get().commit(d => {
      const spreads = d.spreads.slice()
      const [moved] = spreads.splice(index, 1)
      spreads.splice(target, 0, moved)
      return { ...d, spreads }
    })
    set({ activeSpread: target, selection: [] })
  },

  undo: () => set(s => {
    const prev = s.past[s.past.length - 1]
    if (!prev || !s.doc || s.readOnly) return {}
    return { doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY_LIMIT), selection: [] }
  }),

  redo: () => set(s => {
    const next = s.future[0]
    if (!next || !s.doc || s.readOnly) return {}
    return { doc: next, future: s.future.slice(1), past: [...s.past, s.doc].slice(-HISTORY_LIMIT), selection: [] }
  }),

  canUndo: () => !get().readOnly && get().past.length > 0,
  canRedo: () => !get().readOnly && get().future.length > 0,
}))
