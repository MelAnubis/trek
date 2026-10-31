import { useRef, useState } from 'react'
import { Globe2, Layers, Palette,
  Award, BarChart3, Circle, Compass, Copy, Hotel, ImageIcon, ListChecks, Luggage, Map as MapIconLucide, MapPin, Plus, Sparkles,
  Square, Trash2, Type, Upload, ChevronUp, ChevronDown, ChevronRight, LayoutGrid,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useStudioStore } from '../../store/studioStore'
import { useJourneyStore } from '../../store/journeyStore'
import { useToast } from '../shared/Toast'
import { normalizeImageFiles } from '../../utils/convertHeic'
import type { UploadProgress } from '../../utils/uploadQueue'
import { getApiErrorMessage } from '../../types'
import { elementId } from './bookIds'
import { BookPhotoImg } from './BookPhotoImg'
import { TEMPLATES, COVER_TEMPLATES, applyTemplate, type Template } from './templates'
import { SHAPE_GROUPS, SHAPE_PATHS, HOLED_SHAPES } from './shapes'
import type { BookElement, BookMetric, BookPageSetup, BookShapeId } from '../../types/book'
import { groupPhotosByDay, formatPhotoDayHeader } from '../../utils/groupPhotosByDay'
import { folioLabel, folioSettings, foliosOf } from './bookSheets'
import { countryName } from './countryShapes'
import { StudioLayersPanel } from './StudioLayersPanel'
import { StudioProviderPhotos } from './StudioProviderPhotos'
import { StudioLineShelf } from './StudioLineShelf'
import { StudioThemePanel } from './theme/StudioThemePanel'
import { DesignedPagesPanel } from './designed/DesignedPagesPanel'
import { SavedLayouts } from './designed/SavedLayouts'
import { LockupShelf } from './lockups/LockupShelf'
import { StickerShelf } from './stickers/StickerShelf'
import { SidebarTabs } from './SidebarTabs'

/**
 * The left rail: pages, layout templates, buttons to add a text/shape/
 * photo-frame/travel element, and the journey's own photos to drag onto the
 * canvas. Simpler than upstream's Studio (single scrollable rail with
 * sections, not separate tabs; no journal-entry browser yet, and the
 * layout gallery is the 12 programmatic templates from templates.ts rather
 * than upstream's hand-drawn reference set — see autoLayout.ts for why).
 */

const PANEL_SECTION: React.CSSProperties = { padding: '14px 14px 16px', borderBottom: '1px solid var(--border-secondary)' }
const PANEL_TITLE: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }

/** "hero-story" -> "Hero story" */
function prettyId(id: string): string {
  const words = id.replace(/^cover-/, '').split('-')
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

const SIDEBAR_COLLAPSE_KEY = 'trek-studio-sidebar-collapsed'

function loadCollapsedSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/**
 * One rail section, with a clickable header that collapses its body —
 * state remembered per browser (localStorage), not per document, since
 * it's a per-viewer convenience (which panels you like open) rather than
 * anything that belongs in the saved book.
 */
function CollapsibleSection({
  icon, title, collapsed, onToggle, headerExtra, children, disabled,
}: {
  /** Read-only book: the section's controls stay visible and cannot be used. */
  disabled?: boolean
  icon?: React.ReactNode
  title: string
  collapsed: boolean
  onToggle: () => void
  /** Rendered in the header, outside the toggle button — e.g. Pages' own "add spread" button, which must stay clickable independent of collapsing. */
  headerExtra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={PANEL_SECTION}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 10 }}>
        <button
          onClick={onToggle}
          aria-expanded={!collapsed}
          style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          {collapsed ? <ChevronRight size={12} color="var(--text-faint)" /> : <ChevronDown size={12} color="var(--text-faint)" />}
          {icon}
          <span style={PANEL_TITLE}>{title}</span>
        </button>
        {headerExtra}
      </div>
      {!collapsed && (disabled
        ? <fieldset disabled style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: 0.55 }}>{children}</fieldset>
        : children)}
    </div>
  )
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

/** A small filled preview of one shape from the library, for the picker grid. */
function ShapeSwatch({ shape }: { shape: BookShapeId }) {
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', display: 'block' }}>
      <path d={SHAPE_PATHS[shape]} fill="#52525b" fillRule={HOLED_SHAPES.has(shape) ? 'evenodd' : 'nonzero'} />
    </svg>
  )
}

export function StudioSidebar({
  journeyId,
  galleryPhotos,
  journeyStats,
  onGenerateMap,
  onGeneratePlaces,
  onGeneratePacking,
  onGenerateAccommodations,
}: {
  /** Lets the Photos panel upload straight into the journey's gallery, same action the journey editor's own uploader uses — the newly-added photos then show up here via the caller's own galleryPhotos, no separate refresh plumbing needed. */
  journeyId: number
  galleryPhotos: { photoId: number; caption: string | null; taken_at?: string | null; created_at?: number | null }[]
  /** Prefills a newly-added stats element's figures, when known — the journey's own totals rather than a blank grid the user has to fill in by hand. distanceKm/elevation are only known once the journey's linked trips have a GPX track. */
  journeyStats?: { days: number; entries: number; photos: number; places: number; countries?: number; countryCodes?: string[]; distanceKm?: number; elevationGainM?: number; elevationLossM?: number; budgetTotal?: number; budgetCurrency?: string }
  /** Renders a route-map raster image (gpxDrawing's canvas renderer, the same one auto-layout's route spread already uses) for a freshly-added map element — see BookMapElement's own comment on why this fork bakes a snapshot rather than rendering a live map. Omitted where the caller has no track/entry data to draw from (map elements can still be added, just start blank). */
  onGenerateMap?: () => Promise<string | null>
  /** Collects the journey's own places — from its linked trips' real place data, not every place in the app — for a freshly-added places element. Same fetch-then-update pattern as onGenerateMap. Omitted where the caller has no trip data to draw from (places elements can still be added, just start empty). */
  onGeneratePlaces?: () => Promise<{ name: string; note?: string }[]>
  /** Collects the journey's own packing list (linked trips' real packing_items) for a freshly-added packing element. Same fetch-then-update pattern as onGeneratePlaces. */
  onGeneratePacking?: () => Promise<{ name: string; category?: string; checked?: boolean; quantity?: number }[]>
  /** Collects the journey's own stays (linked trips' real day_accommodations) for a freshly-added accommodation element. Same fetch-then-update pattern as onGeneratePlaces. */
  onGenerateAccommodations?: () => Promise<{ name: string; address?: string; checkIn?: string | null; checkOut?: string | null; confirmation?: string }[]>
}) {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(loadCollapsedSections)
  const [showShapePicker, setShowShapePicker] = useState(false)
  const [elementsTab, setElementsTab] = useState<'basic' | 'text' | 'stickers'>('basic')
  const [travelTab, setTravelTab] = useState<'figures' | 'maps' | 'countries' | 'marks'>('figures')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [photosDragOver, setPhotosDragOver] = useState(false)
  const [showAllPhotos, setShowAllPhotos] = useState(false)
  /** Photos just brought in from Immich/Synology, shown on their own until the panel's filter is changed. */
  const [recentPhotoIds, setRecentPhotoIds] = useState<Set<number> | null>(null)
  const photoFileRef = useRef<HTMLInputElement>(null)
  const toggleSection = (id: string, wasCollapsed = !!collapsedSections[id]) => setCollapsedSections(prev => {
    const next = { ...prev, [id]: !wasCollapsed }
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(next)) } catch { /* private-mode/blocked storage — collapse state just won't persist */ }
    return next
  })
  const journeyEntries = useJourneyStore(s => s.current?.entries)
  const doc = useStudioStore(s => s.doc)
  const activeSpread = useStudioStore(s => s.activeSpread)
  const setActiveSpread = useStudioStore(s => s.setActiveSpread)
  const addSpread = useStudioStore(s => s.addSpread)
  const duplicateSpread = useStudioStore(s => s.duplicateSpread)
  const removeSpread = useStudioStore(s => s.removeSpread)
  const moveSpread = useStudioStore(s => s.moveSpread)
  const canEditSpread = useStudioStore(s => s.canEditSpread)
  const addElement = useStudioStore(s => s.addElement)
  const updateElement = useStudioStore(s => s.updateElement)
  const commit = useStudioStore(s => s.commit)
  const readOnly = useStudioStore(s => s.readOnly)

  if (!doc) return null

  const addCentered = (w: number, h: number, make: (id: string, frame: { x: number; y: number; w: number; h: number }) => BookElement) => {
    const x = (doc.page.pageWidth - w) / 2
    const y = (doc.page.pageHeight - h) / 2
    addElement(activeSpread, make(elementId('el'), { x, y, w, h }))
  }

  const addMap = async () => {
    const w = 100
    const h = 70
    const id = elementId('el')
    const x = (doc.page.pageWidth - w) / 2
    const y = (doc.page.pageHeight - h) / 2
    addElement(activeSpread, { id, frame: { x, y, w, h }, kind: 'map', rotation: 0, opacity: 1, locked: false, src: null, fit: 'cover', radius: 0 })
    if (!onGenerateMap) return
    const src = await onGenerateMap().catch(() => null)
    if (src) updateElement(activeSpread, id, { src })
  }

  const addPlaces = async () => {
    const w = 80
    const h = 50
    const id = elementId('el')
    const x = (doc.page.pageWidth - w) / 2
    const y = (doc.page.pageHeight - h) / 2
    addElement(activeSpread, {
      id, frame: { x, y, w, h }, kind: 'places', rotation: 0, opacity: 1, locked: false,
      font: 'sans', color: '#1a1a1a', accent: '#111111',
      places: [], layout: 'list', align: 'center',
    })
    if (!onGeneratePlaces) return
    const places = await onGeneratePlaces().catch(() => null)
    if (places && places.length) updateElement(activeSpread, id, { places })
  }

  const addPacking = async () => {
    const w = 90
    const h = 65
    const id = elementId('el')
    const x = (doc.page.pageWidth - w) / 2
    const y = (doc.page.pageHeight - h) / 2
    addElement(activeSpread, {
      id, frame: { x, y, w, h }, kind: 'packing', rotation: 0, opacity: 1, locked: false,
      font: 'sans', color: '#1a1a1a', accent: '#111111',
      items: [], groupByCategory: true, showQuantity: true, columns: 2,
    })
    if (!onGeneratePacking) return
    const items = await onGeneratePacking().catch(() => null)
    if (items && items.length) updateElement(activeSpread, id, { items })
  }

  const addAccommodation = async () => {
    const w = 90
    const h = 55
    const id = elementId('el')
    const x = (doc.page.pageWidth - w) / 2
    const y = (doc.page.pageHeight - h) / 2
    addElement(activeSpread, {
      id, frame: { x, y, w, h }, kind: 'accommodation', rotation: 0, opacity: 1, locked: false,
      font: 'sans', color: '#1a1a1a', accent: '#111111',
      stays: [], showConfirmation: true, layout: 'cards',
    })
    if (!onGenerateAccommodations) return
    const stays = await onGenerateAccommodations().catch(() => null)
    if (stays && stays.length) updateElement(activeSpread, id, { stays })
  }

  const addShape = (shape: BookShapeId) => {
    addCentered(60, 60, (id, frame) => ({
      id, frame, kind: 'shape', rotation: 0, opacity: 1, locked: false,
      shape, fill: '#111827', gradient: 'none', stroke: null, strokeWidth: 0, strokeStyle: 'solid', radius: 0,
    }))
    setShowShapePicker(false)
  }

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadProgress(null)
    try {
      const normalized = await normalizeImageFiles(files)
      const { failed } = await useJourneyStore.getState().uploadGalleryPhotos(journeyId, normalized, {
        onProgress: p => setUploadProgress(p),
      })
      if (failed.length > 0) {
        toast.error(t('journey.editor.uploadPartialFailed', { failed: String(failed.length), total: String(normalized.length) }))
      } else {
        toast.success(t('journey.photosUploaded', { count: String(normalized.length) }))
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('journey.photosUploadFailed')))
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    await uploadFiles(files)
    e.target.value = ''
  }

  const spread = doc.spreads[activeSpread]
  const isSingle = spread?.role !== 'inner'
  const layoutOptions = isSingle ? COVER_TEMPLATES : TEMPLATES

  // The active spread's own entry, when auto-layout (or a manual link) has
  // one set — entryId exists on every spread already (see BookSpread's own
  // comment) but nothing in Studio has ever read it for photo-picking
  // before. Used to default the Photos panel to "this entry's photos"
  // instead of the whole gallery when the connection is known.
  const entryId = spread?.entryId ?? null
  const entryPhotoIds = entryId != null
    ? new Set(journeyEntries?.find(e => e.id === entryId)?.photos.map(p => p.photo_id) ?? [])
    : null
  const visiblePhotos = recentPhotoIds
    ? galleryPhotos.filter(p => recentPhotoIds.has(p.photoId))
    : entryPhotoIds && !showAllPhotos
      ? galleryPhotos.filter(p => entryPhotoIds.has(p.photoId))
      : galleryPhotos

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
      <CollapsibleSection
        title={t('journey.studio.pageTab')}
        collapsed={!!collapsedSections.pages}
        onToggle={() => toggleSection('pages')}
        headerExtra={
          <button onClick={() => addSpread(activeSpread)} title={t('journey.studio.addSpread')}
            style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Plus size={13} />
          </button>
        }
      >
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
                  {sp.role === 'cover' ? t('journey.studio.role.cover') : sp.role === 'back' ? t('journey.studio.role.back') : sp.role === 'first' ? t('journey.studio.role.first') : sp.role === 'last' ? t('journey.studio.role.last') : folioLabel(foliosOf(doc.spreads, i, folioSettings(doc.page).startAt)) || `${i}`}
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
      </CollapsibleSection>

      {/* Photos */}
      <CollapsibleSection
        title={t('journey.studio.contentTab')}
        collapsed={!!collapsedSections.photos}
        onToggle={() => toggleSection('photos')}
        disabled={readOnly}
        headerExtra={
          <>
            <input ref={photoFileRef} type="file" accept="image/*" multiple hidden onChange={e => void handlePhotoUpload(e)} />
            {uploading ? (
              <span style={{ fontSize: 10, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {uploadProgress ? `${uploadProgress.done}/${uploadProgress.total}` : '…'}
              </span>
            ) : (
              <button onClick={() => photoFileRef.current?.click()} title={t('journey.studio.uploadPhotos')}
                style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <Upload size={13} />
              </button>
            )}
          </>
        }
      >
        <StudioProviderPhotos journeyId={journeyId} onAdded={ids => setRecentPhotoIds(ids.length ? new Set(ids) : null)} />
        {(entryPhotoIds || recentPhotoIds) && (() => {
          const tab = recentPhotoIds ? 'recent' : entryPhotoIds && !showAllPhotos ? 'entry' : 'all'
          const chip = (on: boolean) => ({ flex: 1, padding: '5px 8px', fontSize: 10, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: on ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', background: on ? 'var(--bg-tertiary)' : 'none', color: 'var(--text-primary)' })
          return (
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {entryPhotoIds && (
                <button onClick={() => { setRecentPhotoIds(null); setShowAllPhotos(false) }} aria-pressed={tab === 'entry'} style={chip(tab === 'entry')}>
                  {t('journey.studio.thisEntryPhotos')}
                </button>
              )}
              <button onClick={() => { setRecentPhotoIds(null); setShowAllPhotos(true) }} aria-pressed={tab === 'all'} style={chip(tab === 'all')}>
                {t('journey.studio.allPhotos')}
              </button>
              {recentPhotoIds && (
                <button data-testid="photos-recent" aria-pressed style={chip(true)}>
                  {t('journey.studio.photo.recent')}
                </button>
              )}
            </div>
          )
        })()}
        <div
          data-testid="photos-dropzone"
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setPhotosDragOver(true) } }}
          onDragLeave={() => setPhotosDragOver(false)}
          onDrop={e => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setPhotosDragOver(false)
            if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files)
          }}
          style={{
            borderRadius: 8,
            outline: photosDragOver ? '2px dashed var(--text-primary)' : 'none',
            outlineOffset: 2,
            transition: 'outline-color 120ms',
          }}
        >
          {entryPhotoIds && !showAllPhotos && visiblePhotos.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '8px 2px' }}>
              {t('journey.studio.noEntryPhotos')}
            </div>
          )}
          {groupPhotosByDay(visiblePhotos).map(group => (
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
      </CollapsibleSection>

      {/* Layouts */}
      <CollapsibleSection
        icon={<LayoutGrid size={12} color="var(--text-faint)" />}
        title={t('journey.studio.layoutsTab')}
        collapsed={!!collapsedSections.layouts}
        onToggle={() => toggleSection('layouts')}
        disabled={readOnly}
      >
        <DesignedPagesPanel t={t} locale={locale}
          onEmptyFrames={() => { if (collapsedSections.photos) toggleSection('photos') }} />
        <SavedLayouts t={t} />
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '16px 0 6px' }}>
          {t('journey.studio.builtInLayouts')}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 8px', lineHeight: 1.4 }}>
          {t('journey.studio.layoutsHint')}
        </p>
        {isSingle && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.4, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-tertiary)' }}>
            {t('journey.studio.layoutsCoverHint')}
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {layoutOptions.map(tpl => (
            <button key={tpl.id} onClick={() => applyLayout(tpl.id)} className="st-sb-layout" title={prettyId(tpl.id)}>
              <LayoutSwatch template={tpl} single={isSingle} page={doc.page} />
              <span>{prettyId(tpl.id)}</span>
            </button>
          ))}
        </div>
      </CollapsibleSection>

      {/* Elements */}
      <CollapsibleSection
        title={t('journey.studio.elementsTab')}
        collapsed={!!collapsedSections.elements}
        onToggle={() => toggleSection('elements')}
        disabled={readOnly}
      >
        <SidebarTabs<typeof elementsTab> value={elementsTab} onChange={setElementsTab} label={t('journey.studio.elementsTab')} testId="elements-tabs"
          tabs={[{ id: 'basic', label: t('journey.studio.elementsBasic') }, { id: 'text', label: t('journey.studio.elementsText') }, { id: 'stickers', label: t('journey.studio.stickers') }]} />
        {elementsTab === 'text' && <LockupShelf t={t} photos={galleryPhotos} />}
        {elementsTab === 'stickers' && <StickerShelf t={t} />}
        {elementsTab === 'basic' && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => addCentered(80, 20, (id, frame) => ({
            id, frame, kind: 'text', rotation: 0, opacity: 1, locked: false,
            text: '', font: 'sans', size: 14, weight: 400, italic: false, align: 'left', leading: 1.4, tracking: 0, color: '#1a1a1a', binding: null, overridden: true,
          }))} className="st-sb-add"><Type size={15} /> {t('journey.studio.addText')}</button>
          <button onClick={() => addCentered(90, 65, (id, frame) => ({
            id, frame, kind: 'photo', rotation: 0, opacity: 1, locked: false,
            photoId: null, fit: 'cover', focalX: 0.5, focalY: 0.5, radius: 0, filter: 'none', frameStyle: 'none', mask: null,
          }))} className="st-sb-add"><ImageIcon size={15} /> {t('journey.studio.addPhotoFrame')}</button>
          <button onClick={() => addShape('rect')} className="st-sb-add"><Square size={15} /> {t('journey.studio.addRect')}</button>
          <button onClick={() => addShape('ellipse')} className="st-sb-add"><Circle size={15} /> {t('journey.studio.addEllipse')}</button>
        </div>
        <div style={{ position: 'relative', marginTop: 6 }}>
          <button onClick={() => setShowShapePicker(v => !v)} className="st-sb-add" style={{ width: '100%', flexDirection: 'row', gap: 6, padding: '8px 10px' }}>
            <Sparkles size={13} /> {t('journey.studio.moreShapes')}
          </button>
          {showShapePicker && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 260, overflowY: 'auto',
              borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-card)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)', padding: 8, zIndex: 20,
            }}>
              {SHAPE_GROUPS.map(group => (
                <div key={group.id} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 4 }}>
                    {t(`journey.studio.shapeGroup.${group.id}`)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                    {group.shapes.map(s => (
                      <button key={s} onClick={() => addShape(s)} title={s} style={{
                        aspectRatio: '1', padding: 4, borderRadius: 6, border: '1px solid var(--border-primary)',
                        background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ShapeSwatch shape={s} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <StudioLineShelf page={doc.page} single={doc.spreads[activeSpread]?.role !== 'inner'} t={t}
          onAdd={el => addElement(activeSpread, el)} />
        </>)}
      </CollapsibleSection>

      {/* Travel */}
      <CollapsibleSection
        icon={<Compass size={12} color="var(--text-faint)" />}
        title={t('journey.studio.travelTab')}
        collapsed={!!collapsedSections.travel}
        onToggle={() => toggleSection('travel')}
        disabled={readOnly}
      >
        <SidebarTabs<typeof travelTab> value={travelTab} onChange={setTravelTab} label={t('journey.studio.travelTab')} testId="travel-tabs"
          tabs={[{ id: 'figures', label: t('journey.studio.travelFigures') }, { id: 'maps', label: t('journey.studio.travelMaps') }, { id: 'countries', label: t('journey.studio.travelCountries') }, { id: 'marks', label: t('journey.studio.travelMarks') }]} />
        {travelTab === 'figures' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={() => {
              const metrics: BookMetric[] = ['days', 'photos', 'places']
              const values: Partial<Record<BookMetric, number>> = journeyStats ? { days: journeyStats.days, photos: journeyStats.photos, places: journeyStats.places } : {}
              if (journeyStats?.distanceKm != null) { metrics.push('distance'); values.distance = Math.round(journeyStats.distanceKm * 1000) }
              if (journeyStats?.elevationGainM != null) { metrics.push('elevationGain'); values.elevationGain = Math.round(journeyStats.elevationGainM) }
              if (journeyStats?.elevationLossM != null) { metrics.push('elevationLoss'); values.elevationLoss = Math.round(journeyStats.elevationLossM) }
              if (journeyStats?.budgetTotal) { metrics.push('budget'); values.budget = journeyStats.budgetTotal }
              if (journeyStats?.countries) { metrics.push('countries'); values.countries = journeyStats.countries }
              addCentered(100, 40, (id, frame) => ({
                id, frame, kind: 'stats', rotation: 0, opacity: 1, locked: false,
                font: 'sans', color: '#1a1a1a', accent: '#111111',
                metrics, layout: 'row', showIcons: true, units: 'metric',
                currency: journeyStats?.budgetCurrency ?? null,
                values,
              }))
            }} className="st-sb-add"><BarChart3 size={15} /> {t('journey.studio.addStats')}</button>
            <button onClick={() => addCentered(90, 60, (id, frame) => ({
              id, frame, kind: 'list', rotation: 0, opacity: 1, locked: false,
              font: 'sans', color: '#1a1a1a', accent: '#111111',
              items: [], layout: 'columns', showMarks: true, proLabel: 'Pros', conLabel: 'Cons',
            }))} className="st-sb-add"><ListChecks size={15} /> {t('journey.studio.addList')}</button>
            <button onClick={() => void addPacking()} className="st-sb-add"><Luggage size={15} /> {t('journey.studio.addPacking')}</button>
            <button onClick={() => void addAccommodation()} className="st-sb-add"><Hotel size={15} /> {t('journey.studio.addAccommodation')}</button>
            </div>
        )}
        {travelTab === 'maps' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={() => void addMap()} className="st-sb-add"><MapIconLucide size={15} /> {t('journey.studio.addMap')}</button>
            <button onClick={() => void addPlaces()} className="st-sb-add"><MapPin size={15} /> {t('journey.studio.addPlaces')}</button>
            </div>
        )}
        {travelTab === 'countries' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={() => {
              const codes = (journeyStats?.countryCodes ?? []).slice(0, 60)
              const names = codes.map(c => countryName(c, locale))
              const rows = Math.max(1, codes.length)
              addCentered(110, Math.min(doc.page.pageHeight * 0.8, Math.max(24, rows * 16)), (id, frame) => ({
                id, frame, kind: 'countries', rotation: 0, opacity: 1, locked: false,
                font: 'sans', color: '#1a1a1a', accent: '#111111',
                codes, names, layout: 'list', showOutline: true, showFlag: false, showName: true, align: 'center',
              }))
            }} className="st-sb-add"><Globe2 size={15} /> {t('journey.studio.addCountries')}</button>
            </div>
        )}
        {travelTab === 'marks' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button onClick={() => addCentered(40, 24, (id, frame) => ({
              id, frame, kind: 'badge', rotation: 0, opacity: 1, locked: false,
              font: 'sans', color: '#1a1a1a', accent: '#111111',
              variant: 'date', text: '', sub: '', code: null, style: 'plain',
            }))} className="st-sb-add"><Award size={15} /> {t('journey.studio.addBadge')}</button>
            <button onClick={() => addCentered(20, 20, (id, frame) => ({
              id, frame, kind: 'icon', rotation: 0, opacity: 1, locked: false,
              name: 'Compass', color: '#111827', lineWidth: 2,
            }))} className="st-sb-add"><Sparkles size={15} /> {t('journey.studio.addIcon')}</button>
            </div>
        )}
      </CollapsibleSection>

      {/* Theme (5.7.6): folded until opened, being the tallest section. */}
      <CollapsibleSection
        icon={<Palette size={12} color="var(--text-faint)" />}
        title={t('studio.theme.panel')}
        collapsed={collapsedSections.theme !== false}
        onToggle={() => toggleSection('theme', collapsedSections.theme !== false)}
        disabled={readOnly}
      >
        <StudioThemePanel />
      </CollapsibleSection>

      {/* Layers — what is on this page, front to back (lock, hide, rename, reorder, group). */}
      <CollapsibleSection
        icon={<Layers size={12} color="var(--text-faint)" />}
        title={t('journey.studio.layers')}
        collapsed={!!collapsedSections.layers}
        onToggle={() => toggleSection('layers')}
        headerExtra={spread ? <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{spread.elements.length}</span> : undefined}
      >
        <StudioLayersPanel t={t} />
      </CollapsibleSection>

      <style>{`
        .st-sb-btn { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; background: none; border-radius: 4px; cursor: pointer; color: var(--text-faint); }
        .st-sb-btn:hover { background: var(--bg-hover); color: var(--text-muted); }
        .st-sb-btn.is-danger:hover { background: #fef2f2; color: #dc2626; }
        .st-sb-add { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; border-radius: 8px; border: 1px solid var(--border-primary); background: none; cursor: pointer; color: var(--text-muted); font-size: 10px; font-family: inherit; }
        .st-sb-add:hover { background: var(--bg-hover); }
        .st-sb-layout { display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 8px; border: 1px solid var(--border-primary); background: none; cursor: pointer; font-family: inherit; }
        .st-sb-layout:hover { border-color: var(--text-muted); }
        .st-sb-layout span { font-size: 9px; color: var(--text-faint); text-align: center; }
        .st-tpl-card { display: flex; flex-direction: column; gap: 4px; padding: 0; border: none; background: none; cursor: pointer; font-family: inherit; min-width: 0; }
        .st-tpl-art { position: relative; display: block; overflow: hidden; border-radius: 4px; border: 1px solid var(--border-primary); background: #fff; box-sizing: content-box; }
        .st-tpl-card:hover .st-tpl-art { border-color: var(--text-muted); box-shadow: 0 2px 8px rgba(0,0,0,.12); }
        .st-tpl-label { font-size: 9.5px; color: var(--text-muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .st-tpl-chip { padding: 3px 8px; border-radius: 99px; border: 1px solid var(--border-primary); background: var(--bg-card); color: var(--text-muted); font-size: 10.5px; font-family: inherit; cursor: pointer; }
        .st-tpl-chip.is-on { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg-primary); }
      `}</style>
    </div>
  )
}
