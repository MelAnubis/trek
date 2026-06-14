import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useInAppNotificationStore } from '../../store/inAppNotificationStore'
import { useTranslation } from '../../i18n'
import { Bell } from 'lucide-react'

// Mobile-only: a slim strip at the very top of the dashboard with the
// notification + profile icons (right-aligned). Scrolls with the page.
export default function MobileTopBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuthStore()
  const unread = useInAppNotificationStore(s => s.unreadCount)
  const fetchUnreadCount = useInAppNotificationStore(s => s.fetchUnreadCount)

  useEffect(() => { if (isAuthenticated) fetchUnreadCount() }, [isAuthenticated])

  return (
    <div
      className="md:hidden flex items-center justify-end gap-2 px-4"
      style={{ paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))', paddingBottom: 10 }}
    >
      <button
        onClick={() => navigate('/notifications')}
        aria-label={t('notifications.title')}
        className="relative grid place-items-center rounded-full active:scale-95 transition-transform"
        style={{ width: 36, height: 36, color: 'var(--ink-2, #52525b)' }}
      >
        <Bell size={20} strokeWidth={1.9} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 7, right: 7, width: 8, height: 8, borderRadius: '50%', background: 'oklch(0.7 0.17 38)', boxShadow: '0 0 0 2px var(--bg, #fff)' }} />
        )}
      </button>
      <button
        onClick={() => navigate('/settings')}
        aria-label={t('nav.profile')}
        className="grid place-items-center rounded-full text-white font-semibold text-[12px] active:scale-95 transition-transform overflow-hidden"
        style={{ width: 34, height: 34, background: user?.avatar_url ? undefined : 'linear-gradient(135deg, oklch(0.7 0.14 38), oklch(0.55 0.13 25))' }}
      >
        {user?.avatar_url
          ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
          : (user?.username || '?')[0].toUpperCase()
        }
      </button>
    </div>
  )
}
