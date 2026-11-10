import React from 'react'
import ReactDOM from 'react-dom'
import { useState, useRef, useEffect, useMemo } from 'react'
import { Plane, X, Check } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { airtrailApi } from '../../api/client'
import { useTripStore } from '../../store/tripStore'

interface AirtrailFlight {
  id: string
  fromCode: string | null
  fromName: string | null
  toCode: string | null
  toName: string | null
  date: string | null
  departure: string | null
  arrival: string | null
  airline: string | null
  flightNumber: string | null
  aircraft: string | null
  seatClass: string | null
}

interface AirtrailImportResult {
  imported: string[]
  skipped: Array<{
    flightId: string
    reason: 'already-imported' | 'already-in-trip' | 'invalid'
    detail?: string
  }>
}

interface AirTrailImportModalProps {
  isOpen: boolean
  onClose: () => void
  tripId: number | string
  pushUndo?: (label: string, undoFn: () => Promise<void> | void) => void
}

/** Locale-aware date (e.g. de → 13.06.2026, en-US → 06/13/2026). */
function fmtDate(d: string | null, locale: string): string {
  if (!d) return ''
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    })
  } catch {
    return d
  }
}

export default function AirTrailImportModal({ isOpen, onClose, tripId, pushUndo }: AirTrailImportModalProps) {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const trip = useTripStore(s => s.trip)
  const reservations = useTripStore(s => s.reservations)
  const loadReservations = useTripStore(s => s.loadReservations)
  const mouseDownTarget = useRef<EventTarget | null>(null)

  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [flights, setFlights] = useState<AirtrailFlight[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  // AirTrail flight ids already linked to a reservation in this trip.
  const importedIds = useMemo(() => {
    const set = new Set<string>()
    for (const r of reservations) {
      if ((r as any).external_source === 'airtrail' && (r as any).external_id) set.add(String((r as any).external_id))
    }
    return set
  }, [reservations])

  const inRange = (f: AirtrailFlight): boolean =>
    !!(f.date && trip?.start_date && trip?.end_date && f.date >= trip.start_date && f.date <= trip.end_date)

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setSelected(new Set())
    setLoading(true)
    airtrailApi
      .flights()
      .then((d: { flights: AirtrailFlight[] }) => {
        const list = d.flights ?? []
        setFlights(list)
        // Pre-select the flights that fall inside the trip and aren't imported yet.
        const pre = new Set<string>()
        for (const f of list) if (inRange(f) && !importedIds.has(f.id)) pre.add(f.id)
        setSelected(pre)
      })
      .catch((err: any) => setError(err?.response?.data?.error ?? t('reservations.airtrail.loadError')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const { during, others } = useMemo(() => {
    const during: AirtrailFlight[] = []
    const others: AirtrailFlight[] = []
    for (const f of flights) (inRange(f) ? during : others).push(f)
    const byDateDesc = (a: AirtrailFlight, b: AirtrailFlight) => (b.date ?? '').localeCompare(a.date ?? '')
    return { during: during.sort(byDateDesc), others: others.sort(byDateDesc) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flights, trip?.start_date, trip?.end_date])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleClose = () => { onClose() }

  const handleImport = async () => {
    const ids = [...selected].filter(id => !importedIds.has(id))
    if (ids.length === 0 || importing) return
    setImporting(true)
    setError('')
    try {
      const result: AirtrailImportResult = await airtrailApi.import(tripId, ids)
      await loadReservations(tripId)

      const imported = result.imported ?? []
      if (imported.length > 0) {
        pushUndo?.(t('reservations.airtrail.undo'), async () => {
          const linked = useTripStore.getState().reservations.filter(
            (r: any) => r.external_source === 'airtrail' && r.external_id && imported.includes(String(r.external_id)),
          )
          await Promise.all(linked.map((r: any) => import('../../api/client').then(({ default: api }) => api.delete(`/trips/${tripId}/reservations/${r.id}`).catch(() => {}))))
          await loadReservations(tripId)
        })
        toast.success(t('reservations.airtrail.imported', { count: imported.length }))
      }

      const skippedInTrip = (result.skipped ?? []).filter(s => s.reason === 'already-in-trip').length
      if (skippedInTrip > 0) toast.warning(t('reservations.airtrail.skippedDuplicate', { count: skippedInTrip }))
      if (imported.length === 0 && skippedInTrip === 0) toast.warning(t('reservations.airtrail.nothingImported'))

      handleClose()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('reservations.airtrail.importError'))
    } finally {
      setImporting(false)
    }
  }

  const selectableCount = [...selected].filter(id => !importedIds.has(id)).length

  if (!isOpen) return null

  const renderFlight = (f: AirtrailFlight) => {
    const already = importedIds.has(f.id)
    const isSelected = selected.has(f.id)
    const label = f.flightNumber ? `${f.airline ? `${f.airline} ` : ''}${f.flightNumber}` : `${f.fromCode ?? '?'} → ${f.toCode ?? '?'}`
    return (
      <button className="!w-[100%] !text-left !rounded-[10px] !p-[10px_12px] !mb-[8px] !flex !gap-[10px] !items-center ![font-family:inherit] ![transition:border-color_0.15s,_background_0.15s]"
        key={f.id}
        onClick={() => !already && toggle(f.id)}
        disabled={already}
        style={{ border: `1px solid ${isSelected && !already ? 'var(--accent)' : 'var(--border-primary)'}`, background: already ? 'var(--bg-tertiary)' : isSelected ? 'var(--bg-secondary)' : 'transparent', opacity: already ? 0.55 : 1, cursor: already ? 'default' : 'pointer' }}
      >
        <span className="!shrink-[0] !w-[18px] !h-[18px] !rounded-[5px] !flex !items-center !justify-center" style={{ border: `1.5px solid ${isSelected || already ? 'var(--accent)' : 'var(--border-primary)'}`, background: isSelected || already ? 'var(--accent)' : 'transparent' }}>
          {(isSelected || already) && <Check size={12} color="var(--accent-text)" strokeWidth={3} />}
        </span>
        <Plane size={15} color="#3b82f6" style={{ flexShrink: 0 }} />
        <span className="!flex-[1] !min-w-[0]">
          <span className="!block !text-[length:13px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{label}</span>
          <span className="!block !text-[length:11px] ![color:var(--text-muted)]">
            {f.fromCode ?? f.fromName ?? '?'} → {f.toCode ?? f.toName ?? '?'}{f.date ? ` · ${fmtDate(f.date, locale)}` : ''}
          </span>
        </span>
        {already && (
          <span className="!shrink-[0] !text-[length:10px] !font-[600] ![color:var(--text-faint)]">
            {t('reservations.airtrail.alreadyImported')}
          </span>
        )}
      </button>
    )
  }

  return ReactDOM.createPortal(
    <div className="!fixed !inset-[0] !z-[99999] !flex !items-center !justify-center !p-[16px] ![background:rgba(0,0,0,0.4)]"
      onMouseDown={e => { mouseDownTarget.current = e.target }}
      onClick={e => {
        if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) handleClose()
        mouseDownTarget.current = null
      }}
    >
      <div className="!rounded-[16px] !w-[100%] !max-w-[540px] !p-[24px] ![box-shadow:0_8px_32px_rgba(0,0,0,0.2)] ![font-family:var(--font-system)] !max-h-[90vh] !flex !flex-col ![background:var(--bg-card)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="!flex !items-center !gap-[8px] !mb-[14px]">
          <Plane size={16} color="#3b82f6" />
          <div className="!flex-[1] !text-[length:15px] !font-[700] ![color:var(--text-primary)]">
            {t('reservations.airtrail.title')}
          </div>
          <button className="![background:transparent] ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] !flex !items-center ![color:var(--text-faint)]" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        <div className="!flex-[1] !overflow-y-auto !min-h-[0]">
          {loading && (
            <div className="!text-[length:13px] !text-center !p-[24px_0] ![color:var(--text-faint)]">
              {t('common.loading')}
            </div>
          )}

          {!loading && flights.length === 0 && !error && (
            <div className="!text-[length:13px] !text-center !p-[24px_0] ![color:var(--text-faint)]">
              {t('reservations.airtrail.empty')}
            </div>
          )}

          {!loading && during.length > 0 && (
            <>
              <div className="!text-[length:12px] !font-[700] ![color:var(--text-primary)] !m-[2px_0_8px]">
                {t('reservations.airtrail.duringTrip')}
              </div>
              {during.map(renderFlight)}
            </>
          )}

          {!loading && others.length > 0 && (
            <>
              <div className="!text-[length:12px] !font-[700] ![color:var(--text-faint)]" style={{ margin: `${during.length > 0 ? 14 : 2}px 0 8px` }}>
                {t('reservations.airtrail.otherFlights')}
              </div>
              {others.map(renderFlight)}
            </>
          )}

          {error && (
            <div className="![border:1px_solid_rgba(239,68,68,0.35)] !rounded-[10px] !p-[8px_10px] !text-[length:12px] !whitespace-pre-wrap !mt-[8px] ![background:rgba(239,68,68,0.08)] ![color:#b91c1c]">
              {error}
            </div>
          )}
        </div>

        <div className="!flex !gap-[8px] !justify-end !mt-[14px] !pt-[14px] ![border-top:1px_solid_var(--border-faint)]">
          <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-primary)] !text-[length:13px] !font-[500] !cursor-pointer ![font-family:inherit]"
            onClick={handleClose}
          >
            {t('common.cancel')}
          </button>
          <button className="!p-[8px_16px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[500] ![font-family:inherit]"
            onClick={handleImport}
            disabled={selectableCount === 0 || importing}
            style={{ cursor: selectableCount > 0 && !importing ? 'pointer' : 'default', background: selectableCount > 0 && !importing ? 'var(--accent)' : 'var(--bg-tertiary)', color: selectableCount > 0 && !importing ? 'var(--accent-text)' : 'var(--text-faint)' }}
          >
            {importing ? t('common.loading') : t('reservations.airtrail.importCta', { count: selectableCount })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
