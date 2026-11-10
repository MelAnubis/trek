import { useEffect, useMemo, useRef, useState } from 'react'
import { Plane, X } from 'lucide-react'
import { airportsApi } from '../../api/client'
import { useTranslation } from '../../i18n'

export interface Airport {
  iata: string
  icao: string | null
  name: string
  city: string
  country: string
  lat: number
  lng: number
  tz: string
}

interface Props {
  value: Airport | null
  onChange: (airport: Airport | null) => void
  placeholder?: string
  style?: React.CSSProperties
}

function formatLabel(a: Airport) {
  return `${a.city || a.name} (${a.iata})`
}

export default function AirportSelect({ value, onChange, placeholder, style }: Props) {
  const { t, locale } = useTranslation()
  const countryName = useMemo(() => {
    try { return new Intl.DisplayNames([locale || 'en'], { type: 'region' }) } catch { return null }
  }, [locale])
  const displayCountry = (code: string) => {
    if (!code) return ''
    try { return countryName?.of(code) || code } catch { return code }
  }
  const [query, setQuery] = useState(value ? formatLabel(value) : '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Airport[]>([])
  const [highlight, setHighlight] = useState(-1)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setQuery(value ? formatLabel(value) : '')
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2 || (value && trimmed === formatLabel(value))) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      try {
        const data = await airportsApi.search(trimmed, controller.signal)
        setResults(Array.isArray(data) ? data : [])
        setHighlight(-1)
      } catch (err: any) {
        if (err?.name !== 'AbortError' && err?.name !== 'CanceledError') {
          setResults([])
        }
      } finally {
        setLoading(false)
      }
    }, 220)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, value])

  const pick = (a: Airport) => {
    onChange(a)
    setQuery(formatLabel(a))
    setOpen(false)
    setResults([])
  }

  const clear = () => {
    onChange(null)
    setQuery('')
    setResults([])
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(results[highlight]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <div className="!flex !items-center !gap-[6px] !p-[8px_10px] ![background:var(--bg-tertiary)] !rounded-[10px] ![border:1px_solid_var(--border-primary)]">
        <Plane size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <input className="!flex-[1] !min-w-[0] ![background:transparent] ![border:none] ![outline:none] ![color:var(--text-primary)] !text-[length:13px]"
          type="text"
          value={query}
          placeholder={placeholder ?? t('airport.searchPlaceholder')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (value) onChange(null) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {value && (
          <button className="![background:transparent] ![border:none] !p-[2px] !cursor-pointer ![color:var(--text-faint)] !flex" type="button" onClick={clear} aria-label="Clear">
            <X size={14} />
          </button>
        )}
      </div>

      {open && (loading || results.length > 0) && (
        <div className="!absolute !top-[calc(100%_+_4px)] !left-[0] !right-[0] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_8px_24px_rgba(0,0,0,0.18)] !max-h-[260px] !overflow-y-auto !z-[1000]">
          {loading && results.length === 0 && (
            <div className="!p-[10px] !text-[length:12px] ![color:var(--text-faint)]">{t('common.loading')}</div>
          )}
          {results.map((a, i) => (
            <button
              key={a.iata}
              type="button"
              onClick={() => pick(a)}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: i === highlight ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
            >
              <span className="![font-family:ui-monospace,_SFMono-Regular,_monospace] !text-[length:11px] !font-[700] ![color:var(--text-muted)] !min-w-[32px]">{a.iata}</span>
              <span className="!flex-[1] !min-w-[0]">
                <div className="!text-[length:13px] !font-[500] !whitespace-nowrap !overflow-hidden !text-ellipsis">{a.city || a.name}</div>
                <div className="!text-[length:11px] ![color:var(--text-faint)] !whitespace-nowrap !overflow-hidden !text-ellipsis">{a.name}{a.country ? ` · ${displayCountry(a.country)}` : ''}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
