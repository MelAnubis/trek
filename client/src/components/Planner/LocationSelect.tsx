import { useEffect, useRef, useState } from 'react'
import { MapPin, X } from 'lucide-react'
import { mapsApi } from '../../api/client'
import { useTranslation } from '../../i18n'

export interface LocationPoint {
  name: string
  lat: number
  lng: number
  address?: string | null
}

interface Props {
  value: LocationPoint | null
  onChange: (loc: LocationPoint | null) => void
  placeholder?: string
  style?: React.CSSProperties
}

export default function LocationSelect({ value, onChange, placeholder, style }: Props) {
  const { t, locale } = useTranslation()
  const [query, setQuery] = useState(value?.name || '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<any[]>([])
  const [highlight, setHighlight] = useState(-1)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setQuery(value?.name || '')
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
    if (trimmed.length < 3 || (value && trimmed === value.name)) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await mapsApi.search(trimmed, locale)
        setResults(data.places || [])
        setHighlight(-1)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 320)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, value, locale])

  const pick = (r: any) => {
    const lat = Number(r.lat)
    const lng = Number(r.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const loc: LocationPoint = { name: r.name || r.address || 'Location', lat, lng, address: r.address || null }
    onChange(loc)
    setQuery(loc.name)
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
        <MapPin size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <input className="!flex-[1] !min-w-[0] ![background:transparent] ![border:none] ![outline:none] ![color:var(--text-primary)] !text-[length:13px]"
          type="text"
          value={query}
          placeholder={placeholder ?? t('reservations.searchLocation')}
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
          {results.map((r, i) => (
            <button
              key={`${r.osm_id || r.google_place_id || i}`}
              type="button"
              onClick={() => pick(r)}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%',
                padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: i === highlight ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
            >
              <MapPin size={12} style={{ color: 'var(--text-faint)', marginTop: 2, flexShrink: 0 }} />
              <span className="!flex-[1] !min-w-[0]">
                <div className="!text-[length:13px] !font-[500] !whitespace-nowrap !overflow-hidden !text-ellipsis">{r.name || r.address}</div>
                {r.address && r.name !== r.address && (
                  <div className="!text-[length:11px] ![color:var(--text-faint)] !whitespace-nowrap !overflow-hidden !text-ellipsis">{r.address}</div>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
