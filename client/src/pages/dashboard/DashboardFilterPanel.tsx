import { useEffect } from 'react'
import { X, SlidersHorizontal, RotateCcw } from 'lucide-react'
import { useTranslation } from '../../i18n'
import CustomSelect from '../../components/shared/CustomSelect'
import { type TripFilters, type TripSortOption, countActiveTripFilters } from './dashboardModel'

/**
 * A separate filters panel, not an inline search bar — number of days,
 * name/description, place and sort order all live here, off the main
 * toolbar. Slides in from the right, same shell BikepackDrawer.tsx already
 * uses (backdrop + fixed panel), but on dashboard.css's own token set
 * since this only ever renders inside .trek-dash.
 */

interface Props {
  isOpen: boolean
  onClose: () => void
  filters: TripFilters
  onChange: (next: TripFilters) => void
}

export default function DashboardFilterPanel({ isOpen, onClose, filters, onChange }: Props) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const set = (patch: Partial<TripFilters>) => onChange({ ...filters, ...patch })
  const activeCount = countActiveTripFilters(filters)

  const sortOptions: { value: TripSortOption; label: string }[] = [
    { value: 'date', label: t('dashboard.filters.sort.date') },
    { value: 'name-asc', label: t('dashboard.filters.sort.nameAsc') },
    { value: 'name-desc', label: t('dashboard.filters.sort.nameDesc') },
    { value: 'days-desc', label: t('dashboard.filters.sort.daysDesc') },
    { value: 'days-asc', label: t('dashboard.filters.sort.daysAsc') },
  ]

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
      />
      <div
        role="dialog"
        aria-label={t('dashboard.filters.title')}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1101,
          width: 'min(360px, 92vw)',
          background: 'var(--surface)', color: 'var(--ink)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column',
          animation: 'trek-dash-filter-in 0.22s cubic-bezier(0.23,1,0.32,1)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px',
          borderBottom: '1px solid var(--line)', flexShrink: 0,
        }}>
          <SlidersHorizontal size={16} color="var(--ink-3)" />
          <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{t('dashboard.filters.title')}</span>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 8, border: 'none',
              background: 'var(--bg-2)', color: 'var(--ink-3)', cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label={t('dashboard.filters.search')}>
            <input
              type="text"
              value={filters.search}
              onChange={e => set({ search: e.target.value })}
              placeholder={t('dashboard.filters.searchPlaceholder')}
              style={inputStyle}
            />
          </Field>

          <Field label={t('dashboard.filters.place')}>
            <input
              type="text"
              value={filters.place}
              onChange={e => set({ place: e.target.value })}
              placeholder={t('dashboard.filters.placePlaceholder')}
              style={inputStyle}
            />
          </Field>

          <Field label={t('dashboard.filters.days')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number" min={0} inputMode="numeric"
                value={filters.minDays}
                onChange={e => set({ minDays: e.target.value })}
                placeholder={t('dashboard.filters.daysMin')}
                style={{ ...inputStyle, width: 0, flex: 1 }}
              />
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>–</span>
              <input
                type="number" min={0} inputMode="numeric"
                value={filters.maxDays}
                onChange={e => set({ maxDays: e.target.value })}
                placeholder={t('dashboard.filters.daysMax')}
                style={{ ...inputStyle, width: 0, flex: 1 }}
              />
            </div>
          </Field>

          <Field label={t('dashboard.filters.sortLabel')}>
            <CustomSelect
              value={filters.sortBy}
              onChange={v => set({ sortBy: v as TripSortOption })}
              options={sortOptions}
              size="md"
            />
          </Field>
        </div>

        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
          <button
            onClick={() => onChange({ search: '', place: '', minDays: '', maxDays: '', sortBy: 'date' })}
            disabled={activeCount === 0}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              width: '100%', padding: '10px 14px', borderRadius: 10,
              border: '1px solid var(--line)', background: 'var(--bg-2)',
              color: activeCount === 0 ? 'var(--ink-3)' : 'var(--ink)',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              cursor: activeCount === 0 ? 'default' : 'pointer',
              opacity: activeCount === 0 ? 0.5 : 1,
            }}
          >
            <RotateCcw size={14} />
            {t('dashboard.filters.clear')}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes trek-dash-filter-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-3)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 10,
  border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink)',
  fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
}
