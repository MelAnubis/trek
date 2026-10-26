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
      aside={actual ? <span style={{ width: 10, height: 10, borderRadius: 5, background: ACTUAL_COLOR }} /> : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
        {actual ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              <span style={{ display: 'inline-block', width: 14, height: 3, background: ACTUAL_COLOR, borderRadius: 2, verticalAlign: 'middle', marginRight: 6 }} />
              {actual.track_name}{actual.ibp ? ` · IBP ${actual.ibp}` : ''}
            </div>
            <table data-testid="actual-compare" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text-faint)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ textAlign: 'left', fontWeight: 600, padding: '0 0 4px' }} />
                  <th style={{ textAlign: 'right', fontWeight: 600, padding: '0 0 4px' }}>{t('tours.actual.planned')}</th>
                  <th style={{ textAlign: 'right', fontWeight: 600, padding: '0 0 4px' }}>{t('tours.actual.real')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label} style={{ borderTop: '1px solid var(--border-faint)' }}>
                    <td style={{ padding: '6px 0', color: 'var(--text-muted)' }}>{r.label}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--text-secondary)' }}>{r.plan}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {r.real}
                      {r.delta && <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: ACTUAL_COLOR }}>{r.delta}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canEdit && <button type="button" style={{ ...btn, alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(() => onLink(null))}><Link2Off size={12} />{t('tours.actual.unlink')}</button>}
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('tours.actual.empty')}</p>
            {canEdit && (
              <>
                {free.length > 0 && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select data-testid="actual-pick" value={choice} onChange={e => setChoice(e.target.value)}
                      style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 9, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit' }}>
                      <option value="">{t('tours.actual.pick')}</option>
                      {free.map(tr => <option key={tr.id} value={tr.id}>{tr.track_name}{tr.total_distance ? ` · ${formatDistance(tr.total_distance)}` : ''}{dayIds.includes(tr.day_id ?? -1) ? ` · ${t('tours.actual.sameDay')}` : ''}</option>)}
                    </select>
                    <button type="button" style={btn} disabled={!choice || busy} onClick={() => run(() => onLink(Number(choice)))}><Link2 size={12} />{t('tours.actual.link')}</button>
                  </div>
                )}
                <input ref={fileRef} type="file" accept=".gpx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(() => onUpload(f)) }} />
                <button type="button" style={{ ...btn, alignSelf: 'flex-start' }} disabled={busy} onClick={() => fileRef.current?.click()}>
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
