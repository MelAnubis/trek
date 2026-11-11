import { RotateCw, AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Tooltip } from '../shared/Tooltip'
import { POI_CATEGORIES } from './poiCategories'

interface Props {
  active: Set<string>
  onToggle: (key: string) => void
  loadingKeys?: Set<string>
  /** categories whose last fetch failed → show a retry affordance */
  errorKeys?: Set<string>
  /** true when the map moved since the last search → offer "search this area" */
  moved?: boolean
  onSearchArea?: () => void
}

// Frosted, icon-only segmented control that floats over the map. Active segments
// fill with the category colour (matching their markers); the label shows in a
// custom tooltip on hover so the pill stays compact (it scrolls only on a narrow phone).
export default function PoiCategoryPill({ active, onToggle, loadingKeys, errorKeys, moved, onSearchArea }: Props) {
  const { t } = useTranslation()
  const anyError = !!errorKeys && Array.from(active).some(k => errorKeys.has(k))

  const frosted: React.CSSProperties = {
    background: 'var(--sidebar-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    boxShadow: 'var(--sidebar-shadow, 0 4px 16px rgba(0,0,0,0.14))',
  }

  return (
    <div className="!flex !flex-col !items-center !gap-[8px]">
      {/* Twelve categories don't fit a phone's width: the pill scrolls sideways instead of overflowing. */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 999, pointerEvents: 'auto', maxWidth: 'calc(100vw - 32px)', overflowX: 'auto', scrollbarWidth: 'none', ...frosted }}>
        {POI_CATEGORIES.map(cat => {
          const on = active.has(cat.key)
          const loading = loadingKeys?.has(cat.key)
          return (
            <Tooltip key={cat.key} label={t(cat.labelKey)} placement="bottom">
              <button
                type="button"
                onClick={() => onToggle(cat.key)}
                aria-pressed={on}
                aria-label={t(cat.labelKey)}
                className={on ? '' : 'text-content-muted'}
                style={{
                  position: 'relative',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 34, height: 34, flexShrink: 0, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: on ? cat.color : 'transparent',
                  color: on ? '#fff' : undefined,
                  transition: 'background 0.14s, color 0.14s',
                }}
                onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
              >
                {loading ? (
                  <span
                    className={['animate-spin !w-[14px] !h-[14px] !rounded-[999px] !inline-block', (on) ? '[&&]:![border-color:rgba(255,255,255,0.45)]' : '[&&]:![border-color:var(--border-primary)]', (on) ? '[&&]:![border-top-color:#fff]' : '[&&]:![border-top-color:var(--text-muted)]', '![border:2px_solid]'].join(' ')}
                  />
                ) : (
                  <cat.Icon size={16} strokeWidth={2} />
                )}
                {on && !loading && errorKeys?.has(cat.key) && (
                  <span className="!absolute !top-[2px] !right-[2px] !w-[8px] !h-[8px] !rounded-[999px] ![border:1.5px_solid_var(--sidebar-bg)]" style={{ background: '#ef4444' }} />
                )}
              </button>
            </Tooltip>
          )
        })}
      </div>

      {(moved || anyError) && active.size > 0 && (
        <button
          type="button"
          onClick={onSearchArea}
          className="text-content"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 13px', borderRadius: 999, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit', pointerEvents: 'auto',
            color: anyError ? '#ef4444' : undefined,
            ...frosted,
          }}
        >
          {anyError
            ? <AlertTriangle size={13} strokeWidth={2.4} />
            : <RotateCw size={13} strokeWidth={2.4} />}
          {t('poi.searchThisArea')}
        </button>
      )}
    </div>
  )
}
