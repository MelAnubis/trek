import React, { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { Hotel, X, ExternalLink, MapPin, Link2, AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { useTripStore } from '../../store/tripStore'
import { useAddonStore } from '../../store/addonStore'
import { placesApi, mapsApi, tripsApi } from '../../api/client'
import type { Day } from '../../types'
import { bookingSearchUrl, googleMapsHotelsUrl, addDaysIso } from '../../utils/plannerRoute'
import { dayLocality, parseBookingUrl, nightsBetween, kmBetween } from '../../utils/lodgingLinks'

interface Props {
  day: Day
  days: Day[]
  tripId: number | string
  onClose: () => void
  /** Se llama cuando el alojamiento se ha creado (para recargar alojamientos, reservas y presupuesto). */
  onSaved?: () => void
}

const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-primary)',
  background: 'var(--bg-input, var(--bg-card))', color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
}
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', borderRadius: 8,
  border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none',
}

/**
 * Alojamiento de la noche de un día: abre Booking con la localidad final del día y sus fechas, y da de alta el hotel
 * elegido (lugar + alojamiento del día + reserva + gasto) con una sola operación, igual que la ventana de reservas.
 */
export default function DayLodgingModal({ day, days, tripId, onClose, onSaved }: Props) {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const addReservation = useTripStore(s => s.addReservation)
  const isBudgetEnabled = useAddonStore(s => s.isEnabled('budget'))

  const initial = useMemo(() => dayLocality(day), [day])
  const [locality, setLocality] = useState(initial?.search ?? '')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [nights, setNights] = useState(1)
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState<'pending' | 'confirmed'>('pending')
  const [confirmation, setConfirmation] = useState('')
  const [adults, setAdults] = useState(2)
  const [saving, setSaving] = useState(false)

  const idx = days.findIndex(d => d.id === day.id)
  const maxNights = Math.max(1, days.length - Math.max(0, idx))          // la estancia no puede salirse del viaje
  const checkin = day.date || ''
  const checkout = checkin ? addDaysIso(checkin, nights) : null
  const hasDates = !!checkin && !!checkout
  const parsed = useMemo(() => (url.trim() ? parseBookingUrl(url) : null), [url])

  // Viajeros: los del viaje (propietario + miembros). Si no se pueden leer se queda en 2.
  useEffect(() => {
    let alive = true
    tripsApi.getMembers(tripId).then((d: { members?: unknown[] }) => {
      const n = 1 + (Array.isArray(d?.members) ? d.members.length : 0)
      if (alive && n >= 1 && n < 30) setAdults(n)
    }).catch(() => { /* se queda en 2 */ })
    return () => { alive = false }
  }, [tripId])

  // Al pegar el enlace de un hotel de Booking: se propone el nombre y, si trae fechas, las noches.
  useEffect(() => {
    if (!parsed?.valid) return
    if (parsed.name && !name.trim()) setName(parsed.name)
    if (parsed.checkin && parsed.checkout && parsed.checkin === checkin) {
      const n = nightsBetween(parsed.checkin, parsed.checkout)
      if (n && n <= maxNights) setNights(n)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed?.valid, parsed?.name, parsed?.checkin, parsed?.checkout])

  const datesMismatch = !!(parsed?.valid && parsed.checkin && checkin && (parsed.checkin !== checkin || (checkout && parsed.checkout && parsed.checkout !== checkout)))

  const bookingHref = bookingSearchUrl(locality || initial?.name || '', locale, hasDates ? { checkin, checkout: checkout!, adults } : undefined)
  const lastPlace = [...(day.assignments ?? [])].sort((a, b) => b.order_index - a.order_index).find(a => a.place?.lat != null && a.place?.lng != null)?.place
  const mapsHref = googleMapsHotelsUrl(lastPlace?.lat ?? 0, lastPlace?.lng ?? 0)

  /** Lugar del hotel: se busca por nombre y localidad; si no sale nada cerca, se coloca en el centro de la población. */
  async function resolvePlace(): Promise<{ lat: number | null; lng: number | null; address: string; google_place_id?: string; osm_id?: string }> {
    const base = lastPlace?.lat != null && lastPlace?.lng != null ? { lat: lastPlace.lat as number, lng: lastPlace.lng as number } : null
    try {
      const res = await mapsApi.search(`${name.trim()}, ${locality}`, locale)
      const hit = (res?.places ?? []).find((p: { lat?: number; lng?: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
        && (!base || kmBetween(base, { lat: p.lat as number, lng: p.lng as number }) < 25))
      if (hit) return { lat: hit.lat, lng: hit.lng, address: hit.address || locality, google_place_id: hit.google_place_id, osm_id: hit.osm_id }
    } catch { /* sin resultados: se usa el centro de la población */ }
    return { lat: base?.lat ?? null, lng: base?.lng ?? null, address: locality }
  }

  const canSave = name.trim().length > 0 && !saving

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      const found = await resolvePlace()
      const website = parsed?.valid ? url.trim() : undefined
      const { place } = await placesApi.create(tripId, {
        name: name.trim(), address: found.address, lat: found.lat, lng: found.lng,
        ...(website ? { website } : {}),
        ...(found.google_place_id ? { google_place_id: found.google_place_id } : {}),
        ...(found.osm_id ? { osm_id: found.osm_id } : {}),
      })
      const endDay = days[Math.min(days.length - 1, Math.max(0, idx) + nights - 1)] ?? day
      const amount = parseFloat(price.replace(',', '.'))
      const metadata: Record<string, string> = {}
      if (isBudgetEnabled && amount > 0) metadata.price = String(amount)
      const data: Record<string, unknown> = {
        title: name.trim(), type: 'hotel', status,
        reservation_time: null, reservation_end_time: null,
        location: locality, confirmation_number: confirmation.trim() || null,
        notes: website ? `Booking: ${website}` : null,
        assignment_id: null, accommodation_id: null,
        metadata: Object.keys(metadata).length ? metadata : null,
        endpoints: [], needs_review: false,
        create_accommodation: {
          place_id: place.id, start_day_id: day.id, end_day_id: endDay.id,
          check_in: null, check_in_end: null, check_out: null, confirmation: confirmation.trim() || null,
        },
      }
      if (isBudgetEnabled) {
        data.create_budget_entry = amount > 0 ? { total_price: amount, category: t('reservations.type.hotel') } : { total_price: 0 }
      }
      await addReservation(tripId, data)
      toast.success(t('day.lodging.saved', { name: name.trim() }))
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error((err as Error)?.message || t('day.lodging.error'))
    } finally {
      setSaving(false)
    }
  }

  const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })

  return ReactDOM.createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('day.lodging.title')}
      style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', borderRadius: 16, background: 'var(--bg-card)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Hotel size={18} style={{ color: 'var(--text-primary)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{t('day.lodging.title')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {hasDates ? `${dateLabel(checkin)} → ${dateLabel(checkout!)} · ${t('day.lodging.nightsCount', { n: nights })}` : t('day.lodging.noDates')}
            </div>
          </div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} style={{ ...btn, padding: 6, border: 'none', background: 'transparent' }}><X size={18} /></button>
        </div>

        {/* 1. Buscar */}
        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor="lodging-locality">{t('day.lodging.locality')}</label>
          <input id="lodging-locality" style={input} value={locality} onChange={e => setLocality(e.target.value)} placeholder={t('day.lodging.localityPlaceholder')} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <a href={bookingHref} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: '#1d4ed8', borderColor: 'transparent', color: '#fff' }}>
              <ExternalLink size={14} />{t('day.lodging.searchBooking')}
            </a>
            {lastPlace && (
              <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={btn}><MapPin size={14} />{t('planner.stages.end.googleMaps')}</a>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('day.lodging.searchHint', { n: adults })}</div>
        </div>

        <div style={{ height: 1, background: 'var(--border-faint)', margin: '4px 0 14px' }} />

        {/* 2. Añadir el elegido */}
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={label} htmlFor="lodging-url"><Link2 size={11} style={{ verticalAlign: -1 }} /> {t('day.lodging.url')}</label>
            <input id="lodging-url" style={input} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.booking.com/hotel/es/…" />
            {url.trim() && parsed && !parsed.valid && <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>{t('day.lodging.urlNotBooking')}</div>}
            {datesMismatch && (
              <div style={{ fontSize: 11, color: '#b45309', marginTop: 4, display: 'flex', gap: 4 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                {t('day.lodging.datesMismatch', { from: dateLabel(parsed!.checkin!), to: parsed!.checkout ? dateLabel(parsed!.checkout) : '?' })}
              </div>
            )}
          </div>
          <div>
            <label style={label} htmlFor="lodging-name">{t('day.lodging.name')} *</label>
            <input id="lodging-name" style={input} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={label} htmlFor="lodging-nights">{t('day.lodging.nights')}</label>
              <input id="lodging-nights" style={input} type="number" min={1} max={maxNights} value={nights}
                onChange={e => setNights(Math.min(maxNights, Math.max(1, Math.round(Number(e.target.value) || 1))))} />
            </div>
            {isBudgetEnabled && (
              <div>
                <label style={label} htmlFor="lodging-price">{t('day.lodging.price')}</label>
                <input id="lodging-price" style={input} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="0,00" />
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={label} htmlFor="lodging-status">{t('day.lodging.status')}</label>
              <select id="lodging-status" style={input} value={status} onChange={e => setStatus(e.target.value as 'pending' | 'confirmed')}>
                <option value="pending">{t('day.lodging.status.pending')}</option>
                <option value="confirmed">{t('day.lodging.status.confirmed')}</option>
              </select>
            </div>
            <div>
              <label style={label} htmlFor="lodging-conf">{t('day.lodging.confirmation')}</label>
              <input id="lodging-conf" style={input} value={confirmation} onChange={e => setConfirmation(e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" style={btn} onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" disabled={!canSave}
            style={{ ...btn, background: 'var(--accent, #e85d24)', borderColor: 'transparent', color: '#fff', opacity: canSave ? 1 : 0.5 }}
            onClick={save}>{saving ? t('day.lodging.saving') : t('day.lodging.add')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
