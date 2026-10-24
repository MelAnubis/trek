/**
 * Dibujo a mano — geometría pura (sin React), compartida por el lienzo de
 * edición y la vista de lectura.
 *
 * Un trazo guarda sus puntos en unidades de 1/1000 del ancho del dibujo (así
 * se ve igual a cualquier tamaño) y la presión del lápiz. El contorno con
 * grosor variable lo calcula perfect-freehand al pintar: no se guarda.
 */
import { getStroke } from 'perfect-freehand'
import type { SketchStroke } from '../../blog/types'

export const SKETCH_WIDTH = 1000

export const SKETCH_COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#ffffff']
export const SKETCH_SIZES = { pen: [2, 4, 7], marker: [8, 14, 22], highlighter: [18, 28, 40] } as const

export type SketchTool = SketchStroke['tool'] | 'eraser'

/** Los puntos de un trazo como [x, y, presión][]. */
export function pointsOf(s: SketchStroke): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i + 1 < s.p.length; i += 3) out.push([s.p[i], s.p[i + 1], s.p[i + 2] ?? 0.5])
  return out
}

/**
 * Contorno del trazo. `realPressure`: el lápiz da presión de verdad; con dedo
 * o ratón se simula a partir de la velocidad, que queda más natural.
 */
export function outlineOf(s: SketchStroke, opts: { last?: boolean; realPressure?: boolean } = {}): number[][] {
  const pts = pointsOf(s)
  if (!pts.length) return []
  const real = opts.realPressure ?? pts.some(p => p[2] !== 0.5 && p[2] > 0)
  const base = { size: s.w, last: opts.last ?? true, smoothing: 0.5, streamline: 0.45 }
  if (s.tool === 'pen') return getStroke(pts, { ...base, thinning: real ? 0.65 : 0.5, simulatePressure: !real })
  // Rotulador y subrayador: grosor constante.
  return getStroke(pts, { ...base, thinning: 0, simulatePressure: false, start: { cap: true }, end: { cap: true } })
}

const avg = (a: number, b: number) => (a + b) / 2

/** Contorno → path SVG (curvas cuadráticas por los puntos medios). */
export function pathOf(outline: number[][]): string {
  const n = outline.length
  if (n < 2) return ''
  if (n < 4) return `M${outline.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}Z`
  let d = `M${outline[0][0].toFixed(1)},${outline[0][1].toFixed(1)} Q${outline[1][0].toFixed(1)},${outline[1][1].toFixed(1)} ${avg(outline[1][0], outline[2][0]).toFixed(1)},${avg(outline[1][1], outline[2][1]).toFixed(1)} T`
  for (let i = 2; i < n - 1; i++) d += `${avg(outline[i][0], outline[i + 1][0]).toFixed(1)},${avg(outline[i][1], outline[i + 1][1]).toFixed(1)} `
  return `${d}Z`
}

export function strokeOpacity(s: SketchStroke): number {
  return s.tool === 'highlighter' ? 0.35 : 1
}

/** ¿Pasa el borrador (círculo en x, y de radio r) por este trazo? */
export function hits(s: SketchStroke, x: number, y: number, r: number): boolean {
  const rr = (r + s.w / 2) ** 2
  for (let i = 0; i + 1 < s.p.length; i += 3) {
    const dx = s.p[i] - x, dy = s.p[i + 1] - y
    if (dx * dx + dy * dy <= rr) return true
  }
  return false
}

/**
 * Menos puntos sin cambiar la forma: descarta los que están a menos de
 * `minDist` del anterior (un trazo con Pencil a 240 Hz genera muchísimos).
 */
export function thin(p: number[], minDist = 1.2): number[] {
  if (p.length <= 6) return p
  const out = [p[0], p[1], p[2]]
  for (let i = 3; i + 2 < p.length; i += 3) {
    const lx = out[out.length - 3], ly = out[out.length - 2]
    const dx = p[i] - lx, dy = p[i + 1] - ly
    if (dx * dx + dy * dy >= minDist * minDist || i + 3 >= p.length) out.push(p[i], p[i + 1], p[i + 2])
  }
  return out
}

/** Redondea para guardar (décimas de unidad y centésimas de presión). */
export function compact(p: number[]): number[] {
  return p.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10))
}
