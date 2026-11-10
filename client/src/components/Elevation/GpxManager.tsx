/**
 * GpxManager.tsx
 * Gestión de tracks GPX por viaje en Trek
 * Con soporte para asignar tracks a días y dividir GPX largo por etapas
 */
import React, { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, MapPin, Eye, EyeOff, Mountain, RefreshCw, Scissors, Calendar, Navigation, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { GpxTrack } from './ElevationDetail'
import GpxSplitWizard from './GpxSplitWizard'
import { toursApi } from '../../tours/toursApi'
import { useTranslation } from '../../i18n'

interface Day {
  id: number
  title: string | null
  date: string
  day_number?: number
}

interface GpxManagerProps {
  tripId: number | string
  onTracksChange?: (tracks: GpxTrack[]) => void
}

const API_BASE = '/api'
const TRACK_COLORS = ['#22d96e', '#38bdf8', '#f59e0b', '#a78bfa', '#f87171', '#34d399']

async function apiFetch(url: string, opts: RequestInit = {}) {
  const r = await fetch(url, { ...opts, credentials: 'include' })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(err.error || r.statusText)
  }
  return r.json()
}

function fmtDist(km: number): string {
  return km >= 10 ? `${Math.round(km)} km` : `${Math.round(km * 10) / 10} km`
}

export default function GpxManager({ tripId, onTracksChange }: GpxManagerProps) {
  const { t } = useTranslation()
  const [tracks, setTracks]     = useState<any[]>([])
  const [days, setDays]         = useState<Day[]>([])
  const [loading, setLoading]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [wizardTrack, setWizardTrack] = useState<any | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Plan frente a realidad: the trip's tours, so a track can say which one it is what was done of.
  const [tours, setTours] = useState<{ place_id: number; name: string }[]>([])
  const [info, setInfo] = useState<string | null>(null)
  const loadTours = () => toursApi.list(tripId).then(r => setTours(r.tours.map(x => ({ place_id: x.place_id, name: x.name })))).catch(() => setTours([]))
  useEffect(() => { void loadTours() }, [tripId]) // eslint-disable-line react-hooks/exhaustive-deps

  const linkTour = async (track: any, tourPlaceId: number | null) => {
    try {
      await toursApi.linkTrack(tripId, track.id, tourPlaceId)
      const updated = tracks.map(t => t.id === track.id ? { ...t, tour_place_id: tourPlaceId } : t)
      setTracks(updated); onTracksChange?.(updated)
    } catch (e: any) { setError(e.message) }
  }

  const toTour = async (track: any) => {
    try {
      const res = await toursApi.fromTrack(tripId, track.id)
      setInfo(t('trip.tracks.madeTour', { name: res.tour.name }))
      void loadTours()
    } catch (e: any) { setError(e.message) }
  }

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [tracksData, daysData] = await Promise.all([
        apiFetch(`${API_BASE}/trips/${tripId}/gpx`),
        apiFetch(`${API_BASE}/trips/${tripId}/days`).then((d: any) => d.days || d).catch(() => []),
      ])
      setTracks(tracksData)
      setDays(daysData)
      onTracksChange?.(tracksData)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [tripId])

  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.gpx')) { setError('Solo se aceptan ficheros .gpx'); return }
    setUploading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('gpx', file)
      const track = await apiFetch(`${API_BASE}/trips/${tripId}/gpx/upload`, { method: 'POST', body: fd })
      const updated = [...tracks, track]
      setTracks(updated)
      onTracksChange?.(updated)
    } catch (e: any) { setError(e.message) }
    finally { setUploading(false) }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    Array.from(files).forEach(f => uploadFile(f))
  }

  const toggleActive = async (track: any) => {
    try {
      await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !track.is_active }),
      })
      const updated = tracks.map(t => t.id === track.id ? { ...t, is_active: track.is_active ? 0 : 1 } : t)
      setTracks(updated); onTracksChange?.(updated)
    } catch (e: any) { setError(e.message) }
  }

  const assignDay = async (track: any, dayId: number | null) => {
    try {
      await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day_id: dayId }),
      })
      const updated = tracks.map(t => t.id === track.id ? { ...t, day_id: dayId } : t)
      setTracks(updated); onTracksChange?.(updated)
    } catch (e: any) { setError(e.message) }
  }

  const deleteTrack = async (trackId: number) => {
    if (!confirm('¿Eliminar este track GPX?')) return
    try {
      await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${trackId}`, { method: 'DELETE' })
      const updated = tracks.filter(t => t.id !== trackId)
      setTracks(updated); onTracksChange?.(updated)
    } catch (e: any) { setError(e.message) }
  }

  const splitByDays = async (trackId: number, excludeDayIds: number[]) => {
    const excludedNote = excludeDayIds.length > 0 ? ` (excluyendo ${excludeDayIds.length} día(s))` : ''
    if (!confirm(`Esto dividirá el GPX en etapas según los lugares de cada día${excludedNote} y eliminará las etapas anteriores. ¿Continuar?`)) return
    setSplitting(true); setError(null)
    try {
      const result = await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${trackId}/split-by-days`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludeDayIds }),
      })
      setError(null)
      await load()
      // eslint-disable-next-line no-console
      console.table((result.debug || []).map((d: any) => ({
        día: d.day,
        fuente: d.boundarySource,
        destino: d.boundaryName,
        'punto encontrado': `${d.matchedLatLng[0].toFixed(4)}, ${d.matchedLatLng[1].toFixed(4)}`,
        'distancia (m)': d.matchDistM,
        startIdx: d.startIdx, endIdx: d.endIdx, windowEnd: d.windowEnd,
      })))
      alert(result.message + '\n\n(Detalle de cada corte en la consola del navegador — F12 → Console)')
    } catch (e: any) { setError(e.message) }
    finally { setSplitting(false) }
  }

  const openWizard = (track: any) => setWizardTrack(track)

  // Tracks sin día asignado (globales)
  const globalTracks = tracks.filter(t => !t.day_id)
  // Tracks con día asignado
  const dayTracks = tracks.filter(t => t.day_id)

  const getDayLabel = (dayId: number) => {
    const day = days.find(d => d.id === dayId)
    if (!day) return `Día ${dayId}`
    return day.title || `Día ${day.day_number || ''} · ${day.date}`
  }

  return (
    <div className="!p-[4px_0]">
      {/* Split wizard */}
      {wizardTrack && (
        <GpxSplitWizard
          tripId={tripId}
          trackId={wizardTrack.id}
          trackName={wizardTrack.track_name}
          days={days}
          onClose={() => setWizardTrack(null)}
          onDone={() => { setWizardTrack(null); load() }}
        />
      )}

      {/* Drop zone */}
      <div className="!rounded-[10px] !p-[20px_16px] !text-center !cursor-pointer !mb-[14px] ![transition:all_.15s]"
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${dragOver ? 'var(--accent, #3b82f6)' : 'var(--border-primary, #2d3f55)'}`, background: dragOver ? 'var(--accent, #3b82f6)10' : 'var(--bg-secondary, #253547)' }}
      >
        <input ref={fileRef} type="file" accept=".gpx" multiple style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="!flex !items-center !justify-center !gap-[8px]">
            <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent, #3b82f6)' }} />
            <span className="!text-[length:13px] ![color:var(--text-secondary,_#94a3b8)]">Procesando GPX…</span>
          </div>
        ) : (
          <>
            <Upload size={24} style={{ color: 'var(--text-tertiary, #64748b)', marginBottom: 6 }} />
            <div className="!text-[length:13px] !font-[600] ![color:var(--text-secondary,_#94a3b8)] !mb-[3px]">
              Arrastra un fichero GPX aquí
            </div>
            <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)]">
              o haz clic · .gpx hasta 50 MB · puedes subir uno por etapa o uno completo del viaje
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="!p-[8px_12px] !rounded-[8px] !mb-[10px] ![background:#ef444420] ![border:1px_solid_#ef4444] !text-[length:12px] ![color:#ef4444]">⚠ {error}</div>
      )}
      {info && (
        <div className="!p-[8px_12px] !rounded-[8px] !mb-[10px] ![background:#f9731618] ![border:1px_solid_#f9731660] !text-[length:12px] ![color:var(--text-primary,_#e2e8f0)]" data-testid="tracks-info">{info}</div>
      )}

      {loading ? (
        <div className="!text-center !p-[20px] ![color:var(--text-tertiary,_#64748b)] !text-[length:13px]">
          Cargando tracks…
        </div>
      ) : tracks.length === 0 ? (
        <div className="!text-center !p-[20px_16px] ![color:var(--text-tertiary,_#64748b)] !text-[length:13px]">
          <Mountain size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No hay tracks GPX para este viaje</div>
          <div className="!text-[length:11px] !mt-[4px]">
            Sube un .gpx por etapa, o uno completo del viaje y divídelo automáticamente
          </div>
        </div>
      ) : (
        <div className="!flex !flex-col !gap-[16px]">

          {/* Tracks globales (sin día asignado) */}
          {globalTracks.length > 0 && (
            <div>
              <div className="!text-[length:11px] !font-[700] ![color:var(--text-tertiary,_#64748b)] !tracking-[1px] !uppercase !mb-[8px]">
                Tracks completos del viaje
              </div>
              <div className="!flex !flex-col !gap-[8px]">
                {globalTracks.map((track, i) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    color={TRACK_COLORS[i % TRACK_COLORS.length]}
                    days={days}
                    tripId={tripId}
                    onToggle={() => toggleActive(track)}
                    onDelete={() => deleteTrack(track.id)}
                    onAssignDay={dayId => assignDay(track, dayId)}
                    tours={tours}
                    onLinkTour={tourId => linkTour(track, tourId)}
                    onMakeTour={() => toTour(track)}
                    onSplit={days.length > 0 ? (exclude: number[]) => splitByDays(track.id, exclude) : undefined}
                    onWizard={() => openWizard(track)}
                    splitting={splitting}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Tracks por día */}
          {dayTracks.length > 0 && (
            <div>
              <div className="!text-[length:11px] !font-[700] ![color:var(--text-tertiary,_#64748b)] !tracking-[1px] !uppercase !mb-[8px]">
                Etapas por día
              </div>
              <div className="!flex !flex-col !gap-[8px]">
                {dayTracks.map((track, i) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    color={TRACK_COLORS[i % TRACK_COLORS.length]}
                    days={days}
                    dayLabel={getDayLabel(track.day_id)}
                    tripId={tripId}
                    onToggle={() => toggleActive(track)}
                    onDelete={() => deleteTrack(track.id)}
                    onAssignDay={dayId => assignDay(track, dayId)}
                    tours={tours}
                    onLinkTour={tourId => linkTour(track, tourId)}
                    onMakeTour={() => toTour(track)}
                    splitting={splitting}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ── Track row component ───────────────────────────────────────────────────────
function TrackRow({ track, color, days, dayLabel, tripId, onToggle, onDelete, onAssignDay, onSplit, onWizard, splitting, tours, onLinkTour, onMakeTour }: {
  tours: { place_id: number; name: string }[]
  onLinkTour: (tourPlaceId: number | null) => void
  onMakeTour: () => void
  track: any
  color: string
  days: Day[]
  dayLabel?: string
  tripId: number | string
  onToggle: () => void
  onDelete: () => void
  onAssignDay: (dayId: number | null) => void
  onSplit?: (excludeDayIds: number[]) => void
  onWizard?: () => void
  splitting?: boolean
}) {
  const active  = track.is_active !== 0
  const distKm  = parseFloat(track.total_distance) || 0
  const gain    = parseFloat(track.total_elevation_gain) || 0
  const loss    = parseFloat(track.total_elevation_loss) || 0
  const [showDayPicker, setShowDayPicker] = useState(false)
  const [showTourPicker, setShowTourPicker] = useState(false)
  const { t } = useTranslation()
  const linked = tours.find(x => x.place_id === track.tour_place_id)
  const [showSplitPicker, setShowSplitPicker] = useState(false)
  const [excludeDayIds, setExcludeDayIds] = useState<Set<number>>(new Set())
  const navigate = useNavigate()

  return (
    <div className="!rounded-[8px] ![transition:all_.15s] !overflow-hidden" style={{ border: `1px solid ${active ? color + '50' : 'var(--border-primary, #2d3f55)'}`, background: active ? color + '08' : 'var(--bg-secondary, #253547)', opacity: active ? 1 : 0.6 }}>
      <div className="!flex !items-center !gap-[10px] !p-[10px_12px]">
        {/* Color dot */}
        <div className="!w-[12px] !h-[12px] !rounded-[4px] !shrink-[0]" style={{ background: active ? color : '#64748b' }} />

        {/* Info */}
        <div className="!flex-[1] !min-w-[0]">
          <div className="!font-[600] !text-[length:13px] ![color:var(--text-primary,_#e2e8f0)] !overflow-hidden !text-ellipsis !whitespace-nowrap !mb-[2px]">
            {track.track_name}
          </div>
          <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !flex !gap-[10px] !flex-wrap">
            {distKm > 0 && <span><MapPin size={9} style={{ display: 'inline', marginRight: 2 }} />{fmtDist(distKm)}</span>}
            {gain > 0   && <span className="![color:#f97316]">↑ {Math.round(gain)} m</span>}
            {loss > 0   && <span className="![color:#38bdf8]">↓ {Math.round(loss)} m</span>}
            {track.ibp  && <span className="![color:#a78bfa] !font-[700]">IBP {track.ibp}</span>}
            {dayLabel   && <span className="!font-[600]" style={{ color: color }}>📅 {dayLabel}</span>}
            {linked     && <span className="![color:#f97316] !font-[600]" data-testid={`track-tour-${track.id}`}><Mountain size={9} style={{ display: 'inline', marginRight: 2 }} />{linked.name}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="!flex !gap-[2px] !shrink-[0]">
          {/* Navigate */}
          <button className="![background:none] ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] ![color:#22d96e]"
            title="Navegar siguiendo este track"
            onClick={() => navigate(`/navigate?tripId=${tripId}&trackId=${track.id}`)}
          >
            <Navigation size={15} />
          </button>

          {/* Download GPX (para pasarlo a un GPS Garmin y similares) */}
          <a className="!flex !items-center !p-[4px] !rounded-[6px] ![color:var(--text-tertiary,_#64748b)]"
            href={`${API_BASE}/trips/${tripId}/gpx/${track.id}/download`}
            title="Descargar GPX (para Garmin u otro GPS)"
          >
            <Download size={15} />
          </a>

          {/* Plan frente a realidad: the tour this track is what was done of */}
          <button className="![border:none] !cursor-pointer !p-[4px] !rounded-[6px]" title={t('trip.tracks.tourTitle')} data-testid={`track-tour-btn-${track.id}`} onClick={() => { setShowTourPicker(p => !p); setShowDayPicker(false) }}
            style={{ background: showTourPicker ? '#f9731630' : 'none', color: linked || showTourPicker ? '#f97316' : 'var(--text-tertiary, #64748b)' }}>
            <Mountain size={15} />
          </button>

          {/* Assign day */}
          <button className="![border:none] !cursor-pointer !p-[4px] !rounded-[6px]" title="Asignar a un día" onClick={() => setShowDayPicker(p => !p)}
            style={{ background: showDayPicker ? color + '30' : 'none', color: showDayPicker ? color : 'var(--text-tertiary, #64748b)' }}>
            <Calendar size={15} />
          </button>

          {/* Manual split wizard */}
          {onWizard && (
            <button className="![background:none] ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] ![color:#f59e0b]" title="Dividir en etapas manualmente" onClick={onWizard}>
              <Scissors size={15} />
            </button>
          )}

          {/* Split by days (automatic) */}
          {onSplit && (
            <button className="![border:none] !p-[4px] !rounded-[6px]" title="Dividir por días automáticamente (según lugares asignados)"
              onClick={() => { setShowSplitPicker(p => !p); setShowDayPicker(false) }} disabled={splitting}
              style={{ background: showSplitPicker ? color + '30' : 'none', cursor: splitting ? 'wait' : 'pointer', color: showSplitPicker ? color : '#64748b' }}>
              {splitting
                ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
                : <Calendar size={15} />}
            </button>
          )}

          {/* Toggle active */}
          <button className="![background:none] ![border:none] !cursor-pointer !p-[4px] !rounded-[6px]" title={active ? 'Desactivar' : 'Activar'} onClick={onToggle}
            style={{ color: active ? color : 'var(--text-tertiary, #64748b)' }}>
            {active ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>

          {/* Delete */}
          <button className="![background:none] ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] ![color:var(--text-tertiary,_#64748b)]" title="Eliminar" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {showTourPicker && (
        <div className="![border-top:1px_solid_var(--border-primary,_#2d3f55)] !p-[8px_12px] ![background:var(--bg-tertiary,_#1a2535)]">
          <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !mb-[6px] !font-[600]">{t('trip.tracks.linkTour')}</div>
          <div className="!flex !flex-wrap !gap-[4px]">
            <button className="!p-[3px_8px] !rounded-[6px] ![border:none] !cursor-pointer !text-[length:11px]" onClick={() => { onLinkTour(null); setShowTourPicker(false) }}
              style={{ background: !linked ? '#f97316' : 'var(--bg-secondary, #253547)', color: !linked ? '#fff' : 'var(--text-secondary, #94a3b8)' }}>
              {t('trip.tracks.noTour')}
            </button>
            {tours.map(tour => (
              <button className="!p-[3px_8px] !rounded-[6px] ![border:none] !cursor-pointer !text-[length:11px]" key={tour.place_id} onClick={() => { onLinkTour(tour.place_id); setShowTourPicker(false) }}
                style={{ background: linked?.place_id === tour.place_id ? '#f97316' : 'var(--bg-secondary, #253547)', color: linked?.place_id === tour.place_id ? '#fff' : 'var(--text-secondary, #94a3b8)' }}>
                {tour.name}
              </button>
            ))}
          </div>
          <button className="!mt-[8px] !p-[4px_10px] !rounded-[6px] ![border:1px_solid_var(--border-primary,_#2d3f55)] ![background:none] !cursor-pointer !text-[length:11px] ![color:var(--text-primary,_#e2e8f0)]" data-testid={`track-make-tour-${track.id}`} onClick={() => { onMakeTour(); setShowTourPicker(false) }}>
            {t('trip.tracks.makeTour')}
          </button>
        </div>
      )}

      {/* Day picker dropdown */}
      {showDayPicker && (
        <div className="![border-top:1px_solid_var(--border-primary,_#2d3f55)] !p-[8px_12px] ![background:var(--bg-tertiary,_#1a2535)]">
          <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !mb-[6px] !font-[600]">
            Asignar a día:
          </div>
          <div className="!flex !flex-wrap !gap-[4px]">
            <button className="!p-[3px_8px] !rounded-[6px] ![border:none] !cursor-pointer !text-[length:11px]"
              onClick={() => { onAssignDay(null); setShowDayPicker(false) }}
              style={{ background: !track.day_id ? color : 'var(--bg-secondary, #253547)', color: !track.day_id ? '#fff' : 'var(--text-secondary, #94a3b8)' }}
            >
              Ninguno (global)
            </button>
            {days.map(day => (
              <button className="!p-[3px_8px] !rounded-[6px] ![border:none] !cursor-pointer !text-[length:11px]"
                key={day.id}
                onClick={() => { onAssignDay(day.id); setShowDayPicker(false) }}
                style={{ background: track.day_id === day.id ? color : 'var(--bg-secondary, #253547)', color: track.day_id === day.id ? '#fff' : 'var(--text-secondary, #94a3b8)' }}
              >
                {day.title || `Día ${day.day_number || day.id}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Split-by-days picker: choose which days to leave out of the split
          (e.g. a rest day, or a day already covered by another track) */}
      {showSplitPicker && onSplit && (
        <div className="![border-top:1px_solid_var(--border-primary,_#2d3f55)] !p-[8px_12px] ![background:var(--bg-tertiary,_#1a2535)]">
          <div className="!text-[length:11px] ![color:var(--text-tertiary,_#64748b)] !mb-[6px] !font-[600]">
            Días a excluir de la división (no tendrán etapa):
          </div>
          <div className="!flex !flex-wrap !gap-[4px] !mb-[8px]">
            {days.map(day => {
              const excluded = excludeDayIds.has(day.id)
              return (
                <button className="!p-[3px_8px] !rounded-[6px] !cursor-pointer !text-[length:11px]"
                  key={day.id}
                  onClick={() => setExcludeDayIds(prev => {
                    const next = new Set(prev)
                    if (next.has(day.id)) next.delete(day.id); else next.add(day.id)
                    return next
                  })}
                  style={{ border: excluded ? '1.5px solid #ef4444' : '1.5px solid var(--border-primary, #2d3f55)', background: excluded ? '#ef444420' : 'var(--bg-secondary, #253547)', color: excluded ? '#ef4444' : 'var(--text-secondary, #94a3b8)', textDecoration: excluded ? 'line-through' : 'none' }}
                >
                  {day.title || `Día ${day.day_number || day.id}`}
                </button>
              )
            })}
          </div>
          <button className="!text-[length:11px] !font-[700] !p-[5px_10px] !rounded-[6px] ![border:none] ![color:#fff]"
            onClick={() => { onSplit(Array.from(excludeDayIds)); setShowSplitPicker(false) }}
            disabled={splitting}
            style={{ background: color, cursor: splitting ? 'wait' : 'pointer' }}
          >
            Dividir ({days.length - excludeDayIds.size} día(s))
          </button>
        </div>
      )}
    </div>
  )
}
