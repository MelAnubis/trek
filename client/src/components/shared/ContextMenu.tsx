import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { LucideIcon } from 'lucide-react'

interface MenuItem {
  label?: string
  icon?: LucideIcon
  onClick?: () => void
  danger?: boolean
  divider?: boolean
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  /** Open at a given point (a long press, or under a "⋯" button). The menu moves itself to fit on screen. */
  const openAt = (point: { x: number; y: number }, items: MenuItem[]) => setMenu({ x: point.x, y: point.y, items })

  const close = () => setMenu(null)

  return { menu, open, openAt, close }
}

interface ContextMenuProps {
  menu: MenuState | null
  onClose: () => void
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const handler = () => onClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('click', handler)
    document.addEventListener('contextmenu', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', handler)
      document.removeEventListener('contextmenu', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  useEffect(() => {
    if (!menu || !ref.current) return
    const el = ref.current
    const rect = el.getBoundingClientRect()
    let { x, y } = menu
    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8
    if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8
    if (x !== menu.x || y !== menu.y) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [menu])

  if (!menu) return null

  return ReactDOM.createPortal(
    <div ref={ref} className="trek-popover-enter trek-ctx-menu" style={{
      position: 'fixed', left: menu.x, top: menu.y, zIndex: 999999,
      background: 'var(--modal-bg)',
      backdropFilter: 'var(--glass-blur-lg)',
      WebkitBackdropFilter: 'var(--glass-blur-lg)',
      border: '1px solid var(--modal-border)',
      boxShadow: 'var(--glass-shadow-lg)',
      borderRadius: 12, padding: '4px',
      minWidth: 160,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
      transformOrigin: 'top left',
    }}>
      {menu.items.filter(Boolean).map((item, i) => {
        if (item.divider) return <div className="!h-[1px] ![background:var(--border-faint)] !m-[3px_6px]" key={i} />
        const Icon = item.icon
        return (
          <button key={i} onClick={() => { item.onClick?.(); onClose() }}
            className={`trek-ctx-item${item.danger ? ' is-danger' : ''}`}>
            {Icon && <Icon size={13} className="trek-ctx-icon" />}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
