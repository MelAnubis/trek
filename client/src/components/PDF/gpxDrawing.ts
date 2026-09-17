// Shared GPX drawing helpers for PDF exports (elevation profile SVG + raster
// route map image). Pure functions, no React — used by both TripPDF.tsx and
// JourneyBookPDF.tsx so the two PDFs render tracks the same way.
import { buildTileUrl } from '../../sync/tilePrefetcher'

// ── GPX track type shared by both PDF builders ────────────────────────────────
export interface PdfGpxTrack {
  id: number
  track_name: string
  total_distance: number        // km
  total_elevation_gain: number  // m
  total_elevation_loss: number  // m
  max_elevation: number | null  // m
  min_elevation: number | null  // m
  ibp?: number | null
  points: { lat: number; lng: number; ele: number | null; time?: string | null }[]
  // ISO date (YYYY-MM-DD) of the trip day this track is linked to, when known —
  // lets callers group a flat track list back into per-day pages.
  date?: string | null
  // 1-based position of the linked trip day (day_number), for trips planned
  // without fixed calendar dates — lets callers pair a track with the
  // journal's Nth day by position when there's no date to match on.
  day_number?: number | null
}

// Minimal shape for map "entry" markers (e.g. Journey Book photo entries).
// Trip Planner has no such entries and simply passes an empty array.
export interface PdfMapEntryPoint {
  entry_date?: string | null
  location_lat?: number | string | null
  location_lng?: number | string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// ── Split a single track into per-day fragments by recorded timestamp ────────
// Journeys often carry one continuous multi-day GPX recording (exported from
// Strava/Garmin/Wikiloc/a live-tracking app) rather than tracks manually
// pre-split per trip day. When the points carry real timestamps, this groups
// them by calendar date (UTC) and recomputes distance/elevation stats per
// day so each day can still get its own map + elevation page.
function computeTrackStats(points: PdfGpxTrack['points']): Pick<PdfGpxTrack, 'total_distance' | 'total_elevation_gain' | 'total_elevation_loss' | 'max_elevation' | 'min_elevation'> {
  let total_distance = 0, total_elevation_gain = 0, total_elevation_loss = 0
  let max_elevation: number | null = null, min_elevation: number | null = null
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.ele != null) {
      max_elevation = max_elevation == null ? p.ele : Math.max(max_elevation, p.ele)
      min_elevation = min_elevation == null ? p.ele : Math.min(min_elevation, p.ele)
    }
    if (i > 0) {
      const prev = points[i - 1]
      total_distance += haversineKm(prev.lat, prev.lng, p.lat, p.lng)
      if (prev.ele != null && p.ele != null) {
        const d = p.ele - prev.ele
        if (d > 0) total_elevation_gain += d
        else total_elevation_loss += -d
      }
    }
  }
  return { total_distance, total_elevation_gain, total_elevation_loss, max_elevation, min_elevation }
}

export function splitTrackByDate(track: PdfGpxTrack): Map<string, PdfGpxTrack> {
  const byDate = new Map<string, PdfGpxTrack['points']>()
  for (const p of track.points) {
    if (!p.time) continue
    const d = new Date(p.time)
    if (isNaN(d.getTime())) continue
    const dateKey = d.toISOString().slice(0, 10)
    if (!byDate.has(dateKey)) byDate.set(dateKey, [])
    byDate.get(dateKey)!.push(p)
  }
  const result = new Map<string, PdfGpxTrack>()
  for (const [date, points] of byDate) {
    if (points.length < 2) continue
    result.set(date, { ...track, points, date, ...computeTrackStats(points) })
  }
  return result
}

// ── Real basemap route image (tiles + track, rendered to a raster PNG) ────────
// Renders the track over real map tiles, composited onto a <canvas> so it
// survives the print/srcdoc pipeline as a plain <img>. Falls back to null on
// any failure (no canvas support, blocked tiles, timeout) — callers must
// handle the null case and just skip the map.

const TILE_SIZE = 256
export const DEFAULT_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

function lngToWorldPx(lng: number, zoom: number): number {
  return (lng + 180) / 360 * TILE_SIZE * Math.pow(2, zoom)
}

function latToWorldPx(lat: number, zoom: number): number {
  const latRad = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180
  const n = TILE_SIZE * Math.pow(2, zoom)
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
}

function loadTileImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// One retry on a slow/blipped tile before giving up on it — self-hosted
// deployments often have less headroom on outbound bandwidth than a cloud
// VM, and a single 6s timeout left a handful of tiles blank on an
// otherwise-fine map instead of a full fallback.
async function loadTileImageWithRetry(url: string): Promise<HTMLImageElement | null> {
  const first = await withTimeout(loadTileImage(url), 6000).catch(() => null)
  if (first) return first
  return withTimeout(loadTileImage(url), 6000).catch(() => null)
}

export async function buildRouteMapImage(
  entries: PdfMapEntryPoint[],
  tracks: PdfGpxTrack[],
  tileUrlTemplate: string,
  size: { width: number; height: number } = { width: 760, height: 380 },
): Promise<string | null> {
  const W = size.width, H = size.height

  const entryCoords = entries.filter(e => (e.location_lat as any) && (e.location_lng as any))
  const allPts: { lat: number; lng: number }[] = [
    ...entryCoords.map(e => ({ lat: e.location_lat as unknown as number, lng: e.location_lng as unknown as number })),
    ...tracks.flatMap(t => t.points.filter((_, i) => i % 5 === 0)),
  ]
  if (allPts.length === 0) return null

  try {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    let minLat = Math.min(...allPts.map(p => p.lat))
    let maxLat = Math.max(...allPts.map(p => p.lat))
    let minLng = Math.min(...allPts.map(p => p.lng))
    let maxLng = Math.max(...allPts.map(p => p.lng))

    // Guarantee a minimum span so a single-point journey still shows a real
    // neighbourhood, not one giant tile.
    const MIN_SPAN = 0.05
    if (maxLat - minLat < MIN_SPAN) { const mid = (minLat + maxLat) / 2; minLat = mid - MIN_SPAN / 2; maxLat = mid + MIN_SPAN / 2 }
    if (maxLng - minLng < MIN_SPAN) { const mid = (minLng + maxLng) / 2; minLng = mid - MIN_SPAN / 2; maxLng = mid + MIN_SPAN / 2 }

    // Pick the highest zoom whose bbox (with a padding margin) still fits the canvas.
    const PAD = 0.85
    let zoom = 2
    for (let z = 17; z >= 1; z--) {
      const w = lngToWorldPx(maxLng, z) - lngToWorldPx(minLng, z)
      const h = latToWorldPx(minLat, z) - latToWorldPx(maxLat, z)
      if (w <= W * PAD && h <= H * PAD) { zoom = z; break }
    }

    const centerLng = (minLng + maxLng) / 2
    const centerLat = (minLat + maxLat) / 2
    const originX = lngToWorldPx(centerLng, zoom) - W / 2
    const originY = latToWorldPx(centerLat, zoom) - H / 2

    const minTileX = Math.floor(originX / TILE_SIZE)
    const maxTileX = Math.floor((originX + W) / TILE_SIZE)
    const minTileY = Math.floor(originY / TILE_SIZE)
    const maxTileY = Math.floor((originY + H) / TILE_SIZE)
    const tileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1)
    if (tileCount > 140) return null // safety cap, shouldn't happen given PAD/canvas size

    // Neutral fallback background in case some tiles fail to load
    ctx.fillStyle = '#e9e9e4'
    ctx.fillRect(0, 0, W, H)

    const maxTile = Math.pow(2, zoom) - 1
    const loads: Promise<void>[] = []
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        if (ty < 0 || ty > maxTile) continue
        const wrappedX = ((tx % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1)
        const url = buildTileUrl(tileUrlTemplate, zoom, wrappedX, ty)
        const tileX = tx, tileY = ty
        loads.push(
          loadTileImageWithRetry(url).then(img => {
            if (img) ctx.drawImage(img, tileX * TILE_SIZE - originX, tileY * TILE_SIZE - originY, TILE_SIZE, TILE_SIZE)
          }),
        )
      }
    }
    await Promise.all(loads)

    const project = (lat: number, lng: number) => ({
      x: lngToWorldPx(lng, zoom) - originX,
      y: latToWorldPx(lat, zoom) - originY,
    })

    // Track polylines (glow + main line)
    for (const t of tracks) {
      if (t.points.length === 0) continue
      const step = Math.max(1, Math.floor(t.points.length / 800))
      const pts = t.points.filter((_, i) => i % step === 0 || i === t.points.length - 1).map(p => project(p.lat, p.lng))
      if (pts.length < 2) continue
      for (const [width, alpha] of [[6, 0.18], [2.5, 1]] as const) {
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
        ctx.strokeStyle = `rgba(13,148,136,${alpha})`
        ctx.lineWidth = width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
    }

    // Dashed entry-to-entry line when there's no GPX track to draw
    if (tracks.length === 0 && entryCoords.length > 1) {
      const pts = entryCoords
        .slice()
        .sort((a, b) => (a.entry_date || '').localeCompare(b.entry_date || ''))
        .map(e => project(e.location_lat as any, e.location_lng as any))
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.strokeStyle = 'rgba(13,148,136,0.85)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 5])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Start / end markers when GPX tracks are present
    if (tracks.length > 0 && tracks[0].points.length > 0) {
      const first = tracks[0].points[0]
      const lastTrack = tracks[tracks.length - 1]
      const last = lastTrack.points[lastTrack.points.length - 1]
      for (const [pt, color] of [[project(first.lat, first.lng), '#22c55e'], [project(last.lat, last.lng), '#ef4444']] as const) {
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = color; ctx.fill()
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'white'; ctx.stroke()
      }
    }

    // Numbered entry markers, sorted by date
    const sortedEntries = entryCoords.slice().sort((a, b) => (a.entry_date || '').localeCompare(b.entry_date || ''))
    sortedEntries.forEach((e, i) => {
      const { x, y } = project(e.location_lat as any, e.location_lng as any)
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(15,23,42,0.25)'; ctx.fill()
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2)
      ctx.fillStyle = '#0f172a'; ctx.fill()
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#2dd4bf'; ctx.stroke()
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '700 7.5pt Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), x, y + 0.5)
    })

    // Attribution (required by tile providers)
    ctx.font = '600 7pt Inter, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    const attribution = tileUrlTemplate.includes('cartocdn') ? '© CARTO © OpenStreetMap contributors' : '© OpenStreetMap contributors'
    const textW = ctx.measureText(attribution).width
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fillRect(0, H - 16, textW + 12, 16)
    ctx.fillStyle = '#3f3f46'
    ctx.fillText(attribution, 6, H - 5)

    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

// ── Elevation profile SVG ─────────────────────────────────────────────────────

export function buildElevationSvg(tracks: PdfGpxTrack[]): string {
  const W = 760, H = 140

  // Build cumulative-distance+elevation series from all tracks
  const pts: { d: number; e: number }[] = []
  let cumD = 0

  for (const track of tracks) {
    const elePts = track.points.filter(p => p.ele != null)
    if (elePts.length < 2) continue
    // Sample to ~400 points per track
    const step = Math.max(1, Math.floor(elePts.length / 400))
    let prev: typeof elePts[0] | null = null
    for (let i = 0; i < elePts.length; i += step) {
      const p = elePts[i]
      if (prev) cumD += haversineKm(prev.lat, prev.lng, p.lat, p.lng)
      pts.push({ d: cumD, e: p.ele! })
      prev = p
    }
    // ensure last point is captured
    const lastP = elePts[elePts.length - 1]
    if (prev && lastP !== prev) {
      cumD += haversineKm(prev.lat, prev.lng, lastP.lat, lastP.lng)
      pts.push({ d: cumD, e: lastP.ele! })
    }
  }

  if (pts.length < 2) return ''

  const minE = Math.min(...pts.map(p => p.e))
  const maxE = Math.max(...pts.map(p => p.e))
  const maxD = pts[pts.length - 1].d
  if (maxD === 0) return ''

  const PAD = { t: 16, r: 8, b: 28, l: 46 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b
  const eRange = maxE - minE || 1

  const px = (d: number) => PAD.l + (d / maxD) * cW
  const py = (e: number) => PAD.t + (1 - (e - minE) / eRange) * cH

  // Build filled path
  const linePts = pts.map(p => `${px(p.d).toFixed(1)},${py(p.e).toFixed(1)}`).join(' ')
  const areaPath = `M${px(0).toFixed(1)},${py(pts[0].e).toFixed(1)} ` +
    pts.slice(1).map(p => `L${px(p.d).toFixed(1)},${py(p.e).toFixed(1)}`).join(' ') +
    ` L${px(maxD).toFixed(1)},${(PAD.t + cH).toFixed(1)} L${PAD.l},${(PAD.t + cH).toFixed(1)} Z`

  // Y-axis labels (elevation)
  const yLabels: string[] = []
  const nYTicks = 4
  for (let i = 0; i <= nYTicks; i++) {
    const e = minE + (eRange * i / nYTicks)
    const y = py(e)
    yLabels.push(`<text x="${(PAD.l - 4).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="7.5" fill="#94a3b8" font-family="Inter,sans-serif">${Math.round(e)}</text>`)
    yLabels.push(`<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${(PAD.l + cW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.5" stroke-dasharray="3,3"/>`)
  }

  // X-axis labels (distance)
  const xLabels: string[] = []
  const nXTicks = Math.min(8, Math.ceil(maxD))
  for (let i = 0; i <= nXTicks; i++) {
    const d = maxD * i / nXTicks
    const x = px(d)
    xLabels.push(`<text x="${x.toFixed(1)}" y="${(PAD.t + cH + 14).toFixed(1)}" text-anchor="middle" font-size="7" fill="#94a3b8" font-family="Inter,sans-serif">${d.toFixed(1)}</text>`)
  }

  // km label
  xLabels.push(`<text x="${(PAD.l + cW / 2).toFixed(1)}" y="${(H - 1).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#cbd5e1" font-family="Inter,sans-serif">km</text>`)
  // m label
  yLabels.push(`<text x="2" y="${(PAD.t + cH / 2).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#cbd5e1" font-family="Inter,sans-serif" transform="rotate(-90,2,${(PAD.t + cH / 2).toFixed(1)})">m</text>`)

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;">
    <defs>
      <linearGradient id="eleGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0d9488" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#0d9488" stop-opacity="0.04"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="white"/>
    ${yLabels.join('')}
    ${xLabels.join('')}
    <path d="${areaPath}" fill="url(#eleGrad)"/>
    <polyline points="${linePts}" fill="none" stroke="#0d9488" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- baseline -->
    <line x1="${PAD.l}" y1="${(PAD.t + cH).toFixed(1)}" x2="${(PAD.l + cW).toFixed(1)}" y2="${(PAD.t + cH).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>
    <line x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${(PAD.t + cH).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>
  </svg>`
}
