/**
 * Pestaña de Settings para compartir la ubicación en vivo mediante un
 * enlace público — no depende de ningún Trip, cualquiera con el enlace
 * puede ver dónde estás sin necesitar cuenta en Trek.
 */
import React, { useState } from 'react'
import { MapPinned, Copy, Check, Square, Play } from 'lucide-react'
import Section from './Section'
import { useLiveLocationShare } from '../../hooks/useLiveLocationShare'

export default function LiveLocationTab(): React.ReactElement {
  const { sharing, loading, shareUrl, error, start, stop } = useLiveLocationShare()
  const [copied, setCopied] = useState(false)
  const [shareFailed, setShareFailed] = useState(false)
  const [starting, setStarting] = useState(false)

  async function handleStart() {
    setStarting(true)
    await start()
    setStarting(false)
  }

  async function handleCopy() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Portapapeles bloqueado (sin permiso en el WebView) — el enlace sigue
      // visible/seleccionable arriba, pero avisamos para que no parezca que
      // el botón no hizo nada.
      setShareFailed(true)
      setTimeout(() => setShareFailed(false), 3000)
    }
  }

  async function handleNativeShare() {
    if (!shareUrl) return
    try {
      // @capacitor/share abre el selector nativo de Android (WhatsApp, SMS,
      // email, etc.) vía Intent.ACTION_SEND. navigator.share del WebView es
      // poco fiable (falta o falla en muchas builds de Android System
      // WebView), así que este plugin es el que de verdad abre algo dentro
      // de la app nativa; en el navegador/PWA usa navigator.share por debajo.
      const { Share } = await import('@capacitor/share')
      await Share.share({
        title: 'Mi ubicación en vivo',
        url: shareUrl,
        dialogTitle: 'Compartir ubicación en vivo',
      })
      return
    } catch (e) {
      // El usuario canceló el selector — no es un fallo, no hagas nada.
      const message = e instanceof Error ? e.message : String(e)
      if (/cancel/i.test(message)) return
      // Cualquier otro fallo (API no soportada, plugin bloqueado, etc.):
      // cae a copiar el enlace en vez de quedarse en silencio.
    }
    await handleCopy()
  }

  return (
    <Section title="Ubicación en vivo" icon={MapPinned}>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Comparte un enlace para que cualquiera pueda ver dónde estás en tiempo real, sin necesitar cuenta en Trek.
        El enlace deja de funcionar 24 horas después de crearlo, o en cuanto pulses "Dejar de compartir".
      </p>

      {error && (
        <div className="text-sm rounded-lg px-3 py-2" style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}>
          {error}
        </div>
      )}

      {!loading && !sharing && (
        <button
          onClick={handleStart}
          disabled={starting}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'white', opacity: starting ? 0.6 : 1 }}
        >
          <Play className="w-4 h-4" />
          {starting ? 'Iniciando…' : 'Compartir mi ubicación'}
        </button>
      )}

      {!loading && sharing && shareUrl && (
        <div className="space-y-3">
          <div
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm"
            style={{ background: 'var(--glass-bg-subtle)', border: '1px solid var(--glass-border-inner)', color: 'var(--text-primary)' }}
          >
            <span className="flex-1 truncate">{shareUrl}</span>
            <button onClick={handleCopy} aria-label="Copiar enlace" style={{ color: 'var(--text-secondary)' }}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleNativeShare}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              {copied ? '¡Enlace copiado!' : 'Compartir enlace'}
            </button>
            <button
              onClick={stop}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
            >
              <Square className="w-3.5 h-3.5" />
              Dejar de compartir
            </button>
          </div>

          {shareFailed && (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              No se pudo compartir ni copiar el enlace automáticamente. Selecciónalo arriba y cópialo a mano.
            </p>
          )}

          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Se sigue enviando tu posición mientras la app esté abierta (en primer o segundo plano).
          </p>
        </div>
      )}
    </Section>
  )
}
