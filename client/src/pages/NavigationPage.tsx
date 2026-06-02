import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import NavigationView from '../components/Navigation/NavigationView'
import type { TrackPoint } from '../hooks/useNavigation'

interface TrackMeta {
  id: number
  track_name: string
  total_distance: number
  total_elevation_gain: number
}

async function fetchTrackPoints(tripId: string, trackId: string): Promise<{ meta: TrackMeta; points: TrackPoint[] }> {
  const r = await fetch(`/api/trips/${tripId}/gpx/${trackId}/points`, { credentials: 'include' })
  if (!r.ok) throw new Error('Track not found')
  const data = await r.json()
  return {
    meta: {
      id: data.id,
      track_name: data.track_name ?? 'Track',
      total_distance: parseFloat(data.total_distance) || 0,
      total_elevation_gain: parseFloat(data.total_elevation_gain) || 0,
    },
    points: (data.points ?? []) as TrackPoint[],
  }
}

export default function NavigationPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const tripId = searchParams.get('tripId')
  const trackId = searchParams.get('trackId')

  const [trackPoints, setTrackPoints] = useState<TrackPoint[] | undefined>(undefined)
  const [trackName, setTrackName] = useState('Navegación')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId || !trackId) return
    setLoading(true)
    fetchTrackPoints(tripId, trackId)
      .then(({ meta, points }) => {
        setTrackName(meta.track_name)
        setTrackPoints(points)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [tripId, trackId])

  const handleExit = () => {
    if (tripId) navigate(`/trips/${tripId}`)
    else navigate('/dashboard')
  }

  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#0a0a14',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ width: 36, height: 36, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ color: '#64748b', fontSize: 13 }}>Cargando track…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        background: '#0a0a14',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12,
      }}>
        <span style={{ color: '#ef4444', fontSize: 14 }}>Error: {error}</span>
        <button onClick={handleExit} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>
          Volver
        </button>
      </div>
    )
  }

  return (
    <NavigationView
      trackName={trackName}
      trackPoints={trackPoints}
      tripId={tripId ? parseInt(tripId) : undefined}
      onExit={handleExit}
    />
  )
}
