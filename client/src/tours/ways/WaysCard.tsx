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
    <div className="!flex !h-[8px] !rounded-[4px] !overflow-hidden ![background:var(--bg-tertiary)]">
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
    <ul className="![list-style:none] !m-[0] !p-[0]">
      {rows.map(row => {
        const id = `${idPrefix}-${row.key}`
        const shown = highlight === id
        return (
          <li key={row.key}>
            <button className="!flex !items-center !gap-[8px] !w-[100%] !p-[4px_6px] !rounded-[8px] ![border:none] !cursor-pointer ![font-family:inherit] !text-left" type="button" aria-pressed={shown} data-testid={`route-ways-row-${id}`}
              onClick={() => onHighlight(shown ? null : { id, lines: stretchesOf(ways, e => classOf(e) === row.key), color: colorOf?.(row.key) ?? '#111' })}
              style={{ background: shown ? 'var(--bg-tertiary)' : 'transparent' }}>
              <span className="!w-[10px] !h-[10px] !rounded-[5px] !shrink-[0]" style={{ background: colorOf ? colorOf(row.key) : 'transparent', border: colorOf ? 'none' : '1px solid var(--border-primary)' }} />
              <span className="!flex-[1] !min-w-[0] !text-[length:12px] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{labelOf(row.key)}</span>
              <span className="!text-[length:11px] ![color:var(--text-faint)] ![font-variant-numeric:tabular-nums]">{formatDistance(row.lengthM / 1000)}</span>
              <span className="!w-[38px] !text-right !text-[length:11px] ![color:var(--text-muted)] ![font-variant-numeric:tabular-nums]">{percent(row.share)}</span>
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
      aside={unpaved !== null ? <span className="!text-[length:11px] !font-[600] !p-[2px_8px] !rounded-[999px]" style={{ background: unpaved > 0 ? 'rgba(217,119,6,0.12)' : 'var(--bg-tertiary)', color: unpaved > 0 ? '#b45309' : 'var(--text-muted)' }}>{t('tours.bike.ways.unpavedBadge', { share: percent(unpaved) })}</span> : undefined}>
      {state.status === 'loading' && <div className="!flex !items-center !gap-[6px] !text-[length:12px] ![color:var(--text-muted)] !pt-[10px]"><Loader2 size={13} className="animate-spin" />{t('tours.bike.ways.loading')}</div>}
      {state.status === 'failed' && (
        <div className="!flex !items-center !gap-[8px] !flex-wrap !text-[length:12px] ![color:#b45309] !pt-[10px]">
          <AlertTriangle size={13} />{t('tours.bike.ways.failed')}
          <button className="!inline-flex !items-center !gap-[4px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] !rounded-[8px] !p-[2px_8px] !text-[length:11.5px] !cursor-pointer ![color:var(--text-primary)] ![font-family:inherit]" type="button" onClick={state.retry}><RefreshCw size={11} />{t('tours.planner.retry')}</button>
        </div>
      )}
      {ways && (
        <>
          <p style={sectionLabel}>{t('tours.bike.ways.surface')}</p>
          <ShareBar rows={surfaces} colorOf={k => SURFACE_COLOR[k as SurfaceClass]} />
          <div className="!mt-[6px]">
            <ShareList ways={ways} rows={surfaces} idPrefix="surface" classOf={e => e.surface} labelOf={k => t(`tours.bike.ways.surface.${k}`)} colorOf={k => SURFACE_COLOR[k]} highlight={highlight} onHighlight={onHighlight} />
          </div>
          <p style={sectionLabel}>{t('tours.bike.ways.way')}</p>
          <ShareList ways={ways} rows={kinds} idPrefix="way" classOf={e => e.way} labelOf={k => t(`tours.bike.ways.way.${k}`)} highlight={highlight} onHighlight={onHighlight} />
          <p className="!flex !gap-[6px] !m-[10px_0_0] !text-[length:11px] ![color:var(--text-faint)] !leading-[1.45]"><Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />{t('tours.bike.ways.source')}</p>
        </>
      )}
    </RailCard>
  )
}
