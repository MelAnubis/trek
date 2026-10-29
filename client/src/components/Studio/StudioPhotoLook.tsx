import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, FlipHorizontal2, RotateCcw } from 'lucide-react'
import { useStudioStore } from '../../store/studioStore'
import ToggleSwitch from '../Settings/ToggleSwitch'
import { ColorSwatches } from './StyleControls'
import {
  PHOTO_ADJUSTMENTS, PHOTO_DUOTONES, PHOTO_EDGE_MAX, PHOTO_LOOK_STARTS, PHOTO_SHADOW_REACH, PHOTO_ZOOM,
  photoLookOf, type PhotoAdjustment,
} from './photoLook'
import type { BookPhotoAdjust, BookPhotoEdge, BookPhotoElement } from '../../types/book'

/**
 * The inspector rows of the photo look (5.7.2, port of liketrek/TREK's
 * Studio/photo/StudioPhotoLook.tsx): zoom and mirror beside the crop, then
 * the border, hard shadow and cutout, the adjustments and the duotone.
 *
 * A part that is off is left out of the document (undefined), never stored
 * as a neutral value, so a photo nobody restyled stays exactly what it was.
 * Every change is one undo step; a slider follows the thumb while it moves
 * and becomes one step when it is let go.
 */

type Patch = Partial<BookPhotoElement>
type T = (k: string, params?: Record<string, string | number>) => string

interface RowProps {
  el: BookPhotoElement
  /** One undo step. */
  set: (patch: Patch) => void
  /** While a slider moves: the page follows, the step is taken on release. */
  live: (patch: Patch) => void
  t: T
}

const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }
const SMALL: CSSProperties = { fontSize: 11, color: 'var(--text-muted)' }
const INPUT: CSSProperties = { padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit', width: '100%' }
const CHIP: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 99, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const CHIP_ON: CSSProperties = { ...CHIP, background: 'var(--text-primary)', color: 'var(--bg-primary)', borderColor: 'var(--text-primary)' }

const percent = (v: number) => `${Math.round(v * 100)}%`
const signed = (v: number) => {
  const n = Math.round(v * 100)
  return n > 0 ? `+${n}` : String(n)
}

/** `set` and `live` for one photo: a drag is held as one gesture and recorded once. */
export function usePhotoLookPatch(spreadIndex: number, id: string) {
  const dragging = useRef(false)
  const update = (p: Patch) => useStudioStore.getState().updateElement(spreadIndex, id, p)
  const live = (p: Patch) => {
    if (!dragging.current) { useStudioStore.getState().beginGesture(); dragging.current = true }
    update(p)
  }
  const set = (p: Patch) => {
    if (!dragging.current) useStudioStore.getState().beginGesture()
    dragging.current = false
    update(p)
    useStudioStore.getState().endGesture()
  }
  return { set, live }
}

/** A number set by dragging, for the values judged by eye. */
export function StudioSlider({ label, value, min, max, step, format, onLive, onCommit, testId }: {
  label: string; value: number; min: number; max: number; step: number
  format: (v: number) => string; onLive: (v: number) => void; onCommit: (v: number) => void; testId?: string
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  const end = () => {
    if (draft === null) return
    setDraft(null)
    onCommit(draft)
  }
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '2px 8px', marginBottom: 8 }}>
      <span style={SMALL}>{label}</span>
      <output style={{ ...SMALL, fontVariantNumeric: 'tabular-nums' }}>{format(shown)}</output>
      <input
        type="range" min={min} max={max} step={step} value={shown} data-testid={testId}
        aria-label={label} aria-valuetext={format(shown)} style={{ gridColumn: '1 / -1', width: '100%' }}
        onChange={e => { const v = Number(e.target.value); setDraft(v); onLive(v) }}
        onPointerUp={end} onKeyUp={end} onBlur={end}
      />
    </label>
  )
}

function NumField({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={SMALL}>{label}</span>
      <input type="number" style={INPUT} value={value} min={min} max={max} step={step}
        onChange={e => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }} />
    </label>
  )
}

function Switch({ label, on, onToggle, testId }: { label: string; on: boolean; onToggle: () => void; testId?: string }) {
  return (
    <div data-testid={testId} data-on={on ? 'true' : 'false'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
      <ToggleSwitch on={on} onToggle={onToggle} />
    </div>
  )
}

function Section({ label, hint, defaultOpen, children, testId }: { label: string; hint?: string; defaultOpen: boolean; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-testid={testId} style={{ borderTop: '1px solid var(--border-faint, var(--border-primary))', padding: '9px 0 2px', marginBottom: 6 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
        <span style={LABEL}>{label}</span>
        <ChevronDown size={13} style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : undefined }} aria-hidden />
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {hint && <p style={{ ...SMALL, fontSize: 10.5, margin: '0 0 8px', color: 'var(--text-faint)' }}>{hint}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

const BODY: CSSProperties = { paddingLeft: 8, borderLeft: '2px solid var(--border-primary)', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }

/** Beside the crop: how far the picture is zoomed about its focal point and whether it is mirrored. */
export function PhotoCropExtras({ el, set, live, t }: RowProps) {
  if (el.photoId == null) return null
  const look = photoLookOf(el)
  const zoomOf = (v: number) => (v > PHOTO_ZOOM.min ? Math.round(v * 100) / 100 : undefined)
  return (
    <div style={{ marginBottom: 12 }}>
      <StudioSlider
        label={t('journey.studio.photo.zoom')} value={look.zoom} min={PHOTO_ZOOM.min} max={PHOTO_ZOOM.max} step={0.05}
        format={percent} testId="photo-zoom"
        onLive={v => live({ zoom: zoomOf(v) })} onCommit={v => set({ zoom: zoomOf(v) })}
      />
      <button type="button" data-testid="photo-flip" style={look.flipX ? CHIP_ON : CHIP} aria-pressed={look.flipX}
        onClick={() => set({ flipX: look.flipX ? undefined : true })}>
        <FlipHorizontal2 size={13} aria-hidden />
        {t('journey.studio.photo.flip')}
      </button>
    </div>
  )
}

function EdgeRow({ label, value, start, onSet, t, testId }: {
  label: string; value: BookPhotoEdge | null; start: BookPhotoEdge; onSet: (edge: BookPhotoEdge | undefined) => void; t: T; testId: string
}) {
  return (
    <div>
      <Switch label={label} on={!!value} onToggle={() => onSet(value ? undefined : { ...start })} testId={testId} />
      {value && (
        <div style={BODY}>
          <NumField label={`${t('journey.studio.photo.width')} (mm)`} value={value.width} min={0.1} max={PHOTO_EDGE_MAX} step={0.5}
            onChange={width => onSet({ ...value, width })} />
          <ColorSwatches value={value.color} onPick={color => onSet({ ...value, color })} label={label} t={t} />
        </div>
      )}
    </div>
  )
}

function ShadowRow({ el, set, live, t }: RowProps) {
  const shadow = photoLookOf(el).shadow
  return (
    <div>
      <Switch label={t('journey.studio.photo.shadow')} on={!!shadow} testId="photo-shadow"
        onToggle={() => set({ shadow: shadow ? undefined : { ...PHOTO_LOOK_STARTS.shadow } })} />
      {shadow && (
        <div style={BODY}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(['dx', 'dy'] as const).map(axis => (
              <NumField key={axis} label={`${t(`journey.studio.photo.${axis}`)} (mm)`} value={shadow[axis]}
                min={-PHOTO_SHADOW_REACH} max={PHOTO_SHADOW_REACH} step={0.5}
                onChange={v => set({ shadow: { ...shadow, [axis]: v } })} />
            ))}
          </div>
          <StudioSlider label={t('journey.studio.photo.strength')} value={shadow.alpha} min={0} max={1} step={0.05} format={percent}
            onLive={alpha => live({ shadow: { ...shadow, alpha } })} onCommit={alpha => set({ shadow: { ...shadow, alpha } })} />
          <ColorSwatches value={shadow.color} onPick={color => set({ shadow: { ...shadow, color } })} label={t('journey.studio.photo.shadow')} t={t} />
        </div>
      )}
    </div>
  )
}

function AdjustRows({ el, set, live, t }: RowProps) {
  const adjust = photoLookOf(el).adjust
  const next = (key: PhotoAdjustment, v: number): BookPhotoAdjust | undefined => {
    const all = { ...(adjust ?? {}), [key]: Math.round(v * 100) / 100 }
    return PHOTO_ADJUSTMENTS.some(k => all[k]) ? all : undefined
  }
  return (
    <>
      {PHOTO_ADJUSTMENTS.map(key => (
        <StudioSlider key={key} label={t(`journey.studio.photo.${key}`)} value={adjust?.[key] ?? 0} min={-1} max={1} step={0.05}
          format={signed} testId={`photo-adjust-${key}`}
          onLive={v => live({ adjust: next(key, v) })} onCommit={v => set({ adjust: next(key, v) })} />
      ))}
      {adjust && (
        <button type="button" style={CHIP} data-testid="photo-adjust-reset" onClick={() => set({ adjust: undefined })}>
          <RotateCcw size={13} aria-hidden />
          {t('journey.studio.photo.reset')}
        </button>
      )}
    </>
  )
}

function DuotoneRows({ el, set, t }: Omit<RowProps, 'live'>) {
  const duotone = photoLookOf(el).duotone
  return (
    <>
      <Switch label={t('journey.studio.photo.duotone')} on={!!duotone} testId="photo-duotone"
        onToggle={() => set({ duotone: duotone ? undefined : { ...PHOTO_LOOK_STARTS.duotone } })} />
      {duotone && (
        <div style={BODY}>
          <div role="radiogroup" aria-label={t('journey.studio.photo.duotone')} style={{ display: 'flex', gap: 6 }}>
            {PHOTO_DUOTONES.map(pair => {
              const on = pair.dark === duotone.dark && pair.light === duotone.light
              return (
                <button type="button" key={pair.dark + pair.light} role="radio" aria-checked={on} aria-label={`${pair.dark} ${pair.light}`}
                  onClick={() => set({ duotone: { ...pair } })}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', padding: 0,
                    border: on ? '2px solid var(--text-primary)' : '1px solid var(--border-primary)',
                    backgroundImage: `linear-gradient(135deg, ${pair.dark} 50%, ${pair.light} 50%)`,
                  }} />
              )
            })}
          </div>
          <span style={SMALL}>{t('journey.studio.photo.duotoneDark')}</span>
          <ColorSwatches value={duotone.dark} onPick={dark => set({ duotone: { ...duotone, dark } })} label={t('journey.studio.photo.duotoneDark')} t={t} />
          <span style={SMALL}>{t('journey.studio.photo.duotoneLight')}</span>
          <ColorSwatches value={duotone.light} onPick={light => set({ duotone: { ...duotone, light } })} label={t('journey.studio.photo.duotoneLight')} t={t} />
        </div>
      )}
    </>
  )
}

/** The look's own sections: edges, adjustments, duotone. An empty frame has no picture to style. */
export function PhotoLookSections(props: RowProps) {
  const { el, set, t } = props
  if (el.photoId == null) return null
  const look = photoLookOf(el)
  const raster = t('journey.studio.photo.rasterHint')
  return (
    <>
      <Section label={t('journey.studio.photo.edges')} defaultOpen={!!(look.border || look.shadow || look.cutout)} testId="photo-edges">
        <EdgeRow label={t('journey.studio.photo.border')} value={look.border} start={PHOTO_LOOK_STARTS.border}
          onSet={border => set({ border })} t={t} testId="photo-border" />
        <ShadowRow {...props} />
        <EdgeRow label={t('journey.studio.photo.cutout')} value={look.cutout} start={PHOTO_LOOK_STARTS.cutout}
          onSet={cutout => set({ cutout })} t={t} testId="photo-cutout" />
      </Section>
      <Section label={t('journey.studio.photo.adjust')} hint={raster} defaultOpen={!!look.adjust} testId="photo-adjust">
        <AdjustRows {...props} />
      </Section>
      <Section label={t('journey.studio.photo.duotone')} hint={raster} defaultOpen={!!look.duotone} testId="photo-duotone-section">
        <DuotoneRows el={el} set={set} t={t} />
      </Section>
    </>
  )
}
