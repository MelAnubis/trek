// Shared GPX drawing helpers for PDF exports (elevation profile SVG + raster
// route map image). Pure functions, no React — used by both TripPDF.tsx and
// JourneyBookPDF.tsx so the two PDFs render tracks the same way.
import { buildTileUrl, BLOCKED_PREFETCH_HOSTS } from '../../sync/tilePrefetcher'

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
  // Named <wpt> points the GPX file itself carries (waypoints), distinct
  // from the track's own trkpt trail — see journeyGpx.ts's flattenWaypoints.
  waypoints?: { lat: number; lng: number; name: string }[]
  // Best-effort match of the GPX <type> against a small fixed set
  // (hiking/cycling/driving/walking/running) — see the server's own
  // detectTransportMode. Null for most real-world GPX exports, which omit
  // <type> entirely; that's an accepted gap, not a bug.
  transport_mode?: string | null
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

/** Runs `jobs` through a fixed-size worker pool instead of firing them all at once — see its call site for why that matters for tile requests specifically. */
export async function runWithConcurrency(jobs: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      await job()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
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

// ── Aggregate route stats (distance, gain/loss, altitude range, max slope, IBP) ──
// Shared by JourneyBookPDF's route page and Studio's auto-generated route
// spread, so both show the same "full profile" info as the trip planner's
// own ElevationDetail panel (Distancia, Desnivel +/-, Alt. máx/mín, Pend.
// máx, IBP) instead of each re-deriving a different subset of it.
export interface RouteStats {
  totalDist: number
  gain: number
  loss: number
  minEle: number | null
  maxEle: number | null
  maxSlope: number
  ibp: number | null
}

/**
 * Steepest sustained grade in the track, as a percentage. Mirrors
 * ElevationDetail's own distance-based (not point-count-based) lookback
 * window: with dense GPS tracks a point-count window can be only 10-25m,
 * making a couple of metres of GPS noise read as an 8-20% slope. Sampled
 * down to ~1000 points first — same as ElevationDetail's profile builder —
 * so this stays fast on tracks with tens of thousands of points.
 */
function computeMaxSlopePercent(points: PdfGpxTrack['points']): number {
  const withEle = points.filter(p => p.ele != null)
  if (withEle.length < 2) return 0
  const step = Math.max(1, Math.floor(withEle.length / 1000))
  const sampled = withEle.filter((_, i) => i % step === 0)

  const cumM: number[] = [0]
  for (let i = 1; i < sampled.length; i++) {
    cumM.push(cumM[i - 1] + haversineKm(sampled[i - 1].lat, sampled[i - 1].lng, sampled[i].lat, sampled[i].lng) * 1000)
  }

  const MIN_SLOPE_DIST_M = 200
  let max = 0
  for (let i = 0; i < sampled.length; i++) {
    let pi = -1
    for (let j = i - 1; j >= 0; j--) {
      if (cumM[i] - cumM[j] >= MIN_SLOPE_DIST_M) { pi = j; break }
    }
    if (pi < 0) continue
    const dD = cumM[i] - cumM[pi]
    const dE = sampled[i].ele! - sampled[pi].ele!
    max = Math.max(max, Math.abs(dE / dD) * 100)
  }
  return Math.round(max)
}

export function computeRouteStats(tracks: PdfGpxTrack[]): RouteStats {
  const totalDist = tracks.reduce((s, t) => s + (t.total_distance || 0), 0)
  const gain = tracks.reduce((s, t) => s + (t.total_elevation_gain || 0), 0)
  const loss = tracks.reduce((s, t) => s + (t.total_elevation_loss || 0), 0)
  const maxEle = tracks.reduce((m: number | null, t) =>
    t.max_elevation != null ? (m == null ? t.max_elevation : Math.max(m, t.max_elevation)) : m, null)
  const minEle = tracks.reduce((m: number | null, t) =>
    t.min_elevation != null ? (m == null ? t.min_elevation : Math.min(m, t.min_elevation)) : m, null)
  const ibpValues = tracks.map(t => t.ibp).filter((v): v is number => v != null && v > 0)
  const ibp = ibpValues.length ? Math.max(...ibpValues) : null
  const maxSlope = tracks.length ? Math.max(0, ...tracks.map(t => computeMaxSlopePercent(t.points))) : 0
  return { totalDist, gain, loss, minEle, maxEle, maxSlope, ibp }
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

// ── Match tracks to calendar days ─────────────────────────────────────────────
// Shared by the PDF's per-day route pages and the live timeline's per-day
// route cards, so both agree on which track goes with which day.
//
// Three ways a track finds its day, tried in order: (1) it already carries a
// date that matches one of the journal's days, (2) it has no date but its
// points carry real timestamps — split it by calendar date and match each
// fragment, since journeys usually carry one continuous multi-day recording
// rather than a track pre-split per day, (3) no date and no timestamps, but
// it's linked to a trip day planned without a calendar date — pair it with
// the journal's Nth day by position (day_number).
export function groupTracksByDate(
  tracks: PdfGpxTrack[],
  knownDates: string[],
): { byDate: Map<string, PdfGpxTrack[]>; unmatched: PdfGpxTrack[] } {
  const knownDateSet = new Set(knownDates)
  const byDate = new Map<string, PdfGpxTrack[]>()
  const unmatched: PdfGpxTrack[] = []
  const add = (date: string, track: PdfGpxTrack) => {
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(track)
  }

  for (const t of tracks) {
    if (t.date && knownDateSet.has(t.date)) { add(t.date, t); continue }

    let matchedAnyDay = false
    for (const [date, fragment] of splitTrackByDate(t)) {
      if (!knownDateSet.has(date)) continue
      matchedAnyDay = true
      add(date, fragment)
    }
    if (matchedAnyDay) continue

    if (t.day_number != null && t.day_number >= 1 && knownDates[t.day_number - 1]) {
      add(knownDates[t.day_number - 1], { ...t, date: knownDates[t.day_number - 1] })
      continue
    }
    unmatched.push(t)
  }
  return { byDate, unmatched }
}

// ── Real basemap route image (tiles + track, rendered to a raster PNG) ────────
// Renders the track over real map tiles, composited onto a <canvas> so it
// survives the print/srcdoc pipeline as a plain <img>. Falls back to null on
// any failure (no canvas support, blocked tiles, timeout) — callers must
// handle the null case and just skip the map.

const TILE_SIZE = 256
// CARTO's current documented raster endpoint (basemaps.cartocdn.com no
// longer serves the old un-prefixed /light_all/... path going forward).
// As of August 2026 this — like every anonymous CARTO request — renders
// an "API KEY REQUIRED" watermark instead of a real tile without a free
// key appended (?key=...): see Settings > Map for how an admin adds one.
// Kept as the bundled fallback anyway, since a watermarked map still
// fails visibly rather than leaving a blank gap, and it starts working
// correctly the moment a key is configured centrally.
export const DEFAULT_TILE_URL = 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png'

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
// otherwise-fine map instead of a full fallback. The retry re-resolves the
// URL rather than reusing the failed one: buildTileUrl() rotates through
// {s} subdomains on every call, so a tile that failed against a.basemaps
// (a rate limit, a blip on that one edge) gets a real second chance on
// b/c/d instead of hammering the same host that just failed it.
async function loadTileImageWithRetry(buildUrl: () => string): Promise<HTMLImageElement | null> {
  const first = await withTimeout(loadTileImage(buildUrl()), 6000).catch(() => null)
  if (first) return first
  return withTimeout(loadTileImage(buildUrl()), 6000).catch(() => null)
}

/**
 * A raster route map fires a couple dozen tile requests per render, every
 * time a journey's Studio/PDF/timeline map is shown — real bulk,
 * programmatic use of whatever host the template points at. osm.org's own
 * tile servers explicitly refuse exactly this usage pattern (see
 * BLOCKED_PREFETCH_HOSTS's comment) and silently drop a chunk of tiles
 * rather than erroring outright, which is what leaves gaps in the rendered
 * map instead of a clean fallback. If map_tile_url is pointed at one of
 * those hosts, fall back to the bundled CartoDB default rather than hand
 * every render's tiles to a host that will refuse some of them.
 */
export function resolveSafeTileUrl(tileUrlTemplate: string): string {
  return BLOCKED_PREFETCH_HOSTS.some(h => tileUrlTemplate.includes(h)) ? DEFAULT_TILE_URL : tileUrlTemplate
}

export async function buildRouteMapImage(
  entries: PdfMapEntryPoint[],
  tracks: PdfGpxTrack[],
  tileUrlTemplate: string,
  size: { width: number; height: number } = { width: 760, height: 380 },
): Promise<string | null> {
  tileUrlTemplate = resolveSafeTileUrl(tileUrlTemplate)
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
    const jobs: (() => Promise<void>)[] = []
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        if (ty < 0 || ty > maxTile) continue
        const wrappedX = ((tx % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1)
        const tileX = tx, tileY = ty
        jobs.push(() =>
          loadTileImageWithRetry(() => buildTileUrl(tileUrlTemplate, zoom, wrappedX, ty)).then(img => {
            if (img) ctx.drawImage(img, tileX * TILE_SIZE - originX, tileY * TILE_SIZE - originY, TILE_SIZE, TILE_SIZE)
          }),
        )
      }
    }
    // A route map can be 20-140 tiles; firing them all in one burst is the
    // exact "many simultaneous automated requests from one client" pattern
    // free tile hosts' abuse detection looks for (distinct from the
    // per-request throttling BLOCKED_PREFETCH_HOSTS/resolveSafeTileUrl
    // already handle) — trickling requests through a small worker pool
    // instead keeps this looking like the ordinary map panning it's
    // standing in for.
    await runWithConcurrency(jobs, 6)

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
