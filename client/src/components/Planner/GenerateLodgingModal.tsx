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
    <div className="!fixed !inset-[0] !z-[99999] ![background:rgba(0,0,0,0.4)] ![backdrop-filter:blur(4px)] !flex !items-center !justify-center !p-[16px]" role="dialog" aria-modal="true" aria-label={t('lodging.generate.title')}
      onClick={onClose}>
      <div className="!w-[100%] !max-w-[520px] !max-h-[90vh] !flex !flex-col !rounded-[16px] ![background:var(--bg-card)] ![box-shadow:0_20px_60px_rgba(0,0,0,0.25)]" onClick={e => e.stopPropagation()}>
        <div className="!flex !items-center !gap-[8px] !p-[16px_18px_8px]">
          <Hotel size={18} style={{ color: 'var(--text-primary)' }} />
          <div className="!flex-[1] !text-[length:15px] !font-[800] ![color:var(--text-primary)]">{t('lodging.generate.title')}</div>
          <button className="!p-[6px] ![border:none] ![background:transparent]" type="button" aria-label={t('common.close')} onClick={onClose} style={{ ...btn }}><X size={18} /></button>
        </div>
        <div className="!p-[0_18px_10px] !text-[length:12px] ![color:var(--text-muted)]">{t('lodging.generate.intro')}</div>

        <div className="!overflow-y-auto !p-[0_18px] !flex-[1]">
          {rows.length === 0 || !rows.some(selectable) ? (
            <div className="!text-[length:13px] ![color:var(--text-muted)] !p-[12px_0]">{t('lodging.generate.none')}</div>
          ) : rows.map(r => (
            <label className="!flex !items-center !gap-[10px] !p-[8px_0] ![border-bottom:1px_solid_var(--border-faint)]" key={r.day.id} style={{ opacity: selectable(r) ? 1 : 0.5, cursor: selectable(r) ? 'pointer' : 'default' }}>
              <input type="checkbox" disabled={!selectable(r)} checked={selectable(r) && checked.has(r.day.id)} onChange={() => toggle(r.day.id)}
                aria-label={`${t('lodging.generate.day', { n: r.day.day_number })} ${r.loc?.name ?? ''}`} />
              <div className="!flex-[1] !min-w-[0]">
                <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary)]">
                  {t('lodging.generate.day', { n: r.day.day_number })}{r.day.date ? ` · ${dateLabel(r.day.date)}` : ''}
                </div>
                <div className="!text-[length:12px] ![color:var(--text-muted)]">
                  {r.loc ? r.loc.search : t('lodging.generate.noLocality')}
                  {r.covered ? ` · ${t('lodging.generate.covered')}` : r.last ? ` · ${t('lodging.generate.lastDay')}` : ''}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="!flex !gap-[8px] !justify-end !p-[16px]">
          <button type="button" style={btn} onClick={onClose}>{t('common.cancel')}</button>
          <button className="![background:var(--accent,_#e85d24)] ![border-color:transparent] ![color:#fff]" type="button" disabled={!count || busy}
            style={{ ...btn, opacity: count && !busy ? 1 : 0.5 }}
            onClick={create}>{busy ? t('lodging.generate.creating') : t('lodging.generate.create', { n: count })}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
