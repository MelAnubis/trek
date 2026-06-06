import React, { useRef, useEffect, useState as useStateImport } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Clock, Route, Zap, TrendingUp, Camera, Download, Save, X, ChevronDown } from 'lucide-react'
import type { NavStats, NavPhoto } from '../../hooks/useNavigation'
import type { RecordedPoint } from '../../services/gpxRecorderService'
import { tripsApi } from '../../api/client'

interface TripOption { id: number; title: string }

interface Props {
  trackName: string
  recordedPoints: RecordedPoint[]
  stats: NavStats
  navPhotos: NavPhoto[]
  tripId?: number
  onSaveToTrip: (name: string, tripId?: number) => Promise<void>
  onDownload: (name: string) => Promise<void>
  onDiscard: () => void
}

function fmt(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}

function fmtTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  return `${m}m ${sec.toString().padStart(2, '0')}s`
}

// ── Auto-fit map to track bounds ──────────────────────────────────────────────
function AutoFit({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length < 2) return
    try { map.fitBounds(L.latLngBounds(points), { padding: [20, 20] }) } catch { /* noop */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// ── Photo thumbnail pin on summary map ────────────────────────────────────────
function PhotoPin({ photo }: { photo: NavPhoto }) {
  const icon = L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="width:24px;height:24px;border-radius:6px;border:2px solid #22d96e;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.5)"><img src="${photo.url}" style="width:100%;height:100%;object-fit:cover"/></div>`,
  })
  return <Marker position={[photo.lat, photo.lng]} icon={icon} interactive={false} />
}

export default function NavSummary({ trackName, recordedPoints, stats, navPhotos, tripId, onSaveToTrip, onDownload, onDiscard }: Props) {
  const [name, setName] = React.useState(trackName)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [trips, setTrips] = useStateImport<TripOption[]>([])
  const [selectedTripId, setSelectedTripId] = useStateImport<number | ''>('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!tripId) {
      tripsApi.list().then((data: any) => {
        const list: TripOption[] = (data.trips ?? data ?? []).map((t: any) => ({ id: t.id, title: t.title }))
        setTrips(list)
      }).catch(() => {})
    }
  }, [tripId])

  const latlngs: [number, number][] = recordedPoints.map(p => [p.lat, p.lng])
  const center: [number, number] = latlngs.length > 0
    ? [latlngs[Math.floor(latlngs.length / 2)][0], latlngs[Math.floor(latlngs.length / 2)][1]]
    : [40.4168, -3.7038]

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveToTrip(name, tripId ?? (selectedTripId !== '' ? selectedTripId : undefined))
      setSaved(true)
    } catch { /* error handled by parent */ }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a14', zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Map preview */}
      <div style={{ flex: '0 0 220px', position: 'relative' }}>
        {latlngs.length > 1 ? (
          <MapContainer
            center={center}
            zoom={13}
            style={{ width: '100%', height: '100%' }}
            zoomControl={false}
            attributionControl={false}
            scrollWheelZoom={false}
            dragging={false}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Polyline positions={latlngs} pathOptions={{ color: '#22d96e', weight: 3, opacity: 0.9 }} />
            {navPhotos.map(p => <PhotoPin key={p.id} photo={p} />)}
            <AutoFit points={latlngs} />
          </MapContainer>
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#475569', fontSize: 13 }}>Sin puntos GPS</span>
          </div>
        )}
        {/* Title overlay */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(10,10,20,0.9))', padding: '20px 16px 12px', zIndex: 10 }}>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              color: '#f1f5f9', fontSize: 18, fontWeight: 700,
              width: '100%', outline: 'none', padding: '4px 0',
            }}
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <StatCard icon={<Route size={16} color="#22d96e" />} label="Distancia" value={fmt(stats.distanceTraveledM)} />
          <StatCard icon={<Clock size={16} color="#3b82f6" />} label="Tiempo" value={fmtTime(stats.elapsedSeconds)} />
          <StatCard icon={<Zap size={16} color="#f59e0b" />} label="Vel. media" value={`${stats.avgSpeedKmh.toFixed(1)} km/h`} />
          <StatCard icon={<TrendingUp size={16} color="#a78bfa" />} label="Desnivel +" value={`${Math.round(stats.elevationGainM)} m`} />
        </div>

        {/* Photos strip */}
        {navPhotos.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Camera size={13} /> {navPhotos.length} foto{navPhotos.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {navPhotos.map(p => (
                <img key={p.id} src={p.url} alt=""
                  style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Save to trip: direct when tripId is known, or via selector for free navigation */}
          {tripId ? (
            <button onClick={handleSave} disabled={saving || saved} style={{
              background: saved ? 'rgba(34,217,110,0.15)' : 'rgba(59,130,246,0.15)',
              border: `1px solid ${saved ? 'rgba(34,217,110,0.3)' : 'rgba(59,130,246,0.3)'}`,
              borderRadius: 12, padding: '14px 16px',
              color: saved ? '#22d96e' : '#3b82f6',
              fontWeight: 700, fontSize: 15, cursor: saving ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <Save size={18} />
              {saved ? '¡Guardado en el viaje!' : saving ? 'Guardando…' : 'Guardar en el viaje'}
            </button>
          ) : trips.length > 0 && !saved && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <select
                  value={selectedTripId}
                  onChange={e => setSelectedTripId(e.target.value === '' ? '' : Number(e.target.value))}
                  style={{
                    width: '100%', appearance: 'none', WebkitAppearance: 'none',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 10, padding: '12px 36px 12px 14px',
                    color: selectedTripId === '' ? '#64748b' : '#f1f5f9',
                    fontSize: 14, cursor: 'pointer', outline: 'none',
                  }}
                >
                  <option value="" style={{ background: '#0f172a' }}>Seleccionar viaje…</option>
                  {trips.map(t => (
                    <option key={t.id} value={t.id} style={{ background: '#0f172a' }}>{t.title}</option>
                  ))}
                </select>
                <ChevronDown size={16} color="#64748b" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
              <button
                onClick={handleSave}
                disabled={saving || selectedTripId === ''}
                style={{
                  background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: 12, padding: '14px 16px',
                  color: '#3b82f6', fontWeight: 700, fontSize: 15,
                  cursor: saving || selectedTripId === '' ? 'not-allowed' : 'pointer',
                  opacity: selectedTripId === '' ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}
              >
                <Save size={18} />
                {saving ? 'Guardando…' : 'Guardar en el viaje'}
              </button>
            </div>
          )}
          <button onClick={() => onDownload(name)} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12, padding: '14px 16px', color: '#94a3b8',
            fontWeight: 600, fontSize: 15, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Download size={18} />
            Descargar GPX
          </button>
          <button onClick={onDiscard} style={{
            background: 'none', border: 'none', color: '#475569',
            fontSize: 13, cursor: 'pointer', padding: '8px',
          }}>
            <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Descartar y salir
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {icon}
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{value}</div>
    </div>
  )
}
