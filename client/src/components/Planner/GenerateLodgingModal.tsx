import React, { useMemo, useState } from 'react'
import ReactDOM from 'react-dom'
import { Hotel, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { useTripStore } from '../../store/tripStore'
import type { Day, Reservation, AssignmentsMap } from '../../types'
import { dayLocality, daysWithLodging } from '../../utils/lodgingLinks'

interface Props {
  tripId: number | string
  days: Day[]
  assignments: AssignmentsMap
  reservations: Reservation[]
  onClose: () => void
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
  border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}

/**
 * Crea una reserva de alojamiento PENDIENTE por noche, con la localidad final de cada día (la del último lugar de su
 * lista). Después, en cada reserva, «Buscar alojamiento» abre las opciones de esa localidad y se asigna el elegido.
 */
export default function GenerateLodgingModal({ tripId, days, assignments, reservations, onClose }: Props) {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const addReservation = useTripStore(s => s.addReservation)

  const rows = useMemo(() => {
    const sorted = [...days].sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0))
    const covered = daysWithLodging(reservations, sorted)
    return sorted.map((day, i) => ({
      day,
      loc: dayLocality({ title: day.title, assignments: assignments?.[String(day.id)] ?? day.assignments }),
      covered: covered.has(day.id),
      last: i === sorted.length - 1 && sorted.length > 1,       // la última noche suele no necesitar alojamiento
    }))
  }, [days, assignments, reservations])

  const selectable = (r: typeof rows[number]) => !!r.loc && !r.covered
  const [checked, setChecked] = useState<Set<number>>(() => new Set(rows.filter(r => selectable(r) && !r.last).map(r => r.day.id)))
  const [busy, setBusy] = useState(false)

  const toggle = (id: number) => setChecked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const count = rows.filter(r => selectable(r) && checked.has(r.day.id)).length

  const dateLabel = (iso: string | null | undefined) =>
    iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''

  async function create() {
    if (!count || busy) return
    setBusy(true)
    let ok = 0, failed = 0
    for (const r of rows) {
      if (!selectable(r) || !checked.has(r.day.id)) continue
      try {
        await addReservation(tripId, {
          title: t('lodging.pendingTitle', { place: r.loc!.name }),
          type: 'hotel', status: 'pending',
          day_id: r.day.id, end_day_id: r.day.id,
          location: r.loc!.search,
          reservation_time: null, reservation_end_time: null,
          confirmation_number: null, notes: null, assignment_id: null, accommodation_id: null,
          metadata: null, endpoints: [], needs_review: false,
        } as unknown as Partial<Reservation>)
        ok++
      } catch { failed++ }
    }
    setBusy(false)
    if (ok) toast.success(t('lodging.generate.done', { n: ok }))
    if (failed) toast.error(t('lodging.generate.error', { n: failed }))
    if (!failed) onClose()
  }

  return ReactDOM.createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('lodging.generate.title')}
      style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 16, background: 'var(--bg-card)', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 18px 8px' }}>
          <Hotel size={18} style={{ color: 'var(--text-primary)' }} />
          <div style={{ flex: 1, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{t('lodging.generate.title')}</div>
          <button type="button" aria-label={t('common.close')} onClick={onClose} style={{ ...btn, padding: 6, border: 'none', background: 'transparent' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '0 18px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{t('lodging.generate.intro')}</div>

        <div style={{ overflowY: 'auto', padding: '0 18px', flex: 1 }}>
          {rows.length === 0 || !rows.some(selectable) ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>{t('lodging.generate.none')}</div>
          ) : rows.map(r => (
            <label key={r.day.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-faint)',
              opacity: selectable(r) ? 1 : 0.5, cursor: selectable(r) ? 'pointer' : 'default',
            }}>
              <input type="checkbox" disabled={!selectable(r)} checked={selectable(r) && checked.has(r.day.id)} onChange={() => toggle(r.day.id)}
                aria-label={`${t('lodging.generate.day', { n: r.day.day_number })} ${r.loc?.name ?? ''}`} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {t('lodging.generate.day', { n: r.day.day_number })}{r.day.date ? ` · ${dateLabel(r.day.date)}` : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {r.loc ? r.loc.search : t('lodging.generate.noLocality')}
                  {r.covered ? ` · ${t('lodging.generate.covered')}` : r.last ? ` · ${t('lodging.generate.lastDay')}` : ''}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 16 }}>
          <button type="button" style={btn} onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" disabled={!count || busy}
            style={{ ...btn, background: 'var(--accent, #e85d24)', borderColor: 'transparent', color: '#fff', opacity: count && !busy ? 1 : 0.5 }}
            onClick={create}>{busy ? t('lodging.generate.creating') : t('lodging.generate.create', { n: count })}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
