import type { BookEdge, BookPhotoElement, BookShapeElement, BookShapeId } from '../../types/book'
import { seedOf } from './edgeDraw'
import { SHAPE_PATHS, circle, roundRect, scalePath } from './shapes'
import { edgedPath } from './shapesEdges'

/**
 * The outline a shape or a photo's cut is drawn with, in millimetres, once
 * its edge is applied (port of liketrek/TREK's Studio/shapeOutline.ts, 5.7.6).
 */

/** The edge depth used when an edge is chosen and no size: about a postage stamp's. */
export const DEFAULT_EDGE_SIZE = 3

/**
 * The shapes an edge is cut along: the broad, convex ones, where a bite into
 * the outline stays inside it. A cut along a heart's notch or a star's
 * valleys folds over itself, so those keep their drawn outline.
 */
export const EDGE_SHAPES: ReadonlySet<string> = new Set<BookShapeId>([
  'rect', 'squircle', 'ellipse', 'capsule', 'arch', 'half-circle', 'triangle', 'triangle-down', 'diamond',
  'pentagon', 'hexagon', 'hexagon-flat', 'heptagon', 'octagon', 'shield', 'parallelogram', 'trapezoid',
  'arch-tall', 'frame-chamfer', 'frame-cushion', 'organic-1', 'organic-2', 'organic-3',
])

/** Whether an edge is cut along this shape; null is a photo's plain rectangle. */
export function shapeTakesEdge(shape: string | null): boolean {
  return shape === null || EDGE_SHAPES.has(shape)
}

type Edged = { edge?: BookEdge; edgeSize?: number }

/** Whether the element's edge is cut along this outline (a heart, for one, keeps its drawn line). */
export function hasEdge(el: Edged, shape: BookShapeId | null): boolean {
  return !!el.edge && el.edge !== 'straight' && shapeTakesEdge(shape)
}

/** A box `w` by `h` in millimetres, as the outline the edge is cut along: a rect keeps its corner radius. */
function basePath(shape: BookShapeId | null, w: number, h: number, radius: number): string {
  if (shape === null || shape === 'rect') {
    const r = Math.min(radius, w / 2, h / 2)
    return r > 0 ? roundRect(r, 0, 0, w, h) : `M0 0L${w} 0L${w} ${h}L0 ${h}Z`
  }
  if (shape === 'ellipse') return circle(w / 2, h / 2, w / 2, h / 2)
  return scalePath(SHAPE_PATHS[shape], w, h)
}

/** The outline of a shape `w` by `h` millimetres, its edge cut where it takes one. */
export function shapeOutline(el: Edged & Pick<BookShapeElement, 'id' | 'shape' | 'radius'>, w: number, h: number): string {
  if (!hasEdge(el, el.shape)) return basePath(el.shape, w, h, el.radius)
  return edgedPath(basePath(el.shape, w, h, el.radius), el.edge ?? 'straight', el.edgeSize ?? DEFAULT_EDGE_SIZE, seedOf(el.id))
}

/**
 * The cut of a photo's picture box (`w` by `h` mm) as an objectBoundingBox
 * clip, 0..1 on both axes; null when no edge is cut (the mask, if any, is
 * clipped the way it always was). The edge is cut in millimetres and only
 * then divided down, so a stamp's holes stay round on a wide photo.
 */
export function photoEdgeClip(el: Pick<BookPhotoElement, 'id' | 'mask' | 'edge' | 'edgeSize' | 'radius'>, w: number, h: number): string | null {
  const mm = photoEdgePath(el, w, h)
  if (mm === null) return null
  let axis = 0
  return mm.replace(/-?\d*\.?\d+/g, m => {
    const v = Number(m) / (axis++ % 2 === 0 ? w : h)
    return String(Math.round(v * 100000) / 100000)
  })
}

/** The same cut in millimetres, for the silhouette a hard shadow and a die-cut edge are drawn from. */
export function photoEdgePath(el: Pick<BookPhotoElement, 'id' | 'mask' | 'edge' | 'edgeSize' | 'radius'>, w: number, h: number): string | null {
  const mask = el.mask && el.mask !== 'rect' ? el.mask : null
  if (!hasEdge(el, mask) || w <= 0 || h <= 0) return null
  return edgedPath(basePath(mask, w, h, el.radius), el.edge ?? 'straight', el.edgeSize ?? DEFAULT_EDGE_SIZE, seedOf(el.id))
}
