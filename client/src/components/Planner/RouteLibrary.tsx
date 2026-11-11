import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Search, Star, Folder, FolderOpen, Trash2, Pencil, LayoutGrid, Map as MapIcon, ChevronLeft, ChevronRight, X, Check, ArrowLeft,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { plannerApi } from '../../api/client'
import { fmtKm, type LibraryResponse, type OverviewRoute, type PlannerRouteSummary } from '../../utils/plannerRoute'
import { pageList, folderColor, filterParams, SORT_KEYS, type LibraryFilter, type SortKey } from '../../utils/plannerLibrary'
import RouteThumb from './RouteThumb'
import OverviewMap from './OverviewMap'

const PAGE_SIZE = 12

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
  border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const field: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-primary)',
  background: 'var(--bg-input, var(--bg-card))', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
}

interface Props {
  /** Se incrementa cuando algo cambia fuera de la biblioteca (guardado, borrado…) para recargar. */
  version: number
  currentId: number | null
  onOpen: (id: number) => void
  onDelete: (r: PlannerRouteSummary) => void
  /** Si hay una ruta abierta, permite volver a ella. */
  onBack?: () => void
  /** Avisa al padre cuando cambia algo (favorita, carpeta) para refrescar contadores. */
  onChanged?: () => void
}

export default function RouteLibrary({ version, currentId, onOpen, onDelete, onBack, onChanged }: Props) {
  const { t, locale } = useTranslation()
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' })
  const [page, setPage] = useState(1)
  const [view, setView] = useState<'cards' | 'map'>('cards')
  const [data, setData] = useState<LibraryResponse | null>(null)
  const [overview, setOverview] = useState<OverviewRoute[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [local, setLocal] = useState(0)            // recarga por acciones de la propia biblioteca
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const [newFolder, setNewFolder] = useState('')
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)

  // Búsqueda con retardo para no consultar en cada tecla.
  useEffect(() => {
    const h = setTimeout(() => { setQ(qInput.trim()); setPage(1) }, 300)
    return () => clearTimeout(h)
  }, [qInput])

  const params = useCallback((): Record<string, string | number> => ({
    ...(q ? { q } : {}), ...filterParams(filter),
  }), [q, filter])

  // Listado paginado.
  useEffect(() => {
    const id = ++reqId.current
    const ctrl = new AbortController()
    setLoading(true)
    plannerApi.list({ ...params(), sort, page, limit: PAGE_SIZE }, ctrl.signal)
      .then(res => {
        if (id !== reqId.current) return
        setData(res); setError(false)
        if (res.page !== page) setPage(res.page)   // la página pedida ya no existe (p. ej. tras borrar)
      })
      .catch(() => { if (id === reqId.current && !ctrl.signal.aborted) setError(true) })
      .finally(() => { if (id === reqId.current) setLoading(false) })
    return () => ctrl.abort()
  }, [params, sort, page, version, local])

  // Mapa general: solo se pide cuando se mira.
  useEffect(() => {
    if (view !== 'map') return
    const ctrl = new AbortController()
    plannerApi.overview(params(), ctrl.signal).then(r => setOverview(r.routes)).catch(() => { /* se queda como estaba */ })
    return () => ctrl.abort()
  }, [view, params, version, local])

  // Cerrar el menú de carpeta al hacer clic fuera.
  useEffect(() => {
    if (menuFor == null) return
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuFor])

  const changed = () => { setLocal(n => n + 1); onChanged?.() }

  const toggleFavorite = async (r: PlannerRouteSummary) => {
    try { await plannerApi.update(r.id, { favorite: !r.favorite }); changed() } catch { setError(true) }
  }

  const moveTo = async (r: PlannerRouteSummary, folder: string | null) => {
    setMenuFor(null); setNewFolder('')
    try { await plannerApi.update(r.id, { folder }); changed() } catch { setError(true) }
  }

  const doRename = async () => {
    if (!renaming) return
    const { from, to } = renaming
    setRenaming(null)
    const target = to.trim()
    if (!target || target === from) return
    try {
      await plannerApi.renameFolder(from, target)
      if (filter.kind === 'folder' && filter.name === from) setFilter({ kind: 'folder', name: target })
      changed()
    } catch { setError(true) }
  }

  const doRemoveFolder = async (name: string) => {
    setRemoving(null)
    try {
      await plannerApi.renameFolder(name, null)
      if (filter.kind === 'folder' && filter.name === name) setFilter({ kind: 'all' })
      changed()
    } catch { setError(true) }
  }

  const select = (f: LibraryFilter) => { setFilter(f); setPage(1) }
  const isActive = (f: LibraryFilter) =>
    f.kind === filter.kind && (f.kind !== 'folder' || (filter.kind === 'folder' && f.name === filter.name))

  const totals = data?.totals ?? { all: 0, favorites: 0, unfiled: 0 }
  const folders = data?.folders ?? []
  const hasFilter = filter.kind !== 'all' || q !== ''
  const fmtDate = (s: string) => {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale)
  }

  const sideItem = (f: LibraryFilter, icon: React.ReactNode, label: string, count: number) => (
    <button className={['!flex !items-center !gap-[8px] !w-[100%] !p-[7px_10px] !rounded-[8px] ![border:none] !cursor-pointer !text-left ![color:var(--text-primary)]', (isActive(f)) ? '![background:var(--bg-hover,_rgba(0,0,0,.06))]' : '![background:transparent]', (isActive(f)) ? '!font-[700]' : '!font-[500]', '!text-[length:13px]'].join(' ')} key={`${f.kind}-${f.kind === 'folder' ? f.name : ''}`} type="button" onClick={() => select(f)}>
      {icon}
      <span className="!flex-[1] !min-w-[0] !overflow-hidden !text-ellipsis !whitespace-nowrap">{label}</span>
      <span className="!text-[length:11px] ![color:var(--text-muted)]">{count}</span>
    </button>
  )

  const folderRows = folders.map(fo => {
    if (renaming?.from === fo.name) {
      return (
        <div className="!flex !gap-[4px] !p-[2px_4px]" key={fo.name}>
          <input className="!flex-[1] !min-w-[0] !p-[4px_8px]" autoFocus style={{ ...field }} value={renaming.to} maxLength={60}
            onChange={e => setRenaming({ from: fo.name, to: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(null) }} />
          <button className="!p-[4px]" type="button" style={{ ...btn }} onClick={doRename} aria-label={t('common.save')}><Check size={14} /></button>
        </div>
      )
    }
    if (removing === fo.name) {
      return (
        <div className="!p-[6px_10px] !text-[length:12px] ![color:var(--text-primary)] ![background:var(--bg-secondary)] !rounded-[8px]" key={fo.name}>
          {t('planner.lib.folder.removeConfirm', { name: fo.name })}
          <div className="!flex !gap-[6px] !mt-[6px]">
            <button className="![background:#dc2626] ![color:#fff] ![border-color:transparent]" type="button" style={{ ...btn }} onClick={() => doRemoveFolder(fo.name)}>{t('planner.lib.folder.yes')}</button>
            <button type="button" style={btn} onClick={() => setRemoving(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )
    }
    const active = filter.kind === 'folder' && filter.name === fo.name
    return (
      <div className="!flex !items-center" key={fo.name}>
        <div className="!flex-[1] !min-w-[0]">
          {sideItem({ kind: 'folder', name: fo.name }, <Folder size={15} style={{ color: folderColor(fo.name), flexShrink: 0 }} />, fo.name, fo.count)}
        </div>
        {active && (
          <>
            <button className="!p-[4px] ![border:none] ![background:transparent]" type="button" title={t('planner.lib.folder.rename')} aria-label={t('planner.lib.folder.rename')} style={{ ...btn }}
              onClick={() => setRenaming({ from: fo.name, to: fo.name })}><Pencil size={13} /></button>
            <button className="!p-[4px] ![border:none] ![background:transparent]" type="button" title={t('planner.lib.folder.remove')} aria-label={t('planner.lib.folder.remove')} style={{ ...btn }}
              onClick={() => setRemoving(fo.name)}><X size={14} /></button>
          </>
        )}
      </div>
    )
  })

  const sidebarItems = (
    <>
      {sideItem({ kind: 'all' }, <LayoutGrid size={15} style={{ flexShrink: 0 }} />, t('planner.lib.all'), totals.all)}
      {sideItem({ kind: 'favorites' }, <Star size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />, t('planner.lib.favorites'), totals.favorites)}
      {sideItem({ kind: 'unfiled' }, <FolderOpen size={15} style={{ flexShrink: 0 }} />, t('planner.lib.unfiled'), totals.unfiled)}
      {folders.length > 0 && <div className="!text-[length:10px] !font-[700] ![color:var(--text-muted)] !uppercase !tracking-[0.6px] !p-[10px_10px_4px]">{t('planner.lib.folders')}</div>}
      {folderRows}
    </>
  )

  const card = (r: PlannerRouteSummary) => {
    const color = folderColor(r.folder)
    const current = r.id === currentId
    return (
      <div className="!relative ![background:var(--bg-card)] !rounded-[12px] !overflow-visible" key={r.id} style={{ border: `1px solid ${current ? 'var(--accent, #e85d24)' : 'var(--border-primary)'}`, boxShadow: current ? '0 0 0 2px rgba(232,93,36,.25)' : 'none' }}>
        <div className="!cursor-pointer" role="button" tabIndex={0} onClick={() => onOpen(r.id)}
          onKeyDown={e => { if (e.key === 'Enter') onOpen(r.id) }}>
          <div className="!h-[120px] ![background:var(--bg-secondary)] ![color:var(--text-primary)] !rounded-[12px_12px_0_0] !overflow-hidden">
            <RouteThumb preview={r.preview} color={color} />
          </div>
          <div className="!p-[8px_10px_6px]">
            <div className="!text-[length:13px] !font-[700] ![color:var(--text-primary)] !leading-[1.25] !min-h-[33px] ![display:-webkit-box] ![-webkit-line-clamp:2px] ![-webkit-box-orient:vertical] !overflow-hidden" title={r.name}>{r.name}</div>
            <div className="!text-[length:11px] ![color:var(--text-muted)] !mt-[4px]">
              {fmtKm(r.total_distance_km)} · +{Math.round(r.elevation_gain)} m · {t('planner.mine.stages', { n: r.stage_count })}
            </div>
            <div className="!text-[length:10px] ![color:var(--text-faint,_var(--text-muted))] !mt-[2px]">{fmtDate(r.updated_at)}</div>
          </div>
        </div>

        <div className="!flex !items-center !gap-[4px] !p-[0_8px_8px]">
          <button className="!p-[3px_8px] !text-[length:11px] !flex-[1] !min-w-[0] !justify-start" type="button" onClick={() => setMenuFor(menuFor === r.id ? null : r.id)} title={t('planner.lib.folder.move')}
            style={{ ...btn, borderColor: r.folder ? color : 'var(--border-primary)' }}>
            <Folder size={12} style={{ color, flexShrink: 0 }} />
            <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{r.folder ?? t('planner.lib.folder.none')}</span>
          </button>
          <button className="!p-[5px] ![border:none] ![background:transparent]" type="button" aria-pressed={r.favorite} aria-label={t('planner.lib.favorite')} onClick={() => toggleFavorite(r)}
            style={{ ...btn }}>
            <Star size={16} fill={r.favorite ? '#f59e0b' : 'none'} style={{ color: r.favorite ? '#f59e0b' : 'var(--text-muted)' }} />
          </button>
          <button className="!p-[5px] ![border:none] ![background:transparent]" type="button" aria-label={t('common.delete')} onClick={() => onDelete(r)}
            style={{ ...btn }}>
            <Trash2 size={15} style={{ color: '#dc2626' }} />
          </button>
        </div>

        {menuFor === r.id && (
          <div ref={menuRef} style={{
            position: 'absolute', left: 8, right: 8, bottom: 40, zIndex: 20, background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
            borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,.25)', padding: 6, maxHeight: 220, overflowY: 'auto',
          }}>
            <button className="!w-[100%] !justify-start ![border:none] ![background:transparent]" type="button" style={{ ...btn }} onClick={() => moveTo(r, null)}>
              <FolderOpen size={14} />{t('planner.lib.folder.none')}
            </button>
            {folders.map(fo => (
              <button className="!w-[100%] !justify-start ![border:none]" key={fo.name} type="button" style={{ ...btn, background: r.folder === fo.name ? 'var(--bg-hover, rgba(0,0,0,.06))' : 'transparent' }}
                onClick={() => moveTo(r, fo.name)}>
                <Folder size={14} style={{ color: folderColor(fo.name) }} />{fo.name}
              </button>
            ))}
            <div className="!flex !gap-[4px] !p-[6px_2px_2px]">
              <input className="!flex-[1] !min-w-[0] !p-[5px_8px] !text-[length:12px]" style={{ ...field }} value={newFolder} maxLength={60}
                placeholder={t('planner.lib.folder.new')} onChange={e => setNewFolder(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newFolder.trim()) moveTo(r, newFolder.trim()) }} />
              <button className="!p-[5px]" type="button" style={{ ...btn }} disabled={!newFolder.trim()} onClick={() => moveTo(r, newFolder.trim())} aria-label={t('common.save')}><Check size={14} /></button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const pages = data?.pages ?? 1
  const from = data && data.total > 0 ? (data.page - 1) * data.limit + 1 : 0
  const to = data ? Math.min(data.total, data.page * data.limit) : 0

  return (
    <div className="!flex-[1] !min-w-[0] !flex !flex-col ![background:var(--bg-secondary)] !h-[100%]">
      {/* Barra superior */}
      <div className="!flex !flex-wrap !items-center !gap-[8px] !p-[10px_14px] ![background:var(--bg-card)] ![border-bottom:1px_solid_var(--border-primary)]">
        {onBack && (
          <button type="button" style={btn} onClick={onBack}><ArrowLeft size={14} />{t('planner.lib.back')}</button>
        )}
        <h2 className="!m-[0] !text-[length:16px] !font-[800] ![color:var(--text-primary)]">{t('planner.lib.title')}</h2>
        <div className="!relative !flex-[1_1_180px] !max-w-[340px]">
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input className="!w-[100%] !pl-[30px]" style={{ ...field }} value={qInput} placeholder={t('planner.lib.search')}
            onChange={e => setQInput(e.target.value)} />
        </div>
        <select style={field} value={sort} aria-label={t('planner.lib.sortBy')} onChange={e => { setSort(e.target.value as SortKey); setPage(1) }}>
          {SORT_KEYS.map(k => <option key={k} value={k}>{t(`planner.lib.sort.${k}`)}</option>)}
        </select>
        <div className="!flex !gap-[4px] !ml-[auto]">
          <button type="button" style={{ ...btn, background: view === 'cards' ? 'var(--accent, #e85d24)' : 'var(--bg-card)', color: view === 'cards' ? '#fff' : 'var(--text-primary)' }}
            onClick={() => setView('cards')}><LayoutGrid size={14} />{t('planner.lib.view.cards')}</button>
          <button type="button" style={{ ...btn, background: view === 'map' ? 'var(--accent, #e85d24)' : 'var(--bg-card)', color: view === 'map' ? '#fff' : 'var(--text-primary)' }}
            onClick={() => setView('map')}><MapIcon size={14} />{t('planner.lib.view.map')}</button>
        </div>
      </div>

      {/* Filtros en móvil: fila deslizable */}
      <div className="md:hidden !flex !gap-[6px] !overflow-x-auto !p-[8px_12px] ![border-bottom:1px_solid_var(--border-primary)]">
        <div className="!flex !gap-[6px]">
          {[
            { f: { kind: 'all' } as LibraryFilter, label: `${t('planner.lib.all')} (${totals.all})` },
            { f: { kind: 'favorites' } as LibraryFilter, label: `★ ${totals.favorites}` },
            { f: { kind: 'unfiled' } as LibraryFilter, label: `${t('planner.lib.unfiled')} (${totals.unfiled})` },
            ...folders.map(fo => ({ f: { kind: 'folder', name: fo.name } as LibraryFilter, label: `${fo.name} (${fo.count})` })),
          ].map(({ f, label }) => (
            <button className="!whitespace-nowrap !p-[5px_10px]" key={label} type="button" onClick={() => select(f)} style={{ ...btn, background: isActive(f) ? 'var(--accent, #e85d24)' : 'var(--bg-card)', color: isActive(f) ? '#fff' : 'var(--text-primary)' }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="!flex-[1] !min-h-[0] !flex">
        {/* Barra lateral de carpetas */}
        <nav className="hidden md:flex !flex-col !gap-[2px] !w-[220px] !shrink-[0] !p-[10px] !overflow-y-auto ![border-right:1px_solid_var(--border-primary)]">
          {sidebarItems}
        </nav>

        <div className="!flex-[1] !min-w-[0] !flex !flex-col">
          {error && (
            <div className="!m-[12px] !p-[8px_12px] !rounded-[8px] ![background:rgba(220,38,38,.1)] ![color:#dc2626] !text-[length:13px]">
              {t('planner.lib.loadError')}
            </div>
          )}

          {view === 'map' ? (
            <div className="!flex-[1] !min-h-[0] !relative">
              {overview && overview.length === 0
                ? <div className="!p-[24px] ![color:var(--text-muted)] !text-[length:13px]">{t('planner.lib.mapEmpty')}</div>
                : <OverviewMap routes={overview ?? []} openLabel={t('planner.lib.open')} onOpen={onOpen} />}
            </div>
          ) : (
            <>
              <div className="!flex-[1] !min-h-[0] !overflow-y-auto !p-[14px]">
                {data && data.total === 0 ? (
                  <div className="!text-center !p-[48px_16px] ![color:var(--text-muted)]">
                    <FolderOpen size={36} style={{ margin: '0 auto 10px' }} />
                    <div className="!text-[length:15px] !font-[700] ![color:var(--text-primary)]">
                      {hasFilter ? t('planner.lib.noResults') : t('planner.lib.empty.title')}
                    </div>
                    <div className="!text-[length:13px] !mt-[6px]">{hasFilter ? '' : t('planner.lib.empty.hint')}</div>
                    {hasFilter && (
                      <button className="!mt-[12px]" type="button" style={{ ...btn }} onClick={() => { setQInput(''); setQ(''); select({ kind: 'all' }) }}>
                        <X size={14} />{t('planner.lib.clearFilters')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="!grid ![grid-template-columns:repeat(auto-fill,_minmax(210px,_1fr))] !gap-[14px] ![transition:opacity_.15s]" style={{ opacity: loading ? 0.6 : 1 }}>
                    {data?.routes.map(card)}
                  </div>
                )}
              </div>

              {data && data.total > 0 && (
                <div className="!flex !flex-wrap !items-center !justify-between !gap-[8px] !p-[8px_14px] ![background:var(--bg-card)] ![border-top:1px_solid_var(--border-primary)]">
                  <span className="!text-[length:12px] ![color:var(--text-muted)]">{t('planner.lib.showing', { from, to, total: data.total })}</span>
                  {pages > 1 && (
                    <div className="!flex !items-center !gap-[4px]">
                      <button className="!p-[5px_8px]" type="button" style={{ ...btn }} disabled={page <= 1} aria-label={t('planner.lib.prev')} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={14} /></button>
                      {pageList(page, pages).map((n, i) => n === '…'
                        ? <span className="!p-[0_4px] ![color:var(--text-muted)]" key={`e${i}`}>…</span>
                        : <button className="!p-[5px_9px] !min-w-[30px]" key={n} type="button" aria-current={n === page} onClick={() => setPage(n)}
                            style={{ ...btn, background: n === page ? 'var(--accent, #e85d24)' : 'var(--bg-card)', color: n === page ? '#fff' : 'var(--text-primary)' }}>{n}</button>)}
                      <button className="!p-[5px_8px]" type="button" style={{ ...btn }} disabled={page >= pages} aria-label={t('planner.lib.next')} onClick={() => setPage(p => Math.min(pages, p + 1))}><ChevronRight size={14} /></button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
