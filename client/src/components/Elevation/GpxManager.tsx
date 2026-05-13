/**
 * GpxManager.tsx
 * Gestión de tracks GPX por viaje en Trek
 * Portado desde Bikelog v22 — adaptado a TypeScript + estilo Trek
 */
import React, { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, MapPin, Eye, EyeOff, Mountain, RefreshCw } from 'lucide-react'
import type { GpxTrack } from './ElevationDetail'

interface GpxManagerProps {
  tripId: number
  onTracksChange?: (tracks: GpxTrack[]) => void
}

const API_BASE = '/api'

async function apiFetch(url: string, opts: RequestInit = {}) {
  const r = await fetch(url, {
    ...opts,
    credentials: 'include',
    headers: {
      ...(opts.headers || {}),
    },
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(err.error || r.statusText)
  }
  return r.json()
}

function fmtDist(km: number): string {
  return km >= 10 ? `${Math.round(km)} km` : `${(Math.round(km * 10) / 10)} km`
}

function fmtEle(m: number | null): string {
  return m != null ? `${Math.round(m)} m` : '—'
}

export default function GpxManager({ tripId, onTracksChange }: GpxManagerProps) {
  const [tracks, setTracks]   = useState<GpxTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`${API_BASE}/trips/${tripId}/gpx`)
      setTracks(data)
      onTracksChange?.(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [tripId])

  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      setError('Solo se aceptan ficheros .gpx')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('gpx', file)
      const track = await apiFetch(`${API_BASE}/trips/${tripId}/gpx/upload`, {
        method: 'POST',
        body: fd,
      })
      const updated = [...tracks, track]
      setTracks(updated)
      onTracksChange?.(updated)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    Array.from(files).forEach(f => uploadFile(f))
  }

  const toggleActive = async (track: GpxTrack & { is_active?: number }) => {
    try {
      await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !track.is_active }),
      })
      const updated = tracks.map(t =>
        t.id === track.id ? { ...t, is_active: track.is_active ? 0 : 1 } as any : t
      )
      setTracks(updated)
      onTracksChange?.(updated)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const deleteTrack = async (trackId: number) => {
    if (!confirm('¿Eliminar este track GPX?')) return
    try {
      await apiFetch(`${API_BASE}/trips/${tripId}/gpx/${trackId}`, { method: 'DELETE' })
      const updated = tracks.filter(t => t.id !== trackId)
      setTracks(updated)
      onTracksChange?.(updated)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const TRACK_COLORS = ['#22d96e', '#38bdf8', '#f59e0b', '#a78bfa', '#f87171', '#34d399']

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
          borderRadius: 10,
          padding: '20px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          marginBottom: 14,
          background: dragOver ? 'var(--accent, #3b82f6)10' : 'var(--bg-secondary, #253547)',
          transition: 'all .15s',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".gpx"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
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
              o haz clic para seleccionar · .gpx hasta 50 MB
            </div>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, marginBottom: 10,
          background: '#ef444420', border: '1px solid #ef4444',
          fontSize: 12, color: '#ef4444',
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Track list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary, #64748b)', fontSize: 13 }}>
          Cargando tracks…
        </div>
      ) : tracks.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '20px 16px',
          color: 'var(--text-tertiary, #64748b)', fontSize: 13,
        }}>
          <Mountain size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
          <div>No hay tracks GPX para este viaje</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Sube un fichero .gpx para ver el perfil de elevación</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tracks.map((track: any, i: number) => {
            const color   = TRACK_COLORS[i % TRACK_COLORS.length]
            const active  = track.is_active !== 0
            const distKm  = parseFloat(track.total_distance) || 0
            const gain    = parseFloat(track.total_elevation_gain) || 0
            const loss    = parseFloat(track.total_elevation_loss) || 0

            return (
              <div
                key={track.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${active ? color + '50' : 'var(--border-primary, #2d3f55)'}`,
                  background: active ? color + '08' : 'var(--bg-secondary, #253547)',
                  opacity: active ? 1 : 0.55,
                  transition: 'all .15s',
                }}
              >
                {/* Color dot */}
                <div style={{
                  width: 12, height: 12, borderRadius: 4,
                  background: active ? color : '#64748b',
                  flexShrink: 0,
                }} />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600, fontSize: 13,
                    color: 'var(--text-primary, #e2e8f0)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginBottom: 2,
                  }}>
                    {track.track_name}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'var(--text-tertiary, #64748b)',
                    display: 'flex', gap: 10, flexWrap: 'wrap',
                  }}>
                    {distKm > 0 && <span><MapPin size={9} style={{ display: 'inline', marginRight: 2 }} />{fmtDist(distKm)}</span>}
                    {gain > 0   && <span style={{ color: '#f97316' }}>↑ {fmtEle(gain)}</span>}
                    {loss > 0   && <span style={{ color: '#38bdf8' }}>↓ {fmtEle(loss)}</span>}
                    {track.ibp  && <span style={{ color: '#a78bfa', fontWeight: 700 }}>IBP {track.ibp}</span>}
                    <span>{track.point_count?.toLocaleString() || 0} pts</span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    title={active ? 'Desactivar track' : 'Activar track'}
                    onClick={() => toggleActive(track)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: 4, borderRadius: 6,
                      color: active ? color : 'var(--text-tertiary, #64748b)',
                    }}
                  >
                    {active ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                  <button
                    title="Eliminar track"
                    onClick={() => deleteTrack(track.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: 4, borderRadius: 6,
                      color: 'var(--text-tertiary, #64748b)',
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
