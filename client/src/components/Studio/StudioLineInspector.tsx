import type { CSSProperties, ReactNode } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { BOOK_LINE_CAPS, BOOK_LINE_ORNAMENTS, type BookLineCap, type BookLineElement, type BookLineOrnament } from '../../types/book'
import { useStudioStore } from '../../store/studioStore'
import { bookLineStyled } from './bookLine'
import { lineGeometry } from './lineRender'
import { LinePaths } from './LineView'
import { ColorSwatches } from './StyleControls'

/**
 * The inspector of a drawn line (5.7.6, port of liketrek/TREK's
 * StudioLineInspector.tsx): its course (straight or smooth, a wave or a
 * zigzag, the hand-drawn wobble), its look (colour, weight, dashes), what sits
 * on each end, and the ornament in its middle.
 *
 * Every change goes through `bookLineStyled`, so a wider stroke or a new head
 * refits the frame and the ends stay where they were drawn; each is one undo step.
 */

type T = (k: string, params?: Record<string, string | number>) => string
type Look = Partial<Omit<BookLineElement, 'id' | 'kind' | 'frame' | 'points'>>
type GlyphLook = Parameters<typeof lineGeometry>[0]

const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }
const FIELD: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }
const SMALL: CSSProperties = { fontSize: 11, color: 'var(--text-muted)' }

/** A tiny level line for the pickers, with what the picker is choosing set on it. */
function MiniLine({ over }: { over: Partial<GlyphLook> }) {
  const el: GlyphLook = {
    points: [{ x: 0.08, y: 0.5 }, { x: 0.92, y: 0.5 }],
    curve: 'straight', strokeWidth: 1.4, dash: 'solid', squiggle: 'none',
    startCap: 'none', endCap: 'none', wobble: 0, ornament: 'none', ...over,
  }
  const g = lineGeometry(el, 28, 12, 'glyph')
  return (
    <svg viewBox="0 0 28 12" width="28" height="12" aria-hidden style={{ overflow: 'visible' }}>
      <LinePaths g={g} color="currentColor" width={el.strokeWidth} />
    </svg>
  )
}

/** A row of small exclusive choices. */
function Choice<V extends string>({ value, options, onPick, label, testId }: {
  value: V
  options: { value: V; label: ReactNode; title?: string }[]
  onPick: (v: V) => void
  label: string
  testId?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title}
          data-value={o.value} onClick={() => onPick(o.value)}
          style={{
            minWidth: 34, height: 28, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
            border: value === o.value ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
            background: value === o.value ? 'var(--bg-tertiary)' : 'var(--bg-card)', color: 'var(--text-primary)',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function LineInspector({ el, spreadIndex, t }: { el: BookLineElement; spreadIndex: number; t: T }) {
  const commit = useStudioStore(s => s.commit)

  const change = (fn: (e: BookLineElement) => BookLineElement) => commit(d => ({
    ...d,
    spreads: d.spreads.map((sp, i) => i !== spreadIndex ? sp : {
      ...sp,
      elements: sp.elements.map(e => (e.kind === 'line' && e.id === el.id && !e.locked ? fn(e) : e)),
    }),
  }))
  const set = (look: Look) => change(e => bookLineStyled(e, look))
  /** The line turned round: its points in the other order and its two ends swapped with them. */
  const swapEnds = () => change(e => ({ ...e, points: [...e.points].reverse(), startCap: e.endCap, endCap: e.startCap }))

  const caps = (start: boolean) => BOOK_LINE_CAPS.map((c: BookLineCap) => ({
    value: c,
    label: <MiniLine over={start ? { startCap: c } : { endCap: c }} />,
    title: t(`journey.studio.line.cap.${c}`),
  }))

  return (
    <div data-testid="line-inspector">
      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.line.course')}</span>
        <Choice value={el.curve} label={t('journey.studio.line.course')} testId="line-curve" onPick={curve => set({ curve })}
          options={(['straight', 'smooth'] as const).map(value => ({ value, label: t(`journey.studio.line.curve.${value}`) }))} />
        <Choice value={el.squiggle} label={t('journey.studio.line.body')} testId="line-squiggle" onPick={squiggle => set({ squiggle })}
          options={(['none', 'wave', 'zigzag'] as const).map(value => ({ value, label: t(`journey.studio.line.squiggle.${value}`) }))} />
        <label style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 8px', alignItems: 'center' }}>
          <span style={SMALL}>{t('journey.studio.line.wobble')}</span>
          <output style={SMALL}>{Math.round(el.wobble * 100)}%</output>
          <input type="range" min={0} max={1} step={0.1} value={el.wobble} data-testid="line-wobble" style={{ gridColumn: '1 / -1' }}
            onChange={e => set({ wobble: Number(e.target.value) })} />
        </label>
        <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: 0 }}>{t('journey.studio.line.pointsHint')}</p>
      </div>

      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.line.look')}</span>
        <ColorSwatches value={el.stroke} onPick={stroke => set({ stroke })} label={t('journey.studio.line.look')} t={t} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={SMALL}>{t('journey.studio.line.width')} (mm)</span>
          <input type="number" min={0.05} max={20} step={0.05} value={el.strokeWidth} data-testid="line-width"
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}
            onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0.05) set({ strokeWidth: Math.min(20, v) }) }} />
        </label>
        <Choice value={el.dash} label={t('journey.studio.line.dash')} testId="line-dash" onPick={dash => set({ dash })}
          options={(['solid', 'dashed', 'dotted'] as const).map(value => ({ value, label: <MiniLine over={{ dash: value }} />, title: t(`journey.studio.line.dashKind.${value}`) }))} />
      </div>

      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.line.ends')}</span>
        <span style={SMALL}>{t('journey.studio.line.start')}</span>
        <Choice value={el.startCap} label={t('journey.studio.line.start')} testId="line-start" options={caps(true)} onPick={startCap => set({ startCap })} />
        <span style={SMALL}>{t('journey.studio.line.end')}</span>
        <Choice value={el.endCap} label={t('journey.studio.line.end')} testId="line-end" options={caps(false)} onPick={endCap => set({ endCap })} />
        <button type="button" onClick={swapEnds} data-testid="line-swap"
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 99, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          <ArrowLeftRight size={13} />
          {t('journey.studio.line.swap')}
        </button>
      </div>

      <div style={FIELD}>
        <span style={LABEL}>{t('journey.studio.line.ornament')}</span>
        <Choice value={el.ornament} label={t('journey.studio.line.ornament')} testId="line-ornament" onPick={(ornament: BookLineOrnament) => set({ ornament })}
          options={BOOK_LINE_ORNAMENTS.map(o => ({ value: o, label: <MiniLine over={{ ornament: o, strokeWidth: 0.7 }} />, title: t(`journey.studio.line.ornamentKind.${o}`) }))} />
      </div>
    </div>
  )
}
