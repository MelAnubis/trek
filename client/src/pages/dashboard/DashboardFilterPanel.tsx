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
      <div className="!fixed !inset-[0] !z-[1100] ![background:rgba(0,0,0,0.35)] ![backdrop-filter:blur(2px)]"
        onClick={onClose}
      />
      <div className="!fixed !top-[0] !right-[0] !bottom-[0] !z-[1101] !w-[min(360px,_92vw)] ![background:var(--surface)] ![color:var(--ink)] ![box-shadow:-8px_0_32px_rgba(0,0,0,0.18)] !flex !flex-col"
        role="dialog"
        aria-label={t('dashboard.filters.title')}
        style={{ animation: 'trek-dash-filter-in 0.22s cubic-bezier(0.23,1,0.32,1)' }}
      >
        <div className="!flex !items-center !gap-[10px] !p-[16px_18px] ![border-bottom:1px_solid_var(--line)] !shrink-[0]">
          <SlidersHorizontal size={16} color="var(--ink-3)" />
          <span className="!font-[700] !text-[length:14px] !flex-[1]">{t('dashboard.filters.title')}</span>
          <button className="!flex !items-center !justify-center !w-[30px] !h-[30px] !rounded-[8px] ![border:none] ![background:var(--bg-2)] ![color:var(--ink-3)] !cursor-pointer"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="!flex-[1] !overflow-y-auto !p-[18px] !flex !flex-col !gap-[20px]">
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
            <div className="!flex !items-center !gap-[8px]">
              <input className="!w-[0] !flex-[1]"
                type="number" min={0} inputMode="numeric"
                value={filters.minDays}
                onChange={e => set({ minDays: e.target.value })}
                placeholder={t('dashboard.filters.daysMin')}
                style={{ ...inputStyle }}
              />
              <span className="![color:var(--ink-3)] !text-[length:12px]">–</span>
              <input className="!w-[0] !flex-[1]"
                type="number" min={0} inputMode="numeric"
                value={filters.maxDays}
                onChange={e => set({ maxDays: e.target.value })}
                placeholder={t('dashboard.filters.daysMax')}
                style={{ ...inputStyle }}
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

        <div className="!p-[14px_18px] ![border-top:1px_solid_var(--line)] !shrink-[0]">
          <button className="!flex !items-center !justify-center !gap-[7px] !w-[100%] !p-[10px_14px] !rounded-[10px] ![border:1px_solid_var(--line)] ![background:var(--bg-2)] !text-[length:13px] !font-[600] ![font-family:inherit]"
            onClick={() => onChange({ search: '', place: '', minDays: '', maxDays: '', sortBy: 'date' })}
            disabled={activeCount === 0}
            style={{ color: activeCount === 0 ? 'var(--ink-3)' : 'var(--ink)', cursor: activeCount === 0 ? 'default' : 'pointer', opacity: activeCount === 0 ? 0.5 : 1 }}
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
    <label className="!flex !flex-col !gap-[7px]">
      <span className="!text-[length:11px] !font-[700] !uppercase !tracking-[0.04em] ![color:var(--ink-3)]">
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
