// Plan frente a realidad: lo planificado de una excursión al lado de lo que de verdad se hizo
// (un track de la pestaña GPX vinculado a ella), con vincular, desvincular y subir lo hecho.
import { useMemo, useRef, useState } from 'react'
import { Activity, Link2, Link2Off, Upload, Loader2 } from 'lucide-react'
import { useTranslation } from '../i18n'
import RailCard from './RailCard'
import { formatDistance, formatDurationShort, formatElevation } from './presentation'
import type { TourListItem, TripTrack } from './toursApi'

export const ACTUAL_COLOR = '#f97316'

interface Props {
  tour: TourListItem
  /** The planned measures as the tour stands (the editor's when it is open). */
  planned: { distanceKm: number | null; gain: number | null; loss: number | null; minutes: number | null }
  tracks: TripTrack[]
  dayIds: number[]
  canEdit: boolean
  onLink: (trackId: number | null) => Promise<void>
  onUpload: (file: File) => Promise<void>
}

function diff(real: number | null | undefined, plan: number | null | undefined, fmt: (v: number) => string): string | null {
  if (real == null || plan == null) return null
  const d = real - plan
  if (Math.abs(d) < 0.005) return null
  return `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`
}

export default function ActualCard({ tour, planned, tracks, dayIds, canEdit, onLink, onUpload }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const actual = tour.actual_track ?? null

  // Tracks of the trip not tied to another tour, those of the tour's days first.
  const free = useMemo(() => tracks
    .filter(tr => tr.tour_place_id == null || tr.tour_place_id === tour.place_id)
    .sort((a, b) => Number(dayIds.includes(b.day_id ?? -1)) - Number(dayIds.includes(a.day_id ?? -1))), [tracks, tour.place_id, dayIds])

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }

  const rows: { label: string; plan: string; real: string; delta: string | null }[] = actual ? [
    { label: t('tours.detail.distance'), plan: formatDistance(planned.distanceKm), real: formatDistance(actual.total_distance), delta: diff(actual.total_distance, planned.distanceKm, v => formatDistance(v)) },
    { label: t('tours.detail.ascent'), plan: formatElevation(planned.gain), real: formatElevation(actual.total_elevation_gain), delta: diff(actual.total_elevation_gain, planned.gain, v => formatElevation(v)) },
    { label: t('tours.detail.descent'), plan: formatElevation(planned.loss), real: formatElevation(actual.total_elevation_loss), delta: diff(actual.total_elevation_loss, planned.loss, v => formatElevation(v)) },
    { label: t('tours.actual.time'), plan: formatDurationShort(planned.minutes), real: actual.duration_seconds ? formatDurationShort(actual.duration_seconds / 60) : '—', delta: actual.duration_seconds ? diff(actual.duration_seconds / 60, planned.minutes, v => formatDurationShort(v)) : null },
  ] : []

  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 9, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--text-primary)' }

  return (
    <RailCard testId="actual-card" icon={<Activity size={15} />} title={t('tours.actual.title')} defaultOpen={!!actual}
      aside={actual ? <span className="!w-[10px] !h-[10px] !rounded-[5px]" style={{ background: ACTUAL_COLOR }} /> : undefined}>
      <div className="!flex !flex-col !gap-[10px] !pt-[10px]">
        {actual ? (
          <>
            <div className="!text-[length:12px] ![color:var(--text-muted)]">
              <span className="!inline-block !w-[14px] !h-[3px] !rounded-[2px] ![vertical-align:middle] !mr-[6px]" style={{ background: ACTUAL_COLOR }} />
              {actual.track_name}{actual.ibp ? ` · IBP ${actual.ibp}` : ''}
            </div>
            <table className="!w-[100%] ![border-collapse:collapse] !text-[length:12px]" data-testid="actual-compare">
              <thead>
                <tr className="![color:var(--text-faint)] !text-[length:10.5px] !uppercase !tracking-[0.05em]">
                  <th className="!text-left !font-[600] !p-[0_0_4px]" />
                  <th className="!text-right !font-[600] !p-[0_0_4px]">{t('tours.actual.planned')}</th>
                  <th className="!text-right !font-[600] !p-[0_0_4px]">{t('tours.actual.real')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr className="![border-top:1px_solid_var(--border-faint)]" key={r.label}>
                    <td className="!p-[6px_0] ![color:var(--text-muted)]">{r.label}</td>
                    <td className="!p-[6px_0] !text-right ![color:var(--text-secondary)]">{r.plan}</td>
                    <td className="!p-[6px_0] !text-right !font-[600] ![color:var(--text-primary)]">
                      {r.real}
                      {r.delta && <span className="!block !text-[length:10.5px] !font-[500]" style={{ color: ACTUAL_COLOR }}>{r.delta}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && <button className="!self-start" type="button" style={{ ...btn }} disabled={busy} onClick={() => run(() => onLink(null))}><Link2Off size={12} />{t('tours.actual.unlink')}</button>}
          </>
        ) : (
          <>
            <p className="!m-[0] !text-[length:12px] ![color:var(--text-muted)] !leading-[1.5]">{t('tours.actual.empty')}</p>
            {canEdit && (
              <>
                {free.length > 0 && (
                  <div className="!flex !gap-[6px]">
                    <select className="!flex-[1] !min-w-[0] !p-[6px_8px] !rounded-[9px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !text-[length:12px] ![font-family:inherit]" data-testid="actual-pick" value={choice} onChange={e => setChoice(e.target.value)}>
                      <option value="">{t('tours.actual.pick')}</option>
                      {free.map(tr => <option key={tr.id} value={tr.id}>{tr.track_name}{tr.total_distance ? ` · ${formatDistance(tr.total_distance)}` : ''}{dayIds.includes(tr.day_id ?? -1) ? ` · ${t('tours.actual.sameDay')}` : ''}</option>)}
                    </select>
                    <button type="button" style={btn} disabled={!choice || busy} onClick={() => run(() => onLink(Number(choice)))}><Link2 size={12} />{t('tours.actual.link')}</button>
                  </div>
                )}
                <input ref={fileRef} type="file" accept=".gpx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(() => onUpload(f)) }} />
                <button className="!self-start" type="button" style={{ ...btn }} disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}{t('tours.actual.upload')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </RailCard>
  )
}
