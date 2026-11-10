import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'

/** Options carry ids as often as text: both are compared with === as given. */
export type SelectValue = string | number

export interface SelectOption {
  value: SelectValue
  label: string
  icon?: React.ReactNode
  isHeader?: boolean
  searchLabel?: string
  groupLabel?: string
  badge?: string
}

interface CustomSelectProps {
  value: SelectValue | null | undefined
  // The value of the option picked, as given in `options` (string or number).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any) => void
  options?: SelectOption[]
  placeholder?: string
  searchable?: boolean
  style?: React.CSSProperties
  size?: 'sm' | 'md'
  disabled?: boolean
}

export default function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = '',
  searchable = false,
  style = {},
  size = 'md',
  disabled = false,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && searchable && searchRef.current) searchRef.current.focus()
  }, [open, searchable])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if (dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selected = options.find(o => o.value === value)
  const filtered = searchable && search
    ? (() => {
        const q = search.toLowerCase()
        const result: SelectOption[] = []
        let currentHeader: SelectOption | null = null
        let headerAdded = false
        for (const o of options) {
          if (o.isHeader) {
            currentHeader = o
            headerAdded = false
            continue
          }
          const haystack = [o.label, o.searchLabel, o.groupLabel].filter(Boolean).join(' ').toLowerCase()
          if (haystack.includes(q)) {
            if (currentHeader && !headerAdded) {
              result.push(currentHeader)
              headerAdded = true
            }
            result.push(o)
          }
        }
        return result
      })()
    : options

  const sm = size === 'sm'

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(o => !o); setSearch('') } }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: sm ? '8px 12px' : '8px 14px', borderRadius: 10,
          border: '1px solid var(--border-primary)',
          background: 'var(--bg-input)', color: 'var(--text-primary)',
          fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
          cursor: disabled ? 'default' : 'pointer', outline: 'none', textAlign: 'left',
          transition: 'border-color 0.15s', overflow: 'hidden', minWidth: 0,
          opacity: disabled ? 0.5 : 1,
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = 'var(--text-faint)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = 'var(--border-primary)' }}
      >
        {selected?.icon && <span className="!flex !shrink-[0]">{selected.icon}</span>}
        <span className="!flex-[1] !overflow-hidden !text-ellipsis !whitespace-nowrap" style={{ color: selected ? 'var(--text-primary)' : 'var(--text-faint)' }}>
          {selected ? selected.label : placeholder}
        </span>
        {selected?.badge && (
          <span className="!shrink-[0] !text-[length:10px] !font-[600] ![color:var(--text-muted)] ![background:var(--bg-tertiary)] !p-[2px_7px] !rounded-[999px] !tracking-[0.01em]">{selected.badge}</span>
        )}
        <ChevronDown size={sm ? 12 : 14} style={{ flexShrink: 0, color: 'var(--text-faint)', transition: 'transform 200ms cubic-bezier(0.23,1,0.32,1)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {/* Dropdown */}
      {open && ReactDOM.createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          ...(() => {
            const r = ref.current?.getBoundingClientRect()
            if (!r) return { top: 0, left: 0, width: 200 }
            const spaceBelow = window.innerHeight - r.bottom
            const openUp = spaceBelow < 220 && r.top > spaceBelow
            return openUp
              ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width }
              : { top: r.bottom + 4, left: r.left, width: r.width }
          })(),
          zIndex: 99999,
          background: 'var(--modal-bg)',
          backdropFilter: 'var(--glass-blur-lg)',
          WebkitBackdropFilter: 'var(--glass-blur-lg)',
          border: '1px solid var(--modal-border)',
          borderRadius: 12,
          boxShadow: 'var(--glass-shadow-lg)',
          overflow: 'hidden',
          animation: 'trek-menu-enter 200ms cubic-bezier(0.23, 1, 0.32, 1)',
          transformOrigin: 'top center',
          willChange: 'transform, opacity',
        }}>
          {/* Search */}
          {searchable && (
            <div className="!p-[6px_6px_2px]">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="..."
                style={{
                  width: '100%', border: '1px solid var(--border-secondary)', borderRadius: 6,
                  padding: '5px 8px', fontSize: 12, outline: 'none', fontFamily: 'inherit',
                  background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* Options */}
          <div className="!max-h-[220px] !overflow-y-auto !p-[4px]">
            {filtered.length === 0 ? (
              <div className="!p-[10px_12px] !text-[length:12px] ![color:var(--text-faint)] !text-center">—</div>
            ) : (
              filtered.map(option => {
                if (option.isHeader) {
                  return (
                    <div className="!p-[5px_10px] !text-[length:10px] !font-[700] ![color:var(--text-faint)] !uppercase !tracking-[0.03em] ![background:var(--bg-tertiary)] !rounded-[4px] !m-[2px_0]" key={option.value}>
                      {option.label}
                    </div>
                  )
                }
                const isSelected = option.value === value
                return (
                  <button className="trek-hover !w-[100%] !flex !items-center !gap-[8px] !p-[7px_10px] !rounded-[6px] ![color:var(--text-primary)] !text-[length:13px] ![font-family:inherit] !cursor-pointer !text-left ![transition:background_0.1s]"
                    key={option.value}
                    type="button"
                    onClick={() => { onChange(option.value); setOpen(false); setSearch('') }}
                    style={{ border: 'none', background: isSelected ? 'var(--bg-hover)' : 'transparent' }} >
                    {option.icon && <span className="!flex !shrink-[0]">{option.icon}</span>}
                    <span className="!flex-[1] !overflow-hidden !text-ellipsis !whitespace-nowrap">{option.label}</span>
                    {option.badge && (
                      <span className="!shrink-[0] !text-[length:10px] !font-[600] ![color:var(--text-muted)] ![background:var(--bg-tertiary)] !p-[2px_7px] !rounded-[999px] !tracking-[0.01em]">{option.badge}</span>
                    )}
                    {isSelected && <Check size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />}
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  )
}
