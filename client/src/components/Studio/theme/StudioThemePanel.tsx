import { useState, type CSSProperties } from 'react'
import { Check, ImageIcon, RotateCcw, Unlink } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { useToast } from '../../shared/Toast'
import ToggleSwitch from '../../Settings/ToggleSwitch'
import {
  BOOK_COLOR_TOKENS, BOOK_FONT_SLOTS, BOOK_PALETTE_KEYS, BOOK_THEME_DECORATIONS, BOOK_THEME_MOTIFS,
  type BookColorToken, type BookFontFamily, type BookPalette, type BookTheme, type BookThemeFont,
} from '../../../types/book'
import { BOOK_FONT_ORDER, BOOK_FONTS, fontStack } from '../bookFonts'
import { BOOK_THEME_PRESETS, bookThemeColor, isBookFontFamily, type BookThemePreset } from '../bookTheme'
import { useStudioTheme } from './useStudioTheme'

/**
 * The Theme section of the sidebar (5.7.6, port of liketrek/TREK's
 * theme/StudioThemePanel.tsx): seventeen built-in looks, the palette, the
 * faces and the motifs of the one being put together, and applying it to the
 * book or to the page that is open. Nothing changes until it is applied.
 */

type T = (k: string, params?: Record<string, string | number>) => string

const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '12px 0 6px' }
const HINT: CSSProperties = { fontSize: 11, color: 'var(--text-faint)', margin: '0 0 8px', lineHeight: 1.4 }
const BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

/** A theme as a little page: its paper, "Aa" in its display face and ink, and its three accents. */
export function ThemeSheet({ palette, display }: { palette: BookPalette; display: BookThemeFont }) {
  const font = isBookFontFamily(display.font) ? display.font : 'sans'
  return (
    <span aria-hidden style={{
      position: 'relative', display: 'block', aspectRatio: '4 / 3', borderRadius: 6, background: palette.paper,
      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)', overflow: 'hidden',
    }}>
      <span style={{ position: 'absolute', left: 8, top: 6, fontFamily: fontStack(font), color: palette.ink, fontSize: 20, lineHeight: 1, fontWeight: display.weight ?? 600 }}>Aa</span>
      <span style={{ position: 'absolute', left: 8, bottom: 7, display: 'flex', gap: 3 }}>
        {[palette.accent, palette.accent2, palette.accent3].map((c, i) => (
          <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: c, boxShadow: '0 0 0 1px rgba(0,0,0,.08)' }} />
        ))}
      </span>
    </span>
  )
}

function ThemeCard({ preset, on, inUse, onPick, t }: { preset: BookThemePreset; on: boolean; inUse: boolean; onPick: () => void; t: T }) {
  return (
    <button type="button" aria-pressed={on} onClick={onPick} title={t(preset.descrKey)} data-testid={`theme-${preset.id}`}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, padding: 4, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
        border: on ? '2px solid var(--text-primary)' : '1px solid var(--border-primary)', background: 'var(--bg-card)', textAlign: 'start',
      }}>
      <ThemeSheet palette={preset.palette} display={preset.fonts.display} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        <span style={{ flex: 1, minWidth: 0 }}>{t(preset.labelKey)}</span>
        {inUse && <Check size={12} strokeWidth={2.6} aria-label={t('studio.theme.inUse')} />}
      </span>
    </button>
  )
}

/** The script a theme falls back to when one is switched on. */
const DEFAULT_SCRIPT: BookFontFamily = 'caveat'

function FontSlot({ slot, face, onPick, t }: { slot: (typeof BOOK_FONT_SLOTS)[number]; face: BookThemeFont | null; onPick: (font: string | null) => void; t: T }) {
  const label = t(`studio.theme.slot.${slot}`)
  const select = face && (
    <select value={isBookFontFamily(face.font) ? face.font : 'sans'} onChange={e => onPick(e.target.value)} aria-label={label}
      data-testid={`theme-font-${slot}`}
      style={{ width: '100%', padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, fontFamily: fontStack(isBookFontFamily(face.font) ? face.font : 'sans') }}>
      {BOOK_FONT_ORDER.map(f => <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{BOOK_FONTS[f].name}</option>)}
    </select>
  )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {slot === 'script' && <ToggleSwitch on={!!face} onToggle={() => onPick(face ? null : DEFAULT_SCRIPT)} />}
        <span style={{ flex: 1, minWidth: 0 }}>{select ?? <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('studio.theme.noScript')}</span>}</span>
      </span>
    </div>
  )
}

export function StudioThemePanel() {
  const { t } = useTranslation()
  const toast = useToast()
  const theme = useStudioTheme()
  const { draft } = theme
  const [more, setMore] = useState(false)

  const apply = (scope: 'book' | 'page') => {
    const done = theme.apply(scope)
    if (!done) return
    if (done.pages > 0) toast.success(t('studio.theme.applied'))
    else toast.info(t('studio.theme.nothing'))
  }
  const fromPhotos = async () => {
    if (!(await theme.fromPhotos())) toast.info(t('studio.theme.noPhotoColours'))
  }

  return (
    <div data-testid="theme-panel">
      <p style={HINT}>{t('studio.theme.intro')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {BOOK_THEME_PRESETS.map(preset => (
          <ThemeCard key={preset.id} preset={preset} on={draft.id === preset.id} inUse={theme.current?.id === preset.id}
            onPick={() => theme.pick(preset.id)} t={t} />
        ))}
      </div>
      {theme.edited && (
        <button type="button" style={{ ...BTN, marginTop: 6 }} onClick={theme.reset}>
          <RotateCcw size={13} /> {t('studio.theme.reset')}
        </button>
      )}

      <div style={LABEL}>{t('studio.theme.palette')}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {BOOK_PALETTE_KEYS.map(key => {
          const name = t(`studio.theme.token.${key}`)
          return (
            <label key={key} title={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 9.5, color: 'var(--text-muted)' }}>
              <span style={{ position: 'relative', width: 30, height: 30, borderRadius: '50%', background: draft.palette[key], boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)', overflow: 'hidden' }}>
                <input type="color" value={draft.palette[key]} aria-label={name} data-testid={`theme-colour-${key}`}
                  onChange={e => theme.setColour(key, e.target.value)}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
              </span>
              {name}
            </label>
          )
        })}
      </div>
      <button type="button" style={{ ...BTN, marginTop: 8, width: '100%', opacity: !theme.hasPhotos || theme.reading ? 0.5 : 1 }}
        onClick={() => void fromPhotos()} disabled={!theme.hasPhotos || theme.reading} data-testid="theme-from-photos">
        <ImageIcon size={14} /> {t('studio.theme.fromPhotos')}
      </button>

      <div style={LABEL}>{t('studio.theme.fonts')}</div>
      {BOOK_FONT_SLOTS.map(slot => (
        <FontSlot key={slot} slot={slot} face={draft.fonts[slot]} onPick={font => theme.setFont(slot, font)} t={t} />
      ))}

      <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more}
        style={{ ...BTN, border: 'none', padding: '6px 0', background: 'none', color: 'var(--text-muted)' }}>
        {more ? '−' : '+'} {t('studio.theme.motifs')} · {t('studio.theme.decoration')}
      </button>
      {more && (
        <>
          <p style={HINT}>{t('studio.theme.motifsHint')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {BOOK_THEME_MOTIFS.map(m => {
              const on = draft.motifs.includes(m)
              return (
                <button key={m} type="button" aria-pressed={on} onClick={() => theme.toggleMotif(m)}
                  style={{ ...BTN, padding: '4px 8px', borderRadius: 99, fontSize: 10.5, ...(on ? { background: 'var(--text-primary)', color: 'var(--bg-primary)', borderColor: 'var(--text-primary)' } : null) }}>
                  {t(`studio.theme.motif.${m}`)}
                </button>
              )
            })}
          </div>
          <div style={LABEL}>{t('studio.theme.decoration')}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {BOOK_THEME_DECORATIONS.map(d => (
              <button key={d} type="button" aria-pressed={draft.decoration === d} onClick={() => theme.setDecoration(d)}
                style={{ ...BTN, flex: 1, padding: '5px 4px', ...(draft.decoration === d ? { borderColor: 'var(--text-primary)', borderWidth: 1.5, background: 'var(--bg-tertiary)' } : null) }}>
                {t(`studio.theme.decoration.${d}`)}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-primary)', fontWeight: 600 }}>{t('studio.theme.adopt')}</span>
          <ToggleSwitch on={theme.adopt} onToggle={() => theme.setAdopt(!theme.adopt)} />
        </div>
        <p style={HINT}>{t('studio.theme.adoptHint')}</p>
        <button type="button" data-testid="theme-apply-book" onClick={() => apply('book')} disabled={!theme.canApply}
          style={{ ...BTN, background: 'var(--text-primary)', color: 'var(--bg-primary)', borderColor: 'var(--text-primary)' }}>
          {t('studio.theme.applyBook')}
        </button>
        <button type="button" data-testid="theme-apply-page" onClick={() => apply('page')} disabled={!theme.canApply} style={BTN}>
          {t('studio.theme.applyPage')}
        </button>
      </div>
    </div>
  )
}

/**
 * The book's theme colours under a colour's own swatches in the inspector:
 * picking one sets the colour and links it, so it follows the next theme;
 * the chain button unlinks it and keeps the colour. Nothing without a theme.
 */
export function StudioThemeLink({ theme, token, onLink, onUnlink, t }: {
  theme: BookTheme | undefined
  token: BookColorToken | undefined
  onLink: (token: BookColorToken, hex: string) => void
  onUnlink: () => void
  t: T
}) {
  if (!theme) return null
  return (
    <div data-testid="theme-link" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{t('studio.theme.linked')}</span>
      <div style={{ display: 'flex', gap: 3, flex: 1 }}>
        {BOOK_COLOR_TOKENS.map(key => {
          const hex = bookThemeColor(theme, key)
          const name = t(`studio.theme.token.${key}`)
          return (
            <button key={key} type="button" title={name} aria-label={name} aria-pressed={token === key} data-testid={`theme-token-${key}`}
              onClick={() => onLink(key, hex)}
              style={{
                width: 18, height: 18, borderRadius: '50%', padding: 0, cursor: 'pointer', background: hex,
                border: token === key ? '2px solid var(--text-primary)' : '1px solid var(--border-primary)',
              }} />
          )
        })}
      </div>
      {token && (
        <button type="button" onClick={onUnlink} title={t('studio.theme.unlink')} aria-label={t('studio.theme.unlink')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
          <Unlink size={13} />
        </button>
      )}
    </div>
  )
}
