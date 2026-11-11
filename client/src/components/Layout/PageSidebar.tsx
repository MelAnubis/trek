import React, { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useIsMobile } from '../../hooks/useIsMobile'
import '../../styles/chrome.css'

export interface PageSidebarTab {
  id: string
  label: string
  icon: LucideIcon
}

interface PageSidebarProps {
  /** Uppercase label shown above the tab list, e.g. "SETTINGS". */
  sidebarLabel: string
  tabs: PageSidebarTab[]
  activeTab: string
  onTabChange: (id: string) => void
  children: React.ReactNode
  /** Small text at the very bottom of the sidebar (e.g. "v3.0 · self-hosted"). */
  footer?: React.ReactNode
}

/**
 * Left-sidebar + right-panel layout used by the Settings and Admin pages.
 *
 * Desktop (>=1024px): sidebar is always visible at 260px; panel fills rest.
 * Phone: a list of sections first; tapping one opens it full width with a
 * back button to the list (no drawer).
 */
export default function PageSidebar({
  sidebarLabel,
  tabs,
  activeTab,
  onTabChange,
  children,
  footer,
}: PageSidebarProps): React.ReactElement {
  const { t } = useTranslation()
  // Phone: a list of sections first (like the settings of iOS/Android); tapping one opens it
  // with a back button. A link straight to a section (?tab=…) opens that section.
  const [mobileView, setMobileView] = useState<'list' | 'panel'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tab') ? 'panel' : 'list')
  const activeLabel = tabs.find(tb => tb.id === activeTab)?.label ?? ''
  const isPhone = useIsMobile() // below lg, where the sidebar can't sit next to the panel

  // Escape (or the phone's back gesture through the button) returns to the list.
  useEffect(() => {
    if (mobileView !== 'panel') return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileView('list') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileView])

  const openSection = (id: string) => {
    onTabChange(id)
    setMobileView('panel')
    window.scrollTo?.({ top: 0 })
  }

  return (
    <div className="trek-pagepanel rounded-2xl overflow-hidden flex flex-col lg:flex-row relative">
      {/* Phone: list of sections */}
      {isPhone && mobileView === 'list' && (
        <nav className="lg:hidden flex flex-col py-2" aria-label={sidebarLabel}>
          {tabs.map(tab => {
            const Icon = tab.icon
            return (
              <button key={tab.id} onClick={() => openSection(tab.id)} className="trek-pagepanel-row flex items-center gap-3 px-4 text-left">
                <span className="trek-pagepanel-row-icon"><Icon size={18} /></span>
                <span className="flex-1 truncate text-[15px] font-medium">{tab.label}</span>
                <ChevronRight size={18} className="trek-text-faint shrink-0" />
              </button>
            )
          })}
          {footer && <div className="trek-pagepanel-footer mx-4 mt-3 pt-3 text-[10px] tracking-wide">{footer}</div>}
        </nav>
      )}

      {/* Phone: inside a section */}
      {isPhone && mobileView === 'panel' && (
        <div className="trek-pagepanel-topbar lg:hidden flex items-center gap-1 px-2 py-2 border-b">
          <button
            onClick={() => setMobileView('list')}
            className="trek-text-primary h-10 pl-1 pr-3 rounded-lg flex items-center gap-1 transition-colors hover:bg-[var(--bg-hover)]"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={20} />
            <span className="text-sm">{sidebarLabel ? sidebarLabel.charAt(0) + sidebarLabel.slice(1).toLowerCase() : ''}</span>
          </button>
          <div className="trek-text-primary flex-1 text-center text-sm font-semibold truncate pr-16">{activeLabel}</div>
        </div>
      )}

      {/* Desktop sidebar (always visible on lg) */}
      {!isPhone && (
        <aside className="trek-pagepanel-aside hidden lg:flex flex-col shrink-0 relative">
          <SidebarInner sidebarLabel={sidebarLabel} tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} footer={footer} />
        </aside>
      )}

      {/* Panel (on a phone only once a section is open) */}
      <div className={`trek-pagepanel-body flex-1 min-w-0${isPhone && mobileView === 'list' ? ' max-lg:hidden' : ''}`}>
        {children}
      </div>
    </div>
  )
}

function SidebarInner({
  sidebarLabel,
  tabs,
  activeTab,
  onTabChange,
  footer,
}: {
  sidebarLabel: string | null
  tabs: PageSidebarTab[]
  activeTab: string
  onTabChange: (id: string) => void
  footer?: React.ReactNode
}): React.ReactElement {
  return (
    <>
      {sidebarLabel && (
        <div
          className="trek-text-muted text-[11px] font-bold tracking-widest uppercase mb-3 px-3"
        >
          {sidebarLabel}
        </div>
      )}
      <nav className="flex flex-col gap-1 flex-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`trek-pagepanel-tab${active ? ' is-active' : ''} flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          )
        })}
      </nav>
      {footer && (
        <div
          className="trek-pagepanel-footer mt-4 pt-3 px-3 text-[10px] tracking-wide"
        >
          {footer}
        </div>
      )}
    </>
  )
}
