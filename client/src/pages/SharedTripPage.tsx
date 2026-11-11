import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useTranslation, SUPPORTED_LANGUAGES } from '../i18n'
import { useSettingsStore } from '../store/settingsStore'
import { getLocaleForLanguage } from '../i18n'
import { shareApi } from '../api/client'
import { getCategoryIcon } from '../components/shared/categoryIcons'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Clock, MapPin, FileText, Train, Plane, Bus, Car, Ship, Ticket, Hotel, Map, Luggage, Wallet, MessageCircle } from 'lucide-react'
import { isDayInAccommodationRange } from '../utils/dayOrder'
import { getTransportForDay, getMergedItems } from '../utils/dayMerge'
import { splitReservationDateTime } from '../utils/formatters'

const TRANSPORT_ICONS = { flight: Plane, train: Train, bus: Bus, car: Car, cruise: Ship }

function createMarkerIcon(place: any) {
  const cat = place.category
  const color = cat?.color || '#6366f1'
  const CatIcon = getCategoryIcon(cat?.icon)
  const iconSvg = renderToStaticMarkup(createElement(CatIcon, { size: 14, strokeWidth: 2, color: 'white' }))
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white;">${iconSvg}</div>`,
  })
}

function FitBoundsToPlaces({ places }: { places: any[] }) {
  const map = useMap()
  useEffect(() => {
    if (places.length === 0) return
    const bounds = L.latLngBounds(places.map(p => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }, [places, map])
  return null
}

export default function SharedTripPage() {
  const { token } = useParams<{ token: string }>()
  const { t, locale } = useTranslation()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState('plan')
  const [showLangPicker, setShowLangPicker] = useState(false)

  useEffect(() => {
    if (!token) return
    shareApi.getSharedTrip(token).then(setData).catch(() => setError(true))
  }, [token])

  if (error) return (
    <div className="!flex !items-center !justify-center !min-h-[100vh] ![background:#f3f4f6]">
      <div className="!text-center !p-[40px]">
        <div className="!text-[length:48px] !mb-[16px]">🔒</div>
        <h1 className="!text-[length:20px] !font-[700] ![color:#111827]">{t('shared.expired')}</h1>
        <p className="![color:#6b7280] !mt-[8px]">{t('shared.expiredHint')}</p>
      </div>
    </div>
  )

  if (!data) return (
    <div className="!flex !items-center !justify-center !min-h-[100vh] ![background:#f3f4f6]">
      <div className="!w-[32px] !h-[32px] ![border:3px_solid_#e5e7eb] [&&]:![border-top-color:#111827] !rounded-[50%]" style={{ animation: 'spin 0.6s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const { trip, days, assignments, dayNotes, places, reservations, accommodations, packing, budget, categories, permissions, collab } = data
  const sortedDays = [...(days || [])].sort((a: any, b: any) => a.day_number - b.day_number)

  // Map places
  const mapPlaces = selectedDay
    ? (assignments[String(selectedDay)] || []).map((a: any) => a.place).filter((p: any) => p?.lat && p?.lng)
    : (places || []).filter((p: any) => p?.lat && p?.lng)

  const center = mapPlaces.length > 0 ? [mapPlaces[0].lat, mapPlaces[0].lng] : [48.85, 2.35]

  return (
    <div className="page-bg !min-h-[100vh] ![background:var(--bg-secondary)]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>
      {/* Header */}
      <div className="![background:linear-gradient(135deg,_#000_0%,_#0f172a_50%,_#1e293b_100%)] ![color:white] !p-[32px_20px_28px] !text-center !relative">
        {/* Cover image background */}
        {trip.cover_image && (
          <div className="!absolute !inset-[0]" style={{ backgroundImage: `url(${trip.cover_image.startsWith('http') ? trip.cover_image : trip.cover_image.startsWith('/') ? trip.cover_image : '/uploads/' + trip.cover_image})`, backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.15 }} />
        )}
        {/* Background decoration */}
        <div className="!absolute !top-[-60px] !right-[-60px] !w-[200px] !h-[200px] !rounded-[50%] ![background:rgba(255,255,255,0.03)]" />
        <div className="!absolute !bottom-[-40px] !left-[-40px] !w-[150px] !h-[150px] !rounded-[50%] ![background:rgba(255,255,255,0.02)]" />

        {/* Logo */}
        <div className="!inline-flex !items-center !justify-center !w-[44px] !h-[44px] !rounded-[12px] ![background:rgba(255,255,255,0.08)] ![backdrop-filter:blur(8px)] !mb-[12px] ![border:1px_solid_rgba(255,255,255,0.1)]">
          <img src="/icons/icon-white.svg" alt="Trek Wanderer" width="26" height="26" />
        </div>

        <div className="!text-[length:10px] !font-[600] !tracking-[3px] !uppercase !mb-[12px]" style={{ opacity: 0.35 }}>Travel Resource & Exploration Kit</div>

        <h1 className="!m-[0_0_4px] !text-[length:26px] !font-[700] !tracking-[-0.5px]">{trip.title}</h1>

        {trip.description && (
          <div className="!text-[length:13px] !max-w-[400px] !m-[0_auto] !leading-[1.5]" style={{ opacity: 0.5 }}>{trip.description}</div>
        )}

        {(trip.start_date || trip.end_date) && (
          <div className="!mt-[10px] !inline-flex !items-center !gap-[8px] !p-[6px_14px] !rounded-[20px] ![background:rgba(255,255,255,0.08)] ![backdrop-filter:blur(4px)] ![border:1px_solid_rgba(255,255,255,0.08)]">
            <span className="!text-[length:12px] !font-[500]" style={{ opacity: 0.8 }}>
              {[trip.start_date, trip.end_date].filter(Boolean).map((d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })).join(' — ')}
            </span>
            {days?.length > 0 && <span className="!text-[length:11px]" style={{ opacity: 0.4 }}>·</span>}
            {days?.length > 0 && <span className="!text-[length:11px]" style={{ opacity: 0.5 }}>{days.length} {t('shared.days')}</span>}
          </div>
        )}

        <div className="!mt-[12px] !text-[length:9px] !font-[500] !tracking-[1.5px] !uppercase" style={{ opacity: 0.25 }}>{t('shared.readOnly')}</div>

        {/* Language picker - top right */}
        <div className="!absolute !top-[12px] !right-[12px] !z-[10]">
          <button className="!p-[5px_12px] !rounded-[20px] ![border:1px_solid_rgba(255,255,255,0.15)] ![background:rgba(255,255,255,0.1)] ![backdrop-filter:blur(8px)] ![color:rgba(255,255,255,0.7)] !text-[length:11px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={() => setShowLangPicker(v => !v)}>
            {SUPPORTED_LANGUAGES.find(l => l.value === (locale?.split('-')[0] || 'en'))?.label || 'Language'}
          </button>
          {showLangPicker && (
            <div className="!absolute !top-[100%] !right-[0] !mt-[6px] ![background:white] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.2)] !p-[4px] !z-[50] !min-w-[150px]">
              {SUPPORTED_LANGUAGES.map(lang => (
                <button className="trek-hover-gray !block !w-[100%] !p-[6px_12px] ![border:none] ![background:none] !text-left !cursor-pointer !text-[length:12px] ![color:#374151] !rounded-[6px] ![font-family:inherit]" key={lang.value} onClick={() => {
                  // Set language locally without API call (shared page has no auth)
                  useSettingsStore.setState(s => ({ settings: { ...s.settings, language: lang.value } }))
                  setShowLangPicker(false)
                }} >{lang.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="!max-w-[900px] !m-[0_auto] !p-[20px_16px]">
        {/* Tabs */}
        <div className="!flex !gap-[6px] !mb-[20px] !overflow-x-auto !p-[2px_0]">
          {[
            { id: 'plan', label: t('shared.tabPlan'), Icon: Map },
            ...(permissions?.share_bookings ? [{ id: 'bookings', label: t('shared.tabBookings'), Icon: Ticket }] : []),
            ...(permissions?.share_packing ? [{ id: 'packing', label: t('shared.tabPacking'), Icon: Luggage }] : []),
            ...(permissions?.share_budget ? [{ id: 'budget', label: t('shared.tabBudget'), Icon: Wallet }] : []),
            ...(permissions?.share_collab ? [{ id: 'collab', label: t('shared.tabChat'), Icon: MessageCircle }] : []),
          ].map(tab => (
            <button className={['!p-[8px_18px] !rounded-[12px] !cursor-pointer !text-[length:12px] !font-[600] ![font-family:inherit] ![transition:all_0.15s] !whitespace-nowrap !flex !items-center !gap-[6px]', (activeTab === tab.id) ? '![background:var(--accent)]' : '![background:var(--glass-bg)]', (activeTab === tab.id) ? '![backdrop-filter:none]' : '![backdrop-filter:var(--glass-blur)]', (activeTab === tab.id) ? '![-webkit-backdrop-filter:none]' : '![-webkit-backdrop-filter:var(--glass-blur)]', (activeTab === tab.id) ? '[&&]:![border-color:var(--accent)]' : '[&&]:![border-color:var(--glass-border)]', (activeTab === tab.id) ? '![color:var(--accent-text)]' : '![color:var(--text-muted)]', (activeTab === tab.id) ? '![box-shadow:0_4px_14px_rgba(0,0,0,0.20)]' : '![box-shadow:var(--glass-shadow)]', '![border:1.5px_solid]'].join(' ')} key={tab.id} onClick={() => setActiveTab(tab.id)}><tab.Icon size={13} /><span className="hidden sm:inline">{tab.label}</span></button>
          ))}
        </div>

        {/* Map */}
        {activeTab === 'plan' && (<>
        <div className="!rounded-[16px] !overflow-hidden !h-[300px] !mb-[20px] ![box-shadow:0_2px_12px_rgba(0,0,0,0.08)]">
          <MapContainer center={center as [number, number]} zoom={11} zoomControl={false} style={{ width: '100%', height: '100%' }}>
            {/* CARTO's basemaps.cartocdn.com now refuses anonymous requests (an "API KEY REQUIRED" watermark since Aug 2026) — this public page has no admin-configured key to use, so it falls back to plain OSM tiles. */}
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" referrerPolicy="strict-origin-when-cross-origin" />
            <FitBoundsToPlaces places={mapPlaces} />
            {mapPlaces.map((p: any) => (
              <Marker key={p.id} position={[p.lat, p.lng]} icon={createMarkerIcon(p)}>
                <Tooltip>{p.name}</Tooltip>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Day Plan */}
        <div className="!flex !flex-col !gap-[12px]">
          {sortedDays.map((day: any, di: number) => {
            const da = assignments[String(day.id)] || []
            const notes = (dayNotes[String(day.id)] || [])
            const dayAssignmentIds: number[] = da.map((a: any) => a.id)
            const dayTransport = getTransportForDay({ reservations: reservations || [], dayId: day.id, dayAssignmentIds, days: sortedDays })
            const dayAccs = (accommodations || []).filter((a: any) => isDayInAccommodationRange(day, a.start_day_id, a.end_day_id, sortedDays))

            const merged = getMergedItems({
              dayAssignments: da,
              dayNotes: notes,
              dayTransports: dayTransport,
              dayId: day.id,
            })

            return (
              <div className="![background:var(--glass-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] !rounded-[14px] !overflow-hidden ![border:1px_solid_var(--glass-border)]" key={day.id}>
                <div className="!p-[12px_16px] !cursor-pointer !flex !items-center !gap-[10px]" onClick={() => setSelectedDay(selectedDay === day.id ? null : day.id)}>
                  <div className="!w-[28px] !h-[28px] !rounded-[50%] !flex !items-center !justify-center !text-[length:12px] !font-[700] !shrink-[0]" style={{ background: selectedDay === day.id ? '#111827' : '#f3f4f6', color: selectedDay === day.id ? 'white' : '#6b7280' }}>{di + 1}</div>
                  <div className="!flex-[1]">
                    <div className="!text-[length:14px] !font-[600] ![color:#111827]">{day.title || `Day ${day.day_number}`}</div>
                    {day.date && <div className="!text-[length:11px] ![color:#9ca3af] !mt-[1px]">{new Date(day.date + 'T00:00:00Z').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>}
                  </div>
                  {dayAccs.map((acc: any) => (
                    <span className="!text-[length:9px] !p-[2px_6px] !rounded-[4px] ![background:#f3f4f6] ![color:#6b7280] !flex !items-center !gap-[3px]" key={acc.id}>
                      <Hotel size={8} /> {acc.place_name}
                    </span>
                  ))}
                  <span className="!text-[length:11px] ![color:#9ca3af]">{da.length} {t('shared.places')}</span>
                </div>

                {selectedDay === day.id && merged.length > 0 && (
                  <div className="!p-[0_16px_12px] !flex !flex-col !gap-[6px]">
                    {merged.map((item: any) => {
                      if (item.type === 'transport') {
                        const r = item.data
                        const TIcon = TRANSPORT_ICONS[r.type] || Ticket
                        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {})
                        const time = splitReservationDateTime(r.reservation_time).time ?? ''
                        let sub = ''
                        if (r.type === 'flight') sub = [meta.airline, meta.flight_number, meta.departure_airport && meta.arrival_airport ? `${meta.departure_airport} → ${meta.arrival_airport}` : ''].filter(Boolean).join(' · ')
                        else if (r.type === 'train') sub = [meta.train_number, meta.platform ? `Gl. ${meta.platform}` : ''].filter(Boolean).join(' · ')
                        return (
                          <div className="!flex !items-center !gap-[8px] !p-[6px_8px] !rounded-[6px] ![background:rgba(59,130,246,0.06)] ![border:1px_solid_rgba(59,130,246,0.15)]" key={`t-${r.id}`}>
                            <div className="!w-[24px] !h-[24px] !rounded-[50%] ![background:rgba(59,130,246,0.12)] !flex !items-center !justify-center !shrink-[0]">
                              <TIcon size={12} color="#3b82f6" />
                            </div>
                            <div className="!flex-[1] !min-w-[0]">
                              <div className="!text-[length:12px] !font-[500] ![color:#111827]">{r.title}{time ? ` · ${time}` : ''}</div>
                              {sub && <div className="!text-[length:10px] ![color:#6b7280]">{sub}</div>}
                            </div>
                          </div>
                        )
                      }
                      if (item.type === 'note') {
                        return (
                          <div className="!flex !items-center !gap-[8px] !p-[5px_8px] !rounded-[6px] ![background:#f9fafb] ![border:1px_solid_#f3f4f6]" key={`n-${item.data.id}`}>
                            <FileText size={12} color="#9ca3af" />
                            <div>
                              <div className="!text-[length:12px] ![color:#374151]">{item.data.text}</div>
                              {item.data.time && <div className="!text-[length:10px] ![color:#9ca3af]">{item.data.time}</div>}
                            </div>
                          </div>
                        )
                      }
                      const place = item.data.place
                      if (!place) return null
                      const cat = categories?.find((c: any) => c.id === place.category_id)
                      return (
                        <div className="!flex !items-center !gap-[10px] !p-[6px_8px] !rounded-[6px]" key={`p-${item.data.id}`}>
                          <div className="!w-[28px] !h-[28px] !rounded-[50%] !flex !items-center !justify-center !shrink-[0]" style={{ background: cat?.color || '#6366f1' }}>
                            {place.image_url ? <img className="!w-[28px] !h-[28px] !rounded-[50%] !object-cover" src={place.image_url} /> : <MapPin size={13} color="white" />}
                          </div>
                          <div className="!flex-[1] !min-w-[0]">
                            <div className="!text-[length:12.5px] !font-[500] ![color:#111827]">{place.name}</div>
                            {(place.address || place.description) && <div className="!text-[length:10px] ![color:#9ca3af] !overflow-hidden !text-ellipsis !whitespace-nowrap">{place.address || place.description}</div>}
                          </div>
                          {place.place_time && <span className="!text-[length:10px] ![color:#6b7280] !flex !items-center !gap-[3px] !shrink-[0]"><Clock size={9} />{place.place_time}{place.end_time ? ` – ${place.end_time}` : ''}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </>)}

        {/* Bookings */}
        {activeTab === 'bookings' && (reservations || []).length > 0 && (
          <div className="!flex !flex-col !gap-[8px]">
            {(reservations || []).map((r: any) => {
              const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata || '{}') : (r.metadata || {})
              const TIcon = TRANSPORT_ICONS[r.type] || Ticket
              const { date: rDate, time: rTime } = splitReservationDateTime(r.reservation_time)
              const time = rTime ?? ''
              const date = rDate ? new Date(rDate + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''
              return (
                <div className="![background:var(--glass-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] !rounded-[10px] !p-[12px_16px] ![border:1px_solid_var(--glass-border)] !flex !items-center !gap-[12px]" key={r.id}>
                  <div className="!w-[32px] !h-[32px] !rounded-[50%] ![background:#f3f4f6] !flex !items-center !justify-center !shrink-[0]">
                    <TIcon size={15} color="#6b7280" />
                  </div>
                  <div className="!flex-[1] !min-w-[0]">
                    <div className="!text-[length:13px] !font-[600] ![color:#111827]">{r.title}</div>
                    <div className="!text-[length:11px] ![color:#9ca3af] !flex !gap-[8px] !flex-wrap !mt-[2px]">
                      {date && <span>{date}</span>}
                      {time && <span>{time}</span>}
                      {r.location && <span>{r.location}</span>}
                      {meta.airline && <span>{meta.airline} {meta.flight_number || ''}</span>}
                      {meta.train_number && <span>{meta.train_number}</span>}
                    </div>
                  </div>
                  <span className="!text-[length:10px] !p-[2px_8px] !rounded-[20px] !font-[600]" style={{ background: r.status === 'confirmed' ? 'rgba(22,163,74,0.1)' : 'rgba(217,119,6,0.1)', color: r.status === 'confirmed' ? '#16a34a' : '#d97706' }}>
                    {r.status === 'confirmed' ? t('shared.confirmed') : t('shared.pending')}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Packing */}
        {activeTab === 'packing' && (packing || []).length > 0 && (
          <div className="![background:var(--glass-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] !rounded-[14px] ![border:1px_solid_var(--glass-border)] !overflow-hidden">
            {Object.entries((packing || []).reduce((g: any, i: any) => { const c = i.category || t('shared.other'); (g[c] = g[c] || []).push(i); return g }, {})).map(([cat, items]: [string, any]) => (
              <div key={cat}>
                <div className="!p-[8px_16px] ![background:#f9fafb] !text-[length:11px] !font-[700] ![color:#6b7280] !uppercase !tracking-[0.05em] ![border-bottom:1px_solid_#f3f4f6]">{cat}</div>
                {items.map((item: any) => (
                  <div className="!p-[6px_16px] !flex !items-center !gap-[8px] ![border-bottom:1px_solid_#f9fafb]" key={item.id}>
                    <span className="!text-[length:13px]" style={{ color: item.checked ? '#9ca3af' : '#111827', textDecoration: item.checked ? 'line-through' : 'none' }}>{item.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Budget */}
        {activeTab === 'budget' && (budget || []).length > 0 && (() => {
          const grouped = (budget || []).reduce((g: any, i: any) => { const c = i.category || t('shared.other'); (g[c] = g[c] || []).push(i); return g }, {})
          const total = (budget || []).reduce((s: number, i: any) => s + (parseFloat(i.total_price) || 0), 0)
          return (
            <div className="!flex !flex-col !gap-[12px]">
              {/* Total card */}
              <div className="![background:linear-gradient(135deg,_#000_0%,_#1a1a2e_100%)] !rounded-[14px] !p-[20px_24px] ![color:white]">
                <div className="!text-[length:10px] !font-[500] !tracking-[1px] !uppercase" style={{ opacity: 0.5 }}>{t('shared.totalBudget')}</div>
                <div className="!text-[length:28px] !font-[700] !mt-[4px]">{total.toLocaleString(locale, { minimumFractionDigits: 2 })} {trip.currency || 'EUR'}</div>
              </div>
              {/* By category */}
              {Object.entries(grouped).map(([cat, items]: [string, any]) => (
                <div className="![background:var(--glass-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] !rounded-[12px] ![border:1px_solid_var(--glass-border)] !overflow-hidden" key={cat}>
                  <div className="!p-[10px_16px] ![background:#f9fafb] !flex !justify-between !items-center ![border-bottom:1px_solid_#f3f4f6]">
                    <span className="!text-[length:12px] !font-[700] ![color:#374151]">{cat}</span>
                    <span className="!text-[length:12px] !font-[600] ![color:#6b7280]">{items.reduce((s: number, i: any) => s + (parseFloat(i.total_price) || 0), 0).toLocaleString(locale, { minimumFractionDigits: 2 })} {trip.currency || ''}</span>
                  </div>
                  {items.map((item: any) => (
                    <div className="!p-[8px_16px] !flex !justify-between !items-center ![border-bottom:1px_solid_#fafafa]" key={item.id}>
                      <span className="!text-[length:13px] ![color:#111827]">{item.name}</span>
                      <span className="!text-[length:13px] !font-[600] ![color:#111827]">{item.total_price ? Number(item.total_price).toLocaleString(locale, { minimumFractionDigits: 2 }) : '—'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        })()}

        {/* Collab Chat */}
        {activeTab === 'collab' && (collab || []).length > 0 && (
          <div className="![background:var(--glass-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] !rounded-[14px] ![border:1px_solid_var(--glass-border)] !overflow-hidden">
            <div className="!p-[12px_16px] ![border-bottom:1px_solid_var(--glass-border-inner)] !flex !items-center !gap-[8px]">
              <MessageCircle size={14} color="#6b7280" />
              <span className="!text-[length:12px] !font-[700] ![color:#374151]">{t('shared.tabChat')} · {(collab || []).length} {t('shared.messages')}</span>
            </div>
            <div className="!max-h-[500px] !overflow-y-auto !p-[12px_16px] !flex !flex-col !gap-[10px]">
              {(collab || []).map((msg: any, i: number) => {
                const prevMsg = i > 0 ? collab[i - 1] : null
                const showDate = !prevMsg || new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString()
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="!text-center !m-[8px_0] !text-[length:10px] !font-[600] ![color:#9ca3af]">
                        {new Date(msg.created_at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                      </div>
                    )}
                    <div className="!flex !gap-[10px]">
                      <div className="!w-[32px] !h-[32px] !rounded-[50%] ![background:#e5e7eb] !flex !items-center !justify-center !text-[length:11px] !font-[700] ![color:#6b7280] !shrink-[0] !overflow-hidden">
                        {msg.avatar ? <img className="!w-[100%] !h-[100%] !object-cover" src={`/uploads/avatars/${msg.avatar}`} /> : (msg.username || '?')[0].toUpperCase()}
                      </div>
                      <div className="!flex-[1]">
                        <div className="!flex !items-baseline !gap-[6px]">
                          <span className="!text-[length:12px] !font-[600] ![color:#111827]">{msg.username}</span>
                          <span className="!text-[length:10px] ![color:#9ca3af]">{new Date(msg.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="!text-[length:13px] ![color:#374151] !mt-[3px] !leading-[1.5] !whitespace-pre-wrap">{msg.text}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="!text-center !p-[40px_0_20px]">
          <div className="!inline-flex !items-center !gap-[8px] !p-[8px_16px] !rounded-[20px] ![background:var(--bg-card,_white)] ![border:1px_solid_var(--border-faint,_#e5e7eb)] ![box-shadow:0_1px_3px_rgba(0,0,0,0.04)]">
            <img className="!rounded-[4px]" src="/icons/icon-dark.svg" alt="Trek Wanderer" width="18" height="18" />
            <span className="!text-[length:11px] ![color:#9ca3af]">{t('shared.sharedVia')} <strong className="![color:#6b7280]">Trek Wanderer</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
