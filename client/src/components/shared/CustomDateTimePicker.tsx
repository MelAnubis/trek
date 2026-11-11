import React, { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { Calendar, Clock, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react'
import { useTranslation } from '../../i18n'

function daysInMonth(year: number, month: number): number { return new Date(year, month + 1, 0).getDate() }
function getWeekday(year: number, month: number, day: number): number { return new Date(year, month, day).getDay() }

interface CustomDatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
  compact?: boolean
  borderless?: boolean
}

export function CustomDatePicker({ value, onChange, placeholder, style = {}, compact = false, borderless = false }: CustomDatePickerProps) {
  const { locale, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const parsed = value ? new Date(value + 'T00:00:00Z') : null
  const [viewYear, setViewYear] = useState(parsed?.getUTCFullYear() || new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.getUTCMonth() ?? new Date().getMonth())

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if (dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open && parsed) { setViewYear(parsed.getUTCFullYear()); setViewMonth(parsed.getUTCMonth()) }
  }, [open])

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1) }

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const days = daysInMonth(viewYear, viewMonth)
  const startDay = (getWeekday(viewYear, viewMonth, 1) + 6) % 7
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1).toLocaleDateString(locale, { weekday: 'narrow' }))

  const displayValue = parsed ? parsed.toLocaleDateString(locale, compact ? { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null

  const selectDay = (day: number) => {
    const y = String(viewYear)
    const m = String(viewMonth + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    onChange(`${y}-${m}-${d}`)
    setOpen(false)
  }

  const selectedDay = parsed && parsed.getUTCFullYear() === viewYear && parsed.getUTCMonth() === viewMonth ? parsed.getUTCDate() : null
  const today = new Date()
  const isToday = (d: number) => today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d

  const [textInput, setTextInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)

  const handleTextSubmit = () => {
    setIsTyping(false)
    if (!textInput.trim()) return
    // Try to parse various date formats
    const input = textInput.trim()
    // ISO: 2026-03-29
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) { onChange(input); return }
    // EU: 29.03.2026 or 29/03/2026
    const euMatch = input.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/)
    if (euMatch) {
      const y = euMatch[3].length === 2 ? 2000 + parseInt(euMatch[3]) : parseInt(euMatch[3])
      onChange(`${y}-${String(euMatch[2]).padStart(2, '0')}-${String(euMatch[1]).padStart(2, '0')}`)
      return
    }
    // Try native Date parse as fallback
    const d = new Date(input)
    if (!isNaN(d.getTime())) {
      onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      {isTyping ? (
        <input className="!w-[100%] !p-[8px_14px] !rounded-[10px] ![background:var(--bg-input)] ![color:var(--text-primary)] !text-[length:13px] ![font-family:inherit] ![outline:none]" autoFocus type="text" value={textInput} onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleTextSubmit(); if (e.key === 'Escape') setIsTyping(false) }}
          onBlur={handleTextSubmit}
          placeholder="DD.MM.YYYY"
          style={{ border: '1px solid var(--text-faint)' }} />
      ) : (
      <button type="button" onClick={() => setOpen(o => !o)} onDoubleClick={() => { setTextInput(value || ''); setIsTyping(true) }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: compact ? 4 : 8,
          padding: compact ? '4px 6px' : '8px 14px', borderRadius: compact ? 4 : 10,
          border: borderless ? 'none' : '1px solid var(--border-primary)',
          background: borderless ? 'transparent' : 'var(--bg-input)', color: displayValue ? 'var(--text-primary)' : 'var(--text-faint)',
          fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-faint)'}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = 'var(--border-primary)' }}>
        {!compact && <Calendar size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
        <span className="!whitespace-nowrap !overflow-hidden !text-ellipsis">{displayValue || placeholder || t('common.date')}</span>
      </button>
      )}

      {open && ReactDOM.createPortal(
        <div ref={dropRef} style={{
          position: 'fixed',
          ...(() => {
            const r = ref.current?.getBoundingClientRect()
            if (!r) return { top: 0, left: 0 }
            const w = 268, pad = 8, h = 360
            const vw = window.innerWidth
            const vh = window.visualViewport?.height ?? window.innerHeight
            let left = r.left
            let top = r.bottom + 4
            if (left + w > vw - pad) left = Math.max(pad, vw - w - pad)
            if (top + h > vh - pad) top = r.top - h - 4
            top = Math.max(pad, Math.min(top, vh - h - pad))
            if (vw < 360) left = Math.max(pad, (vw - w) / 2)
            return { top, left }
          })(),
          zIndex: 99999,
          background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
          borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 12, width: 268,
          maxWidth: 'calc(100vw - 16px)',
          animation: 'selectIn 0.15s ease-out',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        }}>
          {/* Month nav */}
          <div className="!flex !items-center !justify-between !mb-[10px]">
            <button className="trek-hover-text ![background:none] !cursor-pointer !p-[4px] !rounded-[6px] !flex ![color:var(--text-faint)]" type="button" onClick={prevMonth} style={{ border: 'none' }}>
              <ChevronLeft size={16} />
            </button>
            <span className="!text-[length:13px] !font-[600] ![color:var(--text-primary)]">{monthLabel}</span>
            <button className="trek-hover-text ![background:none] !cursor-pointer !p-[4px] !rounded-[6px] !flex ![color:var(--text-faint)]" type="button" onClick={nextMonth} style={{ border: 'none' }}>
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="!grid ![grid-template-columns:repeat(7,_1fr)] !gap-[2px] !mb-[4px]">
            {weekdays.map((d, i) => (
              <div className="!text-center !text-[length:10px] !font-[600] ![color:var(--text-faint)] !p-[2px_0]" key={i}>{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="!grid ![grid-template-columns:repeat(7,_1fr)] !gap-[2px]">
            {Array.from({ length: startDay }, (_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const d = i + 1
              const sel = d === selectedDay
              const td = isToday(d)
              return (
                <button className={[[(!sel) ? 'trek-hover' : undefined, '!w-[32px] !h-[32px] !rounded-[8px] !cursor-pointer !flex !items-center !justify-center ![transition:background_0.1s]'].join(' '), (sel) ? '![background:var(--accent)]' : '![background:transparent]', (sel) ? '![color:var(--accent-text)]' : '![color:var(--text-primary)]', (td && !sel) ? '![outline:2px_solid_var(--border-primary)]' : '![outline:none]', '[&&]:![outline-offset:-2px]'].join(' ')} key={d} type="button" onClick={() => selectDay(d)}
                  style={{ border: 'none', fontSize: 12, fontWeight: sel ? 700 : td ? 600 : 400 }}>
                  {d}
                </button>
              )
            })}
          </div>

          {/* Clear */}
          {value && (
            <div className="!mt-[8px] !flex !justify-center">
              <button className="trek-hover-danger ![background:none] !cursor-pointer !text-[length:11px] ![color:var(--text-faint)] !p-[3px_8px] !rounded-[6px]" type="button" onClick={() => { onChange(''); setOpen(false) }}
                style={{ border: 'none' }}>
                ✕
              </button>
            </div>
          )}
        </div>,
        document.body
      )}

      <style>{`@keyframes selectIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  )
}

interface CustomDateTimePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
}

export function CustomDateTimePicker({ value, onChange, placeholder, style = {} }: CustomDateTimePickerProps) {
  const { locale } = useTranslation()
  const [datePart, timePart] = (value || '').split('T')

  const handleDateChange = (d: string) => {
    onChange(d ? `${d}T${timePart || '12:00'}` : '')
  }
  const handleTimeChange = (t: string) => {
    const d = datePart || new Date().toISOString().split('T')[0]
    onChange(t ? `${d}T${t}` : d)
  }

  return (
    <div style={{ display: 'flex', gap: 8, ...style }}>
      <CustomDatePicker value={datePart || ''} onChange={handleDateChange} style={{ flex: 1, minWidth: 0 }} />
      <div className="!w-[110px] !shrink-[0]">
        <CustomTimePicker value={timePart || ''} onChange={handleTimeChange} />
      </div>
    </div>
  )
}

import CustomTimePicker from './CustomTimePicker'
