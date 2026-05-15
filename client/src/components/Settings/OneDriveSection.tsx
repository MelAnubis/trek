/**
 * OneDriveSection.tsx
 * Settings panel for OneDrive Photos integration
 * Uses OAuth flow instead of API key fields
 */
import React, { useEffect, useState } from 'react'
import { Cloud, CheckCircle, XCircle, LogOut, RefreshCw, FolderOpen } from 'lucide-react'
import apiClient from '../../api/client'
import { useToast } from '../shared/Toast'
import Section from './Section'

interface OneDriveStatus {
  connected: boolean
  user?: { name?: string; email?: string }
  authUrl?: string
}

export default function OneDriveSection() {
  const toast = useToast()
  const [status, setStatus] = useState<OneDriveStatus>({ connected: false })
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)

  const BASE = '/api/integrations/memories/onedrive'

  const load = async () => {
    setLoading(true)
    try {
      const [statusRes, settingsRes] = await Promise.all([
        apiClient.get(`${BASE}/status`).catch(() => ({ data: { connected: false } })),
        apiClient.get(`${BASE}/settings`).catch(() => ({ data: {} })),
      ])
      setStatus({
        connected: !!statusRes.data?.connected,
        user:      statusRes.data?.user,
        authUrl:   settingsRes.data?.authUrl,
      })
    } catch {
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Handle redirect back from Microsoft OAuth
    const params = new URLSearchParams(window.location.search)
    if (params.get('onedrive_connected')) {
      toast.success('OneDrive conectado correctamente')
      window.history.replaceState({}, '', window.location.pathname)
      load()
    }
    if (params.get('onedrive_error')) {
      toast.error(`Error al conectar OneDrive: ${params.get('onedrive_error')}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const handleConnect = async () => {
    try {
      const res = await apiClient.get(`${BASE}/auth-url`)
      if (res.data?.url) {
        window.location.href = res.data.url
      }
    } catch {
      toast.error('No se pudo obtener la URL de autorización')
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar OneDrive? Se eliminarán los tokens de acceso.')) return
    setDisconnecting(true)
    try {
      await apiClient.delete(`${BASE}/disconnect`)
      toast.success('OneDrive desconectado')
      setStatus({ connected: false })
      await load()
    } catch {
      toast.error('Error al desconectar')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Section
      title="OneDrive Photos"
      description="Conecta tu OneDrive de Microsoft para usar tus fotos en Trek"
      icon={<Cloud size={18} />}
    >
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0',
                      color: 'var(--text-tertiary)' }}>
          <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 13 }}>Comprobando conexión…</span>
        </div>
      ) : status.connected ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Connected state */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            background: '#22c55e15',
            border: '1px solid #22c55e40',
            borderRadius: 8,
          }}>
            <CheckCircle size={18} color="#22c55e" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Conectado a OneDrive
              </div>
              {status.user?.name && (
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {status.user.name}
                  {status.user.email && ` · ${status.user.email}`}
                </div>
              )}
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 6,
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-secondary)',
                cursor: 'pointer', fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              {disconnecting
                ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                : <LogOut size={12} />}
              Desconectar
            </button>
          </div>

          <div style={{
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <FolderOpen size={14} />
            Las fotos de OneDrive están disponibles en el selector de fotos de tus viajes
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Disconnected state */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: 8,
          }}>
            <XCircle size={18} color="var(--text-tertiary)" />
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              No conectado
            </div>
          </div>

          <button
            onClick={handleConnect}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '10px 16px', borderRadius: 8,
              border: 'none', cursor: 'pointer',
              background: '#0078d4',
              color: '#fff',
              fontSize: 13, fontWeight: 600,
              width: '100%',
            }}
          >
            {/* Microsoft logo SVG */}
            <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
              <rect x="0" y="0" width="10" height="10" fill="#f25022"/>
              <rect x="11" y="0" width="10" height="10" fill="#7fba00"/>
              <rect x="0" y="11" width="10" height="10" fill="#00a4ef"/>
              <rect x="11" y="11" width="10" height="10" fill="#ffb900"/>
            </svg>
            Conectar con Microsoft
          </button>

          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Se solicitará acceso de solo lectura a tus fotos de OneDrive.
            Tus credenciales se guardan cifradas y no se comparten.
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Section>
  )
}
