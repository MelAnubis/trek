import { useEffect, useRef } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '../../store/settingsStore'
import { useToast } from '../shared/Toast'
import ToggleSwitch from './ToggleSwitch'
import {
  APPEARANCE_SCHEMES, CUSTOM_ACCENT_PRESETS, DEFAULT_APPEARANCE, FONT_SCALE_MAX, FONT_SCALE_MIN, SCHEME_SWATCHES,
  normalizeAppearance, type AppearanceConfig,
} from '../../theme/appearance'

/**
 * Settings → Display: the look of the app — colour scheme (or your own
 * accent), text size, density, transparency and motion. Every change shows
 * at once (the store updates optimistically and App re-applies it); the
 * text-size slider only saves when you let go of it.
 */

type T = (key: string, params?: Record<string, string | number>) => string

export default function AppearanceControls({ t }: { t: T }) {
  const raw = useSettingsStore(s => s.settings.appearance)
  const dark = useSettingsStore(s => s.settings.dark_mode === true || s.settings.dark_mode === 'dark')
  const updateSetting = useSettingsStore(s => s.updateSetting)
  const toast = useToast()
  const cfg = normalizeAppearance(raw)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  const save = (patch: Partial<AppearanceConfig>, debounce = false) => {
    const next = normalizeAppearance({ ...cfg, ...patch })
    if (debounce) {
      // Live preview now, one request when the slider stops moving.
      useSettingsStore.setState(s => ({ settings: { ...s.settings, appearance: next } }))
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => { updateSetting('appearance', next).catch(() => toast.error(t('common.error'))) }, 500)
      return
    }
    updateSetting('appearance', next).catch(() => toast.error(t('common.error')))
  }

  const label = { display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-secondary)' } as const
  const row = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-primary)' } as const

  return (
    <div className="!flex !flex-col !gap-[18px]">
      {/* Colour scheme */}
      <div>
        <span style={label}>{t('settings.appearance.scheme')}</span>
        <div className="!grid ![grid-template-columns:repeat(auto-fill,_minmax(104px,_1fr))] !gap-[8px]" role="radiogroup" aria-label={t('settings.appearance.scheme')}>
          {APPEARANCE_SCHEMES.filter(s => s !== 'custom').map(id => {
            const on = cfg.scheme === id
            const swatch = SCHEME_SWATCHES[id as Exclude<typeof id, 'custom'>][dark ? 1 : 0]
            return (
              <button className="!flex !items-center !gap-[8px] !p-[9px_10px] !rounded-[10px] !cursor-pointer ![font-family:inherit] !text-[length:13px] ![color:var(--text-primary)]" key={id} type="button" role="radio" aria-checked={on} data-scheme-option={id} onClick={() => save({ scheme: id })}
                style={{ border: on ? '2px solid var(--text-primary)' : '1px solid var(--border-primary)', background: on ? 'var(--bg-hover)' : 'var(--bg-card)' }}>
                <span className="!w-[16px] !h-[16px] !rounded-[50%] !shrink-[0] ![box-shadow:inset_0_0_0_1px_rgba(0,0,0,0.1)]" aria-hidden style={{ background: swatch }} />
                <span className="!flex-[1] !text-left !overflow-hidden !text-ellipsis !whitespace-nowrap">{t(`settings.appearance.scheme.${id}`)}</span>
                {on && <Check size={13} />}
              </button>
            )
          })}
        </div>

        {/* Your own accent */}
        <div className="!mt-[10px]">
          <span className="!text-[length:12px] ![color:var(--text-muted)]">{t('settings.appearance.custom')}</span>
          <div className="!flex !flex-wrap !items-center !gap-[7px] !mt-[6px]">
            {CUSTOM_ACCENT_PRESETS.map(c => {
              const on = cfg.scheme === 'custom' && cfg.accent === c
              return (
                <button className={['!w-[26px] !h-[26px] !rounded-[50%] !cursor-pointer !p-[0] ![border:none]', (on) ? '![outline:2px_solid_var(--text-primary)]' : '![outline:none]', '[&&]:![outline-offset:2px]'].join(' ')} key={c} type="button" aria-label={c} aria-pressed={on} onClick={() => save({ scheme: 'custom', accent: c })}
                  style={{ background: c }} />
              )
            })}
            <label className="!inline-flex !items-center !gap-[6px] !text-[length:12px] ![color:var(--text-muted)] !cursor-pointer">
              <input className="!w-[30px] !h-[26px] !p-[0] ![border:1px_solid_var(--border-primary)] !rounded-[6px] ![background:none] !cursor-pointer" type="color" aria-label={t('settings.appearance.customPick')}
                value={cfg.accent || '#6366f1'}
                onChange={e => save({ scheme: 'custom', accent: e.target.value }, true)} />
              {t('settings.appearance.customPick')}
            </label>
          </div>
        </div>
      </div>

      {/* Text size */}
      <div>
        <span style={label}>{t('settings.appearance.textSize')}</span>
        <div className="!flex !items-center !gap-[10px]">
          <span className="!text-[length:12px] ![color:var(--text-muted)]" aria-hidden>A</span>
          <input className="!flex-[1] ![accent-color:var(--accent)]" type="range" aria-label={t('settings.appearance.textSize')} min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step={0.05}
            value={cfg.fontScale}
            onChange={e => save({ fontScale: Number(e.target.value) }, true)} />
          <span className="!text-[length:19px] ![color:var(--text-muted)]" aria-hidden>A</span>
          <span className="!w-[44px] !text-right !text-[length:12px] ![color:var(--text-secondary)] ![font-variant-numeric:tabular-nums]">{Math.round(cfg.fontScale * 100)}%</span>
        </div>
      </div>

      {/* Toggles */}
      <div className="!flex !flex-col !gap-[8px]">
        <div style={row}>
          <div className="!flex-[1]">
            <div className="!text-[length:14px] ![color:var(--text-primary)]">{t('settings.appearance.compact')}</div>
            <div className="!text-[length:12px] ![color:var(--text-muted)]">{t('settings.appearance.compactHint')}</div>
          </div>
          <ToggleSwitch on={cfg.density === 'compact'} onToggle={() => save({ density: cfg.density === 'compact' ? 'comfortable' : 'compact' })} />
        </div>
        <div style={row}>
          <div className="!flex-[1]">
            <div className="!text-[length:14px] ![color:var(--text-primary)]">{t('settings.appearance.solid')}</div>
            <div className="!text-[length:12px] ![color:var(--text-muted)]">{t('settings.appearance.solidHint')}</div>
          </div>
          <ToggleSwitch on={!cfg.transparency} onToggle={() => save({ transparency: !cfg.transparency })} />
        </div>
        <div style={row}>
          <div className="!flex-[1]">
            <div className="!text-[length:14px] ![color:var(--text-primary)]">{t('settings.appearance.reduceMotion')}</div>
            <div className="!text-[length:12px] ![color:var(--text-muted)]">{t('settings.appearance.reduceMotionHint')}</div>
          </div>
          <ToggleSwitch on={cfg.reduceMotion} onToggle={() => save({ reduceMotion: !cfg.reduceMotion })} />
        </div>
      </div>

      <div>
        <button className="!inline-flex !items-center !gap-[6px] !p-[7px_12px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-muted)] !text-[length:12px] !cursor-pointer ![font-family:inherit]" type="button" onClick={() => save(DEFAULT_APPEARANCE)}
          disabled={JSON.stringify(cfg) === JSON.stringify(DEFAULT_APPEARANCE)}>
          <RotateCcw size={12} /> {t('settings.appearance.reset')}
        </button>
      </div>
    </div>
  )
}
