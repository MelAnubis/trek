import { useEffect } from 'react'
import { X, Download } from 'lucide-react'
import ReactDOM from 'react-dom'
import BikepackApp from '../Bikepack/BikepackApp'

interface Props {
  onClose: () => void
  onImport: () => void
}

export default function BikepackDrawer({ onClose, onImport }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const drawer = (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)',
        }}
      />

      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1101,
        width: 'min(820px, 90vw)',
        background: 'var(--bg-primary)',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.22s cubic-bezier(0.23,1,0.32,1)',
      }}>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-secondary)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 16 }}>🚴</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', flex: 1 }}>
            Bikepack
          </span>

          <button
            onClick={() => { onClose(); setTimeout(onImport, 150) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 8,
              background: '#0d9488', color: '#fff',
              border: 'none', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Download size={13} />
            Importar a este viaje
          </button>

          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 8,
              border: 'none', background: 'var(--bg-hover)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <BikepackApp />
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )

  return ReactDOM.createPortal(drawer, document.body)
}
