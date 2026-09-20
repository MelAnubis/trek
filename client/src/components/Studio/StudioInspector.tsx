import { Lock, Unlock } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useStudioStore } from '../../store/studioStore'
import { BOOK_FONT_ORDER, BOOK_FONTS } from './bookFonts'
import ToggleSwitch from '../Settings/ToggleSwitch'
import type { BookDocument, BookElement, BookFontFamily, BookPhotoElement, BookShapeId } from '../../types/book'

/**
 * The right panel: properties for whatever is selected. Simpler than
 * upstream's Studio (no crop/focal-point drag, no filter/frame-style
 * gallery, no gradient/stroke pickers beyond a color input yet — the full
 * polish, plus page setup here, lands with the export/print phase).
 */

const FIELD: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }
const LABEL: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }
const INPUT: React.CSSProperties = { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit', width: '100%' }

/**
 * Shown whenever nothing is selected — the page setup, rather than only an
 * empty-state message. Simpler than upstream's own Document panel (just the
 * one on/off switch, no position/font/colour pickers for the folios yet).
 */
function DocumentPanel({ doc }: { doc: BookDocument }) {
  const { t } = useTranslation()
  const setPageNumbers = useStudioStore(s => s.setPageNumbers)
  const pageNumbersOn = doc.page.pageNumbers?.show ?? false

  return (
    <div style={{ width: 260, flexShrink: 0, borderLeft: '1px solid var(--border-secondary)', padding: 14 }}>
      <span style={{ ...LABEL, display: 'block', marginBottom: 14 }}>{t('journey.studio.document')}</span>

      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.pageNumbers')}</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{t('journey.studio.pageNumbers')}</span>
          <ToggleSwitch on={pageNumbersOn} onToggle={() => setPageNumbers(!pageNumbersOn)} />
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', marginTop: 40, marginBottom: 8 }}>
        {t('journey.studio.inspectorEmpty')}
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
        {t('journey.studio.pageDimensions', { w: Math.round(doc.page.pageWidth), h: Math.round(doc.page.pageHeight) })}
      </p>
    </div>
  )
}

export function StudioInspector({ spreadIndex }: { spreadIndex: number }) {
  const { t } = useTranslation()
  const doc = useStudioStore(s => s.doc)
  const selection = useStudioStore(s => s.selection)
  const updateElement = useStudioStore(s => s.updateElement)
  const setFrame = useStudioStore(s => s.setFrame)

  const spread = doc?.spreads[spreadIndex]
  const el = spread?.elements.find(e => selection.includes(e.id) && selection[selection.length - 1] === e.id)
    ?? spread?.elements.find(e => selection.includes(e.id))

  if (!el) {
    return doc ? <DocumentPanel doc={doc} /> : (
      <div style={{ width: 260, flexShrink: 0, borderLeft: '1px solid var(--border-secondary)', padding: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', textAlign: 'center', marginTop: 40 }}>
          {t('journey.studio.inspectorEmpty')}
        </p>
      </div>
    )
  }

  const patch = (p: Partial<BookElement>) => updateElement(spreadIndex, el.id, p)

  return (
    <div style={{ width: 260, flexShrink: 0, borderLeft: '1px solid var(--border-secondary)', padding: 14, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'capitalize' }}>{el.kind}</span>
        <button onClick={() => patch({ locked: !el.locked })} title={t(el.locked ? 'journey.studio.unlock' : 'journey.studio.lock')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
          {el.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      </div>

      {/* Position & size */}
      <div style={FIELD}>
        <span style={LABEL}>Position &amp; size (mm)</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(['x', 'y', 'w', 'h'] as const).map(k => (
            <input key={k} type="number" style={INPUT} value={Math.round(el.frame[k] * 10) / 10}
              onChange={e => setFrame(spreadIndex, el.id, { ...el.frame, [k]: Number(e.target.value) || 0 })} />
          ))}
        </div>
      </div>

      <div style={FIELD}>
        <span style={LABEL}>Rotation (°)</span>
        <input type="number" style={INPUT} value={el.rotation} onChange={e => patch({ rotation: Number(e.target.value) || 0 })} />
      </div>

      <div style={FIELD}>
        <span style={LABEL}>Opacity</span>
        <input type="range" min={0} max={1} step={0.05} value={el.opacity} onChange={e => patch({ opacity: Number(e.target.value) })} />
      </div>

      {el.kind === 'photo' && (
        <>
          <div style={FIELD}>
            <span style={LABEL}>Fit</span>
            <select style={INPUT} value={el.fit} onChange={e => patch({ fit: e.target.value as 'cover' | 'contain' })}>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </select>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Filter</span>
            <select style={INPUT} value={el.filter} onChange={e => patch({ filter: e.target.value as BookPhotoElement['filter'] })}>
              {['none', 'bw', 'warm', 'cool', 'fade', 'contrast'].map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Frame</span>
            <select style={INPUT} value={el.frameStyle} onChange={e => patch({ frameStyle: e.target.value as BookPhotoElement['frameStyle'] })}>
              {['none', 'polaroid', 'white', 'shadow', 'film', 'tape'].map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Corner radius</span>
            <input type="number" min={0} style={INPUT} value={el.radius} onChange={e => patch({ radius: Number(e.target.value) || 0 })} />
          </div>
        </>
      )}

      {el.kind === 'text' && (
        <>
          <div style={FIELD}>
            <span style={LABEL}>Font</span>
            <select style={INPUT} value={el.font} onChange={e => patch({ font: e.target.value as BookFontFamily })}>
              {BOOK_FONT_ORDER.map(f => <option key={f} value={f}>{BOOK_FONTS[f].name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            <div style={FIELD}>
              <span style={LABEL}>Size (pt)</span>
              <input type="number" style={INPUT} value={el.size} onChange={e => patch({ size: Number(e.target.value) || 11 })} />
            </div>
            <div style={FIELD}>
              <span style={LABEL}>Weight</span>
              <select style={INPUT} value={el.weight} onChange={e => patch({ weight: Number(e.target.value) as 400 | 500 | 600 | 700 })}>
                {[400, 500, 600, 700].map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Align</span>
            <select style={INPUT} value={el.align} onChange={e => patch({ align: e.target.value as 'left' | 'center' | 'right' | 'justify' })}>
              {['left', 'center', 'right', 'justify'].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Color</span>
            <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.color} onChange={e => patch({ color: e.target.value })} />
          </div>
        </>
      )}

      {el.kind === 'shape' && (
        <>
          <div style={FIELD}>
            <span style={LABEL}>Shape</span>
            <select style={INPUT} value={el.shape} onChange={e => patch({ shape: e.target.value as BookShapeId })}>
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
            </select>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Fill</span>
            <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.fill ?? '#111827'} onChange={e => patch({ fill: e.target.value })} />
          </div>
          {el.shape === 'rect' && (
            <div style={FIELD}>
              <span style={LABEL}>Corner radius</span>
              <input type="number" min={0} style={INPUT} value={el.radius} onChange={e => patch({ radius: Number(e.target.value) || 0 })} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
