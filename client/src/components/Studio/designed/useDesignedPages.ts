import { useDeferredValue, useMemo, useState } from 'react'
import type { BookPageSetup, BookSpread, BookTheme } from '../../../types/book'
import { useStudioStore } from '../../../store/studioStore'
import { useJourneyStore } from '../../../store/journeyStore'
import { decoratedTemplatesFor } from './catalogue'
import { applyDecoratedTemplate } from './templateApply'
import { BOOK_COVER_ARCHETYPES, type BookCoverArchetype, type BookDecoratedTemplate, type BookTemplateKind } from './templateFormat'
import { bookTemplateWords, type BookTemplateWords } from './templateWords'

/*
 * What the designed-pages panel draws and lays (5.7.10): the templates a page
 * takes, the words they are filled with, and the page one makes. A card and a
 * click run the same function, so a card shows the page the click gives, with
 * this page's own photos and words in it.
 */

export type ArchetypeFilter = BookCoverArchetype | 'all'
export const ARCHETYPE_FILTERS: readonly ArchetypeFilter[] = ['all', ...BOOK_COVER_ARCHETYPES]

export const pageKind = (spread: BookSpread): BookTemplateKind => (spread.role === 'inner' ? 'inner' : 'single')

export interface DesignedContext { theme: BookTheme | null; words: BookTemplateWords; locale: string }

/** A page laid out on a template: what a card draws and what a click commits. */
export function layDesigned(spread: BookSpread, tpl: BookDecoratedTemplate, page: BookPageSetup, ctx: DesignedContext, newId?: (p: string) => string): BookSpread {
  return applyDecoratedTemplate(spread, tpl, page, { theme: ctx.theme, words: ctx.words, locale: ctx.locale, ...(newId ? { newId } : {}) })
}

/** Ids for a card's drawing that stay the same from one render to the next. */
export function previewIds(prefix: string): (kind: string) => string {
  let n = 0
  return kind => `${prefix}-${kind}${(n += 1)}`
}

/** How many frames a laid page is left waiting for a picture in. */
export const emptyFrames = (spread: BookSpread): number => spread.elements.filter(e => e.kind === 'photo' && e.photoId == null).length

export function useDesignedPages(locale: string) {
  const doc = useStudioStore(s => s.doc)
  const active = useStudioStore(s => s.activeSpread)
  const commit = useStudioStore(s => s.commit)
  const select = useStudioStore(s => s.select)
  const journey = useJourneyStore(s => s.current)
  const [filter, setFilter] = useState<ArchetypeFilter>('all')
  // The cards redraw from the page as it is; deferred, so typing on the page never waits on them.
  const spread = useDeferredValue(doc?.spreads[active])
  const theme = doc?.theme ?? null
  const title = doc?.title ?? ''

  const source = useMemo(() => ({
    title: journey?.title ?? '',
    subtitle: journey?.subtitle ?? null,
    entries: (journey?.entries ?? []).map(e => ({ id: e.id, title: e.title ?? null, story: e.story ?? null, location: e.location_name ?? null, date: e.entry_date ?? null })),
  }), [journey])

  const wordsFor = (sp: BookSpread) => bookTemplateWords(sp, { bookTitle: title.trim() || source.title, subtitle: source.subtitle, locale, entries: source.entries })

  const ctx = useMemo<DesignedContext | null>(
    () => (spread ? { theme, words: wordsFor(spread), locale } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wordsFor reads exactly these
    [spread, theme, title, source, locale],
  )

  const templates = spread ? decoratedTemplatesFor(pageKind(spread), filter === 'all' ? null : filter) : []

  /** One undo step: the page as it is now laid out, nothing selected. Returns how many frames wait for a picture. */
  const pick = (tpl: BookDecoratedTemplate): number => {
    let empty = 0
    commit(d => {
      const now = d.spreads[active]
      if (!now || pageKind(now) !== tpl.kind) return d
      const next = layDesigned(now, tpl, d.page, { theme: d.theme ?? null, words: wordsFor(now), locale })
      empty = emptyFrames(next)
      return { ...d, spreads: d.spreads.map((sp, i) => (i === active ? next : sp)) }
    })
    select([])
    return empty
  }

  return { doc, spread, ctx, filter, setFilter, templates, pick }
}
