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
      <div className="!fixed !inset-[0] !z-[1100] ![background:rgba(0,0,0,0.4)] ![backdrop-filter:blur(2px)]"
        onClick={onClose}
      />

      <div className="!fixed !top-[0] !right-[0] !bottom-[0] !z-[1101] !w-[min(820px,_90vw)] ![background:var(--bg-primary)] ![box-shadow:-8px_0_32px_rgba(0,0,0,0.25)] !flex !flex-col" style={{ animation: 'slideInRight 0.22s cubic-bezier(0.23,1,0.32,1)' }}>

        <div className="!flex !items-center !gap-[10px] !p-[12px_16px] ![border-bottom:1px_solid_var(--border-secondary)] !shrink-[0]">
          <span className="!text-[length:16px]">🚴</span>
          <span className="!font-[700] !text-[length:14px] ![color:var(--text-primary)] !flex-[1]">
            Bikepack
          </span>

          <button className="!flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[8px] ![background:#0d9488] ![color:#fff] ![border:none] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit]"
            onClick={() => { onClose(); setTimeout(onImport, 150) }}
          >
            <Download size={13} />
            Importar a este viaje
          </button>

          <button className="!flex !items-center !justify-center !w-[30px] !h-[30px] !rounded-[8px] ![border:none] ![background:var(--bg-hover)] ![color:var(--text-muted)] !cursor-pointer"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <div className="!flex-[1] !overflow-y-auto">
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
