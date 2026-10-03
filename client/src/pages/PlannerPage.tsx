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
  autoSplit, normalizeCuts, nearestOnRoute, indexAtKm, buildGpx, buildStageGpx, safeFileName, fmtKm,
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
  }) => {
    const c = cumulativeKm(o.pts)
    const st = routeStats(smoothElevation(o.pts, c), c)
    const stageKm = o.stageKm && o.stageKm > 0 ? Math.round(o.stageKm) : null
    const newSettings: PlannerSettings = { stageKm: stageKm ?? 60, poiRadiusM: 1000 }
    const newCuts = stageKm ? autoSplit(c, stageKm) : []

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
      await createAndOpen({ name: res.plan.name || t('planner.untitled'), origName: 'IA', pts, wps, stageKm })
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

  const addCutAt = useCallback((idx: number): boolean => {
    if (idx <= 0 || idx >= points.length - 1) return false
    const km = cum[idx]
    const bounds = [0, ...cuts.map(c => cum[c.index]), cum[cum.length - 1]]
    if (bounds.some(b => Math.abs(b - km) < MIN_CUT_GAP_KM)) return false
    markDirty()
    setCuts(prev => normalizeCuts([...prev, { index: idx }], points.length))
    return true
  }, [points.length, cum, cuts, markDirty])

  const runAutoSplit = () => {
    const km = settings.stageKm ?? 60
    markDirty()
    setCuts(autoSplit(cum, km))
    setSettings(s => ({ ...s, firstStageName: undefined }))
    setActiveStage(null)
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
    if (!addCutAt(near.index)) toast.info(t('planner.stages.cutTooClose'))
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
      let failed = 0
      for (const cat of cats) {
        for (const [from, to] of chunks) {
          try {
            const line = simplifyLine(points.slice(from, to + 1), 300)
            const res = await plannerApi.poisAlongRoute(cat, line, radius, ctrl.signal)
            if (res.truncated) anyTruncated = true
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
          }
        }
      }
      setPois(prev => {
        const merged = new Map(prev.map(p => [p.osm_id, p]))
        found.forEach((v, k) => merged.set(k, v))
        return [...merged.values()].sort((x, y) => x.km - y.km)
      })
      if (failed && !found.size) toast.error(t('planner.services.error'))
      else if (!found.size) toast.info(t('planner.services.none'))
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
    <div
      style={{
        ...card, textAlign: 'center', padding: 24, cursor: 'pointer',
        border: `2px dashed ${dragOver ? 'var(--accent, #e85d24)' : 'var(--border-primary)'}`,
      }}
      onClick={() => fileRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
    >
      <Upload size={28} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{reading ? t('planner.upload.reading') : t('planner.upload.title')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 12px' }}>{t('planner.upload.hint')}</div>
      <span style={btnPrimary}>{t('planner.upload.choose')}</span>
    </div>
  )

  const aiBox = (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Sparkles size={15} style={{ color: 'var(--accent, #e85d24)' }} />
        <div style={label}>{t('planner.ai.title')}</div>
      </div>
      <textarea style={{ ...input, minHeight: 78, resize: 'vertical', fontFamily: 'inherit' }} maxLength={1500}
        value={aiPrompt} disabled={aiLoading} placeholder={t('planner.ai.placeholder')}
        onChange={e => setAiPrompt(e.target.value)} />
      <button type="button" style={{ ...btnPrimary, marginTop: 8, opacity: aiLoading || aiPrompt.trim().length < 8 ? 0.6 : 1 }}
        disabled={aiLoading || aiPrompt.trim().length < 8} onClick={generateWithAI}>
        <Sparkles size={15} />{aiLoading ? t('planner.ai.generating') : t('planner.ai.generate')}
      </button>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{t('planner.ai.disclaimer')}</div>
    </div>
  )

  const aiInfoBox = aiInfo && (
    <div style={{ ...card, borderColor: 'var(--accent, #e85d24)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Sparkles size={14} style={{ color: 'var(--accent, #e85d24)' }} />
        <div style={{ ...label, flex: 1 }}>{t('planner.ai.result')}</div>
        <button type="button" aria-label={t('common.close')} style={{ ...btn, padding: 3, border: 'none', background: 'transparent' }}
          onClick={() => setAiInfo(null)}><X size={14} /></button>
      </div>
      {aiInfo.summary && <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{aiInfo.summary}</div>}
      {aiInfo.warnings.map(w => {
        const [kind, ...rest] = w.split(':')
        const detail = rest.join(':')
        return (
          <div key={w} style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>
            ⚠️ {kind === 'unresolved' ? t('planner.ai.warn.unresolved', { list: detail }) : kind === 'far' ? t('planner.ai.warn.far', { leg: detail }) : detail}
          </div>
        )
      })}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('planner.ai.reviewHint')}</div>
    </div>
  )

  const statBox = (k: string, v: string) => (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '6px 8px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{v}</div>
    </div>
  )

  const routePanel = !hasRoute ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {aiBox}{uploadBox}
      {routesTotal > 0 && (
        <button type="button" className="lg:hidden" style={btn} onClick={() => setMobileView('map')}>
          <FolderIcon size={15} />{t('planner.lib.openLibrary', { n: routesTotal })}
        </button>
      )}
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {aiInfoBox}
      <div style={card}>
        <div style={{ ...label, marginBottom: 6 }}>{t('planner.name')}</div>
        <input style={input} value={name} maxLength={160}
          onChange={e => { markDirty(); setName(e.target.value) }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input key={`${routeId}-${routeFolder ?? ''}`} style={{ ...input, flex: 1, minWidth: 0 }} list="planner-folders" maxLength={60}
            defaultValue={routeFolder ?? ''} placeholder={t('planner.lib.folder.field')}
            onBlur={e => setFolder(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          <datalist id="planner-folders">{folderNames.map(n => <option key={n} value={n} />)}</datalist>
          <button type="button" aria-pressed={routeFavorite} title={t('planner.lib.favorite')} aria-label={t('planner.lib.favorite')}
            style={{ ...btn, padding: '6px 9px' }} onClick={() => setFavorite(!routeFavorite)}>
            <Star size={16} fill={routeFavorite ? '#f59e0b' : 'none'} style={{ color: routeFavorite ? '#f59e0b' : 'var(--text-muted)' }} />
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 10 }}>
          {statBox(t('planner.stats.distance'), fmtKm(stats.distKm))}
          {statBox(t('planner.stats.gain'), `+${stats.gain} m`)}
          {statBox(t('planner.stats.loss'), `−${stats.loss} m`)}
          {statBox(t('planner.stats.min'), stats.minEle != null ? `${stats.minEle} m` : '—')}
          {statBox(t('planner.stats.max'), stats.maxEle != null ? `${stats.maxEle} m` : '—')}
          {statBox(t('planner.stats.stages'), String(stages.length))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button type="button" style={btnPrimary} onClick={downloadRoute}><Download size={15} />{t('planner.download.route')}</button>
          <button type="button" style={btn} onClick={closeRoute}><X size={15} />{t('planner.closeRoute')}</button>
        </div>
        <div style={{ fontSize: 11, marginTop: 8, color: saveState === 'error' ? '#dc2626' : 'var(--text-muted)' }}>
          {saveState === 'saving' ? t('planner.save.saving') : saveState === 'saved' ? t('planner.save.saved') : saveState === 'error' ? t('planner.save.error') : ''}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={label}>{t('planner.waypoints')} ({waypoints.length})</div>
          <button type="button" style={addingWaypoint ? btnPrimary : btn}
            onClick={() => { setAddingWaypoint(a => !a); setMobileView('map') }}>
            <MapPin size={14} />{addingWaypoint ? t('planner.waypoints.adding') : t('planner.waypoints.add')}
          </button>
        </div>
        {waypoints.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('planner.waypoints.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {waypoints.map(w => {
              const cat = CATEGORY_BY_KEY[w.type]
              const near = nearestOnRoute(points, cum, w.lat, w.lng)
              return (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{cat?.emoji ?? GENERIC_WAYPOINT.emoji}</span>
                  <input style={{ ...input, flex: 1, minWidth: 0 }} value={w.name} maxLength={160}
                    placeholder={w.type === 'generic' ? t('planner.waypoints.namePlaceholder') : catLabel(w.type)}
                    onChange={e => renameWaypoint(w.id, e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>km {near.km.toFixed(1)}</span>
                  <button type="button" aria-label={t('common.delete')} style={{ ...btn, padding: 5, border: 'none', background: 'transparent' }}
                    onClick={() => removeWaypoint(w.id)}>
                    <Trash2 size={14} style={{ color: '#dc2626' }} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{t('planner.upload.another')}</span>
        <button type="button" style={btn} onClick={() => fileRef.current?.click()}><Upload size={15} />{t('planner.upload.choose')}</button>
      </div>

      <button type="button" style={btn} onClick={() => { setLibraryOpen(true); setMobileView('map') }}>
        <FolderIcon size={15} />{t('planner.lib.openLibrary', { n: routesTotal })}
      </button>
    </div>
  )

  const stagesPanel = !hasRoute ? (
    <div style={{ ...card, fontSize: 13, color: 'var(--text-muted)' }}>{t('planner.stages.noRoute')}</div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={{ ...label, marginBottom: 8 }}>{t('planner.stages.auto')}</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{t('planner.stages.kmPerStage')}</div>
            <input style={input} type="number" min={5} max={500} step={5} value={settings.stageKm ?? 60}
              onChange={e => { markDirty(); setSettings(s => ({ ...s, stageKm: Math.max(1, Number(e.target.value) || 1) })) }} />
          </div>
          <button type="button" style={btnPrimary} onClick={runAutoSplit}><Scissors size={15} />{t('planner.stages.split')}</button>
          {cuts.length > 0 && (
            <button type="button" style={btn} onClick={() => { updateCuts([]); setActiveStage(null) }}>{t('planner.stages.clear')}</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{t('planner.stages.hintProfile')}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stages.map((st, i) => (
          <div key={`${st.from}-${st.to}`} style={{
            ...card, padding: 10, cursor: 'pointer',
            borderLeft: `5px solid ${STAGE_COLORS[i % STAGE_COLORS.length]}`,
            outline: activeStage === i ? `2px solid ${STAGE_COLORS[i % STAGE_COLORS.length]}` : 'none',
          }} onClick={() => setActiveStage(activeStage === i ? null : i)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input style={{ ...input, fontWeight: 700 }} value={st.name} maxLength={120}
                onClick={e => e.stopPropagation()}
                onChange={e => renameStage(i, e.target.value)} />
              <button type="button" title={t('planner.download.stage')} style={{ ...btn, padding: 6 }}
                onClick={e => { e.stopPropagation(); downloadStage(i) }}><Download size={15} /></button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <span><b style={{ color: 'var(--text-primary)' }}>{fmtKm(st.distKm)}</b></span>
              <span>+{st.gain} m</span>
              <span>−{st.loss} m</span>
              <span>km {st.startKm.toFixed(1)}–{st.endKm.toFixed(1)}</span>
              {st.minEle != null && st.maxEle != null && <span>{st.minEle}–{st.maxEle} m</span>}
            </div>
            {i > 0 && (
              <button type="button" style={{ ...btn, padding: '3px 8px', fontSize: 11, marginTop: 6 }}
                onClick={e => { e.stopPropagation(); mergeWithPrevious(i) }}>{t('planner.stages.merge')}</button>
            )}
          </div>
        ))}
        {stages.length > 1 && (
          <button type="button" style={btn} onClick={downloadAllStages}><Download size={15} />{t('planner.download.all')}</button>
        )}
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 8 }}>{t('planner.services')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {PLANNER_CATEGORIES.map(c => {
            const on = cats.includes(c.key)
            return (
              <button key={c.key} type="button" aria-pressed={on}
                onClick={() => setCats(prev => (on ? prev.filter(k => k !== c.key) : [...prev, c.key]))}
                style={{
                  ...btn, padding: '4px 9px', fontSize: 12,
                  background: on ? c.color : 'var(--bg-card)', color: on ? '#fff' : 'var(--text-primary)',
                  borderColor: on ? c.color : 'var(--border-primary)',
                }}>
                <span>{c.emoji}</span>{catLabel(c.key)}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{t('planner.services.radius')}</div>
            <select style={input} value={settings.poiRadiusM ?? 1000}
              onChange={e => { markDirty(); setSettings(s => ({ ...s, poiRadiusM: Number(e.target.value) })) }}>
              {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r >= 1000 ? `${r / 1000} km` : `${r} m`}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{t('planner.services.scope')}</div>
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
          <button type="button" style={{ ...btn, padding: '3px 8px', fontSize: 11, marginTop: 8 }} onClick={() => setPois([])}>{t('planner.services.clear')}</button>
        )}
        {poisForList.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, maxHeight: 320, overflowY: 'auto' }}>
            {poisForList.map(p => {
              const cat = CATEGORY_BY_KEY[p.category]
              return (
                <div key={p.osm_id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border-primary)' }}>
                  <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{cat?.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name || catLabel(p.category)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {t('planner.km')} {p.km.toFixed(1)} · {Math.round(p.offM)} m {t('planner.offRoute')}
                    </div>
                  </div>
                  <button type="button" title={t('planner.services.add')} style={{ ...btn, padding: 5 }} onClick={() => addPoiAsWaypoint(p)}><Plus size={14} /></button>
                  <button type="button" title={t('planner.services.cutHere')} style={{ ...btn, padding: 5 }} onClick={() => cutAtPoi(p)}><Scissors size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="page-bg" style={{ background: 'var(--bg-secondary)' }}>
      <Navbar />
      <input ref={fileRef} type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml,application/xml"
        style={{ display: 'none' }} onChange={e => onFiles(e.target.files)} />

      <div style={{ position: 'fixed', top: 'var(--nav-h)', left: 0, right: 0, bottom: 'env(safe-area-inset-bottom, 0px)', display: 'flex', flexDirection: 'column' }}>
        {/* Conmutador Editar / Mapa en pantallas estrechas */}
        <div className="lg:hidden" style={{ display: 'flex', gap: 6, padding: 8, background: 'var(--bg-card)', borderBottom: '1px solid var(--border-primary)' }}>
          {(['panel', 'map'] as MobileView[]).map(v => (
            <button key={v} type="button" onClick={() => setMobileView(v)}
              style={{ ...(mobileView === v ? btnPrimary : btn), flex: 1 }}>
              {v === 'panel' ? <Layers size={15} /> : <MapIcon size={15} />}{t(hasRoute ? `planner.view.${v}` : v === 'panel' ? 'planner.view.create' : 'planner.view.library')}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* Panel lateral */}
          <aside className={`${mobileView === 'panel' ? 'flex' : 'hidden'} lg:flex`}
            style={{ flexDirection: 'column', width: '100%', maxWidth: 420, flexShrink: 0, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-primary)', minHeight: 0 }}>
            <div className="hidden lg:flex" style={{ alignItems: 'center', gap: 8, padding: '10px 12px 0' }}>
              <RouteIcon size={18} style={{ color: 'var(--text-primary)' }} />
              <h1 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('planner.title')}</h1>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '10px 12px 0' }}>
              {(['route', 'stages'] as PanelTab[]).map(k => (
                <button key={k} type="button" onClick={() => setTab(k)}
                  style={{ ...(tab === k ? btnPrimary : btn), flex: 1 }}>{t(`planner.tab.${k}`)}</button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
              {tab === 'route' ? routePanel : stagesPanel}
            </div>
          </aside>

          {/* Biblioteca (sin ruta abierta, o al pulsar «Mis rutas») o mapa + perfil */}
          <section className={`${mobileView === 'map' ? 'flex' : 'hidden'} lg:flex`}
            style={{ flex: 1, minWidth: 0, flexDirection: 'column' }}>
            <div style={{ display: showLibrary ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
              <RouteLibrary
                version={libraryVersion} currentId={routeId}
                onOpen={id => { if (id === routeId) setLibraryOpen(false); else openRoute(id) }}
                onDelete={setDeleteTarget}
                onBack={hasRoute ? () => setLibraryOpen(false) : undefined}
                onChanged={loadSaved}
              />
            </div>
            <div style={{ display: showLibrary ? 'none' : 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <PlannerMap
                points={points} stages={stages} activeStage={activeStage} waypoints={waypoints} pois={visiblePois}
                hoverIdx={hoverIdx} addingWaypoint={addingWaypoint} poiLabel={catLabel}
                texts={{ addPoi: t('planner.services.add'), cutHere: t('planner.services.cutHere'), remove: t('common.delete'), kmLabel: t('planner.km'), offRoute: t('planner.offRoute') }}
                onMapClick={addWaypointAt}
                onSelectStage={i => { setActiveStage(i); setTab('stages') }}
                onAddPoi={addPoiAsWaypoint} onCutAtPoi={cutAtPoi} onRemoveWaypoint={removeWaypoint}
              />
              {addingWaypoint && (
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, ...btnPrimary, boxShadow: '0 2px 8px rgba(0,0,0,.3)' }}
                  onClick={() => setAddingWaypoint(false)}>
                  {t('planner.waypoints.adding')} <X size={14} />
                </div>
              )}
            </div>
            {hasRoute && (
              <div style={{ height: 190, flexShrink: 0, background: 'var(--bg-card)', borderTop: '1px solid var(--border-primary)' }}>
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
