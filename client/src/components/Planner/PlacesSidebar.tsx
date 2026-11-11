import { useSettingsStore } from '../../store/settingsStore'
import { isNavAppId, navAppName, navUrl, type NavPlace } from '../../utils/navApps'
import React from 'react'
import ReactDOM from 'react-dom'
import { useState, useMemo, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Search, Plus, X, CalendarDays, Pencil, Trash2, ExternalLink, Navigation, Upload, ChevronDown, Check, MapPin, Eye, Route, Sparkles } from 'lucide-react'
import PlaceAvatar from '../shared/PlaceAvatar'
import { getCategoryIcon } from '../shared/categoryIcons'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { useContextMenu, ContextMenu } from '../shared/ContextMenu'
import { placesApi } from '../../api/client'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useAuthStore } from '../../store/authStore'
import type { Place, Category, Day, AssignmentsMap } from '../../types'
import FileImportModal from './FileImportModal'
import ToggleSwitch from '../Settings/ToggleSwitch'
import ConfirmDialog from '../shared/ConfirmDialog'
import Tooltip from '../shared/Tooltip'
import MustSeeSuggestionsModal from './MustSeeSuggestionsModal'

interface PlacesSidebarProps {
  tripId: number | string
  places: Place[]
  categories: Category[]
  assignments: AssignmentsMap
  selectedDayId: number | null
  selectedPlaceId: number | null
  onPlaceClick: (placeId: number | null) => void
  onAddPlace: () => void
  onAssignToDay: (placeId: number, dayId: number) => void
  onEditPlace: (place: Place) => void
  onDeletePlace: (placeId: number) => void
  onBulkDeletePlaces?: (ids: number[]) => void
  onBulkDeleteConfirm?: (ids: number[]) => void
  days: Day[]
  isMobile?: boolean
  onCategoryFilterChange?: (categoryIds: Set<string>) => void
  onPlacesFilterChange?: (filter: string) => void
  pushUndo?: (label: string, undoFn: () => Promise<void> | void) => void
  initialScrollTop?: number
  onScrollTopChange?: (top: number) => void
}

interface MemoPlaceRowProps {
  place: Place
  category: Category | undefined
  isSelected: boolean
  isPlanned: boolean
  inDay: boolean
  isChecked: boolean
  selectMode: boolean
  selectedDayId: number | null
  canEditPlaces: boolean
  isMobile: boolean
  t: (key: string, params?: Record<string, any>) => string
  onPlaceClick: (id: number | null) => void
  onContextMenu: (e: React.MouseEvent, place: Place) => void
  onAssignToDay: (placeId: number, dayId?: number) => void
  toggleSelected: (id: number) => void
  setDayPickerPlace: (place: any) => void
}

const MemoPlaceRow = React.memo(function MemoPlaceRow({
  place, category: cat, isSelected, isPlanned, inDay, isChecked,
  selectMode, selectedDayId, canEditPlaces, isMobile, t,
  onPlaceClick, onContextMenu, onAssignToDay, toggleSelected, setDayPickerPlace,
}: MemoPlaceRowProps) {
  const hasGeometry = Boolean(place.route_geometry)
  return (
    <div className={[(!isSelected && !isChecked) ? 'trek-hover' : undefined, '!flex !items-center !gap-[10px] !p-[9px_14px_9px_16px] ![border-bottom:1px_solid_var(--border-faint)] ![transition:background_0.1s] ![content-visibility:auto] ![contain-intrinsic-size:0_52px]'].join(' ')}
      key={place.id}
      draggable={!selectMode}
      onDragStart={e => {
        e.dataTransfer.setData('placeId', String(place.id))
        e.dataTransfer.effectAllowed = 'copy'
        window.__dragData = { placeId: String(place.id) }
      }}
      onClick={() => {
        if (selectMode) {
          toggleSelected(place.id)
        } else if (isMobile) {
          setDayPickerPlace(place)
        } else {
          onPlaceClick(isSelected ? null : place.id)
        }
      }}
      onContextMenu={selectMode ? undefined : e => onContextMenu(e, place)}
      style={{ cursor: selectMode ? 'pointer' : 'grab', background: isChecked ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : isSelected ? 'var(--border-faint)' : 'transparent' }} >
      {selectMode && (
        <div className="!w-[16px] !h-[16px] !rounded-[4px] !shrink-[0] !flex !items-center !justify-center" style={{ border: isChecked ? 'none' : '1.5px solid var(--border-primary)', background: isChecked ? 'var(--accent)' : 'transparent' }}>
          {isChecked && <Check size={10} strokeWidth={3} color="white" />}
        </div>
      )}
      <PlaceAvatar place={place} category={cat} size={34} />
      <div className="!flex-[1] !min-w-[0]">
        <div className="!flex !items-center !gap-[5px] !overflow-hidden">
          {hasGeometry && <Route size={11} strokeWidth={2} color="var(--text-faint)" style={{ flexShrink: 0 }} aria-label="Track / Route" />}
          {cat && (() => {
            const CatIcon = getCategoryIcon(cat.icon)
            return <CatIcon size={11} strokeWidth={2} color={cat.color || '#6366f1'} style={{ flexShrink: 0 }} aria-label={cat.name} />
          })()}
          <span className="!text-[length:13px] !font-[500] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap !leading-[1.2]">
            {place.name}
          </span>
        </div>
        {(place.description || place.address || cat?.name) && (
          <div className="!mt-[2px]">
            <span className="!text-[length:11px] ![color:var(--text-faint)] !overflow-hidden !text-ellipsis !whitespace-nowrap !block !leading-[1.2]">
              {place.description || place.address || cat?.name}
            </span>
          </div>
        )}
      </div>
      <div className="!shrink-[0] !flex !items-center">
        {!selectMode && !inDay && selectedDayId && (
          <button className="trek-h-background-abc7f5 trek-h-color-f780f2 !flex !items-center !justify-center !w-[20px] !h-[20px] !rounded-[6px] ![border:none] !cursor-pointer ![color:var(--text-faint)] !p-[0] ![transition:background_0.15s,_color_0.15s]"
            onClick={e => { e.stopPropagation(); onAssignToDay(place.id) }}
            style={{ background: 'var(--bg-hover)' }} ><Plus size={12} strokeWidth={2.5} /></button>
        )}
      </div>
    </div>
  )
})

const PlacesSidebar = React.memo(function PlacesSidebar({
  tripId, places, categories, assignments, selectedDayId, selectedPlaceId,
  onPlaceClick, onAddPlace, onAssignToDay, onEditPlace, onDeletePlace, onBulkDeletePlaces, onBulkDeleteConfirm, days, isMobile, onCategoryFilterChange, onPlacesFilterChange, pushUndo,
  initialScrollTop, onScrollTopChange,
}: PlacesSidebarProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const ctxMenu = useContextMenu()
  const trip = useTripStore((s) => s.trip)
  const loadTrip = useTripStore((s) => s.loadTrip)
  const can = useCanDo()
  const canEditPlaces = can('place_edit', trip)
  // Places-API enrichment (#886) needs a Google Maps key; gate the toggle on it.
  const canEnrichImport = useAuthStore((s) => s.hasMapsKey)
  const isNaverListImportEnabled = true

  const [mustSeeOpen, setMustSeeOpen] = useState(false)
  const [fileImportOpen, setFileImportOpen] = useState(false)
  const [sidebarDropFile, setSidebarDropFile] = useState<File | null>(null)
  const [sidebarDragOver, setSidebarDragOver] = useState(false)
  const sidebarDragCounter = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (scrollContainerRef.current && initialScrollTop) {
      scrollContainerRef.current.scrollTop = initialScrollTop
    }
  }, [])

  const handleSidebarDragEnter = (e: React.DragEvent) => {
    if (!canEditPlaces) return
    e.preventDefault()
    sidebarDragCounter.current++
    setSidebarDragOver(true)
  }

  const handleSidebarDragOver = (e: React.DragEvent) => {
    if (!canEditPlaces) return
    e.preventDefault()
  }

  const handleSidebarDragLeave = () => {
    sidebarDragCounter.current--
    if (sidebarDragCounter.current === 0) setSidebarDragOver(false)
  }

  const handleSidebarDrop = (e: React.DragEvent) => {
    e.preventDefault()
    sidebarDragCounter.current = 0
    setSidebarDragOver(false)
    if (!canEditPlaces) return
    const f = e.dataTransfer.files[0]
    if (!f) return
    setSidebarDropFile(f)
    setFileImportOpen(true)
  }

  const [listImportOpen, setListImportOpen] = useState(false)
  const [listImportUrl, setListImportUrl] = useState('')
  const [listImportLoading, setListImportLoading] = useState(false)
  const [listImportProvider, setListImportProvider] = useState<'google' | 'naver'>('google')
  const [listImportEnrich, setListImportEnrich] = useState(false)
  const availableListImportProviders: Array<'google' | 'naver'> = isNaverListImportEnabled ? ['google', 'naver'] : ['google']
  const hasMultipleListImportProviders = availableListImportProviders.length > 1

  useEffect(() => {
    if (!isNaverListImportEnabled && listImportProvider === 'naver') {
      setListImportProvider('google')
    }
  }, [isNaverListImportEnabled, listImportProvider])

  const handleListImport = async () => {
    if (!listImportUrl.trim()) return
    setListImportLoading(true)
    const provider = listImportProvider === 'naver' && isNaverListImportEnabled ? 'naver' : 'google'
    try {
      const enrich = listImportEnrich && canEnrichImport
      const result = provider === 'google'
        ? await placesApi.importGoogleList(tripId, listImportUrl.trim(), enrich)
        : await placesApi.importNaverList(tripId, listImportUrl.trim(), enrich)
      await loadTrip(tripId)
      if (result.count === 0 && result.skipped > 0) {
        toast.warning(t('places.importAllSkipped'))
      } else {
        toast.success(t(provider === 'google' ? 'places.googleListImported' : 'places.naverListImported', { count: result.count, list: result.listName }))
      }
      setListImportOpen(false)
      setListImportUrl('')
      if (result.places?.length > 0) {
        const importedIds: number[] = result.places.map((p: { id: number }) => p.id)
        pushUndo?.(t(provider === 'google' ? 'undo.importGoogleList' : 'undo.importNaverList'), async () => {
          try { await placesApi.bulkDelete(tripId, importedIds) } catch {}
          await loadTrip(tripId)
        })
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || t(provider === 'google' ? 'places.googleListError' : 'places.naverListError'))
    } finally {
      setListImportLoading(false)
    }
  }

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [categoryFilters, setCategoryFiltersLocal] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [pendingDeleteIds, setPendingDeleteIds] = useState<number[] | null>(null)

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }

  // Auto-exit when all selected places have been removed from the store (e.g. after bulk delete)
  useEffect(() => {
    if (!selectMode || selectedIds.size === 0) return
    const placeIdSet = new Set(places.map(p => p.id))
    if ([...selectedIds].every(id => !placeIdSet.has(id))) {
      setSelectMode(false)
      setSelectedIds(new Set())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places])

  const toggleSelected = useCallback((id: number) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }), [])

  const toggleCategoryFilter = (catId: string) => {
    setCategoryFiltersLocal(prev => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId); else next.add(catId)
      onCategoryFilterChange?.(next)
      return next
    })
  }
  const [dayPickerPlace, setDayPickerPlace] = useState(null)
  const [catDropOpen, setCatDropOpen] = useState(false)
  const [mobileShowDays, setMobileShowDays] = useState(false)

  // Alle geplanten Ort-IDs abrufen (einem Tag zugewiesen)
  const hasTracks = useMemo(() => places.some(p => p.route_geometry), [places])
  useEffect(() => { if (filter === 'tracks' && !hasTracks) setFilter('all') }, [hasTracks, filter])

  const plannedIds = useMemo(() => new Set(
    Object.values(assignments).flatMap(da => da.map(a => a.place?.id).filter(Boolean))
  ), [assignments])

  const filtered = useMemo(() => places.filter(p => {
    // Tours live in their own tab; in the pool they only show among the tracks.
    if (p.tour_type && filter !== 'tracks') return false
    if (filter === 'unplanned' && plannedIds.has(p.id)) return false
    if (filter === 'tracks' && !p.route_geometry) return false
    if (categoryFilters.size > 0) {
      if (p.category_id == null) {
        if (!categoryFilters.has('uncategorized')) return false
      } else if (!categoryFilters.has(String(p.category_id))) return false
    }
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
        !(p.address || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [places, filter, categoryFilters, search, plannedIds])

  const isAssignedToSelectedDay = (placeId) =>
    selectedDayId && (assignments[String(selectedDayId)] || []).some(a => a.place?.id === placeId)

  const selectedDayIdRef = useRef<number | null>(selectedDayId)
  useEffect(() => { selectedDayIdRef.current = selectedDayId }, [selectedDayId])

  const inDaySet = useMemo(() => {
    if (!selectedDayId) return new Set<number>()
    return new Set<number>((assignments[String(selectedDayId)] || []).map((a: any) => a.place?.id).filter(Boolean))
  }, [assignments, selectedDayId])

  const openContextMenu = useCallback((e: React.MouseEvent, place: Place) => {
    const selDayId = selectedDayIdRef.current
    ctxMenu.open(e, [
      canEditPlaces && { label: t('common.edit'), icon: Pencil, onClick: () => onEditPlace(place) },
      selDayId && { label: t('planner.addToDay'), icon: CalendarDays, onClick: () => onAssignToDay(place.id, selDayId) },
      place.website && { label: t('inspector.website'), icon: ExternalLink, onClick: () => window.open(place.website, '_blank') },
      (place.lat && place.lng) && { label: navAppName(useSettingsStore.getState().settings.preferred_nav_app) ?? 'Google Maps', icon: Navigation, onClick: () => { const pref = useSettingsStore.getState().settings.preferred_nav_app; const url = navUrl(isNavAppId(pref) ? pref : 'google', place as NavPlace); if (url) window.open(url, '_blank') } },
      { divider: true },
      canEditPlaces && { label: t('common.delete'), icon: Trash2, danger: true, onClick: () => onDeletePlace(place.id) },
    ])
  }, [ctxMenu.open, canEditPlaces, t, onEditPlace, onAssignToDay, onDeletePlace])

  return (
    <div className="!flex !flex-col !h-[100%] !relative"
      onDragEnter={handleSidebarDragEnter}
      onDragOver={handleSidebarDragOver}
      onDragLeave={handleSidebarDragLeave}
      onDrop={handleSidebarDrop}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
    >
      {sidebarDragOver && (
        <div className="!absolute !inset-[0] !z-[10] ![border:2px_dashed_var(--accent)] !rounded-[4px] !flex !flex-col !items-center !justify-center !gap-[10px] !pointer-events-none" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
          <Upload size={28} strokeWidth={1.5} color="var(--accent)" />
          <span className="!text-[length:13px] !font-[600] ![color:var(--accent)]">{t('places.sidebarDrop')}</span>
        </div>
      )}
      {/* Kopfbereich */}
      <div className="!p-[14px_16px_10px] ![border-bottom:1px_solid_var(--border-faint)] !shrink-[0]">
        {canEditPlaces && <button className="!flex !items-center !justify-center !gap-[6px] !w-[100%] !p-[8px_12px] !rounded-[12px] ![border:none] ![color:var(--accent-text)] !text-[length:13px] !font-[500] !cursor-pointer ![font-family:inherit] !mb-[10px]"
          onClick={onAddPlace}
          style={{ background: 'var(--accent)' }}
        >
          <Plus size={14} strokeWidth={2} /> {t('places.addPlace')}
        </button>}
        {canEditPlaces && <>
        <div className="!flex !gap-[6px] !mb-[6px]">
          <button className="!flex !items-center !justify-center !gap-[5px] !flex-[1] !p-[5px_12px] !rounded-[8px] ![border:1px_dashed_var(--border-primary)] ![color:var(--text-faint)] !text-[length:11px] !font-[500] !cursor-pointer ![font-family:inherit]"
            onClick={() => setFileImportOpen(true)}
            style={{ background: 'none' }}
          >
            <Upload size={11} strokeWidth={2} /> {t('places.importFile')}
          </button>
          <button className="!flex !items-center !justify-center !gap-[5px] !flex-[1] !p-[5px_12px] !rounded-[8px] ![border:1px_dashed_var(--border-primary)] ![color:var(--text-faint)] !text-[length:11px] !font-[500] !cursor-pointer ![font-family:inherit]"
            onClick={() => setListImportOpen(true)}
            style={{ background: 'none' }}
          >
            <MapPin size={11} strokeWidth={2} /> {t(hasMultipleListImportProviders ? 'places.importList' : 'places.importGoogleList')}
          </button>
        </div>
        {/* ✨ Must See — AI suggestions */}
        <button className="trek-h-background-892a31 !flex !items-center !justify-center !gap-[6px] !w-[100%] !p-[6px_12px] !rounded-[8px] !mb-[10px] ![border:1px_solid_#f59e0b44] ![color:#b45309] !text-[length:11px] !font-[600] !cursor-pointer ![font-family:inherit] ![transition:background_0.15s]"
          onClick={() => setMustSeeOpen(true)}
          style={{ background: '#fef3c71a' }} >
          <Sparkles size={11} strokeWidth={2} />
          ✨ Lugares imprescindibles (IA)
        </button>
        <div className="!h-[1px] !m-[2px_0_10px]" style={{ background: 'var(--border-primary)' }} />
        </>}

        {/* Filter-Tabs */}
        {(() => {
          const baseFiltered = places.filter(p => {
            if (categoryFilters.size > 0) {
              if (p.category_id == null) {
                if (!categoryFilters.has('uncategorized')) return false
              } else if (!categoryFilters.has(String(p.category_id))) return false
            }
            if (search && !p.name.toLowerCase().includes(search.toLowerCase()) &&
                !(p.address || '').toLowerCase().includes(search.toLowerCase())) return false
            return true
          })
          const counts = {
            all: baseFiltered.filter(p => !p.tour_type).length,
            unplanned: baseFiltered.filter(p => !p.tour_type && !plannedIds.has(p.id)).length,
            tracks: baseFiltered.filter(p => p.route_geometry).length,
          }
          const tabs = ([
            { id: 'all', label: t('places.all') },
            { id: 'unplanned', label: t('places.unplanned') },
            hasTracks ? { id: 'tracks', label: t('places.filterTracks') } : null,
          ] as const).filter(Boolean) as Array<{ id: 'all' | 'unplanned' | 'tracks'; label: string }>
          return (
            <div className="!flex !gap-[6px] !mb-[8px] !flex-wrap">
              {tabs.map(f => {
                const active = filter === f.id
                return (
                  <button className="![appearance:none] ![border:none] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !gap-[5px] !p-[4px_9px] !rounded-[99px] !text-[length:11px] !font-[500] !whitespace-nowrap ![transition:background_0.15s,_color_0.15s,_box-shadow_0.15s]"
                    key={f.id}
                    onClick={() => { setFilter(f.id); onPlacesFilterChange?.(f.id); setSelectedIds(new Set()) }}
                    style={{ background: active ? 'var(--accent)' : 'var(--bg-card)', color: active ? 'var(--accent-text)' : 'var(--text-primary)', boxShadow: active ? 'none' : '0 1px 2px rgba(0,0,0,0.06)' }}
                  >
                    {f.label}
                    <span className="!text-[length:9px] !font-[600] !leading-[1] !p-[1px_5px] !rounded-[99px] !min-w-[14px] !text-center" style={{ background: active ? 'color-mix(in srgb, var(--accent-text) 22%, transparent)' : 'var(--bg-tertiary)', color: active ? 'var(--accent-text)' : 'var(--text-faint)' }}>
                      {counts[f.id]}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })()}

        {/* Suchfeld */}
        <div className="!relative">
          <Search size={13} strokeWidth={1.8} color="var(--text-faint)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input className="!w-[100%] !p-[7px_30px_7px_30px] !rounded-[10px] ![border:none] !text-[length:12px] ![color:var(--text-primary)] ![outline:none] ![font-family:inherit] !box-border"
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); if (selectMode) setSelectedIds(new Set()) }}
            placeholder={t('places.search')}
            style={{ background: 'var(--bg-tertiary)' }}
          />
          {search && (
            <button className="!absolute !right-[8px] !top-[50%] ![border:none] !cursor-pointer !p-[0] !flex" onClick={() => setSearch('')} style={{ transform: 'translateY(-50%)', background: 'none' }}>
              <X size={12} strokeWidth={2} color="var(--text-faint)" />
            </button>
          )}
        </div>

        {/* Category multi-select dropdown */}
        {categories.length > 0 && (() => {
          const label = categoryFilters.size === 0
            ? t('places.allCategories')
            : categoryFilters.size === 1
              ? (categoryFilters.has('uncategorized') ? t('places.noCategory') : categories.find(c => categoryFilters.has(String(c.id)))?.name || t('places.allCategories'))
              : `${categoryFilters.size} ${t('places.categoriesSelected')}`
          return (
            <div className="!mt-[6px] !relative !flex !gap-[6px] !items-stretch">
              <button className="!flex-[1] !min-w-[0] !flex !items-center !justify-between !p-[6px_10px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] !text-[length:12px] ![color:var(--text-primary)] !cursor-pointer ![font-family:inherit]" onClick={() => setCatDropOpen(v => !v)} style={{ background: 'var(--bg-card)' }}>
                <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{label}</span>
                <ChevronDown size={12} style={{ flexShrink: 0, color: 'var(--text-faint)', transform: catDropOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
              {canEditPlaces && (
                <Tooltip label={t('common.select')} placement="bottom">
                <button className="!relative !w-[30px] !shrink-[0] !rounded-[8px] !cursor-pointer ![font-family:inherit] !p-[0] ![transition:background_0.18s,_color_0.18s,_border-color_0.18s] !overflow-hidden"
                  onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()) }}
                  aria-label={t('common.select')}
                  aria-pressed={selectMode}
                  style={{ border: `1px solid ${selectMode ? 'var(--accent)' : 'var(--border-primary)'}`, background: selectMode ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-card)', color: selectMode ? 'var(--accent)' : 'var(--text-faint)' }}
                >
                  <span className="!absolute !inset-[0] !flex !items-center !justify-center ![transition:opacity_0.18s_ease,_transform_0.22s_cubic-bezier(0.34,_1.56,_0.64,_1)]" style={{ opacity: selectMode ? 0 : 1, transform: selectMode ? 'rotate(-90deg) scale(0.6)' : 'rotate(0) scale(1)' }}>
                    <Check size={13} strokeWidth={2.4} />
                  </span>
                  <span className="!absolute !inset-[0] !flex !items-center !justify-center ![transition:opacity_0.18s_ease,_transform_0.22s_cubic-bezier(0.34,_1.56,_0.64,_1)]" style={{ opacity: selectMode ? 1 : 0, transform: selectMode ? 'rotate(0) scale(1)' : 'rotate(90deg) scale(0.6)' }}>
                    <X size={13} strokeWidth={2.4} />
                  </span>
                </button>
                </Tooltip>
              )}
              {catDropOpen && (
                <div className="!absolute !top-[100%] !left-[0] !right-[0] !z-[50] !mt-[4px] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !max-h-[200px] !overflow-y-auto" style={{ background: 'var(--bg-card)' }}>
                  {categories.map(c => {
                    const active = categoryFilters.has(String(c.id))
                    const CatIcon = getCategoryIcon(c.icon)
                    return (
                      <button className="!flex !items-center !gap-[8px] !w-[100%] !p-[6px_10px] !rounded-[6px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12px] ![color:var(--text-primary)] !text-left" key={c.id} onClick={() => toggleCategoryFilter(String(c.id))} style={{ background: active ? 'var(--bg-hover)' : 'transparent' }}>
                        <div className="!w-[16px] !h-[16px] !rounded-[4px] !shrink-[0] !flex !items-center !justify-center" style={{ border: active ? 'none' : '1.5px solid var(--border-primary)', background: active ? (c.color || 'var(--accent)') : 'transparent' }}>
                          {active && <Check size={10} strokeWidth={3} color="white" />}
                        </div>
                        <CatIcon size={12} strokeWidth={2} color={c.color || 'var(--text-muted)'} />
                        <span className="!flex-[1]">{c.name}</span>
                      </button>
                    )
                  })}
                  {places.some(p => p.category_id == null) && (() => {
                    const active = categoryFilters.has('uncategorized')
                    return (
                      <button className="!flex !items-center !gap-[8px] !w-[100%] !p-[6px_10px] !rounded-[6px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12px] ![color:var(--text-muted)] !text-left [&&]:![border-top:1px_solid_var(--border-faint)] !mt-[2px]" onClick={() => toggleCategoryFilter('uncategorized')} style={{ background: active ? 'var(--bg-hover)' : 'transparent' }}>
                        <div className="!w-[16px] !h-[16px] !rounded-[4px] !shrink-[0] !flex !items-center !justify-center" style={{ border: active ? 'none' : '1.5px solid var(--border-primary)', background: active ? 'var(--text-faint)' : 'transparent' }}>
                          {active && <Check size={10} strokeWidth={3} color="white" />}
                        </div>
                        <MapPin size={12} strokeWidth={2} color="var(--text-faint)" />
                        <span className="!flex-[1]">{t('places.noCategory')}</span>
                      </button>
                    )
                  })()}
                  {categoryFilters.size > 0 && (
                    <button className="!flex !items-center !justify-center !gap-[4px] !w-[100%] !p-[6px_10px] !rounded-[6px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:11px] ![color:var(--text-faint)] !mt-[2px] [&&]:![border-top:1px_solid_var(--border-faint)]" onClick={() => { setCategoryFiltersLocal(new Set()); onCategoryFilterChange?.(new Set()) }} style={{ background: 'transparent' }}>
                      <X size={10} /> {t('places.clearFilter')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Anzahl / Auswahl-Leiste */}
      {selectMode ? (
        <div className="!m-[6px_16px] !p-[5px_8px_5px_10px] !rounded-[8px] !flex !items-center !gap-[4px] !shrink-[0] !text-[length:11px]" style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}>
          <span className="!flex-[1] ![color:var(--accent)] !font-[600] !whitespace-nowrap !overflow-hidden !text-ellipsis">
            {t('places.selectionCount', { count: selectedIds.size })}
          </span>
          <Tooltip label={selectedIds.size === filtered.length && filtered.length > 0 ? t('common.deselectAll') : t('common.selectAll')} placement="bottom">
          <button className="trek-hover !flex !items-center !justify-center !w-[24px] !h-[24px] !rounded-[6px] ![border:none] ![color:var(--text-muted)] !cursor-pointer !p-[0]"
            onClick={() => {
              if (selectedIds.size === filtered.length) setSelectedIds(new Set())
              else setSelectedIds(new Set(filtered.map(p => p.id)))
            }}
            aria-label={selectedIds.size === filtered.length && filtered.length > 0 ? t('common.deselectAll') : t('common.selectAll')}
            style={{ background: 'transparent' }} >
            <Check size={13} strokeWidth={2.2} />
          </button>
          </Tooltip>
          <Tooltip label={t('places.deleteSelected')} placement="bottom">
          <button
            onClick={() => {
              if (selectedIds.size === 0) return
              if (isMobile) setPendingDeleteIds(Array.from(selectedIds))
              else onBulkDeletePlaces?.(Array.from(selectedIds))
            }}
            disabled={selectedIds.size === 0}
            aria-label={t('places.deleteSelected')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 6, border: 'none',
              background: 'transparent',
              color: selectedIds.size > 0 ? '#ef4444' : 'var(--text-faint)',
              cursor: selectedIds.size > 0 ? 'pointer' : 'default', padding: 0,
            }}
            onMouseEnter={e => { if (selectedIds.size > 0) e.currentTarget.style.background = 'color-mix(in srgb, #ef4444 14%, transparent)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
          </Tooltip>
        </div>
      ) : (
        <div className="!p-[6px_16px] !shrink-[0]">
          <span className="!text-[length:11px] ![color:var(--text-faint)]">{filtered.length === 1 ? t('places.countSingular') : t('places.count', { count: filtered.length })}</span>
        </div>
      )}

      {/* Liste */}
      <div className="trek-stagger" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }} ref={scrollContainerRef} onScroll={(e) => onScrollTopChange?.((e.currentTarget as HTMLElement).scrollTop)}>
        {filtered.length === 0 ? (
          <div className="!flex !flex-col !items-center !p-[40px_16px] !gap-[8px]">
            <span className="!text-[length:13px] ![color:var(--text-faint)]">
              {filter === 'unplanned' ? t('places.allPlanned') : t('places.noneFound')}
            </span>
            {canEditPlaces && <button className="!text-[length:12px] ![color:var(--text-primary)] ![border:none] !cursor-pointer ![text-decoration:underline] ![font-family:inherit]" onClick={onAddPlace} style={{ background: 'none' }}>
              {t('places.addPlace')}
            </button>}
          </div>
        ) : (
          filtered.map(place => {
            const cat = categories.find(c => c.id === place.category_id)
            const isSelected = place.id === selectedPlaceId
            const isPlanned = plannedIds.has(place.id)
            const inDay = inDaySet.has(place.id)
            const isChecked = selectedIds.has(place.id)
            return (
              <MemoPlaceRow
                key={place.id}
                place={place}
                category={cat}
                isSelected={isSelected}
                isPlanned={isPlanned}
                inDay={inDay}
                isChecked={isChecked}
                selectMode={selectMode}
                selectedDayId={selectedDayId}
                canEditPlaces={canEditPlaces}
                isMobile={isMobile}
                t={t}
                onPlaceClick={onPlaceClick}
                onContextMenu={openContextMenu}
                onAssignToDay={onAssignToDay}
                toggleSelected={toggleSelected}
                setDayPickerPlace={setDayPickerPlace}
              />
            )
          })
        )}
      </div>

      {dayPickerPlace && ReactDOM.createPortal(
        <div className="!fixed !inset-[0] !z-[99999] ![backdrop-filter:blur(12px)_saturate(150%)] ![-webkit-backdrop-filter:blur(12px)_saturate(150%)] !flex !items-end !justify-center"
          onClick={() => { setDayPickerPlace(null); setMobileShowDays(false) }}
          style={{ background: 'var(--modal-backdrop)' }}
        >
          <div className="![backdrop-filter:var(--glass-blur-lg)] ![-webkit-backdrop-filter:var(--glass-blur-lg)] ![border:1px_solid_var(--modal-border)] [&&]:![border-bottom:none] ![box-shadow:var(--glass-shadow-lg)] !rounded-[20px_20px_0_0] !w-[100%] !max-w-[500px] !max-h-[70vh] !flex !flex-col !overflow-hidden !pb-[var(--bottom-nav-h)]"
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--modal-bg)' }}
          >
            <div className="!p-[16px_20px_12px] ![border-bottom:1px_solid_var(--border-secondary)]">
              <div className="!text-[length:15px] !font-[700] ![color:var(--text-primary)]">{dayPickerPlace.name}</div>
              {dayPickerPlace.address && <div className="!text-[length:12px] ![color:var(--text-faint)] !mt-[2px]">{dayPickerPlace.address}</div>}
            </div>
            <div className="!overflow-y-auto !p-[8px_12px]">
              {/* View details */}
              <button className="!flex !items-center !gap-[12px] !w-[100%] !p-[12px_14px] !rounded-[12px] ![border:none] !cursor-pointer ![font-family:inherit] !text-left !text-[length:14px] ![color:var(--text-primary)]"
                onClick={() => { onPlaceClick(dayPickerPlace.id); setDayPickerPlace(null); setMobileShowDays(false) }}
                style={{ background: 'transparent' }}
              >
                <Eye size={18} color="var(--text-muted)" /> {t('places.viewDetails')}
              </button>
              {/* Edit */}
              {canEditPlaces && (
                <button className="!flex !items-center !gap-[12px] !w-[100%] !p-[12px_14px] !rounded-[12px] ![border:none] !cursor-pointer ![font-family:inherit] !text-left !text-[length:14px] ![color:var(--text-primary)]"
                  onClick={() => { onEditPlace(dayPickerPlace); setDayPickerPlace(null); setMobileShowDays(false) }}
                  style={{ background: 'transparent' }}
                >
                  <Pencil size={18} color="var(--text-muted)" /> {t('common.edit')}
                </button>
              )}
              {/* Assign to day */}
              {days?.length > 0 && (
                <>
                  <button className="!flex !items-center !gap-[12px] !w-[100%] !p-[12px_14px] !rounded-[12px] ![border:none] !cursor-pointer ![font-family:inherit] !text-left !text-[length:14px] ![color:var(--text-primary)]"
                    onClick={() => setMobileShowDays(v => !v)}
                    style={{ background: 'transparent' }}
                  >
                    <CalendarDays size={18} color="var(--text-muted)" /> {t('places.assignToDay')}
                    <ChevronDown size={14} style={{ marginLeft: 'auto', color: 'var(--text-faint)', transform: mobileShowDays ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>
                  {mobileShowDays && (
                    <div className="!pl-[20px]">
                      {days.map((day, i) => (
                        <button className="!flex !items-center !gap-[10px] !w-[100%] !p-[10px_14px] !rounded-[10px] ![border:none] !cursor-pointer ![font-family:inherit] !text-left"
                          key={day.id}
                          onClick={() => { onAssignToDay(dayPickerPlace.id, day.id); setDayPickerPlace(null); setMobileShowDays(false) }}
                          style={{ background: 'transparent' }}
                        >
                          <div className="!w-[28px] !h-[28px] !rounded-[50%] !flex !items-center !justify-center !text-[length:12px] !font-[700] ![color:var(--text-primary)] !shrink-[0]" style={{ background: 'var(--bg-tertiary)' }}>{i + 1}</div>
                          <div className="!flex-[1] !min-w-[0]">
                            <div className="!text-[length:13px] !font-[500] ![color:var(--text-primary)]">{day.title || t('dayplan.dayN', { n: i + 1 })}</div>
                            {day.date && <div className="!text-[length:11px] ![color:var(--text-faint)]">{new Date(day.date + 'T00:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC' })}</div>}
                          </div>
                          {(assignments[String(day.id)] || []).some(a => a.place?.id === dayPickerPlace.id) && <Check size={14} color="var(--text-faint)" />}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {/* Delete */}
              {canEditPlaces && (
                <button className="!flex !items-center !gap-[12px] !w-[100%] !p-[12px_14px] !rounded-[12px] ![border:none] !cursor-pointer ![font-family:inherit] !text-left !text-[length:14px] ![color:#ef4444]"
                  onClick={() => { onDeletePlace(dayPickerPlace.id); setDayPickerPlace(null); setMobileShowDays(false) }}
                  style={{ background: 'transparent' }}
                >
                  <Trash2 size={18} /> {t('common.delete')}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {listImportOpen && ReactDOM.createPortal(
        <div className="!fixed !inset-[0] !z-[99999] ![backdrop-filter:blur(12px)_saturate(150%)] ![-webkit-backdrop-filter:blur(12px)_saturate(150%)] !flex !items-center !justify-center !p-[16px]"
          onClick={() => { setListImportOpen(false); setListImportUrl('') }}
          style={{ background: 'var(--modal-backdrop)' }}
        >
          <div className="![backdrop-filter:var(--glass-blur-lg)] ![-webkit-backdrop-filter:var(--glass-blur-lg)] ![border:1px_solid_var(--modal-border)] !rounded-[16px] !w-[100%] !max-w-[440px] !p-[24px] ![box-shadow:var(--modal-shadow)]"
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--modal-bg)' }}
          >
            <div className="!text-[length:15px] !font-[700] ![color:var(--text-primary)] !mb-[4px]">
              {t('places.importList')}
            </div>
            {hasMultipleListImportProviders && (
              <div className="!flex !gap-[6px] !mb-[10px]">
                {availableListImportProviders.map(provider => (
                  <button className="!p-[6px_10px] !rounded-[20px] ![border:none] !cursor-pointer !text-[length:11px] !font-[600] ![font-family:inherit]"
                    key={provider}
                    onClick={() => setListImportProvider(provider)}
                    style={{ background: listImportProvider === provider ? 'var(--accent)' : 'var(--bg-tertiary)', color: listImportProvider === provider ? 'var(--accent-text)' : 'var(--text-muted)' }}
                  >
                    {provider === 'google' ? t('places.importGoogleList') : t('places.importNaverList')}
                  </button>
                ))}
              </div>
            )}
            <div className="!text-[length:12px] ![color:var(--text-faint)] !mb-[16px]">
              {t(listImportProvider === 'google' ? 'places.googleListHint' : 'places.naverListHint')}
            </div>
            <input className="!w-[100%] !p-[10px_14px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] !text-[length:13px] ![color:var(--text-primary)] ![outline:none] ![font-family:inherit] !box-border"
              type="text"
              value={listImportUrl}
              onChange={e => setListImportUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !listImportLoading) handleListImport() }}
              placeholder={listImportProvider === 'google' ? 'https://maps.app.goo.gl/...' : 'https://naver.me/...'}
              autoFocus
              style={{ background: 'var(--bg-tertiary)' }}
            />
            {canEnrichImport && (
              <div className="!flex !items-start !gap-[12px] !mt-[12px]">
                <div className="!flex-[1] !min-w-[0]">
                  <div className="text-content !text-[length:12px] !font-[600]">{t('places.enrichOnImport')}</div>
                  <div className="text-content-faint !text-[length:12px] !mt-[2px]">{t('places.enrichOnImportHint')}</div>
                </div>
                <ToggleSwitch on={listImportEnrich} onToggle={() => setListImportEnrich(!listImportEnrich)} />
              </div>
            )}
            <div className="!flex !gap-[8px] !mt-[16px] !justify-end">
              <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![color:var(--text-primary)] !text-[length:13px] !font-[500] !cursor-pointer ![font-family:inherit]"
                onClick={() => { setListImportOpen(false); setListImportUrl('') }}
                style={{ background: 'none' }}
              >
                {t('common.cancel')}
              </button>
              <button className="!p-[8px_16px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[500] ![font-family:inherit]"
                onClick={handleListImport}
                disabled={!listImportUrl.trim() || listImportLoading}
                style={{ background: !listImportUrl.trim() || listImportLoading ? 'var(--bg-tertiary)' : 'var(--accent)', color: !listImportUrl.trim() || listImportLoading ? 'var(--text-faint)' : 'var(--accent-text)', cursor: !listImportUrl.trim() || listImportLoading ? 'default' : 'pointer' }}
              >
                {listImportLoading ? t('common.loading') : t('common.import')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <FileImportModal
        isOpen={fileImportOpen}
        onClose={() => { setFileImportOpen(false); setSidebarDropFile(null) }}
        tripId={tripId}
        pushUndo={pushUndo}
        initialFile={sidebarDropFile}
      />
      {mustSeeOpen && (
        <MustSeeSuggestionsModal
          tripId={tripId}
          onClose={() => setMustSeeOpen(false)}
          onAdded={() => loadTrip(tripId)}
          lang={typeof window !== 'undefined' ? (localStorage.getItem('app_language') || 'en') : 'en'}
          days={days}
          assignments={assignments}
        />
      )}
      <ContextMenu menu={ctxMenu.menu} onClose={ctxMenu.close} />
      {isMobile && (
        <ConfirmDialog
          isOpen={!!pendingDeleteIds?.length}
          onClose={() => setPendingDeleteIds(null)}
          onConfirm={() => { onBulkDeleteConfirm?.(pendingDeleteIds!); setPendingDeleteIds(null) }}
          message={t('trip.confirm.deletePlaces', { count: pendingDeleteIds?.length ?? 0 })}
        />
      )}
    </div>
  )
})

export default PlacesSidebar
