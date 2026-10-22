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
      <span style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4, color: 'var(--text-secondary)' }}>{t('settings.mobileNav.title')}</span>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.mobileNav.hint', { max: MOBILE_NAV_MAX })}</p>

      {/* Preview */}
      <div data-testid="mobile-nav-preview" aria-hidden style={{ display: 'flex', justifyContent: 'space-around', padding: '10px 4px', borderRadius: 14, border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', marginBottom: 10 }}>
        {[...current.map(i => ({ id: i.id, Icon: i.icon, label: t(i.labelKey) })), { id: 'profile', Icon: User, label: t('nav.profile') }].map(({ id, Icon, label }, k) => (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0, flex: 1, color: k === 0 ? 'var(--accent)' : 'var(--text-faint)' }}>
            <Icon size={18} />
            <span style={{ fontSize: 9.5, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Chosen, in order */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {current.map((item, i) => (
          <div key={item.id} data-nav-item={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 9, border: '1px solid var(--border-primary)', background: 'var(--bg-card)' }}>
            <item.icon size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{t(item.labelKey)}</span>
            <button type="button" aria-label={t('settings.mobileNav.up')} disabled={i === 0} onClick={() => move(i, -1)} style={btn(i === 0)}><ArrowUp size={13} /></button>
            <button type="button" aria-label={t('settings.mobileNav.down')} disabled={i === current.length - 1} onClick={() => move(i, 1)} style={btn(i === current.length - 1)}><ArrowDown size={13} /></button>
            <button type="button" aria-label={t('settings.mobileNav.remove')} disabled={current.length <= 1} onClick={() => save(ids.filter(x => x !== item.id))} style={btn(current.length <= 1)}><X size={13} /></button>
          </div>
        ))}
      </div>

      {/* To add */}
      {unused.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {unused.map(item => (
            <button key={item.id} type="button" data-nav-add={item.id} disabled={full} onClick={() => save([...ids, item.id])}
              title={full ? t('settings.mobileNav.full', { max: MOBILE_NAV_MAX }) : undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 99, fontSize: 12, fontFamily: 'inherit',
                border: '1px dashed var(--border-primary)', background: 'none', color: full ? 'var(--text-faint)' : 'var(--text-secondary)', cursor: full ? 'default' : 'pointer', opacity: full ? 0.6 : 1 }}>
              <Plus size={12} /> <item.icon size={13} /> {t(item.labelKey)}
            </button>
          ))}
        </div>
      )}

      <button type="button" onClick={() => save(null)} disabled={!Array.isArray(saved) || saved.length === 0}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
        <RotateCcw size={12} /> {t('settings.mobileNav.reset')}
      </button>
    </div>
  )
}
