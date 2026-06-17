import { useState } from 'react'
import { Search, MapPin, Route, Globe, ExternalLink, CheckSquare, Square, Download, Loader2, ChevronDown, ChevronRight, AlertCircle, Mountain } from 'lucide-react'

interface OsmRoute {
  osmId: number
  name: string
  network: string
  ref: string | null
  distance: number | null
  website: string | null
  description: string | null
  wikipedia: string | null
  operator: string | null
  colour: string | null
  hasMinInfo: boolean
  source?: string
  // loaded on demand
  points?: { lat: number; lng: number; ele?: number | null }[]
  distanceKm?: number
  loadingGpx?: boolean
  gpxError?: string
}

const COUNTRIES = [
  { code: 'ES', label: '🇪🇸 España' },
  { code: 'PT', label: '🇵🇹 Portugal' },
  { code: 'FR', label: '🇫🇷 Francia' },
]

const NETWORKS = [
  { code: 'icn', label: 'ICN — Internacional' },
  { code: 'ncn', label: 'NCN — Nacional' },
  { code: 'rcn', label: 'RCN — Regional' },
]

const TRIP_TYPES = [
  { value: 'cycling', label: '🚴 Bicicleta' },
  { value: 'trekking', label: '🥾 Trekking' },
  { value: 'general', label: '🌍 General' },
]

function networkBadge(network: string) {
  const colors: Record<string, string> = {
    icn: '#6366f1', ncn: '#0ea5e9', rcn: '#22c55e', lcn: '#f59e0b',
  }
  return (
    <span style={{
      background: (colors[network] || '#64748b') + '22',
      border: `1px solid ${colors[network] || '#64748b'}`,
      color: colors[network] || '#64748b',
      fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
    }}>
      {network.toUpperCase()}
    </span>
  )
}

function badge(label: string, bg: string, border: string, color: string) {
  return <span style={{ background: bg, border: `1px solid ${border}`, color, fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>{label}</span>
}

function sourceBadge(source?: string) {
  if (!source || source === 'osm') return badge('OSM', '#64748b22', '#64748b', '#64748b')
  if (source === 'wmt_cycling') return badge('🚴 WMT', '#22c55e22', '#22c55e', '#16a34a')
  if (source === 'wmt_hiking') return badge('🥾 WMT', '#f59e0b22', '#f59e0b', '#d97706')
  if (source === 'komoot') return badge('🟠 Komoot', '#f9731622', '#f97316', '#c2410c')
  if (source === 'url') return badge('🔗 URL', '#8b5cf622', '#8b5cf6', '#7c3aed')
  return null
}

export default function RouteDiscoveryPanel() {
  // Mode
  const [mode, setMode] = useState<'browse' | 'search'>('browse')
  const [queryText, setQueryText] = useState('')

  // Browse filters
  const [countries, setCountries] = useState<string[]>(['ES'])
  const [networks, setNetworks] = useState<string[]>(['icn', 'ncn'])
  const [minDistanceKm, setMinDistanceKm] = useState(150)
  const [tripType, setTripType] = useState('cycling')

  // Results & state
  const [routes, setRoutes] = useState<OsmRoute[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState<Set<number>>(new Set())
  const [importedIds, setImportedIds] = useState<Set<number>>(new Set())
  const [importErrors, setImportErrors] = useState<Record<number, string>>({})
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRoutes, setTotalRoutes] = useState(0)

  const toggleCountry = (c: string) =>
    setCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  const toggleNetwork = (n: string) =>
    setNetworks(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n])
  const toggleSelect = (id: number) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; })
  const toggleExpand = (id: number) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; })

  const fetchPage = async (page: number, append: boolean) => {
    try {
      const body: any = { page }
      if (mode === 'search') {
        body.query = queryText.trim()
      } else {
        Object.assign(body, { countries, networks, minDistanceKm })
      }
      const r = await fetch('/api/admin/route-discovery/search', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error searching')
      if (append) {
        setRoutes(prev => [...prev, ...data.routes])
      } else {
        setRoutes(data.routes)
        setSelected(new Set())
        setImportedIds(new Set())
        setImportErrors({})
      }
      setCurrentPage(data.page)
      setTotalPages(data.totalPages)
      setTotalRoutes(data.total)
    } catch (e: any) {
      setSearchError(e.message)
    }
  }

  const handleSearch = async () => {
    if (mode === 'browse' && (countries.length === 0 || networks.length === 0)) return
    if (mode === 'search' && queryText.trim().length < 2) return
    setSearching(true)
    setSearchError(null)
    setRoutes([])
    setCurrentPage(1)
    setTotalPages(1)
    setTotalRoutes(0)
    await fetchPage(1, false)
    setSearching(false)
  }

  const handleLoadMore = async () => {
    setLoadingMore(true)
    setSearchError(null)
    await fetchPage(currentPage + 1, true)
    setLoadingMore(false)
  }

  const loadGpx = (route: OsmRoute) => ensureGpx(route)

  const callImport = async (groupName: string, groupRoutes: OsmRoute[], _retried = false) => {
    const osmIds = groupRoutes.map(r => r.osmId)
    osmIds.forEach(id => setImporting(prev => new Set(prev).add(id)))
    try {
      const res = await fetch('/api/admin/route-discovery/import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName,
          routes: groupRoutes.map(r => ({
            osmId: r.osmId, name: r.name, ref: r.ref,
            website: r.website, description: r.description,
            source: r.source || 'osm',
          })),
          tripType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Server cache expired — re-fetch GPX to re-warm cache, then retry once
        if (!_retried && (data.error || '').includes('GPX not loaded')) {
          osmIds.forEach(id => setImporting(prev => { const s = new Set(prev); s.delete(id); return s }))
          const reloaded: OsmRoute[] = []
          for (const route of groupRoutes) {
            const r = await ensureGpx(route, true)
            if (r) reloaded.push(r)
          }
          if (reloaded.length === groupRoutes.length) {
            await callImport(groupName, reloaded, true)
            return
          }
        }
        throw new Error(data.error || 'Error importing')
      }
      setImportedIds(prev => { const s = new Set(prev); osmIds.forEach(id => s.add(id)); return s })
    } catch (e: any) {
      osmIds.forEach(id => setImportErrors(prev => ({ ...prev, [id]: e.message })))
    }
    osmIds.forEach(id => setImporting(prev => { const s = new Set(prev); s.delete(id); return s }))
  }

  const ensureGpx = async (route: OsmRoute, force = false): Promise<OsmRoute | null> => {
    if (!force && route.points && route.points.length >= 10) return route
    setRoutes(prev => prev.map(r => r.osmId === route.osmId ? { ...r, loadingGpx: true, gpxError: undefined } : r))
    try {
      const res = await fetch('/api/admin/route-discovery/fetch-gpx', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          osmId: route.osmId, source: route.source || 'osm',
          ...(route.source === 'url' && route.website ? { gpxUrl: route.website } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Error loading GPX (${res.status})`)
      const enriched = { ...route, points: data.points, distanceKm: data.distanceKm, loadingGpx: false }
      setRoutes(prev => prev.map(r => r.osmId === route.osmId ? enriched : r))
      return enriched
    } catch (e: any) {
      setRoutes(prev => prev.map(r => r.osmId === route.osmId ? { ...r, loadingGpx: false, gpxError: e.message } : r))
      return null
    }
  }

  const importRoute = async (route: OsmRoute) => {
    const loaded = await ensureGpx(route)
    if (!loaded) return
    const groupName = route.name
    await callImport(groupName, [loaded])
  }

  // Groups selected routes by ref (or name if no ref), loads GPX for any missing, imports each group as one trip
  const importSelected = async () => {
    const toProcess = [...selected]
      .map(id => routes.find(r => r.osmId === id))
      .filter((r): r is OsmRoute => !!r && !importedIds.has(r.osmId))

    // Ensure all have GPX loaded (warms server cache)
    const loaded: OsmRoute[] = []
    for (const route of toProcess) {
      const r = await ensureGpx(route)
      if (r) loaded.push(r)
    }

    // Group by ref, falling back to name
    const groups = new Map<string, OsmRoute[]>()
    for (const route of loaded) {
      const key = (route.ref || route.name).trim().toUpperCase()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(route)
    }

    for (const groupRoutes of groups.values()) {
      const groupName = groupRoutes[0].ref
        ? `${groupRoutes[0].ref} — ${groupRoutes[0].name.split(/[–—:]/)[0].trim()}`
        : groupRoutes[0].name
      await callImport(groupName, groupRoutes)
    }
  }

  const selectAll = () => setSelected(new Set(routes.filter(r => !importedIds.has(r.osmId)).map(r => r.osmId)))
  const clearAll = () => setSelected(new Set())

  const card = 'bg-white rounded-xl border border-slate-200 p-5 mb-4'
  const label = 'block text-sm font-medium text-slate-700 mb-2'
  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
    active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
  }`

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-900">🗺️ Descubridor de Rutas</h2>
        <p className="text-sm text-slate-500 mt-1">Busca rutas en OpenStreetMap y Waymarked Trails (ciclismo + senderismo)</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setMode('browse')} className={chip(mode === 'browse')}>
          🔍 Navegar por red
        </button>
        <button onClick={() => setMode('search')} className={chip(mode === 'search')}>
          ✏️ Buscar por nombre
        </button>
      </div>

      {/* Filters */}
      <div className={card}>
        {mode === 'search' ? (
          /* Text search mode */
          <div className="mb-5">
            <label className={label}>Nombre de la ruta</label>
            <input
              type="text"
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Nombre, URL de Komoot, URL de colección Komoot o URL directa a GPX…"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Busca en Waymarked Trails · Pega una URL de tour/colección de Komoot · O cualquier URL directa a un fichero GPX
            </p>
          </div>
        ) : (
          /* Browse mode */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            {/* Countries */}
            <div>
              <label className={label}>Países</label>
              <div className="flex flex-wrap gap-2">
                {COUNTRIES.map(c => (
                  <button key={c.code} onClick={() => toggleCountry(c.code)} className={chip(countries.includes(c.code))}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Networks */}
            <div>
              <label className={label}>Red ciclista</label>
              <div className="flex flex-wrap gap-2">
                {NETWORKS.map(n => (
                  <button key={n.code} onClick={() => toggleNetwork(n.code)} className={chip(networks.includes(n.code))}>
                    {n.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Min distance */}
            <div>
              <label className={label}>Distancia mínima: <strong>{minDistanceKm} km</strong></label>
              <input
                type="range" min={50} max={1000} step={25} value={minDistanceKm}
                onChange={e => setMinDistanceKm(Number(e.target.value))}
                className="w-full accent-slate-900"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>50 km</span><span>≈ 3 días: 150 km</span><span>1000 km</span>
              </div>
            </div>

            {/* Trip type */}
            <div>
              <label className={label}>Tipo de viaje a crear</label>
              <div className="flex flex-wrap gap-2">
                {TRIP_TYPES.map(t => (
                  <button key={t.value} onClick={() => setTripType(t.value)} className={chip(tripType === t.value)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Trip type for search mode */}
        {mode === 'search' && (
          <div className="mb-5">
            <label className={label}>Tipo de viaje a crear</label>
            <div className="flex flex-wrap gap-2">
              {TRIP_TYPES.map(t => (
                <button key={t.value} onClick={() => setTripType(t.value)} className={chip(tripType === t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={handleSearch}
          disabled={searching || (mode === 'browse' ? (countries.length === 0 || networks.length === 0) : queryText.trim().length < 2)}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {searching
            ? (mode === 'search' ? 'Buscando…' : 'Buscando en OpenStreetMap…')
            : 'Buscar rutas'}
        </button>

        {searchError && (
          <div className="mt-3 flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle size={14} /> {searchError}
          </div>
        )}
      </div>

      {/* Results */}
      {routes.length > 0 && (
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="font-semibold text-slate-900">
                {routes.length} de {totalRoutes} rutas
              </span>
              {selected.size > 0 && (
                <span className="ml-2 text-sm text-slate-500">{selected.size} seleccionadas</span>
              )}
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={selectAll} className="text-xs text-slate-500 hover:text-slate-900 underline">Seleccionar todas</button>
              <span className="text-slate-300">|</span>
              <button onClick={clearAll} className="text-xs text-slate-500 hover:text-slate-900 underline">Limpiar</button>
              {selected.size > 0 && (
                <button
                  onClick={importSelected}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 ml-2"
                >
                  <Download size={14} />
                  Importar {selected.size} seleccionadas
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2" id="route-list">
            {routes.map(route => {
              const isSelected = selected.has(route.osmId)
              const isExpanded = expanded.has(route.osmId)
              const isImported = importedIds.has(route.osmId)
              const isImporting = importing.has(route.osmId) || route.loadingGpx
              const importErr = importErrors[route.osmId]
              const hasGpx = (route.points?.length || 0) > 0
              const hasEle = hasGpx && route.points!.some(p => p.ele != null)

              return (
                <div key={route.osmId} style={{
                  border: `1px solid ${isImported ? '#22c55e' : isSelected ? '#6366f1' : 'var(--border-primary)'}`,
                  borderRadius: 10,
                  background: isImported ? 'rgba(34,197,94,0.12)' : isSelected ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)',
                  overflow: 'hidden',
                }}>
                  {/* Row */}
                  <div className="flex items-center gap-3 p-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => !isImported && toggleSelect(route.osmId)}
                      className="flex-shrink-0 text-slate-400"
                      disabled={isImported}
                    >
                      {isImported
                        ? <CheckSquare size={18} color="#22c55e" />
                        : isSelected
                          ? <CheckSquare size={18} color="#6366f1" />
                          : <Square size={18} />}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm truncate">{route.name}</span>
                        {route.network ? networkBadge(route.network) : null}
                        {sourceBadge(route.source)}
                        {route.ref && <span className="text-xs text-slate-500 font-mono">{route.ref}</span>}
                        {hasEle && (
                          <span title="Incluye datos de elevación" style={{ color: '#16a34a', fontSize: 11 }}>
                            <Mountain size={12} className="inline" /> ele
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                        {route.distanceKm != null
                          ? <span className="text-indigo-600 font-semibold">📏 {route.distanceKm} km</span>
                          : route.distance != null
                            ? <span>📏 ~{route.distance} km</span>
                            : <span className="text-amber-500">📏 distancia desconocida</span>
                        }
                        {route.description && <span className="truncate max-w-xs" title={route.description}>📝 {route.description.slice(0, 60)}{route.description.length > 60 ? '…' : ''}</span>}
                        {route.website && (
                          <a href={route.website} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-blue-500 hover:underline"
                            onClick={e => e.stopPropagation()}>
                            <ExternalLink size={11} /> Web
                          </a>
                        )}
                      </div>
                      {importErr && <div className="text-xs text-red-500 mt-1">⚠️ {importErr}</div>}
                      {isImported && <div className="text-xs text-green-600 font-semibold mt-1">✓ Importado correctamente</div>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isImported && (
                        <button
                          onClick={() => importRoute(route)}
                          disabled={isImporting}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                          title={hasGpx ? 'Importar como viaje' : 'Cargar GPX e importar'}
                        >
                          {isImporting
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Download size={12} />}
                          {isImporting ? '…' : 'Importar'}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          toggleExpand(route.osmId)
                          if (!hasGpx && !route.loadingGpx) loadGpx(route)
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
                        title="Ver detalles"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 text-sm space-y-2">
                      {route.loadingGpx && (
                        <div className="flex items-center gap-2 text-slate-500">
                          <Loader2 size={13} className="animate-spin" />
                          {route.source?.startsWith('wmt') ? 'Cargando desde Waymarked Trails…'
                            : route.source === 'komoot' ? 'Cargando desde Komoot…'
                            : route.source === 'url' ? 'Descargando GPX desde URL…'
                            : 'Cargando geometría desde OSM…'}
                        </div>
                      )}
                      {route.gpxError && (
                        <div className="flex items-center gap-1 text-red-500">
                          <AlertCircle size={13} /> {route.gpxError}
                        </div>
                      )}
                      {hasGpx && (
                        <div className="flex gap-4 text-xs text-slate-600 flex-wrap">
                          <span><Globe size={12} className="inline mr-1" /><strong>{route.distanceKm} km</strong></span>
                          <span><MapPin size={12} className="inline mr-1" />{route.points!.length.toLocaleString()} puntos GPS</span>
                          {hasEle && <span style={{ color: '#16a34a' }}><Mountain size={12} className="inline mr-1" />Elevación incluida</span>}
                          <span><Route size={12} className="inline mr-1" />OSM ID: {route.osmId}</span>
                        </div>
                      )}
                      {route.description && (
                        <p className="text-slate-600 text-xs leading-relaxed">{route.description}</p>
                      )}
                      {route.operator && <div className="text-xs text-slate-500">Operador: {route.operator}</div>}
                      {route.wikipedia && (
                        <a href={`https://es.wikipedia.org/wiki/${route.wikipedia.replace('es:', '')}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                          <ExternalLink size={11} /> Wikipedia
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Load more */}
          {currentPage < totalPages && (
            <div className="mt-4 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore ? <Loader2 size={15} className="animate-spin" /> : <ChevronDown size={15} />}
                {loadingMore
                  ? 'Cargando más rutas…'
                  : `Cargar más (${totalRoutes - routes.length} restantes)`}
              </button>
            </div>
          )}
        </div>
      )}

      {!searching && routes.length === 0 && !searchError && (
        <div className="text-center py-12 text-slate-400">
          <Route size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Configura los filtros y pulsa "Buscar rutas"</p>
          <p className="text-xs mt-1 opacity-70">O usa "Buscar por nombre" para buscar en WMT, Komoot o cualquier URL GPX</p>
        </div>
      )}
    </div>
  )
}
