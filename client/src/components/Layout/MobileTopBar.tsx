import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useInAppNotificationStore } from '../../store/inAppNotificationStore'
import { useTranslation } from '../../i18n'
import { Bell } from 'lucide-react'
import { ProfileSheet } from './BottomNav'
import '../../styles/chrome.css'

// Mobile-only: a slim strip at the very top of the dashboard with the
// notification + profile icons (right-aligned). Scrolls with the page.
export default function MobileTopBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, isAuthenticated } = useAuthStore()
  const unread = useInAppNotificationStore(s => s.unreadCount)
  const fetchUnreadCount = useInAppNotificationStore(s => s.fetchUnreadCount)

  const [showProfile, setShowProfile] = useState(false)

  useEffect(() => { if (isAuthenticated) fetchUnreadCount() }, [isAuthenticated])

  return (
    <div
      className="trek-mtopbar md:hidden flex items-center justify-end gap-2 px-4"

    >
      <button
        onClick={() => navigate('/notifications')}
        aria-label={t('notifications.title')}
        className="trek-mtopbar-bell relative grid place-items-center rounded-full active:scale-95 transition-transform"

      >
        <Bell size={20} strokeWidth={1.9} />
        {unread > 0 && (
          <span aria-hidden="true" className="trek-mtopbar-dot" />
        )}
      </button>
      <button
        onClick={() => setShowProfile(true)}
        aria-label={t('nav.profile')}
        className={`trek-mtopbar-avatar${user?.avatar_url ? '' : ' is-initial'} grid place-items-center rounded-full text-white font-semibold text-[12px] active:scale-95 transition-transform overflow-hidden`}

      >
        {user?.avatar_url
          ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
          : (user?.username || '?')[0].toUpperCase()
        }
      </button>
      {/* Same sheet as the bottom bar's profile button — one place for account, settings and sign out. */}
      {showProfile && <ProfileSheet onClose={() => setShowProfile(false)} />}
    </div>
  )
}
