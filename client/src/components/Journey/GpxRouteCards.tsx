import { useEffect, useMemo, useState } from 'react'
import { Mountain, Route as RouteIcon } from 'lucide-react'
import { buildElevationSvg, buildRouteMapImage, DEFAULT_TILE_URL, type PdfGpxTrack } from '../PDF/gpxDrawing'
import { useTranslation } from '../../i18n'

/**
 * The stage map + elevation profile for a single calendar day — the same
 * drawing code JourneyBookPDF.tsx uses for its per-day route pages
 * (buildElevationSvg/buildRouteMapImage are pure functions, no PDF/print
 * dependency), now rendered live instead of into a print document.
 *
 * Renders nothing when the day has no track — "si existe" is the caller's
 * job (it only mounts this when groupTracksByDate found something for the
 * date), but an empty-points track is also guarded here just in case.
 */
export function DayRouteCard({ tracks, tileUrl }: { tracks: PdfGpxTrack[]; tileUrl?: string }) {
  const { t } = useTranslation()
  const [mapSrc, setMapSrc] = useState<string | null>(null)

  const hasPoints = tracks.some(track => track.points.length > 0)
  const elevationSvg = useMemo(() => hasPoints ? buildElevationSvg(tracks) : '', [tracks, hasPoints])
  const totalKm = tracks.reduce((sum, track) => sum + (track.total_distance || 0), 0)
  const totalGain = tracks.reduce((sum, track) => sum + (track.total_elevation_gain || 0), 0)

  useEffect(() => {
    if (!hasPoints) { setMapSrc(null); return }
    let cancelled = false
    buildRouteMapImage([], tracks, tileUrl || DEFAULT_TILE_URL, { width: 640, height: 200 })
      .then(src => { if (!cancelled) setMapSrc(src) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, tileUrl])

  if (!hasPoints) return null

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      {mapSrc && (
        <img src={mapSrc} alt="" className="w-full block" style={{ height: 140, objectFit: 'cover' }} />
      )}
      {elevationSvg && (
        <div className="px-3 pt-2" dangerouslySetInnerHTML={{ __html: elevationSvg }} />
      )}
      <div className="flex items-center gap-4 px-3 pb-2.5 pt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1"><RouteIcon size={12} /> {totalKm.toFixed(1)} {t('journey.route.km')}</span>
        <span className="flex items-center gap-1"><Mountain size={12} /> +{Math.round(totalGain)} {t('journey.route.m')}</span>
      </div>
    </div>
  )
}

/**
 * The whole-journey overview: full track, total distance/elevation — a
 * printed book's cover route page, now the fixed header of the live
 * timeline. Shown once, above the first day, whenever any track exists.
 */
export function JourneyRouteSummary({ tracks, tileUrl }: { tracks: PdfGpxTrack[]; tileUrl?: string }) {
  const { t } = useTranslation()
  const [mapSrc, setMapSrc] = useState<string | null>(null)

  const hasPoints = tracks.some(track => track.points.length > 0)
  const totalKm = tracks.reduce((sum, track) => sum + (track.total_distance || 0), 0)
  const totalGain = tracks.reduce((sum, track) => sum + (track.total_elevation_gain || 0), 0)
  const maxElevation = tracks.reduce<number | null>((max, track) =>
    track.max_elevation != null && (max == null || track.max_elevation > max) ? track.max_elevation : max, null)

  useEffect(() => {
    if (!hasPoints) { setMapSrc(null); return }
    let cancelled = false
    buildRouteMapImage([], tracks, tileUrl || DEFAULT_TILE_URL, { width: 900, height: 320 })
      .then(src => { if (!cancelled) setMapSrc(src) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, tileUrl])

  if (!hasPoints) return null

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 mb-2">
      {mapSrc
        ? <img src={mapSrc} alt="" className="w-full block" style={{ height: 220, objectFit: 'cover' }} />
        : <div className="w-full animate-pulse bg-zinc-100 dark:bg-zinc-800" style={{ height: 220 }} />}
      <div className="flex items-center gap-6 px-4 py-3 text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">
        <span className="flex items-center gap-1.5"><RouteIcon size={14} /> {totalKm.toFixed(1)} {t('journey.route.km')}</span>
        <span className="flex items-center gap-1.5"><Mountain size={14} /> +{Math.round(totalGain)} {t('journey.route.m')}</span>
        {maxElevation != null && (
          <span className="text-zinc-400 dark:text-zinc-500 font-normal text-[12px]">{t('journey.route.maxElevation', { value: Math.round(maxElevation) })}</span>
        )}
      </div>
    </div>
  )
}
