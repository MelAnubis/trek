import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { BookPageSetup, BookSpread } from '../../../types/book'
import { SpreadFold, SpreadView } from '../SpreadView'
import { templateNameKey, type BookDecoratedTemplate } from './templateFormat'
import { ARCHETYPE_FILTERS, layDesigned, previewIds, useDesignedPages, type DesignedContext } from './useDesignedPages'

/*
 * "Páginas diseñadas" (5.7.10, after liketrek/TREK's StudioTemplatesPanel):
 * every designed page this page can take, each drawn as the page the click
 * makes of it, with this page's photos and words and in the book's theme.
 * Covers two to a row, spreads full width; style chips narrow the set to one
 * archetype. A card is only laid out once it scrolls into view.
 */

type T = (k: string, params?: Record<string, string | number>) => string

const MM = 96 / 25.4

/** Whether an element has come near the visible part of its scroller (always true where there is no observer). */
function useNearView<E extends Element>(): [React.RefObject<E | null>, boolean] {
  const ref = useRef<E | null>(null)
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (seen || !ref.current) return
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setSeen(true) }, { rootMargin: '200px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}

const Card = memo(function Card({ tpl, spread, page, ctx, width, label, onPick }: {
  tpl: BookDecoratedTemplate; spread: BookSpread; page: BookPageSetup; ctx: DesignedContext; width: number; label: string
  onPick: (tpl: BookDecoratedTemplate) => void
}) {
  const [ref, near] = useNearView<HTMLButtonElement>()
  const preview = useMemo(() => (near ? layDesigned(spread, tpl, page, ctx, previewIds(`tpl-${tpl.id}`)) : null), [near, spread, tpl, page, ctx])
  const across = tpl.kind === 'inner' ? 2 : 1
  const scale = width / (page.pageWidth * across * MM)
  const height = page.pageHeight * MM * scale
  return (
    <button ref={ref} type="button" className="st-tpl-card" title={label} aria-label={label} data-template={tpl.id} onClick={() => onPick(tpl)}>
      <span aria-hidden className="st-tpl-art" style={{ width, height }}>
        {preview && (
          <span style={{ position: 'absolute', left: 0, top: 0, width: `${page.pageWidth * across}mm`, height: `${page.pageHeight}mm`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <SpreadView spread={preview} page={page} />
            {across === 2 && <SpreadFold page={page} scaled={1} />}
          </span>
        )}
      </span>
      <span className="st-tpl-label">{label}</span>
    </button>
  )
})

export function DesignedPagesPanel({ t, locale, onEmptyFrames }: { t: T; locale: string; onEmptyFrames?: (n: number) => void }) {
  const { doc, spread, ctx, filter, setFilter, templates, pick } = useDesignedPages(locale)
  if (!doc || !spread || !ctx) return null
  const single = spread.role !== 'inner'
  // The rail is 240 px with 14 px of padding each side.
  const row = 212
  const width = single ? (row - 8) / 2 - 2 : row - 2
  const onPick = (tpl: BookDecoratedTemplate) => {
    const empty = pick(tpl)
    if (empty > 0) onEmptyFrames?.(empty)
  }
  return (
    <div data-testid="designed-pages">
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '0 0 6px' }}>
        {t('journey.studio.designed.title')} <span style={{ fontWeight: 500 }}>{templates.length}</span>
      </div>
      <div role="radiogroup" aria-label={t('journey.studio.designed.style')} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {ARCHETYPE_FILTERS.map(a => (
          <button key={a} type="button" role="radio" aria-checked={filter === a} data-value={a} onClick={() => setFilter(a)}
            className={`st-tpl-chip${filter === a ? ' is-on' : ''}`}>
            {a === 'all' ? t('journey.studio.designed.all') : t(`journey.studio.designed.archetype.${a}`)}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: single ? '1fr 1fr' : '1fr', gap: 8 }}>
        {templates.map(tpl => (
          <Card key={tpl.id} tpl={tpl} spread={spread} page={doc.page} ctx={ctx} width={width} label={t(templateNameKey(tpl))} onPick={onPick} />
        ))}
      </div>
      <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: '8px 0 0', lineHeight: 1.4 }}>{t('journey.studio.designed.hint')}</p>
    </div>
  )
}
