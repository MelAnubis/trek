import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Upload, Download, Trash2, MapPin, Plus, Scissors, Search, FolderOpen, X, Route as RouteIcon, Layers, Map as MapIcon, Sparkles, Star, FolderOpen as FolderIcon,
} from 'lucide-react'
import Navbar from '../components/Layout/Navbar'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import { useToast } from '../components/shared/Toast'
import PlannerMap, { STAGE_COLORS, type PoiMarker } from '../components/Planner/PlannerMap'
import PlannerProfile from '../components/Planner/PlannerProfile'
import RouteLibrary from '../components/Planner/RouteLibrary'
import { useTranslation } from '../i18n'
import { plannerApi } from '../api/client'
import { saveTextFile } from '../utils/saveFile'
import {
  PLANNER_CATEGORIES, CATEGORY_BY_KEY, GENERIC_WAYPOINT,
  parseRouteFile, simplifyPoints, simplifyLine, cumulativeKm, smoothElevation, routeStats, buildStages,
  autoSplit, normalizeCuts, nearestOnRoute, indexAtKm, haversineM, bookingSearchUrl, googleMapsHotelsUrl, nightOfStage, buildGpx, buildStageGpx, safeFileName, fmtKm,
  toCompact, fromCompact, newWaypointId,
  type RoutePoint, type Cut, type PlannerWaypoint, type PlannerSettings, type PlannerRouteSummary,
} from '../utils/plannerRoute'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MIN_CUT_GAP_KM = 0.3
const POI_CHUNK_KM = 80
const MAX_POI_REQUESTS = 40
const RADIUS_OPTIONS = [500, 1000, 2000]

type PanelTab = 'route' | 'stages'
type MobileView = 'panel' | 'map'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, padding: 12,
}
const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6,
}
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
  border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
}
const btnPrimary: React.CSSProperties = { ...btn, background: 'var(--accent, #e85d24)', borderColor: 'transparent', color: '#fff' }
const input: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-primary)',
  background: 'var(--bg-input, var(--bg-card))', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
}

export default function PlannerPage(): React.ReactElement {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Ruta abierta ───────────────────────────────────────────────────────────
  const [routeId, setRouteId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [points, setPoints] = useState<RoutePoint[]>([])
  const [cuts, setCuts] = useState<Cut[]>([])
  const [waypoints, setWaypoints] = useState<PlannerWaypoint[]>([])
  const [settings, setSettings] = useState<PlannerSettings>({ stageKm: 60, poiRadiusM: 1000 })

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<PanelTab>('route')
  const [mobileView, setMobileView] = useState<MobileView>('panel')
  const [activeStage, setActiveStage] = useState<number | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [addingWaypoint, setAddingWaypoint] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Biblioteca de rutas (la lista vive en <RouteLibrary>; aquí solo versión, visibilidad y metadatos)
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [folderNames, setFolderNames] = useState<string[]>([])
  const [routesTotal, setRoutesTotal] = useState(0)
  const [routeFolder, setRouteFolder] = useState<string | null>(null)
  const [routeFavorite, setRouteFavorite] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlannerRouteSummary | null>(null)

  // ── Asistente de IA ────────────────────────────────────────────────────────
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiInfo, setAiInfo] = useState<{ summary: string; warnings: string[] } | null>(null)
  const [cutsLoading, setCutsLoading] = useState(false)

  // ── Servicios (POIs) ───────────────────────────────────────────────────────
  const [cats, setCats] = useState<string[]>(['water'])
  const [scope, setScope] = useState<'stage' | 'all'>('stage')
  const [pois, setPois] = useState<PoiMarker[]>([])
  const [poiLoading, setPoiLoading] = useState(false)
  const poiAbort = useRef<AbortController | null>(null)

  const catLabel = useCallback((key: string) => t(`planner.cat.${key}`), [t])

  // ── Derivados ──────────────────────────────────────────────────────────────
  const cum = useMemo(() => cumulativeKm(points), [points])
  const smoothed = useMemo(() => smoothElevation(points, cum), [points, cum])
  const stats = useMemo(() => routeStats(smoothed, cum), [smoothed, cum])
  const stages = useMemo(() => {
    const list = buildStages(cum, smoothed, cuts, i => t('planner.stages.stageN', { n: i + 1 }))
    if (list[0] && settings.firstStageName) list[0] = { ...list[0], name: settings.firstStageName }
    return list
  }, [cum, smoothed, cuts, settings.firstStageName, t])

  // Si cambia el nº de etapas y la activa deja de existir.
  useEffect(() => {
    if (activeStage != null && activeStage >= stages.length) setActiveStage(null)
  }, [stages.length, activeStage])

  // ── Mis rutas ──────────────────────────────────────────────────────────────
  /** Pide a la biblioteca que se recargue y refresca carpetas y total (para el editor y los botones). */
  const loadSaved = useCallback(async () => {
    setLibraryVersion(v => v + 1)
    try {
      const r = await plannerApi.list({ limit: 1 })
      setFolderNames(r.folders.map(f => f.name))
      setRoutesTotal(r.totals.all)
    } catch { /* sin metadatos: el editor funciona igual */ }
  }, [])

  useEffect(() => { loadSaved() }, [loadSaved])

  const openRoute = useCallback(async (id: number, updateUrl = true) => {
    try {
      const { route } = await plannerApi.get(id)
      setRouteId(route.id)
      setName(route.name)
      setPoints(fromCompact(route.points))
      setCuts(route.cuts ?? [])
      setWaypoints(route.waypoints ?? [])
      setSettings({ stageKm: 60, poiRadiusM: 1000, ...(route.settings ?? {}) })
      setRouteFolder(route.folder ?? null)
      setRouteFavorite(!!route.favorite)
      setLibraryOpen(false)
      setPois([])
      setActiveStage(null)
      setAddingWaypoint(false)
      setSaveState('saved')
      dirtyRef.current = false
      if (updateUrl) setSearchParams({ id: String(route.id) }, { replace: true })
      setMobileView('map')
    } catch {
      toast.error(t('planner.mine.loadError'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSearchParams, t])

  const urlId = searchParams.get('id')
  const openedFromUrl = useRef(false)
  useEffect(() => {
    if (openedFromUrl.current || !urlId) return
    openedFromUrl.current = true
    const id = parseInt(urlId, 10)
    if (Number.isFinite(id)) openRoute(id, false)
  }, [urlId, openRoute])

  // ── Autoguardado ───────────────────────────────────────────────────────────
  const dirtyRef = useRef(false)
  const markDirty = useCallback(() => { dirtyRef.current = true }, [])

  useEffect(() => {
    if (routeId == null || !dirtyRef.current) return
    const handle = setTimeout(async () => {
      setSaveState('saving')
      try {
        await plannerApi.update(routeId, { name: name.trim() || t('planner.untitled'), cuts, waypoints, settings })
        dirtyRef.current = false
        setSaveState('saved')
        loadSaved()
      } catch {
        setSaveState('error')
      }
    }, 1200)
    return () => clearTimeout(handle)
  }, [routeId, name, cuts, waypoints, settings, loadSaved, t])

  // ── Crear (importando o con IA) ────────────────────────────────────────────
  /** Guarda una ruta nueva en la cuenta y la abre. `stageKm` activa la división automática. */
  const createAndOpen = useCallback(async (o: {
    name: string; origName: string; pts: RoutePoint[]; wps: PlannerWaypoint[]; stageKm?: number | null
    /** Cortes de etapa en km de recorrido (p. ej. junto a alojamientos). Tienen prioridad sobre stageKm. */
    cutKm?: { km: number; lodged?: boolean; shiftKm?: number }[] | null
  }) => {
    const c = cumulativeKm(o.pts)
    const st = routeStats(smoothElevation(o.pts, c), c)
    const stageKm = o.stageKm && o.stageKm > 0 ? Math.round(o.stageKm) : null
    const newSettings: PlannerSettings = { stageKm: stageKm ?? 60, poiRadiusM: 1000 }
    const newCuts = o.cutKm && o.cutKm.length
      ? normalizeCuts(o.cutKm.map(k => ({ index: indexAtKm(c, k.km), lodged: k.lodged, shiftKm: k.shiftKm })), o.pts.length)
      : stageKm ? autoSplit(c, stageKm) : []

    setSaveState('saving')
    const { route } = await plannerApi.create({
      name: o.name, orig_name: o.origName, points: toCompact(o.pts), cuts: newCuts, waypoints: o.wps, settings: newSettings,
      total_distance_km: Math.round(st.distKm * 100) / 100, elevation_gain: st.gain, elevation_loss: st.loss,
    })
    dirtyRef.current = false
    setRouteId(route.id)
    setName(route.name)
    setPoints(o.pts)
    setCuts(newCuts)
    setWaypoints(o.wps)
    setSettings(newSettings)
    setRouteFolder(null)
    setRouteFavorite(false)
    setLibraryOpen(false)
    setPois([])
    setActiveStage(null)
    setSaveState('saved')
    setSearchParams({ id: String(route.id) }, { replace: true })
    setMobileView('map')
    loadSaved()
  }, [loadSaved, setSearchParams])

  const importFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_BYTES) { toast.error(t('planner.upload.tooBig')); return }
    setReading(true)
    try {
      const text = await file.text()
      // Cede el hilo para que se pinte el estado "leyendo".
      await new Promise(r => setTimeout(r, 0))
      const parsed = parseRouteFile(text, file.name)
      if (parsed.points.length < 2) { toast.error(t('planner.upload.noPoints')); return }
      setAiInfo(null)
      await createAndOpen({
        name: (parsed.name || file.name.replace(/\.[^.]+$/, '')).slice(0, 160),
        origName: file.name,
        pts: simplifyPoints(parsed.points),
        wps: parsed.waypoints.slice(0, 500),
      })
    } catch (err) {
      setSaveState('idle')
      const code = err instanceof Error ? err.message : ''
      const status = (err as { response?: { status?: number } })?.response?.status
      if (code === 'invalid-xml' || code === 'unsupported-format') toast.error(t('planner.upload.error'))
      else if (status === 413) toast.error(t('planner.upload.tooBig'))
      else toast.error(t('planner.save.error'))
    } finally {
      setReading(false)
    }
  }, [createAndOpen, t, toast])

  const generateWithAI = async () => {
    const prompt = aiPrompt.trim()
    if (prompt.length < 8 || aiLoading) return
    setAiLoading(true)
    try {
      const res = await plannerApi.assistant(prompt, locale)
      const pts = simplifyPoints(res.points.map(p => ({ lat: p[0], lng: p[1], ele: p[2] })))
      const wps: PlannerWaypoint[] = res.waypoints.map(w => ({
        id: newWaypointId(), name: w.name, lat: w.lat, lng: w.lng, ele: null, type: 'generic',
      }))
      // km por etapa: el que pidió el usuario o, si dio solo los días, distancia / días.
      const stageKm = res.plan.kmPerDay ?? (res.plan.days ? res.distanceKm / res.plan.days : null)
      await createAndOpen({
        name: res.plan.name || t('planner.untitled'), origName: 'IA', pts, wps, stageKm,
        cutKm: res.stageEnds,
      })
      setAiInfo({ summary: res.plan.summary, warnings: res.warnings })
      setAiPrompt('')
    } catch (err) {
      setSaveState('idle')
      const e = err as { response?: { status?: number; data?: { code?: string } } }
      const code = e.response?.data?.code
      const status = e.response?.status
      if (code === 'NO_AI_KEY' || status === 503) toast.error(t('planner.ai.error.noKey'))
      else if (code === 'NO_PLAN') toast.error(t('planner.ai.error.noPlan'))
      else if (code === 'GEOCODE_FAILED') toast.error(t('planner.ai.error.geocode'))
      else if (code === 'TOO_LONG') toast.error(t('planner.ai.error.tooLong'))
      else if (code === 'DISCONTINUOUS') toast.error(t('planner.ai.error.discontinuous'))
      else if (status === 429) toast.error(t('planner.ai.error.rate'))
      else if (status === 422) toast.error(t('planner.ai.error.noRoute'))
      else toast.error(t('planner.ai.error.generic'))
    } finally {
      setAiLoading(false)
    }
  }

  const onFiles = (files: FileList | null) => {
    const f = files?.[0]
    if (f) importFile(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  const closeRoute = () => {
    setRouteId(null); setName(''); setPoints([]); setCuts([]); setWaypoints([]); setPois([])
    setActiveStage(null); setAddingWaypoint(false); setSaveState('idle'); dirtyRef.current = false; setAiInfo(null)
    setLibraryOpen(false); setRouteFolder(null); setRouteFavorite(false)
    setSearchParams({}, { replace: true })
    setMobileView('panel')
    loadSaved()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      await plannerApi.remove(target.id)
      if (target.id === routeId) closeRoute()
      else loadSaved()
    } catch { toast.error(t('planner.save.error')) }
  }

  // ── Organizar la ruta abierta (carpeta / favorita) ──────────────────────────
  const setFavorite = async (fav: boolean) => {
    if (routeId == null) return
    setRouteFavorite(fav)
    try { await plannerApi.update(routeId, { favorite: fav }); loadSaved() } catch { setRouteFavorite(!fav); toast.error(t('planner.save.error')) }
  }

  const setFolder = async (value: string) => {
    if (routeId == null) return
    const next = value.trim() || null
    if (next === routeFolder) return
    const prev = routeFolder
    setRouteFolder(next)
    try { await plannerApi.update(routeId, { folder: next }); loadSaved() } catch { setRouteFolder(prev); toast.error(t('planner.save.error')) }
  }

  // ── Etapas ─────────────────────────────────────────────────────────────────
  const updateCuts = (next: Cut[]) => { markDirty(); setCuts(normalizeCuts(next, points.length)) }

  const addCutAt = useCallback((idx: number, meta?: { lodged?: boolean }): boolean => {
    if (idx <= 0 || idx >= points.length - 1) return false
    const km = cum[idx]
    const bounds = [0, ...cuts.map(c => cum[c.index]), cum[cum.length - 1]]
    if (bounds.some(b => Math.abs(b - km) < MIN_CUT_GAP_KM)) return false
    markDirty()
    setCuts(prev => normalizeCuts([...prev, { index: idx, ...(meta?.lodged !== undefined ? { lodged: meta.lodged } : {}) }], points.length))
    return true
  }, [points.length, cum, cuts, markDirty])

  /** Aplica cortes calculados por el servidor (en poblaciones con alojamiento) y avisa de lo que no se pudo. */
  const shiftLabel = (km?: number): string =>
    km != null && Math.abs(km) >= 0.5 ? ` (${km > 0 ? '+' : '−'}${Math.abs(km).toFixed(1).replace('.', ',')} km)` : ''

  const applyLodgingCuts = (res: Awaited<ReturnType<typeof plannerApi.smartCuts>>, keepNames: boolean) => {
    const next: Cut[] = res.cuts.map((c, i) => ({
      index: c.index, lodged: c.lodged, shiftKm: c.shiftKm, ...(c.unchecked ? { unchecked: true } : {}), ...(c.town ? { town: true } : {}), ...(c.place ? { place: c.place } : {}), ...(c.source ? { source: c.source } : {}),
      ...(keepNames && cuts.length === res.cuts.length && cuts[i].name ? { name: cuts[i].name } : {}),
    }))
    markDirty()
    setCuts(normalizeCuts(next, points.length))
    setActiveStage(null)
    if (!res.lodgingChecked) toast.warning(t('planner.stages.cuts.noData'))
    else {
      const unchecked = res.cuts.filter(c => c.unchecked && !c.town).length
      const inTown = res.cuts.filter(c => c.town).length
      const without = res.cuts.filter(c => !c.lodged && !c.town && !c.unchecked).length
      if (unchecked) toast.warning(t('planner.stages.cuts.unchecked', { n: unchecked }))
      if (inTown) toast.info(t('planner.stages.cuts.inTown', { n: inTown }))
      if (without) toast.info(t('planner.stages.cuts.someWithout', { n: without }))
      // Sin alojamiento en OpenStreetMap: se explica por qué Google no ayudó (sin clave / no responde) en vez de dejarlo en silencio.
      const missing = res.cuts.filter(c => !c.lodged).length
      if (missing && res.sources?.google === 'no-key') toast.info(t('planner.stages.cuts.noGoogleKey', { n: missing }))
      else if (res.sources?.google === 'failed') toast.warning(t('planner.stages.cuts.googleFailed'))
    }
  }

  const runAutoSplit = async () => {
    const km = settings.stageKm ?? 60
    if (cutsLoading) return
    setSettings(s => ({ ...s, firstStageName: undefined }))
    if (routeId == null) { markDirty(); setCuts(autoSplit(cum, km)); setActiveStage(null); return }
    setCutsLoading(true)
    try {
      applyLodgingCuts(await plannerApi.smartCuts(routeId, { stageKm: km }), false)
    } catch {
      // Sin servidor o sin datos: reparto por igual, avisando de que no están ajustados a alojamientos.
      markDirty(); setCuts(autoSplit(cum, km)); setActiveStage(null)
      toast.warning(t('planner.stages.cuts.noData'))
    } finally {
      setCutsLoading(false)
    }
  }

  /** Mueve los cortes que ya hay (también los manuales) al alojamiento más cercano, hasta ~7 km. */
  const snapCutsToLodging = async () => {
    if (routeId == null || !cuts.length || cutsLoading) return
    setCutsLoading(true)
    try {
      applyLodgingCuts(await plannerApi.smartCuts(routeId, { marks: normalizeCuts(cuts, points.length).map(c => cum[c.index]) }), true)
    } catch {
      toast.error(t('planner.stages.cuts.error'))
    } finally {
      setCutsLoading(false)
    }
  }

  const mergeWithPrevious = (stageIdx: number) => {
    if (stageIdx <= 0) return
    const idx = stages[stageIdx].from
    updateCuts(cuts.filter(c => c.index !== idx))
  }

  const renameStage = (stageIdx: number, newName: string) => {
    markDirty()
    if (stageIdx === 0) { setSettings(s => ({ ...s, firstStageName: newName.trim() || undefined })); return }
    const idx = stages[stageIdx].from
    setCuts(prev => prev.map(c => (c.index === idx ? { ...c, name: newName.trim() || undefined } : c)))
  }

  const onProfileClick = (idx: number) => {
    if (tab === 'stages') {
      if (!addCutAt(idx)) toast.info(t('planner.stages.cutTooClose'))
      return
    }
    const si = stages.findIndex((s, i) => idx >= s.from && (i === stages.length - 1 ? idx <= s.to : idx < s.to))
    if (si >= 0) { setActiveStage(si); setTab('stages') }
  }

  // ── Waypoints ──────────────────────────────────────────────────────────────
  const addWaypointAt = (lat: number, lng: number) => {
    markDirty()
    setWaypoints(prev => [...prev, { id: newWaypointId(), name: '', lat, lng, ele: null, type: 'generic' }])
    setAddingWaypoint(false)
  }

  const renameWaypoint = (id: string, newName: string) => {
    markDirty()
    setWaypoints(prev => prev.map(w => (w.id === id ? { ...w, name: newName } : w)))
  }

  const removeWaypoint = (id: string) => {
    markDirty()
    setWaypoints(prev => prev.filter(w => w.id !== id))
  }

  const addPoiAsWaypoint = (p: PoiMarker) => {
    if (waypoints.some(w => w.osm_id === p.osm_id)) return
    markDirty()
    setWaypoints(prev => [...prev, {
      id: newWaypointId(), name: p.name, lat: p.lat, lng: p.lng, ele: null, type: p.category, osm_id: p.osm_id,
    }])
  }

  const cutAtPoi = (p: PoiMarker) => {
    const near = nearestOnRoute(points, cum, p.lat, p.lng)
    // Un alojamiento (hotel, camping, casa rural…) como fin de etapa cuenta como corte con alojamiento.
    const sleeps = p.category === 'hotel' || p.category === 'camping' || p.category === 'lodging'
    if (!addCutAt(near.index, sleeps ? { lodged: true } : undefined)) toast.info(t('planner.stages.cutTooClose'))
  }

  // ── Búsqueda de servicios ──────────────────────────────────────────────────
  const searchServices = async () => {
    if (!cats.length) { toast.info(t('planner.services.pickCat')); return }
    const range = scope === 'stage' && activeStage != null
      ? { from: stages[activeStage].from, to: stages[activeStage].to }
      : { from: 0, to: points.length - 1 }
    const radius = settings.poiRadiusM ?? 1000

    // Trocea el tramo en bloques de ~80 km para no pedir corredores enormes a Overpass.
    const chunks: [number, number][] = []
    let a = range.from
    while (a < range.to) {
      const b = Math.max(a + 1, Math.min(range.to, indexAtKm(cum, cum[a] + POI_CHUNK_KM)))
      chunks.push([a, b])
      a = b
    }
    if (chunks.length * cats.length > MAX_POI_REQUESTS) { toast.warning(t('planner.services.tooMany')); return }

    poiAbort.current?.abort()
    const ctrl = new AbortController()
    poiAbort.current = ctrl
    setPoiLoading(true)
    try {
      const found = new Map<string, PoiMarker>()
      let anyTruncated = false
      let anyPartial = false
      let anyFallback = false
      let lastDetail = ''
      let failed = 0
      for (const cat of cats) {
        for (const [from, to] of chunks) {
          try {
            const line = simplifyLine(points.slice(from, to + 1), 300)
            const res = await plannerApi.poisAlongRoute(cat === 'hotel' ? 'lodging' : cat, line, radius, ctrl.signal)
            if (res.truncated) anyTruncated = true
            if (res.partial) anyPartial = true
            if (res.fallback) anyFallback = true
            for (const p of res.pois) {
              if (found.has(p.osm_id)) continue
              const near = nearestOnRoute(points, cum, p.lat, p.lng)
              if (near.distM > radius * 1.2 + 50) continue
              found.set(p.osm_id, {
                osm_id: p.osm_id, name: p.name, lat: p.lat, lng: p.lng, category: cat, km: near.km, offM: near.distM,
              })
            }
          } catch (err) {
            if (ctrl.signal.aborted) return
            failed++
            const d = (err as { response?: { data?: { detail?: string[] } } })?.response?.data?.detail
            if (d?.length && !lastDetail) lastDetail = d.slice(0, 2).join(' · ')
          }
        }
      }
      setPois(prev => {
        const merged = new Map(prev.map(p => [p.osm_id, p]))
        found.forEach((v, k) => merged.set(k, v))
        return [...merged.values()].sort((x, y) => x.km - y.km)
      })
      if (failed && !found.size) toast.error(lastDetail ? `${t('planner.services.error')} (${lastDetail})` : t('planner.services.error'))
      else if (!found.size) toast.info(t('planner.services.none'))
      else if (anyPartial) toast.warning(t('planner.services.partial'))
      else if (anyFallback) toast.info(t('planner.services.fallback'))
      else if (anyTruncated) toast.info(t('planner.services.truncated'))
    } finally {
      if (poiAbort.current === ctrl) setPoiLoading(false)
    }
  }

  useEffect(() => () => poiAbort.current?.abort(), [])

  // POIs visibles: los que aún no son waypoints.
  const visiblePois = useMemo(() => {
    const taken = new Set(waypoints.map(w => w.osm_id).filter(Boolean))
    return pois.filter(p => !taken.has(p.osm_id))
  }, [pois, waypoints])

  const poisForList = useMemo(() => {
    if (scope === 'stage' && activeStage != null && stages[activeStage]) {
      const st = stages[activeStage]
      return visiblePois.filter(p => p.km >= st.startKm - 0.05 && p.km <= st.endKm + 0.05)
    }
    return visiblePois
  }, [visiblePois, scope, activeStage, stages])

  // ── Descargas ──────────────────────────────────────────────────────────────
  const downloadRoute = async () => {
    const xml = buildGpx({ name: name || t('planner.untitled'), points, waypoints })
    await saveTextFile(`${safeFileName(name)}.gpx`, xml)
  }

  const downloadStage = async (i: number) => {
    const xml = buildStageGpx(name || t('planner.untitled'), points, cum, stages, i, waypoints)
    await saveTextFile(`${safeFileName(name)}_${String(i + 1).padStart(2, '0')}_${safeFileName(stages[i].name)}.gpx`, xml)
  }

  const downloadAllStages = async () => {
    for (let i = 0; i < stages.length; i++) {
      await downloadStage(i)
      await new Promise(r => setTimeout(r, 350))
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const hasRoute = points.length > 1
  const showLibrary = libraryOpen || !hasRoute
  const uploadBox = (
    <div className="!text-center !p-[24px] !cursor-pointer"
      style={{ ...card, border: `2px dashed ${dragOver ? 'var(--accent, #e85d24)' : 'var(--border-primary)'}` }}
      onClick={() => fileRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
    >
      <Upload size={28} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
      <div className="!text-[length:14px] !font-[700] ![color:var(--text-primary)]">{reading ? t('planner.upload.reading') : t('planner.upload.title')}</div>
      <div className="!text-[length:12px] ![color:var(--text-muted)] !m-[4px_0_12px]">{t('planner.upload.hint')}</div>
      <span style={btnPrimary}>{t('planner.upload.choose')}</span>
    </div>
  )

  const aiBox = (
    <div style={card}>
      <div className="!flex !items-center !gap-[6px] !mb-[6px]">
        <Sparkles size={15} style={{ color: 'var(--accent, #e85d24)' }} />
        <div style={label}>{t('planner.ai.title')}</div>
      </div>
      <textarea className="!min-h-[78px] ![resize:vertical] ![font-family:inherit]" style={{ ...input }} maxLength={1500}
        value={aiPrompt} disabled={aiLoading} placeholder={t('planner.ai.placeholder')}
        onChange={e => setAiPrompt(e.target.value)} />
      <button className="!mt-[8px]" type="button" style={{ ...btnPrimary, opacity: aiLoading || aiPrompt.trim().length < 8 ? 0.6 : 1 }}
        disabled={aiLoading || aiPrompt.trim().length < 8} onClick={generateWithAI}>
        <Sparkles size={15} />{aiLoading ? t('planner.ai.generating') : t('planner.ai.generate')}
      </button>
      <div className="!text-[length:11px] ![color:var(--text-muted)] !mt-[8px]">{t('planner.ai.disclaimer')}</div>
    </div>
  )

  const warningText = (kind: string, detail: string): string => {
    switch (kind) {
      case 'unresolved': return t('planner.ai.warn.unresolved', { list: detail })
      case 'merged': return t('planner.ai.warn.merged', { list: detail })
      case 'outliers': return t('planner.ai.warn.outliers', { list: detail })
      case 'detour': return t('planner.ai.warn.detour', { ratio: detail })
      case 'offtrack': return t('planner.ai.warn.offtrack', { list: detail })
      case 'nolodging': return t('planner.ai.warn.nolodging', { stages: detail })
      case 'nolodgingdata': return t('planner.ai.warn.nolodgingdata')
      case 'googlefailed': return t('planner.ai.warn.googlefailed')
      case 'towncut': return t('planner.ai.warn.towncut', { list: detail })
      case 'lodgingunchecked': return t('planner.ai.warn.lodgingunchecked', { stages: detail })
      case 'detourstop': return t('planner.ai.warn.detourstop', { list: detail })
      case 'droppedstop': return t('planner.ai.warn.droppedstop', { list: detail })
      case 'retrace': return t('planner.ai.warn.retrace', { km: detail })
      case 'farlodging': return t('planner.ai.warn.farlodging', { list: detail })
      case 'badleg': return t('planner.ai.warn.badleg', { list: detail })
      default: return detail || kind
    }
  }

  const aiInfoBox = aiInfo && (
    <div className="![border-color:var(--accent,_#e85d24)]" style={{ ...card }}>
      <div className="!flex !items-center !gap-[6px] !mb-[4px]">
        <Sparkles size={14} style={{ color: 'var(--accent, #e85d24)' }} />
        <div className="!flex-[1]" style={{ ...label }}>{t('planner.ai.result')}</div>
        <button className="!p-[3px] ![border:none] ![background:transparent]" type="button" aria-label={t('common.close')} style={{ ...btn }}
          onClick={() => setAiInfo(null)}><X size={14} /></button>
      </div>
      {aiInfo.summary && <div className="!text-[length:13px] ![color:var(--text-primary)]">{aiInfo.summary}</div>}
      {aiInfo.warnings.map(w => {
        const [kind, ...rest] = w.split(':')
        const detail = rest.join(':')
        return (
          <div className="!text-[length:12px] ![color:#b45309] !mt-[6px]" key={w}>
            ⚠️ {warningText(kind, detail)}
          </div>
        )
      })}
      <div className="!text-[length:11px] ![color:var(--text-muted)] !mt-[6px]">{t('planner.ai.reviewHint')}</div>
    </div>
  )

  const statBox = (k: string, v: string) => (
    <div className="![background:var(--bg-secondary)] !rounded-[8px] !p-[6px_8px]">
      <div className="!text-[length:10px] ![color:var(--text-muted)] !uppercase !tracking-[0.5px]">{k}</div>
      <div className="!text-[length:15px] !font-[700] ![color:var(--text-primary)]">{v}</div>
    </div>
  )

  const routePanel = !hasRoute ? (
    <div className="!flex !flex-col !gap-[12px]">
      {aiBox}{uploadBox}
      {routesTotal > 0 && (
        <button type="button" className="lg:hidden" style={btn} onClick={() => setMobileView('map')}>
          <FolderIcon size={15} />{t('planner.lib.openLibrary', { n: routesTotal })}
        </button>
      )}
    </div>
  ) : (
    <div className="!flex !flex-col !gap-[12px]">
      {aiInfoBox}
      <div style={card}>
        <div className="!mb-[6px]" style={{ ...label }}>{t('planner.name')}</div>
        <input style={input} value={name} maxLength={160}
          onChange={e => { markDirty(); setName(e.target.value) }} />
        <div className="!flex !gap-[6px] !mt-[8px]">
          <input className="!flex-[1] !min-w-[0]" key={`${routeId}-${routeFolder ?? ''}`} style={{ ...input }} list="planner-folders" maxLength={60}
            defaultValue={routeFolder ?? ''} placeholder={t('planner.lib.folder.field')}
            onBlur={e => setFolder(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          <datalist id="planner-folders">{folderNames.map(n => <option key={n} value={n} />)}</datalist>
          <button className="!p-[6px_9px]" type="button" aria-pressed={routeFavorite} title={t('planner.lib.favorite')} aria-label={t('planner.lib.favorite')}
            style={{ ...btn }} onClick={() => setFavorite(!routeFavorite)}>
            <Star size={16} fill={routeFavorite ? '#f59e0b' : 'none'} style={{ color: routeFavorite ? '#f59e0b' : 'var(--text-muted)' }} />
          </button>
        </div>
        <div className="!grid ![grid-template-columns:repeat(3,_1fr)] !gap-[6px] !mt-[10px]">
          {statBox(t('planner.stats.distance'), fmtKm(stats.distKm))}
          {statBox(t('planner.stats.gain'), `+${stats.gain} m`)}
          {statBox(t('planner.stats.loss'), `−${stats.loss} m`)}
          {statBox(t('planner.stats.min'), stats.minEle != null ? `${stats.minEle} m` : '—')}
          {statBox(t('planner.stats.max'), stats.maxEle != null ? `${stats.maxEle} m` : '—')}
          {statBox(t('planner.stats.stages'), String(stages.length))}
        </div>
        <div className="!flex !flex-wrap !gap-[8px] !mt-[10px]">
          <button type="button" style={btnPrimary} onClick={downloadRoute}><Download size={15} />{t('planner.download.route')}</button>
          <button type="button" style={btn} onClick={closeRoute}><X size={15} />{t('planner.closeRoute')}</button>
        </div>
        <div className="!text-[length:11px] !mt-[8px]" style={{ color: saveState === 'error' ? '#dc2626' : 'var(--text-muted)' }}>
          {saveState === 'saving' ? t('planner.save.saving') : saveState === 'saved' ? t('planner.save.saved') : saveState === 'error' ? t('planner.save.error') : ''}
        </div>
      </div>

      <div style={card}>
        <div className="!flex !items-center !justify-between !mb-[8px]">
          <div style={label}>{t('planner.waypoints')} ({waypoints.length})</div>
          <button type="button" style={addingWaypoint ? btnPrimary : btn}
            onClick={() => { setAddingWaypoint(a => !a); setMobileView('map') }}>
            <MapPin size={14} />{addingWaypoint ? t('planner.waypoints.adding') : t('planner.waypoints.add')}
          </button>
        </div>
        {waypoints.length === 0 ? (
          <div className="!text-[length:12px] ![color:var(--text-muted)]">{t('planner.waypoints.empty')}</div>
        ) : (
          <div className="!flex !flex-col !gap-[6px]">
            {waypoints.map(w => {
              const cat = CATEGORY_BY_KEY[w.type]
              const near = nearestOnRoute(points, cum, w.lat, w.lng)
              return (
                <div className="!flex !items-center !gap-[6px]" key={w.id}>
                  <span className="!text-[length:16px] !w-[22px] !text-center">{cat?.emoji ?? GENERIC_WAYPOINT.emoji}</span>
                  <input className="!flex-[1] !min-w-[0]" style={{ ...input }} value={w.name} maxLength={160}
                    placeholder={w.type === 'generic' ? t('planner.waypoints.namePlaceholder') : catLabel(w.type)}
                    onChange={e => renameWaypoint(w.id, e.target.value)} />
                  <span className="!text-[length:11px] ![color:var(--text-muted)] !whitespace-nowrap">km {near.km.toFixed(1)}</span>
                  <button className="!p-[5px] ![border:none] ![background:transparent]" type="button" aria-label={t('common.delete')} style={{ ...btn }}
                    onClick={() => removeWaypoint(w.id)}>
                    <Trash2 size={14} style={{ color: '#dc2626' }} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="!flex !items-center !gap-[8px]" style={{ ...card }}>
        <span className="!text-[length:12px] ![color:var(--text-muted)] !flex-[1]">{t('planner.upload.another')}</span>
        <button type="button" style={btn} onClick={() => fileRef.current?.click()}><Upload size={15} />{t('planner.upload.choose')}</button>
      </div>

      <button type="button" style={btn} onClick={() => { setLibraryOpen(true); setMobileView('map') }}>
        <FolderIcon size={15} />{t('planner.lib.openLibrary', { n: routesTotal })}
      </button>
    </div>
  )

  const stagesPanel = !hasRoute ? (
    <div className="!text-[length:13px] ![color:var(--text-muted)]" style={{ ...card }}>{t('planner.stages.noRoute')}</div>
  ) : (
    <div className="!flex !flex-col !gap-[12px]">
      <div style={card}>
        <div className="!mb-[8px]" style={{ ...label }}>{t('planner.stages.auto')}</div>
        <div className="!flex !items-end !gap-[8px]">
          <div className="!flex-[1]">
            <div className="!text-[length:11px] ![color:var(--text-muted)] !mb-[3px]">{t('planner.stages.kmPerStage')}</div>
            <input style={input} type="number" min={5} max={500} step={5} value={settings.stageKm ?? 60}
              onChange={e => { markDirty(); setSettings(s => ({ ...s, stageKm: Math.max(1, Number(e.target.value) || 1) })) }} />
          </div>
          <button type="button" style={{ ...btnPrimary, opacity: cutsLoading ? 0.6 : 1 }} disabled={cutsLoading} onClick={runAutoSplit}>
            <Scissors size={15} />{cutsLoading ? t('planner.stages.cuts.working') : t('planner.stages.split')}
          </button>
          {cuts.length > 0 && (
            <button type="button" style={btn} onClick={() => { updateCuts([]); setActiveStage(null) }}>{t('planner.stages.clear')}</button>
          )}
        </div>
        {cuts.length > 0 && (
          <button className="!mt-[8px]" type="button" style={{ ...btn, opacity: cutsLoading ? 0.6 : 1 }} disabled={cutsLoading} onClick={snapCutsToLodging}>
            🛏️ {t('planner.stages.cuts.snap')}
          </button>
        )}
        <div className="!mt-[10px]">
          <div className="!text-[length:11px] ![color:var(--text-muted)] !mb-[3px]">{t('planner.stages.startDate')}</div>
          <input style={input} type="date" value={settings.startDate ?? ''}
            onChange={e => { markDirty(); setSettings(s => ({ ...s, startDate: e.target.value || undefined })) }} />
          <div className="!text-[length:11px] ![color:var(--text-muted)] !mt-[3px]">{t('planner.stages.startDate.hint')}</div>
        </div>
        <div className="!text-[length:11px] ![color:var(--text-muted)] !mt-[8px]">{t('planner.stages.cuts.hint')}</div>
        <div className="!text-[length:11px] ![color:var(--text-muted)] !mt-[4px]">{t('planner.stages.hintProfile')}</div>
      </div>

      <div className="!flex !flex-col !gap-[8px]">
        {stages.map((st, i) => (
          <div className="!p-[10px] !cursor-pointer" key={`${st.from}-${st.to}`} style={{ ...card, borderLeft: `5px solid ${STAGE_COLORS[i % STAGE_COLORS.length]}`, outline: activeStage === i ? `2px solid ${STAGE_COLORS[i % STAGE_COLORS.length]}` : 'none' }} onClick={() => setActiveStage(activeStage === i ? null : i)}>
            <div className="!flex !items-center !gap-[6px]">
              <input className="!font-[700]" style={{ ...input }} value={st.name} maxLength={120}
                onClick={e => e.stopPropagation()}
                onChange={e => renameStage(i, e.target.value)} />
              <button className="!p-[6px]" type="button" title={t('planner.download.stage')} style={{ ...btn }}
                onClick={e => { e.stopPropagation(); downloadStage(i) }}><Download size={15} /></button>
            </div>
            <div className="!flex !flex-wrap !gap-[4px_12px] !mt-[6px] !text-[length:12px] ![color:var(--text-muted)]">
              <span><b className="![color:var(--text-primary)]">{fmtKm(st.distKm)}</b></span>
              <span>+{st.gain} m</span>
              <span>−{st.loss} m</span>
              <span>km {st.startKm.toFixed(1)}–{st.endKm.toFixed(1)}</span>
              {st.minEle != null && st.maxEle != null && <span>{st.minEle}–{st.maxEle} m</span>}
            </div>
            {st.endLodged === true && (
              <div className="!text-[length:11px] !mt-[5px] ![color:#15803d]">
                🛏️ {st.endPlace ? t('planner.stages.end.lodgedIn', { place: st.endPlace }) : t('planner.stages.end.lodged')}{shiftLabel(st.endShiftKm)}{st.endSource === 'google' ? ' · Google' : ''}
              </div>
            )}
            {st.endLodged !== true && st.endTown && (
              <div className="!text-[length:11px] !mt-[5px] ![color:#a16207]">
                🏘️ {t('planner.stages.end.town', { place: st.endPlace ?? '' })}{shiftLabel(st.endShiftKm)}
                {st.endUnchecked ? ` · ${t('planner.stages.end.townUnchecked')}` : ''}
              </div>
            )}
            {st.endLodged === false && !st.endTown && (
              <div className="!text-[length:11px] !mt-[5px] ![color:#b45309]">⚠️ {t(st.endUnchecked ? 'planner.stages.end.unchecked' : 'planner.stages.end.none')}</div>
            )}
            {(() => {
              // Enlaces para comprobar el alojamiento a mano (Booking no tiene API pública: solo abrimos su buscador).
              const end = points[st.to]
              if (!end) return null
              const wp = waypoints.find(w => w.name && haversineM(w.lat, w.lng, end.lat, end.lng) < 3000)
              const place = st.endPlace || wp?.name
              const link: React.CSSProperties = { color: 'var(--accent, #e85d24)', fontWeight: 600, textDecoration: 'none' }
              return (
                <div className="!flex !gap-[12px] !mt-[5px] !text-[length:11px]" onClick={e => e.stopPropagation()}>
                  {place && <a href={bookingSearchUrl(place, locale, nightOfStage(settings.startDate, i))} target="_blank" rel="noopener noreferrer" style={link}>🔎 {t('planner.stages.end.booking')}</a>}
                  <a href={googleMapsHotelsUrl(end.lat, end.lng)} target="_blank" rel="noopener noreferrer" style={link}>📍 {t('planner.stages.end.googleMaps')}</a>
                </div>
              )
            })()}
            {i > 0 && (
              <button className="!p-[3px_8px] !text-[length:11px] !mt-[6px]" type="button" style={{ ...btn }}
                onClick={e => { e.stopPropagation(); mergeWithPrevious(i) }}>{t('planner.stages.merge')}</button>
            )}
          </div>
        ))}
        {stages.length > 1 && (
          <button type="button" style={btn} onClick={downloadAllStages}><Download size={15} />{t('planner.download.all')}</button>
        )}
      </div>

      <div style={card}>
        <div className="!mb-[8px]" style={{ ...label }}>{t('planner.services')}</div>
        <div className="!flex !flex-wrap !gap-[6px] !mb-[8px]">
          {PLANNER_CATEGORIES.map(c => {
            const on = cats.includes(c.key)
            return (
              <button className="!p-[4px_9px] !text-[length:12px]" key={c.key} type="button" aria-pressed={on}
                onClick={() => setCats(prev => (on ? prev.filter(k => k !== c.key) : [...prev, c.key]))}
                style={{ ...btn, background: on ? c.color : 'var(--bg-card)', color: on ? '#fff' : 'var(--text-primary)', borderColor: on ? c.color : 'var(--border-primary)' }}>
                <span>{c.emoji}</span>{catLabel(c.key)}
              </button>
            )
          })}
        </div>
        <div className="!flex !gap-[8px] !items-end !flex-wrap">
          <div className="!flex-[1] !min-w-[110px]">
            <div className="!text-[length:11px] ![color:var(--text-muted)] !mb-[3px]">{t('planner.services.radius')}</div>
            <select style={input} value={settings.poiRadiusM ?? 1000}
              onChange={e => { markDirty(); setSettings(s => ({ ...s, poiRadiusM: Number(e.target.value) })) }}>
              {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r >= 1000 ? `${r / 1000} km` : `${r} m`}</option>)}
            </select>
          </div>
          <div className="!flex-[1] !min-w-[110px]">
            <div className="!text-[length:11px] ![color:var(--text-muted)] !mb-[3px]">{t('planner.services.scope')}</div>
            <select style={input} value={scope} onChange={e => setScope(e.target.value as 'stage' | 'all')}>
              <option value="stage">{t('planner.services.scopeStage')}</option>
              <option value="all">{t('planner.services.scopeAll')}</option>
            </select>
          </div>
          <button type="button" style={btnPrimary} disabled={poiLoading} onClick={searchServices}>
            <Search size={15} />{poiLoading ? t('planner.services.searching') : t('planner.services.search')}
          </button>
        </div>
        {pois.length > 0 && (
          <button className="!p-[3px_8px] !text-[length:11px] !mt-[8px]" type="button" style={{ ...btn }} onClick={() => setPois([])}>{t('planner.services.clear')}</button>
        )}
        {poisForList.length > 0 && (
          <div className="!flex !flex-col !gap-[4px] !mt-[10px] !max-h-[320px] !overflow-y-auto">
            {poisForList.map(p => {
              const cat = CATEGORY_BY_KEY[p.category]
              return (
                <div className="!flex !items-center !gap-[6px] !p-[4px_0] ![border-bottom:1px_solid_var(--border-primary)]" key={p.osm_id}>
                  <span className="!text-[length:15px] !w-[20px] !text-center">{cat?.emoji}</span>
                  <div className="!flex-[1] !min-w-[0]">
                    <div className="!text-[length:12px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                      {p.name || catLabel(p.category)}
                    </div>
                    <div className="!text-[length:11px] ![color:var(--text-muted)]">
                      {t('planner.km')} {p.km.toFixed(1)} · {Math.round(p.offM)} m {t('planner.offRoute')}
                    </div>
                  </div>
                  <button className="!p-[5px]" type="button" title={t('planner.services.add')} style={{ ...btn }} onClick={() => addPoiAsWaypoint(p)}><Plus size={14} /></button>
                  <button className="!p-[5px]" type="button" title={t('planner.services.cutHere')} style={{ ...btn }} onClick={() => cutAtPoi(p)}><Scissors size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="page-bg ![background:var(--bg-secondary)]">
      <Navbar />
      <input ref={fileRef} type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml,application/xml"
        style={{ display: 'none' }} onChange={e => onFiles(e.target.files)} />

      <div className="!fixed !top-[var(--nav-h)] !left-[0] !right-[0] !bottom-[env(safe-area-inset-bottom,_0px)] !flex !flex-col">
        {/* Conmutador Editar / Mapa en pantallas estrechas */}
        <div className="lg:hidden !flex !gap-[6px] !p-[8px] ![background:var(--bg-card)] ![border-bottom:1px_solid_var(--border-primary)]">
          {(['panel', 'map'] as MobileView[]).map(v => (
            <button className="!flex-[1]" key={v} type="button" onClick={() => setMobileView(v)}
              style={{ ...(mobileView === v ? btnPrimary : btn) }}>
              {v === 'panel' ? <Layers size={15} /> : <MapIcon size={15} />}{t(hasRoute ? `planner.view.${v}` : v === 'panel' ? 'planner.view.create' : 'planner.view.library')}
            </button>
          ))}
        </div>

        <div className="!flex-[1] !min-h-[0] !flex">
          {/* Panel lateral */}
          <aside className={`${mobileView === 'panel' ? 'flex' : 'hidden'} lg:flex !flex-col !w-[100%] !max-w-[420px] !shrink-[0] ![background:var(--bg-secondary)] ![border-right:1px_solid_var(--border-primary)] !min-h-[0]`}>
            <div className="hidden lg:flex !items-center !gap-[8px] !p-[10px_12px_0]">
              <RouteIcon size={18} style={{ color: 'var(--text-primary)' }} />
              <h1 className="!text-[length:16px] !font-[800] ![color:var(--text-primary)] !m-[0]">{t('planner.title')}</h1>
            </div>
            <div className="!flex !gap-[6px] !p-[10px_12px_0]">
              {(['route', 'stages'] as PanelTab[]).map(k => (
                <button className="!flex-[1]" key={k} type="button" onClick={() => setTab(k)}
                  style={{ ...(tab === k ? btnPrimary : btn) }}>{t(`planner.tab.${k}`)}</button>
              ))}
            </div>
            <div className="!flex-[1] !min-h-[0] !overflow-y-auto !p-[12px]">
              {tab === 'route' ? routePanel : stagesPanel}
            </div>
          </aside>

          {/* Biblioteca (sin ruta abierta, o al pulsar «Mis rutas») o mapa + perfil */}
          <section className={`${mobileView === 'map' ? 'flex' : 'hidden'} lg:flex !flex-[1] !min-w-[0] !flex-col`}>
            <div className="!flex-[1] !min-h-[0]" style={{ display: showLibrary ? 'flex' : 'none' }}>
              <RouteLibrary
                version={libraryVersion} currentId={routeId}
                onOpen={id => { if (id === routeId) setLibraryOpen(false); else openRoute(id) }}
                onDelete={setDeleteTarget}
                onBack={hasRoute ? () => setLibraryOpen(false) : undefined}
                onChanged={loadSaved}
              />
            </div>
            <div className="!flex-[1] !min-h-[0] !flex-col" style={{ display: showLibrary ? 'none' : 'flex' }}>
            <div className="!flex-[1] !min-h-[0] !relative">
              <PlannerMap
                points={points} stages={stages} activeStage={activeStage} waypoints={waypoints} pois={visiblePois}
                hoverIdx={hoverIdx} addingWaypoint={addingWaypoint} poiLabel={catLabel}
                visible={!showLibrary} refitKey={mobileView}
                texts={{ addPoi: t('planner.services.add'), cutHere: t('planner.services.cutHere'), remove: t('common.delete'), kmLabel: t('planner.km'), offRoute: t('planner.offRoute') }}
                onMapClick={addWaypointAt}
                onSelectStage={i => { setActiveStage(i); setTab('stages') }}
                onAddPoi={addPoiAsWaypoint} onCutAtPoi={cutAtPoi} onRemoveWaypoint={removeWaypoint}
              />
              {addingWaypoint && (
                <div className="![box-shadow:0_2px_8px_rgba(0,0,0,.3)]" style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, ...btnPrimary }}
                  onClick={() => setAddingWaypoint(false)}>
                  {t('planner.waypoints.adding')} <X size={14} />
                </div>
              )}
            </div>
            {hasRoute && (
              <div className="!h-[190px] !shrink-[0] ![background:var(--bg-card)] ![border-top:1px_solid_var(--border-primary)]">
                <PlannerProfile
                  cum={cum} smoothed={smoothed} stages={stages} activeStage={activeStage}
                  hint={tab === 'stages' ? t('planner.profile.hintCut') : t('planner.profile.hint')}
                  eleLabel={t('planner.profile.ele')} onHover={setHoverIdx} onClickIndex={onProfileClick}
                />
              </div>
            )}
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        message={deleteTarget ? t('planner.mine.deleteConfirm', { name: deleteTarget.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </div>
  )
}
