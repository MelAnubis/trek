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
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard permission denied — the link is still selectable/visible */ }
  }

  async function handleNativeShare() {
    if (!shareUrl) return
    // navigator.share funciona dentro del WebView de Capacitor en Android
    // y abre el selector nativo (WhatsApp, SMS, etc.) sin depender de un
    // plugin adicional.
    if (navigator.share) {
      try { await navigator.share({ title: 'Mi ubicación en vivo', url: shareUrl }) } catch { /* usuario canceló */ }
    } else {
      handleCopy()
    }
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
              Compartir enlace
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

          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Se sigue enviando tu posición mientras la app esté abierta (en primer o segundo plano).
          </p>
        </div>
      )}
    </Section>
  )
}
