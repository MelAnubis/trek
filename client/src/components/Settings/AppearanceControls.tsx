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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Colour scheme */}
      <div>
        <span style={label}>{t('settings.appearance.scheme')}</span>
        <div role="radiogroup" aria-label={t('settings.appearance.scheme')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 8 }}>
          {APPEARANCE_SCHEMES.filter(s => s !== 'custom').map(id => {
            const on = cfg.scheme === id
            const swatch = SCHEME_SWATCHES[id as Exclude<typeof id, 'custom'>][dark ? 1 : 0]
            return (
              <button key={id} type="button" role="radio" aria-checked={on} data-scheme-option={id} onClick={() => save({ scheme: id })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                  border: on ? '2px solid var(--text-primary)' : '1px solid var(--border-primary)', background: on ? 'var(--bg-hover)' : 'var(--bg-card)', color: 'var(--text-primary)' }}>
                <span aria-hidden style={{ width: 16, height: 16, borderRadius: '50%', background: swatch, flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)' }} />
                <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`settings.appearance.scheme.${id}`)}</span>
                {on && <Check size={13} />}
              </button>
            )
          })}
        </div>

        {/* Your own accent */}
        <div style={{ marginTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.appearance.custom')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 6 }}>
            {CUSTOM_ACCENT_PRESETS.map(c => {
              const on = cfg.scheme === 'custom' && cfg.accent === c
              return (
                <button key={c} type="button" aria-label={c} aria-pressed={on} onClick={() => save({ scheme: 'custom', accent: c })}
                  style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0, border: 'none',
                    outline: on ? '2px solid var(--text-primary)' : 'none', outlineOffset: 2 }} />
              )
            })}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="color" aria-label={t('settings.appearance.customPick')}
                value={cfg.accent || '#6366f1'}
                onChange={e => save({ scheme: 'custom', accent: e.target.value }, true)}
                style={{ width: 30, height: 26, padding: 0, border: '1px solid var(--border-primary)', borderRadius: 6, background: 'none', cursor: 'pointer' }} />
              {t('settings.appearance.customPick')}
            </label>
          </div>
        </div>
      </div>

      {/* Text size */}
      <div>
        <span style={label}>{t('settings.appearance.textSize')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden style={{ fontSize: 12, color: 'var(--text-muted)' }}>A</span>
          <input type="range" aria-label={t('settings.appearance.textSize')} min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step={0.05}
            value={cfg.fontScale}
            onChange={e => save({ fontScale: Number(e.target.value) }, true)}
            style={{ flex: 1, accentColor: 'var(--accent)' }} />
          <span aria-hidden style={{ fontSize: 19, color: 'var(--text-muted)' }}>A</span>
          <span style={{ width: 44, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(cfg.fontScale * 100)}%</span>
        </div>
      </div>

      {/* Toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={row}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{t('settings.appearance.compact')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.appearance.compactHint')}</div>
          </div>
          <ToggleSwitch on={cfg.density === 'compact'} onToggle={() => save({ density: cfg.density === 'compact' ? 'comfortable' : 'compact' })} />
        </div>
        <div style={row}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{t('settings.appearance.solid')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.appearance.solidHint')}</div>
          </div>
          <ToggleSwitch on={!cfg.transparency} onToggle={() => save({ transparency: !cfg.transparency })} />
        </div>
        <div style={row}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{t('settings.appearance.reduceMotion')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.appearance.reduceMotionHint')}</div>
          </div>
          <ToggleSwitch on={cfg.reduceMotion} onToggle={() => save({ reduceMotion: !cfg.reduceMotion })} />
        </div>
      </div>

      <div>
        <button type="button" onClick={() => save(DEFAULT_APPEARANCE)}
          disabled={JSON.stringify(cfg) === JSON.stringify(DEFAULT_APPEARANCE)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          <RotateCcw size={12} /> {t('settings.appearance.reset')}
        </button>
      </div>
    </div>
  )
}
