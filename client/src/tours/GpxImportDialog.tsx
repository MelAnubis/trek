// Importar GPX o KML como excursiones (TourGpxPreviewDialog de la v5): vista previa de cada track,
// nombre y tipo por track, y nada se guarda hasta confirmar.
import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import Modal from '../components/shared/Modal'
import { useTranslation } from '../i18n'
import { toursApi, type GpxPreviewTrack, type TourType } from './toursApi'
import { TOUR_TYPES, TOUR_TYPE_COLOR, formatDistance, formatElevation } from './presentation'

interface Props {
  tripId: number | string
  open: boolean
  file: File | null
  onClose: () => void
  onImported: (count: number, asTrack?: boolean) => void
}

interface Choice { take: boolean; name: string; type: TourType }

function MiniLine({ line, color }: { line: [number, number][]; color: string }) {
  if (line.length < 2) return null
  const lats = line.map(p => p[0]), lngs = line.map(p => p[1])
  const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const k = Math.cos(((a + b) / 2) * Math.PI / 180)
  const w = (d - c) * k || 1e-6, h = (b - a) || 1e-6
  const s = 56 / Math.max(w, h)
  const path = line.map((p, i) => `${i ? 'L' : 'M'}${(4 + (p[1] - c) * k * s + (56 - w * s) / 2).toFixed(1)},${(4 + (b - p[0]) * s + (56 - h * s) / 2).toFixed(1)}`).join(' ')
  return <svg width={64} height={64} viewBox="0 0 64 64" style={{ flexShrink: 0, borderRadius: 10, background: 'var(--bg-secondary)' }}><path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /></svg>
}

export default function GpxImportDialog({ tripId, open, file, onClose, onImported }: Props) {
  const { t } = useTranslation()
  const [tracks, setTracks] = useState<GpxPreviewTrack[] | null>(null)
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Excursiones planifica, Tracks registra: the file is a plan, or what was done.
  const [kind, setKind] = useState<'plan' | 'done'>('plan')

  useEffect(() => {
    if (!open || !file) return
    let cancelled = false
    setTracks(null); setError(null); setChoices({})
    toursApi.previewGpx(tripId, file)
      .then(res => {
        if (cancelled) return
        setTracks(res.tracks)
        setChoices(Object.fromEntries(res.tracks.map(tr => [tr.index, { take: true, name: tr.name, type: 'hike' as TourType }])))
      })
      .catch(err => {
        if (cancelled) return
        const status = (err as { response?: { status?: number } }).response?.status
        setError(status === 422 ? t('tours.import.noTrackIn', { name: file.name }) : t('tours.import.errorIn', { name: file.name }))
      })
    return () => { cancelled = true }
  }, [open, file, tripId, t])

  const picked = tracks?.filter(tr => choices[tr.index]?.take && choices[tr.index]?.name.trim()) ?? []

  const doImport = async () => {
    if (!file || !picked.length) return
    setBusy(true)
    if (kind === 'done') {
      try {
        await toursApi.uploadTrack(tripId, file)
        onImported(1, true)
        onClose()
      } catch {
        setError(t('tours.import.errorIn', { name: file.name }))
      } finally {
        setBusy(false)
      }
      return
    }
    try {
      const res = await toursApi.importGpx(tripId, file, picked.map(tr => ({ index: tr.index, name: choices[tr.index].name.trim(), tour_type: choices[tr.index].type })))
      onImported(res.tours.length)
      onClose()
    } catch {
      setError(t('tours.import.errorIn', { name: file.name }))
    } finally {
      setBusy(false)
    }
  }

  const set = (index: number, patch: Partial<Choice>) => setChoices(c => ({ ...c, [index]: { ...c[index], ...patch } }))

  return (
    <Modal isOpen={open} onClose={onClose} size="lg" title={t('tours.import.previewTitle')}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>{t('common.cancel')}</button>
          <button type="button" disabled={!picked.length || busy} onClick={() => { void doImport() }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: picked.length ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: picked.length ? 'var(--bg-card)' : 'var(--text-faint)', cursor: picked.length ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            <Upload size={14} />{busy ? t('tours.import.importing') : kind === 'done' ? t('tours.import.asTrack') : t('tours.import.previewConfirm', { count: picked.length })}
          </button>
        </div>
      }>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>{t('tours.import.previewHint')}</p>
      <div role="radiogroup" aria-label={t('tours.import.kind')} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 11, background: 'var(--bg-tertiary)', marginBottom: 12 }}>
        {(['plan', 'done'] as const).map(k => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} data-testid={`import-kind-${k}`} onClick={() => setKind(k)}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', background: kind === k ? 'var(--bg-card)' : 'transparent', color: 'var(--text-primary)' }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{t(`tours.import.kind.${k}`)}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>{t(`tours.import.kind.${k}Hint`)}</span>
          </button>
        ))}
      </div>
      {error && <div style={{ padding: 10, borderRadius: 10, background: 'rgba(220,38,38,0.08)', color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {!tracks && !error && <div style={{ fontSize: 13, color: 'var(--text-faint)', padding: 10 }}>{t('common.loading')}</div>}
      {tracks && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>{file?.name} · {t('tours.import.previewTracks', { count: tracks.length })}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tracks.map(tr => {
              const c = choices[tr.index]
              if (!c) return null
              return (
                <div key={tr.index} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, border: '1px solid var(--border-faint)', borderRadius: 12, opacity: c.take ? 1 : 0.55 }}>
                  <input type="checkbox" checked={c.take} onChange={e => set(tr.index, { take: e.target.checked })} />
                  <MiniLine line={tr.line} color={TOUR_TYPE_COLOR[c.type]} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input value={c.name} onChange={e => set(tr.index, { name: e.target.value })} maxLength={255}
                      style={{ padding: '6px 9px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }} />
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}>
                      <span>{formatDistance(tr.distance_km)}</span>
                      {tr.has_heights ? <span>↑ {formatElevation(tr.elevation_gain)} ↓ {formatElevation(tr.elevation_loss)}</span> : <span style={{ color: '#b45309' }}>{t('tours.import.previewNoHeights')}</span>}
                      <span>{t('tours.import.previewPoints', { count: tr.point_count })}</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                        {t('tours.import.previewAs')}
                        <select value={c.type} onChange={e => set(tr.index, { type: e.target.value as TourType })}
                          style={{ padding: '4px 6px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit' }}>
                          {TOUR_TYPES.map(ty => <option key={ty} value={ty}>{t(`tourTypes.${ty}`)}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
