import React, { useEffect, useState } from 'react'
import { Cloud, CheckCircle, XCircle, LogOut, RefreshCw, FolderOpen } from 'lucide-react'
import { useToast } from '../shared/Toast'
import Section from './Section'

interface OneDriveStatus {
  connected: boolean
  user?: { name?: string; email?: string }
  authUrl?: string
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const r = await fetch(path, { ...opts, credentials: 'include' })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json()
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
      const [statusData, settingsData] = await Promise.all([
        apiFetch(`${BASE}/status`).catch(() => ({ connected: false })),
        apiFetch(`${BASE}/settings`).catch(() => ({})),
      ])
      setStatus({
        connected: !!statusData?.connected,
        user:      statusData?.user,
        authUrl:   settingsData?.authUrl,
      })
    } catch {
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const params = new URLSearchParams(window.location.search)
    if (params.get('onedrive_connected')) {
      toast.success('OneDrive conectado correctamente')
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('onedrive_error')) {
      toast.error(`Error al conectar OneDrive: ${params.get('onedrive_error')}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const handleConnect = async () => {
    try {
      const data = await apiFetch(`${BASE}/settings`)
      if (data?.authUrl) {
        window.location.href = data.authUrl
      } else {
        toast.error('URL de autorización no disponible')
      }
    } catch {
      toast.error('Error al obtener URL de autorización')
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar OneDrive? Se eliminarán los tokens de acceso.')) return
    setDisconnecting(true)
    try {
      await fetch(`${BASE}/disconnect`, { method: 'DELETE', credentials: 'include' })
      toast.success('OneDrive desconectado')
      setStatus({ connected: false, authUrl: status.authUrl })
    } catch {
      toast.error('Error al desconectar')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Section title="OneDrive Photos" icon={Cloud}>
      {loading ? (
        <div className="!flex !items-center !gap-[8px] !p-[12px_0] ![color:var(--text-tertiary)]">
          <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
          <span className="!text-[length:13px]">Comprobando conexión…</span>
        </div>
      ) : status.connected ? (
        <div className="!flex !flex-col !gap-[12px]">
          <div className="!flex !items-center !gap-[10px] !p-[10px_14px] ![background:#22c55e15] ![border:1px_solid_#22c55e40] !rounded-[8px]">
            <CheckCircle size={18} color="#22c55e" />
            <div className="!flex-[1]">
              <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary)]">
                Conectado a OneDrive
              </div>
              {status.user?.name && (
                <div className="!text-[length:12px] ![color:var(--text-tertiary)] !mt-[2px]">
                  {status.user.name}
                  {status.user.email && ` · ${status.user.email}`}
                </div>
              )}
            </div>
            <button className="!flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-secondary)] !cursor-pointer !text-[length:12px] ![color:var(--text-secondary)]"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting
                ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
                : <LogOut size={12} />}
              Desconectar
            </button>
          </div>
          <div className="!p-[10px_14px] ![background:var(--bg-secondary)] !rounded-[8px] !text-[length:12px] ![color:var(--text-tertiary)] !flex !items-center !gap-[8px]">
            <FolderOpen size={14} />
            Las fotos de OneDrive están disponibles en el selector de fotos de tus viajes
          </div>
        </div>
      ) : (
        <div className="!flex !flex-col !gap-[12px]">
          <div className="!flex !items-center !gap-[10px] !p-[10px_14px] ![background:var(--bg-secondary)] ![border:1px_solid_var(--border-primary)] !rounded-[8px]">
            <XCircle size={18} color="var(--text-tertiary)" />
            <div className="!text-[length:13px] ![color:var(--text-secondary)]">
              No conectado — haz clic para conectar tu cuenta de Microsoft
            </div>
          </div>
          <button className="!flex !items-center !justify-center !gap-[10px] !p-[10px_16px] !rounded-[8px] ![border:none] !cursor-pointer ![background:#0078d4] ![color:#fff] !text-[length:13px] !font-[600] !w-[100%]"
            onClick={handleConnect}
          >
            <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
              <rect x="0" y="0" width="10" height="10" fill="#f25022"/>
              <rect x="11" y="0" width="10" height="10" fill="#7fba00"/>
              <rect x="0" y="11" width="10" height="10" fill="#00a4ef"/>
              <rect x="11" y="11" width="10" height="10" fill="#ffb900"/>
            </svg>
            Conectar con Microsoft
          </button>
          <div className="!text-[length:11px] ![color:var(--text-tertiary)] !leading-[1.5]">
            Se solicitará acceso de solo lectura a tus fotos de OneDrive.
            Tus credenciales se guardan cifradas y no se comparten.
          </div>
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Section>
  )
}
