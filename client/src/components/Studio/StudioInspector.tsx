import { Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { useStudioStore } from '../../store/studioStore'
import { BOOK_FONT_ORDER, BOOK_FONTS } from './bookFonts'
import { CURRENCIES } from '../Budget/BudgetPanel.constants'
import ToggleSwitch from '../Settings/ToggleSwitch'
import { FRAME_SHAPES, SHAPE_GROUPS } from './shapes'
import {
  BOOK_BADGES, BOOK_METRICS, type BookAccommodationElement, type BookBadgeElement, type BookBadgeVariant,
  type BookDocument, type BookElement, type BookFontFamily, type BookIconElement, type BookListElement,
  type BookMapElement, type BookMetric, type BookPackingElement, type BookPhotoElement, type BookPlacesElement, type BookShapeElement, type BookShapeId, type BookStatsElement,
} from '../../types/book'

/** "star-5" -> "Star 5", "half-circle" -> "Half circle" */
function prettyShapeName(id: string): string {
  const words = id.split('-')
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

const SHAPE_GROUP_NAMES: Record<string, string> = {
  basic: 'Basic', polygons: 'Polygons', stars: 'Stars', arrows: 'Arrows',
  speech: 'Speech', travel: 'Travel', decor: 'Decoration', banners: 'Banners',
}
function prettyShapeGroupName(id: string): string {
  return SHAPE_GROUP_NAMES[id] ?? id
}

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
            <span style={LABEL}>Focal point</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 2 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>X {Math.round(el.focalX * 100)}%</span>
                <input type="range" min={0} max={1} step={0.02} value={el.focalX} onChange={e => patch({ focalX: Number(e.target.value) })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Y {Math.round(el.focalY * 100)}%</span>
                <input type="range" min={0} max={1} step={0.02} value={el.focalY} onChange={e => patch({ focalY: Number(e.target.value) })} />
              </label>
            </div>
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
            <span style={LABEL}>Mask</span>
            <select style={INPUT} value={el.mask ?? 'rect'} onChange={e => patch({ mask: e.target.value === 'rect' ? null : e.target.value as BookShapeId })}>
              {FRAME_SHAPES.map(s => <option key={s} value={s}>{prettyShapeName(s)}</option>)}
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
              {SHAPE_GROUPS.map(group => (
                <optgroup key={group.id} label={prettyShapeGroupName(group.id)}>
                  {group.shapes.map(s => <option key={s} value={s}>{prettyShapeName(s)}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Fill</span>
            <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.fill ?? '#111827'} onChange={e => patch({ fill: e.target.value })} />
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Gradient</span>
            <select style={INPUT} value={el.gradient} onChange={e => patch({ gradient: e.target.value as BookShapeElement['gradient'] })}>
              <option value="none">None</option>
              <option value="up">Fades up</option>
              <option value="down">Fades down</option>
            </select>
          </div>
          {el.shape === 'rect' && (
            <div style={FIELD}>
              <span style={LABEL}>Corner radius</span>
              <input type="number" min={0} style={INPUT} value={el.radius} onChange={e => patch({ radius: Number(e.target.value) || 0 })} />
            </div>
          )}
          <div style={{ ...FIELD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={LABEL}>Stroke</span>
            <ToggleSwitch on={el.stroke != null} onToggle={() => patch({ stroke: el.stroke != null ? null : '#111827', strokeWidth: el.stroke != null ? el.strokeWidth : (el.strokeWidth || 1) })} />
          </div>
          {el.stroke != null && (
            <>
              <div style={FIELD}>
                <span style={LABEL}>Stroke color</span>
                <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.stroke} onChange={e => patch({ stroke: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                <div style={FIELD}>
                  <span style={LABEL}>Width (mm)</span>
                  <input type="number" min={0.1} step={0.1} style={INPUT} value={el.strokeWidth} onChange={e => patch({ strokeWidth: Number(e.target.value) || 1 })} />
                </div>
                <div style={FIELD}>
                  <span style={LABEL}>Style</span>
                  <select style={INPUT} value={el.strokeStyle} onChange={e => patch({ strokeStyle: e.target.value as BookShapeElement['strokeStyle'] })}>
                    {['solid', 'dashed', 'dotted'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {el.kind === 'map' && <MapFields el={el} patch={patch} />}
      {el.kind === 'stats' && <StatsFields el={el} patch={patch} />}
      {el.kind === 'places' && <PlacesFields el={el as BookPlacesElement} patch={patch} />}
      {el.kind === 'badge' && <BadgeFields el={el} patch={patch} />}
      {el.kind === 'icon' && <IconFields el={el} patch={patch} />}
      {el.kind === 'list' && <ListFields el={el} patch={patch} />}
      {el.kind === 'packing' && <PackingFields el={el} patch={patch} />}
      {el.kind === 'accommodation' && <AccommodationFields el={el} patch={patch} />}
    </div>
  )
}

type Patch = (p: Partial<BookElement>) => void

function MapFields({ el, patch }: { el: BookMapElement; patch: Patch }) {
  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Map</span>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '2px 0 0' }}>
          {el.src ? 'Generated from the Travel panel.' : 'No map yet — add one from the Travel panel, then drop it here.'}
        </p>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Fit</span>
        <select style={INPUT} value={el.fit} onChange={e => patch({ fit: e.target.value as 'cover' | 'contain' })}>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Corner radius</span>
        <input type="number" min={0} style={INPUT} value={el.radius} onChange={e => patch({ radius: Number(e.target.value) || 0 })} />
      </div>
    </>
  )
}

function StatsFields({ el, patch }: { el: BookStatsElement; patch: Patch }) {
  const toggleMetric = (m: BookMetric) => {
    const on = el.metrics.includes(m)
    const metrics = on ? el.metrics.filter(x => x !== m) : [...el.metrics, m].slice(0, 7)
    patch({ metrics })
  }
  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Metrics (up to 7)</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {BOOK_METRICS.map(m => (
            <button key={m} onClick={() => toggleMetric(m)} style={{
              padding: '3px 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              border: el.metrics.includes(m) ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
              background: el.metrics.includes(m) ? 'var(--bg-tertiary)' : 'none', color: 'var(--text-primary)',
            }}>
              {m}
            </button>
          ))}
        </div>
      </div>
      {el.metrics.map(m => (
        <div key={m} style={FIELD}>
          <span style={LABEL}>{m} value {m === 'distance' || m === 'furthest' || m === 'elevationGain' || m === 'elevationLoss' ? '(metres)' : ''}</span>
          <input type="number" style={INPUT} value={el.values[m] ?? 0}
            onChange={e => patch({ values: { ...el.values, [m]: Number(e.target.value) || 0 } })} />
        </div>
      ))}
      {el.metrics.includes('budget') && (
        <div style={FIELD}>
          <span style={LABEL}>Budget currency</span>
          {/* A select, not free text — the schema requires exactly 3
              letters, and a partial keystroke mid-typing would fail
              validation on the next autosave and drop this whole element
              (see normalizeBookDocument's own "invalid element -> dropped"
              rule) rather than just this one field. */}
          <select style={INPUT} value={el.currency ?? 'EUR'} onChange={e => patch({ currency: e.target.value })}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}
      <div style={FIELD}>
        <span style={LABEL}>Layout</span>
        <select style={INPUT} value={el.layout} onChange={e => patch({ layout: e.target.value as BookStatsElement['layout'] })}>
          {['grid', 'row', 'column'].map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Units</span>
        <select style={INPUT} value={el.units} onChange={e => patch({ units: e.target.value as BookStatsElement['units'] })}>
          <option value="metric">Metric</option>
          <option value="imperial">Imperial</option>
        </select>
      </div>
      <div style={{ ...FIELD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={LABEL}>Icons</span>
        <ToggleSwitch on={el.showIcons} onToggle={() => patch({ showIcons: !el.showIcons })} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Accent color</span>
        <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
      </div>
    </>
  )
}

function PlacesFields({ el, patch }: { el: BookPlacesElement; patch: Patch }) {
  const [draftName, setDraftName] = useState('')
  const [draftNote, setDraftNote] = useState('')

  const addPlace = () => {
    const name = draftName.trim()
    if (!name) return
    patch({ places: [...el.places, { name, note: draftNote.trim() }] })
    setDraftName('')
    setDraftNote('')
  }
  const removeAt = (i: number) => patch({ places: el.places.filter((_, j) => j !== i) })
  const setNote = (i: number, note: string) => patch({ places: el.places.map((p, j) => (j === i ? { ...p, note } : p)) })

  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Places</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {el.places.map((p, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 6, borderRadius: 6, border: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</span>
                <button onClick={() => removeAt(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}>
                  <Trash2 size={12} />
                </button>
              </div>
              <input style={{ ...INPUT, fontSize: 11 }} placeholder="Note" value={p.note ?? ''} onChange={e => setNote(i, e.target.value)} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          <input style={INPUT} placeholder="Place name" value={draftName}
            onChange={e => setDraftName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPlace()} />
          <div style={{ display: 'flex', gap: 4 }}>
            <input style={{ ...INPUT, flex: 1 }} placeholder="Note (optional)" value={draftNote}
              onChange={e => setDraftNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPlace()} />
            <button onClick={addPlace} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Layout</span>
        <select style={INPUT} value={el.layout} onChange={e => patch({ layout: e.target.value as BookPlacesElement['layout'] })}>
          {['list', 'grid', 'column'].map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Align</span>
        <select style={INPUT} value={el.align} onChange={e => patch({ align: e.target.value as BookPlacesElement['align'] })}>
          {['left', 'center', 'right'].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
    </>
  )
}

function BadgeFields({ el, patch }: { el: BookBadgeElement; patch: Patch }) {
  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Variant</span>
        <select style={INPUT} value={el.variant} onChange={e => patch({ variant: e.target.value as BookBadgeVariant })}>
          {BOOK_BADGES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Text</span>
        <input style={INPUT} value={el.text} onChange={e => patch({ text: e.target.value })} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Sub-line</span>
        <input style={INPUT} value={el.sub} onChange={e => patch({ sub: e.target.value })} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Style</span>
        <select style={INPUT} value={el.style} onChange={e => patch({ style: e.target.value as BookBadgeElement['style'] })}>
          {['plain', 'chip', 'outline', 'stacked'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Accent color</span>
        <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
      </div>
    </>
  )
}

function IconFields({ el, patch }: { el: BookIconElement; patch: Patch }) {
  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Icon name (lucide, PascalCase)</span>
        <input style={INPUT} value={el.name} placeholder="Compass" onChange={e => patch({ name: e.target.value })} />
        <p style={{ fontSize: 10, color: 'var(--text-faint)', margin: '4px 0 0' }}>See lucide.dev/icons for names — Compass, Plane, MountainSnow…</p>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Color</span>
        <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.color} onChange={e => patch({ color: e.target.value })} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Line weight</span>
        <input type="number" min={0.25} max={4} step={0.25} style={INPUT} value={el.lineWidth} onChange={e => patch({ lineWidth: Number(e.target.value) || 2 })} />
      </div>
    </>
  )
}

function ListFields({ el, patch }: { el: BookListElement; patch: Patch }) {
  const setItem = (i: number, p: Partial<BookListElement['items'][number]>) =>
    patch({ items: el.items.map((it, j) => (j === i ? { ...it, ...p } : it)) })
  const removeItem = (i: number) => patch({ items: el.items.filter((_, j) => j !== i) })
  const addItem = () => patch({ items: [...el.items, { text: '', tone: 'pro' }] })

  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Items</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {el.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select style={{ ...INPUT, width: 64, flexShrink: 0 }} value={it.tone} onChange={e => setItem(i, { tone: e.target.value as 'pro' | 'con' | 'plain' })}>
                <option value="pro">+</option>
                <option value="con">–</option>
                <option value="plain">•</option>
              </select>
              <input style={INPUT} value={it.text} onChange={e => setItem(i, { text: e.target.value })} />
              <button onClick={() => removeItem(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex', flexShrink: 0 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addItem} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)' }}>
          <Plus size={12} /> Add item
        </button>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Layout</span>
        <select style={INPUT} value={el.layout} onChange={e => patch({ layout: e.target.value as BookListElement['layout'] })}>
          <option value="columns">Columns (pro / con)</option>
          <option value="stacked">Stacked</option>
        </select>
      </div>
      {el.layout === 'columns' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
          <div style={FIELD}>
            <span style={LABEL}>Pro label</span>
            <input style={INPUT} value={el.proLabel} onChange={e => patch({ proLabel: e.target.value })} />
          </div>
          <div style={FIELD}>
            <span style={LABEL}>Con label</span>
            <input style={INPUT} value={el.conLabel} onChange={e => patch({ conLabel: e.target.value })} />
          </div>
        </div>
      )}
      <div style={{ ...FIELD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={LABEL}>Marks</span>
        <ToggleSwitch on={el.showMarks} onToggle={() => patch({ showMarks: !el.showMarks })} />
      </div>
    </>
  )
}

function PackingFields({ el, patch }: { el: BookPackingElement; patch: Patch }) {
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState('')

  const addItem = () => {
    const name = draftName.trim()
    if (!name) return
    patch({ items: [...el.items, { name, category: draftCategory.trim(), checked: false, quantity: 1 }] })
    setDraftName('')
    setDraftCategory('')
  }
  const removeAt = (i: number) => patch({ items: el.items.filter((_, j) => j !== i) })
  const setItem = (i: number, p: Partial<BookPackingElement['items'][number]>) =>
    patch({ items: el.items.map((it, j) => (j === i ? { ...it, ...p } : it)) })

  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Items</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {el.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 6, borderRadius: 6, border: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={!!it.checked} onChange={e => setItem(i, { checked: e.target.checked })} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{it.name}</span>
                <input type="number" min={1} style={{ ...INPUT, width: 48, padding: '2px 4px' }} value={it.quantity ?? 1}
                  onChange={e => setItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
                <button onClick={() => removeAt(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}>
                  <Trash2 size={12} />
                </button>
              </div>
              <input style={{ ...INPUT, fontSize: 11 }} placeholder="Category" value={it.category ?? ''} onChange={e => setItem(i, { category: e.target.value })} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          <input style={INPUT} placeholder="Item name" value={draftName}
            onChange={e => setDraftName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
          <div style={{ display: 'flex', gap: 4 }}>
            <input style={{ ...INPUT, flex: 1 }} placeholder="Category (optional)" value={draftCategory}
              onChange={e => setDraftCategory(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
            <button onClick={addItem} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
      <div style={{ ...FIELD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={LABEL}>Group by category</span>
        <ToggleSwitch on={el.groupByCategory} onToggle={() => patch({ groupByCategory: !el.groupByCategory })} />
      </div>
      <div style={{ ...FIELD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={LABEL}>Show quantity</span>
        <ToggleSwitch on={el.showQuantity} onToggle={() => patch({ showQuantity: !el.showQuantity })} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Columns</span>
        <select style={INPUT} value={el.columns} onChange={e => patch({ columns: (Number(e.target.value) === 1 ? 1 : 2) })}>
          <option value={1}>1</option>
          <option value={2}>2</option>
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Accent color</span>
        <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
      </div>
    </>
  )
}

function AccommodationFields({ el, patch }: { el: BookAccommodationElement; patch: Patch }) {
  const [draftName, setDraftName] = useState('')

  const addStay = () => {
    const name = draftName.trim()
    if (!name) return
    patch({ stays: [...el.stays, { name, address: '', checkIn: null, checkOut: null, confirmation: '' }] })
    setDraftName('')
  }
  const removeAt = (i: number) => patch({ stays: el.stays.filter((_, j) => j !== i) })
  const setStay = (i: number, p: Partial<BookAccommodationElement['stays'][number]>) =>
    patch({ stays: el.stays.map((s, j) => (j === i ? { ...s, ...p } : s)) })

  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Stays</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {el.stays.map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 6, borderRadius: 6, border: '1px solid var(--border-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</span>
                <button onClick={() => removeAt(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}>
                  <Trash2 size={12} />
                </button>
              </div>
              <input style={{ ...INPUT, fontSize: 11 }} placeholder="Address" value={s.address ?? ''} onChange={e => setStay(i, { address: e.target.value })} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <input type="date" style={{ ...INPUT, fontSize: 11 }} value={s.checkIn?.slice(0, 10) ?? ''} onChange={e => setStay(i, { checkIn: e.target.value || null })} />
                <input type="date" style={{ ...INPUT, fontSize: 11 }} value={s.checkOut?.slice(0, 10) ?? ''} onChange={e => setStay(i, { checkOut: e.target.value || null })} />
              </div>
              <input style={{ ...INPUT, fontSize: 11 }} placeholder="Confirmation number" value={s.confirmation ?? ''} onChange={e => setStay(i, { confirmation: e.target.value })} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <input style={{ ...INPUT, flex: 1 }} placeholder="Stay name" value={draftName}
            onChange={e => setDraftName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStay()} />
          <button onClick={addStay} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div style={{ ...FIELD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={LABEL}>Show confirmation</span>
        <ToggleSwitch on={el.showConfirmation} onToggle={() => patch({ showConfirmation: !el.showConfirmation })} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Layout</span>
        <select style={INPUT} value={el.layout} onChange={e => patch({ layout: e.target.value as BookAccommodationElement['layout'] })}>
          <option value="cards">Cards</option>
          <option value="list">List</option>
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Accent color</span>
        <input type="color" style={{ ...INPUT, padding: 2, height: 32 }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
      </div>
    </>
  )
}
