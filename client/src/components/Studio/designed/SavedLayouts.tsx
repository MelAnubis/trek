import { BookmarkPlus, Trash2 } from 'lucide-react'
import { useStudioStore } from '../../../store/studioStore'
import { SpreadFold, SpreadView } from '../SpreadView'
import { MAX_BOOK_LAYOUTS, applySavedBookLayout, bookLayoutFromSpread, bookLayoutPreview, bookLayoutRole, nextBookLayoutName } from './savedLayouts'

/*
 * "Mis diseños" (5.7.12, after liketrek/TREK's StudioSavedLayouts): one button
 * keeps the page on screen as a design of the book; each card lays the page
 * on screen out that way, keeping its pictures and words. Kept in the book,
 * so everyone editing it sees the same set.
 */

type T = (k: string, params?: Record<string, string | number>) => string
const MM = 96 / 25.4

export function SavedLayouts({ t }: { t: T }) {
  const doc = useStudioStore(s => s.doc)
  const active = useStudioStore(s => s.activeSpread)
  const commit = useStudioStore(s => s.commit)
  const select = useStudioStore(s => s.select)
  const spread = doc?.spreads[active]
  if (!doc || !spread) return null

  const page = doc.page
  const all = doc.layouts ?? []
  const role = bookLayoutRole(spread)
  const fitting = all.filter(l => l.role === role)
  const full = all.length >= MAX_BOOK_LAYOUTS
  const canSave = spread.elements.length > 0 && !full
  const single = role !== 'inner'
  const width = single ? 101 : 210
  const across = single ? 1 : 2
  const scale = width / (page.pageWidth * across * MM)

  const save = () => commit(d => {
    const sp = d.spreads[active]
    const layouts = d.layouts ?? []
    if (!sp || !sp.elements.length || layouts.length >= MAX_BOOK_LAYOUTS) return d
    return { ...d, layouts: [...layouts, bookLayoutFromSpread(sp, d.page, nextBookLayoutName(layouts, t('journey.studio.layoutName')))] }
  })
  const remove = (id: string) => commit(d => ({ ...d, layouts: (d.layouts ?? []).filter(l => l.id !== id) }))
  const apply = (id: string) => {
    commit(d => {
      const layout = d.layouts?.find(l => l.id === id)
      const sp = d.spreads[active]
      if (!layout || !sp || bookLayoutRole(sp) !== layout.role) return d
      return { ...d, spreads: d.spreads.map((x, i) => (i === active ? applySavedBookLayout(x, layout, d.page) : x)) }
    })
    select([])
  }

  return (
    <div data-testid="saved-layouts" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '0 0 6px' }}>
        {t('journey.studio.myLayouts')} {fitting.length > 0 && <span style={{ fontWeight: 500 }}>{fitting.length}</span>}
      </div>
      {fitting.length === 0 && <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: '0 0 8px', lineHeight: 1.4 }}>{t('journey.studio.myLayoutsEmpty')}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: single ? '1fr 1fr' : '1fr', gap: 8, marginBottom: 8 }}>
        {fitting.map(layout => (
          <div key={layout.id} style={{ position: 'relative' }}>
            <button type="button" className="st-tpl-card" data-layout={layout.id} title={layout.name} aria-label={layout.name} onClick={() => apply(layout.id)}>
              <span aria-hidden className="st-tpl-art" style={{ width, height: page.pageHeight * MM * scale }}>
                <span style={{ position: 'absolute', left: 0, top: 0, width: `${page.pageWidth * across}mm`, height: `${page.pageHeight}mm`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                  <SpreadView spread={bookLayoutPreview(layout, page)} page={page} />
                  {!single && <SpreadFold page={page} scaled={1} />}
                </span>
              </span>
              <span className="st-tpl-label">{layout.name}</span>
            </button>
            <button type="button" onClick={() => remove(layout.id)} title={t('journey.studio.deleteLayout')} aria-label={t('journey.studio.deleteLayout')}
              style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="st-sb-add" disabled={!canSave} data-testid="save-layout" onClick={save}
        title={t(full ? 'journey.studio.saveLayoutFull' : 'journey.studio.saveLayoutHint')}
        style={{ width: '100%', flexDirection: 'row', gap: 6, padding: '8px 10px', opacity: canSave ? 1 : 0.5 }}>
        <BookmarkPlus size={14} /> {t('journey.studio.saveLayout')}
      </button>
    </div>
  )
}
