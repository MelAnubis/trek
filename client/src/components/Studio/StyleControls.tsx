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
const tick = <span style={{ position: 'absolute', top: 4, right: 4, width: 14, height: 14, borderRadius: 7, background: 'var(--text-primary)', color: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={9} strokeWidth={3} /></span>

/** A stand-in landscape for previews when the frame has no photo yet. */
const SAMPLE_BG = 'linear-gradient(180deg, #8ec5e8 0%, #cfe6f3 45%, #e9d7a8 46%, #c9a36a 70%, #6e8b4e 71%, #45663a 100%)'

export function FilterPicker({ el, onPick, t }: { el: BookPhotoElement; onPick: (f: BookPhotoElement['filter']) => void; t: T }) {
  return (
    <div role="radiogroup" aria-label={t('journey.studio.style.filter')} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
      {PHOTO_FILTERS.map(f => {
        const on = el.filter === f.id
        return (
          <button key={f.id} role="radio" aria-checked={on} aria-label={t(`journey.studio.filter.${f.id}`)} title={t(`journey.studio.filter.${f.id}`)} onClick={() => onPick(f.id)} style={tile(on)}>
            <div style={{ aspectRatio: '1', borderRadius: 5, overflow: 'hidden', background: SAMPLE_BG }}>
              {el.photoId != null
                ? <BookPhotoImg photoId={el.photoId} big={false} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: f.css, display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', filter: f.css, background: SAMPLE_BG }} />}
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
    <div role="radiogroup" aria-label={t('journey.studio.style.frame')} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
      {PHOTO_FRAME_ORDER.map(id => {
        const spec = frameSpec(id)
        const on = value === id
        const pad = spec.pad * side
        const bottom = spec.bottom * side
        return (
          <button key={id} role="radio" aria-checked={on} aria-label={t(`journey.studio.frame.${id}`)} title={t(`journey.studio.frame.${id}`)} onClick={() => onPick(id)} style={tile(on)}>
            <div style={{ aspectRatio: '1', borderRadius: 5, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <div style={{ position: 'relative', width: `${side}mm`, height: `${side}mm`, transform: 'scale(0.62)', ...spec.outer?.(side) }}>
                <div style={{ position: 'absolute', left: `${pad}mm`, top: `${pad}mm`, right: `${pad}mm`, bottom: `${bottom || pad}mm`, background: SAMPLE_BG, ...spec.inner?.(side) }} />
                {spec.overlay === 'tape' && <div style={{ position: 'absolute', top: '-0.6mm', left: '-0.8mm', width: '5mm', height: '1.4mm', background: 'rgba(250,240,200,.85)', transform: 'rotate(-38deg)' }} />}
                {spec.overlay === 'vignette' && <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,.55) 100%)' }} />}
                {spec.overlay === 'corners' && <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, borderTop: '2.2mm solid #1f1f1f', borderRight: '2.2mm solid transparent' }} />}
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
    <div role="radiogroup" aria-label={t('journey.studio.style.font')} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', paddingRight: 2 }}>
      {BOOK_FONT_GROUPS.map(g => (
        <div key={g.id}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 3 }}>{t(`journey.studio.fontGroup.${g.id}`)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {g.fonts.map(f => {
              const on = value === f
              return (
                <button key={f} role="radio" aria-checked={on} onClick={() => onPick(f)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                  border: on ? '1.5px solid var(--text-primary)' : '1px solid transparent', background: on ? 'var(--bg-tertiary)' : 'none', color: 'var(--text-primary)',
                }}>
                  <span style={{ fontFamily: fontStack(f), fontSize: 15, lineHeight: 1.2 }}>{BOOK_FONTS[f].name}</span>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
      {TEXT_PRESETS.map(p => (
        <button key={p.id} onClick={() => onApply(p.patch)} title={t(`journey.studio.preset.${p.id}`)} style={{
          padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border-primary)', background: 'none', cursor: 'pointer',
          color: 'var(--text-primary)', textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          fontFamily: fontStack(p.patch.font || 'sans'), fontWeight: p.patch.weight, fontStyle: p.patch.italic ? 'italic' : undefined,
          textTransform: p.patch.uppercase ? 'uppercase' : undefined, letterSpacing: p.patch.tracking ? `${p.patch.tracking}em` : undefined,
          fontSize: Math.min(15, Math.max(10, (p.patch.size || 11) * 0.6)),
        }}>
          {t(`journey.studio.preset.${p.id}`)}
        </button>
      ))}
    </div>
  )
}

export function EffectPicker({ value, onPick, t }: { value: TextEffect; onPick: (e: TextEffect) => void; t: T }) {
  return (
    <div role="radiogroup" aria-label={t('journey.studio.style.effect')} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
      {(['none', 'shadow', 'outline', 'highlight'] as const).map(e => {
        const on = value === e
        const sample: CSSProperties = e === 'shadow' ? { textShadow: '0 1px 3px rgba(0,0,0,.5)' }
          : e === 'outline' ? { WebkitTextStroke: '0.6px #111', color: '#fff' } as CSSProperties
          : e === 'highlight' ? { backgroundImage: 'linear-gradient(transparent 52%, #fde68a 52%, #fde68a 92%, transparent 92%)' } : {}
        return (
          <button key={e} role="radio" aria-checked={on} aria-label={t(`journey.studio.effect.${e}`)} title={t(`journey.studio.effect.${e}`)} onClick={() => onPick(e)} style={{ ...tile(on), alignItems: 'center', padding: '5px 2px' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {PALETTES.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={t(`journey.studio.palette.${p.id}`)}>
          {p.colors.map(c => (
            <button key={c} onClick={() => onPick(c)} aria-label={`${label} ${c}`} aria-pressed={current === c} style={{
              width: 22, height: 22, borderRadius: 5, background: c, cursor: 'pointer', padding: 0,
              border: current === c ? '2px solid var(--text-primary)' : '1px solid var(--border-primary)',
              boxShadow: current === c ? '0 0 0 1.5px var(--bg-card) inset' : undefined,
            }} />
          ))}
        </div>
      ))}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(current) ? current : '#000000'} onChange={e => onPick(e.target.value)} aria-label={label}
          style={{ width: 28, height: 22, padding: 0, border: '1px solid var(--border-primary)', borderRadius: 5, background: 'none', cursor: 'pointer' }} />
        {t('journey.studio.style.customColor')}
      </label>
    </div>
  )
}
