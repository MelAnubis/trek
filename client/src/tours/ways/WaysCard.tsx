// Superficie y tipos de vía a lo largo de la excursión (BikeWaysCard + RouteWaySections de liketrek/TREK v5),
// leídos de la descripción que el router da de la línea (trace_attributes de Valhalla). Nada cambia la excursión.
import { useEffect, useMemo, useState } from 'react'
import { Layers, Loader2, RefreshCw, AlertTriangle, Info } from 'lucide-react'
import { useTranslation } from '../../i18n'
import RailCard from '../RailCard'
import { valhallaTraceAttributes, type TraceMatching } from '../routing/valhalla'
import { percent, routeWaysFrom, sharesBy, stretchesOf, unpavedShareOf, type RouteWayEdge, type RouteWays, type SurfaceClass, type WayClass } from './routeWays'
import { formatDistance } from '../presentation'
import type { TourType } from '../toursApi'

export const SURFACE_COLOR: Record<SurfaceClass, string> = {
  paved: '#16a34a', rough: '#0d9488', compacted: '#2563eb', gravel: '#d97706', ground: '#92400e', unknown: '#94a3b8',
}

export interface RouteHighlight { id: string; lines: [number, number][][]; color: string }

const SETTLE_MS = 600

type Status = 'idle' | 'loading' | 'ready' | 'failed'

/** The ways of a route once it has settled; a new route makes the answer on its way stale. */
export function useRouteWays(route: [number, number][] | null, matching: TraceMatching) {
  const [state, setState] = useState<{ status: Status; ways: RouteWays | null; key: string | null }>({ status: 'idle', ways: null, key: null })
  const [attempt, setAttempt] = useState(0)
  const key = route && route.length >= 2 ? `${matching}:${route.length}:${route[0]}:${route[route.length - 1]}:${attempt}` : null
  useEffect(() => {
    if (!key || !route) { setState({ status: 'idle', ways: null, key: null }); return }
    setState({ status: 'loading', ways: null, key })
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      valhallaTraceAttributes(route, ctrl.signal, matching)
        .then(answer => { if (!ctrl.signal.aborted) { const ways = routeWaysFrom(answer); setState({ status: ways ? 'ready' : 'failed', ways, key }) } })
        .catch(() => { if (!ctrl.signal.aborted) setState({ status: 'failed', ways: null, key }) })
    }, SETTLE_MS)
    return () => { window.clearTimeout(timer); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, matching])
  return { ...state, retry: () => setAttempt(a => a + 1) }
}

function ShareBar({ rows, colorOf }: { rows: { key: string; share: number }[]; colorOf: (k: string) => string }) {
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
      {rows.map(r => <span key={r.key} style={{ width: `${r.share * 100}%`, background: colorOf(r.key) }} />)}
    </div>
  )
}

function ShareList<C extends string>({ ways, rows, idPrefix, classOf, labelOf, colorOf, highlight, onHighlight }: {
  ways: RouteWays; rows: { key: C; lengthM: number; share: number }[]; idPrefix: string
  classOf: (e: RouteWayEdge) => C; labelOf: (k: C) => string; colorOf?: (k: C) => string
  highlight: string | null; onHighlight: (h: RouteHighlight | null) => void
}) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map(row => {
        const id = `${idPrefix}-${row.key}`
        const shown = highlight === id
        return (
          <li key={row.key}>
            <button type="button" aria-pressed={shown} data-testid={`route-ways-row-${id}`}
              onClick={() => onHighlight(shown ? null : { id, lines: stretchesOf(ways, e => classOf(e) === row.key), color: colorOf?.(row.key) ?? '#111' })}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '4px 6px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', background: shown ? 'var(--bg-tertiary)' : 'transparent' }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, flexShrink: 0, background: colorOf ? colorOf(row.key) : 'transparent', border: colorOf ? 'none' : '1px solid var(--border-primary)' }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(row.key)}</span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{formatDistance(row.lengthM / 1000)}</span>
              <span style={{ width: 38, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{percent(row.share)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const sectionLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-faint)', margin: '10px 0 6px' }

export default function WaysCard({ route, tourType, highlight, onHighlight }: {
  route: [number, number][] | null; tourType: TourType; highlight: string | null; onHighlight: (h: RouteHighlight | null) => void
}) {
  const { t } = useTranslation()
  const matching: TraceMatching = tourType === 'bike' ? 'bike' : tourType === 'run' ? 'run' : 'foot'
  const state = useRouteWays(route, matching)
  const ways = state.ways
  const surfaces = useMemo(() => (ways ? sharesBy<SurfaceClass>(ways, e => e.surface) : []), [ways])
  const kinds = useMemo(() => (ways ? sharesBy<WayClass>(ways, e => e.way) : []), [ways])
  const unpaved = useMemo(() => (ways ? unpavedShareOf(ways) : null), [ways])
  // The highlight belongs to the route it was drawn on.
  useEffect(() => { onHighlight(null) }, [state.key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (state.status === 'idle') return null
  return (
    <RailCard testId="ways-card" icon={<Layers size={15} />} title={t('tours.bike.ways.title')}
      aside={unpaved !== null ? <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: unpaved > 0 ? 'rgba(217,119,6,0.12)' : 'var(--bg-tertiary)', color: unpaved > 0 ? '#b45309' : 'var(--text-muted)' }}>{t('tours.bike.ways.unpavedBadge', { share: percent(unpaved) })}</span> : undefined}>
      {state.status === 'loading' && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', paddingTop: 10 }}><Loader2 size={13} className="animate-spin" />{t('tours.bike.ways.loading')}</div>}
      {state.status === 'failed' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#b45309', paddingTop: 10 }}>
          <AlertTriangle size={13} />{t('tours.bike.ways.failed')}
          <button type="button" onClick={state.retry} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', borderRadius: 8, padding: '2px 8px', fontSize: 11.5, cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit' }}><RefreshCw size={11} />{t('tours.planner.retry')}</button>
        </div>
      )}
      {ways && (
        <>
          <p style={sectionLabel}>{t('tours.bike.ways.surface')}</p>
          <ShareBar rows={surfaces} colorOf={k => SURFACE_COLOR[k as SurfaceClass]} />
          <div style={{ marginTop: 6 }}>
            <ShareList ways={ways} rows={surfaces} idPrefix="surface" classOf={e => e.surface} labelOf={k => t(`tours.bike.ways.surface.${k}`)} colorOf={k => SURFACE_COLOR[k]} highlight={highlight} onHighlight={onHighlight} />
          </div>
          <p style={sectionLabel}>{t('tours.bike.ways.way')}</p>
          <ShareList ways={ways} rows={kinds} idPrefix="way" classOf={e => e.way} labelOf={k => t(`tours.bike.ways.way.${k}`)} highlight={highlight} onHighlight={onHighlight} />
          <p style={{ display: 'flex', gap: 6, margin: '10px 0 0', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.45 }}><Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />{t('tours.bike.ways.source')}</p>
        </>
      )}
    </RailCard>
  )
}
