/** Perfil de altimetría de la zona pública: [km, metros] → trazos SVG y la «peor subida». */

export type Profile = [number, number][]

/**
 * The biggest climb: the largest rise from a low point to a later high
 * point (net metres). Its start is where the #ESTODOBAJADA sticker goes.
 */
export function biggestClimb(p: Profile): { from: number; to: number; gain: number } | null {
  if (p.length < 2) return null
  let lowI = 0
  let best = { from: 0, to: 0, gain: 0 }
  for (let i = 1; i < p.length; i++) {
    if (p[i][1] < p[lowI][1]) lowI = i
    const gain = p[i][1] - p[lowI][1]
    if (gain > best.gain) best = { from: lowI, to: i, gain }
  }
  return best.gain > 0 ? best : null
}

export interface ProfileGeometry {
  line: string
  area: string
  x: (km: number) => number
  y: (ele: number) => number
  minEle: number
  maxEle: number
  totalKm: number
}

/** Scale a profile into a w×h box (with a little headroom), as line and filled area paths. */
export function profilePaths(p: Profile, w: number, h: number, pad = { top: 8, bottom: 4 }): ProfileGeometry | null {
  if (p.length < 2) return null
  const totalKm = p[p.length - 1][0] - p[0][0] || 1
  let minEle = Infinity, maxEle = -Infinity
  for (const [, e] of p) { if (e < minEle) minEle = e; if (e > maxEle) maxEle = e }
  // A flat route still gets some relief so the line isn't glued to the bottom.
  const span = Math.max(maxEle - minEle, 60)
  const x = (km: number) => ((km - p[0][0]) / totalKm) * w
  const y = (ele: number) => pad.top + (1 - (ele - minEle) / span) * (h - pad.top - pad.bottom)
  const pts = p.map(([k, e]) => `${x(k).toFixed(1)},${y(e).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  const area = `${line} L${w},${h} L0,${h} Z`
  return { line, area, x, y, minEle, maxEle, totalKm }
}

const nf = (locale: string, d = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: d, minimumFractionDigits: 0 })
export const fmtKm = (km: number, locale: string) => `${nf(locale, km < 100 ? 1 : 0).format(km)} km`
export const fmtM = (m: number, locale: string) => `${nf(locale).format(m)} m`
