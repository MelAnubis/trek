import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Modal from '../shared/Modal'
import CustomSelect from '../shared/CustomSelect'
import { mapsApi, placesApi } from '../../api/client'
import PlaceAvatar from '../shared/PlaceAvatar'
import { useAuthStore } from '../../store/authStore'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'
import { useToast } from '../shared/Toast'
import { Search, Paperclip, X, AlertTriangle, Loader2, MapPin, Plus, Landmark, ImagePlus, Image as ImageIcon, ExternalLink, Bookmark } from 'lucide-react'
import { useTranslation } from '../../i18n'
import CustomTimePicker from '../shared/CustomTimePicker'
import type { Place, Category, Assignment } from '../../types'

interface PlaceFormData {
  name: string
  description: string
  address: string
  // Text while typed, a number when loaded from a saved place.
  lat: string | number
  lng: string | number
  category_id: string | number
  place_time: string
  end_time: string
  notes: string
  transport_mode: string
  website: string
  phone?: string
  email?: string
  image_url?: string
  google_place_id?: string
  osm_id?: string
}

function isGoogleMapsUrl(input: string): boolean {
  try {
    const { hostname, pathname } = new URL(input.trim())
    const h = hostname.toLowerCase()
    // maps.app.goo.gl, goo.gl/maps
    if (h === 'maps.app.goo.gl') return true
    if (h === 'goo.gl' && pathname.startsWith('/maps')) return true
    // maps.google.* (e.g. maps.google.com, maps.google.co.uk)
    // Must be maps.google.<tld> or maps.google.<sld>.<tld> — reject maps.google.evil.com
    if (/^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h)) return true
    // google.*/maps (e.g. google.com/maps, www.google.co.uk/maps)
    const bare = h.startsWith('www.') ? h.slice(4) : h
    if (/^google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(bare) && pathname.startsWith('/maps')) return true
    return false
  } catch {
    return false
  }
}

const DEFAULT_FORM: PlaceFormData = {
  name: '',
  description: '',
  address: '',
  lat: '',
  lng: '',
  category_id: '',
  place_time: '',
  end_time: '',
  notes: '',
  transport_mode: 'walking',
  website: '',
}

interface PlaceFormModalProps {
  isOpen: boolean
  onClose: () => void
  /** The form with lat/lng parsed to numbers and pending files under `_pendingFiles`. */
  onSave: (data: Record<string, unknown>, files?: File[]) => Promise<void> | void
  place: Place | null
  prefillCoords?: { lat: number; lng: number; name?: string; address?: string } | null
  tripId: number | string
  categories: Category[]
  onCategoryCreated: (category: Partial<Category>) => Promise<Category | undefined> | Category | void
  assignmentId: number | null
  dayAssignments?: Assignment[]
}

export default function PlaceFormModal({
  isOpen, onClose, onSave, place, prefillCoords, tripId, categories,
  onCategoryCreated, assignmentId, dayAssignments = [],
}: PlaceFormModalProps) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [mapsSearch, setMapsSearch] = useState('')
  const [mapsResults, setMapsResults] = useState([])
  const [isSearchingMaps, setIsSearchingMaps] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([])
  const fileRef = useRef(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  // The search result last taken in, shown on the left (Place details, TREK v5).
  const [picked, setPicked] = useState<{ name?: string; address?: string; website?: string; phone?: string; lat?: number | string; lng?: number | string; rating?: number; photo_url?: string; image_url?: string } | null>(null)
  const [acSuggestions, setAcSuggestions] = useState<{ placeId: string; mainText: string; secondaryText: string }[]>([])
  const [acHighlight, setAcHighlight] = useState(-1)
  const acDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const acAbortRef = useRef<AbortController | null>(null)
  const toast = useToast()
  const { t, language } = useTranslation()
  const { hasMapsKey } = useAuthStore()
  const can = useCanDo()
  const tripObj = useTripStore((s) => s.trip)
  const canUploadFiles = can('file_upload', tripObj)

  useEffect(() => {
    if (place) {
      setForm({
        name: place.name || '',
        description: place.description || '',
        address: place.address || '',
        lat: place.lat || '',
        lng: place.lng || '',
        category_id: place.category_id || '',
        place_time: place.place_time || '',
        end_time: place.end_time || '',
        notes: place.notes || '',
        transport_mode: place.transport_mode || 'walking',
        website: place.website || '',
        phone: place.phone || '',
        email: (place as Place & { email?: string | null }).email || '',
        image_url: place.image_url || '',
      })
    } else if (prefillCoords) {
      setForm({
        ...DEFAULT_FORM,
        lat: String(prefillCoords.lat),
        lng: String(prefillCoords.lng),
        name: prefillCoords.name || '',
        address: prefillCoords.address || '',
      })
    } else {
      setForm(DEFAULT_FORM)
    }
    setPendingFiles([])
    setPicked(null)
  }, [place, prefillCoords, isOpen])

  // Derive location bias bounding box from the trip's existing places
  const places = useTripStore((s) => s.places)
  const locationBias = useMemo(() => {
    const withCoords = (places || []).filter((p) => p.lat != null && p.lng != null)
    if (withCoords.length === 0) return undefined

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const p of withCoords) {
      const lat = Number(p.lat), lng = Number(p.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
    if (!Number.isFinite(minLat)) return undefined

    // Skip bias if the bounding box is too large (~500 km diagonal)
    const dlat = maxLat - minLat
    const dlng = maxLng - minLng
    const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180)
    const diagKm = Math.sqrt((dlat * 111) ** 2 + (dlng * 111 * Math.cos(avgLatRad)) ** 2)
    if (diagKm > 500) return undefined

    return { low: { lat: minLat, lng: minLng }, high: { lat: maxLat, lng: maxLng } }
  }, [places])

  // Autocomplete fetch — aborts any in-flight request before starting a new one
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2 || isGoogleMapsUrl(query)) {
      setAcSuggestions([])
      setAcHighlight(-1)
      return
    }
    acAbortRef.current?.abort()
    const controller = new AbortController()
    acAbortRef.current = controller
    try {
      const result = await mapsApi.autocomplete(query, language, locationBias, controller.signal)
      setAcSuggestions(result.suggestions || [])
      setAcHighlight(-1)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      if (err instanceof Error && err.name === 'CanceledError') return // axios abort
      console.error('Autocomplete failed:', err)
      setAcSuggestions([])
    }
  }, [language, locationBias])

  // Debounce effect — only watches mapsSearch
  useEffect(() => {
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current)

    const trimmed = mapsSearch.trim()
    if (trimmed.length < 2 || isGoogleMapsUrl(trimmed)) {
      setAcSuggestions([])
      setAcHighlight(-1)
      return
    }

    acDebounceRef.current = setTimeout(() => fetchSuggestions(trimmed), 300)

    return () => {
      if (acDebounceRef.current) clearTimeout(acDebounceRef.current)
    }
  }, [mapsSearch, fetchSuggestions])

  const handleChange = (field: keyof PlaceFormData, value: unknown) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleMapsSearch = async () => {
    if (!mapsSearch.trim()) return
    setIsSearchingMaps(true)
    try {
      // Detect Google Maps URLs and resolve them directly
      const trimmed = mapsSearch.trim()
      if (isGoogleMapsUrl(trimmed)) {
        const resolved = await mapsApi.resolveUrl(trimmed)
        if (resolved.lat && resolved.lng) {
          setForm(prev => ({
            ...prev,
            name: resolved.name || prev.name,
            address: resolved.address || prev.address,
            lat: String(resolved.lat),
            lng: String(resolved.lng),
          }))
          setMapsResults([])
          setMapsSearch('')
          toast.success(t('places.urlResolved'))
          return
        }
      }
      const result = await mapsApi.search(mapsSearch, language)
      setMapsResults(result.places || [])
    } catch (err: unknown) {
      toast.error(t('places.mapsSearchError'))
    } finally {
      setIsSearchingMaps(false)
    }
  }

  const handleSelectMapsResult = (result) => {
    setPicked(result)
    setForm(prev => ({
      ...prev,
      name: result.name || prev.name,
      address: result.address || prev.address,
      lat: result.lat || prev.lat,
      lng: result.lng || prev.lng,
      google_place_id: result.google_place_id || prev.google_place_id,
      osm_id: result.osm_id || prev.osm_id,
      website: result.website || prev.website,
      phone: result.phone || prev.phone,
      email: result.email || prev.email,
      image_url: result.image_url || prev.image_url,
      description: prev.description || result.description || '',
    }))
    setMapsResults([])
    setMapsSearch('')
  }

  const handleSelectSuggestion = async (suggestion: { placeId: string; mainText: string; secondaryText: string }) => {
    setAcSuggestions([])
    setAcHighlight(-1)
    const previousSearch = mapsSearch
    setMapsSearch('')
    setForm(prev => ({ ...prev, name: suggestion.mainText }))
    setIsSearchingMaps(true)
    try {
      const result = await mapsApi.details(suggestion.placeId, language)
      if (result.place) {
        handleSelectMapsResult(result.place)
      } else {
        setMapsSearch(previousSearch)
        toast.error(t('places.mapsSearchError'))
      }
    } catch (err) {
      console.error('Failed to fetch place details:', err)
      setMapsSearch(previousSearch)
      toast.error(t('places.mapsSearchError'))
    } finally {
      setIsSearchingMaps(false)
    }
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (acSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcHighlight(prev => (prev + 1) % acSuggestions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcHighlight(prev => (prev <= 0 ? acSuggestions.length - 1 : prev - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (acHighlight >= 0) {
          handleSelectSuggestion(acSuggestions[acHighlight])
        } else {
          setAcSuggestions([])
          handleMapsSearch()
        }
      } else if (e.key === 'Escape') {
        setAcSuggestions([])
        setAcHighlight(-1)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleMapsSearch()
    }
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return
    try {
      const cat = await onCategoryCreated?.({ name: newCategoryName, color: '#6366f1', icon: 'MapPin' })
      if (cat && typeof cat === 'object' && 'id' in cat) setForm(prev => ({ ...prev, category_id: cat.id }))
      setNewCategoryName('')
      setShowNewCategory(false)
    } catch (err: unknown) {
      toast.error(t('places.categoryCreateError'))
    }
  }

  const handleFileAdd = (e) => {
    const files = Array.from((e.target as HTMLInputElement).files || [])
    setPendingFiles(prev => [...prev, ...files])
    e.target.value = ''
  }

  const handleRemoveFile = (idx) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }

  // Paste support for files/images
  const handlePaste = (e: React.ClipboardEvent) => {
    if (!canUploadFiles) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) setPendingFiles(prev => [...prev, file])
        return
      }
    }
  }

  const hasTimeError = place && form.place_time && form.end_time && form.place_time.length >= 5 && form.end_time.length >= 5 && form.end_time <= form.place_time

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error(t('places.nameRequired'))
      return
    }
    setIsSaving(true)
    try {
      await onSave({
        ...form,
        lat: form.lat ? parseFloat(String(form.lat)) : null,
        lng: form.lng ? parseFloat(String(form.lng)) : null,
        category_id: form.category_id || null,
        _pendingFiles: pendingFiles.length > 0 ? pendingFiles : undefined,
      })
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('places.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingImage(true)
    try {
      const res = await placesApi.uploadImage(tripId, file)
      setForm(prev => ({ ...prev, image_url: res.image_url }))
    } catch {
      toast.error(t('places.imageUploadError'))
    } finally {
      setUploadingImage(false)
    }
  }

  const PANEL = 'rounded-2xl border p-3 space-y-3'
  const panelStyle: React.CSSProperties = { background: 'var(--bg-secondary)', borderColor: 'var(--border-faint)' }
  const LABEL: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }
  const pickedImage = picked?.photo_url || picked?.image_url

  const header = (
    <div className="!flex !items-start !gap-[14px] !min-w-[0]">
      <span className="!w-[46px] !h-[46px] !rounded-[14px] ![background:var(--bg-card)] ![border:1px_solid_var(--border-faint)] !flex !items-center !justify-center !shrink-[0]">
        <MapPin size={20} style={{ color: 'var(--text-secondary)' }} />
      </span>
      <div className="!min-w-[0] !flex-[1]">
        <div className="!text-[length:10.5px] !font-[600] !tracking-[0.06em] !uppercase ![color:var(--text-faint)]">{place ? t('places.editPlace') : t('places.addPlace')}</div>
        <input className="!w-[100%] ![border:none] ![outline:none] ![background:transparent] !text-[length:21px] !font-[700] ![color:var(--text-primary)] ![font-family:inherit] !p-[2px_0] !tracking-[-0.01em]"
          data-testid="place-name"
          type="text"
          value={form.name}
          onChange={e => handleChange('name', e.target.value)}
          placeholder={t('places.formNamePlaceholder')}
          aria-label={t('places.formName')}
        />
        <div className="!text-[length:11.5px] ![color:var(--text-faint)] !flex !items-center !gap-[6px]">
          {t('places.formName')} *
          {isSearchingMaps && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label={t('places.loadingDetails')} />}
        </div>
        <div className="!flex !items-center !gap-[6px] !mt-[10px]">
          {!showNewCategory ? (
            <>
              <CustomSelect
                value={form.category_id}
                onChange={value => handleChange('category_id', value)}
                placeholder={t('places.noCategory')}
                options={[{ value: '', label: t('places.noCategory') }, ...(categories || []).map(c => ({ value: c.id, label: c.name }))]}
                style={{ minWidth: 150 }}
                size="sm"
              />
              <button className="!w-[30px] !h-[30px] !rounded-[15px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !cursor-pointer !flex !items-center !justify-center ![color:var(--text-secondary)]" type="button" onClick={() => setShowNewCategory(true)} title={t('places.newCategory')} aria-label={t('places.newCategory')}>
                <Plus size={14} />
              </button>
            </>
          ) : (
            <>
              <input type="text" autoFocus value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} placeholder={t('places.categoryNamePlaceholder')} className="form-input !max-w-[220px]" />
              <button type="button" onClick={handleCreateCategory} className="px-3 py-1.5 rounded-lg text-sm ![background:var(--accent)] ![color:var(--accent-text)]">OK</button>
              <button type="button" onClick={() => setShowNewCategory(false)} className="px-2 text-sm ![color:var(--text-muted)]">{t('common.cancel')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={header}
      wideTitle
      size="4xl"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border ![border-color:var(--border-primary)] ![color:var(--text-secondary)] ![background:var(--bg-card)]">
            {t('common.cancel')}
          </button>
          <button type="button" data-testid="place-save" onClick={handleSubmit} disabled={isSaving || hasTimeError}
            className="px-6 py-2 text-sm rounded-lg font-medium disabled:opacity-60 ![background:var(--accent)] ![color:var(--accent-text)]">
            {isSaving ? t('common.saving') : place ? t('common.update') : t('common.add')}
          </button>
        </div>
      }
    >
      <div className="place-form-grid" onPaste={handlePaste}>
        {/* Left: the place's picture and what the result picked tells */}
        <div className={PANEL} style={panelStyle} data-testid="place-details-column">
          <div className="!flex !items-center !gap-[6px] !mb-[0]" style={{ ...LABEL }}><Landmark size={13} />{t('places.details.title')}</div>
          <div>
            <div className="!text-[length:10.5px] !font-[600] !tracking-[0.06em] !uppercase ![color:var(--text-faint)] !mb-[6px]">{t('places.details.pickImage')}</div>
            <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePickImage} data-testid="place-image-input" />
            {form.image_url ? (
              <div className="!relative !rounded-[12px] !overflow-hidden ![border:1px_solid_var(--border-faint)]">
                <img className="!block !w-[100%] !h-[140px] !object-cover" src={form.image_url} alt="" />
                <button className="!absolute !top-[6px] !right-[6px] !w-[26px] !h-[26px] !rounded-[13px] ![border:none] ![background:rgba(0,0,0,0.55)] ![color:#fff] !cursor-pointer !flex !items-center !justify-center" type="button" onClick={() => handleChange('image_url', '')} aria-label={t('common.delete')}><X size={13} /></button>
              </div>
            ) : (
              <div className="!flex !gap-[8px] !flex-wrap">
                <button className="!w-[90px] !h-[90px] !rounded-[12px] ![border:1.5px_dashed_var(--border-primary)] ![background:var(--bg-card)] !cursor-pointer !flex !flex-col !items-center !justify-center !gap-[4px] !text-[length:12px] ![color:var(--text-muted)] ![font-family:inherit]" type="button" onClick={() => imageRef.current?.click()} disabled={uploadingImage}>
                  {uploadingImage ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
                  {t('places.uploadImage')}
                </button>
                {pickedImage && (
                  <button className="!w-[90px] !h-[90px] !rounded-[12px] !overflow-hidden ![border:1px_solid_var(--border-faint)] !p-[0] !cursor-pointer" type="button" onClick={() => handleChange('image_url', pickedImage)} title={t('places.useImage')}>
                    <img className="!w-[100%] !h-[100%] !object-cover" src={pickedImage} alt="" />
                  </button>
                )}
              </div>
            )}
          </div>
          {picked ? (
            <div className="!rounded-[12px] ![border:1px_solid_var(--border-faint)] ![background:var(--bg-card)] !p-[10px] !text-[length:12px] ![color:var(--text-secondary)] !flex !flex-col !gap-[4px]">
              <div className="!font-[600] ![color:var(--text-primary)] !text-[length:13px]">{picked.name}</div>
              {picked.address && <div>{picked.address}</div>}
              {picked.phone && <div>{picked.phone}</div>}
              {picked.website && <a className="![color:var(--text-primary)] ![text-decoration:underline] !overflow-hidden !text-ellipsis !whitespace-nowrap" href={picked.website} target="_blank" rel="noopener noreferrer">{picked.website}</a>}
              {picked.lat && picked.lng && (
                <a className="!inline-flex !items-center !gap-[4px] ![color:var(--text-muted)] !mt-[2px]" href={`https://www.openstreetmap.org/?mlat=${picked.lat}&mlon=${picked.lng}#map=17/${picked.lat}/${picked.lng}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={11} />{t('places.openInMaps')}</a>
              )}
            </div>
          ) : (
            <div className="!flex !items-center !gap-[10px] !rounded-[12px] ![border:1.5px_dashed_var(--border-faint)] !p-[12px_12px] !text-[length:12.5px] ![color:var(--text-muted)]">
              <span className="!w-[30px] !h-[30px] !rounded-[15px] ![background:var(--bg-card)] !flex !items-center !justify-center !shrink-[0]"><ImageIcon size={14} /></span>
              {t('places.details.empty')}
            </div>
          )}
        </div>

        {/* Middle: search, where it is, and what it is */}
        <form onSubmit={handleSubmit} className="space-y-3 !min-w-[0]">
          <div className={PANEL} style={panelStyle}>
            <label style={LABEL}>{t('common.search')}</label>
            {!hasMapsKey && <p className="text-xs ![color:var(--text-faint)] !mt-[-4px]">{t('places.osmActive')}</p>}
            <div className="relative">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mapsSearch}
                  autoFocus={!place && !prefillCoords}
                  onChange={e => setMapsSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  onBlur={() => setTimeout(() => setAcSuggestions([]), 150)}
                  onFocus={() => {
                    if (mapsSearch.trim().length >= 2 && acSuggestions.length === 0 && mapsResults.length === 0) {
                      fetchSuggestions(mapsSearch.trim())
                    }
                  }}
                  placeholder={t('places.mapsSearchPlaceholder')}
                  className="form-input flex-1"
                />
                <button type="button" onClick={() => { setAcSuggestions([]); handleMapsSearch() }} disabled={isSearchingMaps} aria-label={t('common.search')}
                  className="px-3 rounded-lg disabled:opacity-60 ![background:var(--accent)] ![color:var(--accent-text)]">
                  {isSearchingMaps ? '...' : <Search className="w-4 h-4" />}
                </button>
              </div>
              {acSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border shadow-lg overflow-hidden ![background:var(--bg-card)] ![border-color:var(--border-primary)]">
                  {acSuggestions.map((sg, idx) => (
                    <button key={sg.placeId} type="button" onMouseDown={() => handleSelectSuggestion(sg)} onMouseEnter={() => setAcHighlight(idx)}
                      className="w-full text-left px-3 py-2" style={{ background: idx === acHighlight ? 'var(--bg-tertiary)' : 'transparent', borderBottom: '1px solid var(--border-faint)' }}>
                      <div className="font-medium text-sm ![color:var(--text-primary)]">{sg.mainText}</div>
                      {sg.secondaryText && <div className="text-xs truncate ![color:var(--text-muted)]">{sg.secondaryText}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {mapsResults.length > 0 && (
              <div className="rounded-lg border overflow-hidden max-h-40 overflow-y-auto ![background:var(--bg-card)] ![border-color:var(--border-faint)]">
                {mapsResults.map((result, idx) => (
                  <button key={idx} type="button" onClick={() => handleSelectMapsResult(result)} className="w-full text-left px-3 py-2 ![border-bottom:1px_solid_var(--border-faint)]">
                    <div className="font-medium text-sm ![color:var(--text-primary)]">{result.name}</div>
                    <div className="text-xs truncate ![color:var(--text-muted)]">{result.address}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={PANEL} style={panelStyle}>
            <div>
              <label style={LABEL}>{t('places.formAddress')}</label>
              <input type="text" value={form.address} onChange={e => handleChange('address', e.target.value)} placeholder={t('places.formAddressPlaceholder')} className="form-input" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label style={LABEL}>{t('places.formLatLabel')}</label>
                <input type="number" step="any" value={form.lat} onChange={e => handleChange('lat', e.target.value)}
                  onPaste={e => {
                    const text = e.clipboardData.getData('text').trim()
                    const match = text.match(/^(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)$/)
                    if (match) { e.preventDefault(); handleChange('lat', match[1]); handleChange('lng', match[2]) }
                  }}
                  placeholder={t('places.formLat')} className="form-input" />
              </div>
              <div>
                <label style={LABEL}>{t('places.formLngLabel')}</label>
                <input type="number" step="any" value={form.lng} onChange={e => handleChange('lng', e.target.value)} placeholder={t('places.formLng')} className="form-input" />
              </div>
            </div>
          </div>

          <div>
            <label style={LABEL}>{t('places.formDescription')}</label>
            <textarea value={form.description} onChange={e => handleChange('description', e.target.value)} rows={3} placeholder={t('places.formDescriptionPlaceholder')} className="form-input ![resize:vertical]" />
          </div>
          <div>
            <label style={LABEL}>{t('places.formNotes')}</label>
            <textarea value={form.notes} onChange={e => handleChange('notes', e.target.value)} rows={3} maxLength={2000} placeholder={t('places.formNotesPlaceholder')} className="form-input ![resize:vertical]" />
          </div>

          {place && (
            <TimeSection form={form} handleChange={handleChange} assignmentId={assignmentId} dayAssignments={dayAssignments} hasTimeError={hasTimeError} t={t} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={LABEL}>{t('places.formWebsite')}</label>
              <input type="url" value={form.website} onChange={e => handleChange('website', e.target.value)} placeholder="https://..." className="form-input" />
            </div>
            <div>
              <label style={LABEL}>{t('files.title')}</label>
              {canUploadFiles ? (
                <>
                  <button type="button" onClick={() => fileRef.current?.click()} className="form-input !flex !items-center !justify-center !gap-[6px] !cursor-pointer !font-[600]">
                    <Paperclip size={14} /> {t('files.attach')}
                  </button>
                  <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileAdd} />
                </>
              ) : <div className="text-xs ![color:var(--text-faint)]">—</div>}
            </div>
          </div>
          {pendingFiles.length > 0 && (
            <div className="space-y-1">
              {pendingFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ![background:var(--bg-secondary)]">
                  <Paperclip size={10} className="shrink-0" style={{ color: 'var(--text-faint)' }} />
                  <span className="truncate flex-1 ![color:var(--text-secondary)]">{file.name}</span>
                  <button type="button" onClick={() => handleRemoveFile(idx)} className="shrink-0 ![color:var(--text-faint)]"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={LABEL}>{t('places.formPhone')}</label>
              <input type="tel" value={form.phone || ''} onChange={e => handleChange('phone', e.target.value)} placeholder="+34 …" className="form-input" />
            </div>
            <div>
              <label style={LABEL}>{t('places.formEmail')}</label>
              <input type="email" value={form.email || ''} onChange={e => handleChange('email', e.target.value)} placeholder="nombre@ejemplo.com" className="form-input" />
            </div>
          </div>
        </form>

        {/* Right: places saved in the user's other trips */}
        <SavedPlacesColumn tripId={tripId} onPick={sp => {
          setPicked(sp)
          setForm(prev => ({
            ...prev,
            name: sp.name || prev.name,
            address: sp.address || prev.address,
            lat: String(sp.lat), lng: String(sp.lng),
            description: prev.description || sp.description || '',
            website: sp.website || prev.website,
            phone: sp.phone || prev.phone,
            email: sp.email || prev.email,
            image_url: sp.image_url || prev.image_url,
            google_place_id: sp.google_place_id || prev.google_place_id,
            osm_id: sp.osm_id || prev.osm_id,
          }))
        }} />
      </div>
    </Modal>
  )
}

interface SavedPlace {
  id: number; name: string; description: string | null; address: string | null; lat: number; lng: number; image_url: string | null
  google_place_id: string | null; osm_id: string | null; website: string | null; phone: string | null; email: string | null
  trip_id: number; trip_title: string; planned: boolean
}

/** Saved places (TREK v5): the user's places from their other trips, by trip and by whether they were on a day. */
function SavedPlacesColumn({ tripId, onPick }: { tripId: number | string; onPick: (p: SavedPlace) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [trip, setTrip] = useState('')
  const [status, setStatus] = useState<'all' | 'planned' | 'unplanned'>('all')
  const [data, setData] = useState<{ places: SavedPlace[]; trips: { id: number; title: string }[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      placesApi.saved(tripId, { q: q.trim() || undefined, trip: trip || undefined, status })
        .then(res => { if (!cancelled) setData(res) })
        .catch(() => { if (!cancelled) setData({ places: [], trips: [] }) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [tripId, q, trip, status])
  const LABEL: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }
  return (
    <div className="rounded-2xl border p-3 space-y-3 ![background:var(--bg-secondary)] ![border-color:var(--border-faint)] !min-w-[0]" data-testid="saved-places-column">
      <div className="!flex !items-center !gap-[6px] !mb-[0]" style={{ ...LABEL }}><Bookmark size={13} />{t('places.saved.title')}</div>
      <div>
        <label style={LABEL}>{t('common.search')}</label>
        <div className="!relative">
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('places.saved.search')} className="form-input !pl-[30px]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label style={LABEL}>{t('places.saved.collections')}</label>
          <select value={trip} onChange={e => setTrip(e.target.value)} className="form-input !p-[6px_8px] !text-[length:12.5px]">
            <option value="">{t('places.saved.allTrips')}</option>
            {data?.trips.map(tr => <option key={tr.id} value={tr.id}>{tr.title}</option>)}
          </select>
        </div>
        <div>
          <label style={LABEL}>{t('places.saved.status')}</label>
          <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="form-input !p-[6px_8px] !text-[length:12.5px]">
            <option value="all">{t('places.all')}</option>
            <option value="planned">{t('places.saved.planned')}</option>
            <option value="unplanned">{t('places.unplanned')}</option>
          </select>
        </div>
      </div>
      <div className="!max-h-[420px] !overflow-y-auto !flex !flex-col !gap-[2px]">
        {data && data.places.length === 0 && <div className="!text-[length:12px] ![color:var(--text-faint)] !p-[8px_2px]">{t('places.saved.empty')}</div>}
        {data?.places.map(sp => (
          <button className="trek-hover !flex !items-center !gap-[10px] !w-[100%] !p-[6px_4px] !rounded-[10px] ![border:none] ![background:transparent] !cursor-pointer !text-left ![font-family:inherit]" key={sp.id} type="button" onClick={() => onPick(sp)} data-testid={`saved-place-${sp.id}`}>
            <PlaceAvatar place={sp} size={34} />
            <span className="!min-w-[0] !flex-[1]">
              <span className="!block !text-[length:13px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{sp.name}</span>
              <span className="!block !text-[length:11.5px] ![color:var(--text-faint)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{sp.address || sp.trip_title}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

interface TimeSectionProps {
  form: PlaceFormData
  handleChange: (field: keyof PlaceFormData, value: unknown) => void
  assignmentId: number | null
  dayAssignments: Assignment[]
  hasTimeError: boolean
  t: (key: string, params?: Record<string, string | number>) => string
}

function TimeSection({ form, handleChange, assignmentId, dayAssignments, hasTimeError, t }: TimeSectionProps) {

  const collisions = useMemo(() => {
    if (!assignmentId || !form.place_time || form.place_time.length < 5) return []
    // Find the day_id for the current assignment
    const current = dayAssignments.find(a => a.id === assignmentId)
    if (!current) return []
    const myStart = form.place_time
    const myEnd = form.end_time && form.end_time.length >= 5 ? form.end_time : null
    return dayAssignments.filter(a => {
      if (a.id === assignmentId) return false
      if (a.day_id !== current.day_id) return false
      const aStart = a.place?.place_time
      const aEnd = a.place?.end_time
      if (!aStart) return false
      // Check overlap: two intervals overlap if start < otherEnd AND otherStart < end
      const s1 = myStart, e1 = myEnd || myStart
      const s2 = aStart, e2 = aEnd || aStart
      return s1 < (e2 || '23:59') && s2 < (e1 || '23:59') && s1 !== e2 && s2 !== e1
    })
  }, [assignmentId, dayAssignments, form.place_time, form.end_time])

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.startTime')}</label>
          <CustomTimePicker
            value={form.place_time}
            onChange={v => handleChange('place_time', v)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('places.endTime')}</label>
          <CustomTimePicker
            value={form.end_time}
            onChange={v => handleChange('end_time', v)}
          />
        </div>
      </div>
      {hasTimeError && (
        <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg text-xs ![background:var(--bg-warning,_#fef3c7)] ![color:var(--text-warning,_#92400e)]">
          <AlertTriangle size={13} className="shrink-0" />
          {t('places.endTimeBeforeStart')}
        </div>
      )}
      {collisions.length > 0 && (
        <div className="flex items-start gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg text-xs ![background:var(--bg-warning,_#fef3c7)] ![color:var(--text-warning,_#92400e)]">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            {t('places.timeCollision')}{' '}
            {collisions.map(a => a.place?.name).filter(Boolean).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}
