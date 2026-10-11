import React, { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { Hotel, X, ExternalLink, MapPin, Link2, AlertTriangle, Search, Check } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { useTripStore } from '../../store/tripStore'
import { useAddonStore } from '../../store/addonStore'
import { placesApi, mapsApi, tripsApi } from '../../api/client'
import type { Day, Reservation } from '../../types'
import { bookingSearchUrl, googleMapsHotelsUrl, addDaysIso } from '../../utils/plannerRoute'
import { dayLocality, parseBookingUrl, nightsBetween, kmBetween } from '../../utils/lodgingLinks'

type LodgingOption = Awaited<ReturnType<typeof mapsApi.lodgingNear>>['options'][number]
type LodgingMeta = Awaited<ReturnType<typeof mapsApi.lodgingNear>>['sources']

interface Props {
  day: Day
  days: Day[]
  tripId: number | string
  onClose: () => void
  /** Se llama cuando el alojamiento se ha guardado (para recargar alojamientos, reservas y presupuesto). */
  onSaved?: () => void
  /**
   * Reserva de alojamiento pendiente a la que se asigna el hotel elegido (se actualiza en vez de crear otra).
   * Sin ella se crea una reserva nueva.
   */
  reservation?: Reservation | null
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
const small: React.CSSProperties = { ...btn, padding: '4px 9px', fontSize: 11 }

const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`)

/**
 * Alojamiento de la noche de un día: busca opciones en la localidad final del día (OpenStreetMap y Google), abre Booking
 * con las fechas para ver precio y plazas, y da de alta el hotel elegido (lugar + alojamiento del día + reserva + gasto)
 * con una sola operación, igual que la ventana de reservas. Con `reservation` rellena esa reserva pendiente.
 */
export default function DayLodgingModal({ day, days, tripId, onClose, onSaved, reservation }: Props) {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const addReservation = useTripStore(s => s.addReservation)
  const updateReservation = useTripStore(s => s.updateReservation)
  const isBudgetEnabled = useAddonStore(s => s.isEnabled('budget'))

  const initial = useMemo(() => dayLocality(day), [day])
  const [locality, setLocality] = useState(initial?.search ?? reservation?.location ?? '')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [nights, setNights] = useState(1)
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState<'pending' | 'confirmed'>(reservation?.status ?? 'pending')
  const [confirmation, setConfirmation] = useState(reservation?.confirmation_number ?? '')
  const [adults, setAdults] = useState(2)
  const [saving, setSaving] = useState(false)

  // Opciones de la localidad
  const [optState, setOptState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [options, setOptions] = useState<LodgingOption[]>([])
  const [meta, setMeta] = useState<LodgingMeta | null>(null)
  const [selected, setSelected] = useState<LodgingOption | null>(null)
  const [optError, setOptError] = useState('')

  const idx = days.findIndex(d => d.id === day.id)
  const maxNights = Math.max(1, days.length - Math.max(0, idx))          // la estancia no puede salirse del viaje
  const checkin = day.date || ''
  const checkout = checkin ? addDaysIso(checkin, nights) : null
  const hasDates = !!checkin && !!checkout
  const parsed = useMemo(() => (url.trim() ? parseBookingUrl(url) : null), [url])
  const night = hasDates ? { checkin, checkout: checkout!, adults } : undefined

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

  const bookingHref = bookingSearchUrl(locality || initial?.name || '', locale, night)
  const lastPlace = [...(day.assignments ?? [])].sort((a, b) => b.order_index - a.order_index).find(a => a.place?.lat != null && a.place?.lng != null)?.place
  const mapsHref = googleMapsHotelsUrl(lastPlace?.lat ?? 0, lastPlace?.lng ?? 0)

  /** Centro de la búsqueda: el último lugar del día; si no tiene coordenadas, se geocodifica la localidad. */
  async function localityCenter(): Promise<{ lat: number; lng: number } | null> {
    if (lastPlace?.lat != null && lastPlace?.lng != null) return { lat: lastPlace.lat as number, lng: lastPlace.lng as number }
    try {
      const res = await mapsApi.search(locality, locale)
      const hit = (res?.places ?? []).find((p: { lat?: number; lng?: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      return hit ? { lat: hit.lat, lng: hit.lng } : null
    } catch { return null }
  }

  async function loadOptions() {
    setOptState('loading'); setOptError(''); setSelected(null)
    try {
      const c = await localityCenter()
      if (!c) { setOptState('error'); setOptError(t('day.lodging.options.noCenter')); return }
      const res = await mapsApi.lodgingNear(c.lat, c.lng, 2500)
      setOptions(res.options); setMeta(res.sources); setOptState('done')
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      setOptState('error'); setOptError(e.response?.data?.error || e.message || t('day.lodging.options.error'))
    }
  }

  function pick(o: LodgingOption) {
    setSelected(o)
    setName(o.name)
  }

  /** Lugar del hotel: el de la opción elegida; si no, se busca por nombre y localidad, o se coloca en el centro de la población. */
  async function resolvePlace(): Promise<{ lat: number | null; lng: number | null; address: string; google_place_id?: string; osm_id?: string }> {
    if (selected && selected.name === name.trim()) {
      return { lat: selected.lat, lng: selected.lng, address: locality, google_place_id: selected.google_place_id, osm_id: selected.osm_id }
    }
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
      const conf = confirmation.trim() || null
      const accommodation = {
        place_id: place.id, start_day_id: day.id, end_day_id: endDay.id,
        check_in: null, check_in_end: null, check_out: null, confirmation: conf,
      }
      const bookingNote = website ? `Booking: ${website}` : null

      if (reservation) {
        // Se rellena la reserva pendiente: hotel elegido, días de la estancia y, si hay precio, gasto.
        let metadata: Record<string, unknown> = {}
        try { metadata = typeof reservation.metadata === 'string' ? JSON.parse(reservation.metadata) : { ...(reservation.metadata ?? {}) } } catch { /* sin metadatos */ }
        if (isBudgetEnabled && amount > 0) metadata.price = String(amount)
        const data: Record<string, unknown> = {
          title: name.trim(), type: 'hotel', status,
          place_id: place.id, day_id: day.id, end_day_id: endDay.id,
          location: locality, confirmation_number: conf,
          notes: [reservation.notes, bookingNote].filter(Boolean).join('\n') || null,
          metadata: Object.keys(metadata).length ? metadata : null,
          create_accommodation: accommodation,
        }
        if (isBudgetEnabled && amount > 0) data.create_budget_entry = { total_price: amount, category: t('reservations.type.hotel') }
        await updateReservation(tripId, reservation.id, data as Partial<Reservation>)
        toast.success(t('day.lodging.updated', { name: name.trim() }))
      } else {
        const metadata: Record<string, string> = {}
        if (isBudgetEnabled && amount > 0) metadata.price = String(amount)
        const data: Record<string, unknown> = {
          title: name.trim(), type: 'hotel', status,
          reservation_time: null, reservation_end_time: null,
          location: locality, confirmation_number: conf, notes: bookingNote,
          assignment_id: null, accommodation_id: null,
          metadata: Object.keys(metadata).length ? metadata : null,
          endpoints: [], needs_review: false,
          create_accommodation: accommodation,
        }
        if (isBudgetEnabled) {
          data.create_budget_entry = amount > 0 ? { total_price: amount, category: t('reservations.type.hotel') } : { total_price: 0 }
        }
        await addReservation(tripId, data)
        toast.success(t('day.lodging.saved', { name: name.trim() }))
      }
      // La reserva puede haber creado un gasto: se refresca el presupuesto (el servidor solo avisa a los demás clientes).
      if (isBudgetEnabled) useTripStore.getState().loadBudgetItems?.(tripId)?.catch?.(() => {})
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error((err as Error)?.message || t('day.lodging.error'))
    } finally {
      setSaving(false)
    }
  }

  const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const sourceLabel = (s: 'osm' | 'google') => (s === 'google' ? t('day.lodging.options.srcGoogle') : t('day.lodging.options.srcOsm'))

  return ReactDOM.createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('day.lodging.title')}
      style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '92vh', overflowY: 'auto', borderRadius: 16, background: 'var(--bg-card)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: 18 }}>
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
            <button type="button" style={btn} disabled={optState === 'loading' || !locality.trim()} onClick={loadOptions}>
              <Search size={14} />{optState === 'loading' ? t('day.lodging.options.loading') : t('day.lodging.options.show', { place: initial?.name || locality })}
            </button>
            <a href={bookingHref} target="_blank" rel="noopener noreferrer" style={{ ...btn, background: '#1d4ed8', borderColor: 'transparent', color: '#fff' }}>
              <ExternalLink size={14} />{t('day.lodging.searchBooking')}
            </a>
            {lastPlace && (
              <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={btn}><MapPin size={14} />{t('planner.stages.end.googleMaps')}</a>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('day.lodging.searchHint', { n: adults })}</div>

          {/* Opciones de la localidad */}
          {optState === 'error' && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{optError}</div>}
          {optState === 'done' && (
            <div style={{ marginTop: 10 }}>
              {meta?.osm === 'failed' && <div style={{ fontSize: 11, color: '#b45309', marginBottom: 4 }}>{t('day.lodging.options.osmFailed', { reason: meta.errors[0] ?? '' })}</div>}
              {meta?.osm === 'partial' && <div style={{ fontSize: 11, color: '#b45309', marginBottom: 4 }}>{t('day.lodging.options.osmPartial')}</div>}
              {meta?.google === 'failed' && <div style={{ fontSize: 11, color: '#b45309', marginBottom: 4 }}>{t('day.lodging.options.googleFailed')}</div>}
              {meta?.google === 'no-key' && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{t('day.lodging.options.noKey')}</div>}
              {options.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('day.lodging.options.none')}</div>
              ) : (
                <div role="list" style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border-primary)', borderRadius: 10 }}>
                  {options.map(o => {
                    const active = selected?.id === o.id
                    return (
                      <div key={o.id} role="listitem" style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid var(--border-faint)',
                        background: active ? 'rgba(34,197,94,0.10)' : 'transparent',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {fmtDistance(o.distance_m)} · {o.sources.map(sourceLabel).join(' + ')}
                          </div>
                        </div>
                        <a href={bookingSearchUrl(`${o.name}, ${locality}`, locale, night)} target="_blank" rel="noopener noreferrer" style={{ ...small, color: '#1d4ed8' }}
                          aria-label={`Booking: ${o.name}`}>Booking</a>
                        <button type="button" style={{ ...small, ...(active ? { background: '#16a34a', color: '#fff', borderColor: 'transparent' } : {}) }}
                          onClick={() => pick(o)} aria-pressed={active} aria-label={`${t('day.lodging.options.pick')}: ${o.name}`}>
                          {active ? <Check size={12} /> : null}{active ? t('day.lodging.options.picked') : t('day.lodging.options.pick')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('day.lodging.options.priceNote')}</div>
            </div>
          )}
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
            onClick={save}>{saving ? t('day.lodging.saving') : reservation ? t('day.lodging.use') : t('day.lodging.add')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
