/**
 * "Map without coverage" for navigation: downloads the map tiles along a
 * route, at the zooms used while riding, into the service worker's
 * 'nav-tiles' cache (vite.config.js), so the map keeps drawing where there
 * is no signal.
 *
 * Only a corridor along the route, not its whole bounding box: a 60 km route
 * is a few hundred tiles instead of thousands, which keeps it within what the
 * tile servers tolerate for a user-requested download. OpenStreetMap's own
 * servers forbid bulk downloads from apps, so those layers are not offered
 * (they are still cached as they are viewed).
 */
import { lngToTileX, latToTileY } from '../sync/tilePrefetcher'

/** Layers whose servers allow a route download, with their subdomains. */
const DOWNLOADABLE: Record<string, { url: string; subdomains: string[] }> = {
  topo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c'] },
  cyclosm: { url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', subdomains: ['a', 'b', 'c'] },
}

export function canDownloadLayer(layerKey: string): boolean {
  return layerKey in DOWNLOADABLE
}

/** Zooms kept for the route: overview to street level. */
const ZOOMS = [12, 13, 14, 15, 16]
/** Hard cap on tiles per download (~15 KB each → ≈ 25 MB). */
export const MAX_ROUTE_TILES = 1600
const CONCURRENCY = 4

/** The tiles a route crosses at each zoom, with one tile of margin either side. */
export function routeTiles(points: { lat: number; lng: number }[]): { z: number; x: number; y: number }[] {
  const out: { z: number; x: number; y: number }[] = []
  const seen = new Set<string>()
  for (const z of ZOOMS) {
    // Margin only where tiles are small enough for it to matter little in count.
    const margin = z >= 16 ? 0 : 1
    let lastX = -1
    let lastY = -1
    for (const p of points) {
      const x = lngToTileX(p.lng, z)
      const y = latToTileY(p.lat, z)
      if (x === lastX && y === lastY) continue
      lastX = x
      lastY = y
      for (let dx = -margin; dx <= margin; dx++) {
        for (let dy = -margin; dy <= margin; dy++) {
          const key = `${z}/${x + dx}/${y + dy}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ z, x: x + dx, y: y + dy })
        }
      }
    }
  }
  return out
}

/**
 * Downloads the route's tiles for a layer. Returns how many were fetched, or
 * null when the layer cannot be downloaded. Tiles already cached cost nothing:
 * the service worker answers them from the cache (CacheFirst).
 */
export async function downloadRouteTiles(
  points: { lat: number; lng: number }[],
  layerKey: string,
  onProgress?: (done: number, total: number) => void,
): Promise<number | null> {
  const layer = DOWNLOADABLE[layerKey]
  if (!layer) return null
  const tiles = routeTiles(points).slice(0, MAX_ROUTE_TILES)
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < tiles.length) {
      const t = tiles[next++]
      const s = layer.subdomains[(t.x + t.y) % layer.subdomains.length]
      const url = layer.url.replace('{s}', s).replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
      try { await fetch(url, { mode: 'no-cors' }) } catch { /* offline or refused: skip */ }
      done++
      onProgress?.(done, tiles.length)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return done
}
