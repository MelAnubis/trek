import { useState, useMemo, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import {
  Plane, Hotel, Utensils, Train, Car, Ship, Bus, Sailboat, Bike, CarTaxiFront, Route, Ticket, FileText, MapPin,
  Calendar, Hash, CheckCircle2, Circle, Pencil, Trash2, Plus, ChevronDown, ChevronRight, Users,
  ExternalLink, BookMarked, Lightbulb, Link2, Clock, ArrowRight, AlertCircle, Upload, Download, Search,
} from 'lucide-react'
import { openFile } from '../../utils/fileDownload'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { Reservation, Day, TripFile, AssignmentsMap } from '../../types'
import { splitReservationDateTime, formatTime } from '../../utils/formatters'
import DayLodgingModal from './DayLodgingModal'
import GenerateLodgingModal from './GenerateLodgingModal'

interface AssignmentLookupEntry {
  dayNumber: number
  dayTitle: string | null
  dayDate: string
  placeName: string
  startTime: string | null
  endTime: string | null
}

const TYPE_OPTIONS = [
  { value: 'flight',          labelKey: 'reservations.type.flight',          Icon: Plane, color: '#3b82f6' },
  { value: 'hotel',           labelKey: 'reservations.type.hotel',           Icon: Hotel, color: '#8b5cf6' },
  { value: 'restaurant',      labelKey: 'reservations.type.restaurant',      Icon: Utensils, color: '#ef4444' },
  { value: 'train',           labelKey: 'reservations.type.train',           Icon: Train, color: '#06b6d4' },
  { value: 'bus',             labelKey: 'reservations.type.bus',             Icon: Bus, color: '#059669' },
  { value: 'car',             labelKey: 'reservations.type.car',             Icon: Car, color: '#6b7280' },
  { value: 'taxi',            labelKey: 'reservations.type.taxi',            Icon: CarTaxiFront, color: '#ca8a04' },
  { value: 'bicycle',         labelKey: 'reservations.type.bicycle',         Icon: Bike, color: '#84cc16' },
  { value: 'cruise',          labelKey: 'reservations.type.cruise',          Icon: Ship, color: '#0ea5e9' },
  { value: 'ferry',           labelKey: 'reservations.type.ferry',           Icon: Sailboat, color: '#0d9488' },
  { value: 'transport_other', labelKey: 'reservations.type.transport_other', Icon: Route, color: '#6b7280' },
  { value: 'event',           labelKey: 'reservations.type.event',           Icon: Ticket, color: '#f59e0b' },
  { value: 'tour',            labelKey: 'reservations.type.tour',            Icon: Users, color: '#10b981' },
  { value: 'other',           labelKey: 'reservations.type.other',           Icon: FileText, color: '#6b7280' },
]

function getType(type) {
  return TYPE_OPTIONS.find(t => t.value === type) || TYPE_OPTIONS[TYPE_OPTIONS.length - 1]
}

function buildAssignmentLookup(days, assignments) {
  const map = {}
  for (const day of (days || [])) {
    const da = (assignments?.[String(day.id)] || []).slice().sort((a, b) => a.order_index - b.order_index)
    for (const a of da) {
      if (!a.place) continue
      map[a.id] = { dayNumber: day.day_number, dayTitle: day.title, dayDate: day.date, placeName: a.place.name, startTime: a.place.place_time, endTime: a.place.end_time }
    }
  }
  return map
}

/* ── Shared field label style ── */
const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--text-faint)', marginBottom: 5,
}
const fieldValueStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
  padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: 10,
}

interface ReservationCardProps {
  r: Reservation
  tripId: number | string
  onEdit: (reservation: Reservation) => void
  onDelete: (id: number) => void
  files?: TripFile[]
  onNavigateToFiles: () => void
  assignmentLookup: Record<number, AssignmentLookupEntry>
  canEdit: boolean
  days?: Day[]
  /** Abre la búsqueda de alojamiento de una reserva de hotel pendiente de elegir. */
  onFindLodging?: (reservation: Reservation) => void
}

function ReservationCard({ r, tripId, onEdit, onDelete, files = [], onNavigateToFiles, assignmentLookup, canEdit, days = [], onFindLodging }: ReservationCardProps) {
  const { toggleReservationStatus } = useTripStore()
  const toast = useToast()
  const { t, locale } = useTranslation()
  const timeFormat = useSettingsStore(s => s.settings.time_format) || '24h'
  const blurCodes = useSettingsStore(s => s.settings.blur_booking_codes)
  const [codeRevealed, setCodeRevealed] = useState(false)
  const typeInfo = getType(r.type)
  const TypeIcon = typeInfo.Icon
  const confirmed = r.status === 'confirmed'
  const attachedFiles = files.filter(f => f.reservation_id === r.id || (f.linked_reservation_ids || []).includes(r.id))
  const linked = r.assignment_id ? assignmentLookup[r.assignment_id] : null
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleToggle = async () => {
    try { await toggleReservationStatus(tripId, r.id) }
    catch { toast.error(t('reservations.toast.updateError')) }
  }
  const handleDelete = async () => {
    setShowDeleteConfirm(false)
    try { await onDelete(r.id) } catch { toast.error(t('reservations.toast.deleteError')) }
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const startDt = splitReservationDateTime(r.reservation_time)
  const endDt = splitReservationDateTime(r.reservation_end_time)
  const fmtDate = (date: string) =>
    new Date(date + 'T00:00:00Z').toLocaleDateString(locale, { ...(isMobile ? {} : { weekday: 'short' }), day: 'numeric', month: 'short', timeZone: 'UTC' })

  const hasDate = !!startDt.date
  const hasTime = !!(startDt.time || endDt.time)
  const hasCode = !!r.confirmation_number
  const dateCols = [hasDate, hasTime, hasCode].filter(Boolean).length

  const TRANSPORT_TYPES_SET = new Set(['flight', 'train', 'bus', 'car', 'taxi', 'bicycle', 'cruise', 'ferry', 'transport_other'])
  const isTransportType = TRANSPORT_TYPES_SET.has(r.type)
  const isHotel = r.type === 'hotel'
  const startDay = r.day_id ? days.find(d => d.id === r.day_id)
    : (isHotel && r.accommodation_start_day_id) ? days.find(d => d.id === r.accommodation_start_day_id)
    : undefined
  const endDay = r.end_day_id ? days.find(d => d.id === r.end_day_id)
    : (isHotel && r.accommodation_end_day_id) ? days.find(d => d.id === r.accommodation_end_day_id)
    : undefined
  const DayLabel = ({ day }: { day: typeof startDay }) => {
    if (!day) return null
    const name = day.title || t('dayplan.dayN', { n: day.day_number })
    const badge = day.date
      ? new Date(day.date + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
      : null
    return (
      <span className="!inline-flex !items-center !gap-[5px]">
        <span>{name}</span>
        {badge && (
          <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] ![background:var(--bg-secondary)] !p-[1px_6px] !rounded-[999px]">{badge}</span>
        )}
      </span>
    )
  }

  return (
    <div className="trek-h-box-shadow-cea719 !rounded-[12px] !overflow-hidden !flex !flex-col ![background:var(--bg-card)] ![transition:box-shadow_0.15s_ease]" style={{ border: `1px solid ${confirmed ? 'rgba(22,163,74,0.25)' : 'rgba(217,119,6,0.25)'}` }} >
      {/* Header — wraps to a second row on narrow screens so the status/category chips
          never collide with the title. */}
      <div className="!flex !items-center !justify-between !gap-[12px] !flex-wrap !p-[12px_14px]" style={{ background: confirmed ? 'rgba(22,163,74,0.06)' : 'rgba(217,119,6,0.06)' }}>
        <div className="!inline-flex !items-center !gap-[10px] !min-w-[0] !flex-wrap">
          <span className="!inline-flex !items-center !gap-[6px] !text-[length:12px] !font-[600]" style={{ color: confirmed ? '#16a34a' : '#d97706' }}>
            <span className="!w-[7px] !h-[7px] !rounded-[50%] !shrink-[0]" style={{ background: confirmed ? '#16a34a' : '#d97706' }} />
            {confirmed ? t('reservations.confirmed') : t('reservations.pending')}
          </span>
          <span className="!inline-flex !items-center !gap-[5px] !text-[length:12px] ![color:var(--text-muted)] !p-[3px_8px] !rounded-[6px] ![background:var(--bg-secondary)]">
            <TypeIcon size={12} style={{ color: typeInfo.color }} />
            {t(typeInfo.labelKey)}
          </span>
          {r.needs_review ? (
            <span className="!inline-flex !items-center !gap-[4px] !text-[length:11px] !font-[600] ![color:#b45309] !p-[3px_8px] !rounded-[6px] ![background:rgba(245,158,11,0.12)]" title={t('reservations.needsReviewHint')}>
              <AlertCircle size={11} />
              {t('reservations.needsReview')}
            </span>
          ) : null}
          {(r as any).external_source === 'airtrail' ? (
            <span className="!inline-flex !items-center !gap-[4px] !text-[length:11px] !font-[600] !p-[3px_8px] !rounded-[6px]"
              style={{ color: (r as any).sync_enabled ? '#2563eb' : 'var(--text-faint)', background: (r as any).sync_enabled ? 'rgba(59,130,246,0.12)' : 'var(--bg-tertiary)' }}
              title={(r as any).sync_enabled ? t('reservations.airtrail.syncedHint') : t('reservations.airtrail.notSyncedHint')}
            >
              <Plane size={11} />
              {(r as any).sync_enabled ? t('reservations.airtrail.synced') : t('reservations.airtrail.notSynced')}
            </span>
          ) : null}
        </div>
        <div className="!flex !items-center !gap-[2px]">
          <span className="!text-[length:13px] !font-[600] ![color:var(--text-primary)] !mr-[6px] !max-w-[140px] !whitespace-nowrap !overflow-hidden !text-ellipsis">{r.title}</span>
          {canEdit && (
            <button className="trek-h-background-404ced trek-hover-text ![appearance:none] ![border:none] ![background:transparent] !w-[26px] !h-[26px] !rounded-[6px] !grid ![place-items:center] !cursor-pointer ![color:var(--text-faint)] !shrink-[0]" onClick={() => onEdit(r)} title={t('common.edit')}>
              <Pencil size={13} />
            </button>
          )}
          {canEdit && (
            <button className="trek-h-background-40d487 trek-hover-danger ![appearance:none] ![border:none] ![background:transparent] !w-[26px] !h-[26px] !rounded-[6px] !grid ![place-items:center] !cursor-pointer ![color:var(--text-faint)] !shrink-[0]" onClick={() => setShowDeleteConfirm(true)} title={t('common.delete')}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="!p-[14px] !flex !flex-col !gap-[12px] !flex-[1]">
        {/* Reserva de alojamiento pendiente de elegir: opciones de la localidad de ese día */}
        {canEdit && onFindLodging && isHotel && !confirmed && !r.accommodation_id && (
          <button className="![appearance:none] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !justify-center !gap-[6px] !p-[9px_12px] !rounded-[10px] !text-[length:13px] !font-[600] ![border:1px_dashed_var(--accent)] ![background:transparent] ![color:var(--accent)]" type="button" onClick={() => onFindLodging(r)}>
            <Search size={14} />{t('lodging.find')}
          </button>
        )}
        {/* Day label for transport/hotel reservations linked to days */}
        {(isTransportType || isHotel) && startDay && (
          <div>
            <div style={fieldLabelStyle}>{t('reservations.date')}</div>
            <div className="!flex !items-center !justify-center !gap-[6px] !flex-wrap" style={{ ...fieldValueStyle }}>
              <DayLabel day={startDay} />
              {endDay && endDay.id !== startDay.id && (
                <><span className="![color:var(--text-faint)]">–</span><DayLabel day={endDay} /></>
              )}
            </div>
          </div>
        )}
        {/* Date / Time row */}
        {(hasDate || hasTime) && (
          <div className="!grid !gap-[10px]" style={{ gridTemplateColumns: hasDate && hasTime ? '1fr 1fr' : '1fr' }}>
            {hasDate && (
              <div>
                <div style={fieldLabelStyle}>{t('reservations.date')}</div>
                <div className="!text-center" style={{ ...fieldValueStyle }}>
                  {fmtDate(startDt.date!)}
                  {endDt.date && endDt.date !== startDt.date && (
                    <> – {fmtDate(endDt.date)}</>
                  )}
                </div>
              </div>
            )}
            {hasTime && (
              <div>
                <div style={fieldLabelStyle}>{t('reservations.time')}</div>
                <div className="!text-center" style={{ ...fieldValueStyle }}>
                  {formatTime(startDt.time, locale, timeFormat)}
                  {endDt.time ? ` – ${formatTime(endDt.time, locale, timeFormat)}` : ''}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Booking code */}
        {hasCode && (
          <div>
            <div style={fieldLabelStyle}>{t('reservations.confirmationCode')}</div>
            <div
              onMouseEnter={() => blurCodes && setCodeRevealed(true)}
              onMouseLeave={() => blurCodes && setCodeRevealed(false)}
              onClick={() => blurCodes && setCodeRevealed(v => !v)}
              style={{
                ...fieldValueStyle, textAlign: 'center',
                fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace', fontSize: 12.5,
                filter: blurCodes && !codeRevealed ? 'blur(5px)' : 'none',
                cursor: blurCodes ? 'pointer' : 'default',
                transition: 'filter 0.2s',
              }}
            >
              {r.confirmation_number}
            </div>
          </div>
        )}

        {(() => {
          const eps = r.endpoints || []
          const from = eps.find(e => e.role === 'from')
          const to = eps.find(e => e.role === 'to')
          if (!from || !to) return null
          return (
            <div className="!flex !items-center !justify-center !gap-[8px] !p-[8px_12px] !rounded-[10px] ![background:var(--bg-tertiary)] !text-[length:12.5px] ![color:var(--text-primary)]">
              <span className="!font-[500] !whitespace-nowrap !overflow-hidden !text-ellipsis">{from.name}</span>
              <TypeIcon size={14} style={{ color: typeInfo.color, flexShrink: 0 }} />
              <span className="!font-[500] !whitespace-nowrap !overflow-hidden !text-ellipsis">{to.name}</span>
            </div>
          )
        })()}

        {/* Type-specific metadata */}
        {(() => {
          const meta = { ...(typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {})) }
          // Hotel times may live only on the linked stay (set from the day's lodging) — show those too.
          if (r.type === 'hotel') {
            if (!meta.check_in_time && r.accommodation_check_in) {
              meta.check_in_time = r.accommodation_check_in
              if (!meta.check_in_end_time && r.accommodation_check_in_end) meta.check_in_end_time = r.accommodation_check_in_end
            }
            if (!meta.check_out_time && r.accommodation_check_out) meta.check_out_time = r.accommodation_check_out
          }
          if (Object.keys(meta).length === 0) return null
          const hasEndpoints = (r.endpoints || []).some(e => e.role === 'from') && (r.endpoints || []).some(e => e.role === 'to')
          const cells: { label: string; value: string }[] = []
          if (meta.airline) cells.push({ label: t('reservations.meta.airline'), value: meta.airline })
          if (meta.flight_number) cells.push({ label: t('reservations.meta.flightNumber'), value: meta.flight_number })
          if (!hasEndpoints && meta.departure_airport) cells.push({ label: t('reservations.meta.from'), value: meta.departure_airport })
          if (!hasEndpoints && meta.arrival_airport) cells.push({ label: t('reservations.meta.to'), value: meta.arrival_airport })
          if (meta.train_number) cells.push({ label: t('reservations.meta.trainNumber'), value: meta.train_number })
          if (meta.platform) cells.push({ label: t('reservations.meta.platform'), value: meta.platform })
          if (meta.seat) cells.push({ label: t('reservations.meta.seat'), value: meta.seat })
          if (meta.check_in_time) cells.push({ label: t('reservations.meta.checkIn'), value: formatTime(meta.check_in_time, locale, timeFormat) + (meta.check_in_end_time ? ` – ${formatTime(meta.check_in_end_time, locale, timeFormat)}` : '') })
          if (meta.check_out_time) cells.push({ label: t('reservations.meta.checkOut'), value: formatTime(meta.check_out_time, locale, timeFormat) })
          if (cells.length === 0) return null
          return (
            <div className="!grid !gap-[10px]" style={{ gridTemplateColumns: cells.length > 1 ? `repeat(${Math.min(cells.length, 3)}, 1fr)` : '1fr' }}>
              {cells.map((c, i) => (
                <div key={i}>
                  <div style={fieldLabelStyle}>{c.label}</div>
                  <div className="!text-center" style={{ ...fieldValueStyle }}>{c.value}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Location / Accommodation / Assignment */}
        {r.location && (
          <div>
            <div style={fieldLabelStyle}>{t('reservations.locationAddress')}</div>
            <div className="!flex !items-center !gap-[6px] !font-[400]" style={{ ...fieldValueStyle }}>
              <MapPin size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
              <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{r.location}</span>
            </div>
          </div>
        )}
        {r.accommodation_name && (
          <div>
            <div style={fieldLabelStyle}>{t('reservations.meta.linkAccommodation')}</div>
            <div className="!flex !items-center !gap-[6px] !font-[400]" style={{ ...fieldValueStyle }}>
              <Hotel size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
              <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{r.accommodation_name}</span>
            </div>
          </div>
        )}
        {linked && (
          <div>
            <div style={fieldLabelStyle}>{t('reservations.linkAssignment')}</div>
            <div className="!flex !items-center !gap-[6px] !font-[400]" style={{ ...fieldValueStyle }}>
              <Link2 size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
              <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">
                {linked.dayTitle || t('dayplan.dayN', { n: linked.dayNumber })} — {linked.placeName}
                {linked.startTime ? ` · ${linked.startTime}${linked.endTime ? ' – ' + linked.endTime : ''}` : ''}
              </span>
            </div>
          </div>
        )}

        {/* Notes */}
        {r.notes && (
          <div>
            <div style={fieldLabelStyle}>{t('reservations.notes')}</div>
            <div className="collab-note-md !font-[400] !leading-[1.5] !break-words ![overflow-wrap:anywhere]" style={{ ...fieldValueStyle }}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{r.notes}</Markdown>
            </div>
          </div>
        )}

        {/* Files */}
        {attachedFiles.length > 0 && (
          <div>
            <div style={fieldLabelStyle}>{t('files.title')}</div>
            <div className="!flex !flex-col !gap-[4px] !p-[6px_10px]" style={{ ...fieldValueStyle }}>
              {attachedFiles.map(f => (
                <a className="!flex !items-center !gap-[5px] ![text-decoration:none] !cursor-pointer" key={f.id} href="#" onClick={(e) => { e.preventDefault(); openFile(f.url).catch(() => {}) }}>
                  <FileText size={11} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                  <span className="!text-[length:12px] ![color:var(--text-muted)] !flex-[1] !overflow-hidden !text-ellipsis !whitespace-nowrap">{f.original_name}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && ReactDOM.createPortal(
        <div className="!fixed !inset-[0] !z-[1000] !flex !items-center !justify-center ![background:rgba(0,0,0,0.3)] ![backdrop-filter:blur(3px)]" onClick={() => setShowDeleteConfirm(false)}>
          <div className="!w-[340px] ![background:var(--bg-card)] !rounded-[16px] ![box-shadow:0_16px_48px_rgba(0,0,0,0.22)] !p-[22px_22px_18px] !flex !flex-col !gap-[12px]" onClick={e => e.stopPropagation()}>
            <div className="!flex !items-center !gap-[10px]">
              <div className="!w-[36px] !h-[36px] !shrink-[0] !flex !items-center !justify-center !rounded-[50%] ![background:rgba(239,68,68,0.12)]">
                <Trash2 size={18} strokeWidth={1.8} color="#ef4444" />
              </div>
              <div className="!text-[length:14px] !font-[600] ![color:var(--text-primary)]">
                {t('reservations.confirm.deleteTitle')}
              </div>
            </div>
            <div className="!text-[length:12.5px] ![color:var(--text-secondary)] !leading-[1.5]">
              {t('reservations.confirm.deleteBody', { name: r.title })}
            </div>
            <div className="!flex !gap-[8px] !justify-end !mt-[4px]">
              <button className="!text-[length:12px] ![background:none] ![border:1px_solid_var(--border-primary)] !rounded-[8px] !p-[6px_14px] !cursor-pointer ![color:var(--text-muted)] ![font-family:inherit]" onClick={() => setShowDeleteConfirm(false)}>{t('common.cancel')}</button>
              <button className="!text-[length:12px] ![background:#ef4444] ![color:white] ![border:none] !rounded-[8px] !p-[6px_16px] !cursor-pointer !font-[600] ![font-family:inherit]" onClick={handleDelete}>{t('common.confirm')}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
  accent: 'green' | string
  storageKey?: string
}

function Section({ title, count, children, defaultOpen = true, accent, storageKey }: SectionProps) {
  const [open, setOpen] = useState(() => {
    if (!storageKey || typeof window === 'undefined') return defaultOpen
    const stored = window.localStorage.getItem(storageKey)
    if (stored === null) return defaultOpen
    return stored === '1'
  })
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    window.localStorage.setItem(storageKey, open ? '1' : '0')
  }, [open, storageKey])
  return (
    <div className="!mb-[28px]">
      <button className="!flex !items-center !gap-[8px] !w-[100%] ![background:none] ![border:none] !cursor-pointer !p-[4px_0] !mb-[12px] ![font-family:inherit] !select-none" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} style={{ color: 'var(--text-faint)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-faint)' }} />}
        <span className="!font-[600] !text-[length:12px] ![color:var(--text-muted)] !uppercase !tracking-[0.08em]">{title}</span>
        <span className="!text-[length:11px] !font-[600] !p-[2px_7px] !rounded-[99px] ![background:var(--bg-tertiary)] ![color:var(--text-faint)] !min-w-[20px] !text-center">{count}</span>
      </button>
      {open && (
        <div className="!grid ![grid-template-columns:repeat(auto-fill,_minmax(max(33.33%_-_14px,_340px),_1fr))] !gap-[14px] !items-stretch">
          {children}
        </div>
      )}
    </div>
  )
}

interface ReservationsPanelProps {
  tripId: number | string
  reservations: Reservation[]
  days: Day[]
  assignments: AssignmentsMap
  files?: TripFile[]
  onAdd: () => void
  onImportBooking?: () => void
  onImport?: () => void
  bookingImportAvailable?: boolean
  onAirTrailImport?: () => void
  airTrailAvailable?: boolean
  onEdit: (reservation: Reservation) => void
  onDelete: (id: number) => void
  onNavigateToFiles: () => void
  titleKey?: string
  addManualKey?: string
  pushUndo?: (label: string, undoFn: () => Promise<void> | void) => void
  /** Muestra las herramientas de alojamiento por día (generar reservas pendientes y elegir hotel). Solo en la pestaña Reservas. */
  lodgingTools?: boolean
  /** Se llama tras asignar un alojamiento a una reserva, para recargar los alojamientos del viaje. */
  onLodgingChange?: () => void
}

export default function ReservationsPanel({ tripId, reservations, days, assignments, files = [], onAdd, onEdit, onDelete, onNavigateToFiles, titleKey = 'reservations.title', addManualKey = 'reservations.addManual', onImportBooking, onImport, bookingImportAvailable, onAirTrailImport, airTrailAvailable, pushUndo, lodgingTools, onLodgingChange }: ReservationsPanelProps) {
  const { t, locale } = useTranslation()
  const can = useCanDo()
  const trip = useTripStore((s) => s.trip)
  const canEdit = can('reservation_edit', trip)
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('hideReservationHint'))
  const [showGenerateLodging, setShowGenerateLodging] = useState(false)
  const [lodgingFor, setLodgingFor] = useState<Reservation | null>(null)

  const storageKey = `trek-reservation-filters-${tripId}`
  const [typeFilters, setTypeFilters] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })

  const toggleTypeFilter = (type: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      sessionStorage.setItem(storageKey, JSON.stringify([...next]))
      return next
    })
  }

  const assignmentLookup = useMemo(() => buildAssignmentLookup(days, assignments), [days, assignments])

  const filtered = useMemo(() =>
    typeFilters.size === 0 ? reservations : reservations.filter(r => typeFilters.has(r.type)),
  [reservations, typeFilters])

  const allPending = filtered.filter(r => r.status !== 'confirmed')
  const allConfirmed = filtered.filter(r => r.status === 'confirmed')
  const total = filtered.length

  const usedTypes = useMemo(() => new Set(reservations.map(r => r.type)), [reservations])
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of reservations) counts[r.type] = (counts[r.type] || 0) + 1
    return counts
  }, [reservations])

  return (
    <div className="!h-[100%] !flex !flex-col" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>
      {/* Unified toolbar */}
      <div className="max-md:!px-4 max-md:!pt-4 !p-[24px_28px_0]">
        <div className="![background:var(--bg-tertiary)] !rounded-[18px] !p-[14px_16px_14px_22px] !flex !items-center !gap-[16px] !flex-wrap">
          <h2 className="!m-[0] !text-[length:18px] !font-[600] ![color:var(--text-primary)] !tracking-[-0.01em] !shrink-[0]">
            {t(titleKey)}
          </h2>

          {reservations.length > 0 && (
            <>
              <div className="hidden md:block !w-[1px] !h-[22px] ![background:var(--border-faint)] !shrink-[0]" />
              <div className="hidden md:inline-flex !gap-[4px] !flex-wrap !flex-[1] !min-w-[0]">
                <button className="![appearance:none] ![border:none] !cursor-pointer !inline-flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[99px] !whitespace-nowrap ![transition:all_0.15s_ease]"
                  onClick={() => { setTypeFilters(new Set()); sessionStorage.removeItem(storageKey) }}
                  style={{ fontFamily: 'inherit', fontSize: 13, background: typeFilters.size === 0 ? 'var(--bg-card)' : 'transparent', color: typeFilters.size === 0 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: typeFilters.size === 0 ? 500 : 400, boxShadow: typeFilters.size === 0 ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}
                >
                  {t('common.all')}
                  <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !p-[1px_6px] !rounded-[99px] !min-w-[16px] !text-center" style={{ background: typeFilters.size === 0 ? 'var(--bg-tertiary)' : 'rgba(0,0,0,0.06)' }}>{reservations.length}</span>
                </button>
                {TYPE_OPTIONS.filter(opt => usedTypes.has(opt.value)).map(opt => {
                  const active = typeFilters.has(opt.value)
                  const Icon = opt.Icon
                  return (
                    <button className="![appearance:none] ![border:none] !cursor-pointer !inline-flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[99px] !whitespace-nowrap ![transition:all_0.15s_ease]"
                      key={opt.value}
                      onClick={() => toggleTypeFilter(opt.value)}
                      style={{ fontFamily: 'inherit', fontSize: 13, background: active ? 'var(--bg-card)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 500 : 400, boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}
                    >
                      <Icon size={13} style={{ color: active ? opt.color : 'var(--text-faint)' }} />
                      {t(opt.labelKey)}
                      <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !p-[1px_6px] !rounded-[99px] !min-w-[16px] !text-center" style={{ background: active ? 'var(--bg-tertiary)' : 'rgba(0,0,0,0.06)' }}>{typeCounts[opt.value] || 0}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {canEdit && (
            <div className="!flex !gap-[6px] !ml-[auto] !shrink-[0]">
              {bookingImportAvailable && (onImportBooking || onImport) && (
                <button className="trek-hover-o75 ![appearance:none] ![border:1px_solid_var(--border-primary)] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !gap-[6px] !p-[8px_13px] !rounded-[10px] !text-[length:13px] !font-[500] ![background:var(--bg-card)] ![color:var(--text-primary)] ![transition:opacity_0.15s_ease]" onClick={onImportBooking ?? onImport} title={t('reservations.import.cta')}
                >
                  <Upload size={14} strokeWidth={2.5} />
                  <span className="hidden sm:inline">{t('reservations.import.cta')}</span>
                </button>
              )}
              {onAirTrailImport && airTrailAvailable && (
                <button className="trek-hover-o75 ![appearance:none] ![border:1px_solid_var(--border-primary)] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !gap-[6px] !p-[8px_14px] !rounded-[10px] !text-[length:13px] !font-[500] !box-border ![background:var(--bg-secondary)] ![color:var(--text-primary)] ![transition:opacity_0.15s_ease]" onClick={onAirTrailImport} title={t('reservations.airtrail.title')}
                >
                  <Plane size={14} strokeWidth={2} />
                  <span className="hidden sm:inline">{t('reservations.airtrail.cta')}</span>
                </button>
              )}
              {lodgingTools && days.length > 0 && (
                <button className="trek-hover-o75 ![appearance:none] ![border:1px_solid_var(--border-primary)] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !gap-[6px] !p-[8px_14px] !rounded-[10px] !text-[length:13px] !font-[500] !box-border ![background:var(--bg-secondary)] ![color:var(--text-primary)] ![transition:opacity_0.15s_ease]" onClick={() => setShowGenerateLodging(true)} title={t('lodging.generate.title')}
                >
                  <Hotel size={14} strokeWidth={2} />
                  <span className="hidden sm:inline">{t('lodging.generate.open')}</span>
                </button>
              )}
              <button className="trek-hover-o88 ![appearance:none] ![border:none] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !gap-[6px] !p-[9px_14px] !rounded-[10px] !text-[length:13px] !font-[500] ![background:var(--accent)] ![color:var(--accent-text)] !shrink-[0] ![transition:opacity_0.15s_ease]" onClick={onAdd} >
                <Plus size={14} strokeWidth={2.5} />
                <span className="hidden sm:inline">{t(addManualKey)}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-md:!px-4 max-md:!pt-4 !flex-[1] !overflow-y-auto !p-[24px_28px_80px]">
        {total === 0 && reservations.length === 0 ? (
          <div className="!text-center !p-[60px_20px]">
            <BookMarked size={36} style={{ color: 'var(--text-faint)', display: 'block', margin: '0 auto 12px' }} />
            <p className="!text-[length:14px] !font-[600] ![color:var(--text-secondary)] !m-[0_0_4px]">{t('reservations.empty')}</p>
            <p className="!text-[length:12px] ![color:var(--text-faint)] !m-[0]">{t('reservations.emptyHint')}</p>
          </div>
        ) : total === 0 ? (
          <div className="!text-center !p-[60px_20px]">
            <p className="!text-[length:13px] ![color:var(--text-faint)]">{t('places.noneFound')}</p>
          </div>
        ) : (
          <>
            {allPending.length > 0 && (
              <Section title={t('reservations.pending')} count={allPending.length} accent="gray" storageKey={`trek:bookings-pending-open:${tripId}`}>
                {allPending.map(r => <ReservationCard key={r.id} r={r} tripId={tripId} onEdit={onEdit} onDelete={onDelete} files={files} onNavigateToFiles={onNavigateToFiles} assignmentLookup={assignmentLookup} canEdit={canEdit} days={days} onFindLodging={lodgingTools ? setLodgingFor : undefined} />)}
              </Section>
            )}
            {allConfirmed.length > 0 && (
              <Section title={t('reservations.confirmed')} count={allConfirmed.length} accent="green" storageKey={`trek:bookings-confirmed-open:${tripId}`}>
                {allConfirmed.map(r => <ReservationCard key={r.id} r={r} tripId={tripId} onEdit={onEdit} onDelete={onDelete} files={files} onNavigateToFiles={onNavigateToFiles} assignmentLookup={assignmentLookup} canEdit={canEdit} days={days} onFindLodging={setLodgingFor} />)}
              </Section>
            )}
          </>
        )}
      </div>

      {showGenerateLodging && (
        <GenerateLodgingModal tripId={tripId} days={days} assignments={assignments} reservations={reservations} onClose={() => setShowGenerateLodging(false)} />
      )}
      {lodgingFor && (() => {
        // Día de la reserva (con los lugares de ese día, para sacar la localidad final).
        const day = days.find(d => d.id === lodgingFor.day_id) ?? days.find(d => d.id === lodgingFor.accommodation_start_day_id)
        if (!day) return null
        const dayWithPlaces = { ...day, assignments: assignments?.[String(day.id)] ?? day.assignments }
        return (
          <DayLodgingModal day={dayWithPlaces} days={days} tripId={tripId} reservation={lodgingFor}
            onClose={() => setLodgingFor(null)} onSaved={() => { useTripStore.getState().loadReservations?.(tripId); onLodgingChange?.() }} />
        )
      })()}
    </div>
  )
}
