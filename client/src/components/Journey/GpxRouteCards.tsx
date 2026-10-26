import { useEffect, useMemo, useState } from 'react'
import { Camera, Mountain, Route as RouteIcon } from 'lucide-react'
import { buildElevationSvg, buildRouteMapImage, DEFAULT_TILE_URL, elevationGeometry, routeSeries, type PdfGpxTrack } from '../PDF/gpxDrawing'
import { useTranslation } from '../../i18n'
import { formatKm, type PlacedPhoto, type RoutePhotoInput } from './photoRoute'

interface RoutePhotosProps {
  /** Photos placed on this day's route (placePhotosOnRoute), sorted by km. */
  photos?: PlacedPhoto<RoutePhotoInput>[]
  photoSrc?: (photo: RoutePhotoInput) => string
  /** Index into `photos`. */
  onPhotoClick?: (index: number) => void
}

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
export function DayRouteCard({ tracks, tileUrl, photos = [], photoSrc, onPhotoClick }: { tracks: PdfGpxTrack[]; tileUrl?: string } & RoutePhotosProps) {
  const { t, locale } = useTranslation()
  const [mapSrc, setMapSrc] = useState<string | null>(null)

  const hasPoints = tracks.some(track => track.points.length > 0)
  const elevationSvg = useMemo(() => hasPoints ? buildElevationSvg(tracks) : '', [tracks, hasPoints])
  const totalKm = tracks.reduce((sum, track) => sum + (track.total_distance || 0), 0)
  const totalGain = tracks.reduce((sum, track) => sum + (track.total_elevation_gain || 0), 0)
  // Same geometry the profile SVG is drawn with, so the photo dots sit on its line.
  const geo = useMemo(() => hasPoints ? elevationGeometry(routeSeries(tracks)) : null, [tracks, hasPoints])
  const placeLabel = (p: PlacedPhoto<RoutePhotoInput>) => Number.isFinite(p.e)
    ? t('journey.route.photoAt', { km: formatKm(p.d, locale), ele: Math.round(p.e).toLocaleString(locale) })
    : t('journey.route.photoAtKm', { km: formatKm(p.d, locale) })
  const src = (p: PlacedPhoto<RoutePhotoInput>) => photoSrc ? photoSrc(p.photo) : `/api/photos/${p.photo.photo_id}/thumbnail`

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
        <div className="px-3 pt-2">
          <div className="relative" data-testid="day-route-profile">
            <div dangerouslySetInnerHTML={{ __html: elevationSvg }} />
            {geo && photos.map((p, i) => Number.isFinite(p.e) && (
              <button key={p.photo.photo_id} type="button" data-testid="route-photo-dot"
                title={placeLabel(p)} aria-label={placeLabel(p)}
                onClick={() => onPhotoClick?.(i)}
                className="group absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md overflow-hidden bg-zinc-200 transition-transform hover:scale-[2.2] hover:z-10 focus:scale-[2.2] focus:z-10"
                style={{ left: `${(geo.px(p.d) / geo.W) * 100}%`, top: `${(geo.py(p.e) / geo.H) * 100}%`, width: 20, height: 20, padding: 0, cursor: 'pointer' }}>
                <img src={src(p)} alt="" loading="lazy" className="w-full h-full object-cover block" />
              </button>
            ))}
          </div>
        </div>
      )}
      {(tracks.some(tr => tr.label) || tracks.some(tr => tr.planned)) && (
        <div data-testid="day-route-label" className="flex items-center gap-2 px-3 pt-2 text-[12px] font-semibold text-zinc-800 dark:text-zinc-100">
          {tracks.some(tr => tr.planned) && (
            <span className="rounded-full border border-dashed border-zinc-300 dark:border-zinc-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{t('journey.route.planned')}</span>
          )}
          <span className="truncate">{[...new Set(tracks.map(tr => tr.label).filter(Boolean))].join(' · ')}</span>
        </div>
      )}
      <div className="flex items-center gap-4 px-3 pb-2.5 pt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1"><RouteIcon size={12} /> {totalKm.toFixed(1)} {t('journey.route.km')}</span>
        <span className="flex items-center gap-1"><Mountain size={12} /> +{Math.round(totalGain)} {t('journey.route.m')}</span>
        {photos.length > 0 && <span className="flex items-center gap-1"><Camera size={12} /> {photos.length}</span>}
      </div>
      {photos.length > 0 && (
        <div data-testid="route-photo-strip" className="border-t border-zinc-100 dark:border-zinc-800 px-3 pt-2 pb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">{t('journey.route.photos')}</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((p, i) => (
              <button key={p.photo.photo_id} type="button" onClick={() => onPhotoClick?.(i)}
                title={p.by === 'time' ? t('journey.route.photoByTime') : undefined}
                className="flex-shrink-0 text-left" style={{ width: 84, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}>
                <img src={src(p)} alt="" loading="lazy" className="block rounded-lg object-cover bg-zinc-100 dark:bg-zinc-800" style={{ width: 84, height: 64 }} />
                <span data-testid="route-photo-label" className="block mt-1 text-[10px] font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{placeLabel(p)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
