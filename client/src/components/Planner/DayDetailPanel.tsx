import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { X, Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudLightning, Wind, Droplets, Sunrise, Sunset, Hotel, Calendar, MapPin, LogIn, LogOut, Hash, Pencil, Plane, Utensils, Train, Car, Ship, Ticket, FileText, Users, ChevronsDown, ChevronsUp } from 'lucide-react'

const RES_TYPE_ICONS = { flight: Plane, hotel: Hotel, restaurant: Utensils, train: Train, car: Car, cruise: Ship, event: Ticket, tour: Users, other: FileText }
const RES_TYPE_COLORS = { flight: '#3b82f6', hotel: '#8b5cf6', restaurant: '#ef4444', train: '#06b6d4', car: '#6b7280', cruise: '#0ea5e9', event: '#f59e0b', tour: '#10b981', other: '#6b7280' }
import { weatherApi, accommodationsApi } from '../../api/client'
import DayLodgingModal from './DayLodgingModal'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'
import CustomSelect from '../shared/CustomSelect'
import CustomTimePicker from '../shared/CustomTimePicker'
import { useSettingsStore } from '../../store/settingsStore'
import { getLocaleForLanguage, useTranslation } from '../../i18n'
import type { Day, Place, Category, Reservation, AssignmentsMap } from '../../types'
import { isDayInAccommodationRange } from '../../utils/dayOrder'
import { splitReservationDateTime } from '../../utils/formatters'

const WEATHER_ICON_MAP = {
  Clear: Sun, Clouds: Cloud, Rain: CloudRain, Drizzle: CloudDrizzle,
  Thunderstorm: CloudLightning, Snow: CloudSnow, Mist: Wind, Fog: Wind, Haze: Wind,
}

interface WIconProps {
  main: string
  size?: number
}

function WIcon({ main, size = 14 }: WIconProps) {
  const Icon = WEATHER_ICON_MAP[main] || Cloud
  return <Icon size={size} strokeWidth={1.8} />
}

function cTemp(c, f) { return Math.round(f ? c * 9 / 5 + 32 : c) }

function formatTime12(val, is12h) {
  if (!val) return val
  const [h, m] = val.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return val
  if (!is12h) return val
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

interface DayDetailPanelProps {
  day: Day
  days: Day[]
  places: Place[]
  categories?: Category[]
  tripId: number | string
  assignments: AssignmentsMap
  reservations?: Reservation[]
  lat: number | null
  lng: number | null
  onClose: () => void
  onAccommodationChange: () => void
  leftWidth?: number
  rightWidth?: number
  collapsed?: boolean
  onToggleCollapse?: () => void
  mobile?: boolean
}

export default function DayDetailPanel({ day, days, places, categories = [], tripId, assignments, reservations = [], lat, lng, onClose, onAccommodationChange, leftWidth = 0, rightWidth = 0, collapsed: collapsedProp = false, onToggleCollapse, mobile = false }: DayDetailPanelProps) {
  const { t, language, locale } = useTranslation()
  const can = useCanDo()
  const tripObj = useTripStore((s) => s.trip)
  const canEditDays = can('day_edit', tripObj)
  const isFahrenheit = useSettingsStore(s => s.settings.temperature_unit) === 'fahrenheit'
  const is12h = useSettingsStore(s => s.settings.time_format) === '12h'
  const blurCodes = useSettingsStore(s => s.settings.blur_booking_codes)
  const fmtTime = (v) => {
    if (!v) return v
    if (v.includes('T')) return new Date(v).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: is12h })
    return formatTime12(v, is12h)
  }
  const unit = isFahrenheit ? '°F' : '°C'
  const collapsed = collapsedProp
  const toggleCollapse = () => onToggleCollapse?.()
  const [weather, setWeather] = useState(null)
  const [loading, setLoading] = useState(false)
  const [accommodation, setAccommodation] = useState(null)
  const [dayAccommodations, setDayAccommodations] = useState<any[]>([])
  const [accommodations, setAccommodations] = useState([])
  const [showHotelPicker, setShowHotelPicker] = useState<boolean | 'edit'>(false)
  const [showLodging, setShowLodging] = useState(false)
  const [hotelDayRange, setHotelDayRange] = useState({ start: day?.id, end: day?.id })
  const [hotelCategoryFilter, setHotelCategoryFilter] = useState<number | ''>('')
  const [hotelForm, setHotelForm] = useState({ check_in: '', check_in_end: '', check_out: '', confirmation: '', place_id: null })

  useEffect(() => {
    if (!day?.date || !lat || !lng) { setWeather(null); return }
    setLoading(true)
    weatherApi.getDetailed(lat, lng, day.date, language)
      .then(data => setWeather(data.error ? null : data))
      .catch(() => setWeather(null))
      .finally(() => setLoading(false))
  }, [day?.date, lat, lng, language])

  useEffect(() => {
    if (!tripId) return
    accommodationsApi.list(tripId)
      .then(data => {
        setAccommodations(data.accommodations || [])
        const allForDay = (data.accommodations || []).filter(a =>
          day ? isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, days) : false
        )
        setDayAccommodations(allForDay)
        setAccommodation(allForDay[0] || null)
      })
      .catch(() => {})
  }, [tripId, day?.id])

  useEffect(() => { if (day) setHotelDayRange({ start: day.id, end: day.id }) }, [day?.id])

  const handleSelectPlace = (placeId) => {
    setHotelForm(f => ({ ...f, place_id: placeId }))
  }

  const handleSaveAccommodation = async () => {
    if (!hotelForm.place_id) return
    try {
      const data = await accommodationsApi.create(tripId, {
        place_id: hotelForm.place_id,
        start_day_id: hotelDayRange.start,
        end_day_id: hotelDayRange.end,
        check_in: hotelForm.check_in || null,
        check_in_end: hotelForm.check_in_end || null,
        check_out: hotelForm.check_out || null,
        confirmation: hotelForm.confirmation || null,
      })
      const newAcc = data.accommodation
      const updated = [...accommodations, newAcc]
      setAccommodations(updated)
      setAccommodation(newAcc)
      setDayAccommodations(updated.filter(a =>
        day ? isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, days) : false
      ))
      setShowHotelPicker(false)
      setHotelForm({ check_in: '', check_in_end: '', check_out: '', confirmation: '', place_id: null })
      onAccommodationChange?.()
    } catch {}
  }

  const updateAccommodationField = async (field, value) => {
    if (!accommodation) return
    try {
      const data = await accommodationsApi.update(tripId, accommodation.id, { [field]: value || null })
      setAccommodation(data.accommodation)
      onAccommodationChange?.()
    } catch {}
  }

  const handleRemoveAccommodation = async () => {
    if (!accommodation) return
    try {
      await accommodationsApi.delete(tripId, accommodation.id)
      const updated = accommodations.filter(a => a.id !== accommodation.id)
      setAccommodations(updated)
      setDayAccommodations(updated.filter(a =>
        day ? isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, days) : false
      ))
      setAccommodation(null)
      onAccommodationChange?.()
    } catch {}
  }

  if (!day) return null

  const formattedDate = day.date ? new Date(day.date + 'T00:00:00Z').toLocaleDateString(
    getLocaleForLanguage(language),
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
  ) : null

  const placesWithCoords = places.filter(p => p.lat && p.lng)
  const font = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }

  return (
    <div className="fixed z-50" style={{ bottom: 'calc(var(--bottom-nav-h) + 20px)', left: `calc(${leftWidth}px + (100vw - ${leftWidth}px - ${rightWidth}px) / 2)`, transform: 'translateX(-50%)', width: `min(800px, calc(100vw - ${leftWidth}px - ${rightWidth}px - 32px))`, ...(mobile ? { zIndex: 10000 } : null), ...font }}>
      <div className="![background:var(--bg-elevated)] ![backdrop-filter:blur(40px)_saturate(180%)] ![-webkit-backdrop-filter:blur(40px)_saturate(180%)] !rounded-[20px] ![box-shadow:0_8px_40px_rgba(0,0,0,0.14),_0_0_0_1px_rgba(0,0,0,0.06)] !overflow-hidden !flex !flex-col" style={{ maxHeight: collapsed ? 'none' : '60vh' }}>
        {/* Header */}
        <div className="!flex !items-center !gap-[14px] !cursor-pointer" style={{ padding: collapsed ? '12px 16px 12px 20px' : '18px 16px 14px 20px', borderBottom: collapsed ? 'none' : '1px solid var(--border-faint)' }}
          onClick={() => toggleCollapse()}>
          <div className="!rounded-[12px] ![background:var(--bg-secondary)] !flex !items-center !justify-center !shrink-[0] ![transition:all_0.15s_ease]" style={{ width: collapsed ? 36 : 44, height: collapsed ? 36 : 44 }}>
            <Calendar size={collapsed ? 16 : 20} style={{ color: 'var(--text-primary)' }} />
          </div>
          <div className="!flex-[1] !min-w-[0]">
            <div className="![color:var(--text-primary)] ![transition:font-size_0.15s_ease]" style={{ fontSize: collapsed ? 13 : 15, fontWeight: 700 }}>
              {day.title || t('planner.dayN', { n: (days.indexOf(day) + 1) || '?' })}
              {collapsed && formattedDate && <span className="!font-[500] ![color:var(--text-muted)] !ml-[8px]">{formattedDate}</span>}
            </div>
            {!collapsed && formattedDate && <div className="!text-[length:12px] ![color:var(--text-muted)] !mt-[1px]">{formattedDate}</div>}
          </div>
          <button className="trek-hover ![background:var(--bg-secondary)] ![border:none] !rounded-[10px] !w-[32px] !h-[32px] !flex !items-center !justify-center !cursor-pointer !shrink-[0] ![transition:all_0.15s_ease]" onClick={(e) => { e.stopPropagation(); toggleCollapse() }} title={collapsed ? t('common.expand') : t('common.collapse')}>
            {collapsed ? <ChevronsUp size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronsDown size={14} style={{ color: 'var(--text-muted)' }} />}
          </button>
          <button className="trek-hover ![background:var(--bg-secondary)] ![border:none] !rounded-[10px] !w-[32px] !h-[32px] !flex !items-center !justify-center !cursor-pointer !shrink-[0]" onClick={(e) => { e.stopPropagation(); onClose() }}>
            <X size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="!overflow-y-auto !p-[14px_20px_18px]" style={{ display: collapsed ? 'none' : 'block' }}>

          {/* ── Weather ── */}
          {day.date && lat && lng && (
            loading ? (
              <div className="!text-center !p-[16px] ![color:var(--text-faint)] !text-[length:12px]">
                <div className="!w-[18px] !h-[18px] ![border:2px_solid_var(--border-primary)] ![border-top-color:var(--text-primary)] !rounded-[50%] !m-[0_auto_6px]" style={{ animation: 'spin 0.8s linear infinite' }} />
              </div>
            ) : weather ? (
              <div>
                {/* Summary row */}
                <div className="!flex !items-center !gap-[12px] !mb-[10px]">
                  <div className="!w-[40px] !h-[40px] !rounded-[12px] ![background:var(--bg-secondary)] !flex !items-center !justify-center !shrink-[0]">
                    <WIcon main={weather.main} size={20} />
                  </div>
                  <div className="!flex-[1] !flex !items-baseline !gap-[6px] !flex-wrap">
                    <span className="!text-[length:20px] !font-[700] ![color:var(--text-primary)] !leading-[1]">
                      {weather.type === 'climate' ? 'Ø ' : ''}{cTemp(weather.temp, isFahrenheit)}{unit}
                    </span>
                    {weather.temp_max != null && (
                      <span className="!text-[length:12px] ![color:var(--text-faint)]">
                        {cTemp(weather.temp_min, isFahrenheit)}° / {cTemp(weather.temp_max, isFahrenheit)}°
                      </span>
                    )}
                    {weather.description && (
                      <span className="!text-[length:12px] ![color:var(--text-muted)] !capitalize">{weather.description}</span>
                    )}
                  </div>
                </div>

                {/* Chips row */}
                <div className="!flex !flex-wrap !gap-[6px]" style={{ marginBottom: weather.hourly ? 10 : 0 }}>
                  {weather.precipitation_probability_max != null && (
                    <Chip icon={Droplets} value={`${weather.precipitation_probability_max}%`} />
                  )}
                  {weather.precipitation_sum > 0 && (
                    <Chip icon={CloudRain} value={`${weather.precipitation_sum.toFixed(1)} mm`} />
                  )}
                  {weather.wind_max != null && (
                    <Chip icon={Wind} value={isFahrenheit ? `${Math.round(weather.wind_max * 0.621371)} mph` : `${Math.round(weather.wind_max)} km/h`} />
                  )}
                  {weather.sunrise && <Chip icon={Sunrise} value={weather.sunrise} />}
                  {weather.sunset && <Chip icon={Sunset} value={weather.sunset} />}
                </div>

                {/* Hourly scroll */}
                {weather.hourly?.length > 0 && (
                  <div className="!overflow-x-auto !m-[0_-6px] !p-[0_6px_4px]">
                    <div className="!inline-flex !gap-[2px]">
                      {weather.hourly.filter((_, i) => i % 2 === 0).map(h => (
                        <div className="!flex !flex-col !items-center !gap-[3px] !w-[44px] !p-[5px_2px] !rounded-[8px]" key={h.hour} style={{ background: h.precipitation_probability > 50 ? 'rgba(59,130,246,0.07)' : 'transparent' }}>
                          <span className="!text-[length:9px] ![color:var(--text-faint)] !font-[500]">{String(h.hour).padStart(2, '0')}</span>
                          <WIcon main={h.main} size={12} />
                          <span className="!text-[length:10px] !font-[600] ![color:var(--text-primary)]">{cTemp(h.temp, isFahrenheit)}°</span>
                          {h.precipitation_probability > 0 && (
                            <span className="!text-[length:8px] ![color:#3b82f6] !font-[500]">{h.precipitation_probability}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {weather.type === 'climate' && (
                  <div className="!text-[length:10px] ![color:var(--text-faint)] !mt-[6px] !italic">{t('day.climateHint')}</div>
                )}
              </div>
            ) : (
              <div className="!text-[length:12px] ![color:var(--text-faint)] !text-center !p-[8px]">{t('day.noWeather')}</div>
            )
          )}

          {/* ── Reservations for this day's assignments ── */}
          {(() => {
            const dayAssignments = assignments[String(day.id)] || []
            const dayReservations = reservations.filter(r => {
              if (r.type === 'hotel') return false
              if (r.assignment_id && dayAssignments.some(a => a.id === r.assignment_id)) return true
              return r.day_id === day.id
            })
            if (dayReservations.length === 0) return null
            return (
              <div className="!mb-[0]">
                {day.date && lat && lng && <div className="!h-[1px] ![background:var(--border-faint)] !m-[12px_0]" />}
                <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.05em] !mb-[6px]">{t('day.reservations')}</div>
                <div className="!flex !flex-col !gap-[4px]">
                  {dayReservations.map(r => {
                    const linkedAssignment = dayAssignments.find(a => a.id === r.assignment_id)
                    const confirmed = r.status === 'confirmed'
                    return (
                      <div className="!flex !items-center !gap-[8px] !p-[5px_10px] !rounded-[8px]" key={r.id} style={{ background: confirmed ? 'rgba(22,163,74,0.06)' : 'rgba(217,119,6,0.06)', border: `1px solid ${confirmed ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)'}` }}>
                        {(() => { const TIcon = RES_TYPE_ICONS[r.type] || FileText; return <TIcon size={12} style={{ color: RES_TYPE_COLORS[r.type] || 'var(--text-faint)', flexShrink: 0 }} /> })()}
                        <div className="!flex-[1] !min-w-[0] !flex !items-center !gap-[6px] !overflow-hidden">
                          <span className="!text-[length:11px] !font-[600] ![color:var(--text-primary)] !whitespace-nowrap !overflow-hidden !text-ellipsis">{r.title}</span>
                          {linkedAssignment?.place && <span className="!text-[length:9px] ![color:var(--text-faint)] !whitespace-nowrap">· {linkedAssignment.place.name}</span>}
                        </div>
                        {(() => {
                          const { time: startTime } = splitReservationDateTime(r.reservation_time)
                          const { time: endTime } = splitReservationDateTime(r.reservation_end_time)
                          if (!startTime && !endTime) return null
                          return (
                            <span className="!text-[length:10px] ![color:var(--text-muted)] !whitespace-nowrap !shrink-[0]">
                              {startTime ? formatTime12(startTime, is12h) : ''}
                              {endTime ? ` – ${formatTime12(endTime, is12h)}` : ''}
                            </span>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Divider before accommodation */}
          <div className="!h-[1px] ![background:var(--border-faint)] !m-[12px_0]" />

          {/* ── Accommodation ── */}
          <div>
            <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.05em] !mb-[8px]">{t('day.accommodation')}</div>

            {dayAccommodations.length > 0 ? (
              <div className="!flex !flex-col !gap-[8px]">
                {dayAccommodations.map(acc => {
                  const isCheckInDay = acc.start_day_id === day.id
                  const isCheckOutDay = acc.end_day_id === day.id
                  const isMiddleDay = !isCheckInDay && !isCheckOutDay
                  const dayLabel = isCheckInDay && isCheckOutDay ? t('day.checkIn') + ' & ' + t('day.checkOut')
                    : isCheckInDay ? t('day.checkIn')
                    : isCheckOutDay ? t('day.checkOut')
                    : null
                  const linked = reservations.find(r => r.accommodation_id === acc.id)
                  const confirmed = linked?.status === 'confirmed'

                  return (
                    <div className="!rounded-[12px] ![background:var(--bg-secondary)] !overflow-hidden" key={acc.id}>
                      {/* Day label */}
                      {dayLabel && (
                        <div className="!p-[4px_12px_0] !flex !items-center !gap-[4px]">
                          {isCheckInDay && <LogIn size={9} style={{ color: '#22c55e' }} />}
                          {isCheckOutDay && !isCheckInDay && <LogOut size={9} style={{ color: '#ef4444' }} />}
                          <span className="!text-[length:9px] !font-[700] !uppercase !tracking-[0.05em]" style={{ color: isCheckOutDay && !isCheckInDay ? '#ef4444' : '#22c55e' }}>{dayLabel}</span>
                        </div>
                      )}
                      {/* Hotel header */}
                      <div className="!flex !items-center !gap-[10px] !p-[8px_12px]">
                        <div className="!w-[36px] !h-[36px] !rounded-[10px] ![background:var(--bg-tertiary)] !flex !items-center !justify-center !shrink-[0]">
                          {acc.place_image ? (
                            <img className="!w-[100%] !h-[100%] !rounded-[10px] !object-cover" src={acc.place_image} />
                          ) : (
                            <Hotel size={16} style={{ color: 'var(--text-muted)' }} />
                          )}
                        </div>
                        <div className="!flex-[1] !min-w-[0]">
                          <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{acc.place_name}</div>
                          {acc.place_address && <div className="!text-[length:10px] ![color:var(--text-faint)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{acc.place_address}</div>}
                        </div>
                        {canEditDays && <button className="![background:none] ![border:none] !cursor-pointer !p-[3px] !shrink-[0]" onClick={() => { setAccommodation(acc); setHotelForm({ check_in: acc.check_in || '', check_in_end: acc.check_in_end || '', check_out: acc.check_out || '', confirmation: acc.confirmation || '', place_id: acc.place_id }); setHotelDayRange({ start: acc.start_day_id, end: acc.end_day_id }); setShowHotelPicker('edit') }}>
                          <Pencil size={12} style={{ color: 'var(--text-faint)' }} />
                        </button>}
                        {canEditDays && <button className="![background:none] ![border:none] !cursor-pointer !p-[3px] !shrink-[0]" onClick={() => { setAccommodation(acc); handleRemoveAccommodation() }}>
                          <X size={12} style={{ color: 'var(--text-faint)' }} />
                        </button>}
                      </div>
                      {/* Details grid */}
                      <div className="!flex !gap-[0] !m-[0_12px_8px] !rounded-[10px] !overflow-hidden ![border:1px_solid_var(--border-faint)]">
                        {acc.check_in && (
                          <div className="!flex-[1] !p-[8px_10px] ![border-right:1px_solid_var(--border-faint)] !text-center">
                            <div className="!text-[length:12px] !font-[700] ![color:var(--text-primary)] !leading-[1.2]">
                              {fmtTime(acc.check_in)}{acc.check_in_end ? ` – ${fmtTime(acc.check_in_end)}` : ''}
                            </div>
                            <div className="!text-[length:9px] ![color:var(--text-faint)] !font-[500] !mt-[2px] !flex !items-center !justify-center !gap-[3px]">
                              <LogIn size={8} /> {t('day.checkIn')}
                            </div>
                          </div>
                        )}
                        {acc.check_out && (
                          <div className="!flex-[1] !p-[8px_10px] !text-center" style={{ borderRight: acc.confirmation ? '1px solid var(--border-faint)' : 'none' }}>
                            <div className="!text-[length:12px] !font-[700] ![color:var(--text-primary)] !leading-[1.2]">{fmtTime(acc.check_out)}</div>
                            <div className="!text-[length:9px] ![color:var(--text-faint)] !font-[500] !mt-[2px] !flex !items-center !justify-center !gap-[3px]">
                              <LogOut size={8} /> {t('day.checkOut')}
                            </div>
                          </div>
                        )}
                        {acc.confirmation && (
                          <div className="!flex-[1] !p-[8px_10px] !text-center">
                            <div className="!text-[length:12px] !font-[700] ![color:var(--text-primary)] !leading-[1.2]">{acc.confirmation}</div>
                            <div className="!text-[length:9px] ![color:var(--text-faint)] !font-[500] !mt-[2px] !flex !items-center !justify-center !gap-[3px]">
                              <Hash size={8} /> {t('day.confirmation')}
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Linked booking */}
                      {linked && (
                        <div className="!m-[0_12px_8px] !p-[6px_10px] !rounded-[8px] !flex !items-center !gap-[8px]" style={{ background: confirmed ? 'rgba(22,163,74,0.06)' : 'rgba(217,119,6,0.06)', border: `1px solid ${confirmed ? 'rgba(22,163,74,0.15)' : 'rgba(217,119,6,0.15)'}` }}>
                          <div className="!w-[6px] !h-[6px] !rounded-[50%] !shrink-[0]" style={{ background: confirmed ? '#16a34a' : '#d97706' }} />
                          <div className="!flex-[1] !min-w-[0]">
                            <div className="!text-[length:11px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{linked.title}</div>
                            <div className="!text-[length:9px] ![color:var(--text-faint)] !flex !gap-[6px] !mt-[1px]">
                              <span>{confirmed ? t('reservations.confirmed') : t('reservations.pending')}</span>
                              {linked.confirmation_number && <span className={[(blurCodes) ? 'trek-h-filter-6e247f' : undefined, '![transition:filter_0.2s]'].join(' ')} onClick={e => { if (blurCodes) { const el = e.currentTarget; el.style.filter = el.style.filter === 'none' ? 'blur(4px)' : 'none' } }}
                                style={{ filter: blurCodes ? 'blur(4px)' : 'none', cursor: blurCodes ? 'pointer' : 'default' }}
                              >#{linked.confirmation_number}</span>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* Add another hotel */}
                {canEditDays && <button className="!w-[100%] !p-[8px] ![border:1.5px_dashed_var(--border-primary)] !rounded-[10px] ![background:none] !cursor-pointer !flex !items-center !justify-center !gap-[5px] !text-[length:10px] ![color:var(--text-faint)] ![font-family:inherit]" onClick={() => setShowHotelPicker(true)}>
                  <Hotel size={10} /> {t('day.addAccommodation')}
                </button>}
              </div>
            ) : (
              canEditDays ? <button className="!w-[100%] !p-[10px] ![border:1.5px_dashed_var(--border-primary)] !rounded-[10px] ![background:none] !cursor-pointer !flex !items-center !justify-center !gap-[5px] !text-[length:11px] ![color:var(--text-faint)] ![font-family:inherit]" onClick={() => setShowHotelPicker(true)}>
                <Hotel size={12} /> {t('day.addAccommodation')}
              </button> : null
            )}

            {/* Alojamiento de la noche: abre Booking con la localidad final del día y da de alta el hotel elegido */}
            {canEditDays && (
              <button className="!w-[100%] !mt-[8px] !p-[9px] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![background:var(--bg-card)] !cursor-pointer !flex !items-center !justify-center !gap-[6px] !text-[length:11px] !font-[600] ![color:var(--text-primary)] ![font-family:inherit]" type="button" onClick={() => setShowLodging(true)}>
                <Hotel size={12} /> {t('day.lodging.open')}
              </button>
            )}
            {showLodging && day && (
              <DayLodgingModal day={day} days={days} tripId={tripId} onClose={() => setShowLodging(false)}
                onSaved={() => {
                  accommodationsApi.list(tripId).then(data => {
                    setAccommodations(data.accommodations || [])
                    const allForDay = (data.accommodations || []).filter(a => isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, days))
                    setDayAccommodations(allForDay)
                    setAccommodation(allForDay[0] || null)
                  }).catch(() => {})
                  onAccommodationChange?.()
                }} />
            )}

            {/* Hotel Picker Popup — portal to body to escape transform stacking context */}
            {showHotelPicker && ReactDOM.createPortal(
              <div className="!fixed !inset-[0] !z-[99999] ![background:rgba(0,0,0,0.4)] ![backdrop-filter:blur(4px)] !flex !items-center !justify-center !p-[16px]"
                onClick={() => setShowHotelPicker(false)}>
                <div onClick={e => e.stopPropagation()} style={{
                  width: '100%', maxWidth: 900, borderRadius: 16, overflow: 'hidden',
                  background: 'var(--bg-card)', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                  ...font,
                }}>
                  {/* Popup Header */}
                  <div className="!p-[16px_18px_12px] ![border-bottom:1px_solid_var(--border-faint)] !flex !items-center !gap-[10px]">
                    <Hotel size={16} style={{ color: 'var(--text-primary)' }} />
                    <span className="!text-[length:14px] !font-[700] ![color:var(--text-primary)] !flex-[1]">{showHotelPicker === 'edit' ? t('day.editAccommodation') : t('day.addAccommodation')}</span>
                    <button className="![background:var(--bg-secondary)] ![border:none] !rounded-[8px] !w-[28px] !h-[28px] !flex !items-center !justify-center !cursor-pointer" onClick={() => setShowHotelPicker(false)}>
                      <X size={12} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  </div>

                  {/* Day Range */}
                  <div className="!p-[12px_18px] ![border-bottom:1px_solid_var(--border-faint)] ![background:var(--bg-secondary)]">
                    <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !mb-[8px] !uppercase !tracking-[0.04em]">{t('day.hotelDayRange')}</div>
                    <div className="!flex !gap-[8px] !items-center">
                      <div className="!flex-[1] !min-w-[0]">
                        <CustomSelect
                          value={hotelDayRange.start}
                          onChange={v => setHotelDayRange(prev => ({ start: v, end: days.findIndex(d => d.id === v) > days.findIndex(d => d.id === prev.end) ? v : prev.end }))}
                          options={days.map((d, i) => ({
                            value: d.id,
                            label: d.title || t('planner.dayN', { n: i + 1 }),
                            badge: d.date
                              ? new Date(d.date + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
                              : (d.title ? t('planner.dayN', { n: i + 1 }) : undefined),
                          }))}
                          size="sm"
                        />
                      </div>
                      <span className="!text-[length:11px] ![color:var(--text-faint)] !shrink-[0]">→</span>
                      <div className="!flex-[1] !min-w-[0]">
                        <CustomSelect
                          value={hotelDayRange.end}
                          onChange={v => setHotelDayRange(prev => ({ start: days.findIndex(d => d.id === v) < days.findIndex(d => d.id === prev.start) ? v : prev.start, end: v }))}
                          options={days.map((d, i) => ({
                            value: d.id,
                            label: d.title || t('planner.dayN', { n: i + 1 }),
                            badge: d.date
                              ? new Date(d.date + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
                              : (d.title ? t('planner.dayN', { n: i + 1 }) : undefined),
                          }))}
                          size="sm"
                        />
                      </div>
                      <button className="!p-[6px_14px] !rounded-[8px] ![border:none] !text-[length:11px] !font-[600] !cursor-pointer !shrink-[0]" onClick={() => setHotelDayRange({ start: days[0]?.id, end: days[days.length - 1]?.id })} style={{ background: hotelDayRange.start === days[0]?.id && hotelDayRange.end === days[days.length - 1]?.id ? 'var(--text-primary)' : 'var(--bg-card)', color: hotelDayRange.start === days[0]?.id && hotelDayRange.end === days[days.length - 1]?.id ? 'var(--bg-card)' : 'var(--text-muted)' }}>
                        {t('day.allDays')}
                      </button>
                    </div>
                  </div>

                  {/* Check-in / Check-out / Confirmation */}
                  <div className="!p-[10px_18px] ![border-bottom:1px_solid_var(--border-faint)] !flex !gap-[8px] !flex-wrap">
                    <div className="!flex-[1] !min-w-[80px]">
                      <label className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.04em] !block !mb-[3px]">{t('day.checkIn')}</label>
                      <CustomTimePicker value={hotelForm.check_in} onChange={v => setHotelForm(f => ({ ...f, check_in: v }))} placeholder="14:00" />
                    </div>
                    <div className="!flex-[1] !min-w-[80px]">
                      <label className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.04em] !block !mb-[3px]">{t('day.checkInUntil')}</label>
                      <CustomTimePicker value={hotelForm.check_in_end} onChange={v => setHotelForm(f => ({ ...f, check_in_end: v }))} placeholder="22:00" />
                    </div>
                    <div className="!flex-[1] !min-w-[80px]">
                      <label className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.04em] !block !mb-[3px]">{t('day.checkOut')}</label>
                      <CustomTimePicker value={hotelForm.check_out} onChange={v => setHotelForm(f => ({ ...f, check_out: v }))} placeholder="11:00" />
                    </div>
                    <div className="!flex-[2] !min-w-[120px]">
                      <label className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.04em] !block !mb-[3px]">{t('day.confirmation')}</label>
                      <input className="!w-[100%] !p-[8px_10px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !text-[length:13px] ![font-family:inherit] !box-border !h-[38px]" type="text" value={hotelForm.confirmation} onChange={e => setHotelForm(f => ({ ...f, confirmation: e.target.value }))}
                        placeholder="ABC-12345" />
                    </div>
                  </div>

                  {/* Category Filter */}
                  {categories.length > 0 && (
                    <div className="!p-[8px_18px] ![border-bottom:1px_solid_var(--border-faint)] !flex !gap-[4px] !flex-wrap">
                      <button className="!p-[3px_10px] !rounded-[6px] ![border:none] !text-[length:10px] !font-[600] !cursor-pointer" onClick={() => setHotelCategoryFilter('')} style={{ background: !hotelCategoryFilter ? 'var(--text-primary)' : 'var(--bg-secondary)', color: !hotelCategoryFilter ? 'var(--bg-card)' : 'var(--text-muted)' }}>{t('day.allDays')}</button>

                      {categories.map(c => (
                        <button className="!p-[3px_10px] !rounded-[6px] ![border:none] !text-[length:10px] !font-[600] !cursor-pointer" key={c.id} onClick={() => setHotelCategoryFilter(c.id)} style={{ background: hotelCategoryFilter === c.id ? c.color || 'var(--text-primary)' : 'var(--bg-secondary)', color: hotelCategoryFilter === c.id ? '#fff' : 'var(--text-muted)' }}>{c.name}</button>
                      ))}
                    </div>
                  )}

                  {/* Place List */}
                  <div className="!max-h-[250px] !overflow-y-auto">
                    {(() => {
                      const filtered = hotelCategoryFilter ? places.filter(p => p.category_id === hotelCategoryFilter) : places
                      return filtered.length === 0 ? (
                        <div className="!p-[20px] !text-center !text-[length:12px] ![color:var(--text-faint)]">{t('day.noPlacesForHotel')}</div>
                      ) : filtered.map(p => (
                      <button className={[(hotelForm.place_id !== p.id) ? 'trek-hover' : undefined, '!flex !items-center !gap-[10px] !w-[100%] !p-[10px_18px] ![border:none] ![border-bottom:1px_solid_var(--border-faint)] !cursor-pointer ![font-family:inherit] !text-left ![transition:background_0.1s]'].join(' ')} key={p.id} onClick={() => handleSelectPlace(p.id)} style={{ background: hotelForm.place_id === p.id ? 'var(--bg-hover)' : 'none', outline: hotelForm.place_id === p.id ? '2px solid var(--accent)' : 'none', outlineOffset: -2, borderRadius: hotelForm.place_id === p.id ? 8 : 0 }} >
                        <div className="!w-[32px] !h-[32px] !rounded-[8px] ![background:var(--bg-secondary)] !flex !items-center !justify-center !shrink-[0]">
                          {p.image_url ? (
                            <img className="!w-[100%] !h-[100%] !rounded-[8px] !object-cover" src={p.image_url} />
                          ) : (
                            <MapPin size={13} style={{ color: 'var(--text-faint)' }} />
                          )}
                        </div>
                        <div className="!flex-[1] !min-w-[0]">
                          <div className="!text-[length:12px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{p.name}</div>
                          {p.address && <div className="!text-[length:10px] ![color:var(--text-faint)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{p.address}</div>}
                        </div>
                      </button>
                    ))
                    })()}
                  </div>

                {/* Save / Cancel */}
                <div className="!p-[12px_18px] ![border-top:1px_solid_var(--border-faint)] !flex !justify-end !gap-[8px]">
                  <button className="!p-[7px_16px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:12px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setShowHotelPicker(false)}>
                    {t('common.cancel')}
                  </button>
                  <button className="!p-[7px_20px] !rounded-[8px] ![border:none] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit]" onClick={async () => {
                    if (showHotelPicker === 'edit' && accommodation) {
                      // Update existing
                      await accommodationsApi.update(tripId, accommodation.id, {
                        place_id: hotelForm.place_id,
                        start_day_id: hotelDayRange.start,
                        end_day_id: hotelDayRange.end,
                        check_in: hotelForm.check_in || null,
                        check_in_end: hotelForm.check_in_end || null,
                        check_out: hotelForm.check_out || null,
                        confirmation: hotelForm.confirmation || null,
                      })
                      setShowHotelPicker(false)
                      setHotelForm({ check_in: '', check_in_end: '', check_out: '', confirmation: '', place_id: null })
                      // Reload
                      accommodationsApi.list(tripId).then(d => {
                        const all = d.accommodations || []
                        setAccommodations(all)
                        setDayAccommodations(all.filter(a =>
                          day ? isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, days) : false
                        ))
                        const acc = all.find(a => day ? isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, days) : false)
                        setAccommodation(acc || null)
                      })
                      onAccommodationChange?.()
                    } else {
                      await handleSaveAccommodation()
                    }
                  }} disabled={!hotelForm.place_id} style={{ background: hotelForm.place_id ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: hotelForm.place_id ? 'var(--bg-card)' : 'var(--text-faint)' }}>
                    {t('common.save')}
                  </button>
                </div>

                </div>
              </div>,
              document.body
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

interface ChipProps {
  icon: React.ElementType
  value: string
}

function Chip({ icon: Icon, value }: ChipProps) {
  return (
    <div className="!inline-flex !items-center !gap-[4px] !p-[4px_8px] !rounded-[8px] ![background:var(--bg-secondary)] !text-[length:11px] ![color:var(--text-muted)]">
      <Icon size={11} style={{ flexShrink: 0, opacity: 0.6 }} />
      <span className="!font-[500]">{value}</span>
    </div>
  )
}

interface InfoChipProps {
  icon: React.ElementType
  label: string
  value: string
  placeholder: string
  onEdit: (value: string) => void
  type: 'text' | 'time'
}

function InfoChip({ icon: Icon, label, value, placeholder, onEdit, type }: InfoChipProps) {
  const [editing, setEditing] = React.useState(false)
  const [val, setVal] = React.useState(value || '')
  const inputRef = React.useRef(null)

  React.useEffect(() => { setVal(value || '') }, [value])
  React.useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  const save = () => {
    setEditing(false)
    if (val !== (value || '')) onEdit(val)
  }

  return (
    <div className="!flex !items-center !gap-[5px] !p-[5px_9px] !rounded-[8px] ![background:var(--bg-card)] ![border:1px_solid_var(--border-faint)] !cursor-pointer !min-w-[0]"
      onClick={() => setEditing(true)}
      style={{ flex: type === 'text' ? 1 : undefined }}
    >
      <Icon size={11} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      <div className="!min-w-[0]">
        <div className="!text-[length:8px] ![color:var(--text-faint)] !font-[600] !uppercase !tracking-[0.04em] !leading-[1]">{label}</div>
        {editing ? (
          <input
            ref={inputRef}
            type={type}
            value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={save}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(value || ''); setEditing(false) } }}
            onClick={e => e.stopPropagation()}
            style={{
              border: 'none', outline: 'none', background: 'none', padding: 0, margin: 0,
              fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'inherit',
              width: type === 'time' ? 50 : '100%', lineHeight: 1.3,
            }}
          />
        ) : (
          <div className="!text-[length:11px] !font-[600] !leading-[1.3] !overflow-hidden !text-ellipsis !whitespace-nowrap" style={{ color: value ? 'var(--text-primary)' : 'var(--text-faint)' }}>
            {value || placeholder}
          </div>
        )}
      </div>
    </div>
  )
}
