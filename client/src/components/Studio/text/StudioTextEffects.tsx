import type { CSSProperties, ReactNode } from 'react'
import { AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, CaseLower, CaseSensitive, CaseUpper } from 'lucide-react'
import type { BookElement, BookSpread, BookTextElement } from '../../../types/book'
import ToggleSwitch from '../../Settings/ToggleSwitch'
import { ColorSwatches } from '../StyleControls'
import { StudioPaintPicker } from '../StudioPaintPicker'
import { paintAs } from '../paint/paintEdit'
import type { PaintChannel } from '../paint/usePaintChannel'
import { bandOf, defaultBand, defaultOutline, defaultShadow, firstFillPhoto, isHollow } from './textEffects'
import { bookTextIsDrawn, bookTextPaintFill } from './textMeasure'

/*
 * The text inspector's effects (5.7.10, after liketrek/TREK's
 * StudioTextEffects.tsx): how the letters are cased and where the lines sit,
 * whether the text shrinks to its frame, and the outline, hard shadow, band,
 * curve and fill. Every switch arrives already looking right: an outline in
 * the colour that stands out at a twentieth of the letter height, a shadow a
 * twelfth of it down and across, a band with a quarter em of room.
 */

type T = (k: string, params?: Record<string, string | number>) => string
type Patch = Partial<BookTextElement>

const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }
const SMALL: CSSProperties = { fontSize: 11, color: 'var(--text-muted)' }
const FIELD: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }
const BODY: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0 4px 8px', borderLeft: '2px solid var(--border-secondary)' }
const INPUT: CSSProperties = { width: '100%', padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, boxSizing: 'border-box' }
const HINT: CSSProperties = { fontSize: 10.5, color: 'var(--text-faint)', margin: 0, lineHeight: 1.4 }

function Choice<V extends string>({ value, options, onPick, label, testId }: {
  value: V; options: { value: V; label: ReactNode; title?: string; disabled?: boolean }[]; onPick: (v: V) => void; label: string; testId?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} aria-label={o.title ?? (typeof o.label === 'string' ? o.label : undefined)}
          disabled={o.disabled} data-value={o.value} onClick={() => onPick(o.value)}
          style={{
            minWidth: 30, height: 26, padding: '0 7px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, cursor: o.disabled ? 'default' : 'pointer', fontSize: 11, fontFamily: 'inherit', opacity: o.disabled ? 0.4 : 1,
            border: value === o.value ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
            background: value === o.value ? 'var(--bg-tertiary)' : 'var(--bg-card)', color: 'var(--text-primary)',
          }}>{o.label}</button>
      ))}
    </div>
  )
}

function Num({ label, value, min, max, step, unit, onChange, testId }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; testId?: string
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      <span style={SMALL}>{label}{unit ? ` (${unit})` : ''}</span>
      <input type="number" min={min} max={max} step={step} value={Math.round(value * 100) / 100} data-testid={testId} style={INPUT}
        onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))) }} />
    </label>
  )
}

function Toggle({ label, on, onToggle, testId }: { label: string; on: boolean; onToggle: () => void; testId?: string }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ ...SMALL, color: 'var(--text-primary)' }}>{label}</span>
      <ToggleSwitch on={on} onToggle={onToggle} />
    </div>
  )
}

type FillKind = 'colour' | 'hollow' | 'photo' | 'gradient' | 'pattern'

function fillKindOf(el: BookTextElement): FillKind {
  const type = el.fillPaint?.type
  if (type === 'photo') return 'photo'
  if (type === 'linear' || type === 'radial') return 'gradient'
  if (type === 'pattern') return 'pattern'
  return isHollow(el) ? 'hollow' : 'colour'
}

export function StudioTextEffects({ el, set, live, photos, spread, t }: {
  el: BookTextElement
  /** One undo step. */
  set: (patch: Partial<BookElement>) => void
  /** A change inside a drag. */
  live: (patch: Partial<BookElement>) => void
  photos: readonly { photoId: number }[]
  spread: BookSpread | undefined
  t: T
}) {
  const put = (p: Patch) => set(p as Partial<BookElement>)
  const transform = el.transform && el.transform !== 'none' ? el.transform : el.uppercase ? 'upper' : 'none'
  const { outline, shadow, curve } = el
  const band = bandOf(el)
  const kind = fillKindOf(el)
  const photo = el.fillPaint?.type === 'photo' ? el.fillPaint : null
  const letterPaint = bookTextPaintFill(el)
  const channel: PaintChannel = { live: paint => live({ fillPaint: paint } as Patch as Partial<BookElement>), commit: paint => put({ fillPaint: paint }) }

  const pickFill = (next: FillKind) => {
    if (next === 'colour') return put({ fillPaint: null })
    if (next === 'hollow') return put({ fillPaint: { type: 'solid', color: el.color, alpha: 0 }, outline: el.outline ?? { ...defaultOutline(el), color: el.color } })
    if (next === 'gradient' || next === 'pattern') return put({ fillPaint: paintAs(next, { type: 'solid', color: el.color }) })
    const photoId = firstFillPhoto(spread, photos)
    if (photoId != null) put({ fillPaint: { type: 'photo', photoId, focalX: 0.5, focalY: 0.5, zoom: 1 } })
  }

  return (
    <div data-testid="text-effects">
      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.fx.placement')}</span>
        <span style={SMALL}>{t('journey.studio.fx.case')}</span>
        <Choice value={transform} label={t('journey.studio.fx.case')} testId="fx-case" onPick={v => put({ transform: v, uppercase: false })}
          options={[
            { value: 'none', label: <CaseSensitive size={15} />, title: t('journey.studio.fx.caseNone') },
            { value: 'upper', label: <CaseUpper size={15} />, title: t('journey.studio.fx.caseUpper') },
            { value: 'lower', label: <CaseLower size={15} />, title: t('journey.studio.fx.caseLower') },
            { value: 'smallcaps', label: t('journey.studio.fx.caseSmall'), title: t('journey.studio.fx.caseSmall') },
          ]} />
        <span style={SMALL}>{t('journey.studio.fx.vertical')}</span>
        <Choice value={el.vAlign ?? 'top'} label={t('journey.studio.fx.vertical')} testId="fx-valign" onPick={vAlign => put({ vAlign })}
          options={[
            { value: 'top', label: <AlignVerticalJustifyStart size={15} />, title: t('journey.studio.fx.top') },
            { value: 'middle', label: <AlignVerticalJustifyCenter size={15} />, title: t('journey.studio.fx.middle') },
            { value: 'bottom', label: <AlignVerticalJustifyEnd size={15} />, title: t('journey.studio.fx.bottom') },
          ]} />
        <Toggle label={t('journey.studio.fx.fit')} on={el.fit === 'shrink'} testId="fx-fit"
          onToggle={() => put(el.fit === 'shrink' ? { fit: 'none', size: el.fitMax ?? el.size } : { fit: 'shrink' })} />
        {el.fit === 'shrink' && <p style={HINT}>{t('journey.studio.fx.fitHint')}</p>}
      </div>

      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.fx.effects')}</span>

        <Toggle label={t('journey.studio.fx.outline')} on={!!outline} testId="fx-outline"
          onToggle={() => put({ outline: outline ? null : defaultOutline(el), ...(outline && isHollow(el) ? { fillPaint: null } : {}) })} />
        {outline && (
          <div style={BODY}>
            <Num label={t('journey.studio.fx.width')} unit="mm" value={outline.width} min={0.05} max={6} step={0.05} onChange={width => put({ outline: { ...outline, width } })} />
            <ColorSwatches value={outline.color} onPick={color => put({ outline: { ...outline, color } })} label={t('journey.studio.fx.outline')} t={t} />
          </div>
        )}

        <Toggle label={t('journey.studio.fx.shadow')} on={!!shadow} testId="fx-shadow" onToggle={() => put({ shadow: shadow ? null : defaultShadow(el) })} />
        {shadow && (
          <div style={BODY}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Num label={t('journey.studio.fx.across')} unit="mm" value={shadow.dx} min={-30} max={30} step={0.1} onChange={dx => put({ shadow: { ...shadow, dx } })} />
              <Num label={t('journey.studio.fx.down')} unit="mm" value={shadow.dy} min={-30} max={30} step={0.1} onChange={dy => put({ shadow: { ...shadow, dy } })} />
            </div>
            <Num label={t('journey.studio.fx.opacity')} unit="%" value={Math.round(shadow.alpha * 100)} min={0} max={100} step={5} onChange={v => put({ shadow: { ...shadow, alpha: v / 100 } })} />
            <ColorSwatches value={shadow.color} onPick={color => put({ shadow: { ...shadow, color } })} label={t('journey.studio.fx.shadow')} t={t} />
          </div>
        )}

        {bookTextIsDrawn(el) ? <p style={HINT}>{t('journey.studio.fx.bandDrawn')}</p> : (
          <>
            <Toggle label={t('journey.studio.fx.band')} on={!!band} testId="fx-band"
              onToggle={() => put(band ? { highlight: null } : { highlight: defaultBand(el), ...(el.effect === 'highlight' ? { effect: 'none' } : {}) })} />
            {band && (
              <div style={BODY}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Num label={t('journey.studio.fx.padAcross')} unit="mm" value={band.padX} min={0} max={20} step={0.1} onChange={padX => put({ highlight: { ...band, padX } })} />
                  <Num label={t('journey.studio.fx.padDown')} unit="mm" value={band.padY} min={0} max={20} step={0.1} onChange={padY => put({ highlight: { ...band, padY } })} />
                </div>
                <Num label={t('journey.studio.fx.radius')} unit="mm" value={band.radius} min={0} max={20} step={0.1} onChange={radius => put({ highlight: { ...band, radius } })} />
                <ColorSwatches value={band.color} onPick={color => put({ highlight: { ...band, color } })} label={t('journey.studio.fx.band')} t={t} />
              </div>
            )}
          </>
        )}

        <span style={SMALL}>{t('journey.studio.fx.curve')}</span>
        <Choice value={curve?.type ?? 'none'} label={t('journey.studio.fx.curve')} testId="fx-curve"
          onPick={type => put({ curve: type === 'none' ? null : { type, bend: curve?.bend ?? 40, start: curve?.start ?? 0 } })}
          options={[
            { value: 'none', label: t('journey.studio.fx.straight') },
            { value: 'arc', label: t('journey.studio.fx.arc') },
            { value: 'circle', label: t('journey.studio.fx.circle') },
          ]} />
        {curve?.type === 'arc' && <Num label={t('journey.studio.fx.bend')} value={curve.bend} min={-100} max={100} step={5} testId="fx-bend" onChange={bend => put({ curve: { ...curve, bend } })} />}
        {curve?.type === 'circle' && <Num label={t('journey.studio.fx.start')} unit="°" value={curve.start} min={-180} max={180} step={5} onChange={start => put({ curve: { ...curve, start } })} />}

        <span style={SMALL}>{t('journey.studio.fx.letters')}</span>
        <Choice value={kind} label={t('journey.studio.fx.letters')} testId="fx-fill" onPick={pickFill}
          options={[
            { value: 'colour', label: t('journey.studio.fx.colour') },
            { value: 'hollow', label: t('journey.studio.fx.hollow') },
            { value: 'photo', label: t('journey.studio.fx.photo'), disabled: !photos.length },
            { value: 'gradient', label: t('journey.studio.fx.gradient') },
            { value: 'pattern', label: t('journey.studio.fx.pattern') },
          ]} />
        {letterPaint && (kind === 'gradient' || kind === 'pattern') && (
          <StudioPaintPicker value={letterPaint} channel={channel} t={t} noneLabel={t('journey.studio.fx.colour')} kinds={[kind]} />
        )}
        {photo && (
          <div style={BODY}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Num label={t('journey.studio.fx.focusX')} unit="%" value={Math.round(photo.focalX * 100)} min={0} max={100} step={5} onChange={v => put({ fillPaint: { ...photo, focalX: v / 100 } })} />
              <Num label={t('journey.studio.fx.focusY')} unit="%" value={Math.round(photo.focalY * 100)} min={0} max={100} step={5} onChange={v => put({ fillPaint: { ...photo, focalY: v / 100 } })} />
            </div>
            <Num label={t('journey.studio.fx.zoom')} unit="%" value={Math.round(photo.zoom * 100)} min={100} max={400} step={10} onChange={v => put({ fillPaint: { ...photo, zoom: v / 100 } })} />
          </div>
        )}
        {bookTextIsDrawn(el) && <p style={HINT}>{t('journey.studio.fx.drawnHint')}</p>}
      </div>
    </div>
  )
}
