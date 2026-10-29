/**
 * The few drawing tools the cut edges need (port of liketrek/TREK's
 * Studio/shapeDraw.ts, 5.7.6): a point type, the winding of a ring, and a
 * seeded random source so a torn edge tears the same way every time.
 */

export type Pt = [number, number]

/** Twice the signed area of a ring; clockwise on screen comes out positive. */
export function signedArea(pts: readonly Pt[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  }
  return a / 2
}

/** A small seeded random source (mulberry32). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A whole number from a string, the same every time: an element id as the seed of its torn edge. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
