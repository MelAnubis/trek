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
      <button className="!flex !items-center !gap-[8px] !w-[100%] !p-[8px_10px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !cursor-pointer ![font-family:inherit] !text-left" type="button" data-testid="poi-categories" onClick={() => setOpen(o => !o)}>
        <span className="!inline-flex !gap-[3px]">
          {chosen.slice(0, 3).map(c => { const I = POI_ICON[c]; return <I key={c} size={13} style={{ color: POI_COLOR[c] }} /> })}
        </span>
        <span className="!flex-[1] !min-w-[0] !text-[length:12.5px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{label}</span>
        <ChevronDown size={14} style={{ color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <div className="!absolute !z-[40] !top-[calc(100%_+_4px)] !left-[0] !right-[0] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[12px] ![box-shadow:var(--shadow-elevated)] !p-[4px] !max-h-[280px] !overflow-y-auto">
          {POI_CATEGORIES_BY_TYPE[type].map(c => {
            const I = POI_ICON[c]
            const on = chosen.includes(c)
            const full = !on && chosen.length >= POI_MAX_CATEGORIES
            return (
              <label className="!flex !items-center !gap-[9px] !p-[7px_8px] !rounded-[8px] !text-[length:12.5px] ![color:var(--text-primary)]" key={c} title={full ? t('tours.poi.categoriesLimit', { count: POI_MAX_CATEGORIES }) : undefined}
                style={{ cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.5 : 1 }}>
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
      <div className="!flex !flex-col !gap-[10px] !pt-[10px]">
        <CategoryPicker type={tourType} chosen={chosen} onToggle={toggle} />
        <div>
          <div className="!text-[length:11.5px] ![color:var(--text-faint)] !mb-[6px]">{t('tours.poi.within')}</div>
          <div className="!flex !gap-[2px] !p-[3px] !rounded-[11px] ![background:var(--bg-tertiary)]">
            {POI_CORRIDORS_M.map(m => (
              <button className="!flex-[1] !p-[6px_4px] !rounded-[8px] ![border:none] !cursor-pointer" key={m} type="button" onClick={() => setCorridor(m)} aria-pressed={corridor === m}
                style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: corridor === m ? 600 : 500, background: corridor === m ? 'var(--bg-card)' : 'transparent', color: corridor === m ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {corridorLabel(m)}
              </button>
            ))}
          </div>
        </div>
        <button className="!flex !items-center !justify-center !gap-[6px] !p-[9px] !rounded-[10px] ![border:none] ![font-family:inherit] !text-[length:12.5px] !font-[600] ![background:var(--bg-tertiary)] ![color:var(--text-primary)]" type="button" data-testid="poi-search" disabled={!chosen.length || status === 'loading'} onClick={() => { void search() }}
          style={{ cursor: chosen.length ? 'pointer' : 'default' }}>
          {status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          {status === 'loading' ? t('tours.poi.searching') : status === 'ready' ? t('tours.poi.again') : t('tours.poi.search')}
        </button>

        {status === 'failed' && <div className="!flex !gap-[6px] !text-[length:12px] ![color:#b45309]"><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{t('tours.poi.failed')}</div>}
        {outdated && <div className="!text-[length:11.5px] ![color:#b45309]">{t('tours.poi.outdated')}</div>}
        {status === 'ready' && truncated && <div className="!text-[length:11.5px] ![color:var(--text-faint)]">{t('tours.poi.truncated')}</div>}
        {status === 'ready' && pois.length === 0 && (
          <div className="!text-[length:12px] ![color:var(--text-muted)]">
            {t('tours.poi.empty', { distance: corridorLabel(corridor) })}
            {wider && <button className="!ml-[6px] ![border:none] ![background:none] !p-[0] ![text-decoration:underline] !cursor-pointer ![color:var(--text-primary)] ![font-family:inherit] !text-[length:12px]" type="button" onClick={() => { setCorridor(wider); void search(wider) }}>{t('tours.poi.widen', { distance: corridorLabel(wider) })}</button>}
          </div>
        )}
        {pois.length > 0 && (
          <ul className="![list-style:none] !m-[0] !p-[0] !flex !flex-col !gap-[2px] !max-h-[320px] !overflow-y-auto" data-testid="poi-results">
            {pois.map(p => {
              const I = POI_ICON[p.category]
              const open = focusedId === p.id
              return (
                <li className="!rounded-[10px]" key={p.id} style={{ background: open ? 'var(--bg-tertiary)' : 'transparent' }}>
                  <button className="!flex !items-center !gap-[8px] !w-[100%] !p-[7px_6px] ![border:none] ![background:transparent] !cursor-pointer ![font-family:inherit] !text-left" type="button" onClick={() => onFocus(open ? null : p)}>
                    <span className="!w-[24px] !h-[24px] !rounded-[12px] !shrink-[0] !flex !items-center !justify-center" style={{ background: POI_COLOR[p.category] + '1f', color: POI_COLOR[p.category] }}><I size={13} /></span>
                    <span className="!flex-[1] !min-w-[0]">
                      <span className="!block !text-[length:12.5px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{p.name}</span>
                      <span className="!block !text-[length:11px] ![color:var(--text-faint)]">{t('tours.poi.along', { distance: formatDistance(p.along_m / 1000) })} · {t('tours.poi.fromRoute', { distance: formatDistance(p.distance_m / 1000) })}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="!p-[0_8px_8px_38px] !flex !flex-col !gap-[6px] !text-[length:11.5px] ![color:var(--text-muted)]">
                      {p.opening_hours && <span className="!inline-flex !gap-[4px]" title={t('tours.poi.hoursHint')}><Clock size={11} style={{ marginTop: 2 }} />{p.opening_hours}</span>}
                      {p.website && <a className="!inline-flex !gap-[4px] ![color:var(--text-primary)]" href={p.website} target="_blank" rel="noopener noreferrer"><ExternalLink size={11} style={{ marginTop: 2 }} />{t('tours.poi.website')}</a>}
                      <span className="!text-[length:10.5px] ![color:var(--text-faint)]">{t('tours.poi.source.osm')}</span>
                      {canEdit && (
                        <button className="!self-start !inline-flex !items-center !gap-[5px] !p-[5px_10px] !rounded-[8px] ![border:none] ![background:var(--text-primary)] ![color:var(--bg-card)] !cursor-pointer ![font-family:inherit] !text-[length:11.5px] !font-[600]" type="button" data-testid={`poi-add-${p.id}`} onClick={() => onAdd(p)}>
                          <Plus size={12} />{t('tours.poi.add')}
                        </button>
                      )}
                      <span className="!text-[length:10.5px] ![color:var(--text-faint)]">{t('tours.poi.notAPlace')}</span>
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
