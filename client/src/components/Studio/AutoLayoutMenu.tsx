import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { EDITORIAL_DESIGNS, type EditorialDesign } from './editorialLayouts'

/**
 * The toolbar's auto-layout menu: the style a whole book is laid out in,
 * re-laying the current spread, picking one of the editorial designs for it
 * by hand, and laying out the whole book.
 *
 * Opens on a click rather than on hover — the old hover-only menu could not
 * be opened at all on a phone or tablet.
 */

export type AutoStyle = 'classic' | 'editorial'

const STYLE_KEY = 'trek.studio.autoStyle'

export function readAutoStyle(): AutoStyle {
  try { return localStorage.getItem(STYLE_KEY) === 'editorial' ? 'editorial' : 'classic' } catch { return 'classic' }
}
function writeAutoStyle(s: AutoStyle) {
  try { localStorage.setItem(STYLE_KEY, s) } catch { /* private window: the choice lasts this session */ }
}

/** A tiny sketch of each design, so the list says what you'll get. Spread is 2×1. */
function DesignSketch({ id }: { id: EditorialDesign }) {
  const ink = 'var(--text-primary)'
  const soft = 'var(--text-faint)'
  const r = (x: number, y: number, w: number, h: number, fill: string, op = 1) => <rect x={x} y={y} width={w} height={h} fill={fill} opacity={op} />
  const lines = (x: number, y: number, n: number) => Array.from({ length: n }, (_, i) => r(x, y + i * 3, 12 - (i === n - 1 ? 4 : 0), 1, soft))
  const parts: Record<EditorialDesign, JSX.Element[]> = {
    place: [r(2, 2, 16, 16, soft, 0.5), r(23, 9, 13, 3, ink), r(23, 14, 9, 1, soft)],
    story: [r(0, 0, 20, 20, soft, 0.5), r(23, 5, 12, 2, ink), ...lines(23, 9, 3)],
    pano: [r(0, 0, 40, 11, soft, 0.5), r(3, 13, 10, 2, ink), ...lines(3, 16, 1), r(23, 13, 4, 5, soft, 0.5), r(28, 13, 4, 5, soft, 0.5), r(33, 13, 4, 5, soft, 0.5)],
    gallery: [r(0, 0, 20, 20, soft, 0.5), r(23, 3, 12, 2, ink), ...lines(23, 7, 2), r(23, 13, 5, 4, soft, 0.5), r(29, 13, 5, 4, soft, 0.5)],
    immersive: [r(0, 0, 40, 20, soft, 0.5), r(0, 12, 40, 8, ink, 0.55), r(3, 14, 10, 2, '#fff')],
    panel: [r(0, 0, 20, 20, soft, 0.5), r(20, 0, 20, 20, ink, 0.85), r(23, 4, 11, 2, '#fff'), r(14, 11, 11, 7, soft)],
    band: [r(0, 0, 2, 20, '#c2410c'), r(2, 0, 18, 12, soft, 0.5), r(23, 3, 14, 10, 'none'), r(23, 15, 6, 4, soft, 0.5), r(30, 15, 6, 4, soft, 0.5)],
  }
  return (
    <svg className="!block !rounded-[2px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !shrink-[0]" width={40} height={20} viewBox="0 0 40 20" aria-hidden>
      {parts[id]}
      {id === 'band' && <rect x={23} y={3} width={14} height={10} fill="none" stroke={soft} strokeWidth={0.5} />}
      <line x1={20} y1={0} x2={20} y2={20} stroke="var(--border-primary)" strokeWidth={0.4} />
    </svg>
  )
}

interface Props {
  t: (key: string, params?: Record<string, string | number>) => string
  style: AutoStyle
  onStyle: (s: AutoStyle) => void
  /** Whether the current spread came from an entry (only those can be re-laid). */
  canSpread: boolean
  building: boolean
  onSpread: () => void
  onDesign: (d: EditorialDesign) => void
  onBook: () => void
}

export function AutoLayoutMenu({ t, style, onStyle, canSpread, building, onSpread, onDesign, onBook }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const item = (enabled: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none',
    background: 'none', fontSize: 12, cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.4, color: 'var(--text-primary)', fontFamily: 'inherit',
  })
  const heading: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', padding: '6px 10px 4px' }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="!flex !items-center !gap-[6px] !p-[7px_12px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Sparkles size={14} /> {t('journey.studio.autoLayout')}
        <ChevronDown size={13} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div className="!absolute !top-[100%] !right-[0] !mt-[4px] !w-[270px] !max-w-[calc(100vw_-_32px)] !max-h-[70vh] !overflow-y-auto !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![box-shadow:0_8px_24px_rgba(0,0,0,0.15)] !p-[4px] !z-[20]" role="menu">
          <div style={heading}>{t('journey.studio.autoStyle')}</div>
          <div className="!flex !gap-[4px] !p-[0_6px_4px]" role="radiogroup" aria-label={t('journey.studio.autoStyle')}>
            {(['classic', 'editorial'] as const).map(s => (
              <button className="!flex-[1] !p-[6px_8px] !rounded-[7px] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-primary)]" key={s} role="radio" aria-checked={style === s} onClick={() => { onStyle(s); writeAutoStyle(s) }} style={{ border: style === s ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)', background: style === s ? 'var(--bg-tertiary)' : 'none' }}>
                {t(`journey.studio.autoStyle.${s}`)}
              </button>
            ))}
          </div>
          <div className="!text-[length:10.5px] ![color:var(--text-faint)] !p-[0_10px_6px] !leading-[1.4]">{t(`journey.studio.autoStyleHint.${style}`)}</div>

          <div className="!h-[1px] ![background:var(--border-secondary)] !m-[4px_2px]" />
          <button role="menuitem" disabled={!canSpread} onClick={() => { onSpread(); setOpen(false) }} style={item(canSpread)}>
            {t('journey.studio.autoLayoutSpread')}
          </button>
          <button role="menuitem" disabled={building} onClick={() => { setOpen(false); onBook() }} style={item(!building)}>
            {building ? t('journey.studio.autoLayoutBookBuilding') : t('journey.studio.autoLayoutBook')}
          </button>

          <div className="!h-[1px] ![background:var(--border-secondary)] !m-[4px_2px]" />
          <div style={heading}>{t('journey.studio.design.title')}</div>
          {!canSpread && <div className="!text-[length:10.5px] ![color:var(--text-faint)] !p-[0_10px_6px]">{t('journey.studio.design.needsEntry')}</div>}
          {EDITORIAL_DESIGNS.map(d => (
            <button key={d} role="menuitem" data-design={d} disabled={!canSpread} onClick={() => { onDesign(d); setOpen(false) }} style={item(canSpread)}>
              <DesignSketch id={d} />
              <span className="!flex !flex-col !min-w-[0]">
                <span>{t(`journey.studio.design.${d}`)}</span>
                <span className="!text-[length:10px] ![color:var(--text-faint)]">{t(`journey.studio.design.${d}.hint`)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
