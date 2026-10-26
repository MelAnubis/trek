// La pestaña "Excursiones" de un viaje (el espacio de Tours de liketrek/TREK v5.0.0):
// a la izquierda el planificador, en el centro el mapa, a la derecha las excursiones del viaje.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useTripStore } from '../store/tripStore'
import { useIsMobile } from '../hooks/useIsMobile'
import { addListener, removeListener } from '../api/websocket'
import { placesApi } from '../api/client'
import useToast from '../components/shared/Toast'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import type { Place } from '../types'
import TourMap, { type BaseLayer, type OtherTourLine } from './TourMap'
import TourRail, { type TripPlaceOption } from './TourRail'
import ToursSidebar, { type SummaryData } from './ToursSidebar'
import GpxImportDialog from './GpxImportDialog'
import WaysCard, { type RouteHighlight } from './ways/WaysCard'
import AlongTourCard from './poi/AlongTourCard'
import type { TourPoi } from './poi/poiSearch'
import { useTourPlanner } from './useTourPlanner'
import { toursApi, type TourDetail, type TourListItem, type TripTrack } from './toursApi'
import ActualCard from './ActualCard'
import { TOUR_TYPE_COLOR, tourPlannedTimes } from './presentation'
import { computeTourMetrics } from './core'
import { stopNameOf } from './stages'

interface Props {
  tripId: number
  canEdit: boolean
}

function parseLine(geometry: string | null | undefined): [number, number][] {
  if (!geometry) return []
  try {
    const raw = JSON.parse(geometry) as number[][]
    return Array.isArray(raw) ? raw.filter(p => Array.isArray(p) && p.length >= 2).map(p => [p[0], p[1]] as [number, number]) : []
  } catch { return [] }
}

export default function TourWorkspace({ tripId, canEdit }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const isMobile = useIsMobile()
  const places = useTripStore(s => s.places)
  const days = useTripStore(s => s.days)

  const [tours, setTours] = useState<TourListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TourDetail | null>(null)
  const [baseLayer, setBaseLayer] = useState<BaseLayer>('topo')
  const [focus, setFocus] = useState<[number, number] | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [mobilePane, setMobilePane] = useState<'list' | 'editor'>('list')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [confirm, setConfirm] = useState<null | { kind: 'delete'; tour: TourListItem } | { kind: 'discard'; then: () => void }>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [highlight, setHighlight] = useState<RouteHighlight | null>(null)
  // Plan frente a realidad: the trip's recorded tracks, and what was done of the open tour.
  const [tripTracks, setTripTracks] = useState<TripTrack[]>([])
  const [actual, setActual] = useState<{ placeId: number; points: Array<[number, number, number | null]> | null; dayIds: number[] } | null>(null)
  const [pois, setPois] = useState<TourPoi[]>([])
  const [focusedPoi, setFocusedPoi] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await toursApi.list(tripId)
      setTours(res.tours)
    } catch {
      /* the list stays as it was; the next change refreshes it */
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => { void refresh() }, [refresh])
  const refreshTracks = useCallback(() => { toursApi.tracks(tripId).then(setTripTracks).catch(() => { /* the card offers upload alone */ }) }, [tripId])
  useEffect(() => { refreshTracks() }, [refreshTracks])
  useEffect(() => {
    const fn = (event: Record<string, unknown>) => {
      const type = String(event.type ?? '')
      if (type.startsWith('tour:') || type.startsWith('assignment:') || type === 'place:deleted') void refresh()
    }
    addListener(fn)
    return () => removeListener(fn)
  }, [refresh])

  const pushPlace = useCallback(async (placeId: number, created: boolean) => {
    try {
      const res = await placesApi.get(tripId, placeId) as { place: Place }
      useTripStore.getState().handleRemoteEvent({ type: created ? 'place:created' : 'place:updated', place: res.place } as never)
    } catch { /* the plan picks it up on its next load */ }
  }, [tripId])

  const planner = useTourPlanner(tripId, (placeId, created) => {
    toast.success(t('tours.planner.saved'))
    void refresh()
    void pushPlace(placeId, created)
  })

  // A bike tour reads best on CyclOSM, a hike on the topo map.
  const type = planner.fields.tourType
  useEffect(() => {
    if (!planner.open) return
    setBaseLayer(l => (type === 'bike' && (l === 'topo' || l === 'hiking')) ? 'cycling' : (type !== 'bike' && l === 'cycling') ? 'topo' : l)
  }, [type, planner.open])

  const guardDirty = (then: () => void) => {
    if (planner.open && planner.dirty) setConfirm({ kind: 'discard', then })
    else then()
  }

  const openTour = (tour: TourListItem) => guardDirty(async () => {
    try {
      const detail = await toursApi.get(tripId, tour.place_id)
      setActual({ placeId: tour.place_id, points: detail.actual_points ?? null, dayIds: detail.days.map(d => d.day_id) })
      if (detail.waypoints.length >= 2 && canEdit) {
        setSelected(null)
        planner.openTour(detail)
        setMobilePane('editor')
      } else {
        planner.close()
        setSelected(detail)
      }
    } catch {
      toast.error(t('tours.planner.openFailed'))
    }
  })

  const startNew = () => guardDirty(() => { setSelected(null); planner.startNew('hike'); setMobilePane('editor') })
  const back = () => guardDirty(() => { planner.close(); setMobilePane('list') })

  const onImportClick = () => fileRef.current?.click()

  const tripPlaces: TripPlaceOption[] = useMemo(() => places
    .filter(p => !p.tour_type && p.lat != null && p.lng != null)
    .map(p => ({ id: p.id, name: p.name, lat: p.lat as number, lng: p.lng as number })), [places])

  const mapHint = useMemo(() => tripPlaces.map(p => [p.lat, p.lng] as [number, number]), [tripPlaces])

  const activeId = planner.open?.placeId ?? selected?.tour.place_id ?? null
  const others: OtherTourLine[] = useMemo(() => tours.flatMap(tour => {
    if (planner.open && tour.place_id === planner.open.placeId) return []
    const place = places.find(p => p.id === tour.place_id)
    const line = selected?.tour.place_id === tour.place_id && selected.route_geometry
      ? selected.route_geometry.map(p => [p[0], p[1]] as [number, number])
      : parseLine(place?.route_geometry)
    return line.length > 1 ? [{ id: tour.place_id, color: TOUR_TYPE_COLOR[tour.tour_type] ?? '#2563eb', line, selected: tour.place_id === activeId }] : []
  }), [tours, places, planner.open, selected, activeId])

  const summary: SummaryData | null = useMemo(() => {
    if (planner.open) {
      const a = planner.analysis
      return {
        type: planner.fields.tourType,
        distanceKm: a?.distanceKm ?? null,
        movingMinutes: planner.movingMinutes,
        estimated: false,
        breakMinutes: planner.fields.breakMinutes,
        plannedMinutes: planner.plannedTotal,
        minAlt: a?.minAlt ?? null,
        maxAlt: a?.maxAlt ?? null,
        gain: a?.gain ?? null,
        loss: a?.loss ?? null,
        geometry: planner.geometry,
        stages: planner.stages.map(st => ({
          number: st.number,
          fromName: stopNameOf(planner.points, st.from, n => t('tours.planner.waypointLabel', { n })),
          toName: stopNameOf(planner.points, st.to, n => t('tours.planner.waypointLabel', { n })),
          distanceKm: st.distanceKm, gain: st.gain, loss: st.loss, minutes: st.minutes, toM: st.toM,
        })),
        stageGpxUrl: planner.open.placeId && !planner.dirty ? (n: number) => `${toursApi.exportUrl(tripId, planner.open!.placeId!)}?stage=${n}` : undefined,
      }
    }
    if (selected) {
      const tour = selected.tour
      const times = tourPlannedTimes(tour)
      const geo = selected.route_geometry
      const heights = geo && geo.every(p => p.length === 3) ? geo.map(p => p[2] as number) : []
      const m = geo ? computeTourMetrics(geo) : null
      return {
        type: tour.tour_type,
        distanceKm: tour.distance ?? m?.distanceKm ?? null,
        movingMinutes: tour.duration ?? times.estimate?.minutes ?? null,
        estimated: tour.duration == null && times.estimate?.minutes != null,
        breakMinutes: tour.break_additional_minutes,
        plannedMinutes: times.plannedTotalMinutes,
        minAlt: heights.length ? Math.min(...heights) : null,
        maxAlt: heights.length ? Math.max(...heights) : null,
        gain: tour.elevation_gain,
        loss: tour.elevation_loss,
        geometry: geo,
      }
    }
    return null
  }, [planner.open, planner.analysis, planner.fields, planner.movingMinutes, planner.plannedTotal, planner.geometry, planner.stages, planner.points, planner.dirty, selected, tripId, t])

  const addToDay = async (tour: TourListItem, dayId: number) => {
    try {
      await useTripStore.getState().assignPlaceToDay(tripId, dayId, tour.place_id)
      const day = days.find(d => d.id === dayId)
      toast.success(t('tours.addedToDay', { n: day?.day_number ?? days.indexOf(day as never) + 1 }))
      void refresh()
    } catch {
      toast.error(t('common.unknownError'))
    }
  }

  const doDelete = async (tour: TourListItem) => {
    try {
      await toursApi.remove(tripId, tour.place_id)
      useTripStore.getState().handleRemoteEvent({ type: 'place:deleted', placeId: tour.place_id } as never)
      if (planner.open?.placeId === tour.place_id) planner.close()
      if (selected?.tour.place_id === tour.place_id) setSelected(null)
      void refresh()
    } catch {
      toast.error(t('common.unknownError'))
    }
  }

  const copy = async (tour: TourListItem) => {
    try {
      const res = await toursApi.copy(tripId, tour.place_id, t('tours.copy.name', { name: tour.name }))
      toast.success(t('tours.copy.saved'))
      void refresh()
      void pushPlace(res.tour.place_id, true)
    } catch { toast.error(t('tours.copy.failed')) }
  }

  const restore = async (tour: TourListItem) => {
    try {
      await toursApi.restoreRecorded(tripId, tour.place_id)
      toast.success(t('tours.recorded.restored'))
      void refresh()
      void pushPlace(tour.place_id, false)
      setSelected(await toursApi.get(tripId, tour.place_id))
    } catch { toast.error(t('tours.recorded.failed')) }
  }

  const editing = !!planner.open
  const activeTour = tours.find(x => x.place_id === (planner.open?.placeId ?? selected?.tour.place_id ?? -1)) ?? null
  const actualLine = actual && activeTour && actual.placeId === activeTour.place_id && actual.points ? actual.points.map(p => [p[0], p[1]] as [number, number]) : null
  const reloadActual = async (placeId: number) => {
    await refresh(); refreshTracks()
    try { const d = await toursApi.get(tripId, placeId); setActual({ placeId, points: d.actual_points ?? null, dayIds: d.days.map(x => x.day_id) }) } catch { /* stays as it was */ }
  }
  const actualCard = activeTour ? (
    <ActualCard
      tour={activeTour}
      planned={summary ? { distanceKm: summary.distanceKm, gain: summary.gain, loss: summary.loss, minutes: summary.plannedMinutes ?? summary.movingMinutes } : { distanceKm: activeTour.distance, gain: activeTour.elevation_gain, loss: activeTour.elevation_loss, minutes: activeTour.duration }}
      tracks={tripTracks}
      dayIds={actual?.placeId === activeTour.place_id ? actual.dayIds : []}
      canEdit={canEdit}
      onLink={async trackId => {
        const current = activeTour.actual_track?.id
        try {
          if (trackId == null && current) await toursApi.linkTrack(tripId, current, null)
          else if (trackId != null) await toursApi.linkTrack(tripId, trackId, activeTour.place_id)
          await reloadActual(activeTour.place_id)
        } catch { toast.error(t('common.unknownError')) }
      }}
      onUpload={async file => {
        try {
          const track = await toursApi.uploadTrack(tripId, file)
          await toursApi.linkTrack(tripId, track.id, activeTour.place_id)
          await reloadActual(activeTour.place_id)
        } catch { toast.error(t('tours.import.errorIn', { name: file.name })) }
      }}
    />
  ) : null
  // The settled line the cards read, the same array while it does not change.
  const routeLine = useMemo(() => planner.geometry ? planner.geometry.map(p => [p[0], p[1]] as [number, number]) : null, [planner.geometry])
  // A new or closed tour takes the places found and the map's pointing down.
  useEffect(() => { setPois([]); setFocusedPoi(null); setHighlight(null) }, [planner.open?.placeId, editing])
  const exportUrl = planner.open?.placeId ? toursApi.exportUrl(tripId, planner.open.placeId) : null

  const map = (
    <TourMap
      points={planner.points}
      parts={planner.route?.parts ?? null}
      color={TOUR_TYPE_COLOR[planner.fields.tourType]}
      others={others}
      addMode={editing && planner.addMode}
      editing={editing}
      baseLayer={baseLayer}
      onBaseLayer={setBaseLayer}
      onMapClick={(lat, lng) => planner.addPoint(lat, lng)}
      onRouteClick={(lat, lng) => planner.insertShaping(lat, lng)}
      onDragPoint={planner.movePoint}
      onSelectPoint={setSelectedPoint}
      onSelectTour={id => { const tour = tours.find(x => x.place_id === id); if (tour) openTour(tour) }}
      selectedPointId={selectedPoint}
      focus={focus}
      fitKey={`${planner.open?.placeId ?? 'none'}-${selected?.tour.place_id ?? ''}-${tours.length > 0 ? 1 : 0}-${mapHint.length > 0 ? 1 : 0}`}
      onToggleAddMode={() => planner.setAddMode(!planner.addMode)}
      hint={mapHint}
      highlight={highlight}
      actualLine={actualLine}
      pois={editing ? pois : []}
      focusedPoiId={focusedPoi}
      onPoiClick={poi => setFocusedPoi(poi.id)}
      pad={isMobile ? { left: 30, right: 30 } : { left: leftOpen ? 370 : 50, right: rightOpen ? 340 : 50 }}
    />
  )

  const rail = (
    <TourRail planner={planner} tripPlaces={tripPlaces} exportUrl={exportUrl} onBack={back} onStartNew={startNew} onImport={onImportClick} canEdit={canEdit}
      extra={editing && planner.geometry ? (
        <>
          <WaysCard route={routeLine} tourType={planner.fields.tourType} highlight={highlight?.id ?? null} onHighlight={setHighlight} />
          <AlongTourCard route={routeLine} tourType={planner.fields.tourType} pois={pois} onPois={list => { setPois(list); setFocusedPoi(null) }}
            focusedId={focusedPoi} onFocus={poi => setFocusedPoi(poi?.id ?? null)} canEdit={canEdit}
            onAdd={poi => { planner.insertStop(poi.lat, poi.lng, poi.name, poi.category); setPois(list => list.filter(x => x.id !== poi.id)); setFocusedPoi(null) }} />
        </>
      ) : null} />
  )
  const sidebar = (
    <ToursSidebar
      tours={tours} loading={loading} activeId={activeId} summary={summary} canEdit={canEdit}
      days={days.map(d => ({ id: d.id, day_number: d.day_number, date: d.date, title: d.title }))}
      onOpen={openTour} onNew={startNew} onImport={onImportClick}
      onDelete={tour => setConfirm({ kind: 'delete', tour })}
      onAddToDay={(tour, dayId) => { void addToDay(tour, dayId) }}
      onCopy={tour => { void copy(tour) }}
      onRestoreRecorded={tour => { void restore(tour) }}
      onPlanEditable={tour => {
        const line = selected?.route_geometry?.map(pt => [pt[0], pt[1]] as [number, number]) ?? []
        if (line.length < 2) return
        setSelected(null)
        planner.startFromLine(tour.name, tour.tour_type, line, tour.place_id)
        setMobilePane('editor')
      }}
      exportUrl={tour => toursApi.exportUrl(tripId, tour.place_id)}
      onProfileFocus={setFocus}
      onCloseSelection={() => setSelected(null)}
      selectedReadOnly={selected?.tour ?? null}
      afterSummary={actualCard}
    />
  )

  const panel: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-faint)', borderRadius: 18, boxShadow: 'var(--shadow-card)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }
  const toggle: React.CSSProperties = { position: 'absolute', top: 12, zIndex: 600, width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-faint)', background: 'var(--bg-card)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: 'var(--shadow-card)' }

  return (
    <div style={{ position: 'absolute', inset: 0, bottom: 'var(--bottom-nav-h)', background: 'var(--bg-secondary)' }}>
      <input ref={fileRef} type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) setImportFile(f); e.target.value = '' }} />

      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ height: '46%', minHeight: 220, position: 'relative' }}>{map}</div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderTop: '1px solid var(--border-faint)' }}>
            {editing && (
              <div style={{ display: 'flex', gap: 2, padding: 6, borderBottom: '1px solid var(--border-faint)' }}>
                {(['editor', 'list'] as const).map(p => (
                  <button key={p} type="button" onClick={() => setMobilePane(p)}
                    style={{ flex: 1, padding: '7px', borderRadius: 9, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: mobilePane === p ? 'var(--bg-tertiary)' : 'transparent', color: mobilePane === p ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {p === 'editor' ? t('tours.planner.editTitle') : t('tours.title')}
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {editing && mobilePane === 'editor' ? rail : sidebar}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', inset: 0 }}>{map}</div>
          {leftOpen ? (
            <>
              <div style={{ ...panel, position: 'absolute', zIndex: 600, top: 10, bottom: 10, left: 10, width: 330 }}>{rail}</div>
              <button type="button" onClick={() => setLeftOpen(false)} style={{ ...toggle, left: 350 }} aria-label="collapse"><PanelLeftClose size={15} /></button>
            </>
          ) : (
            <button type="button" onClick={() => setLeftOpen(true)} style={{ ...toggle, left: 12 }} aria-label="expand"><PanelLeftOpen size={15} /></button>
          )}
          {rightOpen ? (
            <>
              <div style={{ ...panel, position: 'absolute', zIndex: 600, top: 10, bottom: 10, right: 10, width: 300 }}>{sidebar}</div>
              <button type="button" onClick={() => setRightOpen(false)} style={{ ...toggle, right: 320 }} aria-label="collapse"><PanelRightClose size={15} /></button>
            </>
          ) : (
            <button type="button" onClick={() => setRightOpen(true)} style={{ ...toggle, right: 12 }} aria-label="expand"><PanelRightOpen size={15} /></button>
          )}
        </div>
      )}

      <GpxImportDialog tripId={tripId} open={!!importFile} file={importFile} onClose={() => setImportFile(null)}
        onImported={(count, asTrack) => { if (asTrack) { toast.success(t('tours.import.trackSaved')); refreshTracks(); return } toast.success(t('tours.import.success', { count })); void refresh(); void useTripStore.getState().loadTrip(tripId) }} />

      <ConfirmDialog
        isOpen={confirm?.kind === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { if (confirm?.kind === 'delete') void doDelete(confirm.tour); setConfirm(null) }}
        title={t('tours.delete.title')}
        message={t('tours.delete.confirmBody')}
        confirmLabel={t('tours.delete.confirmAction')}
        danger
      />
      <ConfirmDialog
        isOpen={confirm?.kind === 'discard'}
        onClose={() => setConfirm(null)}
        onConfirm={() => { if (confirm?.kind === 'discard') { const then = confirm.then; setConfirm(null); planner.close(); then() } }}
        title={t('tours.planner.discardTitle')}
        message={t('tours.planner.discardBody')}
        confirmLabel={t('tours.planner.discardChanges')}
        danger
      />
    </div>
  )
}
