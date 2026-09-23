import { buildElevationSvg, buildRouteMapImage, computeRouteStats, groupTracksByDate, withTimeout, type PdfGpxTrack, type RouteStats } from '../PDF/gpxDrawing'

export interface RouteImages {
  mapSrc: string | null
  elevationSrc: string | null
  /** Same aggregate figures ElevationDetail's own stats grid shows for a trip's stages. */
  stats: RouteStats
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
    if (mapSrc || elevationSrc) result.set(date, { mapSrc, elevationSrc, stats: computeRouteStats(dayTracks) })
  }))

  return result
}

/**
 * A single whole-journey map + elevation profile for the closing summary
 * spread — same shape as a per-day RouteImages, built from every track
 * handed to it rather than one day's slice. buildBook's own comment
 * explains the two situations this feeds: no track could be matched to a
 * specific day at all (nothing split "per jornada" — this is the only
 * route content the book gets), or some tracks matched a day and this is
 * built from just the leftover, unmatched ones so the closing spread adds
 * new ground instead of repeating a day that already got its own page.
 */
export async function buildOverviewRouteImages(
  tracks: PdfGpxTrack[],
  tileUrlTemplate: string,
): Promise<RouteImages | null> {
  if (!tracks.some(t => t.points.length > 0)) return null
  const mapSrc = await withTimeout(buildRouteMapImage([], tracks, tileUrlTemplate), MAP_TIMEOUT_MS).catch(() => null)
  const svg = buildElevationSvg(tracks)
  const elevationSrc = svg ? svgToDataUri(svg) : null
  if (!mapSrc && !elevationSrc) return null
  return { mapSrc, elevationSrc, stats: computeRouteStats(tracks) }
}
