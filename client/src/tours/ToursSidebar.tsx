// La columna derecha "Excursiones de este viaje" (ToursSidebar + TourListRow + TourScopeSummary de la v5):
// resumen de la excursión abierta con su perfil, filtro, totales del viaje y la lista.
import { useEffect, useRef, useState } from 'react'
import { Plus, ChevronDown, ChevronUp, SlidersHorizontal, BarChart3, Mountain, Bike, Footprints, Clock, Ruler, CalendarDays, Trash2, Upload, Crosshair, Download, Info, Copy, History, X, Moon } from 'lucide-react'
import { useTranslation } from '../i18n'
import ElevationProfile from './ElevationProfile'
import type { TourListItem, TourType } from './toursApi'
import {
  TOUR_TYPES, filterTours, formatDistance, formatDurationShort, formatElevation, gradeTile, movingTimeInfo, movingTimeLabel,
  tourDayTimeText, type TourFilter,
} from './presentation'

const TYPE_ICON: Record<TourType, typeof Mountain> = { hike: Mountain, bike: Bike, run: Footprints }

export interface SummaryData {
  type: TourType
  distanceKm: number | null
  movingMinutes: number | null
  estimated: boolean
  breakMinutes: number | null
  plannedMinutes: number | null
  minAlt: number | null
  maxAlt: number | null
  gain: number | null
  loss: number | null
  geometry: readonly (readonly number[])[] | null
  /** MDT-02: a multi-day tour's stages, each with its own measures; empty for a day tour. */
  stages?: SummaryStage[]
  /** Where to download each stage as GPX, by stage number; absent while the tour is not saved. */
  stageGpxUrl?: (stage: number) => string
}

export interface SummaryStage {
  number: number
  fromName: string
  toName: string
  distanceKm: number | null
  gain: number | null
  loss: number | null
  minutes: number | null
  toM: number | null
}

interface Props {
  tours: TourListItem[]
  loading: boolean
  activeId: number | null
  summary: SummaryData | null
  days: { id: number; day_number?: number; date: string | null; title: string | null }[]
  canEdit: boolean
  onOpen: (tour: TourListItem) => void
  onNew: () => void
  onImport: () => void
  onDelete: (tour: TourListItem) => void
  onAddToDay: (tour: TourListItem, dayId: number) => void
  onCopy: (tour: TourListItem) => void
  onRestoreRecorded: (tour: TourListItem) => void
  onPlanEditable: (tour: TourListItem) => void
  exportUrl: (tour: TourListItem) => string
  onProfileFocus: (p: [number, number] | null) => void
  onCloseSelection: () => void
  selectedReadOnly: TourListItem | null
  /** Cards about the open tour shown under its summary (plan frente a realidad). */
  afterSummary?: React.ReactNode
}

const section: React.CSSProperties = { border: '1px solid var(--border-faint)', borderRadius: 14, background: 'var(--bg-card)' }
const headBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 600, textAlign: 'left' }
const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, border: '1px solid var(--border-faint)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }

function Fact({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div>
      <div className="!text-[length:11px] ![color:var(--text-faint)] !flex !items-center !gap-[4px]">
        {label}{info && <span className="!inline-flex ![cursor:help]" title={info}><Info size={11} /></span>}
      </div>
      <div className="!text-[length:14.5px] !font-[600] ![color:var(--text-primary)] !mt-[2px]">{value}</div>
    </div>
  )
}

function Summary({ s, onFocus }: { s: SummaryData; onFocus: (p: [number, number] | null) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [profileOpen, setProfileOpen] = useState(true)
  return (
    <div style={section}>
      <button type="button" style={headBtn} onClick={() => setOpen(o => !o)}>
        <SlidersHorizontal size={15} style={{ color: 'var(--text-muted)' }} />
        <span className="!flex-[1]">{t('tours.planner.inspector.title')}</span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && (
        <div className="!p-[2px_12px_12px] ![border-top:1px_solid_var(--border-faint)]">
          <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[12px_14px] !pt-[10px]">
            <Fact label={t('tours.detail.distance')} value={formatDistance(s.distanceKm)} />
            <Fact label={movingTimeLabel(s.type, t)} value={s.movingMinutes == null ? t('tours.planner.walkingTimeUnknown') : `${s.estimated ? '≈ ' : ''}${formatDurationShort(s.movingMinutes)}`} info={movingTimeInfo(s.type, t)} />
            <Fact label={t('tours.planner.breaksShort')} value={s.breakMinutes ? formatDurationShort(s.breakMinutes) : '—'} />
            <Fact label={t('tours.planner.plannedShort')} value={formatDurationShort(s.plannedMinutes)} />
            <Fact label={t('tours.detail.minAltitude')} value={formatElevation(s.minAlt)} />
            <Fact label={t('tours.detail.maxAltitude')} value={formatElevation(s.maxAlt)} />
            <Fact label={t('tours.detail.ascent')} value={formatElevation(s.gain)} />
            <Fact label={t('tours.detail.descent')} value={formatElevation(s.loss)} />
          </div>
          {(s.stages?.length ?? 0) > 1 && <StageList s={s} />}
          <button className="!p-[14px_0_8px] !text-[length:10.5px] !tracking-[0.06em] !uppercase ![color:var(--text-faint)]" type="button" onClick={() => setProfileOpen(o => !o)} style={{ ...headBtn }}>
            <span className="!flex-[1]">{t('tours.planner.inspector.elevation')}</span>
            {profileOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {profileOpen && <ElevationProfile geometry={s.geometry} onFocus={onFocus} boundariesM={(s.stages ?? []).slice(0, -1).flatMap(st => st.toM == null ? [] : [st.toM])} />}
        </div>
      )}
    </div>
  )
}

function StageList({ s }: { s: SummaryData }) {
  const { t } = useTranslation()
  const stages = s.stages ?? []
  const pill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999, border: '1px solid var(--border-faint)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }
  return (
    <div data-testid="summary-stages">
      <div className="!text-[length:10.5px] !font-[600] !tracking-[0.06em] !uppercase ![color:var(--text-faint)] !p-[16px_0_8px] !flex !items-center !gap-[4px]">
        {t('tours.stages.title')}
        <span className="!inline-flex ![cursor:help] !ml-[auto]" title={t('tours.stages.overviewHint')}><Info size={12} /></span>
      </div>
      <ol className="![list-style:none] !m-[0] !p-[0] !flex !flex-col !gap-[10px]">
        {stages.map((st, i) => (
          <li className="!flex !gap-[10px] !items-start" key={st.number}>
            <span className="!relative !w-[26px] !h-[26px] !rounded-[13px] !shrink-[0] ![background:var(--bg-tertiary)] !flex !items-center !justify-center !text-[length:12px] !font-[700] ![color:var(--text-primary)]">
              {st.number}
              {i < stages.length - 1 && <span className="!absolute !right-[-7px] !bottom-[-6px] !w-[15px] !h-[15px] !rounded-[8px] ![border:1.5px_solid_var(--bg-card)] ![background:var(--text-primary)] ![color:var(--bg-card)] !flex !items-center !justify-center" title={t('tours.stages.overnight')}><Moon size={9} /></span>}
            </span>
            <div className="!flex-[1] !min-w-[0]">
              <div className="!flex !items-center !gap-[4px] !text-[length:12.5px] !font-[600] ![color:var(--text-primary)] !min-w-[0]">
                <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap !max-w-[45%]">{st.fromName}</span>
                <span className="![color:var(--text-faint)] !shrink-[0]">→</span>
                <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap !flex-[1]">{st.toName}</span>
                {s.stageGpxUrl && <a className="![color:var(--text-faint)] !inline-flex !shrink-[0]" href={s.stageGpxUrl(st.number)} title={t('tours.stages.downloadGpx', { number: st.number })}><Download size={13} /></a>}
              </div>
              <div className="!flex !flex-wrap !gap-[4px] !mt-[4px]">
                <span style={pill}><Ruler size={10} />{formatDistance(st.distanceKm)}</span>
                {st.gain != null && <span style={pill}>↑ {formatElevation(st.gain)}</span>}
                {st.loss != null && <span style={pill}>↓ {formatElevation(st.loss)}</span>}
                {st.minutes != null && <span style={pill}><Clock size={10} />{formatDurationShort(st.minutes)}</span>}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function AddToDay({ days, onPick }: { days: Props['days']; onPick: (dayId: number) => void }) {
  const { t, locale } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button className="!w-[26px] !h-[26px] !rounded-[13px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !flex !items-center !justify-center !cursor-pointer ![color:var(--text-primary)] !p-[0]" type="button" title={t('tours.addToDay')} onClick={() => setOpen(o => !o)}>
        <Plus size={14} />
      </button>
      {open && (
        <div className="!absolute !right-[0] !top-[30px] !z-[50] !w-[210px] !max-h-[260px] !overflow-y-auto ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[12px] ![box-shadow:var(--shadow-elevated)] !p-[4px]">
          <div className="!text-[length:11px] ![color:var(--text-faint)] !p-[6px_8px]">{t('tours.addToDay')}</div>
          {days.map((d, i) => (
            <button className="trek-hover !flex !justify-between !gap-[8px] !w-[100%] !p-[7px_8px] ![border:none] !rounded-[8px] ![background:transparent] !cursor-pointer ![font-family:inherit] !text-[length:12.5px] ![color:var(--text-primary)] !text-left" key={d.id} type="button" onClick={() => { onPick(d.id); setOpen(false) }}>
              <span>{t('tours.days.short.one', { days: d.day_number ?? i + 1 })}{d.title ? ` · ${d.title}` : ''}</span>
              {d.date && <span className="![color:var(--text-faint)]">{new Date(d.date + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TourRow({ tour, active, props }: { tour: TourListItem; active: boolean; props: Props }) {
  const { t } = useTranslation()
  const grade = gradeTile(tour)
  const Icon = TYPE_ICON[tour.tour_type] ?? Mountain
  const time = tourDayTimeText(tour)
  const days = tour.day_numbers ?? []
  const [hover, setHover] = useState(false)
  return (
    <div role="button" tabIndex={0} onClick={() => props.onOpen(tour)} onKeyDown={e => { if (e.key === 'Enter') props.onOpen(tour) }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', gap: 10, padding: '10px 10px', borderRadius: 12, cursor: 'pointer', background: active ? 'var(--bg-selected, var(--bg-tertiary))' : hover ? 'var(--bg-hover)' : 'transparent', alignItems: 'flex-start' }}>
      <div className="!w-[34px] !h-[34px] !rounded-[10px] !shrink-[0] !flex !flex-col !items-center !justify-center ![background:var(--bg-tertiary)] ![color:var(--text-primary)] !text-[length:12.5px] !font-[700]">
        {grade ?? <Icon size={15} />}
        {tour.origin === 'gpx' && <span className="!text-[length:7.5px] !font-[700] !tracking-[0.04em] ![color:var(--text-muted)] !mt-[1px]">{t('tours.badgeShort.gpx')}</span>}
      </div>
      <div className="!flex-[1] !min-w-[0]">
        <div className="!text-[length:13.5px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{tour.name}</div>
        {tour.description && <div className="!text-[length:11.5px] ![color:var(--text-faint)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{tour.description}</div>}
        <div className="!flex !flex-wrap !gap-[4px] !mt-[5px]">
          {days.length > 0 && <span style={chip}><CalendarDays size={11} />{days.length === 1 ? t('tours.days.short.one', { days: days[0] }) : t('tours.days.short', { days: days.join(', ') })}</span>}
          {time && <span style={chip}><Clock size={11} />{time}</span>}
          {tour.distance != null && <span style={chip}><Ruler size={11} />{formatDistance(tour.distance)}</span>}
          {(tour.stage_count ?? 1) > 1 && <span style={chip}>{t('tours.stages.count', { count: tour.stage_count ?? 0 })}</span>}
          {tour.caution && <span className="![color:#b45309]" style={{ ...chip }} title={t('tours.caution.tooltip')}>{t('tours.caution.badge')}</span>}
        </div>
      </div>
      {props.canEdit && (active || hover) && (
        <div className="!flex !gap-[4px] !items-center">
          <AddToDay days={props.days} onPick={dayId => props.onAddToDay(tour, dayId)} />
          <button className="!w-[26px] !h-[26px] !rounded-[13px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !flex !items-center !justify-center !cursor-pointer ![color:#dc2626] !p-[0]" type="button" title={t('tours.delete.confirmAction')} onClick={e => { e.stopPropagation(); props.onDelete(tour) }}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

export default function ToursSidebar(props: Props) {
  const { t } = useTranslation()
  const { tours, summary } = props
  const [status, setStatus] = useState<TourFilter>('all')
  const [type, setType] = useState<TourType | 'all'>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [totalsOpen, setTotalsOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const list = filterTours(tours, status, type)
  const planned = tours.filter(x => x.planned).length
  const kmTotal = tours.reduce((a, x) => a + (x.distance ?? 0), 0)
  const gainTotal = tours.reduce((a, x) => a + (x.elevation_gain ?? 0), 0)
  const ro = props.selectedReadOnly

  const statusLabel = (s: TourFilter) => s === 'all' ? t('places.all') : s === 'planned' ? t('places.planned') : t('places.unplanned')

  return (
    <div className="!flex !flex-col !h-[100%] !min-h-[0]">
      <div className="!flex !items-center !p-[14px_14px_10px] !relative">
        <h2 className="!flex-[1] !m-[0] !text-[length:15px] !font-[700] ![color:var(--text-primary)]">{t('tours.planner.tripTours')}</h2>
        {props.canEdit && (
          <button className="!w-[30px] !h-[30px] !rounded-[8px] ![border:none] ![background:transparent] !cursor-pointer ![color:var(--text-primary)] !flex !items-center !justify-center" type="button" title={t('tours.planner.addTourHint')} onClick={() => setMenuOpen(o => !o)}>
            <Plus size={17} />
          </button>
        )}
        {menuOpen && (
          <div style={{ position: 'absolute', right: 12, top: 44, zIndex: 50, width: 230, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, boxShadow: 'var(--shadow-elevated)', padding: 4 }} onMouseLeave={() => setMenuOpen(false)}>
            {[{ icon: Crosshair, label: t('tours.planner.newTour'), run: props.onNew }, { icon: Upload, label: t('tours.import.button'), run: props.onImport }].map((it, i) => (
              <button className="trek-hover !flex !items-center !gap-[10px] !w-[100%] !p-[9px_10px] ![border:none] !rounded-[8px] ![background:transparent] !cursor-pointer ![font-family:inherit] !text-[length:13px] ![color:var(--text-primary)] !text-left" key={i} type="button" onClick={() => { it.run(); setMenuOpen(false) }}>
                <it.icon size={14} />{it.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="!flex-[1] !overflow-y-auto !p-[0_12px_16px] !flex !flex-col !gap-[10px]">
        {ro && (
          <div className="!p-[12px]" style={{ ...section }}>
            <div className="!flex !items-center !gap-[8px]">
              <span className="!flex-[1] !font-[700] !text-[length:14px] ![color:var(--text-primary)]">{ro.name}</span>
              <button className="![border:none] ![background:none] !cursor-pointer ![color:var(--text-faint)] !flex" type="button" onClick={props.onCloseSelection} title={t('tours.detail.close')}><X size={15} /></button>
            </div>
            <div className="!text-[length:11.5px] ![color:var(--text-faint)] !m-[2px_0_10px]">{t('tours.badge.gpx')}{ro.origin_file_name ? ` · ${ro.origin_file_name}` : ''}</div>
            <div className="!flex !flex-wrap !gap-[6px]">
              {props.canEdit && <button className="!p-[5px_10px] !cursor-pointer ![background:var(--text-primary)] ![color:var(--bg-card)] ![font-family:inherit] ![border:none]" type="button" onClick={() => props.onPlanEditable(ro)} style={{ ...chip }}><Crosshair size={12} />{t('tours.conversion.analyze')}</button>}
              <a className="!p-[5px_10px] ![text-decoration:none] ![color:var(--text-primary)]" href={props.exportUrl(ro)} style={{ ...chip }}><Download size={12} />{t('tours.gpxExport.action')}</a>
              {props.canEdit && <button className="!p-[5px_10px] !cursor-pointer ![background:var(--bg-card)] ![color:var(--text-primary)] ![font-family:inherit]" type="button" onClick={() => props.onCopy(ro)} style={{ ...chip }}><Copy size={12} />{t('tours.copy.action')}</button>}
              {props.canEdit && ro.has_recorded_track && ro.has_waypoints && <button className="!p-[5px_10px] !cursor-pointer ![background:var(--bg-card)] ![color:var(--text-primary)] ![font-family:inherit]" type="button" onClick={() => props.onRestoreRecorded(ro)} style={{ ...chip }}><History size={12} />{t('tours.recorded.restore')}</button>}
            </div>
          </div>
        )}

        {summary && <Summary s={summary} onFocus={props.onProfileFocus} />}
        {props.afterSummary}

        <div style={section}>
          <button type="button" style={headBtn} onClick={() => setFilterOpen(o => !o)}>
            <span className="!flex-[1]">{statusLabel(status)}{type !== 'all' ? ` · ${t(`tourTypes.${type}`)}` : ''} <span className="!font-[500] ![color:var(--text-faint)] !text-[length:12px]">{list.length}</span></span>
            {filterOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {filterOpen && (
            <div className="!p-[4px_12px_12px] ![border-top:1px_solid_var(--border-faint)]">
              <div className="!text-[length:11px] ![color:var(--text-faint)] !m-[8px_0_6px]">{t('tours.filter.status')}</div>
              <div className="!flex !gap-[4px] !flex-wrap">
                {(['all', 'unplanned', 'planned'] as TourFilter[]).map(s => (
                  <button className="!p-[4px_10px] !cursor-pointer ![font-family:inherit]" key={s} type="button" onClick={() => setStatus(s)} style={{ ...chip, background: status === s ? 'var(--text-primary)' : 'var(--bg-card)', color: status === s ? 'var(--bg-card)' : 'var(--text-muted)' }}>{statusLabel(s)}</button>
                ))}
              </div>
              <div className="!text-[length:11px] ![color:var(--text-faint)] !m-[10px_0_6px]">{t('tours.filter.type')}</div>
              <div className="!flex !gap-[4px] !flex-wrap">
                {(['all', ...TOUR_TYPES] as (TourType | 'all')[]).map(ty => (
                  <button className="!p-[4px_10px] !cursor-pointer ![font-family:inherit]" key={ty} type="button" onClick={() => setType(ty)} style={{ ...chip, background: type === ty ? 'var(--text-primary)' : 'var(--bg-card)', color: type === ty ? 'var(--bg-card)' : 'var(--text-muted)' }}>{ty === 'all' ? t('places.all') : t(`tourTypes.${ty}`)}</button>
                ))}
              </div>
              {(status !== 'all' || type !== 'all') && (
                <button className="!mt-[10px] ![border:none] ![background:none] !p-[0] !text-[length:12px] ![color:var(--text-muted)] ![text-decoration:underline] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => { setStatus('all'); setType('all') }}>{t('tours.filter.reset')}</button>
              )}
            </div>
          )}
        </div>

        <div style={section}>
          <button type="button" style={headBtn} onClick={() => setTotalsOpen(o => !o)}>
            <BarChart3 size={15} style={{ color: 'var(--text-muted)' }} />
            <span className="!flex-[1]">{t('tours.scope.title')}</span>
            <span className="!inline-flex ![color:var(--text-faint)]" title={t('tours.scope.info')}><Info size={13} /></span>
            {totalsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {totalsOpen && (
            <div className="!p-[2px_12px_12px] !flex !flex-wrap !gap-[6px]">
              <span className="!p-[4px_9px]" style={{ ...chip }}><strong className="![color:var(--text-primary)]">{tours.length}</strong> {t('tours.title')}</span>
              <span className="!p-[4px_9px]" style={{ ...chip }}><strong className="![color:var(--text-primary)]">{planned}</strong> {t('places.planned')}</span>
              <span className="!p-[4px_9px]" style={{ ...chip }}><strong className="![color:var(--text-primary)]">{tours.length - planned}</strong> {t('places.unplanned')}</span>
              {kmTotal > 0 && <span className="!p-[4px_9px]" style={{ ...chip }}><Ruler size={11} /><strong className="![color:var(--text-primary)]">{formatDistance(kmTotal)}</strong></span>}
              {gainTotal > 0 && <span className="!p-[4px_9px]" style={{ ...chip }}>↑ <strong className="![color:var(--text-primary)]">{formatElevation(gainTotal)}</strong></span>}
            </div>
          )}
        </div>

        <div style={section}>
          <div className="!cursor-default" style={{ ...headBtn }}>
            <Mountain size={15} style={{ color: 'var(--text-muted)' }} />
            <span className="!flex-[1]">{t('tours.title')}</span>
            <span className="!text-[length:12px] !font-[500] ![color:var(--text-faint)]">{list.length}</span>
          </div>
          <div className="!p-[0_4px_6px]">
            {props.loading && tours.length === 0 && <div className="!p-[14px] !text-[length:12px] ![color:var(--text-faint)]">{t('common.loading')}</div>}
            {!props.loading && tours.length === 0 && (
              <div className="!p-[12px_10px_14px]">
                <div className="!font-[600] !text-[length:13px] ![color:var(--text-primary)]">{t('tours.empty.title')}</div>
                <div className="!text-[length:12px] ![color:var(--text-faint)] !mt-[4px] !leading-[1.5]">{t('tours.empty.body')}</div>
              </div>
            )}
            {tours.length > 0 && list.length === 0 && <div className="!p-[12px] !text-[length:12px] ![color:var(--text-faint)]">{t('tours.filter.empty')}</div>}
            {list.map(tour => <TourRow key={tour.place_id} tour={tour} active={props.activeId === tour.place_id} props={props} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
