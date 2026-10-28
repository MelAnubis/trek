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
    <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 11, background: 'var(--bg-tertiary)' }}>
      {options.map(o => {
        const active = o.id === value
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 8px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: active ? 600 : 500, background: active ? 'var(--bg-card)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)', boxShadow: active ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>
            {o.icon && <o.icon size={13} />}{o.label}
          </button>
        )
      })}
    </div>
  )
}

function InfoDot({ text }: { text: string }) {
  return <span title={text} style={{ display: 'inline-flex', color: 'var(--text-faint)', cursor: 'help', verticalAlign: 'middle', marginLeft: 4 }}><Info size={12} /></span>
}

function TypeSelect({ value, onChange }: { value: TourType; onChange: (v: TourType) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const Icon = TYPE_ICON[value]
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ ...input, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', padding: '8px 12px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={15} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{t(`tourTypes.${value}`)}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(`tours.planner.tourTypeHint.${value}`)}</span>
        </span>
        <ChevronDown size={15} style={{ color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, boxShadow: 'var(--shadow-elevated)', padding: 4 }}>
          {TOUR_TYPES.map(type => {
            const I = TYPE_ICON[type]
            return (
              <button key={type} type="button" onClick={() => { onChange(type); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 9, border: 'none', background: type === value ? 'var(--bg-tertiary)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--text-primary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: TOUR_TYPE_COLOR[type] }} />
                <I size={15} />
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{t(`tourTypes.${type}`)}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>{t(`tours.planner.tourTypeHint.${type}`)}</span>
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
        <div style={{ position: 'absolute', right: 0, top: 30, zIndex: 40, minWidth: 230, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, boxShadow: 'var(--shadow-elevated)', padding: 4 }}>
          {visible.map((it, i) => it === 'sep'
            ? (i > 0 && i < visible.length - 1 && visible[i - 1] !== 'sep' ? <div key={i} style={{ height: 1, background: 'var(--border-faint)', margin: '4px 6px' }} /> : null)
            : (
              <button key={i} type="button" onClick={() => { it.run(); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-primary)', textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
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
        <div style={{ position: 'absolute', right: 0, top: 32, zIndex: 50, width: 260, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12, boxShadow: 'var(--shadow-elevated)', padding: 4 }}>
          <a href={exportUrl} style={{ ...item, fontWeight: 600 }} onClick={() => setOpen(false)}><Download size={13} />{t('tours.gpxExport.whole')}</a>
          <div style={{ height: 1, background: 'var(--border-faint)', margin: '4px 6px' }} />
          {stages.map(st => (
            <a key={st.number} href={`${exportUrl}?stage=${st.number}`} style={item} onClick={() => setOpen(false)}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <Download size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('tours.gpxExport.stage', { number: st.number, from: st.from, to: st.to })}</span>
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
    <div style={{ marginTop: 8, border: '1px solid var(--border-primary)', borderRadius: 12, background: 'var(--bg-card)', padding: 8 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('tours.placePicker.search')} style={{ ...input, padding: '7px 10px', fontSize: 12.5 }} />
        <button type="button" onClick={onClose} style={{ ...iconBtn, width: 34, height: 34 }}>✕</button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {list.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: 8 }}>{t('tours.placePicker.empty')}</div>}
        {list.map(p => (
          <button key={p.id} type="button" onClick={() => onPick(p)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text-primary)', textAlign: 'left' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <MapPinned size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
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
    <input inputMode="numeric" value={text} placeholder={placeholder}
      onChange={e => {
        const v = e.target.value.replace(/[^\d]/g, '')
        setText(v)
        onChange(v === '' ? null : Math.min(1440, Number(v)))
      }}
      style={{ ...input, padding: '7px 10px', width: 90 }} />
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
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{t('tours.planner.neutralTitle')}</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('tours.planner.neutralBody')}</p>
        {canEdit && (
          <>
            <button type="button" onClick={onStartNew} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 11, border: 'none', background: 'var(--text-primary)', color: 'var(--bg-card)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Crosshair size={15} />{t('tours.planner.newTour')}
            </button>
            <button type="button" onClick={onImport} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 11, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 500, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Upload size={15} />{t('tours.import.button')}
            </button>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.5 }}>{t('tours.import.hint')}</p>
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 10px', borderBottom: '1px solid var(--border-faint)' }}>
        <button type="button" style={iconBtn} onClick={onBack} title={t('tours.planner.backToTours')}><ArrowLeft size={16} /></button>
        <h2 style={{ flex: 1, margin: '0 0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{isNew ? t('tours.planner.newTitle') : t('tours.planner.editTitle')}</h2>
        {exportUrl && (planner.stages.length > 1 && !planner.dirty
          ? <GpxMenu exportUrl={exportUrl} stages={planner.stages.map(st => ({ number: st.number, from: stopNameOf(planner.points, st.from, n => t('tours.planner.waypointLabel', { n })), to: stopNameOf(planner.points, st.to, n => t('tours.planner.waypointLabel', { n })) }))} />
          : <a href={exportUrl} style={{ ...iconBtn, textDecoration: 'none' }} title={t('tours.gpxExport.action')}><Download size={15} /></a>)}
        <button type="button" style={{ ...iconBtn, opacity: planner.canUndo ? 1 : 0.35 }} disabled={!planner.canUndo} onClick={planner.undo} title={t('tours.planner.undo')}><Undo2 size={15} /></button>
        <button type="button" style={{ ...iconBtn, opacity: planner.canRedo ? 1 : 0.35 }} disabled={!planner.canRedo} onClick={planner.redo} title={t('tours.planner.redo')}><Redo2 size={15} /></button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 10px 8px 12px', borderBottom: '1px solid var(--border-faint)' }}>
            <MapPin size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: 'var(--text-primary)' }}>{t('tours.planner.waypoints')}</span>
            <button type="button" style={iconBtn} onClick={planner.reverse} disabled={count < 2} title={t('tours.planner.reverse')}><ArrowDownUp size={14} /></button>
            <button type="button" style={iconBtn} onClick={planner.roundTrip} disabled={count < 2} title={t('tours.planner.roundHike')}><RefreshCcw size={14} /></button>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', minWidth: 14, textAlign: 'right' }}>{count}</span>
          </div>
          <div style={{ padding: 6 }}>
            {planner.points.map((p, i) => {
              const stageHead = f.multiDay && (i === 0 || (planner.points[i - 1]?.stage_end))
              if (i > 0 && planner.points[i - 1]?.stage_end && f.multiDay) stage += 1
              const role = i === 0 ? t('tours.planner.start') : i === count - 1 ? t('tours.planner.end') : null
              const n = planner.points.slice(0, i + 1).filter(x => !x.shaping).length
              const linked = p.linked_place_id ? tripPlaces.find(tp => tp.id === p.linked_place_id) : null
              return (
                <div key={p.id}>
                  {stageHead && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 4px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg-card)', fontSize: 11.5, fontWeight: 600 }}><Mountain size={11} />{t('tours.stages.stage', { number: stage })}</span>
                      {(() => {
                        const st = planner.stages[stage - 1]
                        if (!st || st.distanceKm == null) return null
                        const pill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border-faint)', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }
                        return (
                          <span data-testid={`stage-pills-${stage}`} style={{ display: 'inline-flex', gap: 4 }}>
                            <span style={pill}><Ruler size={10} />{formatDistance(st.distanceKm)}</span>
                            {st.minutes != null && <span style={pill}><Clock size={10} />{formatDurationShort(st.minutes)}</span>}
                          </span>
                        )
                      })()}
                      <span style={{ flex: 1, height: 1, background: 'var(--border-faint)' }} />
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 6px', borderRadius: 10 }}>
                    {p.shaping
                      ? <span style={{ width: 26, display: 'flex', justifyContent: 'center' }}><span style={{ width: 10, height: 10, borderRadius: 5, border: '2.5px solid #2563eb', background: '#fff' }} /></span>
                      : <span style={{ width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, background: role ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: role ? 'var(--bg-card)' : 'var(--text-primary)' }}>{n}</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name || linked?.name || (p.shaping ? t('tours.planner.shapingPoint') : t('tours.planner.waypointLabel', { n }))}
                        </span>
                        {role && <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, border: '1px solid var(--border-primary)', color: 'var(--text-muted)' }}>{role}</span>}
                        {p.stage_end && f.multiDay && <Flag size={12} style={{ color: 'var(--text-muted)' }} />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        {linked ? t('tours.placePicker.linked') : `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
                        {p.fixed_leg?.kind === 'free' && <> · {t('tours.planner.freeLegBadge')}</>}
                      </div>
                    </div>
                    <PointMenu planner={planner} id={p.id} index={i} count={count} />
                    <button type="button" style={{ ...iconBtn, color: '#dc2626' }} onClick={() => planner.removePoint(p.id)} title={t('tours.planner.remove')}><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 11, background: 'var(--bg-tertiary)', marginTop: 6 }}>
              <button type="button" onClick={() => planner.setAddMode(!planner.addMode)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, background: planner.addMode ? 'var(--text-primary)' : 'var(--bg-card)', color: planner.addMode ? 'var(--bg-card)' : 'var(--text-primary)' }}>
                <Crosshair size={14} />{planner.addMode ? t('tours.planner.addPointActive') : t('tours.planner.addPoint')}
              </button>
              <button type="button" onClick={() => setShowPicker(s => !s)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, background: 'transparent', color: 'var(--text-muted)' }}>
                <MapPinned size={14} />{t('tours.placePicker.open')}
              </button>
            </div>
            {showPicker && <TripPlacePicker places={tripPlaces} onClose={() => setShowPicker(false)} onPick={tp => { planner.addPointInOrder(tp.lat, tp.lng, { name: tp.name, linked_place_id: tp.id }); setShowPicker(false) }} />}
            <p style={{ margin: '8px 4px 2px', fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.45 }}>
              {count < 2 ? t('tours.planner.emptyHint') : t('tours.planner.shapeOnLine')}
              {f.multiDay && count >= 2 && <> {t('tours.stages.emptyHint')}</>}
            </p>
          </div>
        </div>

        {f.tourType === 'hike' && (
          <div style={{ ...card, padding: 12 }}>
            <p style={label}>{t('tours.planner.maxDifficulty')}</p>
            <select value={f.maxDifficulty} onChange={e => planner.setFields({ maxDifficulty: Number(e.target.value) })} style={{ ...input, padding: '8px 10px' }}>
              {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{t(`tours.planner.difficulty.t${n}`)}</option>)}
            </select>
            {f.maxDifficulty >= 3 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, color: '#d97706', marginTop: 1 }} />
                <span>{f.maxDifficulty >= 4 ? t('tours.planner.difficulty.alpineBody') : t('tours.planner.difficulty.t3Warning')}</span>
              </div>
            )}
            <p style={{ ...label, marginTop: 14 }}>{t('tours.preferences.title')}<InfoDot text={t('tours.preferences.info')} /></p>
            {HIKING_PREFERENCE_KEYS.map(key => (
              <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!f.preferences[key]} onChange={e => planner.setFields({ preferences: { ...f.preferences, [key]: e.target.checked } })} style={{ marginTop: 2 }} />
                <span>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)' }}>{t(`tours.preferences.${key}`)}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>{t(`tours.preferences.${key}Hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {f.tourType === 'bike' && (
          <div style={{ ...card, padding: 12 }}>
            <p style={label}>{t('tours.bike.profile')}</p>
            <Segmented value={f.bikeProfile} onChange={v => planner.setFields({ bikeProfile: v })} options={BIKE_PROFILES.map(p => ({ id: p, label: t(`tours.bike.profile.${p}`) }))} />
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>{t(`tours.bike.profileHint.${f.bikeProfile}`)}</p>
          </div>
        )}
        {f.tourType === 'run' && (
          <div style={{ ...card, padding: 12 }}>
            <p style={label}>{t('tours.run.profile')}</p>
            <Segmented value={f.runProfile} onChange={v => planner.setFields({ runProfile: v })} options={RUN_PROFILES.map(p => ({ id: p, label: t(`tours.run.profile.${p}`) }))} />
            <p style={{ margin: '8px 0 12px', fontSize: 11.5, color: 'var(--text-faint)' }}>{t(`tours.run.profileHint.${f.runProfile}`)}</p>
            <p style={label}>{t('tours.run.pace')}<InfoDot text={t('tours.run.paceInfo')} /></p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={paceText} onChange={e => { setPaceText(e.target.value); planner.setFields({ runPace: parsePace(e.target.value) }) }} placeholder="6:00" style={{ ...input, width: 90, padding: '7px 10px' }} />
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('tours.run.paceUnit')}</span>
            </div>
            {paceText && !f.runPace && <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#dc2626' }}>{t('tours.run.paceInvalid', { fastest: '2:00', slowest: '20:00' })}</p>}
          </div>
        )}

        <div style={{ ...card, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('tours.planner.breaksAdditional')}<InfoDot text={t('tours.planner.breaksAdditionalInfo')} /></span>
            <MinutesInput value={f.breakMinutes} onChange={v => planner.setFields({ breakMinutes: v })} placeholder="min" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('tours.planner.plannedTotalManual')}<InfoDot text={t('tours.planner.plannedTotalInfo')} /></span>
            <MinutesInput value={f.plannedOverride} onChange={v => planner.setFields({ plannedOverride: v })} placeholder={planner.plannedTotal != null ? String(Math.round(planner.plannedTotal)) : 'min'} />
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('tours.planner.plannedTotalDuration')}</span>
            <strong>{formatDurationShort(planner.plannedTotal)}</strong>
          </div>
        </div>
        {extra}
        <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>{t('tours.planner.safetyNote')}</p>
      </div>

      <div style={{ borderTop: '1px solid var(--border-faint)', padding: 12 }}>
        {status && (
          <div style={{ fontSize: 11.5, textAlign: 'center', marginBottom: 8, color: status.tone === 'warn' ? '#b45309' : 'var(--text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{status.text}</span>
            {(planner.status.kind === 'routingFailed' || planner.status.kind === 'elevationFailed') && (
              <button type="button" onClick={planner.retry} style={{ border: '1px solid var(--border-primary)', background: 'var(--bg-card)', borderRadius: 8, padding: '2px 8px', fontSize: 11.5, cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit' }}>{t('tours.planner.retry')}</button>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            <RotateCcw size={14} />{t('tours.conversion.discard')}
          </button>
          <button type="button" disabled={!planner.canSave} onClick={() => { void planner.save() }}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: 'none', background: planner.canSave ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: planner.canSave ? 'var(--bg-card)' : 'var(--text-faint)', cursor: planner.canSave ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            <Save size={14} />{t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
