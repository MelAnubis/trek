// La columna izquierda del espacio de Tours (TourWorkspaceRail + TourPlannerPanels de la v5):
// nombre, tipo, día o varios días, campos del tipo, puntos de paso con su menú, tiempos, estado y guardar.
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Download, Undo2, Redo2, ArrowDownUp, RefreshCcw, MoreHorizontal, Trash2, MapPin, MapPinned, Crosshair,
  ChevronDown, ChevronUp, Sun, Ruler, Clock, CalendarRange, Mountain, Bike, Footprints, Save, RotateCcw, Flag, Spline, Waypoints, Link2Off, Info, AlertTriangle, Upload,
} from 'lucide-react'
import { useTranslation } from '../i18n'
import type { TourPlanner } from './useTourPlanner'
import type { TourType } from './toursApi'
import { TOUR_TYPES, TOUR_TYPE_COLOR, formatDistance, formatDurationShort, formatPace, parsePace } from './presentation'
import { BIKE_PROFILES, RUN_PROFILES, HIKING_PREFERENCE_KEYS } from './core'
import { stopNameOf } from './stages'

const TYPE_ICON: Record<TourType, typeof Mountain> = { hike: Mountain, bike: Bike, run: Footprints }

export interface TripPlaceOption { id: number; name: string; lat: number; lng: number }

interface Props {
  planner: TourPlanner
  tripPlaces: TripPlaceOption[]
  exportUrl: string | null
  onBack: () => void
  onStartNew: () => void
  onImport: () => void
  canEdit: boolean
  /** Cards that read the route: surfaces and ways, places along it. */
  extra?: React.ReactNode
}

const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '0 0 6px' }
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-input, var(--bg-card))', color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
const card: React.CSSProperties = { border: '1px solid var(--border-faint)', borderRadius: 14, background: 'var(--bg-card)', overflow: 'visible' }
const iconBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; icon?: typeof Sun }[]; onChange: (v: T) => void }) {
  return (
    <div className="!flex !gap-[2px] !p-[3px] !rounded-[11px] ![background:var(--bg-tertiary)]">
      {options.map(o => {
        const active = o.id === value
        return (
          <button className="!flex-[1] !flex !items-center !justify-center !gap-[6px] !p-[7px_8px] !rounded-[9px] ![border:none] !cursor-pointer" key={o.id} type="button" onClick={() => onChange(o.id)}
            style={{ fontFamily: 'inherit', fontSize: 12.5, fontWeight: active ? 600 : 500, background: active ? 'var(--bg-card)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)', boxShadow: active ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>
            {o.icon && <o.icon size={13} />}{o.label}
          </button>
        )
      })}
    </div>
  )
}

function InfoDot({ text }: { text: string }) {
  return <span className="!inline-flex ![color:var(--text-faint)] ![cursor:help] ![vertical-align:middle] !ml-[4px]" title={text}><Info size={12} /></span>
}

function TypeSelect({ value, onChange }: { value: TourType; onChange: (v: TourType) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const Icon = TYPE_ICON[value]
  return (
    <div className="!relative">
      <button className="!flex !items-center !gap-[10px] !cursor-pointer !text-left !p-[8px_12px]" type="button" onClick={() => setOpen(o => !o)} style={{ ...input }}>
        <span className="!w-[30px] !h-[30px] !rounded-[8px] ![background:var(--bg-tertiary)] !flex !items-center !justify-center !shrink-[0]"><Icon size={15} /></span>
        <span className="!flex-[1] !min-w-[0]">
          <span className="!block !font-[600] !text-[length:13.5px]">{t(`tourTypes.${value}`)}</span>
          <span className="!block !text-[length:11.5px] ![color:var(--text-faint)] !whitespace-nowrap !overflow-hidden !text-ellipsis">{t(`tours.planner.tourTypeHint.${value}`)}</span>
        </span>
        <ChevronDown size={15} style={{ color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <div className="!absolute !z-[30] !top-[calc(100%_+_4px)] !left-[0] !right-[0] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[12px] ![box-shadow:var(--shadow-elevated)] !p-[4px]">
          {TOUR_TYPES.map(type => {
            const I = TYPE_ICON[type]
            return (
              <button className="!flex !items-center !gap-[10px] !w-[100%] !p-[8px_10px] !rounded-[9px] ![border:none] !cursor-pointer !text-left ![font-family:inherit] ![color:var(--text-primary)]" key={type} type="button" onClick={() => { onChange(type); setOpen(false) }}
                style={{ background: type === value ? 'var(--bg-tertiary)' : 'transparent' }}>
                <span className="!w-[8px] !h-[8px] !rounded-[4px]" style={{ background: TOUR_TYPE_COLOR[type] }} />
                <I size={15} />
                <span className="!flex-[1]">
                  <span className="!block !font-[600] !text-[length:13px]">{t(`tourTypes.${type}`)}</span>
                  <span className="!block !text-[length:11px] ![color:var(--text-faint)]">{t(`tours.planner.tourTypeHint.${type}`)}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PointMenu({ planner, id, index, count }: { planner: TourPlanner; id: string; index: number; count: number }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const p = planner.points[index]
  const inner = index > 0 && index < count - 1
  const items: ({ icon: typeof Sun; label: string; run: () => void; hide?: boolean } | 'sep')[] = [
    { icon: ChevronUp, label: t('tours.planner.moveUp'), run: () => planner.shiftPoint(id, -1), hide: index === 0 },
    { icon: ChevronDown, label: t('tours.planner.moveDown'), run: () => planner.shiftPoint(id, 1), hide: index === count - 1 },
    { icon: Waypoints, label: t('tours.planner.placeInOrder'), run: () => planner.placeInOrder(id), hide: count < 3 },
    'sep',
    { icon: Spline, label: p.fixed_leg ? t('tours.planner.recomputeLeg') : t('tours.planner.freeLeg'), run: () => planner.drawLegByHand(id), hide: index === count - 1 },
    { icon: Waypoints, label: p.shaping ? t('tours.planner.makeStop') : t('tours.planner.makeShaping'), run: () => planner.toggleShaping(id), hide: !inner },
    'sep',
    { icon: Flag, label: p.stage_end ? t('tours.stages.removeEnd') : t('tours.stages.endHere'), run: () => planner.toggleStageEnd(id), hide: !inner || !planner.fields.multiDay || p.shaping },
    { icon: Link2Off, label: t('tours.placePicker.unlink'), run: () => planner.unlinkPlace(id), hide: !p.linked_place_id },
  ]
  const visible = items.filter(i => i === 'sep' || !i.hide)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" style={iconBtn} onClick={() => setOpen(o => !o)} aria-label="…"><MoreHorizontal size={15} /></button>
      {open && (
        <div className="!absolute !right-[0] !top-[30px] !z-[40] !min-w-[230px] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[12px] ![box-shadow:var(--shadow-elevated)] !p-[4px]">
          {visible.map((it, i) => it === 'sep'
            ? (i > 0 && i < visible.length - 1 && visible[i - 1] !== 'sep' ? <div className="!h-[1px] ![background:var(--border-faint)] !m-[4px_6px]" key={i} /> : null)
            : (
              <button className="trek-hover !flex !items-center !gap-[10px] !w-[100%] !p-[8px_10px] ![border:none] ![background:transparent] !rounded-[8px] !cursor-pointer ![font-family:inherit] !text-[length:13px] ![color:var(--text-primary)] !text-left" key={i} type="button" onClick={() => { it.run(); setOpen(false) }}>
                <it.icon size={14} style={{ color: 'var(--text-muted)' }} />{it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

/** MDT: a multi-day tour downloads whole or day by day. */
function GpxMenu({ exportUrl, stages }: { exportUrl: string; stages: { number: number; from: string; to: string }[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, color: 'var(--text-primary)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" style={iconBtn} onClick={() => setOpen(o => !o)} title={t('tours.gpxExport.action')} data-testid="gpx-menu"><Download size={15} /></button>
      {open && (
        <div className="!absolute !right-[0] !top-[32px] !z-[50] !w-[260px] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[12px] ![box-shadow:var(--shadow-elevated)] !p-[4px]">
          <a className="!font-[600]" href={exportUrl} style={{ ...item }} onClick={() => setOpen(false)}><Download size={13} />{t('tours.gpxExport.whole')}</a>
          <div className="!h-[1px] ![background:var(--border-faint)] !m-[4px_6px]" />
          {stages.map(st => (
            <a className="trek-hover" key={st.number} href={`${exportUrl}?stage=${st.number}`} style={item} onClick={() => setOpen(false)}>
              <Download size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} /><span className="!overflow-hidden !text-ellipsis">{t('tours.gpxExport.stage', { number: st.number, from: st.from, to: st.to })}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function TripPlacePicker({ places, onPick, onClose }: { places: TripPlaceOption[]; onPick: (p: TripPlaceOption) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const list = places.filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="!mt-[8px] ![border:1px_solid_var(--border-primary)] !rounded-[12px] ![background:var(--bg-card)] !p-[8px]">
      <div className="!flex !gap-[6px] !mb-[6px]">
        <input className="!p-[7px_10px] !text-[length:12.5px]" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('tours.placePicker.search')} style={{ ...input }} />
        <button className="!w-[34px] !h-[34px]" type="button" onClick={onClose} style={{ ...iconBtn }}>✕</button>
      </div>
      <div className="!max-h-[220px] !overflow-y-auto">
        {list.length === 0 && <div className="!text-[length:12px] ![color:var(--text-faint)] !p-[8px]">{t('tours.placePicker.empty')}</div>}
        {list.map(p => (
          <button className="trek-hover !flex !items-center !gap-[8px] !w-[100%] !p-[7px_8px] ![border:none] ![background:transparent] !rounded-[8px] !cursor-pointer ![font-family:inherit] !text-[length:12.5px] ![color:var(--text-primary)] !text-left" key={p.id} type="button" onClick={() => onPick(p)}>
            <MapPinned size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MinutesInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => { setText(value == null ? '' : String(value)) }, [value])
  return (
    <input className="!p-[7px_10px] !w-[90px]" inputMode="numeric" value={text} placeholder={placeholder}
      onChange={e => {
        const v = e.target.value.replace(/[^\d]/g, '')
        setText(v)
        onChange(v === '' ? null : Math.min(1440, Number(v)))
      }}
      style={{ ...input }} />
  )
}

function statusText(planner: TourPlanner, t: (k: string, p?: Record<string, string | number>) => string): { text: string; tone: 'muted' | 'warn' } | null {
  const s = planner.status
  switch (s.kind) {
    case 'dirty': return { text: t('tours.planner.status.dirty'), tone: 'muted' }
    case 'routing': return { text: planner.fields.tourType === 'bike' ? t('tours.planner.status.routingGeneric') : t('tours.planner.status.routing'), tone: 'muted' }
    case 'routingFailed': return { text: t('tours.planner.status.routingFailed'), tone: 'warn' }
    case 'unreachable': return {
      text: t(planner.fields.tourType === 'bike' ? 'tours.planner.unreachable.bike' : 'tours.planner.unreachable.hike', { point: s.point, distance: `${Math.round(s.meters)} m` }),
      tone: 'warn',
    }
    case 'elevation': return { text: t('tours.planner.status.elevation'), tone: 'muted' }
    case 'elevationFailed': return { text: t('tours.planner.status.elevationFailed'), tone: 'warn' }
    case 'saving': return { text: t('tours.planner.status.saving'), tone: 'muted' }
    case 'saveFailed': return { text: t('tours.planner.status.saveFailed'), tone: 'warn' }
    case 'conflict': return { text: t('tours.revision.conflictBody'), tone: 'warn' }
    default: break
  }
  if (planner.fields.tourType === 'run' && !planner.fields.runPace) return { text: t('tours.run.paceNeeded'), tone: 'warn' }
  if (planner.timeTooLong) return { text: t('tours.stages.tooLong'), tone: 'warn' }
  if (!planner.dirty || planner.points.length < 2) return { text: t('tours.planner.nothingToSave'), tone: 'muted' }
  return null
}

export default function TourRail({ planner, tripPlaces, exportUrl, onBack, onStartNew, onImport, canEdit, extra }: Props) {
  const { t } = useTranslation()
  const [showPicker, setShowPicker] = useState(false)
  const [paceText, setPaceText] = useState(formatPace(planner.fields.runPace))
  useEffect(() => { setPaceText(formatPace(planner.fields.runPace)) }, [planner.fields.runPace, planner.open?.placeId])

  if (!planner.open) {
    return (
      <div className="!p-[20px] !flex !flex-col !gap-[14px]">
        <h2 className="!m-[0] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">{t('tours.planner.neutralTitle')}</h2>
        <p className="!m-[0] !text-[length:13px] ![color:var(--text-muted)] !leading-[1.5]">{t('tours.planner.neutralBody')}</p>
        {canEdit && (
          <>
            <button className="!flex !items-center !justify-center !gap-[8px] !p-[10px_14px] !rounded-[11px] ![border:none] ![background:var(--text-primary)] ![color:var(--bg-card)] !font-[600] !text-[length:13.5px] !cursor-pointer ![font-family:inherit]" type="button" onClick={onStartNew}>
              <Crosshair size={15} />{t('tours.planner.newTour')}
            </button>
            <button className="!flex !items-center !justify-center !gap-[8px] !p-[10px_14px] !rounded-[11px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !font-[500] !text-[length:13.5px] !cursor-pointer ![font-family:inherit]" type="button" onClick={onImport}>
              <Upload size={15} />{t('tours.import.button')}
            </button>
            <p className="!m-[0] !text-[length:11.5px] ![color:var(--text-faint)] !leading-[1.5]">{t('tours.import.hint')}</p>
          </>
        )}
      </div>
    )
  }

  const f = planner.fields
  const count = planner.points.length
  let stage = 1
  const status = statusText(planner, t)
  const isNew = planner.open.placeId == null

  return (
    <div className="!flex !flex-col !h-[100%] !min-h-[0]">
      <div className="!flex !items-center !gap-[4px] !p-[12px_12px_10px] ![border-bottom:1px_solid_var(--border-faint)]">
        <button type="button" style={iconBtn} onClick={onBack} title={t('tours.planner.backToTours')}><ArrowLeft size={16} /></button>
        <h2 className="!flex-[1] !m-[0_0_0_4px] !text-[length:15px] !font-[700] ![color:var(--text-primary)]">{isNew ? t('tours.planner.newTitle') : t('tours.planner.editTitle')}</h2>
        {exportUrl && (planner.stages.length > 1 && !planner.dirty
          ? <GpxMenu exportUrl={exportUrl} stages={planner.stages.map(st => ({ number: st.number, from: stopNameOf(planner.points, st.from, n => t('tours.planner.waypointLabel', { n })), to: stopNameOf(planner.points, st.to, n => t('tours.planner.waypointLabel', { n })) }))} />
          : <a className="![text-decoration:none]" href={exportUrl} style={{ ...iconBtn }} title={t('tours.gpxExport.action')}><Download size={15} /></a>)}
        <button type="button" style={{ ...iconBtn, opacity: planner.canUndo ? 1 : 0.35 }} disabled={!planner.canUndo} onClick={planner.undo} title={t('tours.planner.undo')}><Undo2 size={15} /></button>
        <button type="button" style={{ ...iconBtn, opacity: planner.canRedo ? 1 : 0.35 }} disabled={!planner.canRedo} onClick={planner.redo} title={t('tours.planner.redo')}><Redo2 size={15} /></button>
      </div>

      <div className="!flex-[1] !overflow-y-auto !p-[12px] !flex !flex-col !gap-[14px]">
        <div>
          <p style={label}>{t('tours.planner.name')}</p>
          <input value={f.name} onChange={e => planner.setFields({ name: e.target.value })} maxLength={255}
            placeholder={t(f.tourType === 'hike' ? 'tours.planner.namePlaceholder' : `tours.planner.namePlaceholder.${f.tourType}`)} style={input} />
        </div>
        <div>
          <p style={label}>{t('tours.planner.tourType')}</p>
          <TypeSelect value={f.tourType} onChange={v => planner.setFields({ tourType: v })} />
        </div>
        <div>
          <p style={label}>{t('tours.stages.mode')}</p>
          <Segmented value={f.multiDay ? 'multi' : 'single'} onChange={v => planner.setFields({ multiDay: v === 'multi' })}
            options={[{ id: 'single', label: t('tours.stages.mode.single'), icon: Sun }, { id: 'multi', label: t('tours.stages.mode.multi'), icon: CalendarRange }]} />
        </div>

        <div style={card}>
          <div className="!flex !items-center !gap-[6px] !p-[10px_10px_8px_12px] ![border-bottom:1px_solid_var(--border-faint)]">
            <MapPin size={15} style={{ color: 'var(--text-muted)' }} />
            <span className="!flex-[1] !font-[600] !text-[length:13.5px] ![color:var(--text-primary)]">{t('tours.planner.waypoints')}</span>
            <button type="button" style={iconBtn} onClick={planner.reverse} disabled={count < 2} title={t('tours.planner.reverse')}><ArrowDownUp size={14} /></button>
            <button type="button" style={iconBtn} onClick={planner.roundTrip} disabled={count < 2} title={t('tours.planner.roundHike')}><RefreshCcw size={14} /></button>
            <span className="!text-[length:12px] ![color:var(--text-faint)] !min-w-[14px] !text-right">{count}</span>
          </div>
          <div className="!p-[6px]">
            {planner.points.map((p, i) => {
              const stageHead = f.multiDay && (i === 0 || (planner.points[i - 1]?.stage_end))
              if (i > 0 && planner.points[i - 1]?.stage_end && f.multiDay) stage += 1
              const role = i === 0 ? t('tours.planner.start') : i === count - 1 ? t('tours.planner.end') : null
              const n = planner.points.slice(0, i + 1).filter(x => !x.shaping).length
              const linked = p.linked_place_id ? tripPlaces.find(tp => tp.id === p.linked_place_id) : null
              return (
                <div key={p.id}>
                  {stageHead && (
                    <div className="!flex !items-center !gap-[8px] !m-[6px_4px]">
                      <span className="!inline-flex !items-center !gap-[5px] !p-[3px_9px] !rounded-[999px] ![background:var(--text-primary)] ![color:var(--bg-card)] !text-[length:11.5px] !font-[600]"><Mountain size={11} />{t('tours.stages.stage', { number: stage })}</span>
                      {(() => {
                        const st = planner.stages[stage - 1]
                        if (!st || st.distanceKm == null) return null
                        const pill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-faint)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }
                        return (
                          <span className="!inline-flex !gap-[4px]" data-testid={`stage-pills-${stage}`}>
                            <span style={pill}><Ruler size={10} />{formatDistance(st.distanceKm)}</span>
                            {st.minutes != null && <span style={pill}><Clock size={10} />{formatDurationShort(st.minutes)}</span>}
                          </span>
                        )
                      })()}
                      <span className="!flex-[1] !h-[1px] ![background:var(--border-faint)]" />
                    </div>
                  )}
                  <div className="!flex !items-center !gap-[10px] !p-[7px_6px] !rounded-[10px]">
                    {p.shaping
                      ? <span className="!w-[26px] !flex !justify-center"><span className="!w-[10px] !h-[10px] !rounded-[5px] ![border:2.5px_solid_#2563eb] ![background:#fff]" /></span>
                      : <span className="!w-[26px] !h-[26px] !rounded-[13px] !shrink-[0] !flex !items-center !justify-center !text-[length:12px] !font-[600]" style={{ background: role ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: role ? 'var(--bg-card)' : 'var(--text-primary)' }}>{n}</span>}
                    <div className="!flex-[1] !min-w-[0]">
                      <div className="!flex !items-center !gap-[6px]">
                        <span className="!text-[length:13px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                          {p.name || linked?.name || (p.shaping ? t('tours.planner.shapingPoint') : t('tours.planner.waypointLabel', { n }))}
                        </span>
                        {role && <span className="!text-[length:10.5px] !p-[1px_7px] !rounded-[999px] ![border:1px_solid_var(--border-primary)] ![color:var(--text-muted)]">{role}</span>}
                        {p.stage_end && f.multiDay && <Flag size={12} style={{ color: 'var(--text-muted)' }} />}
                      </div>
                      <div className="!text-[length:11px] ![color:var(--text-faint)]">
                        {linked ? t('tours.placePicker.linked') : `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
                        {p.fixed_leg?.kind === 'free' && <> · {t('tours.planner.freeLegBadge')}</>}
                      </div>
                    </div>
                    <PointMenu planner={planner} id={p.id} index={i} count={count} />
                    <button className="![color:#dc2626]" type="button" style={{ ...iconBtn }} onClick={() => planner.removePoint(p.id)} title={t('tours.planner.remove')}><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
            <div className="!flex !gap-[4px] !p-[3px] !rounded-[11px] ![background:var(--bg-tertiary)] !mt-[6px]">
              <button className="!flex-[1] !flex !items-center !justify-center !gap-[6px] !p-[8px] !rounded-[9px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12.5px] !font-[600]" type="button" onClick={() => planner.setAddMode(!planner.addMode)}
                style={{ background: planner.addMode ? 'var(--text-primary)' : 'var(--bg-card)', color: planner.addMode ? 'var(--bg-card)' : 'var(--text-primary)' }}>
                <Crosshair size={14} />{planner.addMode ? t('tours.planner.addPointActive') : t('tours.planner.addPoint')}
              </button>
              <button className="!flex-[1] !flex !items-center !justify-center !gap-[6px] !p-[8px] !rounded-[9px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12.5px] !font-[500] ![background:transparent] ![color:var(--text-muted)]" type="button" onClick={() => setShowPicker(s => !s)}>
                <MapPinned size={14} />{t('tours.placePicker.open')}
              </button>
            </div>
            {showPicker && <TripPlacePicker places={tripPlaces} onClose={() => setShowPicker(false)} onPick={tp => { planner.addPointInOrder(tp.lat, tp.lng, { name: tp.name, linked_place_id: tp.id }); setShowPicker(false) }} />}
            <p className="!m-[8px_4px_2px] !text-[length:11.5px] ![color:var(--text-faint)] !leading-[1.45]">
              {count < 2 ? t('tours.planner.emptyHint') : t('tours.planner.shapeOnLine')}
              {f.multiDay && count >= 2 && <> {t('tours.stages.emptyHint')}</>}
            </p>
          </div>
        </div>

        {f.tourType === 'hike' && (
          <div className="!p-[12px]" style={{ ...card }}>
            <p style={label}>{t('tours.planner.maxDifficulty')}</p>
            <select className="!p-[8px_10px]" value={f.maxDifficulty} onChange={e => planner.setFields({ maxDifficulty: Number(e.target.value) })} style={{ ...input }}>
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{t(`tours.planner.difficulty.t${n}`)}</option>)}
            </select>
            {f.maxDifficulty >= 3 && (
              <div className="!flex !gap-[8px] !mt-[8px] !text-[length:11.5px] ![color:var(--text-muted)] !leading-[1.45]">
                <AlertTriangle size={14} style={{ flexShrink: 0, color: '#d97706', marginTop: 1 }} />
                <span>{f.maxDifficulty >= 4 ? t('tours.planner.difficulty.alpineBody') : t('tours.planner.difficulty.t3Warning')}</span>
              </div>
            )}
            <p className="!mt-[14px]" style={{ ...label }}>{t('tours.preferences.title')}<InfoDot text={t('tours.preferences.info')} /></p>
            {HIKING_PREFERENCE_KEYS.map(key => (
              <label className="!flex !items-start !gap-[10px] !p-[6px_0] !cursor-pointer" key={key}>
                <input className="!mt-[2px]" type="checkbox" checked={!!f.preferences[key]} onChange={e => planner.setFields({ preferences: { ...f.preferences, [key]: e.target.checked } })} />
                <span>
                  <span className="!block !text-[length:13px] ![color:var(--text-primary)]">{t(`tours.preferences.${key}`)}</span>
                  <span className="!block !text-[length:11px] ![color:var(--text-faint)]">{t(`tours.preferences.${key}Hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {f.tourType === 'bike' && (
          <div className="!p-[12px]" style={{ ...card }}>
            <p style={label}>{t('tours.bike.profile')}</p>
            <Segmented value={f.bikeProfile} onChange={v => planner.setFields({ bikeProfile: v })} options={BIKE_PROFILES.map(p => ({ id: p, label: t(`tours.bike.profile.${p}`) }))} />
            <p className="!m-[8px_0_0] !text-[length:11.5px] ![color:var(--text-faint)]">{t(`tours.bike.profileHint.${f.bikeProfile}`)}</p>
          </div>
        )}
        {f.tourType === 'run' && (
          <div className="!p-[12px]" style={{ ...card }}>
            <p style={label}>{t('tours.run.profile')}</p>
            <Segmented value={f.runProfile} onChange={v => planner.setFields({ runProfile: v })} options={RUN_PROFILES.map(p => ({ id: p, label: t(`tours.run.profile.${p}`) }))} />
            <p className="!m-[8px_0_12px] !text-[length:11.5px] ![color:var(--text-faint)]">{t(`tours.run.profileHint.${f.runProfile}`)}</p>
            <p style={label}>{t('tours.run.pace')}<InfoDot text={t('tours.run.paceInfo')} /></p>
            <div className="!flex !items-center !gap-[8px]">
              <input className="!w-[90px] !p-[7px_10px]" value={paceText} onChange={e => { setPaceText(e.target.value); planner.setFields({ runPace: parsePace(e.target.value) }) }} placeholder="6:00" style={{ ...input }} />
              <span className="!text-[length:12px] ![color:var(--text-faint)]">{t('tours.run.paceUnit')}</span>
            </div>
            {paceText && !f.runPace && <p className="!m-[6px_0_0] !text-[length:11.5px] ![color:#dc2626]">{t('tours.run.paceInvalid', { fastest: '2:00', slowest: '20:00' })}</p>}
          </div>
        )}

        <div className="!p-[12px]" style={{ ...card }}>
          <div className="!flex !items-center !justify-between !gap-[10px] !mb-[10px]">
            <span className="!text-[length:12.5px] ![color:var(--text-muted)]">{t('tours.planner.breaksAdditional')}<InfoDot text={t('tours.planner.breaksAdditionalInfo')} /></span>
            <MinutesInput value={f.breakMinutes} onChange={v => planner.setFields({ breakMinutes: v })} placeholder="min" />
          </div>
          <div className="!flex !items-center !justify-between !gap-[10px]">
            <span className="!text-[length:12.5px] ![color:var(--text-muted)]">{t('tours.planner.plannedTotalManual')}<InfoDot text={t('tours.planner.plannedTotalInfo')} /></span>
            <MinutesInput value={f.plannedOverride} onChange={v => planner.setFields({ plannedOverride: v })} placeholder={planner.plannedTotal != null ? String(Math.round(planner.plannedTotal)) : 'min'} />
          </div>
          <div className="!mt-[10px] !text-[length:12.5px] ![color:var(--text-primary)] !flex !justify-between">
            <span className="![color:var(--text-muted)]">{t('tours.planner.plannedTotalDuration')}</span>
            <strong>{formatDurationShort(planner.plannedTotal)}</strong>
          </div>
        </div>
        {extra}
        <p className="!m-[0] !text-[length:11px] ![color:var(--text-faint)]">{t('tours.planner.safetyNote')}</p>
      </div>

      <div className="![border-top:1px_solid_var(--border-faint)] !p-[12px]">
        {status && (
          <div className="!text-[length:11.5px] !text-center !mb-[8px] !flex !items-center !justify-center !gap-[8px] !flex-wrap" style={{ color: status.tone === 'warn' ? '#b45309' : 'var(--text-faint)' }}>
            <span>{status.text}</span>
            {(planner.status.kind === 'routingFailed' || planner.status.kind === 'elevationFailed') && (
              <button className="![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !rounded-[8px] !p-[2px_8px] !text-[length:11.5px] !cursor-pointer ![color:var(--text-primary)] ![font-family:inherit]" type="button" onClick={planner.retry}>{t('tours.planner.retry')}</button>
            )}
          </div>
        )}
        <div className="!flex !gap-[8px]">
          <button className="!flex !items-center !gap-[6px] !p-[9px_14px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !cursor-pointer ![font-family:inherit] !text-[length:13px]" type="button" onClick={onBack}>
            <RotateCcw size={14} />{t('tours.conversion.discard')}
          </button>
          <button className="!flex-[1] !flex !items-center !justify-center !gap-[6px] !p-[9px_14px] !rounded-[10px] ![border:none] ![font-family:inherit] !text-[length:13px] !font-[600]" type="button" disabled={!planner.canSave} onClick={() => { void planner.save() }}
            style={{ background: planner.canSave ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: planner.canSave ? 'var(--bg-card)' : 'var(--text-faint)', cursor: planner.canSave ? 'pointer' : 'default' }}>
            <Save size={14} />{t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
