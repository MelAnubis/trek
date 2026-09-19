import { buildElevationSvg, buildRouteMapImage, groupTracksByDate, withTimeout, type PdfGpxTrack } from '../PDF/gpxDrawing'

export interface RouteImages {
  mapSrc: string | null
  elevationSrc: string | null
}

/** btoa is latin1-only; encodeURIComponent+unescape round-trips any UTF-8 the SVG's own text (place names, etc.) might carry. */
function svgToDataUri(svg: string): string {
  const base64 = btoa(unescape(encodeURIComponent(svg)))
  return `data:image/svg+xml;base64,${base64}`
}

/** Matches JourneyBookPDF.tsx's own budget for the same per-track fetch. */
const MAP_TIMEOUT_MS = 15000

/**
 * One route-map + elevation-profile image pair per day that has a matching
 * GPX track — pre-rendered to self-contained data URIs, ready to embed as
 * `image` book elements (see BookImageElement's own comment on why they
 * must be self-contained rather than fetched live). Days with a track but
 * no actual points, or where both images fail to render, are left out.
 */
export async function buildRouteImagesByDate(
  tracks: PdfGpxTrack[],
  knownDates: string[],
  tileUrlTemplate: string,
): Promise<Map<string, RouteImages>> {
  const { byDate } = groupTracksByDate(tracks, knownDates)
  const result = new Map<string, RouteImages>()

  await Promise.all([...byDate.entries()].map(async ([date, dayTracks]) => {
    if (!dayTracks.some(t => t.points.length > 0)) return
    const mapSrc = await withTimeout(buildRouteMapImage([], dayTracks, tileUrlTemplate), MAP_TIMEOUT_MS).catch(() => null)
    const svg = buildElevationSvg(dayTracks)
    const elevationSrc = svg ? svgToDataUri(svg) : null
    if (mapSrc || elevationSrc) result.set(date, { mapSrc, elevationSrc })
  }))

  return result
}
