/**
 * Voice announcements for navigation and recording.
 *
 * Inside the Android app it speaks through the native text-to-speech plugin
 * (@capacitor-community/text-to-speech), which keeps talking with the screen
 * off: the Android WebView has no usable speechSynthesis. An app built before
 * the plugin was added (or the browser) falls back to speechSynthesis, and if
 * neither exists it stays silent — voice is never what breaks navigation.
 */
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech'

const MUTE_KEY = 'trek_nav_voice_muted'
const LANG = 'es-ES'

let muted = readMuted()
let nativeBroken = false

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

function isNativeApp(): boolean {
  return typeof window !== 'undefined' &&
    !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}

function speakWeb(text: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = LANG
    window.speechSynthesis.speak(u)
  } catch { /* no voice available */ }
}

export const navVoice = {
  isMuted(): boolean { return muted },

  setMuted(v: boolean): void {
    muted = v
    try { localStorage.setItem(MUTE_KEY, v ? '1' : '0') } catch { /* noop */ }
    if (v) navVoice.stop()
  },

  /** Speaks a sentence, queued after whatever is being said. Never throws. */
  speak(text: string): void {
    if (muted || !text) return
    if (isNativeApp() && !nativeBroken) {
      TextToSpeech.speak({ text, lang: LANG, rate: 1.0, queueStrategy: QueueStrategy.Add })
        .catch(() => {
          // Plugin missing from this APK (built before it was added): use the web voice from now on.
          nativeBroken = true
          speakWeb(text)
        })
      return
    }
    speakWeb(text)
  },

  stop(): void {
    if (isNativeApp() && !nativeBroken) TextToSpeech.stop().catch(() => {})
    try { window.speechSynthesis?.cancel() } catch { /* noop */ }
  },
}

// ── Sentences ─────────────────────────────────────────────────────────────────

/** "3,5 kilómetros" / "800 metros", as it should be read aloud. */
export function spokenDistance(m: number): string {
  if (m < 1000) {
    const r = m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50
    return `${r} metros`
  }
  const km = m / 1000
  if (km >= 10 || Math.abs(km - Math.round(km)) < 0.05) {
    const k = Math.round(km)
    return k === 1 ? '1 kilómetro' : `${k} kilómetros`
  }
  return `${km.toFixed(1).replace('.', ',')} kilómetros`
}

export function spokenDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return m === 1 ? '1 minuto' : `${m} minutos`
  const hs = h === 1 ? '1 hora' : `${h} horas`
  return m === 0 ? hs : `${hs} y ${m} minutos`
}

/** What a turn instruction says aloud: "gira a la izquierda", "en la rotonda"… */
export function spokenManeuver(type: string, modifier?: string): string {
  if (type === 'arrive') return 'llegarás al final de la ruta'
  if (type === 'roundabout' || type === 'rotary') return 'entra en la rotonda'
  switch (modifier) {
    case 'left': return 'gira a la izquierda'
    case 'right': return 'gira a la derecha'
    case 'sharp left': return 'gira fuerte a la izquierda'
    case 'sharp right': return 'gira fuerte a la derecha'
    case 'slight left': return 'ligeramente a la izquierda'
    case 'slight right': return 'ligeramente a la derecha'
    case 'uturn': return 'da media vuelta'
    default: return 'continúa recto'
  }
}
