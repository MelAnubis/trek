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
  return <svg className="!shrink-[0] !rounded-[10px] ![background:var(--bg-secondary)]" width={64} height={64} viewBox="0 0 64 64"><path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /></svg>
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
        <div className="!flex !justify-end !gap-[8px]">
          <button className="!p-[8px_14px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !cursor-pointer ![font-family:inherit] !text-[length:13px]" type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button className="!flex !items-center !gap-[6px] !p-[8px_14px] !rounded-[10px] ![border:none] ![font-family:inherit] !text-[length:13px] !font-[600]" type="button" disabled={!picked.length || busy} onClick={() => { void doImport() }}
            style={{ background: picked.length ? 'var(--text-primary)' : 'var(--bg-tertiary)', color: picked.length ? 'var(--bg-card)' : 'var(--text-faint)', cursor: picked.length ? 'pointer' : 'default' }}>
            <Upload size={14} />{busy ? t('tours.import.importing') : kind === 'done' ? t('tours.import.asTrack') : t('tours.import.previewConfirm', { count: picked.length })}
          </button>
        </div>
      }>
      <p className="!m-[0_0_12px] !text-[length:12.5px] ![color:var(--text-muted)]">{t('tours.import.previewHint')}</p>
      <div className="!flex !gap-[2px] !p-[3px] !rounded-[11px] ![background:var(--bg-tertiary)] !mb-[12px]" role="radiogroup" aria-label={t('tours.import.kind')}>
        {(['plan', 'done'] as const).map(k => (
          <button className="!flex-[1] !p-[8px_10px] !rounded-[9px] ![border:none] !cursor-pointer ![font-family:inherit] !text-left ![color:var(--text-primary)]" key={k} type="button" role="radio" aria-checked={kind === k} data-testid={`import-kind-${k}`} onClick={() => setKind(k)}
            style={{ background: kind === k ? 'var(--bg-card)' : 'transparent' }}>
            <span className="!block !text-[length:12.5px] !font-[600]">{t(`tours.import.kind.${k}`)}</span>
            <span className="!block !text-[length:11px] ![color:var(--text-faint)]">{t(`tours.import.kind.${k}Hint`)}</span>
          </button>
        ))}
      </div>
      {error && <div className="!p-[10px] !rounded-[10px] ![background:rgba(220,38,38,0.08)] ![color:#b91c1c] !text-[length:13px] !mb-[10px]">{error}</div>}
      {!tracks && !error && <div className="!text-[length:13px] ![color:var(--text-faint)] !p-[10px]">{t('common.loading')}</div>}
      {tracks && (
        <>
          <div className="!text-[length:12px] ![color:var(--text-faint)] !mb-[8px]">{file?.name} · {t('tours.import.previewTracks', { count: tracks.length })}</div>
          <div className="!flex !flex-col !gap-[8px]">
            {tracks.map(tr => {
              const c = choices[tr.index]
              if (!c) return null
              return (
                <div className="!flex !gap-[12px] !items-center !p-[10px] ![border:1px_solid_var(--border-faint)] !rounded-[12px]" key={tr.index} style={{ opacity: c.take ? 1 : 0.55 }}>
                  <input type="checkbox" checked={c.take} onChange={e => set(tr.index, { take: e.target.checked })} />
                  <MiniLine line={tr.line} color={TOUR_TYPE_COLOR[c.type]} />
                  <div className="!flex-[1] !min-w-[0] !flex !flex-col !gap-[6px]">
                    <input className="!p-[6px_9px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !text-[length:13px] ![font-family:inherit]" value={c.name} onChange={e => set(tr.index, { name: e.target.value })} maxLength={255} />
                    <div className="!flex !gap-[10px] !flex-wrap !items-center !text-[length:11.5px] ![color:var(--text-muted)]">
                      <span>{formatDistance(tr.distance_km)}</span>
                      {tr.has_heights ? <span>↑ {formatElevation(tr.elevation_gain)} ↓ {formatElevation(tr.elevation_loss)}</span> : <span className="![color:#b45309]">{t('tours.import.previewNoHeights')}</span>}
                      <span>{t('tours.import.previewPoints', { count: tr.point_count })}</span>
                      <label className="!flex !items-center !gap-[6px] !ml-[auto]">
                        {t('tours.import.previewAs')}
                        <select className="!p-[4px_6px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-card)] ![color:var(--text-primary)] !text-[length:12px] ![font-family:inherit]" value={c.type} onChange={e => set(tr.index, { type: e.target.value as TourType })}>
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
