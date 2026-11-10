import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Plane, Train, Car, Ship, Bus, Sailboat, Bike, CarTaxiFront, Route, Paperclip, FileText, X, ExternalLink, Link2, Plus, Trash2 } from 'lucide-react'
import Modal from '../shared/Modal'
import CustomSelect from '../shared/CustomSelect'
import CustomTimePicker from '../shared/CustomTimePicker'
import AirportSelect, { type Airport } from './AirportSelect'
import LocationSelect, { type LocationPoint } from './LocationSelect'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { useTripStore } from '../../store/tripStore'
import { useAddonStore } from '../../store/addonStore'
import { formatDate, splitReservationDateTime } from '../../utils/formatters'
import { openFile } from '../../utils/fileDownload'
import apiClient from '../../api/client'
import type { Day, Reservation, ReservationEndpoint, TripFile } from '../../types'
import { parseReservationMetadata, orderedEndpoints } from '../../utils/flightLegs'

const TRANSPORT_TYPES = ['flight', 'train', 'bus', 'car', 'taxi', 'bicycle', 'cruise', 'ferry', 'transport_other'] as const
type TransportType = typeof TRANSPORT_TYPES[number]

interface EndpointPick {
  airport?: Airport
  location?: LocationPoint
}

function endpointFromAirport(a: Airport, role: 'from' | 'to' | 'stop', sequence: number, date: string | null, time: string | null): Omit<ReservationEndpoint, 'id' | 'reservation_id'> {
  return {
    role, sequence,
    name: a.city ? `${a.city} (${a.iata})` : a.name,
    code: a.iata,
    lat: a.lat, lng: a.lng,
    timezone: a.tz,
    local_date: date,
    local_time: time,
  }
}

function endpointFromLocation(l: LocationPoint, role: 'from' | 'to', sequence: number, date: string | null, time: string | null): Omit<ReservationEndpoint, 'id' | 'reservation_id'> {
  return {
    role, sequence,
    name: l.name,
    code: null,
    lat: l.lat, lng: l.lng,
    timezone: null,
    local_date: date,
    local_time: time,
  }
}

function airportFromEndpoint(e: ReservationEndpoint | undefined): Airport | null {
  if (!e || !e.code) return null
  return {
    iata: e.code, icao: null,
    name: e.name, city: e.name.replace(/\s*\([A-Z]{3}\)\s*$/, ''),
    country: '',
    lat: e.lat, lng: e.lng,
    tz: e.timezone || '',
  }
}

function locationFromEndpoint(e: ReservationEndpoint | undefined): LocationPoint | null {
  if (!e) return null
  return { name: e.name, lat: e.lat, lng: e.lng, address: null }
}

// ── Multi-leg flight waypoints ─────────────────────────────────────────────
// A flight is an ordered list of airports. The origin has only a departure, the
// destination only an arrival, and each intermediate stop has both — plus the
// airline/flight number of the flight LEAVING it. N waypoints = N-1 legs. A
// single-leg flight is just two waypoints, so it persists exactly as before.
interface WaypointForm {
  airport: Airport | null
  arrDayId: string | number
  arrTime: string
  depDayId: string | number
  depTime: string
  airline: string
  flight_number: string
}
function emptyWaypoint(dayId: string | number = ''): WaypointForm {
  return { airport: null, arrDayId: dayId, arrTime: '', depDayId: dayId, depTime: '', airline: '', flight_number: '' }
}

const TYPE_OPTIONS = [
  { value: 'flight',          labelKey: 'reservations.type.flight',          Icon: Plane },
  { value: 'train',           labelKey: 'reservations.type.train',           Icon: Train },
  { value: 'bus',             labelKey: 'reservations.type.bus',             Icon: Bus },
  { value: 'car',             labelKey: 'reservations.type.car',             Icon: Car },
  { value: 'taxi',            labelKey: 'reservations.type.taxi',            Icon: CarTaxiFront },
  { value: 'bicycle',         labelKey: 'reservations.type.bicycle',         Icon: Bike },
  { value: 'cruise',          labelKey: 'reservations.type.cruise',          Icon: Ship },
  { value: 'ferry',           labelKey: 'reservations.type.ferry',           Icon: Sailboat },
  { value: 'transport_other', labelKey: 'reservations.type.transport_other', Icon: Route },
]

const defaultForm = {
  title: '',
  type: 'flight' as TransportType,
  status: 'pending' as 'pending' | 'confirmed',
  start_day_id: '' as string | number,
  end_day_id: '' as string | number,
  departure_time: '',
  arrival_time: '',
  confirmation_number: '',
  notes: '',
  price: '',
  budget_category: '',
  meta_airline: '',
  meta_flight_number: '',
  meta_train_number: '',
  meta_platform: '',
  meta_seat: '',
}

interface TransportModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: Record<string, any>) => Promise<Reservation | undefined>
  reservation: Reservation | null
  days: Day[]
  selectedDayId: number | null
  files?: TripFile[]
  onFileUpload?: (fd: FormData) => Promise<unknown>
  onFileDelete?: (fileId: number) => Promise<void>
}

export function TransportModal({ isOpen, onClose, onSave, reservation, days, selectedDayId, files = [], onFileUpload, onFileDelete }: TransportModalProps) {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const isBudgetEnabled = useAddonStore(s => s.isEnabled('budget'))
  const budgetItems = useTripStore(s => s.budgetItems)
  const loadFiles = useTripStore(s => s.loadFiles)
  const budgetCategories = useMemo(() => {
    const cats = new Set<string>()
    budgetItems.forEach(i => { if (i.category) cats.add(i.category) })
    return Array.from(cats).sort()
  }, [budgetItems])
  const { id: tripId } = useParams<{ id: string }>()
  const [form, setForm] = useState({ ...defaultForm })
  const [isSaving, setIsSaving] = useState(false)
  const [fromPick, setFromPick] = useState<EndpointPick>({})
  const [toPick, setToPick] = useState<EndpointPick>({})
  // Flight route as an ordered list of airports (origin .. stops .. destination).
  const [waypoints, setWaypoints] = useState<WaypointForm[]>([emptyWaypoint(), emptyWaypoint()])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [linkedFileIds, setLinkedFileIds] = useState<number[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    if (reservation) {
      const meta = typeof reservation.metadata === 'string'
        ? JSON.parse(reservation.metadata || '{}')
        : (reservation.metadata || {})
      const eps = reservation.endpoints || []
      const from = eps.find(e => e.role === 'from')
      const to = eps.find(e => e.role === 'to')
      const type = (TRANSPORT_TYPES as readonly string[]).includes(reservation.type)
        ? reservation.type as TransportType
        : 'flight'
      setForm({
        title: reservation.title || '',
        type,
        status: reservation.status || 'pending',
        start_day_id: reservation.day_id ?? '',
        end_day_id: reservation.end_day_id ?? '',
        departure_time: splitReservationDateTime(reservation.reservation_time).time ?? '',
        arrival_time: splitReservationDateTime(reservation.reservation_end_time).time ?? '',
        confirmation_number: reservation.confirmation_number || '',
        notes: reservation.notes || '',
        meta_airline: meta.airline || '',
        meta_flight_number: meta.flight_number || '',
        meta_train_number: meta.train_number || '',
        meta_platform: meta.platform || '',
        meta_seat: meta.seat || '',
        price: meta.price || '',
        budget_category: (meta.budget_category && budgetItems.some(i => i.category === meta.budget_category)) ? meta.budget_category : '',
      })
      if (type === 'flight') {
        const orderedEps = orderedEndpoints(reservation)
        const metaLegs: any[] = Array.isArray(meta.legs) ? meta.legs : []
        let wps: WaypointForm[]
        if (orderedEps.length >= 2) {
          wps = orderedEps.map((ep, i) => {
            const legInto = metaLegs[i - 1] // leg arriving INTO waypoint i
            const legOut = metaLegs[i] // leg departing FROM waypoint i
            const isFirst = i === 0
            const isLast = i === orderedEps.length - 1
            return {
              airport: airportFromEndpoint(ep),
              arrDayId: legInto?.arr_day_id ?? (isLast ? (reservation.end_day_id ?? '') : ''),
              arrTime: legInto?.arr_time ?? (!isFirst ? (ep.local_time ?? '') : ''),
              depDayId: legOut?.dep_day_id ?? (isFirst ? (reservation.day_id ?? '') : ''),
              depTime: legOut?.dep_time ?? (!isLast ? (ep.local_time ?? '') : ''),
              airline: legOut?.airline ?? (isFirst ? (meta.airline ?? '') : ''),
              flight_number: legOut?.flight_number ?? (isFirst ? (meta.flight_number ?? '') : ''),
            }
          })
        } else {
          // Legacy flight with no (or partial) endpoints — seed two waypoints.
          const dep = emptyWaypoint(reservation.day_id ?? '')
          dep.airport = airportFromEndpoint(from)
          dep.depTime = splitReservationDateTime(reservation.reservation_time).time ?? ''
          dep.airline = meta.airline ?? ''
          dep.flight_number = meta.flight_number ?? ''
          const arr = emptyWaypoint(reservation.end_day_id ?? reservation.day_id ?? '')
          arr.airport = airportFromEndpoint(to)
          arr.arrTime = splitReservationDateTime(reservation.reservation_end_time).time ?? ''
          wps = [dep, arr]
        }
        setWaypoints(wps)
      } else {
        setFromPick({ location: locationFromEndpoint(from) || undefined })
        setToPick({ location: locationFromEndpoint(to) || undefined })
      }
    } else {
      setForm({ ...defaultForm, start_day_id: selectedDayId ?? '', end_day_id: selectedDayId ?? '' })
      setFromPick({})
      setToPick({})
      setWaypoints([emptyWaypoint(selectedDayId ?? ''), emptyWaypoint(selectedDayId ?? '')])
    }
  }, [isOpen, reservation, selectedDayId, budgetItems])

  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setIsSaving(true)
    try {
      const startDay = days.find(d => d.id === Number(form.start_day_id))
      const endDay = days.find(d => d.id === Number(form.end_day_id))

      const buildTime = (day: Day | undefined, time: string): string | null => {
        if (!time) return null
        return day?.date ? `${day.date}T${time}` : time
      }

      const dayDate = (id: string | number): string | null => days.find(d => d.id === Number(id))?.date ?? null
      // Flight route as an ordered list of airports (origin .. stops .. destination).
      const flightWps = form.type === 'flight' ? waypoints.filter(w => w.airport) : []
      const firstWp = flightWps[0]
      const lastWp = flightWps[flightWps.length - 1]
      // Per-leg day-plan positions are owned by the day planner, not this form — keep
      // them when re-saving so editing a flight doesn't reset where its legs sit.
      const origLegs: any[] = reservation ? (parseReservationMetadata(reservation).legs || []) : []

      const metadata: Record<string, any> = {}
      if (form.type === 'flight') {
        // Top-level keys mirror the first/last leg so legacy readers keep working.
        if (firstWp?.airline) metadata.airline = firstWp.airline
        if (firstWp?.flight_number) metadata.flight_number = firstWp.flight_number
        if (firstWp?.airport) {
          metadata.departure_airport = firstWp.airport.iata
          metadata.departure_timezone = firstWp.airport.tz
        }
        if (lastWp?.airport) {
          metadata.arrival_airport = lastWp.airport.iata
          metadata.arrival_timezone = lastWp.airport.tz
        }
        // Per-leg detail only for true multi-leg flights — a single-leg flight
        // keeps the exact same (flat) metadata it had before this feature.
        if (flightWps.length > 2) {
          metadata.legs = flightWps.slice(0, -1).map((w, i) => {
            const next = flightWps[i + 1]
            return {
              from: w.airport!.iata,
              to: next.airport!.iata,
              ...(w.airline ? { airline: w.airline } : {}),
              ...(w.flight_number ? { flight_number: w.flight_number } : {}),
              dep_day_id: w.depDayId ? Number(w.depDayId) : null,
              dep_time: w.depTime || null,
              arr_day_id: next.arrDayId ? Number(next.arrDayId) : null,
              arr_time: next.arrTime || null,
              ...(origLegs[i]?.day_positions ? { day_positions: origLegs[i].day_positions } : {}),
            }
          })
        }
      } else if (form.type === 'train') {
        if (form.meta_train_number) metadata.train_number = form.meta_train_number
        if (form.meta_platform) metadata.platform = form.meta_platform
        if (form.meta_seat) metadata.seat = form.meta_seat
      }
      if (isBudgetEnabled) {
        if (form.price) metadata.price = form.price
        if (form.budget_category) metadata.budget_category = form.budget_category
      }

      const startDate = startDay?.date ?? null
      const endDate = (endDay ?? startDay)?.date ?? null
      const endpoints: ReturnType<typeof endpointFromAirport>[] = []
      if (form.type === 'flight') {
        flightWps.forEach((w, i) => {
          const isFirst = i === 0
          const isLast = i === flightWps.length - 1
          const role: 'from' | 'to' | 'stop' = isFirst ? 'from' : isLast ? 'to' : 'stop'
          const dId = isLast ? w.arrDayId : w.depDayId
          const time = isLast ? w.arrTime : w.depTime
          endpoints.push(endpointFromAirport(w.airport!, role, i, dayDate(dId), time || null))
        })
      } else {
        if (fromPick.location) endpoints.push(endpointFromLocation(fromPick.location, 'from', 0, startDate, form.departure_time || null))
        if (toPick.location) endpoints.push(endpointFromLocation(toPick.location, 'to', 1, endDate, form.arrival_time || null))
      }

      // Flights derive their span from the first/last waypoint; other transports
      // keep using the single departure/arrival form fields unchanged.
      const flightDepDay = firstWp && firstWp.depDayId ? Number(firstWp.depDayId) : null
      const flightArrDay = lastWp && lastWp.arrDayId ? Number(lastWp.arrDayId) : null
      const payload = {
        title: form.title,
        type: form.type,
        status: form.status,
        day_id: form.type === 'flight' ? flightDepDay : (form.start_day_id ? Number(form.start_day_id) : null),
        end_day_id: form.type === 'flight' ? flightArrDay : (form.end_day_id ? Number(form.end_day_id) : null),
        reservation_time: form.type === 'flight'
          ? buildTime(days.find(d => d.id === flightDepDay), firstWp?.depTime || '')
          : buildTime(startDay, form.departure_time),
        reservation_end_time: form.type === 'flight'
          ? buildTime(days.find(d => d.id === flightArrDay), lastWp?.arrTime || '')
          : buildTime(endDay ?? startDay, form.arrival_time),
        location: null,
        confirmation_number: form.confirmation_number || null,
        notes: form.notes || null,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
        endpoints,
        needs_review: false,
      }
      if (isBudgetEnabled) {
        (payload as any).create_budget_entry = form.price && parseFloat(form.price) > 0
          ? { total_price: parseFloat(form.price), category: form.budget_category || t(`reservations.type.${form.type}`) || 'Other' }
          : { total_price: 0 }
      }
      const saved = await onSave(payload)
      if (!reservation?.id && saved?.id && pendingFiles.length > 0 && onFileUpload) {
        for (const file of pendingFiles) {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('reservation_id', String(saved.id))
          fd.append('description', form.title)
          await onFileUpload(fd)
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (reservation?.id) {
      setUploadingFile(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('reservation_id', String(reservation.id))
        fd.append('description', reservation.title)
        await onFileUpload!(fd)
        toast.success(t('reservations.toast.fileUploaded'))
      } catch {
        toast.error(t('reservations.toast.uploadError'))
      } finally {
        setUploadingFile(false)
        e.target.value = ''
      }
    } else {
      setPendingFiles(prev => [...prev, file])
      e.target.value = ''
    }
  }

  const attachedFiles = reservation?.id
    ? files.filter(f =>
        f.reservation_id === reservation.id ||
        linkedFileIds.includes(f.id) ||
        (f.linked_reservation_ids && f.linked_reservation_ids.includes(reservation.id))
      )
    : []

  const inputStyle = {
    width: '100%', border: '1px solid var(--border-primary)', borderRadius: 10,
    padding: '8px 12px', fontSize: 13, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box' as const, color: 'var(--text-primary)', background: 'var(--bg-input)',
  }
  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-faint)',
    marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '0.03em',
  }

  const dayOptions = [
    { value: '', label: '—' },
    ...days.map(d => {
      const dateBadge = d.date ? (formatDate(d.date, locale) ?? undefined) : undefined
      const dayBadge = d.title ? t('dayplan.dayN', { n: d.day_number }) : undefined
      return {
        value: d.id,
        label: d.title || t('dayplan.dayN', { n: d.day_number }),
        badge: dateBadge ?? dayBadge,
      }
    }),
  ]

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={reservation ? t('transport.modalTitle.edit') : t('transport.modalTitle.create')}
      size="2xl"
      footer={
        <div className="!flex !justify-end !gap-[8px]">
          <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="!p-[8px_20px] !rounded-[10px] ![border:none] ![background:var(--text-primary)] ![color:var(--bg-primary)] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit]" type="button" onClick={handleSubmit} disabled={isSaving || !form.title.trim()} style={{ opacity: isSaving || !form.title.trim() ? 0.5 : 1 }}>
            {isSaving ? t('common.saving') : reservation ? t('common.update') : t('common.add')}
          </button>
        </div>
      }
    >
      <form className="!flex !flex-col !gap-[14px]" onSubmit={handleSubmit}>

        {/* Type selector */}
        <div>
          <label style={labelStyle}>{t('reservations.bookingType')}</label>
          <div className="!flex !flex-wrap !gap-[5px]">
            {TYPE_OPTIONS.map(({ value, labelKey, Icon }) => (
              <button className="!flex !items-center !gap-[4px] !p-[5px_10px] !rounded-[99px] !text-[length:11px] !font-[500] !cursor-pointer ![font-family:inherit] ![transition:all_0.12s]" key={value} type="button" onClick={() => set('type', value)} style={{ border: '1px solid', background: form.type === value ? 'var(--text-primary)' : 'var(--bg-card)', borderColor: form.type === value ? 'var(--text-primary)' : 'var(--border-primary)', color: form.type === value ? 'var(--bg-primary)' : 'var(--text-muted)' }}>
                <Icon size={11} /> {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label style={labelStyle}>{t('reservations.titleLabel')} *</label>
          <input type="text" value={form.title} onChange={e => set('title', e.target.value)} required
            placeholder={t('reservations.titlePlaceholder')} style={inputStyle} />
        </div>

        {form.type === 'flight' ? (
          /* ── Flight route: ordered airports (origin · stops · destination) ── */
          <div className="!flex !flex-col !gap-[8px]">
            <label style={labelStyle}>{t('reservations.layover.route')}</label>
            {waypoints.map((wp, i) => {
              const isFirst = i === 0
              const isLast = i === waypoints.length - 1
              const updateWp = (patch: Partial<WaypointForm>) => setWaypoints(prev => prev.map((w, j) => (j === i ? { ...w, ...patch } : w)))
              const roleLabel = isFirst ? t('reservations.meta.from') : isLast ? t('reservations.meta.to') : t('reservations.layover.stop')
              return (
                <div className="!flex !flex-col !gap-[6px]" key={i}>
                  <div className="![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[10px] !p-[10px] !flex !flex-col !gap-[8px]">
                    <div className="!flex !items-center !gap-[8px]">
                      <span className="!text-[length:10px] !font-[700] !uppercase !tracking-[0.03em] !shrink-[0] ![color:var(--text-faint)]">{roleLabel}</span>
                      <div className="!flex-[1] !min-w-[0]">
                        <AirportSelect value={wp.airport} onChange={a => updateWp({ airport: a || null })} />
                      </div>
                      {!isFirst && !isLast && (
                        <button className="![background:none] ![border:none] !cursor-pointer !flex !p-[4px] !shrink-[0] ![color:var(--text-faint)]" type="button" onClick={() => setWaypoints(prev => prev.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {!isFirst && (
                      <div className="!flex !gap-[8px]">
                        <div className="!flex-[1] !min-w-[0]">
                          <label style={labelStyle}>{t('reservations.arrivalDate')}</label>
                          <CustomSelect value={wp.arrDayId} onChange={v => updateWp({ arrDayId: v })} placeholder={t('dayplan.dayN', { n: '?' })} options={dayOptions} size="sm" />
                        </div>
                        <div className="!flex-[1] !min-w-[0]">
                          <label style={labelStyle}>{t('reservations.arrivalTime')}</label>
                          <CustomTimePicker value={wp.arrTime} onChange={v => updateWp({ arrTime: v })} />
                        </div>
                        {wp.airport && (
                          <div className="!flex-[1] !min-w-[0]">
                            <label style={labelStyle}>{t('reservations.meta.arrivalTimezone')}</label>
                            <div className="!p-[8px_12px] ![color:var(--text-muted)] !text-[length:12px] ![background:var(--bg-tertiary)]" style={{ ...inputStyle }}>{wp.airport.tz}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {!isLast && (
                      <>
                        <div className="!flex !gap-[8px]">
                          <div className="!flex-[1] !min-w-[0]">
                            <label style={labelStyle}>{t('reservations.departureDate')}</label>
                            <CustomSelect value={wp.depDayId} onChange={v => updateWp({ depDayId: v })} placeholder={t('dayplan.dayN', { n: '?' })} options={dayOptions} size="sm" />
                          </div>
                          <div className="!flex-[1] !min-w-[0]">
                            <label style={labelStyle}>{t('reservations.departureTime')}</label>
                            <CustomTimePicker value={wp.depTime} onChange={v => updateWp({ depTime: v })} />
                          </div>
                          {wp.airport && (
                            <div className="!flex-[1] !min-w-[0]">
                              <label style={labelStyle}>{t('reservations.meta.departureTimezone')}</label>
                              <div className="!p-[8px_12px] ![color:var(--text-muted)] !text-[length:12px] ![background:var(--bg-tertiary)]" style={{ ...inputStyle }}>{wp.airport.tz}</div>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label style={labelStyle}>{t('reservations.meta.airline')}</label>
                            <input type="text" value={wp.airline} onChange={e => updateWp({ airline: e.target.value })} placeholder="Lufthansa" style={inputStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>{t('reservations.meta.flightNumber')}</label>
                            <input type="text" value={wp.flight_number} onChange={e => updateWp({ flight_number: e.target.value })} placeholder="LH 123" style={inputStyle} />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  {!isLast && (
                    <button className="!w-[100%] !flex !items-center !justify-center !gap-[5px] !p-[6px_10px] ![border:1px_dashed_var(--border-primary)] !rounded-[8px] ![background:none] !text-[length:11px] !cursor-pointer ![font-family:inherit] ![color:var(--text-faint)]" type="button" onClick={() => setWaypoints(prev => [...prev.slice(0, i + 1), emptyWaypoint(prev[i]?.depDayId || ''), ...prev.slice(i + 1)])}>
                      <Plus size={12} /> {t('reservations.layover.addStop')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {/* From / To endpoints (non-flight) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label style={labelStyle}>{t('reservations.meta.from')}</label>
                <LocationSelect value={fromPick.location || null} onChange={l => setFromPick({ location: l || undefined })} />
              </div>
              <div>
                <label style={labelStyle}>{t('reservations.meta.to')}</label>
                <LocationSelect value={toPick.location || null} onChange={l => setToPick({ location: l || undefined })} />
              </div>
            </div>

            {/* Departure row */}
            <div className="!flex !gap-[8px]">
              <div className="!flex-[1] !min-w-[0]">
                <label style={labelStyle}>{form.type === 'car' ? t('reservations.pickupDate') : t('reservations.date')}</label>
                <CustomSelect value={form.start_day_id} onChange={value => set('start_day_id', value)} placeholder={t('dayplan.dayN', { n: '?' })} options={dayOptions} size="sm" />
              </div>
              <div className="!flex-[1] !min-w-[0]">
                <label style={labelStyle}>{form.type === 'car' ? t('reservations.pickupTime') : t('reservations.startTime')}</label>
                <CustomTimePicker value={form.departure_time} onChange={v => set('departure_time', v)} />
              </div>
            </div>

            {/* Arrival row */}
            <div className="!flex !gap-[8px]">
              <div className="!flex-[1] !min-w-[0]">
                <label style={labelStyle}>{form.type === 'car' ? t('reservations.returnDate') : t('reservations.endDate')}</label>
                <CustomSelect value={form.end_day_id} onChange={value => set('end_day_id', value)} placeholder={t('dayplan.dayN', { n: '?' })} options={dayOptions} size="sm" />
              </div>
              <div className="!flex-[1] !min-w-[0]">
                <label style={labelStyle}>{form.type === 'car' ? t('reservations.returnTime') : t('reservations.endTime')}</label>
                <CustomTimePicker value={form.arrival_time} onChange={v => set('arrival_time', v)} />
              </div>
            </div>
          </>
        )}

        {/* Train-specific fields */}
        {form.type === 'train' && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label style={labelStyle}>{t('reservations.meta.trainNumber')}</label>
              <input type="text" value={form.meta_train_number} onChange={e => set('meta_train_number', e.target.value)}
                placeholder="ICE 123" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('reservations.meta.platform')}</label>
              <input type="text" value={form.meta_platform} onChange={e => set('meta_platform', e.target.value)}
                placeholder="12" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('reservations.meta.seat')}</label>
              <input type="text" value={form.meta_seat} onChange={e => set('meta_seat', e.target.value)}
                placeholder="42A" style={inputStyle} />
            </div>
          </div>
        )}

        {/* Booking Code + Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label style={labelStyle}>{t('reservations.confirmationCode')}</label>
            <input type="text" value={form.confirmation_number} onChange={e => set('confirmation_number', e.target.value)}
              placeholder={t('reservations.confirmationPlaceholder')} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t('reservations.status')}</label>
            <CustomSelect
              value={form.status}
              onChange={value => set('status', value)}
              options={[
                { value: 'pending', label: t('reservations.pending') },
                { value: 'confirmed', label: t('reservations.confirmed') },
              ]}
              size="sm"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label style={labelStyle}>{t('reservations.notes')}</label>
          <textarea className="![resize:none] !leading-[1.5]" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
            placeholder={t('reservations.notesPlaceholder')}
            style={{ ...inputStyle }} />
        </div>

        {/* Files */}
        <div>
          <label style={labelStyle}>{t('files.title')}</label>
          <div className="!flex !flex-col !gap-[4px]">
            {attachedFiles.map(f => (
              <div className="!flex !items-center !gap-[8px] !p-[5px_10px] ![background:var(--bg-secondary)] !rounded-[8px]" key={f.id}>
                <FileText size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span className="!flex-[1] !text-[length:12px] ![color:var(--text-secondary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{f.original_name}</span>
                <a className="![color:var(--text-faint)] !flex !shrink-[0] !cursor-pointer" href="#" onClick={(e) => { e.preventDefault(); openFile(f.url).catch(() => {}) }}><ExternalLink size={11} /></a>
                <button className="![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !flex !p-[0] !shrink-[0]" type="button" onClick={async () => {
                  if (f.reservation_id === reservation?.id) {
                    try { await apiClient.put(`/trips/${tripId}/files/${f.id}`, { reservation_id: null }) } catch {}
                  }
                  try {
                    const linksRes = await apiClient.get(`/trips/${tripId}/files/${f.id}/links`)
                    const link = (linksRes.data.links || []).find((l: any) => l.reservation_id === reservation?.id)
                    if (link) await apiClient.delete(`/trips/${tripId}/files/${f.id}/link/${link.id}`)
                  } catch {}
                  setLinkedFileIds(prev => prev.filter(id => id !== f.id))
                  if (tripId) loadFiles(tripId)
                }}>
                  <X size={11} />
                </button>
              </div>
            ))}
            {pendingFiles.map((f, i) => (
              <div className="!flex !items-center !gap-[8px] !p-[5px_10px] ![background:var(--bg-secondary)] !rounded-[8px]" key={i}>
                <FileText size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span className="!flex-[1] !text-[length:12px] ![color:var(--text-secondary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{f.name}</span>
                <button className="![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !flex !p-[0] !shrink-[0]" type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}>
                  <X size={11} />
                </button>
              </div>
            ))}
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.txt,image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <div className="!flex !gap-[6px] !flex-wrap">
              {onFileUpload && <button className="!flex !items-center !gap-[5px] !p-[6px_10px] ![border:1px_dashed_var(--border-primary)] !rounded-[8px] ![background:none] !text-[length:11px] ![color:var(--text-faint)] ![font-family:inherit]" type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile} style={{ cursor: uploadingFile ? 'default' : 'pointer' }}>
                <Paperclip size={11} />
                {uploadingFile ? t('reservations.uploading') : t('reservations.attachFile')}
              </button>}
              {reservation?.id && files.filter(f => !f.deleted_at && !attachedFiles.some(af => af.id === f.id)).length > 0 && (
                <div className="!relative">
                  <button className="!flex !items-center !gap-[5px] !p-[6px_10px] ![border:1px_dashed_var(--border-primary)] !rounded-[8px] ![background:none] !text-[length:11px] ![color:var(--text-faint)] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => setShowFilePicker(v => !v)}>
                    <Link2 size={11} /> {t('reservations.linkExisting')}
                  </button>
                  {showFilePicker && (
                    <div className="!absolute !bottom-[100%] !left-[0] !mb-[4px] !z-[50] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !min-w-[220px] !max-h-[200px] !overflow-y-auto">
                      {files.filter(f => !f.deleted_at && !attachedFiles.some(af => af.id === f.id)).map(f => (
                        <button className="trek-hover-tertiary !flex !items-center !gap-[8px] !w-[100%] !p-[6px_10px] ![background:none] ![border:none] !cursor-pointer !text-[length:12px] ![font-family:inherit] ![color:var(--text-secondary)] !rounded-[7px] !text-left" key={f.id} type="button" onClick={async () => {
                          try {
                            await apiClient.post(`/trips/${tripId}/files/${f.id}/link`, { reservation_id: reservation.id })
                            setLinkedFileIds(prev => [...prev, f.id])
                            setShowFilePicker(false)
                            if (tripId) loadFiles(tripId)
                          } catch {}
                        }}>
                          <FileText size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                          <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{f.original_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Price + Budget Category */}
        {isBudgetEnabled && (
          <>
            <div className="!flex !gap-[8px]">
              <div className="!flex-[1] !min-w-[0]">
                <label style={labelStyle}>{t('reservations.price')}</label>
                <input type="text" inputMode="decimal" value={form.price}
                  onChange={e => { const v = e.target.value; if (v === '' || /^\d*[.,]?\d{0,2}$/.test(v)) set('price', v.replace(',', '.')) }}
                  onPaste={e => { e.preventDefault(); let txt = e.clipboardData.getData('text').trim().replace(/[^\d.,-]/g, ''); const lc = txt.lastIndexOf(','), ld = txt.lastIndexOf('.'), dp = Math.max(lc, ld); if (dp > -1) { txt = txt.substring(0, dp).replace(/[.,]/g, '') + '.' + txt.substring(dp + 1) } else { txt = txt.replace(/[.,]/g, '') } set('price', txt) }}
                  placeholder="0.00"
                  style={inputStyle} />
              </div>
              <div className="!flex-[1] !min-w-[0]">
                <label style={labelStyle}>{t('reservations.budgetCategory')}</label>
                <CustomSelect
                  value={form.budget_category}
                  onChange={v => set('budget_category', v)}
                  options={[
                    { value: '', label: t('reservations.budgetCategoryAuto') },
                    ...budgetCategories.map(c => ({ value: c, label: c })),
                  ]}
                  placeholder={t('reservations.budgetCategoryAuto')}
                  size="sm"
                />
              </div>
            </div>
            {form.price && parseFloat(form.price) > 0 && (
              <div className="!text-[length:11px] ![color:var(--text-faint)] !mt-[-4px]">
                {t('reservations.budgetHint')}
              </div>
            )}
          </>
        )}

      </form>
    </Modal>
  )
}
