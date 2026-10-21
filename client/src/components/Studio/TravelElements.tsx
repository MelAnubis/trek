import type { CSSProperties } from 'react'
import * as LucideIcons from 'lucide-react'
import { Map as MapIcon, Route, CalendarDays, Footprints, Camera, Flag, MapPin, Compass, TrendingUp, TrendingDown, Wallet, Check, Hotel } from 'lucide-react'
import type { BookAccommodationElement, BookBadgeElement, BookCountriesElement, BookIconElement, BookListElement, BookListItem, BookMapElement, BookMetric, BookPackingElement, BookPlacesElement, BookStatsElement } from '../../types/book'
import { fontStack } from './bookFonts'
import { frameStyle } from './SpreadView'
import { FlagSilhouette } from './flagGlyphs'
import { COUNTRY_SHAPES } from './countryShapes'
import { FLAG_H, FLAG_W, flagBands, flagDisc, flagSpec } from './flags'

/**
 * The travel-specific element renderers — map, stats, countries, badge,
 * icon, list. Ported (simplified — see each element's own type comment in
 * types/book.ts for what was cut and why) from liketrek/trek's
 * client/src/components/Studio/TravelElements.tsx (same AGPLv3 license).
 * `ElementView` (SpreadView.tsx) dispatches into these the same way it does
 * for photo/text/shape/image.
 */

// ── icon ─────────────────────────────────────────────────────────────────────

export function IconView({ el }: { el: BookIconElement }) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ style?: CSSProperties; color?: string; strokeWidth?: number }>>)[el.name]
  return (
    <div style={{ ...frameStyle(el), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {Icon
        ? <Icon color={el.color} strokeWidth={el.lineWidth} style={{ width: '100%', height: '100%' }} />
        : null /* an unrecognised name (e.g. a lucide export renamed since the book was saved) draws nothing rather than an error glyph */}
    </div>
  )
}

// ── map ──────────────────────────────────────────────────────────────────────

/** Before the first render finishes (or if it failed) — a neutral placeholder, never a broken-image icon. */
export function MapView({ el }: { el: BookMapElement }) {
  if (!el.src) {
    return (
      <div style={{ ...frameStyle(el), background: '#eef0ea', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: el.radius ? `${el.radius}mm` : undefined }}>
        <MapIcon style={{ width: '22%', height: '22%' }} color="rgba(0,0,0,.28)" />
      </div>
    )
  }
  return (
    <img
      src={el.src}
      alt=""
      draggable={false}
      style={{ ...frameStyle(el), objectFit: el.fit, borderRadius: el.radius ? `${el.radius}mm` : undefined, display: 'block' }}
    />
  )
}

// ── stats ────────────────────────────────────────────────────────────────────

const METRIC_ICON: Record<BookMetric, React.ComponentType<{ style?: CSSProperties; color?: string }>> = {
  distance: Route, days: CalendarDays, steps: Footprints, photos: Camera, countries: Flag, places: MapPin, furthest: Compass,
  elevationGain: TrendingUp, elevationLoss: TrendingDown, budget: Wallet,
}

const METRIC_LABEL: Record<BookMetric, string> = {
  distance: 'Distance', days: 'Days', steps: 'Steps', photos: 'Photos', countries: 'Countries', places: 'Places', furthest: 'Furthest',
  elevationGain: 'Elevation gain', elevationLoss: 'Elevation loss', budget: 'Spent',
}

/**
 * Distance/furthest are stored in metres and shown as km; elevation
 * gain/loss are also stored in metres but shown as-is — a day's climb
 * rarely reaches a whole kilometre. `budget` is a plain currency amount —
 * `currency` is the element's own ISO 4217 code (see BookStatsElement),
 * falling back to a bare number if the element somehow has none (an old
 * book saved before this metric existed, or a manually-added one). Every
 * other metric is a plain count, per the schema's own comment.
 */
export function formatMetricValue(metric: BookMetric, value: number, units: 'metric' | 'imperial', currency?: string | null): string {
  if (metric === 'distance' || metric === 'furthest') {
    const km = value / 1000
    return units === 'imperial' ? `${Math.round(km * 0.621371).toLocaleString()} mi` : `${Math.round(km).toLocaleString()} km`
  }
  if (metric === 'elevationGain' || metric === 'elevationLoss') {
    return units === 'imperial' ? `${Math.round(value * 3.28084).toLocaleString()} ft` : `${Math.round(value).toLocaleString()} m`
  }
  if (metric === 'budget') {
    if (!currency) return Math.round(value).toLocaleString()
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
    } catch {
      return `${Math.round(value).toLocaleString()} ${currency}`
    }
  }
  return Math.round(value).toLocaleString()
}

export function StatsView({ el }: { el: BookStatsElement }) {
  const metrics = el.metrics.filter(m => el.values[m] != null)
  const isGrid = el.layout === 'grid'
  return (
    <div
      style={{
        ...frameStyle(el),
        display: 'flex',
        flexDirection: el.layout === 'column' ? 'column' : 'row',
        flexWrap: isGrid ? 'wrap' : 'nowrap',
        alignContent: 'flex-start',
        gap: '3mm',
        overflow: 'hidden',
      }}
    >
      {metrics.map(m => {
        const Icon = METRIC_ICON[m]
        return (
          <div
            key={m}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: el.layout === 'row' ? 'center' : 'flex-start',
              width: isGrid ? `${Math.max(20, el.frame.w / Math.ceil(metrics.length / 2) - 3)}mm` : undefined,
            }}
          >
            {el.showIcons && <Icon style={{ width: '5mm', height: '5mm', marginBottom: '1mm' }} color={el.accent} />}
            <span style={{ fontFamily: fontStack(el.font), fontSize: '5mm', fontWeight: 700, color: el.accent, lineHeight: 1 }}>
              {formatMetricValue(m, el.values[m]!, el.units, el.currency)}
            </span>
            <span style={{ fontFamily: fontStack(el.font), fontSize: '2.2mm', color: el.color, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {METRIC_LABEL[m]}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── places ───────────────────────────────────────────────────────────────────

export function PlacesView({ el }: { el: BookPlacesElement }) {
  const justify = el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start'
  return (
    <div
      style={{
        ...frameStyle(el),
        display: 'flex',
        flexDirection: el.layout === 'grid' ? 'row' : 'column',
        flexWrap: el.layout === 'grid' ? 'wrap' : 'nowrap',
        justifyContent: justify,
        alignItems: el.layout === 'grid' ? 'flex-start' : justify,
        gap: '3mm',
        overflow: 'hidden',
      }}
    >
      {el.places.map((p, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.5mm', textAlign: el.align }}>
          <span style={{ fontFamily: fontStack(el.font), fontSize: '3mm', fontWeight: 700, color: el.color }}>{p.name}</span>
          {p.note && (
            <span style={{ fontFamily: fontStack(el.font), fontSize: '2.4mm', color: el.color, opacity: 0.65 }}>{p.note}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── badge ────────────────────────────────────────────────────────────────────

export function BadgeView({ el }: { el: BookBadgeElement }) {
  const side = Math.min(el.frame.w, el.frame.h)
  const textSize = side * 0.28
  const subSize = textSize * 0.45
  const font = fontStack(el.font)
  const isFlag = el.variant === 'flag' || el.variant === 'country'
  const glyphSize = `${side * (el.style === 'stacked' ? 0.42 : 0.32)}mm`

  const stack: CSSProperties = { ...frameStyle(el), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', gap: isFlag ? '1.5mm' : 0 }

  const glyph = (chipContrast?: boolean) => {
    if (!isFlag) return null
    if (!el.code) return <FlagSilhouette color={chipContrast ? '#ffffff' : el.accent} size={glyphSize} />
    // The real flag where it can be drawn exactly, else the country's own
    // outline (never an invented pattern — a wrong flag is worse than none).
    return <FlagMark code={el.code} size={side * (el.style === 'stacked' ? 0.42 : 0.32)} color={chipContrast ? '#ffffff' : el.accent} />
  }

  if (el.style === 'chip') {
    return (
      <div style={{ ...stack, background: el.accent, borderRadius: '999mm', padding: '2mm 4mm' }}>
        {glyph(true)}
        <span style={{ fontFamily: font, fontSize: `${textSize}mm`, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>{el.text}</span>
        {el.sub && <span style={{ fontFamily: font, fontSize: `${subSize}mm`, color: '#ffffff', opacity: 0.85, marginTop: '1mm' }}>{el.sub}</span>}
      </div>
    )
  }
  if (el.style === 'outline') {
    return (
      <div style={{ ...stack, border: `0.3mm solid ${el.accent}`, borderRadius: '2mm' }}>
        {glyph()}
        <span style={{ fontFamily: font, fontSize: `${textSize}mm`, fontWeight: 700, color: el.accent, lineHeight: 1 }}>{el.text}</span>
        {el.sub && <span style={{ fontFamily: font, fontSize: `${subSize}mm`, color: el.color, marginTop: '1mm' }}>{el.sub}</span>}
      </div>
    )
  }
  if (el.style === 'stacked') {
    return (
      <div style={stack}>
        {glyph()}
        <span style={{ fontFamily: font, fontSize: `${textSize * 1.3}mm`, fontWeight: 700, color: el.accent, lineHeight: 1 }}>{el.text}</span>
        {el.sub && (
          <span style={{ fontFamily: font, fontSize: `${subSize}mm`, color: el.color, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '1mm' }}>
            {el.sub}
          </span>
        )}
      </div>
    )
  }
  // plain
  return (
    <div style={stack}>
      {glyph()}
      <span style={{ fontFamily: font, fontSize: `${textSize}mm`, fontWeight: 600, color: el.color, lineHeight: 1 }}>{el.text}</span>
      {el.sub && <span style={{ fontFamily: font, fontSize: `${subSize}mm`, color: el.color, opacity: 0.6, marginTop: '0.6mm' }}>{el.sub}</span>}
    </div>
  )
}

// ── flags and countries ─────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * A flag, drawn (ported from upstream's FlagMark): exact for the stripe,
 * cross and disc constructions in flags.ts, the country's silhouette for
 * anything with an emblem, and the code as a mark when there is neither.
 * `size` is the height in mm.
 */
export function FlagMark({ code, size, color = 'currentColor' }: { code: string; size: number; color?: string }) {
  const spec = flagSpec(code)
  if (spec) {
    const disc = flagDisc(spec)
    return (
      <svg data-flag={code.toUpperCase()} width={`${r2((size * FLAG_W) / FLAG_H)}mm`} height={`${r2(size)}mm`} viewBox={`0 0 ${FLAG_W} ${FLAG_H}`}
        style={{ display: 'block', flex: '0 0 auto', borderRadius: `${r2(size * 0.08)}mm` }} aria-label={code.toUpperCase()}>
        {flagBands(spec).map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} />)}
        {disc && <circle cx={disc.cx} cy={disc.cy} r={disc.r} fill={disc.fill} />}
        {/* A hairline keeps a white-edged flag off a white page. */}
        <rect x="0" y="0" width={FLAG_W} height={FLAG_H} fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="0.5" />
      </svg>
    )
  }
  const shape = COUNTRY_SHAPES[code.toUpperCase()]
  if (!shape) {
    return <span style={{ fontSize: `${r2(size * 0.62)}mm`, fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1, color }}>{code.toUpperCase()}</span>
  }
  return (
    <svg data-outline={code.toUpperCase()} width={`${r2((size * shape.w) / shape.h)}mm`} height={`${r2(size)}mm`} viewBox={`0 0 ${shape.w} ${shape.h}`}
      style={{ display: 'block', flex: '0 0 auto' }} aria-label={code.toUpperCase()}>
      <path d={shape.d} fill={color} />
    </svg>
  )
}

/**
 * The country page (upstream's CountriesView): each name in caps over its
 * own silhouette at low opacity — a list of names is a list; the same list
 * with each country's shape behind it reads as a map of where you went.
 */
export function CountriesView({ el }: { el: BookCountriesElement }) {
  const codes = el.codes
  const cols = el.layout === 'grid' ? Math.min(3, Math.max(1, Math.round(Math.sqrt(codes.length)))) : 1
  const rows = Math.ceil(codes.length / cols)
  const cell = el.frame.h / Math.max(1, rows)
  // Capped by the longest label too: caps with 0.14em tracking run ~0.82 of
  // their size per letter, plus a flag's width and the gap when shown — so a
  // long name ("PAÍSES BAJOS") never spills into the next column.
  const longest = Math.max(1, ...codes.map((c, i) => (el.showName ? (el.names[i] || c).length : 0)))
  const perEm = (el.showName ? longest * 0.82 : 0) + (el.showFlag ? 1.35 + 0.4 : 0)
  const fitWidth = ((el.frame.w / cols) * 0.94) / Math.max(1, perEm)
  const name = Math.max(1.2, Math.min(cell * 0.44, fitWidth))
  const justify = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'
  return (
    <div style={{ ...frameStyle(el), display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, alignContent: 'center', fontFamily: fontStack(el.font), color: el.color }}>
      {codes.map((code, i) => {
        const shape = COUNTRY_SHAPES[code.toUpperCase()]
        const label = el.names[i] || code.toUpperCase()
        const boxH = cell * 0.86
        const boxW = shape ? (boxH * shape.w) / shape.h : boxH
        return (
          <div key={`${code}-${i}`} data-country={code.toUpperCase()} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: justify, height: `${r2(cell)}mm`, minWidth: 0 }}>
            {el.showOutline && shape && (
              <svg width={`${r2(boxW)}mm`} height={`${r2(boxH)}mm`} viewBox={`0 0 ${shape.w} ${shape.h}`} style={{
                position: 'absolute',
                left: el.align === 'left' ? 0 : el.align === 'right' ? 'auto' : '50%',
                right: el.align === 'right' ? 0 : 'auto',
                transform: el.align === 'center' ? 'translateX(-50%)' : undefined,
                opacity: 0.2,
              }}>
                <path d={shape.d} fill={el.accent} />
              </svg>
            )}
            <span style={{ position: 'relative', fontSize: `${r2(name)}mm`, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: `${r2(name * 0.4)}mm`, whiteSpace: 'nowrap' }}>
              {el.showFlag && <FlagMark code={code} size={name * 0.9} color={el.accent} />}
              {el.showName && label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── list (pros/cons) ───────────────────────────────────────────────────────────

const TONE_MARK: Record<BookListItem['tone'], string> = { pro: '+', con: '–', plain: '•' }
const TONE_COLOR: Record<BookListItem['tone'], string> = { pro: '#16a34a', con: '#dc2626', plain: '' }

function ListRow({ item, el }: { item: BookListItem; el: BookListElement }) {
  return (
    <div style={{ display: 'flex', gap: '1.5mm', marginBottom: '1.5mm', fontFamily: fontStack(el.font), fontSize: '3mm', color: el.color, lineHeight: 1.4 }}>
      {el.showMarks && <span style={{ color: TONE_COLOR[item.tone] || el.accent, flexShrink: 0 }}>{TONE_MARK[item.tone]}</span>}
      <span>{item.text}</span>
    </div>
  )
}

export function ListView({ el }: { el: BookListElement }) {
  if (el.layout === 'stacked') {
    return (
      <div style={{ ...frameStyle(el), overflow: 'hidden' }}>
        {el.items.map((it, i) => <ListRow key={i} item={it} el={el} />)}
      </div>
    )
  }
  const pros = el.items.filter(i => i.tone !== 'con')
  const cons = el.items.filter(i => i.tone === 'con')
  const heading = (label: string) => label && (
    <div style={{ fontFamily: fontStack(el.font), fontSize: '2.6mm', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: el.accent, marginBottom: '2mm' }}>
      {label}
    </div>
  )
  return (
    <div style={{ ...frameStyle(el), display: 'flex', gap: '6mm', overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {heading(el.proLabel)}
        {pros.map((it, i) => <ListRow key={i} item={it} el={el} />)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {heading(el.conLabel)}
        {cons.map((it, i) => <ListRow key={i} item={it} el={el} />)}
      </div>
    </div>
  )
}

// ── packing ──────────────────────────────────────────────────────────────────

const PACKING_NO_CATEGORY = '__uncategorized__'

function PackingCheckbox({ checked, accent }: { checked: boolean; accent: string }) {
  const size = '3mm'
  return (
    <div style={{
      width: size, height: size, flexShrink: 0, borderRadius: '0.6mm',
      border: `0.25mm solid ${checked ? accent : 'rgba(0,0,0,.3)'}`,
      background: checked ? accent : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && <Check style={{ width: '80%', height: '80%' }} color="#ffffff" strokeWidth={3} />}
    </div>
  )
}

export function PackingView({ el }: { el: BookPackingElement }) {
  const font = fontStack(el.font)
  const groups: { label: string; items: typeof el.items }[] = el.groupByCategory
    ? Object.entries(
      el.items.reduce<Record<string, typeof el.items>>((acc, it) => {
        const key = it.category?.trim() || PACKING_NO_CATEGORY
        ;(acc[key] ??= []).push(it)
        return acc
      }, {}),
    ).map(([label, items]) => ({ label: label === PACKING_NO_CATEGORY ? '' : label, items }))
    : [{ label: '', items: el.items }]

  return (
    <div style={{ ...frameStyle(el), overflow: 'hidden' }}>
      <div style={{ columnCount: el.columns, columnGap: '6mm' }}>
        {groups.map((g, gi) => (
          <div key={gi} style={{ breakInside: 'avoid', marginBottom: '3mm' }}>
            {g.label && (
              <div style={{ fontFamily: font, fontSize: '2.6mm', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: el.accent, marginBottom: '1.5mm' }}>
                {g.label}
              </div>
            )}
            {g.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', marginBottom: '1mm' }}>
                <PackingCheckbox checked={!!it.checked} accent={el.accent} />
                <span style={{ fontFamily: font, fontSize: '2.8mm', color: el.color, flex: 1, textDecoration: it.checked ? 'line-through' : 'none', opacity: it.checked ? 0.6 : 1 }}>
                  {it.name}
                </span>
                {el.showQuantity && (it.quantity ?? 1) > 1 && (
                  <span style={{ fontFamily: font, fontSize: '2.4mm', color: el.color, opacity: 0.55 }}>×{it.quantity}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── accommodation ────────────────────────────────────────────────────────────

function formatStayDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function AccommodationView({ el }: { el: BookAccommodationElement }) {
  const font = fontStack(el.font)
  const isCards = el.layout === 'cards'
  return (
    <div style={{ ...frameStyle(el), display: 'flex', flexDirection: isCards ? 'row' : 'column', flexWrap: isCards ? 'wrap' : 'nowrap', gap: isCards ? '3mm' : '2mm', overflow: 'hidden', alignContent: 'flex-start' }}>
      {el.stays.map((s, i) => {
        const dates = [formatStayDate(s.checkIn), formatStayDate(s.checkOut)].filter(Boolean).join(' – ')
        return (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: '0.8mm',
            ...(isCards ? { flex: '1 1 40%', minWidth: '35mm', padding: '3mm', borderRadius: '2mm', border: `0.25mm solid rgba(0,0,0,.12)` } : {}),
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm' }}>
              <Hotel style={{ width: '3.5mm', height: '3.5mm', flexShrink: 0 }} color={el.accent} />
              <span style={{ fontFamily: font, fontSize: '3mm', fontWeight: 700, color: el.color }}>{s.name}</span>
            </div>
            {s.address && <span style={{ fontFamily: font, fontSize: '2.3mm', color: el.color, opacity: 0.65 }}>{s.address}</span>}
            {dates && <span style={{ fontFamily: font, fontSize: '2.3mm', color: el.accent, fontWeight: 600 }}>{dates}</span>}
            {el.showConfirmation && s.confirmation && (
              <span style={{ fontFamily: font, fontSize: '2.1mm', color: el.color, opacity: 0.5 }}>#{s.confirmation}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
