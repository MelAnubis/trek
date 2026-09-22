import type { CSSProperties } from 'react'
import * as LucideIcons from 'lucide-react'
import { Map as MapIcon, Route, CalendarDays, Footprints, Camera, Flag, MapPin, Compass, TrendingUp, TrendingDown } from 'lucide-react'
import type { BookBadgeElement, BookIconElement, BookListElement, BookListItem, BookMapElement, BookMetric, BookPlacesElement, BookStatsElement } from '../../types/book'
import { fontStack } from './bookFonts'
import { frameStyle } from './SpreadView'

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
  elevationGain: TrendingUp, elevationLoss: TrendingDown,
}

const METRIC_LABEL: Record<BookMetric, string> = {
  distance: 'Distance', days: 'Days', steps: 'Steps', photos: 'Photos', countries: 'Countries', places: 'Places', furthest: 'Furthest',
  elevationGain: 'Elevation gain', elevationLoss: 'Elevation loss',
}

/** Distance/furthest are stored in metres and shown as km; elevation gain/loss are also stored in metres but shown as-is — a day's climb rarely reaches a whole kilometre. Everything else is a plain count, per the schema's own comment. */
export function formatMetricValue(metric: BookMetric, value: number, units: 'metric' | 'imperial'): string {
  if (metric === 'distance' || metric === 'furthest') {
    const km = value / 1000
    return units === 'imperial' ? `${Math.round(km * 0.621371).toLocaleString()} mi` : `${Math.round(km).toLocaleString()} km`
  }
  if (metric === 'elevationGain' || metric === 'elevationLoss') {
    return units === 'imperial' ? `${Math.round(value * 3.28084).toLocaleString()} ft` : `${Math.round(value).toLocaleString()} m`
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
              {formatMetricValue(m, el.values[m]!, el.units)}
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

  const stack: CSSProperties = { ...frameStyle(el), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }

  if (el.style === 'chip') {
    return (
      <div style={{ ...stack, background: el.accent, borderRadius: '999mm', padding: '2mm 4mm' }}>
        <span style={{ fontFamily: font, fontSize: `${textSize}mm`, fontWeight: 700, color: '#ffffff', lineHeight: 1 }}>{el.text}</span>
        {el.sub && <span style={{ fontFamily: font, fontSize: `${subSize}mm`, color: '#ffffff', opacity: 0.85, marginTop: '1mm' }}>{el.sub}</span>}
      </div>
    )
  }
  if (el.style === 'outline') {
    return (
      <div style={{ ...stack, border: `0.3mm solid ${el.accent}`, borderRadius: '2mm' }}>
        <span style={{ fontFamily: font, fontSize: `${textSize}mm`, fontWeight: 700, color: el.accent, lineHeight: 1 }}>{el.text}</span>
        {el.sub && <span style={{ fontFamily: font, fontSize: `${subSize}mm`, color: el.color, marginTop: '1mm' }}>{el.sub}</span>}
      </div>
    )
  }
  if (el.style === 'stacked') {
    return (
      <div style={stack}>
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
      <span style={{ fontFamily: font, fontSize: `${textSize}mm`, fontWeight: 600, color: el.color, lineHeight: 1 }}>{el.text}</span>
      {el.sub && <span style={{ fontFamily: font, fontSize: `${subSize}mm`, color: el.color, opacity: 0.6, marginTop: '0.6mm' }}>{el.sub}</span>}
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
