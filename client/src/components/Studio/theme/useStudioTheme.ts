import { useCallback, useMemo, useState } from 'react'
import { useStudioStore } from '../../../store/studioStore'
import type { BookFontSlot, BookPaletteKey, BookTheme, BookThemeDecoration, BookThemeMotif } from '../../../types/book'
import { BOOK_THEME_IDS, applyBookTheme, bookPaletteFromPhotos, bookThemeOf, changedSpreadIds } from '../bookTheme'
import { bookPhotoIds, readPhotoSwatches } from './themePhotoColours'

/**
 * The Theme panel's state (5.7.6, port of liketrek/TREK's useStudioTheme.ts):
 * the theme being put together is a draft, so trying colours costs nothing
 * until it is applied, and an apply is one undo step however many pages it
 * recoloured.
 */

type ThemeApplyResult = { pages: number } | null

const firstTheme = (): BookTheme => bookThemeOf(BOOK_THEME_IDS[0])

/** A theme as text with its keys in one order, so the same theme read twice compares equal. */
function themeKey(theme: BookTheme | undefined): string {
  if (!theme) return ''
  return JSON.stringify(theme, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  })
}

/** Whether a draft differs from the built-in theme it is named after. */
export function isEdited(draft: BookTheme): boolean {
  if (!draft.id) return false
  try { return themeKey(draft) !== themeKey(bookThemeOf(draft.id)) } catch { return false }
}

export function useStudioTheme() {
  const doc = useStudioStore(s => s.doc)
  const active = useStudioStore(s => s.activeSpread)
  const readOnly = useStudioStore(s => s.readOnly)
  const commit = useStudioStore(s => s.commit)
  const current = doc?.theme

  const [draft, setDraft] = useState<BookTheme>(() => current ?? firstTheme())
  const [adopt, setAdopt] = useState(true)
  const [reading, setReading] = useState(false)

  // The book's theme changed under the panel (applied, undone, another editor): the draft follows it.
  const currentKey = useMemo(() => themeKey(current), [current])
  const [seen, setSeen] = useState(currentKey)
  if (seen !== currentKey) {
    setSeen(currentKey)
    if (current) setDraft(current)
  }

  const pick = useCallback((id: string) => setDraft(bookThemeOf(id)), [])
  const setColour = useCallback((key: BookPaletteKey, hex: string) => setDraft(d => ({ ...d, palette: { ...d.palette, [key]: hex } })), [])
  const setFont = useCallback((slot: BookFontSlot, font: string | null) => setDraft(d => {
    if (font === null) return slot === 'script' ? { ...d, fonts: { ...d.fonts, script: null } } : d
    return { ...d, fonts: { ...d.fonts, [slot]: { font } } }
  }), [])
  const toggleMotif = useCallback((motif: BookThemeMotif) => setDraft(d => ({
    ...d, motifs: d.motifs.includes(motif) ? d.motifs.filter(m => m !== motif) : [...d.motifs, motif],
  })), [])
  const setDecoration = useCallback((decoration: BookThemeDecoration) => setDraft(d => ({ ...d, decoration })), [])
  const reset = useCallback(() => setDraft(d => (d.id ? bookThemeOf(d.id) : d)), [])

  const photoIds = useMemo(() => bookPhotoIds(doc), [doc])

  /** Accents from the book's photos. Resolves false when the photos give no colour to take. */
  const fromPhotos = useCallback(async (): Promise<boolean> => {
    setReading(true)
    try {
      const swatches = await Promise.all(photoIds.map(id => readPhotoSwatches(id)))
      const palette = bookPaletteFromPhotos(draft.palette, swatches)
      if (palette) setDraft(d => ({ ...d, palette }))
      return palette !== null
    } finally {
      setReading(false)
    }
  }, [photoIds, draft.palette])

  const apply = useCallback((scope: 'book' | 'page'): ThemeApplyResult => {
    const spread = doc?.spreads[active]
    if (!doc || readOnly || (scope === 'page' && !spread)) return null
    let result: ThemeApplyResult = null
    commit(d => {
      const next = applyBookTheme(d, draft, { spreadIds: scope === 'page' && spread ? [spread.id] : undefined, adopt })
      result = { pages: changedSpreadIds(d, next).length }
      return next
    })
    return result
  }, [doc, active, readOnly, commit, draft, adopt])

  return {
    draft, current, edited: isEdited(draft), adopt, setAdopt, reading,
    hasPhotos: photoIds.length > 0, canApply: !!doc && !readOnly,
    pick, setColour, setFont, toggleMotif, setDecoration, reset, fromPhotos, apply,
  }
}
