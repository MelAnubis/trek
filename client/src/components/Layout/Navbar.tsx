import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useAddonStore } from '../../store/addonStore'
import { useTranslation } from '../../i18n'
import { Mountain, Plane, LogOut, Settings, Radio, ChevronDown, Shield, ArrowLeft, Users, Moon, Sun, Monitor, CalendarDays, Briefcase, Globe, Compass, Navigation, Route as RouteIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import InAppNotificationBell from './InAppNotificationBell.tsx'
import '../../styles/chrome.css'
import { useIsDark } from '../../hooks/useIsDark'

const ADDON_ICONS: Record<string, LucideIcon> = { CalendarDays, Briefcase, Globe, Compass }

interface NavbarProps {
  tripTitle?: string
  tripId?: string
  onBack?: () => void
  showBack?: boolean
  onShare?: () => void
}

interface Addon {
  id: string
  name: string
  icon: string
  type: string
  enabled?: boolean
}

export default function Navbar({ tripTitle, tripId, onBack, showBack, onShare }: NavbarProps): React.ReactElement {
  const { user, logout, isPrerelease, appVersion } = useAuthStore()
  const { settings, updateSetting } = useSettingsStore()
  const { addons: allAddons, loadAddons } = useAddonStore()
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false)
  const [scrolled, setScrolled] = useState<boolean>(false)
  const dark = useIsDark()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8 || (document.body.scrollTop || 0) > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    document.body.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.body.removeEventListener('scroll', onScroll)
    }
  }, [])

  // Only show 'global' type addons in the navbar — 'integration' addons have no dedicated page
  const globalAddons = allAddons.filter((a: Addon) => a.type === 'global' && a.enabled)

  useEffect(() => {
    if (user) loadAddons()
  }, [user, location.pathname])

  const handleLogout = () => {
    logout()
    navigate('/login', { state: { noRedirect: true } })
  }

  // Keep track of the pending theme-transition cleanup so we can cancel it
  // on unmount. Without this the timer fires after jsdom teardown in unit
  // tests (document is gone) and triggers an unhandled ReferenceError that
  // trips vitest's exit code.
  const themeTransitionTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (themeTransitionTimer.current !== null) {
      window.clearTimeout(themeTransitionTimer.current)
      themeTransitionTimer.current = null
    }
  }, [])

  const toggleDarkMode = () => {
    document.documentElement.classList.add('trek-theme-transitioning')
    updateSetting('dark_mode', dark ? 'light' : 'dark').catch(() => {})
    if (themeTransitionTimer.current !== null) window.clearTimeout(themeTransitionTimer.current)
    themeTransitionTimer.current = window.setTimeout(() => {
      document.documentElement.classList.remove('trek-theme-transitioning')
      themeTransitionTimer.current = null
    }, 360)
  }

  const getAddonName = (addon: Addon): string => {
    const key = `admin.addons.catalog.${addon.id}.name`
    const translated = t(key)
    return translated !== key ? translated : addon.name
  }

  return (
    <nav className={`trek-navbar${scrolled ? ' is-scrolled' : ''} hidden md:flex items-center px-4 gap-4 fixed top-0 left-0 right-0 z-[200]`}>
      {/* Left side */}
      <div className="flex items-center gap-3 min-w-0">
        {showBack && (
          <button onClick={onBack}
            className="trek-hover trek-back-btn p-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-sm flex-shrink-0"
            >
            <ArrowLeft className="trek-back-icon w-4 h-4" />
            <span className="hidden sm:inline">{t('common.back')}</span>
          </button>
        )}

        <Link to="/dashboard" className="flex items-center transition-colors flex-shrink-0">
          <img src={dark ? '/icons/icon-white.svg' : '/icons/icon-dark.svg'} alt="Trek Wanderer" className="sm:hidden h-[22px] w-[22px]" />
          <img src={dark ? '/logo-light.svg' : '/logo-dark.svg'} alt="Trek Wanderer" className="hidden sm:block h-7" />
        </Link>

        {/* App destinations: my trips, the global addons that are on, the route planner and Explora. */}
        {!tripTitle && (
          <>
            <span className="trek-navbar-sep">|</span>
            {[
              { to: '/dashboard', label: t('nav.myTrips'), Icon: Briefcase as LucideIcon },
              ...globalAddons.map(addon => ({ to: `/${addon.id}`, label: getAddonName(addon), Icon: ADDON_ICONS[addon.icon] || CalendarDays })),
              { to: '/planner', label: t('planner.nav'), Icon: RouteIcon as LucideIcon },
              { to: '/explora', label: t('site.tab'), Icon: Mountain as LucideIcon },
            ].map(({ to, label, Icon }) => {
              const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)
              return (
                <Link key={to} to={to} title={label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`trek-nav-link flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium flex-shrink-0${isActive ? ' is-active' : ''}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              )
            })}
          </>
        )}

        {tripTitle && (
          <>
            <span className="trek-navbar-sep hidden sm:inline">/</span>
            <span className="trek-navbar-trip hidden sm:inline text-sm font-medium truncate max-w-48">
              {tripTitle}
            </span>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Navigate button — visible when inside a trip */}
      {tripId && (
        <Link
          to={`/navigate?tripId=${tripId}`}
          title={t('nav.navigateTitle')}
          className="trek-nav-go flex items-center gap-1.5 py-1.5 px-3 rounded-lg border transition-colors text-sm font-medium flex-shrink-0"
        >
          <Navigation className="w-4 h-4" />
          <span className="hidden sm:inline">{t('nav.navigate')}</span>
        </Link>
      )}

      {/* Share button */}
      {onShare && (
        <button onClick={onShare}
          className="trek-hover trek-navbar-share flex items-center gap-1.5 py-1.5 px-3 rounded-lg border transition-colors text-sm font-medium flex-shrink-0">
          <Users className="w-4 h-4" />
          <span className="hidden sm:inline">{t('nav.share')}</span>
        </button>
      )}

      {/* Version — amber "prerelease" pill on a dev/beta build, a plain
          neutral one otherwise. Always shown (not tucked into the user
          menu) so anyone glancing at the app — including a maintainer
          confirming a deploy actually landed — can see it without a click. */}
      {appVersion && (
        isPrerelease ? (
          <span
            className="trek-pill-prerelease hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0"
          >
            <span className="trek-pill-prerelease-dot w-1.5 h-1.5 rounded-full flex-shrink-0" />
            {appVersion}
          </span>
        ) : (
          <span
            className="trek-pill-version hidden lg:flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0"
            title={t('nav.versionTitle')}
          >
            v{appVersion}
          </span>
        )
      )}

      {/* Dark mode toggle (light ↔ dark, overrides auto) — hidden on mobile */}
      <button onClick={toggleDarkMode} title={dark ? t('nav.lightMode') : t('nav.darkMode')}
        className="trek-hover trek-navbar-btn p-2 rounded-lg transition-colors flex-shrink-0 hidden sm:flex relative w-8 h-8 items-center justify-center">
        <Sun className="trek-theme-sun w-4 h-4 absolute transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]" />
        <Moon className="trek-theme-moon w-4 h-4 absolute transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]" />
      </button>

      {/* Notification bell — only in trip view on mobile, everywhere on desktop */}
      {user && tripId && <InAppNotificationBell />}
      {user && !tripId && <span className="hidden sm:block"><InAppNotificationBell /></span>}

      {/* User menu */}
      {user && (
        <div className="relative">
          <button onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="trek-hover flex items-center gap-2 py-1.5 px-3 rounded-lg transition-colors">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="trek-navbar-avatar" />
            ) : (
              <div className="trek-navbar-avatar-initial w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">
                {user.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="trek-text-secondary text-sm hidden sm:inline max-w-24 truncate">
              {user.username}
            </span>
            <ChevronDown className="trek-text-faint w-4 h-4" />
          </button>

          {userMenuOpen && ReactDOM.createPortal(
            <>
              <div className="fixed inset-0 z-[9998]" onClick={() => setUserMenuOpen(false)} />
              <div
                className="trek-menu-enter trek-menu-panel w-52 rounded-xl overflow-hidden"
              >
                <div className="trek-menu-head px-4 py-3">
                  <p className="trek-text-primary text-sm font-medium">{user.username}</p>
                  <p className="trek-text-muted text-xs truncate">{user.email}</p>
                  {user.role === 'admin' && (
                    <span className="trek-text-secondary inline-flex items-center gap-1 text-xs font-medium mt-1">
                      <Shield className="w-3 h-3" /> {t('nav.administrator')}
                    </span>
                  )}
                </div>

                <div className="py-1">
                  <Link to="/settings" onClick={() => setUserMenuOpen(false)}
                    className="trek-hover trek-menu-link flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                    >
                    <Settings className="w-4 h-4" />
                    {t('nav.settings')}
                  </Link>

                  <Link to="/tracking" onClick={() => setUserMenuOpen(false)}
                    className="trek-hover trek-menu-link flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                    >
                    <Radio className="w-4 h-4" />
                    {t('tracking.title')}
                  </Link>

                  {user.role === 'admin' && (
                    <Link to="/admin" onClick={() => setUserMenuOpen(false)}
                      className="trek-hover trek-menu-link flex items-center gap-2 px-4 py-2 text-sm transition-colors"
                      >
                      <Shield className="w-4 h-4" />
                      {t('nav.admin')}
                    </Link>
                  )}
                </div>

                <div className="trek-menu-section py-1">
                  <button onClick={handleLogout}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors">
                    <LogOut className="w-4 h-4" />
                    {t('nav.logout')}
                  </button>
                  {appVersion && (
                    <div className="trek-menu-version-row px-4 pt-2 pb-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="trek-menu-version">
                          <img src={dark ? '/text-light.svg' : '/text-dark.svg'} alt="Trek Wanderer" />
                          <span>v{appVersion}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
      )}
    </nav>
  )
}
