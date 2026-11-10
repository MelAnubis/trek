import { ArrowDown, ArrowUp, Plus, RotateCcw, User, X } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import { useAddonStore } from '../../store/addonStore'
import { useToast } from '../shared/Toast'
import { MOBILE_NAV_MAX, availableNavItems, normalizeMobileNav, resolveMobileNav } from '../Layout/mobileNav'

/**
 * Settings → Display: choose the phone's bottom-bar destinations and their
 * order, with a live preview of the bar. Profile is always the last button
 * and isn't listed — it's how you reach settings and sign out.
 */

type T = (key: string, params?: Record<string, string | number>) => string

export default function MobileNavEditor({ t }: { t: T }) {
  const saved = useSettingsStore(s => s.settings.mobile_nav)
  const updateSetting = useSettingsStore(s => s.updateSetting)
  const addons = useAddonStore(s => s.addons)
  const toast = useToast()
  const enabled = addons.filter(a => a.type === 'global' && a.enabled).map(a => a.id)

  const current = resolveMobileNav(saved, enabled)
  const ids = current.map(i => i.id)
  const unused = availableNavItems(enabled).filter(i => !ids.includes(i.id))
  const full = ids.length >= MOBILE_NAV_MAX

  const save = (next: string[] | null) => {
    updateSetting('mobile_nav', next === null ? [] : normalizeMobileNav(next)).catch(() => toast.error(t('common.error')))
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }

  const btn = (disabled: boolean) => ({
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, border: '1px solid var(--border-primary)',
    background: 'none', color: disabled ? 'var(--border-primary)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', padding: 0,
  } as const)

  return (
    <div>
      <span className="!block !text-[length:14px] !font-[500] !mb-[4px] ![color:var(--text-secondary)]">{t('settings.mobileNav.title')}</span>
      <p className="!m-[0_0_10px] !text-[length:12px] ![color:var(--text-muted)]">{t('settings.mobileNav.hint', { max: MOBILE_NAV_MAX })}</p>

      {/* Preview */}
      <div className="!flex !justify-around !p-[10px_4px] !rounded-[14px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-secondary)] !mb-[10px]" data-testid="mobile-nav-preview" aria-hidden>
        {[...current.map(i => ({ id: i.id, Icon: i.icon, label: t(i.labelKey) })), { id: 'profile', Icon: User, label: t('nav.profile') }].map(({ id, Icon, label }, k) => (
          <div className="!flex !flex-col !items-center !gap-[3px] !min-w-[0] !flex-[1]" key={id} style={{ color: k === 0 ? 'var(--accent)' : 'var(--text-faint)' }}>
            <Icon size={18} />
            <span className="!text-[length:9.5px] !max-w-[100%] !overflow-hidden !text-ellipsis !whitespace-nowrap">{label}</span>
          </div>
        ))}
      </div>

      {/* Chosen, in order */}
      <div className="!flex !flex-col !gap-[6px]">
        {current.map((item, i) => (
          <div className="!flex !items-center !gap-[8px] !p-[6px_8px] !rounded-[9px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)]" key={item.id} data-nav-item={item.id}>
            <item.icon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span className="!flex-[1] !text-[length:13px] ![color:var(--text-primary)]">{t(item.labelKey)}</span>
            <button type="button" aria-label={t('settings.mobileNav.up')} disabled={i === 0} onClick={() => move(i, -1)} style={btn(i === 0)}><ArrowUp size={13} /></button>
            <button type="button" aria-label={t('settings.mobileNav.down')} disabled={i === current.length - 1} onClick={() => move(i, 1)} style={btn(i === current.length - 1)}><ArrowDown size={13} /></button>
            <button type="button" aria-label={t('settings.mobileNav.remove')} disabled={current.length <= 1} onClick={() => save(ids.filter(x => x !== item.id))} style={btn(current.length <= 1)}><X size={13} /></button>
          </div>
        ))}
      </div>

      {/* To add */}
      {unused.length > 0 && (
        <div className="!flex !flex-wrap !gap-[6px] !mt-[10px]">
          {unused.map(item => (
            <button className="!inline-flex !items-center !gap-[5px] !p-[5px_10px] !rounded-[99px] !text-[length:12px] ![font-family:inherit] ![border:1px_dashed_var(--border-primary)] ![background:none]" key={item.id} type="button" data-nav-add={item.id} disabled={full} onClick={() => save([...ids, item.id])}
              title={full ? t('settings.mobileNav.full', { max: MOBILE_NAV_MAX }) : undefined}
              style={{ color: full ? 'var(--text-faint)' : 'var(--text-secondary)', cursor: full ? 'default' : 'pointer', opacity: full ? 0.6 : 1 }}>
              <Plus size={12} /> <item.icon size={13} /> {t(item.labelKey)}
            </button>
          ))}
        </div>
      )}

      <button className="!inline-flex !items-center !gap-[6px] !mt-[10px] !p-[6px_11px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)] !text-[length:12px] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => save(null)} disabled={!Array.isArray(saved) || saved.length === 0}>
        <RotateCcw size={12} /> {t('settings.mobileNav.reset')}
      </button>
    </div>
  )
}
