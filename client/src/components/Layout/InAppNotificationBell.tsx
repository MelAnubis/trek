import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, Trash2, CheckCheck } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useInAppNotificationStore } from '../../store/inAppNotificationStore.ts'
import { useAuthStore } from '../../store/authStore'
import InAppNotificationItem from '../Notifications/InAppNotificationItem.tsx'
import { useIsDark } from '../../hooks/useIsDark'

export default function InAppNotificationBell(): React.ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dark = useIsDark()

  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const { notifications, unreadCount, isLoading, fetchNotifications, fetchUnreadCount, markAllRead, deleteAll } = useInAppNotificationStore()

  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
      fetchUnreadCount()
    }
  }, [isAuthenticated])

  const handleOpen = () => {
    if (!open) {
      fetchNotifications(true)
    }
    setOpen(v => !v)
  }

  const handleShowAll = () => {
    setOpen(false)
    navigate('/notifications')
  }

  const displayCount = unreadCount > 99 ? '99+' : unreadCount

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={handleOpen}
        title={t('notifications.title')}
        className="trek-hover relative p-2 rounded-lg transition-colors ![color:var(--text-muted)]" >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-bold ![background:#ef4444] !text-[length:9px] !min-w-[14px] !h-[14px] !p-[0_3px] !leading-[1]"
          >
            {displayCount}
          </span>
        )}
      </button>

      {open && ReactDOM.createPortal(
        <>
          <div className="!fixed !inset-[0] !z-[9998]" onClick={() => setOpen(false)} />
          <div
            className="trek-menu-enter rounded-xl overflow-hidden !fixed !top-[var(--nav-h)] !right-[8px] !w-[360px] !max-w-[calc(100vw_-_16px)] !max-h-[min(480px,_calc(100vh_-_var(--nav-h)_-_16px))] !z-[9999] ![background:var(--modal-bg)] ![backdrop-filter:var(--glass-blur-lg)] ![-webkit-backdrop-filter:var(--glass-blur-lg)] ![border:1px_solid_var(--modal-border)] ![box-shadow:var(--glass-shadow-lg)] !flex !flex-col"
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 flex-shrink-0 ![border-bottom:1px_solid_var(--modal-border)]"
            >
              <span className="text-sm font-semibold ![color:var(--text-primary)]">
                {t('notifications.title')}
                {unreadCount > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-medium ![background:var(--text-primary)] ![color:var(--bg-primary)]">
                    {unreadCount}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    title={t('notifications.markAllRead')}
                    className="trek-hover p-1.5 rounded-lg transition-colors ![color:var(--text-muted)]" >
                    <CheckCheck className="w-3.5 h-3.5" />
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={deleteAll}
                    title={t('notifications.deleteAll')}
                    className="trek-hover p-1.5 rounded-lg transition-colors ![color:var(--text-muted)]" >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Notification list */}
            <div className="overflow-y-auto flex-1">
              {isLoading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-5 h-5 border-2 rounded-full animate-spin ![border-color:var(--border-primary)] ![border-top-color:var(--text-primary)]" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center gap-2">
                  <Bell className="w-8 h-8" style={{ color: 'var(--text-faint)' }} />
                  <p className="text-sm font-medium ![color:var(--text-muted)]">{t('notifications.empty')}</p>
                  <p className="text-xs ![color:var(--text-faint)]">{t('notifications.emptyDescription')}</p>
                </div>
              ) : (
                notifications.slice(0, 10).map(n => (
                  <InAppNotificationItem key={n.id} notification={n} onClose={() => setOpen(false)} />
                ))
              )}
            </div>

            {/* Footer */}
            <button
              onClick={handleShowAll}
              className="trek-hover w-full py-2.5 text-xs font-medium transition-colors flex-shrink-0 ![border-top:1px_solid_var(--border-secondary)] ![color:var(--text-primary)] ![background:transparent]" >
              {t('notifications.showAll')}
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
