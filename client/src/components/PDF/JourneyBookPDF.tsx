// Journey Photo Book PDF — Polarsteps-inspired, magazine-density
import { marked } from 'marked'
import type { JourneyDetail, JourneyEntry, JourneyPhoto } from '../../store/journeyStore'

// ── GPX types passed in from the page ─────────────────────────────────────────
export interface PdfGpxTrack {
  id: number
  track_name: string
  total_distance: number        // km
  total_elevation_gain: number  // m
  total_elevation_loss: number  // m
  max_elevation: number | null  // m
  min_elevation: number | null  // m
  ibp?: number | null
  points: { lat: number; lng: number; ele: number | null }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str: string | null | undefined): string {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function md(str: string | null | undefined): string {
  if (!str) return ''
  return marked.parse(str, { async: false, breaks: true }) as string
}

function abs(url: string | null | undefined): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
  return window.location.origin + (url.startsWith('/') ? '' : '/') + url
}

function pSrc(p: JourneyPhoto): string {
  return abs(`/api/photos/${p.photo_id}/original`)
}

function fmtDate(d: string): string {
  const date = new Date(d + 'T00:00:00')
  return date.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtShort(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function groupByDate(entries: JourneyEntry[]): Map<string, JourneyEntry[]> {
  const groups = new Map<string, JourneyEntry[]>()
  for (const e of entries) {
    if (!e.entry_date) continue
    if (!groups.has(e.entry_date)) groups.set(e.entry_date, [])
    groups.get(e.entry_date)!.push(e)
  }
  return groups
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function renderProscons(entry: JourneyEntry): string {
  const pc = entry.pros_cons
  if (!pc) return ''
  const pros = pc.pros?.filter(p => p.trim()) || []
  const cons = pc.cons?.filter(c => c.trim()) || []
  if (pros.length === 0 && cons.length === 0) return ''

  return `<div class="verdict-wrap"><div class="verdict-row">
    ${pros.length > 0 ? `<div class="verdict-card pros"><div class="verdict-label">Loved it</div><ul>${pros.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    ${cons.length > 0 ? `<div class="verdict-card cons"><div class="verdict-label">Could be better</div><ul>${cons.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
  </div></div>`
}

function renderPhotoBlock(photos: JourneyPhoto[]): string {
  if (photos.length === 0) return ''
  if (photos.length === 1) {
    return `<div class="entry-photo-single"><img src="${pSrc(photos[0])}" /></div>`
  }
  if (photos.length === 2) {
    return `<div class="entry-photo-duo">${photos.map(p => `<div class="photo-cell"><img src="${pSrc(p)}" /></div>`).join('')}</div>`
  }
  // 3+ photos: hero left + stack right
  return `<div class="entry-photo-trio">
    <div class="photo-hero"><img src="${pSrc(photos[0])}" /></div>
    <div class="photo-stack">
      <div class="photo-cell"><img src="${pSrc(photos[1])}" /></div>
      <div class="photo-cell"><img src="${pSrc(photos[2])}" /></div>
    </div>
  </div>`
}

// ── Route card SVG (dark, Strava-style) ──────────────────────────────────────

function buildRouteCardSvg(entries: JourneyEntry[], tracks: PdfGpxTrack[]): string {
  const W = 760, H = 320

  // Sorted entry locations
  const entryCoords = entries
    .filter(e => (e.location_lat as any) && (e.location_lng as any))
    .sort((a, b) => (a.entry_date || '').localeCompare(b.entry_date || ''))

  // Collect all points for bounding box
  const allPts: { lat: number; lng: number }[] = [
    ...entryCoords.map(e => ({ lat: e.location_lat as unknown as number, lng: e.location_lng as unknown as number })),
    ...tracks.flatMap(t => t.points.filter((_, i) => i % 10 === 0)),
  ]

  if (allPts.length === 0) return ''

  const minLat = Math.min(...allPts.map(p => p.lat))
  const maxLat = Math.max(...allPts.map(p => p.lat))
  const minLng = Math.min(...allPts.map(p => p.lng))
  const maxLng = Math.max(...allPts.map(p => p.lng))

  // Mercator Y
  const mercLat = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
  const mMin = mercLat(minLat), mMax = mercLat(maxLat)

  // Padding (15%)
  const lpPad = Math.max((mMax - mMin) * 0.15, 0.005)
  const lgPad = Math.max((maxLng - minLng) * 0.15, 0.005)
  const bMMin = mMin - lpPad, bMMax = mMax + lpPad
  const bLMin = minLng - lgPad, bLMax = maxLng + lgPad

  // Fit bbox into W×H preserving aspect ratio
  const natW = bLMax - bLMin
  const natH = bMMax - bMMin
  let cW = W, cH = H, offX = 0, offY = 0
  if (natW / natH > W / H) {
    cH = W * natH / natW
    offY = (H - cH) / 2
  } else {
    cW = H * natW / natH
    offX = (W - cW) / 2
  }

  const project = (lat: number, lng: number) => ({
    x: offX + (lng - bLMin) / (bLMax - bLMin) * cW,
    y: offY + (1 - (mercLat(lat) - bMMin) / (bMMax - bMMin)) * cH,
  })

  // GPX track polylines (sample down)
  const trackSvg = tracks.map(t => {
    if (t.points.length === 0) return ''
    const step = Math.max(1, Math.floor(t.points.length / 600))
    const pts = t.points
      .filter((_, i) => i % step === 0 || i === t.points.length - 1)
      .map(p => { const { x, y } = project(p.lat, p.lng); return `${x.toFixed(1)},${y.toFixed(1)}` })
      .join(' ')
    return `<polyline points="${pts}" fill="none" stroke="#2dd4bf" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('')

  // Entry connections (dashed, shown only when no GPX tracks available)
  let connSvg = ''
  if (tracks.length === 0 && entryCoords.length > 1) {
    const pts = entryCoords.map(e => {
      const { x, y } = project(e.location_lat as any, e.location_lng as any)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    connSvg = `<polyline points="${pts}" fill="none" stroke="#2dd4bf" stroke-width="1.8" stroke-dasharray="5,4" opacity="0.7"/>`
  }

  // Entry markers (numbered)
  const markerSvg = entryCoords.map((e, i) => {
    const { x, y } = project(e.location_lat as any, e.location_lng as any)
    const n = String(i + 1)
    const r = 8
    return [
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r + 3}" fill="#0d9488" opacity="0.25"/>`,
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#0f172a" stroke="#2dd4bf" stroke-width="1.5"/>`,
      `<text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#e2e8f0" font-weight="700" font-family="Inter,sans-serif">${esc(n)}</text>`,
    ].join('')
  }).join('')

  // Subtle grid lines
  const gridLines: string[] = []
  const latStep = Math.ceil((maxLat - minLat) / 4 * 10) / 10
  const lngStep = Math.ceil((maxLng - minLng) / 4 * 10) / 10
  if (latStep > 0) {
    for (let lat = Math.floor(minLat); lat <= Math.ceil(maxLat); lat += latStep) {
      const { y } = project(lat, minLng)
      gridLines.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`)
    }
  }
  if (lngStep > 0) {
    for (let lng = Math.floor(minLng); lng <= Math.ceil(maxLng); lng += lngStep) {
      const { x } = project(minLat, lng)
      gridLines.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`)
    }
  }

  // Start & end markers (if GPX tracks available, mark their endpoints)
  let endptSvg = ''
  if (tracks.length > 0 && tracks[0].points.length > 0) {
    const first = tracks[0].points[0]
    const last = tracks[tracks.length - 1].points[tracks[tracks.length - 1].points.length - 1]
    const { x: sx, y: sy } = project(first.lat, first.lng)
    const { x: ex, y: ey } = project(last.lat, last.lng)
    endptSvg = [
      `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="#22c55e" stroke="white" stroke-width="1.5"/>`,
      `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="5" fill="#ef4444" stroke="white" stroke-width="1.5"/>`,
    ].join('')
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;border-radius:10pt;overflow:hidden;">
    <rect width="${W}" height="${H}" fill="#0c1628"/>
    ${gridLines.join('')}
    ${trackSvg}
    ${connSvg}
    ${endptSvg}
    ${markerSvg}
  </svg>`
}

// ── Elevation profile SVG ─────────────────────────────────────────────────────

function buildElevationSvg(tracks: PdfGpxTrack[]): string {
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

// ── Route page HTML ───────────────────────────────────────────────────────────

function buildRoutePage(
  entries: JourneyEntry[],
  tracks: PdfGpxTrack[],
): string {
  const mapSvg = buildRouteCardSvg(entries, tracks)
  if (!mapSvg) return ''  // no coordinates at all

  // Aggregate stats across all tracks
  const totalDist = tracks.reduce((s, t) => s + (t.total_distance || 0), 0)
  const totalGain = tracks.reduce((s, t) => s + (t.total_elevation_gain || 0), 0)
  const totalLoss = tracks.reduce((s, t) => s + (t.total_elevation_loss || 0), 0)
  const maxEle    = tracks.reduce((m: number | null, t) =>
    t.max_elevation != null ? (m == null ? t.max_elevation : Math.max(m, t.max_elevation)) : m, null)
  const hasIbp    = tracks.some(t => t.ibp != null && t.ibp > 0)
  const hasEle    = tracks.some(t => t.total_elevation_gain > 50 &&
    t.points.some(p => p.ele != null))

  // Elevation profile SVG (bikes / significant elevation)
  const elevSvg = (hasEle || hasIbp) ? buildElevationSvg(tracks) : ''

  const statPills = [
    totalDist > 0  ? `<div class="rstat"><div class="rstat-val">${totalDist.toFixed(1)} km</div><div class="rstat-lbl">Distance</div></div>` : '',
    totalGain > 0  ? `<div class="rstat"><div class="rstat-val">↑ ${Math.round(totalGain).toLocaleString()} m</div><div class="rstat-lbl">Elevation gain</div></div>` : '',
    totalLoss > 0  ? `<div class="rstat"><div class="rstat-val">↓ ${Math.round(totalLoss).toLocaleString()} m</div><div class="rstat-lbl">Elevation loss</div></div>` : '',
    maxEle != null ? `<div class="rstat"><div class="rstat-val">${Math.round(maxEle).toLocaleString()} m</div><div class="rstat-lbl">Max elevation</div></div>` : '',
  ].filter(Boolean).join('')

  return `
  <div class="route-page">
    <div class="route-section-label">Route Overview</div>
    <div class="route-map-wrap">${mapSvg}</div>
    ${statPills ? `<div class="route-stats">${statPills}</div>` : ''}
    ${elevSvg ? `
    <div class="route-ele-label">Elevation Profile</div>
    <div class="route-ele-wrap">${elevSvg}</div>
    ` : ''}
  </div>`
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function downloadJourneyBookPDF(journey: JourneyDetail, tracks: PdfGpxTrack[] = []) {
  const entries = (journey.entries || []).filter(e => e.type !== 'skeleton' && e.type !== 'gallery')
  const allPhotos = entries.flatMap(e => e.photos || [])
  const coverUrl = journey.cover_image ? abs(`/uploads/${journey.cover_image}`) : (allPhotos[0] ? pSrc(allPhotos[0]) : '')

  const grouped = groupByDate(entries)
  const dates = [...grouped.keys()].sort()

  // Route page (inserted between TOC and entries)
  const routePageHtml = buildRoutePage(entries, tracks)
  const hasRoutePage = routePageHtml.length > 0

  // Build entry pages
  const entryPages: string[] = []
  let pageNum = hasRoutePage ? 3 : 2 // cover=1, toc=2, route=3(optional)
  dates.forEach((date, di) => {
    const dayEntries = grouped.get(date)!
    dayEntries.forEach((entry, ei) => {
      pageNum++
      const isFirstOfDay = ei === 0
      const photos = entry.photos || []
      const meta = [entry.entry_time, entry.location_name].filter(Boolean).join(' · ')

      const dayHeaderHtml = isFirstOfDay
        ? `<div class="day-header">Day ${di + 1} · ${fmtDate(date)}</div>`
        : ''

      const photoHtml = renderPhotoBlock(photos)
      const prosconsHtml = renderProscons(entry)
      const storyHtml = entry.story ? `<div class="entry-story">${md(entry.story)}</div>` : ''

      entryPages.push(`
        <div class="entry-page">
          ${dayHeaderHtml}
          ${photoHtml}
          <div class="entry-content">
            ${meta ? `<div class="entry-meta">${esc(meta)}</div>` : ''}
            ${entry.title ? `<h2 class="entry-title">${esc(entry.title)}</h2>` : ''}
            ${storyHtml}
            ${prosconsHtml}
          </div>
        </div>
      `)
    })
  })

  const totalPages = pageNum + 1 // +1 for closing

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<base href="${window.location.origin}/">
<title>${esc(journey.title)} — Journey Book</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #1A1A1A; font-size: 11pt; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  @page { size: A4 landscape; margin: 0; }

  /* ── Cover ─── */
  .cover-page {
    width: 100%; height: 100vh; position: relative; overflow: hidden;
    background: #0a0a0f; color: white; display: flex; align-items: center; justify-content: center;
    page-break-after: always;
  }
  .cover-bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .cover-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.5); }
  .cover-mesh { position: absolute; inset: 0; background: radial-gradient(circle at 20% 30%, rgba(99,102,241,0.2), transparent 50%), radial-gradient(circle at 80% 70%, rgba(236,72,153,0.15), transparent 50%); }
  .cover-content { position: relative; z-index: 2; text-align: center; padding: 60pt; }
  .cover-label { font-size: 9pt; font-weight: 700; letter-spacing: 6pt; text-transform: uppercase; opacity: 0.35; margin-bottom: 24pt; }
  .cover-content h1 { font-size: 56pt; font-weight: 800; letter-spacing: -0.03em; line-height: 0.9; margin-bottom: 10pt; }
  .cover-content .sub { font-size: 14pt; font-weight: 400; opacity: 0.7; margin-bottom: 36pt; }
  .cover-stats { display: flex; gap: 48pt; justify-content: center; }
  .cover-stat-val { font-size: 32pt; font-weight: 800; letter-spacing: -0.02em; }
  .cover-stat-label { font-size: 10pt; text-transform: uppercase; letter-spacing: 2pt; opacity: 0.4; margin-top: 3pt; }
  .cover-footer { position: absolute; bottom: 20pt; left: 0; right: 0; text-align: center; font-size: 9pt; opacity: 0.2; letter-spacing: 3pt; text-transform: uppercase; }

  /* ── TOC ─── */
  .toc-page {
    width: 100%; height: 100vh; padding: 48pt 64pt; display: flex; flex-direction: column;
    background: white; page-break-after: always;
  }
  .toc-top-label { font-size: 9pt; font-weight: 700; letter-spacing: 5pt; text-transform: uppercase; color: #94a3b8; margin-bottom: 16pt; }
  .toc-title-block h2 { font-size: 36pt; font-weight: 800; letter-spacing: -1pt; color: #0a0a0f; margin-bottom: 4pt; }
  .toc-title-block .sub { font-size: 13pt; color: #71717a; margin-bottom: 24pt; }
  .toc-divider { height: 1pt; background: #e4e4e7; margin: 16pt 0; }
  .toc-body { flex: 1; columns: 2; column-gap: 40pt; }
  .toc-day { break-inside: avoid; margin-bottom: 14pt; }
  .toc-day-label { font-size: 9pt; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #71717a; margin-bottom: 4pt; }
  .toc-entry { display: flex; align-items: baseline; gap: 4pt; font-size: 11pt; color: #3f3f46; margin-bottom: 2pt; }
  .toc-entry .toc-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200pt; }
  .toc-entry .toc-dots { flex: 1; border-bottom: 1pt dotted #d4d4d8; margin: 0 4pt; min-width: 20pt; }
  .toc-entry .toc-page { font-size: 10pt; color: #a1a1aa; font-weight: 500; flex-shrink: 0; }
  .toc-stats { display: flex; gap: 32pt; margin-top: auto; padding-top: 16pt; border-top: 1pt solid #e4e4e7; }
  .toc-stat-val { font-size: 18pt; font-weight: 800; color: #0a0a0f; }
  .toc-stat-label { font-size: 9pt; text-transform: uppercase; letter-spacing: 1pt; color: #94a3b8; }

  /* ── Route Overview Page ─── */
  .route-page {
    width: 100%; height: 100vh; padding: 40pt 48pt 36pt;
    background: #0c1628; color: white;
    display: flex; flex-direction: column; gap: 14pt;
    page-break-after: always;
  }
  .route-section-label {
    font-size: 9pt; font-weight: 700; letter-spacing: 5pt; text-transform: uppercase;
    color: rgba(255,255,255,0.35);
  }
  .route-map-wrap { flex: 1; min-height: 0; overflow: hidden; border-radius: 10pt; }
  .route-map-wrap svg { width: 100%; height: 100%; object-fit: contain; }
  .route-stats { display: flex; gap: 24pt; flex-shrink: 0; }
  .rstat { }
  .rstat-val { font-size: 14pt; font-weight: 700; color: #2dd4bf; letter-spacing: -0.02em; }
  .rstat-lbl { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(255,255,255,0.4); margin-top: 2pt; }
  .route-ele-label {
    font-size: 8pt; font-weight: 600; letter-spacing: 4pt; text-transform: uppercase;
    color: rgba(255,255,255,0.3); flex-shrink: 0;
  }
  .route-ele-wrap { flex-shrink: 0; background: white; border-radius: 6pt; overflow: hidden; padding: 6pt; }

  /* ── Entry Page ─── */
  .entry-page {
    width: 100%; min-height: 100vh; padding: 56pt 48pt 48pt;
    page-break-after: always;
    display: flex; flex-direction: column;
  }
  .day-header {
    font-size: 9pt; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
    color: #71717a; text-align: center; margin-bottom: 16pt; position: relative;
    display: flex; align-items: center; gap: 12pt;
  }
  .day-header::before, .day-header::after { content: ''; flex: 1; height: 0.5pt; background: #d4d4d8; }

  /* Photos */
  .entry-photo-single { border-radius: 8pt; overflow: hidden; margin-bottom: 16pt; height: 55vh; }
  .entry-photo-single img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .entry-photo-duo { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt; border-radius: 8pt; overflow: hidden; margin-bottom: 16pt; height: 45vh; }
  .entry-photo-trio { display: grid; grid-template-columns: 3fr 2fr; gap: 6pt; border-radius: 8pt; overflow: hidden; margin-bottom: 16pt; height: 50vh; }
  .photo-cell { overflow: hidden; }
  .photo-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo-hero { overflow: hidden; }
  .photo-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo-stack { display: flex; flex-direction: column; gap: 6pt; }
  .photo-stack .photo-cell { flex: 1; }

  /* Entry content */
  .entry-content { flex: 1; }
  .entry-meta { font-size: 10pt; letter-spacing: 0.04em; text-transform: uppercase; color: #71717a; font-weight: 500; margin-bottom: 6pt; }
  h2.entry-title { font-size: 28pt; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; margin: 0 0 10pt; color: #0a0a0f; }
  .entry-story { font-size: 11pt; line-height: 1.65; color: #3f3f46; }
  .entry-story p { margin: 0 0 8pt; }
  .entry-story strong { font-weight: 600; color: #0a0a0f; }
  .entry-story em { font-style: italic; }
  .entry-story blockquote { margin: 12pt 0; padding-left: 12pt; border-left: 2pt solid #d4d4d8; font-style: italic; color: #52525b; }
  .entry-story ul, .entry-story ol { margin: 8pt 0; padding-left: 16pt; }
  .entry-story li { margin-bottom: 4pt; }
  .entry-story a { color: #2563eb; text-decoration: none; }

  /* Verdict */
  .verdict-wrap { break-inside: avoid; padding-top: 14pt; }
  .verdict-row { display: flex; gap: 10pt; }
  .verdict-card { flex: 1; padding: 10pt 12pt; border-radius: 6pt; font-size: 9.5pt; }
  .verdict-card.pros { background: #f0fdf4; border: 0.5pt solid #bbf7d0; }
  .verdict-card.cons { background: #fef2f2; border: 0.5pt solid #fecaca; }
  .verdict-label { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6pt; }
  .verdict-card.pros .verdict-label { color: #15803d; }
  .verdict-card.cons .verdict-label { color: #b91c1c; }
  .verdict-card ul { margin: 0; padding: 0; list-style: none; }
  .verdict-card li { padding: 2pt 0; position: relative; padding-left: 10pt; }
  .verdict-card li::before { content: '•'; position: absolute; left: 0; }
  .verdict-card.pros li { color: #14532d; }
  .verdict-card.pros li::before { color: #22c55e; }
  .verdict-card.cons li { color: #7f1d1d; }
  .verdict-card.cons li::before { color: #ef4444; }

  /* ── Closing ─── */
  .closing-page {
    width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0a0a0f; color: white; text-align: center; page-break-after: auto;
  }
  .closing-title { font-size: 32pt; font-weight: 300; letter-spacing: -1pt; opacity: 0.6; margin-bottom: 8pt; }
  .closing-sub { font-size: 10pt; opacity: 0.25; letter-spacing: 3pt; text-transform: uppercase; }

  /* ── Print ─── */
  @media print {
    .print-bar { display: none !important; }
    body { margin: 0; }
    .entry-page { orphans: 3; widows: 3; }
    h2.entry-title { page-break-after: avoid; }
    .verdict-row { page-break-inside: avoid; }
    .entry-photo-single, .entry-photo-duo, .entry-photo-trio { page-break-after: avoid; }
  }

</style>
</head>
<body>

  <!-- Page 1: Cover -->
  <div class="cover-page">
    ${coverUrl ? `<div class="cover-bg" style="background-image:url('${coverUrl}')"></div>` : ''}
    <div class="cover-dim"></div>
    <div class="cover-mesh"></div>
    <div class="cover-content">
      <div class="cover-label">Journey Book</div>
      <h1>${esc(journey.title)}</h1>
      ${journey.subtitle ? `<div class="sub">${esc(journey.subtitle)}</div>` : ''}
      <div class="cover-stats">
        <div><div class="cover-stat-val">${dates.length}</div><div class="cover-stat-label">Days</div></div>
        <div><div class="cover-stat-val">${entries.length}</div><div class="cover-stat-label">Entries</div></div>
        <div><div class="cover-stat-val">${allPhotos.length}</div><div class="cover-stat-label">Photos</div></div>
      </div>
    </div>
    <div class="cover-footer">Made with TREK</div>
  </div>

  <!-- Page 2: TOC -->
  <div class="toc-page">
    <div class="toc-top-label">Contents</div>
    <div class="toc-title-block">
      <h2>${esc(journey.title)}</h2>
      ${journey.subtitle ? `<div class="sub">${esc(journey.subtitle)}</div>` : ''}
    </div>
    <div class="toc-divider"></div>
    <div class="toc-body">
      ${dates.map((date, di) => {
        const dayEntries = grouped.get(date)!
        return `<div class="toc-day">
          <div class="toc-day-label">Day ${di + 1} · ${fmtShort(date)}</div>
          ${dayEntries.map(e => `<div class="toc-entry">
            <span class="toc-title">${esc(e.title || '—')}</span>
            <span class="toc-dots"></span>
          </div>`).join('')}
        </div>`
      }).join('')}
    </div>
    <div class="toc-stats">
      <div><div class="toc-stat-val">${dates.length}</div><div class="toc-stat-label">Days</div></div>
      <div><div class="toc-stat-val">${entries.length}</div><div class="toc-stat-label">Entries</div></div>
      <div><div class="toc-stat-val">${allPhotos.length}</div><div class="toc-stat-label">Photos</div></div>
    </div>
  </div>

  <!-- Page 3: Route Overview (if coordinates available) -->
  ${routePageHtml}

  <!-- Entry Pages -->
  ${entryPages.join('\n')}

  <!-- Closing Page -->
  <div class="closing-page">
    <div>
      <div class="closing-title">The End</div>
      <div class="closing-sub">Made with TREK · ${new Date().getFullYear()}</div>
    </div>
  </div>

</body>
</html>`

  // Render in overlay + iframe
  const overlay = document.createElement('div')
  overlay.id = 'journey-pdf-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:8px;'
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }

  const card = document.createElement('div')
  card.style.cssText = 'width:100%;max-width:1100px;height:95vh;background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.35);'

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid #e4e4e7;flex-shrink:0;background:#0f172a;'
  header.innerHTML = `
    <span style="font-size:12px;color:rgba(255,255,255,0.45);font-weight:500;letter-spacing:0.03em">${esc(journey.title)} &middot; ${totalPages} pages</span>
    <div style="display:flex;align-items:center;gap:8px">
      <button id="journey-pdf-save" style="min-height:44px;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;border:none;background:#fff;color:#0f172a;">Save as PDF</button>
      <button id="journey-pdf-close" style="min-height:44px;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);">Close</button>
    </div>
  `

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'flex:1;width:100%;border:none;'
  iframe.sandbox = 'allow-same-origin allow-modals allow-scripts'
  iframe.srcdoc = html

  card.appendChild(header)
  card.appendChild(iframe)
  overlay.appendChild(card)
  document.body.appendChild(overlay)

  header.querySelector<HTMLButtonElement>('#journey-pdf-close')!.onclick = () => overlay.remove()
  header.querySelector<HTMLButtonElement>('#journey-pdf-save')!.onclick = () => { iframe.contentWindow?.print() }
}
