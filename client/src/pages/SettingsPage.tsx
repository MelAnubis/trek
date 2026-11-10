import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Settings, Palette, Map, Bell, Plug, CloudOff, User, Info, MapPinned } from 'lucide-react'
import { useTranslation } from '../i18n'
import { authApi } from '../api/client'
import { useAddonStore } from '../store/addonStore'
import Navbar from '../components/Layout/Navbar'
import PageSidebar, { type PageSidebarTab } from '../components/Layout/PageSidebar'
import DisplaySettingsTab from '../components/Settings/DisplaySettingsTab'
import MapSettingsTab from '../components/Settings/MapSettingsTab'
import NotificationsTab from '../components/Settings/NotificationsTab'
import IntegrationsTab from '../components/Settings/IntegrationsTab'
import AccountTab from '../components/Settings/AccountTab'
import AboutTab from '../components/Settings/AboutTab'
import OfflineTab from '../components/Settings/OfflineTab'
import TrackingTab from '../components/Settings/TrackingTab'

export default function SettingsPage(): React.ReactElement {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const { isEnabled: addonEnabled, loadAddons } = useAddonStore()

  const memoriesEnabled = addonEnabled('memories')
  const mcpEnabled = addonEnabled('mcp')
  const hasIntegrations = memoriesEnabled || mcpEnabled

  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'display')

  useEffect(() => {
    loadAddons()
    authApi.getAppConfig?.().then(c => setAppVersion(c?.version)).catch(() => {})
  }, [])

  // Auto-switch to account tab when MFA is required
  useEffect(() => {
    if (searchParams.get('mfa') === 'required') {
      setActiveTab('account')
    }
  }, [searchParams])

  const tabs: PageSidebarTab[] = [
    { id: 'display', label: t('settings.tabs.display'), icon: Palette },
    { id: 'map', label: t('settings.tabs.map'), icon: Map },
    { id: 'notifications', label: t('settings.tabs.notifications'), icon: Bell },
    ...(hasIntegrations
      ? [{ id: 'integrations', label: t('settings.tabs.integrations'), icon: Plug }]
      : []),
    { id: 'offline', label: t('settings.tabs.offline'), icon: CloudOff },
    { id: 'tracking', label: t('tracking.title'), icon: MapPinned },
    { id: 'account', label: t('settings.tabs.account'), icon: User },
    ...(appVersion
      ? [{ id: 'about', label: t('settings.tabs.about'), icon: Info }]
      : []),
  ]

  return (
    <div className="min-h-screen page-bg ![background:var(--bg-secondary)]">
      <Navbar />

      <div className="!pt-[var(--nav-h)]">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center ![background:var(--glass-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] ![border:1px_solid_var(--glass-border)] ![box-shadow:var(--glass-shadow)]"
            >
              <Settings className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold ![color:var(--text-primary)]">{t('settings.title')}</h1>
              <p className="text-sm ![color:var(--text-muted)]">{t('settings.subtitle')}</p>
            </div>
          </div>

          {/* Sidebar layout */}
          <PageSidebar
            sidebarLabel={t('settings.title').toUpperCase()}
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            footer={appVersion ? `v${appVersion} · self-hosted` : 'self-hosted'}
          >
            {activeTab === 'display' && <DisplaySettingsTab />}
            {activeTab === 'map' && <MapSettingsTab />}
            {activeTab === 'notifications' && <NotificationsTab />}
            {activeTab === 'integrations' && hasIntegrations && <IntegrationsTab />}
            {activeTab === 'offline' && <OfflineTab />}
            {(activeTab === 'tracking' || activeTab === 'location') && <TrackingTab />}
            {activeTab === 'account' && <AccountTab />}
            {activeTab === 'about' && appVersion && <AboutTab appVersion={appVersion} />}
          </PageSidebar>
        </div>
      </div>
    </div>
  )
}
