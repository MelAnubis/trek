import React, { useMemo, useRef, useState } from 'react'
import type { SketchStroke } from '../../blog/types'
import { SKETCH_WIDTH, outlineOf, pathOf, strokeOpacity, hits, thin, compact, type SketchTool } from './sketch'

type Background = 'paper' | 'grid' | 'lines' | 'transparent'

const BG_FILL: Record<Background, string> = { paper: '#fffdf8', grid: '#fffdf8', lines: '#fffdf8', transparent: 'transparent' }

function BackgroundPattern({ bg, h, id }: { bg: Background; h: number; id: string }) {
  if (bg === 'grid') {
    return (
      <>
        <defs>
          <pattern id={id} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#c7d2fe" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={SKETCH_WIDTH} height={h} fill={`url(#${id})`} />
      </>
    )
  }
  if (bg === 'lines') {
    return (
      <>
        <defs>
          <pattern id={id} width={SKETCH_WIDTH} height="48" patternUnits="userSpaceOnUse">
            <path d={`M0 47H${SKETCH_WIDTH}`} stroke="#bfdbfe" strokeWidth="1.2" />
          </pattern>
        </defs>
        <rect width={SKETCH_WIDTH} height={h} fill={`url(#${id})`} />
      </>
    )
  }
  return null
}

const StrokePath = React.memo(function StrokePath({ s, last = true }: { s: SketchStroke; last?: boolean }) {
  const d = useMemo(() => pathOf(outlineOf(s, { last })), [s, last])
  return <path d={d} fill={s.c} fillOpacity={strokeOpacity(s)} style={s.tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined} />
})

/** Dibujo de solo lectura (post, vista previa, blog público). */
export function SketchView({ strokes, aspect, background, className, label }: {
  strokes: SketchStroke[]; aspect: number; background: Background; className?: string; label?: string
}) {
  const h = Math.round(SKETCH_WIDTH * aspect)
  const pid = useMemo(() => `sk-${Math.random().toString(36).slice(2, 8)}`, [])
  return (
    <svg viewBox={`0 0 ${SKETCH_WIDTH} ${h}`} className={className} role="img" aria-label={label} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect width={SKETCH_WIDTH} height={h} fill={BG_FILL[background]} />
      <BackgroundPattern bg={background} h={h} id={pid} />
      {strokes.map((s, i) => <StrokePath key={i} s={s} />)}
    </svg>
  )
}

export interface SketchCanvasProps {
  strokes: SketchStroke[]
  aspect: number
  background: Background
  tool: SketchTool
  color: string
  size: number
  /** Solo el lápiz dibuja (el dedo y la palma no): se activa sola al detectar un Pencil. */
  penOnly: boolean
  onPenDetected: () => void
  onChange: (strokes: SketchStroke[]) => void
}

/**
 * Lienzo de dibujo con eventos de puntero: ratón, dedo o lápiz (Apple
 * Pencil, S Pen…), con la presión real del lápiz y los puntos intermedios
 * que da `getCoalescedEvents` para que el trazo rápido no salga a tramos.
 */
export function SketchCanvas({ strokes, aspect, background, tool, color, size, penOnly, onPenDetected, onChange }: SketchCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [live, setLive] = useState<SketchStroke | null>(null)
  const drawing = useRef<{ pointerId: number; stroke: SketchStroke | null; erased: boolean } | null>(null)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const h = Math.round(SKETCH_WIDTH * aspect)
  const pid = useMemo(() => `skc-${Math.random().toString(36).slice(2, 8)}`, [])

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * SKETCH_WIDTH, ((e.clientY - r.top) / r.height) * h] as const
  }
  const pressureOf = (e: React.PointerEvent | PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5)

  const eraseAt = (x: number, y: number) => {
    const keep = strokesRef.current.filter(s => !hits(s, x, y, 14))
    if (keep.length !== strokesRef.current.length) {
      strokesRef.current = keep
      onChange(keep)
    }
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'pen') onPenDetected()
    if (penOnly && e.pointerType === 'touch') return       // palma o dedo con el Pencil en uso
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (drawing.current) return
    e.preventDefault()
    svgRef.current?.setPointerCapture(e.pointerId)
    const [x, y] = toLocal(e)
    // El botón lateral / goma del lápiz borra.
    const erasing = tool === 'eraser' || e.button === 5 || (e.buttons & 32) === 32
    if (erasing) {
      drawing.current = { pointerId: e.pointerId, stroke: null, erased: true }
      eraseAt(x, y)
      return
    }
    const stroke: SketchStroke = { c: color, w: size, tool: tool as SketchStroke['tool'], p: [x, y, pressureOf(e)] }
    drawing.current = { pointerId: e.pointerId, stroke, erased: false }
    setLive(stroke)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    e.preventDefault()
    const native = e.nativeEvent as PointerEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native]
    const list = events.length ? events : [native]
    if (!d.stroke) {
      for (const ev of list) { const [x, y] = toLocal(ev); eraseAt(x, y) }
      return
    }
    const p = d.stroke.p.slice()
    for (const ev of list) { const [x, y] = toLocal(ev); p.push(x, y, pressureOf(ev)) }
    d.stroke = { ...d.stroke, p }
    setLive(d.stroke)
  }

  const finish = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    drawing.current = null
    setLive(null)
    if (d.stroke) {
      const s = { ...d.stroke, p: compact(thin(d.stroke.p)) }
      // Un toque sin moverse deja un punto.
      if (s.p.length === 3) s.p = [...s.p, s.p[0] + 0.5, s.p[1] + 0.5, s.p[2]]
      onChange([...strokesRef.current, s])
    }
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SKETCH_WIDTH} ${h}`}
      data-testid="sketch-canvas"
      style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair', userSelect: 'none', WebkitUserSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={e => e.preventDefault()}
    >
      <rect width={SKETCH_WIDTH} height={h} fill={BG_FILL[background] === 'transparent' ? '#ffffff' : BG_FILL[background]} />
      <BackgroundPattern bg={background} h={h} id={pid} />
      {strokes.map((s, i) => <StrokePath key={i} s={s} />)}
      {live && <StrokePath s={live} last={false} />}
    </svg>
  )
}
