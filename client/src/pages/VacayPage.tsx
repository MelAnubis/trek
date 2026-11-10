import React, { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from '../i18n'
import { useVacayStore } from '../store/vacayStore'
import { addListener, removeListener } from '../api/websocket'
import Navbar from '../components/Layout/Navbar'
import VacayCalendar from '../components/Vacay/VacayCalendar'
import VacayPersons from '../components/Vacay/VacayPersons'
import VacayStats from '../components/Vacay/VacayStats'
import VacaySettings from '../components/Vacay/VacaySettings'
import { Plus, Minus, ChevronLeft, ChevronRight, Settings, CalendarDays, AlertTriangle, Users, Eye, Pencil, Trash2, Unlink, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import Modal from '../components/shared/Modal'

export default function VacayPage(): React.ReactElement {
  const { t } = useTranslation()
  const { years, selectedYear, setSelectedYear, addYear, removeYear, loadAll, loadPlan, loadEntries, loadStats, loadHolidays, loading, incomingInvites, acceptInvite, declineInvite, plan } = useVacayStore()
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [deleteYear, setDeleteYear] = useState<number | null>(null)
  const [showMobileSidebar, setShowMobileSidebar] = useState<boolean>(false)

  useEffect(() => { loadAll() }, [])

  // Live sync via WebSocket
  const handleWsMessage = useCallback((msg: { type: string }) => {
    if (msg.type === 'vacay:update' || msg.type === 'vacay:settings') {
      loadPlan()
      loadEntries(selectedYear)
      loadStats(selectedYear)
      if (msg.type === 'vacay:settings') loadAll()
    }
    if (msg.type === 'vacay:invite' || msg.type === 'vacay:accepted' || msg.type === 'vacay:declined' || msg.type === 'vacay:cancelled' || msg.type === 'vacay:dissolved') {
      loadAll()
    }
  }, [selectedYear])

  useEffect(() => {
    addListener(handleWsMessage)
    return () => removeListener(handleWsMessage)
  }, [handleWsMessage])
  useEffect(() => {
    if (selectedYear) { loadEntries(selectedYear); loadStats(selectedYear); loadHolidays(selectedYear) }
  }, [selectedYear])

  const handleAddNextYear = () => {
    const nextYear = years.length > 0 ? Math.max(...years) + 1 : new Date().getFullYear()
    addYear(nextYear)
  }

  const handleAddPrevYear = () => {
    const prevYear = years.length > 0 ? Math.min(...years) - 1 : new Date().getFullYear()
    addYear(prevYear)
  }

  if (loading) {
    return (
      <div className="min-h-screen page-bg ![background:var(--bg-secondary)]">
        <Navbar />
        <div className="flex items-center justify-center !pt-[var(--nav-h)] !min-h-[calc(100vh_-_var(--nav-h))]">
          <div className="w-8 h-8 border-2 rounded-full animate-spin ![border-color:var(--border-primary)] ![border-top-color:var(--text-primary)]" />
        </div>
      </div>
    )
  }

  // Sidebar content (shared between desktop sidebar and mobile drawer)
  const sidebarContent = (
    <>
      {/* Year Selector */}
      <div className="rounded-xl border p-3 ![background:var(--bg-card)] ![border-color:var(--border-primary)]">
        <div className="flex items-center mb-2">
          <span className="text-[11px] font-medium uppercase tracking-wider ![color:var(--text-faint)]">{t('vacay.year')}</span>
        </div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1">
            <button onClick={handleAddPrevYear} className="p-0.5 rounded transition-colors ![color:var(--text-faint)]" title={t('vacay.addPrevYear')}>
              <Plus size={14} />
            </button>
            <button onClick={() => { const idx = years.indexOf(selectedYear); if (idx > 0) setSelectedYear(years[idx - 1]) }} disabled={years.indexOf(selectedYear) <= 0} className="p-1 rounded-lg disabled:opacity-20 transition-colors ![background:var(--bg-secondary)]">
              <ChevronLeft size={16} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
          <span className="text-xl font-bold tabular-nums ![color:var(--text-primary)]">{selectedYear}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => { const idx = years.indexOf(selectedYear); if (idx < years.length - 1) setSelectedYear(years[idx + 1]) }} disabled={years.indexOf(selectedYear) >= years.length - 1} className="p-1 rounded-lg disabled:opacity-20 transition-colors ![background:var(--bg-secondary)]">
              <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
            </button>
            <button onClick={handleAddNextYear} className="p-0.5 rounded transition-colors ![color:var(--text-faint)]" title={t('vacay.addYear')}>
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {years.map(y => (
            <div key={y} onClick={() => setSelectedYear(y)}
              className="group relative py-1.5 rounded-lg text-xs font-medium transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] text-center cursor-pointer"
              style={{
                background: y === selectedYear ? 'var(--text-primary)' : 'var(--bg-secondary)',
                color: y === selectedYear ? 'var(--bg-card)' : 'var(--text-muted)',
              }}>
              {y}
              {years.length > 1 && (
                <span onClick={e => { e.stopPropagation(); setDeleteYear(y); setShowMobileSidebar(false) }}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[7px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                  <Minus size={7} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <VacayPersons />

      {/* Legend */}
      {(plan?.holidays_enabled || plan?.company_holidays_enabled || plan?.block_weekends) && (
        <div className="rounded-xl border p-3 ![background:var(--bg-card)] ![border-color:var(--border-primary)]">
          <span className="text-[11px] font-medium uppercase tracking-wider ![color:var(--text-faint)]">{t('vacay.legend')}</span>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
            {plan?.holidays_enabled && (plan?.holiday_calendars ?? []).length === 0 && (
              <LegendItem color="#fecaca" label={t('vacay.publicHoliday')} />
            )}
            {plan?.holidays_enabled && (plan?.holiday_calendars ?? []).map(cal => (
              <LegendItem key={cal.id} color={cal.color} label={cal.label || cal.region} />
            ))}
            {plan?.company_holidays_enabled && <LegendItem color="#fde68a" label={t('vacay.companyHoliday')} />}
            {plan?.block_weekends && <LegendItem color="#e5e7eb" label={t('vacay.weekend')} />}
          </div>
        </div>
      )}

      <VacayStats />
    </>
  )

  return (
    <div className="min-h-screen page-bg ![background:var(--bg-secondary)]">
      <Navbar />

      <div className="!pt-[var(--nav-h)]">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-4 sm:py-6">
          {/* Mobile + tablet header (filter toggle lives here) */}
          <div className="lg:hidden flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center ![background:var(--bg-secondary)]">
                <CalendarDays size={18} style={{ color: 'var(--text-primary)' }} />
              </div>
              <h1 className="text-lg font-bold ![color:var(--text-primary)]">{t('admin.addons.catalog.vacay.name')}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMobileSidebar(true)}
                className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ![background:var(--bg-secondary)] ![color:var(--text-muted)]"
              >
                <SlidersHorizontal size={14} />
              </button>
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ![background:var(--bg-secondary)] ![color:var(--text-muted)]"
              >
                <Settings size={14} />
              </button>
            </div>
          </div>

          {/* Desktop header — unified toolbar (sidebar is always visible at this width) */}
          <div className="hidden lg:block !mb-[20px]">
            <div className="![background:var(--bg-tertiary)] !rounded-[18px] ![border:1px_solid_var(--border-primary)] ![box-shadow:0_1px_3px_rgba(0,0,0,0.06),_0_1px_2px_rgba(0,0,0,0.04)] !p-[14px_16px_14px_22px] !flex !items-center !gap-[16px] !flex-wrap">
              <h2 className="!m-[0] !text-[length:18px] !font-[600] ![color:var(--text-primary)] !tracking-[-0.01em] !shrink-[0]">
                {t('admin.addons.catalog.vacay.name')}
              </h2>
              <div className="!w-[1px] !h-[22px] ![background:var(--border-faint)] !shrink-[0]" />
              <span className="!text-[length:13px] ![color:var(--text-muted)]">
                {t('vacay.subtitle')}
              </span>
              <div className="!inline-flex !gap-[6px] !items-center !ml-[auto] !shrink-[0]">
                <button className="trek-hover-o88 ![appearance:none] ![border:none] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !gap-[6px] !p-[9px_14px] !rounded-[10px] !text-[length:13px] !font-[500] ![background:var(--accent)] ![color:var(--accent-text)] !shrink-[0] !ml-[2px] ![transition:opacity_0.15s_ease]"
                  onClick={() => setShowSettings(true)} >
                  <Settings size={14} strokeWidth={2.5} /> {t('vacay.settings')}
                </button>
              </div>
            </div>
          </div>

          {/* Main layout */}
          <div className="flex gap-4 items-start">
            {/* Desktop Sidebar */}
            <div className="hidden lg:flex w-[240px] shrink-0 flex-col gap-3 sticky top-[70px]">
              {sidebarContent}
            </div>

            {/* Calendar */}
            <div className="flex-1 min-w-0">
              <VacayCalendar />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sidebar Drawer */}
      {showMobileSidebar && ReactDOM.createPortal(
        <div className="fixed inset-0 lg:hidden !z-[99980]">
          <div className="absolute inset-0 ![background:rgba(0,0,0,0.4)]" onClick={() => setShowMobileSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[280px] overflow-y-auto p-3 flex flex-col gap-3 ![background:var(--bg-primary)] ![box-shadow:4px_0_24px_rgba(0,0,0,0.15)]"
            style={{ animation: 'slideInLeft 0.2s ease-out' }}>
            {sidebarContent}
          </div>
        </div>,
        document.body
      )}

      {/* Settings Modal */}
      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title={t('vacay.settings')} size="md">
        <VacaySettings onClose={() => setShowSettings(false)} />
      </Modal>

      {/* Delete Year Modal */}
      <Modal isOpen={deleteYear !== null} onClose={() => setDeleteYear(null)} title={t('vacay.removeYear')} size="sm">
        <div className="space-y-4">
          <div className="flex gap-3 p-3 rounded-lg ![background:rgba(239,68,68,0.08)] ![border:1px_solid_rgba(239,68,68,0.15)]">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium ![color:var(--text-primary)]">
                {t('vacay.removeYearConfirm', { year: deleteYear })}
              </p>
              <p className="text-xs mt-1 ![color:var(--text-muted)]">
                {t('vacay.removeYearHint')}
              </p>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setDeleteYear(null)} className="px-4 py-2 text-sm rounded-lg transition-colors ![color:var(--text-muted)] ![border:1px_solid_var(--border-primary)]">
              {t('common.cancel')}
            </button>
            <button onClick={async () => { await removeYear(deleteYear); setDeleteYear(null) }} className="px-4 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">
              {t('vacay.remove')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Incoming invite — forced fullscreen modal */}
      {incomingInvites.length > 0 && ReactDOM.createPortal(
        <div className="fixed inset-0 flex items-center justify-center px-4 !z-[99995] ![background-color:rgba(0,0,0,0.7)] ![backdrop-filter:blur(8px)]">
          {incomingInvites.map(inv => (
            <div key={inv.id} className="trek-modal-enter w-full max-w-md rounded-2xl shadow-2xl overflow-hidden ![background:var(--bg-card)]">
              <div className="px-6 pt-6 pb-4 text-center">
                <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center text-lg font-bold ![background:var(--bg-secondary)] ![color:var(--text-primary)]">
                  {inv.username?.[0]?.toUpperCase()}
                </div>
                <h2 className="text-lg font-bold mb-1 ![color:var(--text-primary)]">
                  {t('vacay.inviteTitle')}
                </h2>
                <p className="text-sm ![color:var(--text-muted)]">
                  <span className="font-semibold ![color:var(--text-primary)]">{inv.username}</span> {t('vacay.inviteWantsToFuse')}
                </p>
              </div>
              <div className="px-6 pb-4 space-y-2">
                <InfoItem icon={Eye} text={t('vacay.fuseInfo1')} />
                <InfoItem icon={Pencil} text={t('vacay.fuseInfo2')} />
                <InfoItem icon={Trash2} text={t('vacay.fuseInfo3')} />
                <InfoItem icon={ShieldCheck} text={t('vacay.fuseInfo4')} />
                <InfoItem icon={Unlink} text={t('vacay.fuseInfo5')} />
              </div>
              <div className="px-6 pb-6 flex gap-3">
                <button onClick={() => declineInvite(inv.plan_id)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ![color:var(--text-muted)] ![border:1px_solid_var(--border-primary)]">
                  {t('vacay.decline')}
                </button>
                <button onClick={() => acceptInvite(inv.plan_id)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ![background:var(--text-primary)] ![color:var(--bg-card)]">
                  {t('vacay.acceptFusion')}
                </button>
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}

function InfoItem({ icon: Icon, text }: { icon: React.ElementType; text: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-3 px-3 py-2 rounded-lg ![background:var(--bg-secondary)]">
      <Icon size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
      <span className="text-xs ![color:var(--text-primary)]">{text}</span>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="w-4 h-3 rounded" style={{ background: color, border: `1px solid ${color}` }} />
      <span className="text-[11px] ![color:var(--text-muted)]">{label}</span>
    </div>
  )
}
