/**
 * GpxManager.tsx
 * Gestión de tracks GPX por viaje en Trek
 * Con soporte para asignar tracks a días y dividir GPX largo por etapas
 */
import React, { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, MapPin, Eye, EyeOff, Mountain, RefreshCw, Scissors, Calendar } from 'lucide-react'
import type { GpxTrack } from './ElevationDetail'

interface Day {
  id: number
  title: string | null
  date: string
  day_number?: number
}

interface GpxManagerProps {
  tripId: number
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
  const [tracks, setTracks]     = useState<any[]>([])
  const [days, setDays]         = useState<Day[]>([])
  const [loading, setLoading]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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

  const splitByDays = async (trackId: number) => {
    if (!confirm('Esto dividirá el GPX en etapas según los lugares de cada día y eliminará las etapas anteriores. ¿Continuar?')) return
    setSplitting(true); setError(null)
    try {
      const result = await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${trackId}/split-by-days`, { method: 'POST' })
      setError(null)
      // Recargar todos los tracks
      await load()
      alert(result.message)
    } catch (e: any) { setError(e.message) }
    finally { setSplitting(false) }
  }

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
    <div style={{ padding: '4px 0' }}>
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent, #3b82f6)' : 'var(--border-primary, #2d3f55)'}`,
          borderRadius: 10, padding: '20px 16px', textAlign: 'center',
          cursor: 'pointer', marginBottom: 14,
          background: dragOver ? 'var(--accent, #3b82f6)10' : 'var(--bg-secondary, #253547)',
          transition: 'all .15s',
        }}
      >
        <input ref={fileRef} type="file" accept=".gpx" multiple style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)} />
        {uploading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent, #3b82f6)' }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary, #94a3b8)' }}>Procesando GPX…</span>
          </div>
        ) : (
          <>
            <Upload size={24} style={{ color: 'var(--text-tertiary, #64748b)', marginBottom: 6 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #94a3b8)', marginBottom: 3 }}>
              Arrastra un fichero GPX aquí
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary, #64748b)' }}>
              o haz clic · .gpx hasta 50 MB · puedes subir uno por etapa o uno completo del viaje
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 10,
          background: '#ef444420', border: '1px solid #ef4444', fontSize: 12, color: '#ef4444',
        }}>⚠ {error}</div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary, #64748b)', fontSize: 13 }}>
          Cargando tracks…
        </div>
      ) : tracks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 16px', color: 'var(--text-tertiary, #64748b)', fontSize: 13 }}>
          <Mountain size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No hay tracks GPX para este viaje</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            Sube un .gpx por etapa, o uno completo del viaje y divídelo automáticamente
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Tracks globales (sin día asignado) */}
          {globalTracks.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary, #64748b)',
                            letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Tracks completos del viaje
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {globalTracks.map((track, i) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    color={TRACK_COLORS[i % TRACK_COLORS.length]}
                    days={days}
                    onToggle={() => toggleActive(track)}
                    onDelete={() => deleteTrack(track.id)}
                    onAssignDay={dayId => assignDay(track, dayId)}
                    onSplit={days.length > 0 ? () => splitByDays(track.id) : undefined}
                    splitting={splitting}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Tracks por día */}
          {dayTracks.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary, #64748b)',
                            letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Etapas por día
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dayTracks.map((track, i) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    color={TRACK_COLORS[i % TRACK_COLORS.length]}
                    days={days}
                    dayLabel={getDayLabel(track.day_id)}
                    onToggle={() => toggleActive(track)}
                    onDelete={() => deleteTrack(track.id)}
                    onAssignDay={dayId => assignDay(track, dayId)}
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
function TrackRow({ track, color, days, dayLabel, onToggle, onDelete, onAssignDay, onSplit, splitting }: {
  track: any
  color: string
  days: Day[]
  dayLabel?: string
  onToggle: () => void
  onDelete: () => void
  onAssignDay: (dayId: number | null) => void
  onSplit?: () => void
  splitting?: boolean
}) {
  const active  = track.is_active !== 0
  const distKm  = parseFloat(track.total_distance) || 0
  const gain    = parseFloat(track.total_elevation_gain) || 0
  const loss    = parseFloat(track.total_elevation_loss) || 0
  const [showDayPicker, setShowDayPicker] = useState(false)

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${active ? color + '50' : 'var(--border-primary, #2d3f55)'}`,
      background: active ? color + '08' : 'var(--bg-secondary, #253547)',
      opacity: active ? 1 : 0.6,
      transition: 'all .15s',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        {/* Color dot */}
        <div style={{ width: 12, height: 12, borderRadius: 4, background: active ? color : '#64748b', flexShrink: 0 }} />

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 600, fontSize: 13, color: 'var(--text-primary, #e2e8f0)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
          }}>
            {track.track_name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary, #64748b)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {distKm > 0 && <span><MapPin size={9} style={{ display: 'inline', marginRight: 2 }} />{fmtDist(distKm)}</span>}
            {gain > 0   && <span style={{ color: '#f97316' }}>↑ {Math.round(gain)} m</span>}
            {loss > 0   && <span style={{ color: '#38bdf8' }}>↓ {Math.round(loss)} m</span>}
            {track.ibp  && <span style={{ color: '#a78bfa', fontWeight: 700 }}>IBP {track.ibp}</span>}
            {dayLabel   && <span style={{ color: color, fontWeight: 600 }}>📅 {dayLabel}</span>}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {/* Assign day */}
          <button title="Asignar a un día" onClick={() => setShowDayPicker(p => !p)}
            style={{ background: showDayPicker ? color + '30' : 'none', border: 'none', cursor: 'pointer',
                     padding: 4, borderRadius: 6, color: showDayPicker ? color : 'var(--text-tertiary, #64748b)' }}>
            <Calendar size={15} />
          </button>

          {/* Split by days */}
          {onSplit && (
            <button title="Dividir por días automáticamente" onClick={onSplit} disabled={splitting}
              style={{ background: 'none', border: 'none', cursor: splitting ? 'wait' : 'pointer',
                       padding: 4, borderRadius: 6, color: '#f59e0b' }}>
              {splitting
                ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
                : <Scissors size={15} />}
            </button>
          )}

          {/* Toggle active */}
          <button title={active ? 'Desactivar' : 'Activar'} onClick={onToggle}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
                     padding: 4, borderRadius: 6, color: active ? color : 'var(--text-tertiary, #64748b)' }}>
            {active ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>

          {/* Delete */}
          <button title="Eliminar" onClick={onDelete}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
                     padding: 4, borderRadius: 6, color: 'var(--text-tertiary, #64748b)' }}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Day picker dropdown */}
      {showDayPicker && (
        <div style={{
          borderTop: '1px solid var(--border-primary, #2d3f55)',
          padding: '8px 12px', background: 'var(--bg-tertiary, #1a2535)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary, #64748b)', marginBottom: 6, fontWeight: 600 }}>
            Asignar a día:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <button
              onClick={() => { onAssignDay(null); setShowDayPicker(false) }}
              style={{
                padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11,
                background: !track.day_id ? color : 'var(--bg-secondary, #253547)',
                color: !track.day_id ? '#fff' : 'var(--text-secondary, #94a3b8)',
              }}
            >
              Ninguno (global)
            </button>
            {days.map(day => (
              <button
                key={day.id}
                onClick={() => { onAssignDay(day.id); setShowDayPicker(false) }}
                style={{
                  padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11,
                  background: track.day_id === day.id ? color : 'var(--bg-secondary, #253547)',
                  color: track.day_id === day.id ? '#fff' : 'var(--text-secondary, #94a3b8)',
                }}
              >
                {day.title || `Día ${day.day_number || day.id}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
