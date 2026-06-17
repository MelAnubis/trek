export interface RecordedPoint {
  lat: number
  lng: number
  alt: number | null
  speed: number | null
  timestamp: number
}

function haversineM(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000
  const dLa = (la2 - la1) * Math.PI / 180
  const dLo = (lo2 - lo1) * Math.PI / 180
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export class GpxRecorderService {
  points: RecordedPoint[] = []
  private startTime: number | null = null
  private running = false

  get isRunning() { return this.running }
  get pointCount() { return this.points.length }

  start() {
    this.points = []
    this.startTime = Date.now()
    this.running = true
  }

  stop() {
    this.running = false
  }

  addPoint(lat: number, lng: number, alt: number | null, speed: number | null, timestamp: number, accuracy?: number) {
    if (!this.running) return

    // Reject points with poor GPS signal (accuracy > 50m) — avoids initial-acquisition loops
    if (accuracy !== undefined && accuracy > 50) return

    const last = this.points[this.points.length - 1]
    if (last) {
      const dist = haversineM(last.lat, last.lng, lat, lng)
      // Skip stationary jitter: < 3m AND < 4s since last point
      if (dist < 3 && timestamp - last.timestamp < 4000) return
      // Reject GPS outlier jumps: implied speed > 60 m/s (216 km/h) is impossible on a bicycle
      const dt = (timestamp - last.timestamp) / 1000
      if (dt > 0 && dist / dt > 60) return
    }
    this.points.push({ lat, lng, alt, speed, timestamp })
  }

  totalDistanceM(): number {
    let d = 0
    for (let i = 1; i < this.points.length; i++) {
      d += haversineM(this.points[i - 1].lat, this.points[i - 1].lng, this.points[i].lat, this.points[i].lng)
    }
    return d
  }

  exportGpx(name = 'Trek Recording'): string {
    const fmt = (d: Date) => d.toISOString()
    const head = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="Trek Navigator" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <metadata>`,
      `    <name>${escapeXml(name)}</name>`,
      `    <time>${fmt(new Date(this.startTime ?? Date.now()))}</time>`,
      `  </metadata>`,
      '  <trk>',
      `    <name>${escapeXml(name)}</name>`,
      '    <trkseg>',
    ]
    const pts = this.points.map(p => {
      const alt = p.alt !== null ? `\n        <ele>${p.alt.toFixed(1)}</ele>` : ''
      const time = `\n        <time>${fmt(new Date(p.timestamp))}</time>`
      return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${alt}${time}\n      </trkpt>`
    })
    const tail = ['    </trkseg>', '  </trk>', '</gpx>']
    return [...head, ...pts, ...tail].join('\n')
  }

  async downloadGpx(name = 'Trek Recording'): Promise<void> {
    const xml = this.exportGpx(name)
    const filename = `${name.replace(/[^a-z0-9]/gi, '_')}.gpx`
    const blob = new Blob([xml], { type: 'application/gpx+xml' })

    // Android WebView silently ignores <a download> — use Web Share API when available.
    // Try sharing with files first (octet-stream for broadest Android compatibility),
    // then fall back to text-only share so the user can at least send the GPX via
    // email / Drive / etc. from the native share sheet.
    if (typeof navigator.share === 'function') {
      const shareFile = new File([blob], filename, { type: 'application/octet-stream' })
      try {
        await navigator.share({ files: [shareFile], title: name })
        return
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return // user cancelled
        // Files not supported — try sharing the raw XML as text
      }
      try {
        await navigator.share({ title: filename, text: xml })
        return
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
        // Fall through to <a download> for desktop PWA
      }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  async saveToTrip(tripId: number, name = 'Trek Recording'): Promise<void> {
    const xml = this.exportGpx(name)
    const blob = new Blob([xml], { type: 'application/gpx+xml' })
    const file = new File([blob], `${name}.gpx`, { type: 'application/gpx+xml' })
    const fd = new FormData()
    fd.append('gpx', file)
    const r = await fetch(`/api/trips/${tripId}/gpx/upload`, { method: 'POST', body: fd, credentials: 'include' })
    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      throw new Error(err.error || 'Failed to save GPX to trip')
    }
  }
}
