import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAddonStore } from '../../store/addonStore'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useTranslation } from '../../i18n'
import { User, Settings, Shield, LogOut, Bell, Radio, type LucideIcon } from 'lucide-react'
import { useInAppNotificationStore } from '../../store/inAppNotificationStore'
import { resolveMobileNav } from './mobileNav'
import '../../styles/chrome.css'

// Look: styles/chrome.css (.trek-bottomnav, .trek-sheet…), light and dark via the .dark class.

export default function BottomNav() {
  const { t } = useTranslation()
  const addons = useAddonStore(s => s.addons)
  const savedNav = useSettingsStore(s => s.settings.mobile_nav)
  const enabledAddons = addons.filter(a => a.type === 'global' && a.enabled).map(a => a.id)
  const [showProfile, setShowProfile] = useState(false)
  // Unread notifications show as a dot on the profile button on every page —
  // the bell only lives in the dashboard's top strip on a phone.
  const unread = useInAppNotificationStore(s => s.unreadCount)

  // Configurable in Settings → Display (see mobileNav.ts).
  const items = resolveMobileNav(savedNav, enabledAddons).map(i => ({ to: i.to, label: t(i.labelKey), icon: i.icon }))

  return (
    <>
      <nav className="trek-bottomnav md:hidden sticky bottom-0 flex justify-around items-start pt-3 z-50 mt-auto flex-shrink-0">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className="trek-bottomnav-item flex flex-col items-center gap-1 px-3 py-1 min-w-[60px]">
            <Icon size={22} strokeWidth={2} />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setShowProfile(true)}
          className="trek-bottomnav-item relative flex flex-col items-center gap-1 px-3 py-1 min-w-[60px]"
          aria-label={unread > 0 ? t('nav.profileUnread', { count: unread }) : t('nav.profile')}
        >
          <User size={22} strokeWidth={2} />
          {unread > 0 && <span aria-hidden="true" className="trek-unread-dot absolute top-0.5 right-4" />}
          <span className="text-[10px] font-medium">{t('nav.profile')}</span>
        </button>
      </nav>

      {showProfile && <ProfileSheet onClose={() => setShowProfile(false)} />}
    </>
  )
}

function SheetLink({ icon: Icon, label, onClick, children }: { icon: LucideIcon; label: string; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="trek-sheet-link trek-hover w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors">
      <Icon size={18} className="trek-sheet-link-icon" />
      <span className="text-[14px] font-medium flex-1">{label}</span>
      {children}
    </button>
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
      <div className="trek-sheet-backdrop absolute inset-0" />

      <div className="trek-sheet absolute bottom-0 left-0 right-0 rounded-t-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-2">
          <div className="trek-sheet-handle w-10 h-1 rounded-full" />
        </div>

        {/* User info */}
        <div className="px-6 pb-4 pt-1">
          <div className="flex items-center gap-3">
            <div className="trek-sheet-avatar w-11 h-11 rounded-2xl overflow-hidden flex items-center justify-center text-[16px] font-bold flex-shrink-0">
              {user?.avatar_url
                ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                : (user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="trek-text-primary text-[15px] font-semibold">{user?.username}</p>
              <p className="trek-text-muted text-[12px] truncate">{user?.email}</p>
            </div>
            {user?.role === 'admin' && (
              <span className="trek-sheet-badge flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide">
                <Shield size={10} /> {t('nav.administrator')}
              </span>
            )}
          </div>
        </div>

        <div className="trek-sheet-divider h-px mx-4" />

        <div className="py-2 px-2">
          <SheetLink icon={Bell} label={t('nav.mobile.notifications')} onClick={() => handleNav('/notifications')}>
            {unread > 0 && (
              <span className="trek-count-badge min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </SheetLink>
          <SheetLink icon={Radio} label={t('tracking.title')} onClick={() => handleNav('/tracking')} />
          <SheetLink icon={Settings} label={t('nav.bottomSettings')} onClick={() => handleNav('/settings')} />
          {user?.role === 'admin' && <SheetLink icon={Shield} label={t('nav.bottomAdmin')} onClick={() => handleNav('/admin')} />}
        </div>

        <div className="trek-sheet-divider h-px mx-4" />

        <div className="py-2 px-2">
          <button onClick={handleLogout} className="hover:bg-red-500/10 w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors">
            <LogOut size={18} className="text-red-500" />
            <span className="text-[14px] font-medium text-red-500">{t('nav.bottomLogout')}</span>
          </button>
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
