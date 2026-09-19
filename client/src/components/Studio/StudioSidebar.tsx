import { Circle, Copy, ImageIcon, Plus, Square, Trash2, Type, ChevronUp, ChevronDown, LayoutGrid } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useStudioStore } from '../../store/studioStore'
import { elementId } from './bookIds'
import { BookPhotoImg } from './BookPhotoImg'
import { TEMPLATES, COVER_TEMPLATES, applyTemplate, type Template } from './templates'
import type { BookElement, BookPageSetup } from '../../types/book'
import { groupPhotosByDay, formatPhotoDayHeader } from '../../utils/groupPhotosByDay'

/**
 * The left rail: pages, layout templates, buttons to add a text/shape/
 * photo-frame element, and the journey's own photos to drag onto the
 * canvas. Simpler than upstream's Studio (single scrollable rail with
 * sections, not separate tabs; no journal-entry browser yet, and the
 * layout gallery is the 12 programmatic templates from templates.ts rather
 * than upstream's hand-drawn reference set — see autoLayout.ts for why).
 */

const PANEL_SECTION: React.CSSProperties = { padding: '14px 14px 16px', borderBottom: '1px solid var(--border-secondary)' }
const PANEL_TITLE: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 10 }

/** "hero-story" -> "Hero story" */
function prettyId(id: string): string {
  const words = id.replace(/^cover-/, '').split('-')
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

/** A miniature preview of what a template's frames look like, from its own `build()` output. */
function LayoutSwatch({ template, single, page }: { template: Template; single: boolean; page: BookPageSetup }) {
  const w = single ? page.pageWidth : page.pageWidth * 2
  const h = page.pageHeight
  const slots = template.build(page)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', aspectRatio: `${w} / ${h}`, display: 'block', background: '#fff', borderRadius: 4 }}>
      {slots.map((s, i) => (
        <rect key={i} x={s.frame.x} y={s.frame.y} width={s.frame.w} height={s.frame.h}
          fill={s.kind === 'photo' ? '#d4d4d8' : s.kind === 'heading' ? '#52525b' : s.kind === 'body' ? '#a1a1aa' : '#e4e4e7'} />
      ))}
    </svg>
  )
}

export function StudioSidebar({
  galleryPhotos,
}: {
  galleryPhotos: { photoId: number; caption: string | null; taken_at?: string | null; created_at?: number | null }[]
}) {
  const { t, locale } = useTranslation()
  const doc = useStudioStore(s => s.doc)
  const activeSpread = useStudioStore(s => s.activeSpread)
  const setActiveSpread = useStudioStore(s => s.setActiveSpread)
  const addSpread = useStudioStore(s => s.addSpread)
  const duplicateSpread = useStudioStore(s => s.duplicateSpread)
  const removeSpread = useStudioStore(s => s.removeSpread)
  const moveSpread = useStudioStore(s => s.moveSpread)
  const canEditSpread = useStudioStore(s => s.canEditSpread)
  const addElement = useStudioStore(s => s.addElement)
  const commit = useStudioStore(s => s.commit)

  if (!doc) return null

  const addCentered = (w: number, h: number, make: (id: string, frame: { x: number; y: number; w: number; h: number }) => BookElement) => {
    const x = (doc.page.pageWidth - w) / 2
    const y = (doc.page.pageHeight - h) / 2
    addElement(activeSpread, make(elementId('el'), { x, y, w, h }))
  }

  const spread = doc.spreads[activeSpread]
  const isSingle = spread?.role !== 'inner'
  const layoutOptions = isSingle ? COVER_TEMPLATES : TEMPLATES

  const applyLayout = (tplId: string) => {
    const tpl = layoutOptions.find(t => t.id === tplId)
    if (!tpl) return
    commit(d => ({
      ...d,
      spreads: d.spreads.map((sp, i) => (i !== activeSpread ? sp : applyTemplate(sp, tpl, d.page))),
    }))
  }

  return (
    <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border-secondary)', overflowY: 'auto', height: '100%' }}>
      {/* Pages */}
      <div style={PANEL_SECTION}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={PANEL_TITLE}>{t('journey.studio.pageTab')}</span>
          <button onClick={() => addSpread(activeSpread)} title={t('journey.studio.addSpread')}
            style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Plus size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {doc.spreads.map((sp, i) => {
            const active = i === activeSpread
            const editable = canEditSpread(i)
            return (
              <div key={sp.id}
                onClick={() => setActiveSpread(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                  background: active ? 'var(--bg-tertiary)' : 'transparent',
                  border: active ? '1px solid var(--border-primary)' : '1px solid transparent',
                }}>
                <div style={{
                  width: 28, height: 20, borderRadius: 3, flexShrink: 0,
                  background: sp.background || '#fff', border: '1px solid var(--border-primary)',
                }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                  {sp.role === 'cover' ? 'Cover' : sp.role === 'back' ? 'Back' : `${i}`}
                </span>
                {editable && (
                  <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => moveSpread(i, -1)} title={t('journey.studio.moveSpreadUp')} className="st-sb-btn"><ChevronUp size={12} /></button>
                    <button onClick={() => moveSpread(i, 1)} title={t('journey.studio.moveSpreadDown')} className="st-sb-btn"><ChevronDown size={12} /></button>
                    <button onClick={() => duplicateSpread(i)} title={t('journey.studio.duplicateSpread')} className="st-sb-btn"><Copy size={12} /></button>
                    <button onClick={() => removeSpread(i)} title={t('journey.studio.removeSpread')} className="st-sb-btn is-danger"><Trash2 size={12} /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Layouts */}
      <div style={PANEL_SECTION}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <LayoutGrid size={12} color="var(--text-faint)" />
          <span style={PANEL_TITLE}>{t('journey.studio.layoutsTab')}</span>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 8px', lineHeight: 1.4 }}>
          {t('journey.studio.layoutsHint')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {layoutOptions.map(tpl => (
            <button key={tpl.id} onClick={() => applyLayout(tpl.id)} className="st-sb-layout" title={prettyId(tpl.id)}>
              <LayoutSwatch template={tpl} single={isSingle} page={doc.page} />
              <span>{prettyId(tpl.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Elements */}
      <div style={PANEL_SECTION}>
        <div style={PANEL_TITLE}>{t('journey.studio.elementsTab')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => addCentered(80, 20, (id, frame) => ({
            id, frame, kind: 'text', rotation: 0, opacity: 1, locked: false,
            text: '', font: 'sans', size: 14, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0, color: '#1a1a1a', binding: null, overridden: true,
          }))} className="st-sb-add"><Type size={15} /> {t('journey.studio.addText')}</button>
          <button onClick={() => addCentered(90, 65, (id, frame) => ({
            id, frame, kind: 'photo', rotation: 0, opacity: 1, locked: false,
            photoId: null, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null,
          }))} className="st-sb-add"><ImageIcon size={15} /> {t('journey.studio.addPhotoFrame')}</button>
          <button onClick={() => addCentered(60, 60, (id, frame) => ({
            id, frame, kind: 'shape', rotation: 0, opacity: 1, locked: false,
            shape: 'rect', fill: '#111827', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
          }))} className="st-sb-add"><Square size={15} /> {t('journey.studio.addRect')}</button>
          <button onClick={() => addCentered(60, 60, (id, frame) => ({
            id, frame, kind: 'shape', rotation: 0, opacity: 1, locked: false,
            shape: 'ellipse', fill: '#111827', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
          }))} className="st-sb-add"><Circle size={15} /> {t('journey.studio.addEllipse')}</button>
        </div>
      </div>

      {/* Photos */}
      <div style={PANEL_SECTION}>
        <div style={PANEL_TITLE}>{t('journey.studio.photosTab')}</div>
        {groupPhotosByDay(galleryPhotos).map(group => (
          <div key={group.dayKey} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-faint)', marginBottom: 6 }}>
              {formatPhotoDayHeader(group.dayKey, locale)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {group.photos.map(p => (
                <div key={p.photoId}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('application/x-trek-photo', String(p.photoId)); e.dataTransfer.effectAllowed = 'copy' }}
                  style={{ aspectRatio: '1', borderRadius: 6, overflow: 'hidden', cursor: 'grab', background: 'var(--bg-tertiary)' }}>
                  <BookPhotoImg photoId={p.photoId} big={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .st-sb-btn { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; background: none; border-radius: 4px; cursor: pointer; color: var(--text-faint); }
        .st-sb-btn:hover { background: var(--bg-hover); color: var(--text-muted); }
        .st-sb-btn.is-danger:hover { background: #fef2f2; color: #dc2626; }
        .st-sb-add { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; border-radius: 8px; border: 1px solid var(--border-primary); background: none; cursor: pointer; color: var(--text-muted); font-size: 10px; font-family: inherit; }
        .st-sb-add:hover { background: var(--bg-hover); }
        .st-sb-layout { display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 8px; border: 1px solid var(--border-primary); background: none; cursor: pointer; font-family: inherit; }
        .st-sb-layout:hover { border-color: var(--text-muted); }
        .st-sb-layout span { font-size: 9px; color: var(--text-faint); text-align: center; }
      `}</style>
    </div>
  )
}
