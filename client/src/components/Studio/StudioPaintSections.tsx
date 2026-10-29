import type { CSSProperties } from 'react'
import { BOOK_EDGES, BOOK_EDGE_SIZE, type BookEdge, type BookElement, type BookShapeElement, type BookShapeId } from '../../types/book'
import { shapePaint, spreadPaint, withShapePaint, withSpreadPaintByHand } from './bookPaint'
import { usePaintChannel } from './paint/usePaintChannel'
import { StudioPaintPicker } from './StudioPaintPicker'
import { DEFAULT_EDGE_SIZE, shapeTakesEdge } from './shapeOutline'
import { edgedPath } from './shapesEdges'

/**
 * The inspector's paint and edge sections (5.7.6, port of liketrek/TREK's
 * StudioShapePaint.tsx, StudioBackgroundSection.tsx and StudioEdgeControls.tsx):
 * a shape's fill and a page's background as paint, and the cut edge of a
 * shape or a photo. Every drag is one undo step (usePaintChannel.ts).
 */

type T = (k: string, params?: Record<string, string | number>) => string

const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }
const FIELD: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }

/** The outline a shape is given when its fill goes and it has none, so it never turns invisible. */
const OUTLINE = '#141414'

/** A shape's fill: none, one colour (with its own opacity), a gradient or a pattern. */
export function ShapeFillSection({ el, spreadIndex, t }: { el: BookShapeElement; spreadIndex: number; t: T }) {
  const channel = usePaintChannel(paint => doc => ({
    ...doc,
    spreads: doc.spreads.map((sp, i) => i !== spreadIndex ? sp : {
      ...sp,
      elements: sp.elements.map((e): BookElement => {
        if (e.kind !== 'shape' || e.id !== el.id) return e
        // A paint picked by hand stops the fill following the theme.
        const { token: _unlinked, ...rest } = withShapePaint(e, paint)
        return paint === null && !e.stroke ? { ...rest, stroke: OUTLINE, strokeWidth: e.strokeWidth || 0.5 } : rest
      }),
    }),
  }))
  return (
    <div style={FIELD} data-testid="shape-fill">
      <span style={LABEL}>{t('journey.studio.style.fill')}</span>
      <StudioPaintPicker value={shapePaint(el)} channel={channel} t={t} noneLabel={t('journey.studio.paint.none')} />
    </div>
  )
}

/** A page's background: the paper, one colour, a gradient or a pattern, out into the bleed. */
export function PageBackgroundSection({ spread, spreadIndex, t }: { spread: Parameters<typeof spreadPaint>[0]; spreadIndex: number; t: T }) {
  const channel = usePaintChannel(paint => doc => ({
    ...doc,
    spreads: doc.spreads.map((sp, i) => (i !== spreadIndex ? sp
      // White is the paper itself: stored as no background, as before.
      : withSpreadPaintByHand(sp, paint && paint.type === 'solid' && (paint.alpha ?? 1) >= 1 && paint.color.toLowerCase() === '#ffffff' ? null : paint))),
  }))
  return (
    <div style={FIELD} data-testid="page-background">
      <span style={LABEL}>{t('journey.studio.style.pageBackground')}</span>
      <StudioPaintPicker value={spreadPaint(spread)} channel={channel} t={t} noneLabel={t('journey.studio.paint.paper')} />
    </div>
  )
}

const CARD = 'M0 0L40 0L40 30L0 30Z'

/** One edge, drawn on a little card. Seeded alike, so the torn tile does not change while you look at it. */
function EdgeGlyph({ edge }: { edge: BookEdge }) {
  return (
    <svg viewBox="-2 -2 44 34" width="34" height="26" aria-hidden>
      <path d={edgedPath(CARD, edge, 5, 3)} fill="currentColor" />
    </svg>
  )
}

/**
 * The edge of a shape or of a photo's cut: a row of tiles and how deep it
 * bites. On an outline that takes none (a heart, a star) it stays away,
 * unless an edge is already set there, which it then says does nothing.
 */
export function EdgeSection({ edge, edgeSize, outline, onSet, t }: {
  edge: BookEdge | undefined
  edgeSize: number | undefined
  /** The shape the edge would be cut along; null for a photo's plain rectangle. */
  outline: BookShapeId | null
  onSet: (patch: { edge?: BookEdge; edgeSize?: number }) => void
  t: T
}) {
  const current = edge ?? 'straight'
  const takes = shapeTakesEdge(outline)
  if (!takes && current === 'straight') return null
  return (
    <div style={FIELD} data-testid="edge-section">
      <span style={LABEL}>{t('journey.studio.edge.title')}</span>
      {!takes && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>{t('journey.studio.edge.unavailable')}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {BOOK_EDGES.map(e => (
          <button key={e} type="button" data-testid={`edge-${e}`} aria-pressed={current === e} title={t(`journey.studio.edge.${e}`)}
            aria-label={t(`journey.studio.edge.${e}`)}
            onClick={() => onSet({ edge: e === 'straight' ? undefined : e, ...(e === 'straight' ? { edgeSize: undefined } : {}) })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, borderRadius: 6, cursor: 'pointer',
              border: current === e ? '1.5px solid var(--text-primary)' : '1px solid var(--border-primary)',
              background: current === e ? 'var(--bg-tertiary)' : 'var(--bg-card)', color: 'var(--text-muted)',
            }}>
            <EdgeGlyph edge={e} />
          </button>
        ))}
      </div>
      {takes && current !== 'straight' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('journey.studio.edge.size')} (mm)</span>
          <input type="number" data-testid="edge-size" value={edgeSize ?? DEFAULT_EDGE_SIZE} min={BOOK_EDGE_SIZE.min} max={BOOK_EDGE_SIZE.max} step={0.5}
            style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12 }}
            onChange={e => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) onSet({ edgeSize: Math.min(BOOK_EDGE_SIZE.max, Math.max(BOOK_EDGE_SIZE.min, v)) })
            }} />
        </label>
      )}
    </div>
  )
}
