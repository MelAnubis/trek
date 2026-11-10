import { NAV_APPS } from '../../utils/navApps'
import React, { useState, useEffect, useRef } from 'react'
import { Palette, Sun, Moon, Monitor, ChevronDown, Check } from 'lucide-react'
import { SUPPORTED_LANGUAGES, useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'
import { useToast } from '../shared/Toast'
import Section from './Section'
import AppearanceControls from './AppearanceControls'
import MobileNavEditor from './MobileNavEditor'

export default function DisplaySettingsTab(): React.ReactElement {
  const { settings, updateSetting } = useSettingsStore()
  const { t } = useTranslation()
  const toast = useToast()
  const [tempUnit, setTempUnit] = useState<string>(settings.temperature_unit || 'celsius')
  const [langOpen, setLangOpen] = useState(false)
  const langDropdownRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!langOpen) return
    const handler = (e: MouseEvent) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [langOpen])

  useEffect(() => {
    setTempUnit(settings.temperature_unit || 'celsius')
  }, [settings.temperature_unit])

  return (
    <Section title={t('settings.display')} icon={Palette}>
      {/* Color Mode */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.colorMode')}</label>
        <div className="flex gap-3 !flex-wrap">
          {[
            { value: 'light', label: t('settings.light'), icon: Sun },
            { value: 'dark', label: t('settings.dark'), icon: Moon },
            { value: 'auto', label: t('settings.auto'), icon: Monitor },
          ].map(opt => {
            const current = settings.dark_mode
            const isActive = current === opt.value || (opt.value === 'light' && current === false) || (opt.value === 'dark' && current === true)
            return (
              <button className="!flex !items-center !gap-[6px] !p-[10px_14px] !rounded-[10px] !cursor-pointer !flex-[1_1_0] !justify-center !min-w-[0] ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
                key={opt.value}
                onClick={async () => {
                  try {
                    await updateSetting('dark_mode', opt.value)
                  } catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
                }}
                style={{ border: isActive ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: isActive ? 'var(--bg-hover)' : 'var(--bg-card)' }}
              >
                <span className="hidden sm:inline-flex"><opt.icon size={16} /></span>
                {opt.value === 'auto' ? (
                  <>
                    <span className="hidden sm:inline">{opt.label}</span>
                    <span className="sm:hidden">Auto</span>
                  </>
                ) : opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Look: scheme, accent, text size, density, transparency, motion */}
      <AppearanceControls t={t} />

      {/* Phone bottom bar */}
      <MobileNavEditor t={t} />

      {/* Language */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.language')}</label>
        {/* Desktop: Button grid */}
        <div className="hidden sm:flex flex-wrap gap-3">
          {SUPPORTED_LANGUAGES.map(opt => (
            <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
              key={opt.value}
              onClick={async () => {
                try { await updateSetting('language', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{ border: settings.language === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: settings.language === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* Mobile: Custom dropdown */}
        <div ref={langDropdownRef} className="sm:hidden" style={{ position: 'relative' }}>
          {(() => {
            const current = SUPPORTED_LANGUAGES.find(o => o.value === settings.language) || SUPPORTED_LANGUAGES[0]
            return (
              <button className="!w-[100%] !flex !items-center !justify-between !p-[10px_14px] !rounded-[10px] ![border:2px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !text-[length:14px] !font-[500] ![font-family:inherit] !cursor-pointer"
                type="button"
                onClick={() => setLangOpen(v => !v)}
              >
                <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{current?.label}</span>
                <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--text-faint)', transform: langOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
            )
          })()}
          {langOpen && (
            <div className="!absolute !top-[calc(100%_+_4px)] !left-[0] !right-[0] !z-[50] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_8px_24px_rgba(0,0,0,0.15)] !p-[4px] !max-h-[280px] !overflow-y-auto">
              {SUPPORTED_LANGUAGES.map(opt => {
                const active = settings.language === opt.value
                return (
                  <button className="!flex !items-center !gap-[8px] !w-[100%] !p-[9px_12px] !rounded-[6px] ![border:none] !cursor-pointer ![color:var(--text-primary)] !text-left"
                    key={opt.value}
                    type="button"
                    onClick={async () => {
                      setLangOpen(false)
                      try { await updateSetting('language', opt.value) }
                      catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
                    }}
                    style={{ background: active ? 'var(--bg-hover)' : 'transparent', fontFamily: 'inherit', fontSize: 14, fontWeight: active ? 600 : 500 }}
                  >
                    <span className="!flex-[1]">{opt.label}</span>
                    {active && <Check size={14} strokeWidth={2.5} color="var(--accent)" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Temperature */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.temperature')}</label>
        <div className="flex gap-3">
          {[
            { value: 'celsius', label: '°C Celsius' },
            { value: 'fahrenheit', label: '°F Fahrenheit' },
          ].map(opt => (
            <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
              key={opt.value}
              onClick={async () => {
                setTempUnit(opt.value)
                try { await updateSetting('temperature_unit', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{ border: tempUnit === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: tempUnit === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time Format */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.timeFormat')}</label>
        <div className="flex gap-3">
          {[
            { value: '24h', short: '24h', example: '14:30' },
            { value: '12h', short: '12h', example: '2:30 PM' },
          ].map(opt => (
            <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
              key={opt.value}
              onClick={async () => {
                try { await updateSetting('time_format', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{ border: settings.time_format === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: settings.time_format === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
            >
              {opt.short}
              <span className="hidden sm:inline">{` (${opt.example})`}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Default Currency */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.defaultCurrency') || 'Moneda por defecto'}</label>
        <div className="flex gap-3 !flex-wrap">
          {[
            { value: 'EUR', label: '€ EUR' },
            { value: 'USD', label: '$ USD' },
            { value: 'GBP', label: '£ GBP' },
            { value: 'JPY', label: '¥ JPY' },
            { value: 'CHF', label: 'Fr CHF' },
          ].map(opt => (
            <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
              key={opt.value}
              onClick={async () => {
                try { await updateSetting('default_currency', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{ border: (settings.default_currency || 'EUR') === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: (settings.default_currency || 'EUR') === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Route Calculation */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.routeCalculation')}</label>
        <div className="flex gap-3">
          {[
            { value: true, label: t('settings.on') || 'On' },
            { value: false, label: t('settings.off') || 'Off' },
          ].map(opt => (
            <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
              key={String(opt.value)}
              onClick={async () => {
                try { await updateSetting('route_calculation', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{ border: (settings.route_calculation !== false) === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: (settings.route_calculation !== false) === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Booking route labels */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.bookingLabels')}</label>
        <div className="flex gap-3">
          {[
            { value: true, label: t('settings.on') || 'On' },
            { value: false, label: t('settings.off') || 'Off' },
          ].map(opt => (
            <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
              key={String(opt.value)}
              onClick={async () => {
                try { await updateSetting('map_booking_labels', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{ border: (settings.map_booking_labels !== false) === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: (settings.map_booking_labels !== false) === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs mt-1 ![color:var(--text-faint)]">{t('settings.bookingLabelsHint')}</p>
      </div>

      {/* Blur Booking Codes */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.blurBookingCodes')}</label>
        <div className="flex gap-3">
          {[
            { value: true, label: t('settings.on') || 'On' },
            { value: false, label: t('settings.off') || 'Off' },
          ].map(opt => (
            <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
              key={String(opt.value)}
              onClick={async () => {
                try { await updateSetting('blur_booking_codes', opt.value) }
                catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
              }}
              style={{ border: (!!settings.blur_booking_codes) === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: (!!settings.blur_booking_codes) === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Travel & map (TREK v5) */}
      <div>
        <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t('settings.preferredNavApp')}</label>
        <select className="!p-[10px_14px] !rounded-[10px] ![border:2px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] ![font-family:inherit] !text-[length:14px] !min-w-[220px]"
          data-testid="preferred-nav-app"
          value={settings.preferred_nav_app || ''}
          onChange={async e => {
            try { await updateSetting('preferred_nav_app', e.target.value) }
            catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
          }}
        >
          <option value="">{t('settings.preferredNavAppAsk')}</option>
          {NAV_APPS.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
        </select>
        <p className="text-xs mt-1 ![color:var(--text-faint)]">{t('settings.preferredNavAppHint')}</p>
      </div>
      {([['day_date_first', 'settings.dayDateFirst', 'settings.dayDateFirstHint'], ['compact_unplanned', 'settings.compactUnplanned', 'settings.compactUnplannedHint']] as const).map(([key, label, hint]) => (
        <div key={key}>
          <label className="block text-sm font-medium mb-2 ![color:var(--text-secondary)]">{t(label)}</label>
          <div className="flex gap-3">
            {[{ value: true, label: t('settings.on') || 'On' }, { value: false, label: t('settings.off') || 'Off' }].map(opt => (
              <button className="!flex !items-center !gap-[8px] !p-[10px_20px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:14px] !font-[500] ![color:var(--text-primary)] ![transition:all_0.15s]"
                key={String(opt.value)}
                data-testid={`${key}-${opt.value ? 'on' : 'off'}`}
                onClick={async () => {
                  try { await updateSetting(key, opt.value) }
                  catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('common.error')) }
                }}
                style={{ border: (!!settings[key]) === opt.value ? '2px solid var(--text-primary)' : '2px solid var(--border-primary)', background: (!!settings[key]) === opt.value ? 'var(--bg-hover)' : 'var(--bg-card)' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs mt-1 ![color:var(--text-faint)]">{t(hint)}</p>
        </div>
      ))}
    </Section>
  )
}
