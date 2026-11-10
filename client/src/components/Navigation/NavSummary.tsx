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
  tripId?: number | string
  onSaveToTrip: (name: string, tripId?: number | string) => Promise<void>
  onDownload: (name: string) => Promise<void>
  onDiscard: () => void
  /** A line under the save button, e.g. the tour the track will be linked to. */
  saveNote?: string
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

export default function NavSummary({ trackName, recordedPoints, stats, navPhotos, tripId, onSaveToTrip, onDownload, onDiscard, saveNote }: Props) {
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
    <div className="!fixed !inset-[0] ![background:#0a0a14] !z-[200] !flex !flex-col !overflow-hidden">

      {/* Map preview */}
      <div className="nav-summary-dark-tiles !flex-[0_0_220px] !relative">
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
            {/* CARTO's dark_all now refuses anonymous requests (an "API KEY REQUIRED" watermark since Aug 2026) — plain OSM tiles + a CSS invert filter (.nav-summary-dark-tiles) stand in for the dark style instead. */}
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Polyline positions={latlngs} pathOptions={{ color: '#22d96e', weight: 3, opacity: 0.9 }} />
            {navPhotos.map(p => <PhotoPin key={p.id} photo={p} />)}
            <AutoFit points={latlngs} />
          </MapContainer>
        ) : (
          <div className="!w-[100%] !h-[100%] ![background:#0f172a] !flex !items-center !justify-center">
            <span className="![color:#475569] !text-[length:13px]">Sin puntos GPS</span>
          </div>
        )}
        {/* Title overlay */}
        <div className="!absolute !bottom-[0] !left-[0] !right-[0] ![background:linear-gradient(transparent,_rgba(10,10,20,0.9))] !p-[20px_16px_12px] !z-[10]">
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
      <div className="!flex-[1] !overflow-y-auto !p-[16px]">

        {/* Stats grid */}
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[10px] !mb-[16px]">
          <StatCard icon={<Route size={16} color="#22d96e" />} label="Distancia" value={fmt(stats.distanceTraveledM)} />
          <StatCard icon={<Clock size={16} color="#3b82f6" />} label="Tiempo" value={fmtTime(stats.elapsedSeconds)} />
          <StatCard icon={<Zap size={16} color="#f59e0b" />} label="Vel. media" value={`${stats.avgSpeedKmh.toFixed(1)} km/h`} />
          <StatCard icon={<TrendingUp size={16} color="#a78bfa" />} label="Desnivel +" value={`${Math.round(stats.elevationGainM)} m`} />
        </div>

        {/* Photos strip */}
        {navPhotos.length > 0 && (
          <div className="!mb-[16px]">
            <div className="!text-[length:12px] ![color:#64748b] !font-[600] !mb-[8px] !flex !items-center !gap-[6px]">
              <Camera size={13} /> {navPhotos.length} foto{navPhotos.length !== 1 ? 's' : ''}
            </div>
            <div className="!flex !gap-[8px] !overflow-x-auto !pb-[4px]">
              {navPhotos.map(p => (
                <img className="!w-[72px] !h-[72px] !rounded-[8px] !object-cover !shrink-[0] ![border:1px_solid_rgba(255,255,255,0.1)]" key={p.id} src={p.url} alt=""
                />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="!flex !flex-col !gap-[10px]">
          {saveNote && tripId && (
            <div className="!text-[length:12px] ![color:#fdba74] ![background:rgba(249,115,22,0.1)] ![border:1px_solid_rgba(249,115,22,0.25)] !rounded-[10px] !p-[8px_12px]" data-testid="nav-save-note">{saveNote}</div>
          )}
          {/* Save to trip: direct when tripId is known, or via selector for free navigation */}
          {tripId ? (
            <button className="!rounded-[12px] !p-[14px_16px] !font-[700] !text-[length:15px] !flex !items-center !gap-[10px]" onClick={handleSave} disabled={saving || saved} style={{ background: saved ? 'rgba(34,217,110,0.15)' : 'rgba(59,130,246,0.15)', border: `1px solid ${saved ? 'rgba(34,217,110,0.3)' : 'rgba(59,130,246,0.3)'}`, color: saved ? '#22d96e' : '#3b82f6', cursor: saving ? 'wait' : 'pointer' }}>
              <Save size={18} />
              {saved ? '¡Guardado en el viaje!' : saving ? 'Guardando…' : 'Guardar en el viaje'}
            </button>
          ) : trips.length > 0 && !saved && (
            <div className="!flex !flex-col !gap-[8px]">
              <div className="!relative">
                <select className="!w-[100%] ![appearance:none] ![-webkit-appearance:none] ![background:rgba(255,255,255,0.06)] ![border:1px_solid_rgba(255,255,255,0.15)] !rounded-[10px] !p-[12px_36px_12px_14px] !text-[length:14px] !cursor-pointer ![outline:none]"
                  value={selectedTripId}
                  onChange={e => setSelectedTripId(e.target.value === '' ? '' : Number(e.target.value))}
                  style={{ color: selectedTripId === '' ? '#64748b' : '#f1f5f9' }}
                >
                  <option className="![background:#0f172a]" value="">Seleccionar viaje…</option>
                  {trips.map(t => (
                    <option className="![background:#0f172a]" key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
                <ChevronDown size={16} color="#64748b" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
              <button className="![background:rgba(59,130,246,0.15)] ![border:1px_solid_rgba(59,130,246,0.3)] !rounded-[12px] !p-[14px_16px] ![color:#3b82f6] !font-[700] !text-[length:15px] !flex !items-center !gap-[10px]"
                onClick={handleSave}
                disabled={saving || selectedTripId === ''}
                style={{ cursor: saving || selectedTripId === '' ? 'not-allowed' : 'pointer', opacity: selectedTripId === '' ? 0.5 : 1 }}
              >
                <Save size={18} />
                {saving ? 'Guardando…' : 'Guardar en el viaje'}
              </button>
            </div>
          )}
          <button className="![background:rgba(255,255,255,0.06)] ![border:1px_solid_rgba(255,255,255,0.12)] !rounded-[12px] !p-[14px_16px] ![color:#94a3b8] !font-[600] !text-[length:15px] !cursor-pointer !flex !items-center !gap-[10px]" onClick={() => onDownload(name)}>
            <Download size={18} />
            Descargar GPX
          </button>
          <button className="![background:none] ![border:none] ![color:#475569] !text-[length:13px] !cursor-pointer !p-[8px]" onClick={onDiscard}>
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
    <div className="![background:rgba(255,255,255,0.04)] ![border:1px_solid_rgba(255,255,255,0.08)] !rounded-[12px] !p-[12px_14px]">
      <div className="!flex !items-center !gap-[6px] !mb-[4px]">
        {icon}
        <span className="!text-[length:11px] ![color:#64748b] !font-[600]">{label}</span>
      </div>
      <div className="!text-[length:20px] !font-[800] ![color:#f1f5f9]">{value}</div>
    </div>
  )
}
