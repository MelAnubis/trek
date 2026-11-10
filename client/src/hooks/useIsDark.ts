import { useEffect, useState } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { resolveDark } from '../theme/appearance'

const QUERY = '(prefers-color-scheme: dark)'
function systemPrefersDark(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY)?.matches } catch { return false }
}

/**
 * Whether the app is drawn dark right now, from the `dark_mode` setting
 * (true / 'dark' / 'light' / 'auto'). With 'auto' it follows the system and
 * re-renders when the system theme changes, which the old inline checks
 * (`darkMode === 'auto' && matchMedia(...).matches`) never did.
 */
export function useIsDark(): boolean {
  const darkMode = useSettingsStore(s => s.settings.dark_mode)
  const [systemDark, setSystemDark] = useState(() => darkMode === 'auto' && systemPrefersDark())

  useEffect(() => {
    if (darkMode !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    if (!mq) return
    const onChange = () => setSystemDark(!!mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [darkMode])

  return darkMode === 'auto' ? systemDark : resolveDark(darkMode)
}
