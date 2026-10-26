// «A lo largo de la ruta» (TourPoiSearchCard de liketrek/TREK v5): qué buscar, a qué distancia de la línea,
// buscar cuando se pide, y cada lugar encontrado en el mapa y en la lista, con «Añadir como parada».
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Loader2, ChevronDown, Droplet, Wrench, Utensils, Eye, Home, Mountain, Bath, Sandwich, Tent, Landmark, PlugZap, Trees, Coffee,
  AlertTriangle, Plus, ExternalLink, Clock,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import RailCard from '../RailCard'
import { formatDistance } from '../presentation'
import type { TourType } from '../toursApi'
import { POI_CATEGORIES_BY_TYPE, POI_CORRIDORS_M, POI_MAX_CATEGORIES, searchAlongTour, type PoiCategory, type TourPoi } from './poiSearch'

export const POI_ICON: Record<PoiCategory, typeof Droplet> = {
  viewpoint: Eye, shelter: Home, drinking_water: Droplet, food: Utensils, peak: Mountain, toilets: Bath, picnic: Sandwich,
  campsite: Tent, sights: Landmark, bike_repair: Wrench, ebike_charging: PlugZap, park: Trees, cafe: Coffee,
}
export const POI_COLOR: Record<PoiCategory, string> = {
  viewpoint: '#7c3aed', shelter: '#92400e', drinking_water: '#2563eb', food: '#dc2626', peak: '#57534e', toilets: '#0891b2',
  picnic: '#65a30d', campsite: '#15803d', sights: '#c026d3', bike_repair: '#ea580c', ebike_charging: '#ca8a04', park: '#16a34a', cafe: '#a16207',
}

interface Props {
  route: [number, number][] | null
  tourType: TourType
  pois: TourPoi[]
  onPois: (pois: TourPoi[]) => void
  focusedId: string | null
  onFocus: (poi: TourPoi | null) => void
  onAdd: (poi: TourPoi) => void
  canEdit: boolean
}

function CategoryPicker({ type, chosen, onToggle }: { type: TourType; chosen: PoiCategory[]; onToggle: (c: PoiCategory) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const label = chosen.length === 0 ? t('tours.poi.categoriesNone')
    : chosen.length <= 2 ? chosen.map(c => t(`tours.poi.cat.${c}`)).join(', ')
      : t('tours.poi.categoriesMore', { first: chosen.slice(0, 2).map(c => t(`tours.poi.cat.${c}`)).join(', '), more: chosen.length - 2 })
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" data-testid="poi-categories" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <span style={{ display: 'inline-flex', gap: 3 }}>
          {chosen.slice(0, 3).map(c => { const I = POI_ICON[c]; return <I key={c} size={13} style={{ color: POI_COLOR[c] }} /> })}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={14} style={{ color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, boxShadow: 'var(--shadow-elevated)', padding: 4, maxHeight: 280, overflowY: 'auto' }}>
          {POI_CATEGORIES_BY_TYPE[type].map(c => {
            const I = POI_ICON[c]
            const on = chosen.includes(c)
            const full = !on && chosen.length >= POI_MAX_CATEGORIES
            return (
              <label key={c} title={full ? t('tours.poi.categoriesLimit', { count: POI_MAX_CATEGORIES }) : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 8, cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.5 : 1, fontSize: 12.5, color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => onToggle(c)} />
                <I size={14} style={{ color: POI_COLOR[c] }} />{t(`tours.poi.cat.${c}`)}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function AlongTourCard({ route, tourType, pois, onPois, focusedId, onFocus, onAdd, canEdit }: Props) {
  const { t } = useTranslation()
  const [chosenByType, setChosenByType] = useState<Partial<Record<TourType, PoiCategory[]>>>({})
  const chosen = chosenByType[tourType] ?? POI_CATEGORIES_BY_TYPE[tourType].slice(0, 3)
  const [corridor, setCorridor] = useState(500)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [answerKey, setAnswerKey] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const key = useMemo(() => route && route.length > 1 ? JSON.stringify([route[0], route[route.length - 1], route.length, tourType, [...chosen].sort(), corridor]) : null, [route, tourType, chosen, corridor])

  useEffect(() => () => abortRef.current?.abort(), [])

  const toggle = (c: PoiCategory) => setChosenByType(cur => {
    const now = cur[tourType] ?? POI_CATEGORIES_BY_TYPE[tourType].slice(0, 3)
    const next = now.includes(c) ? now.filter(x => x !== c) : now.length < POI_MAX_CATEGORIES ? [...now, c] : now
    return { ...cur, [tourType]: next }
  })

  const search = async (width = corridor) => {
    if (!route || route.length < 2 || !chosen.length) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStatus('loading')
    try {
      const answer = await searchAlongTour(route, chosen, width, c => t(`tours.poi.cat.${c}`), ctrl.signal)
      if (ctrl.signal.aborted) return
      onPois(answer.pois)
      setTruncated(answer.truncated)
      setAnswerKey(JSON.stringify([route[0], route[route.length - 1], route.length, tourType, [...chosen].sort(), width]))
      setStatus('ready')
    } catch {
      if (ctrl.signal.aborted) return
      onPois([])
      setStatus('failed')
    }
  }

  if (!route || route.length < 2) return null
  const outdated = status === 'ready' && answerKey !== key
  const wider = POI_CORRIDORS_M.find(m => m > corridor) ?? null
  const corridorLabel = (m: number) => m < 1000 ? `${m} m` : `${m / 1000} km`

  return (
    <RailCard testId="along-card" icon={<Search size={15} />} title={t('tours.poi.title')} defaultOpen={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
        <CategoryPicker type={tourType} chosen={chosen} onToggle={toggle} />
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 6 }}>{t('tours.poi.within')}</div>
          <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 11, background: 'var(--bg-tertiary)' }}>
            {POI_CORRIDORS_M.map(m => (
              <button key={m} type="button" onClick={() => setCorridor(m)} aria-pressed={corridor === m}
                style={{ flex: 1, padding: '6px 4px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: corridor === m ? 600 : 500, background: corridor === m ? 'var(--bg-card)' : 'transparent', color: corridor === m ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {corridorLabel(m)}
              </button>
            ))}
          </div>
        </div>
        <button type="button" data-testid="poi-search" disabled={!chosen.length || status === 'loading'} onClick={() => { void search() }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', borderRadius: 10, border: 'none', cursor: chosen.length ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
          {status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {status === 'loading' ? t('tours.poi.searching') : status === 'ready' ? t('tours.poi.again') : t('tours.poi.search')}
        </button>

        {status === 'failed' && <div style={{ display: 'flex', gap: 6, fontSize: 12, color: '#b45309' }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{t('tours.poi.failed')}</div>}
        {outdated && <div style={{ fontSize: 11.5, color: '#b45309' }}>{t('tours.poi.outdated')}</div>}
        {status === 'ready' && truncated && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{t('tours.poi.truncated')}</div>}
        {status === 'ready' && pois.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('tours.poi.empty', { distance: corridorLabel(corridor) })}
            {wider && <button type="button" onClick={() => { setCorridor(wider); void search(wider) }} style={{ marginLeft: 6, border: 'none', background: 'none', padding: 0, textDecoration: 'underline', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 12 }}>{t('tours.poi.widen', { distance: corridorLabel(wider) })}</button>}
          </div>
        )}
        {pois.length > 0 && (
          <ul data-testid="poi-results" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
            {pois.map(p => {
              const I = POI_ICON[p.category]
              const open = focusedId === p.id
              return (
                <li key={p.id} style={{ borderRadius: 10, background: open ? 'var(--bg-tertiary)' : 'transparent' }}>
                  <button type="button" onClick={() => onFocus(open ? null : p)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 6px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <span style={{ width: 24, height: 24, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: POI_COLOR[p.category] + '1f', color: POI_COLOR[p.category] }}><I size={13} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>{t('tours.poi.along', { distance: formatDistance(p.along_m / 1000) })} · {t('tours.poi.fromRoute', { distance: formatDistance(p.distance_m / 1000) })}</span>
                    </span>
                  </button>
                  {open && (
                    <div style={{ padding: '0 8px 8px 38px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {p.opening_hours && <span title={t('tours.poi.hoursHint')} style={{ display: 'inline-flex', gap: 4 }}><Clock size={11} style={{ marginTop: 2 }} />{p.opening_hours}</span>}
                      {p.website && <a href={p.website} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', gap: 4, color: 'var(--text-primary)' }}><ExternalLink size={11} style={{ marginTop: 2 }} />{t('tours.poi.website')}</a>}
                      <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{t('tours.poi.source.osm')}</span>
                      {canEdit && (
                        <button type="button" data-testid={`poi-add-${p.id}`} onClick={() => onAdd(p)}
                          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--text-primary)', color: 'var(--bg-card)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600 }}>
                          <Plus size={12} />{t('tours.poi.add')}
                        </button>
                      )}
                      <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{t('tours.poi.notAPlace')}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </RailCard>
  )
}
