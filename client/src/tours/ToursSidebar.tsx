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
}

const section: React.CSSProperties = { border: '1px solid var(--border-faint)', borderRadius: 14, background: 'var(--bg-card)' }
const headBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 600, textAlign: 'left' }
const chip: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, border: '1px solid var(--border-faint)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }

function Fact({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}{info && <span title={info} style={{ display: 'inline-flex', cursor: 'help' }}><Info size={11} /></span>}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{value}</div>
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
        <span style={{ flex: 1 }}>{t('tours.planner.inspector.title')}</span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && (
        <div style={{ padding: '2px 12px 12px', borderTop: '1px solid var(--border-faint)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', paddingTop: 10 }}>
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
          <button type="button" onClick={() => setProfileOpen(o => !o)} style={{ ...headBtn, padding: '14px 0 8px', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            <span style={{ flex: 1 }}>{t('tours.planner.inspector.elevation')}</span>
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
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', padding: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
        {t('tours.stages.title')}
        <span title={t('tours.stages.overviewHint')} style={{ display: 'inline-flex', cursor: 'help', marginLeft: 'auto' }}><Info size={12} /></span>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stages.map((st, i) => (
          <li key={st.number} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ position: 'relative', width: 26, height: 26, borderRadius: 13, flexShrink: 0, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              {st.number}
              {i < stages.length - 1 && <span title={t('tours.stages.overnight')} style={{ position: 'absolute', right: -7, bottom: -6, width: 15, height: 15, borderRadius: 8, border: '1.5px solid var(--bg-card)', background: 'var(--text-primary)', color: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Moon size={9} /></span>}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%' }}>{st.fromName}</span>
                <span style={{ color: 'var(--text-faint)', flexShrink: 0 }}>→</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{st.toName}</span>
                {s.stageGpxUrl && <a href={s.stageGpxUrl(st.number)} title={t('tours.stages.downloadGpx', { number: st.number })} style={{ color: 'var(--text-faint)', display: 'inline-flex', flexShrink: 0 }}><Download size={13} /></a>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
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
      <button type="button" title={t('tours.addToDay')} onClick={() => setOpen(o => !o)}
        style={{ width: 26, height: 26, borderRadius: 13, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-primary)', padding: 0 }}>
        <Plus size={14} />
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 30, zIndex: 50, width: 210, maxHeight: 260, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, boxShadow: 'var(--shadow-elevated)', padding: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '6px 8px' }}>{t('tours.addToDay')}</div>
          {days.map((d, i) => (
            <button key={d.id} type="button" onClick={() => { onPick(d.id); setOpen(false) }}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text-primary)', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span>{t('tours.days.short.one', { days: d.day_number ?? i + 1 })}{d.title ? ` · ${d.title}` : ''}</span>
              {d.date && <span style={{ color: 'var(--text-faint)' }}>{new Date(d.date + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>}
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
      <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700 }}>
        {grade ?? <Icon size={15} />}
        {tour.origin === 'gpx' && <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)', marginTop: 1 }}>{t('tours.badgeShort.gpx')}</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tour.name}</div>
        {tour.description && <div style={{ fontSize: 11.5, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tour.description}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
          {days.length > 0 && <span style={chip}><CalendarDays size={11} />{days.length === 1 ? t('tours.days.short.one', { days: days[0] }) : t('tours.days.short', { days: days.join(', ') })}</span>}
          {time && <span style={chip}><Clock size={11} />{time}</span>}
          {tour.distance != null && <span style={chip}><Ruler size={11} />{formatDistance(tour.distance)}</span>}
          {(tour.stage_count ?? 1) > 1 && <span style={chip}>{t('tours.stages.count', { count: tour.stage_count ?? 0 })}</span>}
          {tour.caution && <span style={{ ...chip, color: '#b45309' }} title={t('tours.caution.tooltip')}>{t('tours.caution.badge')}</span>}
        </div>
      </div>
      {props.canEdit && (active || hover) && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <AddToDay days={props.days} onPick={dayId => props.onAddToDay(tour, dayId)} />
          <button type="button" title={t('tours.delete.confirmAction')} onClick={e => { e.stopPropagation(); props.onDelete(tour) }}
            style={{ width: 26, height: 26, borderRadius: 13, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#dc2626', padding: 0 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 14px 10px', position: 'relative' }}>
        <h2 style={{ flex: 1, margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{t('tours.planner.tripTours')}</h2>
        {props.canEdit && (
          <button type="button" title={t('tours.planner.addTourHint')} onClick={() => setMenuOpen(o => !o)}
            style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={17} />
          </button>
        )}
        {menuOpen && (
          <div style={{ position: 'absolute', right: 12, top: 44, zIndex: 50, width: 230, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, boxShadow: 'var(--shadow-elevated)', padding: 4 }} onMouseLeave={() => setMenuOpen(false)}>
            {[{ icon: Crosshair, label: t('tours.planner.newTour'), run: props.onNew }, { icon: Upload, label: t('tours.import.button'), run: props.onImport }].map((it, i) => (
              <button key={i} type="button" onClick={() => { it.run(); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)', textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <it.icon size={14} />{it.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ro && (
          <div style={{ ...section, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{ro.name}</span>
              <button type="button" onClick={props.onCloseSelection} title={t('tours.detail.close')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}><X size={15} /></button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '2px 0 10px' }}>{t('tours.badge.gpx')}{ro.origin_file_name ? ` · ${ro.origin_file_name}` : ''}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {props.canEdit && <button type="button" onClick={() => props.onPlanEditable(ro)} style={{ ...chip, padding: '5px 10px', cursor: 'pointer', background: 'var(--text-primary)', color: 'var(--bg-card)', fontFamily: 'inherit', border: 'none' }}><Crosshair size={12} />{t('tours.conversion.analyze')}</button>}
              <a href={props.exportUrl(ro)} style={{ ...chip, padding: '5px 10px', textDecoration: 'none', color: 'var(--text-primary)' }}><Download size={12} />{t('tours.gpxExport.action')}</a>
              {props.canEdit && <button type="button" onClick={() => props.onCopy(ro)} style={{ ...chip, padding: '5px 10px', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'inherit' }}><Copy size={12} />{t('tours.copy.action')}</button>}
              {props.canEdit && ro.has_recorded_track && ro.has_waypoints && <button type="button" onClick={() => props.onRestoreRecorded(ro)} style={{ ...chip, padding: '5px 10px', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'inherit' }}><History size={12} />{t('tours.recorded.restore')}</button>}
            </div>
          </div>
        )}

        {summary && <Summary s={summary} onFocus={props.onProfileFocus} />}

        <div style={section}>
          <button type="button" style={headBtn} onClick={() => setFilterOpen(o => !o)}>
            <span style={{ flex: 1 }}>{statusLabel(status)}{type !== 'all' ? ` · ${t(`tourTypes.${type}`)}` : ''} <span style={{ fontWeight: 500, color: 'var(--text-faint)', fontSize: 12 }}>{list.length}</span></span>
            {filterOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {filterOpen && (
            <div style={{ padding: '4px 12px 12px', borderTop: '1px solid var(--border-faint)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', margin: '8px 0 6px' }}>{t('tours.filter.status')}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['all', 'unplanned', 'planned'] as TourFilter[]).map(s => (
                  <button key={s} type="button" onClick={() => setStatus(s)} style={{ ...chip, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', background: status === s ? 'var(--text-primary)' : 'var(--bg-card)', color: status === s ? 'var(--bg-card)' : 'var(--text-muted)' }}>{statusLabel(s)}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', margin: '10px 0 6px' }}>{t('tours.filter.type')}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(['all', ...TOUR_TYPES] as (TourType | 'all')[]).map(ty => (
                  <button key={ty} type="button" onClick={() => setType(ty)} style={{ ...chip, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', background: type === ty ? 'var(--text-primary)' : 'var(--bg-card)', color: type === ty ? 'var(--bg-card)' : 'var(--text-muted)' }}>{ty === 'all' ? t('places.all') : t(`tourTypes.${ty}`)}</button>
                ))}
              </div>
              {(status !== 'all' || type !== 'all') && (
                <button type="button" onClick={() => { setStatus('all'); setType('all') }} style={{ marginTop: 10, border: 'none', background: 'none', padding: 0, fontSize: 12, color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>{t('tours.filter.reset')}</button>
              )}
            </div>
          )}
        </div>

        <div style={section}>
          <button type="button" style={headBtn} onClick={() => setTotalsOpen(o => !o)}>
            <BarChart3 size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ flex: 1 }}>{t('tours.scope.title')}</span>
            <span title={t('tours.scope.info')} style={{ display: 'inline-flex', color: 'var(--text-faint)' }}><Info size={13} /></span>
            {totalsOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {totalsOpen && (
            <div style={{ padding: '2px 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ ...chip, padding: '4px 9px' }}><strong style={{ color: 'var(--text-primary)' }}>{tours.length}</strong> {t('tours.title')}</span>
              <span style={{ ...chip, padding: '4px 9px' }}><strong style={{ color: 'var(--text-primary)' }}>{planned}</strong> {t('places.planned')}</span>
              <span style={{ ...chip, padding: '4px 9px' }}><strong style={{ color: 'var(--text-primary)' }}>{tours.length - planned}</strong> {t('places.unplanned')}</span>
              {kmTotal > 0 && <span style={{ ...chip, padding: '4px 9px' }}><Ruler size={11} /><strong style={{ color: 'var(--text-primary)' }}>{formatDistance(kmTotal)}</strong></span>}
              {gainTotal > 0 && <span style={{ ...chip, padding: '4px 9px' }}>↑ <strong style={{ color: 'var(--text-primary)' }}>{formatElevation(gainTotal)}</strong></span>}
            </div>
          )}
        </div>

        <div style={section}>
          <div style={{ ...headBtn, cursor: 'default' }}>
            <Mountain size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ flex: 1 }}>{t('tours.title')}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-faint)' }}>{list.length}</span>
          </div>
          <div style={{ padding: '0 4px 6px' }}>
            {props.loading && tours.length === 0 && <div style={{ padding: 14, fontSize: 12, color: 'var(--text-faint)' }}>{t('common.loading')}</div>}
            {!props.loading && tours.length === 0 && (
              <div style={{ padding: '12px 10px 14px' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{t('tours.empty.title')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4, lineHeight: 1.5 }}>{t('tours.empty.body')}</div>
              </div>
            )}
            {tours.length > 0 && list.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-faint)' }}>{t('tours.filter.empty')}</div>}
            {list.map(tour => <TourRow key={tour.place_id} tour={tour} active={props.activeId === tour.place_id} props={props} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
