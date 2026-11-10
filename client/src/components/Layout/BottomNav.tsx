import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAddonStore } from '../../store/addonStore'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useTranslation } from '../../i18n'
import { User, Settings, Shield, LogOut, Bell, Radio } from 'lucide-react'
import { useInAppNotificationStore } from '../../store/inAppNotificationStore'
import { resolveMobileNav } from './mobileNav'
import { useIsDark } from '../../hooks/useIsDark'

export default function BottomNav() {
  const { t } = useTranslation()
  const dark = useIsDark()
  const addons = useAddonStore(s => s.addons)
  const savedNav = useSettingsStore(s => s.settings.mobile_nav)
  const enabledAddons = addons.filter(a => a.type === 'global' && a.enabled).map(a => a.id)
  const [showProfile, setShowProfile] = useState(false)
  // Unread notifications show as a dot on the profile button on every page —
  // the bell only lives in the dashboard's top strip on a phone.
  const unread = useInAppNotificationStore(s => s.unreadCount)

  // Configurable in Settings → Display (see mobileNav.ts); the default is the old fixed bar.
  const items = resolveMobileNav(savedNav, enabledAddons).map(i => ({ to: i.to, label: t(i.labelKey), icon: i.icon }))

  return (
    <>
      <nav
        className="md:hidden sticky bottom-0 flex justify-around items-start pt-3 z-50 mt-auto flex-shrink-0"
        style={{
          height: 'calc(84px + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          background: dark ? 'rgba(9,9,11,0.94)' : 'rgba(250,250,250,0.94)',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          borderTop: '1px solid var(--chrome-border)',
        }}
      >
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-1 px-3 py-1 min-w-[60px]"
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-faint)',
              transition: 'color 180ms cubic-bezier(0.23,1,0.32,1)',
            })}
          >
            <Icon size={22} strokeWidth={2} />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setShowProfile(true)}
          className="relative flex flex-col items-center gap-1 px-3 py-1 min-w-[60px]"
          style={{ color: 'var(--text-faint)' }}
          aria-label={unread > 0 ? t('nav.profileUnread', { count: unread }) : t('nav.profile')}
        >
          <User size={22} strokeWidth={2} />
          {unread > 0 && (
            <span aria-hidden="true" className="absolute top-0.5 right-4 w-2 h-2 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg-primary, #fff)' }} />
          )}
          <span className="text-[10px] font-medium">{t("nav.profile")}</span>
        </button>
      </nav>

      {showProfile && <ProfileSheet onClose={() => setShowProfile(false)} />}
    </>
  )
}

/** The phone's profile sheet: account, notifications, tracking, settings, admin, sign out. Also opened from the dashboard's top avatar. */
export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const unread = useInAppNotificationStore(s => s.unreadCount)

  const handleNav = (path: string) => {
    onClose()
    navigate(path)
  }

  const handleLogout = () => {
    onClose()
    logout()
    navigate('/login')
  }

  return (
    <div className="fixed inset-0 z-[300] md:hidden" onClick={onClose}>
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: 'var(--modal-backdrop)',
          backdropFilter: 'blur(12px) saturate(150%)',
          WebkitBackdropFilter: 'blur(12px) saturate(150%)',
        }}
      />

      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl overflow-hidden"
        style={{
          animation: 'slideUp 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          background: 'var(--modal-bg)',
          backdropFilter: 'var(--glass-blur-lg)',
          WebkitBackdropFilter: 'var(--glass-blur-lg)',
          border: '1px solid var(--modal-border)',
          borderBottomWidth: 0,
          boxShadow: 'var(--glass-shadow-lg)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-primary)' }} />
        </div>

        {/* User info */}
        <div className="px-6 pb-4 pt-1">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl overflow-hidden flex items-center justify-center text-[16px] font-bold flex-shrink-0"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-text)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              {user?.avatar_url
                ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                : (user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{user?.username}</p>
              <p className="text-[12px] truncate" style={{ color: 'var(--text-muted)' }}>{user?.email}</p>
            </div>
            {user?.role === 'admin' && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  background: 'var(--glass-bg-subtle)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--text-muted)',
                }}
              >
                <Shield size={10} /> {t('nav.administrator')}
              </span>
            )}
          </div>
        </div>

        <div className="h-px mx-4" style={{ background: 'var(--modal-border)' }} />

        {/* Links */}
        <div className="py-2 px-2">
          <button
            onClick={() => handleNav('/notifications')}
            className="trek-hover w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
            style={{ color: 'var(--text-primary)' }}
          >
            <Bell size={18} style={{ color: 'var(--text-muted)' }} />
            <span className="text-[14px] font-medium flex-1">{t('nav.mobile.notifications')}</span>
            {unread > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>

          <button
            onClick={() => handleNav('/tracking')}
            className="trek-hover w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
            style={{ color: 'var(--text-primary)' }}
          >
            <Radio size={18} style={{ color: 'var(--text-muted)' }} />
            <span className="text-[14px] font-medium">{t('tracking.title')}</span>
          </button>

          <button
            onClick={() => handleNav('/settings')}
            className="trek-hover w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
            style={{ color: 'var(--text-primary)' }}
          >
            <Settings size={18} style={{ color: 'var(--text-muted)' }} />
            <span className="text-[14px] font-medium">{t("nav.bottomSettings")}</span>
          </button>

          {user?.role === 'admin' && (
            <button
              onClick={() => handleNav('/admin')}
              className="trek-hover w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              <Shield size={18} style={{ color: 'var(--text-muted)' }} />
              <span className="text-[14px] font-medium">{t("nav.bottomAdmin")}</span>
            </button>
          )}
        </div>

        <div className="h-px mx-4" style={{ background: 'var(--modal-border)' }} />

        {/* Logout */}
        <div className="py-2 px-2">
          <button
            onClick={handleLogout}
            className="hover:bg-red-500/10 w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors"
          >
            <LogOut size={18} className="text-red-500" />
            <span className="text-[14px] font-medium text-red-500">{t("nav.bottomLogout")}</span>
          </button>
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
