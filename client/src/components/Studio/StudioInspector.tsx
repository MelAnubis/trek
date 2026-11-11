import { Lock, Plus, Printer, Trash2, AlertTriangle, Unlock } from 'lucide-react'
import { StudioArrangeSection } from './StudioArrangeSection'
import { selectionTitle } from './studioLayerRows'
import { MIN_PRINT_DPI, photoDpi, usePhotoPixels } from './photoResolution'
import { photoZoomOf } from './photoLook'
import { StudioTextEffects } from './text/StudioTextEffects'
import { StickerInspector } from './stickers/StickerInspector'
import { useJourneyStore } from '../../store/journeyStore'
import { PhotoCropExtras, PhotoLookSections, usePhotoLookPatch, useUndoablePatch } from './StudioPhotoLook'
import { EdgeSection, PageBackgroundSection, ShapeFillSection } from './StudioPaintSections'
import { LineInspector } from './StudioLineInspector'
import { withThemeLinks } from './bookTheme'
import { StudioThemeLink } from './theme/StudioThemePanel'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useStudioStore } from '../../store/studioStore'
import { BOOK_FONT_ORDER, BOOK_FONTS, BOOK_FONT_WEIGHTS, nearestWeight } from './bookFonts'
import { folioSettings } from './bookSheets'
import { ColorSwatches, EffectPicker, FilterPicker, FontPicker, FramePicker, TextPresets } from './StyleControls'
import { CURRENCIES } from '../Budget/BudgetPanel.constants'
import ToggleSwitch from '../Settings/ToggleSwitch'
import { FRAME_SHAPES, SHAPE_GROUPS } from './shapes'
import {
  BOOK_BADGES, BOOK_METRICS, type BookAccommodationElement, type BookBadgeElement, type BookBadgeVariant,
  type BookCountriesElement, type BookDocument, type BookElement, type BookIconElement, type BookListElement,
  type BookMapElement, type BookMetric, type BookPackingElement, type BookPhotoElement, type BookPlacesElement, type BookShapeElement, type BookShapeId, type BookStatsElement,
  type BookWeight, type BookTextElement, type BookSpread, type BookStickerElement,
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
function DocumentPanel({ doc, spreadIndex }: { doc: BookDocument; spreadIndex: number }) {
  const { t } = useTranslation()
  const setPageNumbers = useStudioStore(s => s.setPageNumbers)
  const spread = doc.spreads[spreadIndex]
  const cfg = folioSettings(doc.page)
  const seg = (on: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 4px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6,
    border: on ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
    background: on ? 'var(--bg-tertiary)' : 'none', color: 'var(--text-primary)',
  })

  return (
    <div className="!w-[260px] !shrink-[0] ![border-left:1px_solid_var(--border-secondary)] !p-[14px] !overflow-y-auto">
      <span className="!block !mb-[14px]" style={{ ...LABEL }}>{t('journey.studio.document')}</span>

      {spread && <PageBackgroundSection spread={spread} spreadIndex={spreadIndex} t={t} />}

      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.pageNumbers')}</span>
        <div className="!flex !items-center !justify-between !mt-[2px]">
          <span className="!text-[length:12px] ![color:var(--text-primary)]">{t('journey.studio.pageNumbers')}</span>
          <ToggleSwitch on={cfg.show} onToggle={() => setPageNumbers(!cfg.show)} />
        </div>
      </div>

      {cfg.show && (
        <div data-testid="folio-settings">
          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.folio.position')}</span>
            <div className="!flex !gap-[4px]">
              {(['outer', 'centre', 'inner'] as const).map(pos => (
                <button key={pos} aria-pressed={cfg.position === pos} onClick={() => setPageNumbers({ position: pos })} style={seg(cfg.position === pos)}>
                  {t(`journey.studio.folio.position.${pos}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="!grid ![grid-template-columns:1fr_1fr_1fr] !gap-[6px]">
            <label style={FIELD}>
              <span style={LABEL}>{t('journey.studio.folio.startAt')}</span>
              <NumberField value={cfg.startAt} min={0} max={9999} step={1} onCommit={v => setPageNumbers({ startAt: Math.round(v) })} />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>{t('journey.studio.folio.size')}</span>
              <NumberField value={cfg.size} min={4} max={48} step={0.5} onCommit={v => setPageNumbers({ size: v })} />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>{t('journey.studio.folio.margin')}</span>
              <NumberField value={cfg.margin} min={0} max={60} step={0.5} onCommit={v => setPageNumbers({ margin: v })} />
            </label>
          </div>

          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.folio.font')}</span>
            <select style={INPUT} value={cfg.font} onChange={e => setPageNumbers({ font: e.target.value as typeof cfg.font })}>
              {BOOK_FONT_ORDER.map(f => <option key={f} value={f}>{BOOK_FONTS[f].name}</option>)}
            </select>
          </div>

          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.folio.color')}</span>
            <div className="!flex !items-center !justify-between">
              <span className="!text-[length:12px] ![color:var(--text-primary)]">{t('journey.studio.folio.autoColor')}</span>
              <ToggleSwitch on={cfg.autoColor} onToggle={() => setPageNumbers({ autoColor: !cfg.autoColor })} />
            </div>
            {!cfg.autoColor && (
              <input className="!w-[100%] !h-[28px] !mt-[6px] ![border:1px_solid_var(--border-primary)] !rounded-[6px] ![background:none] !cursor-pointer" type="color" aria-label={t('journey.studio.folio.color')} value={cfg.color}
                onChange={e => setPageNumbers({ color: e.target.value, autoColor: false })} />
            )}
            <span className="!text-[length:10px] ![color:var(--text-faint)] !leading-[1.4]">{t('journey.studio.folio.autoColorHint')}</span>
          </div>
        </div>
      )}

      <p className="!text-[length:12px] ![color:var(--text-faint)] !text-center !mt-[24px] !mb-[8px]">
        {t('journey.studio.inspectorEmpty')}
      </p>
      <p className="!text-[length:11px] ![color:var(--text-faint)] !text-center">
        {t('journey.studio.pageDimensions', { w: Math.round(doc.page.pageWidth), h: Math.round(doc.page.pageHeight) })}
      </p>
    </div>
  )
}

/** Commits on blur or Enter, so typing "1", "12" isn't two undo steps; out-of-range values are clamped. */
function NumberField({ value, min, max, step, onCommit }: { value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = () => {
    const n = Number(draft.replace(',', '.'))
    if (draft.trim() === '' || !Number.isFinite(n)) { setDraft(String(value)); return }
    const v = Math.min(max, Math.max(min, n))
    if (v !== value) onCommit(v); else setDraft(String(value))
  }
  return (
    <input style={INPUT} type="number" inputMode="decimal" min={min} max={max} step={step} value={draft}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
  )
}

/** The old marker effect's band, as it is first switched on. */
const MARKER = { color: '#fde68a', alpha: 1, padX: 1.2, padY: 0.3, radius: 0 }

export function StudioInspector({ spreadIndex }: { spreadIndex: number }) {
  const { t } = useTranslation()
  const doc = useStudioStore(s => s.doc)
  const selection = useStudioStore(s => s.selection)
  const updateElement = useStudioStore(s => s.updateElement)
  const theme = useStudioStore(s => s.doc?.theme)
  const setFrame = useStudioStore(s => s.setFrame)
  const readOnly = useStudioStore(s => s.readOnly)

  const spread = doc?.spreads[spreadIndex]
  const el = spread?.elements.find(e => selection.includes(e.id) && selection[selection.length - 1] === e.id)
    ?? spread?.elements.find(e => selection.includes(e.id))

  if (!el) {
    return doc ? <DocumentPanel doc={doc} spreadIndex={spreadIndex} /> : (
      <div className="!w-[260px] !shrink-[0] ![border-left:1px_solid_var(--border-secondary)] !p-[16px]">
        <p className="!text-[length:12px] ![color:var(--text-faint)] !text-center !mt-[40px]">
          {t('journey.studio.inspectorEmpty')}
        </p>
      </div>
    )
  }

  // A colour or face changed by hand unlinks it from the theme; a link set takes the theme's value (bookTheme.ts).
  const patch = (p: Partial<BookElement>) => {
    const linked = withThemeLinks({ ...el, ...p } as BookElement, p as Record<string, unknown>, theme) as unknown as Record<string, unknown>
    const out: Record<string, unknown> = { ...p }
    for (const k of Object.keys(linked)) if (linked[k] !== (el as unknown as Record<string, unknown>)[k]) out[k] = linked[k]
    for (const k of ['token', 'strokeToken', 'accentToken', 'fontRole']) if (k in el && !(k in linked)) out[k] = undefined
    updateElement(spreadIndex, el.id, out as Partial<BookElement>)
  }
  const visibleSelection = selection.filter(id => spread?.elements.some(e => e.id === id))
  const title = visibleSelection.length > 1
    ? selectionTitle(spread, visibleSelection, t)
    : (el.name || t(`journey.studio.kind.${el.kind}`))

  return (
    <div className="!w-[260px] !shrink-[0] ![border-left:1px_solid_var(--border-secondary)] !p-[14px] !overflow-y-auto">
      <div className="!flex !items-center !justify-between !mb-[14px]">
        <span className="!text-[length:12px] !font-[700] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap" data-testid="inspector-title">{title}</span>
        <button className="!flex !items-center !justify-center !w-[24px] !h-[24px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer ![color:var(--text-muted)]" onClick={() => patch({ locked: !el.locked })} title={t(el.locked ? 'journey.studio.unlock' : 'journey.studio.lock')}>
          {el.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      </div>

      {/* Read-only (a newer Studio's book, or a viewer): every control shows its value and none can change it. */}
      <fieldset className="![border:0] !p-[0] !m-[0] !min-w-[0]" disabled={readOnly}>
      <StudioArrangeSection spreadIndex={spreadIndex} t={t} />

      {visibleSelection.length > 1 && (
        <p className="!text-[length:10px] ![color:var(--text-faint)] !m-[-4px_0_12px] !leading-[1.4]">
          {t('journey.studio.inspectorLastPicked', { kind: el.name || t(`journey.studio.kind.${el.kind}`) })}
        </p>
      )}

      {/* Position & size */}
      <div style={FIELD}>
        <span style={LABEL}>Position &amp; size (mm)</span>
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px]">
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

      {el.kind === 'line' && <LineInspector el={el} spreadIndex={spreadIndex} t={t} />}
      {el.kind === 'sticker' && <StickerLook el={el} spreadIndex={spreadIndex} />}

      {el.kind === 'photo' && (
        <>
          <div style={FIELD}>
            <span style={LABEL}>Fit</span>
            <select style={INPUT} value={el.fit} onChange={e => patch({ fit: e.target.value as 'cover' | 'contain' })}>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
            </select>
          </div>
          <PhotoLook el={el} spreadIndex={spreadIndex} part="crop" />
          <PrintResolution el={el} />
          <div style={FIELD}>
            <span style={LABEL}>Focal point</span>
            <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px] !mt-[2px]">
              <label className="!flex !flex-col !gap-[2px]">
                <span className="!text-[length:10px] ![color:var(--text-faint)]">X {Math.round(el.focalX * 100)}%</span>
                <input type="range" min={0} max={1} step={0.02} value={el.focalX} onChange={e => patch({ focalX: Number(e.target.value) })} />
              </label>
              <label className="!flex !flex-col !gap-[2px]">
                <span className="!text-[length:10px] ![color:var(--text-faint)]">Y {Math.round(el.focalY * 100)}%</span>
                <input type="range" min={0} max={1} step={0.02} value={el.focalY} onChange={e => patch({ focalY: Number(e.target.value) })} />
              </label>
            </div>
          </div>
          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.style.filter')}</span>
            <FilterPicker el={el} onPick={filter => patch({ filter })} t={t} />
          </div>
          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.style.frame')}</span>
            <FramePicker value={el.frameStyle} onPick={frameStyle => patch({ frameStyle })} t={t} />
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
          <ElementEdge el={el} spreadIndex={spreadIndex} outline={el.mask && el.mask !== 'rect' ? el.mask : null} />
          <PhotoLook el={el} spreadIndex={spreadIndex} part="sections" />
        </>
      )}

      {el.kind === 'text' && (
        <>
          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.style.quickStyles')}</span>
            <TextPresets onApply={p => patch(p)} t={t} />
          </div>
          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.style.font')}</span>
            <FontPicker value={el.font} onPick={font => patch({ font, weight: nearestWeight(font, el.weight) as BookWeight })} t={t} />
          </div>
          <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px] !mb-[12px]">
            <div style={FIELD}>
              <span style={LABEL}>Size (pt)</span>
              <input type="number" style={INPUT} value={el.size} onChange={e => patch({ size: Number(e.target.value) || 11 })} />
            </div>
            <div style={FIELD}>
              <span style={LABEL}>Weight</span>
              <select style={INPUT} value={el.weight} data-testid="text-weight" onChange={e => patch({ weight: Number(e.target.value) as BookWeight })}>
                {[...new Set([...(BOOK_FONT_WEIGHTS[el.font] ?? [400]), el.weight])].sort((x, y) => x - y).map(w => <option key={w} value={w}>{w}</option>)}
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
            <span style={LABEL}>{t('journey.studio.style.effect')}</span>
            <EffectPicker value={el.effect ?? 'none'} t={t} onPick={effect => patch({
              effect,
              // The marker keeps its colour in `highlight`; leaving it must not leave a band behind.
              ...(effect === 'highlight' ? { highlight: { ...MARKER, ...el.highlight } } : el.effect === 'highlight' ? { highlight: undefined } : {}),
            })} />
          </div>
          {el.effect === 'highlight' && (
            <div style={FIELD}>
              <span style={LABEL}>{t('journey.studio.style.highlightColor')}</span>
              <ColorSwatches value={el.highlight?.color ?? '#fde68a'} onPick={color => patch({ highlight: { ...MARKER, ...el.highlight, color } })} label={t('journey.studio.style.highlightColor')} t={t} />
            </div>
          )}
          <TextEffects el={el} spread={spread} spreadIndex={spreadIndex} />
          <div style={FIELD}>
            <span style={LABEL}>{t('journey.studio.style.textColor')}</span>
            <ColorSwatches value={el.color} onPick={color => patch({ color })} label={t('journey.studio.style.textColor')} t={t} />
            <StudioThemeLink theme={theme} token={el.token} t={t} onLink={(token, color) => patch({ color, token })} onUnlink={() => updateElement(spreadIndex, el.id, { token: undefined })} />
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
          <ShapeFillSection el={el} spreadIndex={spreadIndex} t={t} />
          {el.fill !== null && <StudioThemeLink theme={theme} token={el.token} t={t} onLink={(token, fill) => patch({ fill, token, paint: undefined })} onUnlink={() => updateElement(spreadIndex, el.id, { token: undefined })} />}
          {el.shape === 'rect' && (
            <div style={FIELD}>
              <span style={LABEL}>Corner radius</span>
              <input type="number" min={0} style={INPUT} value={el.radius} onChange={e => patch({ radius: Number(e.target.value) || 0 })} />
            </div>
          )}
          <div className="!flex-row !items-center !justify-between" style={{ ...FIELD }}>
            <span style={LABEL}>Stroke</span>
            <ToggleSwitch on={el.stroke != null} onToggle={() => patch({ stroke: el.stroke != null ? null : '#111827', strokeWidth: el.stroke != null ? el.strokeWidth : (el.strokeWidth || 1) })} />
          </div>
          {el.stroke != null && (
            <>
              <div style={FIELD}>
                <span style={LABEL}>Stroke color</span>
                <input className="!p-[2px] !h-[32px]" type="color" style={{ ...INPUT }} value={el.stroke} onChange={e => patch({ stroke: e.target.value })} />
              </div>
              <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px] !mb-[12px]">
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
          <ElementEdge el={el} spreadIndex={spreadIndex} outline={el.shape} />
        </>
      )}

      {el.kind === 'map' && <MapFields el={el} patch={patch} />}
      {el.kind === 'stats' && <StatsFields el={el} patch={patch} />}
      {el.kind === 'places' && <PlacesFields el={el as BookPlacesElement} patch={patch} />}
      {el.kind === 'countries' && <CountriesFields el={el as BookCountriesElement} patch={patch} />}
      {el.kind === 'badge' && <BadgeFields el={el} patch={patch} />}
      {el.kind === 'icon' && <IconFields el={el} patch={patch} />}
      {el.kind === 'list' && <ListFields el={el} patch={patch} />}
      {el.kind === 'packing' && <PackingFields el={el} patch={patch} />}
      {el.kind === 'accommodation' && <AccommodationFields el={el} patch={patch} />}
      </fieldset>
    </div>
  )
}

type Patch = (p: Partial<BookElement>) => void

/** A sticker's colours, mirror and turn (stickers/StickerInspector.tsx), each change one undo step. */
function StickerLook({ el, spreadIndex }: { el: BookStickerElement; spreadIndex: number }) {
  const { t } = useTranslation()
  const { set } = useUndoablePatch<Partial<BookElement>>(spreadIndex, el.id)
  return <StickerInspector el={el} set={set} t={t} />
}

/** The text's effects (text/StudioTextEffects.tsx), each change one undo step. */
function TextEffects({ el, spread, spreadIndex }: { el: BookTextElement; spread: BookSpread | undefined; spreadIndex: number }) {
  const { t } = useTranslation()
  const { set, live } = useUndoablePatch<Partial<BookElement>>(spreadIndex, el.id)
  const entries = useJourneyStore(s => s.current?.entries)
  const photos = useMemo(() => {
    const ids = new Set<number>()
    for (const e of spread?.elements ?? []) if (e.kind === 'photo' && e.photoId != null) ids.add(e.photoId)
    for (const en of entries ?? []) for (const ph of en.photos) ids.add(ph.photo_id)
    return [...ids].map(photoId => ({ photoId }))
  }, [spread, entries])
  return <StudioTextEffects el={el} set={set} live={live} photos={photos} spread={spread} t={t} />
}

/** The cut edge of a shape or a photo (StudioPaintSections.tsx), each change one undo step. */
function ElementEdge({ el, spreadIndex, outline }: { el: BookShapeElement | BookPhotoElement; spreadIndex: number; outline: BookShapeId | null }) {
  const { t } = useTranslation()
  const { set } = useUndoablePatch<Partial<BookElement>>(spreadIndex, el.id)
  return <EdgeSection edge={el.edge} edgeSize={el.edgeSize} outline={outline} onSet={p => set(p as Partial<BookElement>)} t={t} />
}

/** The photo look's rows (StudioPhotoLook.tsx), each change one undo step. */
function PhotoLook({ el, spreadIndex, part }: { el: BookPhotoElement; spreadIndex: number; part: 'crop' | 'sections' }) {
  const { t } = useTranslation()
  const { set, live } = usePhotoLookPatch(spreadIndex, el.id)
  return part === 'crop'
    ? <PhotoCropExtras el={el} set={set} live={live} t={t} />
    : <PhotoLookSections el={el} set={set} live={live} t={t} />
}

/** What prints when the photo leaves the printer: about this many dots per inch, and a warning under the threshold. */
function PrintResolution({ el }: { el: BookPhotoElement }) {
  const { t } = useTranslation()
  const pixels = usePhotoPixels(el.photoId)
  const dpi = el.photoId == null ? null : photoDpi(el, pixels, photoZoomOf(el))
  if (dpi === null) return null
  const low = dpi < MIN_PRINT_DPI
  return (
    <div className="!flex !gap-[8px] !items-start !p-[7px_9px] !mb-[12px] !rounded-[8px]" role="status" data-testid="photo-dpi" data-low={low ? 'true' : 'false'} style={{ border: `1px solid ${low ? '#f59e0b' : 'var(--border-primary)'}`, background: low ? 'rgba(245,158,11,0.10)' : 'var(--bg-tertiary)', color: low ? '#b45309' : 'var(--text-muted)' }}>
      {low ? <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden /> : <Printer size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />}
      <div>
        <p className="!m-[0] !text-[length:11.5px] !font-[600]">{t('journey.studio.photo.dpi', { dpi })}</p>
        {low && <p className="!m-[2px_0_0] !text-[length:10.5px] !leading-[1.4]">{t('journey.studio.photo.dpiLow', { min: MIN_PRINT_DPI })}</p>}
      </div>
    </div>
  )
}

function MapFields({ el, patch }: { el: BookMapElement; patch: Patch }) {
  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>Map</span>
        <p className="!text-[length:11px] ![color:var(--text-faint)] !m-[2px_0_0]">
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
        <div className="!flex !flex-wrap !gap-[4px] !mt-[4px]">
          {BOOK_METRICS.map(m => (
            <button className="!p-[3px_8px] !rounded-[999px] !text-[length:11px] !cursor-pointer ![font-family:inherit] ![color:var(--text-primary)]" key={m} onClick={() => toggleMetric(m)} style={{ border: el.metrics.includes(m) ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', background: el.metrics.includes(m) ? 'var(--bg-tertiary)' : 'none' }}>
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
      <div className="!flex-row !items-center !justify-between" style={{ ...FIELD }}>
        <span style={LABEL}>Icons</span>
        <ToggleSwitch on={el.showIcons} onToggle={() => patch({ showIcons: !el.showIcons })} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Accent color</span>
        <input className="!p-[2px] !h-[32px]" type="color" style={{ ...INPUT }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
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
        <div className="!flex !flex-col !gap-[6px] !mt-[4px]">
          {el.places.map((p, i) => (
            <div className="!flex !flex-col !gap-[3px] !p-[6px] !rounded-[6px] ![border:1px_solid_var(--border-primary)]" key={i}>
              <div className="!flex !items-center !gap-[6px]">
                <span className="!flex-[1] !text-[length:12px] !font-[600] ![color:var(--text-primary)]">{p.name}</span>
                <button className="![border:none] ![background:none] !cursor-pointer ![color:var(--text-faint)] !flex" onClick={() => removeAt(i)}>
                  <Trash2 size={12} />
                </button>
              </div>
              <input className="!text-[length:11px]" style={{ ...INPUT }} placeholder="Note" value={p.note ?? ''} onChange={e => setNote(i, e.target.value)} />
            </div>
          ))}
        </div>
        <div className="!flex !flex-col !gap-[4px] !mt-[6px]">
          <input style={INPUT} placeholder="Place name" value={draftName}
            onChange={e => setDraftName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPlace()} />
          <div className="!flex !gap-[4px]">
            <input className="!flex-[1]" style={{ ...INPUT }} placeholder="Note (optional)" value={draftNote}
              onChange={e => setDraftNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPlace()} />
            <button className="!flex !items-center !justify-center !w-[32px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer ![color:var(--text-muted)]" onClick={addPlace}>
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

function CountriesFields({ el, patch }: { el: BookCountriesElement; patch: Patch }) {
  const { t } = useTranslation()
  const toggle = (key: 'showOutline' | 'showFlag' | 'showName', label: string) => (
    <div className="!flex-row !items-center !justify-between" style={{ ...FIELD }}>
      <span style={LABEL}>{label}</span>
      <ToggleSwitch on={el[key]} onToggle={() => patch({ [key]: !el[key] } as Partial<BookCountriesElement>)} />
    </div>
  )
  return (
    <>
      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.countries.list')}</span>
        <div className="!flex !flex-col !gap-[4px]">
          {el.codes.map((code, i) => (
            <div className="!flex !items-center !gap-[6px]" key={`${code}-${i}`}>
              <span className="!text-[length:11px] ![color:var(--text-faint)] !w-[22px]">{code}</span>
              <input className="!flex-[1]" style={{ ...INPUT }} value={el.names[i] ?? ''} onChange={e => patch({ names: el.codes.map((_, j) => (j === i ? e.target.value : el.names[j] ?? '')) })} />
              <button className="![border:none] ![background:none] !cursor-pointer ![color:var(--text-faint)] !flex" onClick={() => patch({ codes: el.codes.filter((_, j) => j !== i), names: el.names.filter((_, j) => j !== i) })}
                aria-label={t('common.delete')}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {el.codes.length === 0 && <span className="!text-[length:11px] ![color:var(--text-faint)]">{t('journey.studio.countries.empty')}</span>}
        </div>
      </div>
      {toggle('showOutline', t('journey.studio.countries.outline'))}
      {toggle('showFlag', t('journey.studio.countries.flag'))}
      {toggle('showName', t('journey.studio.countries.name'))}
      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.countries.layout')}</span>
        <select style={INPUT} value={el.layout} onChange={e => patch({ layout: e.target.value as BookCountriesElement['layout'] })}>
          {(['list', 'grid', 'column'] as const).map(l => <option key={l} value={l}>{t(`journey.studio.countries.layout.${l}`)}</option>)}
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.style.textColor')}</span>
        <ColorSwatches value={el.color} onPick={color => patch({ color })} label={t('journey.studio.style.textColor')} t={t} />
      </div>
      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.countries.outlineColor')}</span>
        <ColorSwatches value={el.accent} onPick={accent => patch({ accent })} label={t('journey.studio.countries.outlineColor')} t={t} />
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
      {(el.variant === 'flag' || el.variant === 'country') && (
        <div style={FIELD}>
          <span style={LABEL}>Country code</span>
          <input style={INPUT} placeholder="e.g. FR, JP, BR" value={el.code ?? ''} maxLength={24}
            onChange={e => patch({ code: e.target.value.trim() ? e.target.value.toUpperCase() : null })} />
          <p className="!text-[length:10px] ![color:var(--text-faint)] !m-[4px_0_0]">
            Picks a distinct geometric flag glyph — not the real national flag, this app has no flag artwork.
          </p>
        </div>
      )}
      <div style={FIELD}>
        <span style={LABEL}>Style</span>
        <select style={INPUT} value={el.style} onChange={e => patch({ style: e.target.value as BookBadgeElement['style'] })}>
          {['plain', 'chip', 'outline', 'stacked'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Accent color</span>
        <input className="!p-[2px] !h-[32px]" type="color" style={{ ...INPUT }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
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
        <p className="!text-[length:10px] ![color:var(--text-faint)] !m-[4px_0_0]">See lucide.dev/icons for names — Compass, Plane, MountainSnow…</p>
      </div>
      <div style={FIELD}>
        <span style={LABEL}>Color</span>
        <input className="!p-[2px] !h-[32px]" type="color" style={{ ...INPUT }} value={el.color} onChange={e => patch({ color: e.target.value })} />
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
        <div className="!flex !flex-col !gap-[6px] !mt-[4px]">
          {el.items.map((it, i) => (
            <div className="!flex !gap-[4px] !items-center" key={i}>
              <select className="!w-[64px] !shrink-[0]" style={{ ...INPUT }} value={it.tone} onChange={e => setItem(i, { tone: e.target.value as 'pro' | 'con' | 'plain' })}>
                <option value="pro">+</option>
                <option value="con">–</option>
                <option value="plain">•</option>
              </select>
              <input style={INPUT} value={it.text} onChange={e => setItem(i, { text: e.target.value })} />
              <button className="![border:none] ![background:none] !cursor-pointer ![color:var(--text-faint)] !flex !shrink-[0]" onClick={() => removeItem(i)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <button className="!flex !items-center !gap-[4px] !mt-[6px] !p-[5px_8px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer !text-[length:11px] ![color:var(--text-muted)]" onClick={addItem}>
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
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[6px] !mb-[12px]">
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
      <div className="!flex-row !items-center !justify-between" style={{ ...FIELD }}>
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
        <div className="!flex !flex-col !gap-[6px] !mt-[4px]">
          {el.items.map((it, i) => (
            <div className="!flex !flex-col !gap-[3px] !p-[6px] !rounded-[6px] ![border:1px_solid_var(--border-primary)]" key={i}>
              <div className="!flex !items-center !gap-[6px]">
                <input type="checkbox" checked={!!it.checked} onChange={e => setItem(i, { checked: e.target.checked })} />
                <span className="!flex-[1] !text-[length:12px] !font-[600] ![color:var(--text-primary)]">{it.name}</span>
                <input className="!w-[48px] !p-[2px_4px]" type="number" min={1} style={{ ...INPUT }} value={it.quantity ?? 1}
                  onChange={e => setItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
                <button className="![border:none] ![background:none] !cursor-pointer ![color:var(--text-faint)] !flex" onClick={() => removeAt(i)}>
                  <Trash2 size={12} />
                </button>
              </div>
              <input className="!text-[length:11px]" style={{ ...INPUT }} placeholder="Category" value={it.category ?? ''} onChange={e => setItem(i, { category: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="!flex !flex-col !gap-[4px] !mt-[6px]">
          <input style={INPUT} placeholder="Item name" value={draftName}
            onChange={e => setDraftName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
          <div className="!flex !gap-[4px]">
            <input className="!flex-[1]" style={{ ...INPUT }} placeholder="Category (optional)" value={draftCategory}
              onChange={e => setDraftCategory(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} />
            <button className="!flex !items-center !justify-center !w-[32px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer ![color:var(--text-muted)]" onClick={addItem}>
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
      <div className="!flex-row !items-center !justify-between" style={{ ...FIELD }}>
        <span style={LABEL}>Group by category</span>
        <ToggleSwitch on={el.groupByCategory} onToggle={() => patch({ groupByCategory: !el.groupByCategory })} />
      </div>
      <div className="!flex-row !items-center !justify-between" style={{ ...FIELD }}>
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
        <input className="!p-[2px] !h-[32px]" type="color" style={{ ...INPUT }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
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
        <div className="!flex !flex-col !gap-[6px] !mt-[4px]">
          {el.stays.map((s, i) => (
            <div className="!flex !flex-col !gap-[3px] !p-[6px] !rounded-[6px] ![border:1px_solid_var(--border-primary)]" key={i}>
              <div className="!flex !items-center !gap-[6px]">
                <span className="!flex-[1] !text-[length:12px] !font-[600] ![color:var(--text-primary)]">{s.name}</span>
                <button className="![border:none] ![background:none] !cursor-pointer ![color:var(--text-faint)] !flex" onClick={() => removeAt(i)}>
                  <Trash2 size={12} />
                </button>
              </div>
              <input className="!text-[length:11px]" style={{ ...INPUT }} placeholder="Address" value={s.address ?? ''} onChange={e => setStay(i, { address: e.target.value })} />
              <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[4px]">
                <input className="!text-[length:11px]" type="date" style={{ ...INPUT }} value={s.checkIn?.slice(0, 10) ?? ''} onChange={e => setStay(i, { checkIn: e.target.value || null })} />
                <input className="!text-[length:11px]" type="date" style={{ ...INPUT }} value={s.checkOut?.slice(0, 10) ?? ''} onChange={e => setStay(i, { checkOut: e.target.value || null })} />
              </div>
              <input className="!text-[length:11px]" style={{ ...INPUT }} placeholder="Confirmation number" value={s.confirmation ?? ''} onChange={e => setStay(i, { confirmation: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="!flex !gap-[4px] !mt-[6px]">
          <input className="!flex-[1]" style={{ ...INPUT }} placeholder="Stay name" value={draftName}
            onChange={e => setDraftName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStay()} />
          <button className="!flex !items-center !justify-center !w-[32px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer ![color:var(--text-muted)]" onClick={addStay}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="!flex-row !items-center !justify-between" style={{ ...FIELD }}>
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
        <input className="!p-[2px] !h-[32px]" type="color" style={{ ...INPUT }} value={el.accent} onChange={e => patch({ accent: e.target.value })} />
      </div>
    </>
  )
}
