import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import type { BookFontFamily, BookPhotoElement, BookTextElement } from '../../types/book'
import { BOOK_FONT_GROUPS, BOOK_FONTS, fontStack } from './bookFonts'
import { BookPhotoImg } from './BookPhotoImg'
import { PALETTES, PHOTO_FILTERS, PHOTO_FRAME_ORDER, TEXT_PRESETS, frameSpec, type TextEffect } from './bookStyles'

/**
 * The inspector's style pickers. Each shows what it does — a filter on the
 * photo itself, a frame on a small sample, a font in its own face — instead
 * of a dropdown of internal ids ("bw", "warm") that meant nothing to anyone.
 */

type T = (key: string, params?: Record<string, string | number>) => string

const tile = (on: boolean): CSSProperties => ({
  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 3,
  padding: 3, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', background: 'none',
  border: on ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
})
const caption: CSSProperties = { fontSize: 9.5, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const tick = <span className="!absolute !top-[4px] !right-[4px] !w-[14px] !h-[14px] !rounded-[7px] ![background:var(--text-primary)] ![color:var(--bg-primary)] !flex !items-center !justify-center"><Check size={9} strokeWidth={3} /></span>

/** A stand-in landscape for previews when the frame has no photo yet. */
const SAMPLE_BG = 'linear-gradient(180deg, #8ec5e8 0%, #cfe6f3 45%, #e9d7a8 46%, #c9a36a 70%, #6e8b4e 71%, #45663a 100%)'

export function FilterPicker({ el, onPick, t }: { el: BookPhotoElement; onPick: (f: BookPhotoElement['filter']) => void; t: T }) {
  return (
    <div className="!grid ![grid-template-columns:repeat(4,_1fr)] !gap-[5px]" role="radiogroup" aria-label={t('journey.studio.style.filter')}>
      {PHOTO_FILTERS.map(f => {
        const on = el.filter === f.id
        return (
          <button key={f.id} role="radio" aria-checked={on} aria-label={t(`journey.studio.filter.${f.id}`)} title={t(`journey.studio.filter.${f.id}`)} onClick={() => onPick(f.id)} style={tile(on)}>
            <div className="![aspect-ratio:1] !rounded-[5px] !overflow-hidden" style={{ background: SAMPLE_BG }}>
              {el.photoId != null
                ? <BookPhotoImg photoId={el.photoId} big={false} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: f.css, display: 'block' }} />
                : <div className="!w-[100%] !h-[100%]" style={{ filter: f.css, background: SAMPLE_BG }} />}
            </div>
            <span style={caption}>{t(`journey.studio.filter.${f.id}`)}</span>
            {on && tick}
          </button>
        )
      })}
    </div>
  )
}

export function FramePicker({ value, onPick, t }: { value: BookPhotoElement['frameStyle']; onPick: (f: BookPhotoElement['frameStyle']) => void; t: T }) {
  // Each tile is a 16mm sample photo drawn with the real frame spec, scaled down.
  const side = 16
  return (
    <div className="!grid ![grid-template-columns:repeat(4,_1fr)] !gap-[5px]" role="radiogroup" aria-label={t('journey.studio.style.frame')}>
      {PHOTO_FRAME_ORDER.map(id => {
        const spec = frameSpec(id)
        const on = value === id
        const pad = spec.pad * side
        const bottom = spec.bottom * side
        return (
          <button key={id} role="radio" aria-checked={on} aria-label={t(`journey.studio.frame.${id}`)} title={t(`journey.studio.frame.${id}`)} onClick={() => onPick(id)} style={tile(on)}>
            <div className="![aspect-ratio:1] !rounded-[5px] ![background:var(--bg-tertiary)] !flex !items-center !justify-center !overflow-hidden">
              <div style={{ position: 'relative', width: `${side}mm`, height: `${side}mm`, transform: 'scale(0.62)', ...spec.outer?.(side) }}>
                <div style={{ position: 'absolute', left: `${pad}mm`, top: `${pad}mm`, right: `${pad}mm`, bottom: `${bottom || pad}mm`, background: SAMPLE_BG, ...spec.inner?.(side) }} />
                {spec.overlay === 'tape' && <div className="!absolute !top-[-0.6mm] !left-[-0.8mm] !w-[5mm] !h-[1.4mm] ![background:rgba(250,240,200,.85)]" style={{ transform: 'rotate(-38deg)' }} />}
                {spec.overlay === 'vignette' && <div className="!absolute !inset-[0] ![background:radial-gradient(ellipse_at_center,_rgba(0,0,0,0)_50%,_rgba(0,0,0,.55)_100%)]" />}
                {spec.overlay === 'corners' && <div className="!absolute !left-[0] !top-[0] !w-[0] !h-[0] ![border-top:2.2mm_solid_#1f1f1f] ![border-right:2.2mm_solid_transparent]" />}
              </div>
            </div>
            <span style={caption}>{t(`journey.studio.frame.${id}`)}</span>
            {on && tick}
          </button>
        )
      })}
    </div>
  )
}

export function FontPicker({ value, onPick, t }: { value: BookFontFamily; onPick: (f: BookFontFamily) => void; t: T }) {
  return (
    <div className="!flex !flex-col !gap-[8px] !max-h-[220px] !overflow-y-auto !pr-[2px]" role="radiogroup" aria-label={t('journey.studio.style.font')}>
      {BOOK_FONT_GROUPS.map(g => (
        <div key={g.id}>
          <div className="!text-[length:9px] !font-[700] !tracking-[0.08em] !uppercase ![color:var(--text-faint)] !mb-[3px]">{t(`journey.studio.fontGroup.${g.id}`)}</div>
          <div className="!flex !flex-col !gap-[2px]">
            {g.fonts.map(f => {
              const on = value === f
              return (
                <button className="!flex !items-center !justify-between !gap-[6px] !p-[5px_8px] !rounded-[6px] !cursor-pointer !text-left ![color:var(--text-primary)]" key={f} role="radio" aria-checked={on} onClick={() => onPick(f)} style={{ border: on ? '1.5px solid var(--text-primary)' : '1px solid transparent', background: on ? 'var(--bg-tertiary)' : 'none' }}>
                  <span className="!leading-[1.2]" style={{ fontFamily: fontStack(f), fontSize: 15 }}>{BOOK_FONTS[f].name}</span>
                  {on && <Check size={12} />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TextPresets({ onApply, t }: { onApply: (patch: Partial<BookTextElement>) => void; t: T }) {
  return (
    <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[5px]">
      {TEXT_PRESETS.map(p => (
        <button className={['!p-[6px_8px] !rounded-[7px] ![border:1px_solid_var(--border-primary)] ![background:none] !cursor-pointer ![color:var(--text-primary)] !overflow-hidden !whitespace-nowrap', (p.patch.uppercase) ? '!uppercase' : '', '!text-left !text-ellipsis'].join(' ')} key={p.id} onClick={() => onApply(p.patch)} title={t(`journey.studio.preset.${p.id}`)} style={{ fontFamily: fontStack(p.patch.font || 'sans'), fontWeight: p.patch.weight, fontStyle: p.patch.italic ? 'italic' : undefined, letterSpacing: p.patch.tracking ? `${p.patch.tracking}em` : undefined, fontSize: Math.min(15, Math.max(10, (p.patch.size || 11) * 0.6)) }}>
          {t(`journey.studio.preset.${p.id}`)}
        </button>
      ))}
    </div>
  )
}

export function EffectPicker({ value, onPick, t }: { value: TextEffect; onPick: (e: TextEffect) => void; t: T }) {
  return (
    <div className="!grid ![grid-template-columns:repeat(4,_1fr)] !gap-[4px]" role="radiogroup" aria-label={t('journey.studio.style.effect')}>
      {(['none', 'shadow', 'outline', 'highlight'] as const).map(e => {
        const on = value === e
        const sample: CSSProperties = e === 'shadow' ? { textShadow: '0 1px 3px rgba(0,0,0,.5)' }
          : e === 'outline' ? { WebkitTextStroke: '0.6px #111', color: '#fff' } as CSSProperties
          : e === 'highlight' ? { backgroundImage: 'linear-gradient(transparent 52%, #fde68a 52%, #fde68a 92%, transparent 92%)' } : {}
        return (
          <button className="!items-center !p-[5px_2px]" key={e} role="radio" aria-checked={on} aria-label={t(`journey.studio.effect.${e}`)} title={t(`journey.studio.effect.${e}`)} onClick={() => onPick(e)} style={{ ...tile(on) }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', fontFamily: fontStack('serif'), ...sample }}>Aa</span>
            <span style={caption}>{t(`journey.studio.effect.${e}`)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Palette swatches plus a free colour input. */
export function ColorSwatches({ value, onPick, label, t }: { value: string | null; onPick: (c: string) => void; label: string; t: T }) {
  const current = (value || '').toLowerCase()
  return (
    <div className="!flex !flex-col !gap-[4px]">
      {PALETTES.map(p => (
        <div className="!flex !items-center !gap-[4px]" key={p.id} title={t(`journey.studio.palette.${p.id}`)}>
          {p.colors.map(c => (
            <button className="!w-[22px] !h-[22px] !rounded-[5px] !cursor-pointer !p-[0]" key={c} onClick={() => onPick(c)} aria-label={`${label} ${c}`} aria-pressed={current === c} style={{ background: c, border: current === c ? '2px solid var(--text-primary)' : '1px solid var(--border-primary)', boxShadow: current === c ? '0 0 0 1.5px var(--bg-card) inset' : undefined }} />
          ))}
        </div>
      ))}
      <label className="!flex !items-center !gap-[6px] !text-[length:11px] ![color:var(--text-muted)] !mt-[2px]">
        <input className="!w-[28px] !h-[22px] !p-[0] ![border:1px_solid_var(--border-primary)] !rounded-[5px] ![background:none] !cursor-pointer" type="color" value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#000000'} onChange={e => onPick(e.target.value)} aria-label={label} />
        {t('journey.studio.style.customColor')}
      </label>
    </div>
  )
}
