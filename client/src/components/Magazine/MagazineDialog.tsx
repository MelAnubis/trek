import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Check, Newspaper, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'
import { journeyApi } from '../../api/client'
import { useToast } from '../shared/Toast'
import { buildMagazine, seasonLabel, type MagazineFeature } from '../Studio/magazineLayout'
import { loadJourneyFeature, loadStoryFeature, magazineApi, type MagazineSources } from './magazineData'

type Key = `j:${number}` | `s:${string}`

/**
 * «Nueva revista»: elige travesías y relatos de la zona pública (en el orden
 * en que los marques), y la revista sale maquetada en el Studio, en formato
 * bolsillo, lista para retocar, exportar a PDF o compartir.
 */
export default function MagazineDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const tileUrl = useSettingsStore(s => s.settings.map_tile_url) || undefined
  const [sources, setSources] = useState<MagazineSources | null>(null)
  const [picked, setPicked] = useState<Key[]>([])
  const [title, setTitle] = useState('#ESTODOBAJADA')
  const [note, setNote] = useState(() => t('magazine.defaultNote'))
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { magazineApi.sources().then(setSources).catch(() => setSources({ journeys: [], stories: [] })) }, [])

  const toggle = (k: Key) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))
  const order = (k: Key) => picked.indexOf(k) + 1

  const fmt = useMemo(() => (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(locale, { month: 'short', year: 'numeric' }) : ''), [locale])

  const create = async () => {
    if (!sources || !picked.length) return
    try {
      setBusy(t('magazine.creating'))
      const journeyIds = picked.filter(k => k.startsWith('j:')).map(k => Number(k.slice(2)))
      const storyIds = picked.filter(k => k.startsWith('s:')).map(k => k.slice(2))
      const { journey_id, volume } = await magazineApi.create({ title, journey_ids: journeyIds, story_ids: storyIds })
      const features: MagazineFeature[] = []
      for (const k of picked) {
        if (k.startsWith('j:')) {
          const j = sources.journeys.find(x => x.id === Number(k.slice(2)))
          setBusy(t('magazine.loadingJourney', { title: j?.title || '' }))
          features.push(await loadJourneyFeature(Number(k.slice(2)), { tileUrl }))
        } else {
          const s = sources.stories.find(x => x.id === k.slice(2))
          if (!s) continue
          setBusy(t('magazine.loadingStory', { title: s.title }))
          features.push(await loadStoryFeature(s))
        }
      }
      setBusy(t('magazine.layingOut'))
      const doc = buildMagazine({
        locale, title: title.trim() || '#ESTODOBAJADA', volume,
        season: seasonLabel(new Date(), [t('magazine.season.winter'), t('magazine.season.spring'), t('magazine.season.summer'), t('magazine.season.autumn')]),
        editorNote: note.trim(),
        features,
        labels: {
          feature: t('magazine.label.feature'), story: t('magazine.label.story'), contents: t('magazine.label.contents'),
          route: t('magazine.label.route'), days: t('magazine.label.days'), by: t('magazine.label.by'),
          colophon: t('magazine.label.colophon'), madeWith: t('magazine.label.madeWith'), editorNote: t('magazine.label.editorNote'),
        },
      })
      await journeyApi.saveBook(journey_id, { title: doc.title, document: doc })
      onClose()
      navigate(`/journey/${journey_id}/studio`)
    } catch {
      toast.error(t('magazine.failed'))
      setBusy(null)
    }
  }

  const Row = ({ k, title: rowTitle, sub, icon }: { k: Key; title: string; sub: string; icon: React.ReactNode }) => {
    const n = order(k)
    return (
      <button type="button" onClick={() => toggle(k)} aria-pressed={n > 0} data-testid={`mag-pick-${k}`}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${n ? 'border-zinc-900 dark:border-white bg-zinc-50 dark:bg-zinc-800' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400'}`}>
        <span className={`w-6 h-6 shrink-0 rounded-md inline-flex items-center justify-center text-[11px] font-bold ${n ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'border border-zinc-300 dark:border-zinc-600 text-transparent'}`}>{n || <Check size={12} />}</span>
        <span className="text-zinc-400 shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-zinc-900 dark:text-white truncate">{rowTitle}</span>
          {sub && <span className="block text-[11px] text-zinc-500 truncate">{sub}</span>}
        </span>
      </button>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-start sm:items-center justify-center p-4 overflow-y-auto" style={{ background: 'var(--modal-backdrop)' }} onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t('magazine.new')} className="w-full max-w-[560px] rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{t('magazine.kicker')}</div>
            <h2 className="text-[22px] font-bold tracking-[-0.02em] text-zinc-900 dark:text-white mt-1">{t('magazine.new')}</h2>
            <p className="text-[13px] text-zinc-500 mt-1">{t('magazine.intro')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label={t('common.close')} className="w-8 h-8 rounded-lg inline-flex items-center justify-center text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={16} /></button>
        </div>

        <div className="px-6 pt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">{t('magazine.title')}</span>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} className="h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[14px] text-zinc-900 dark:text-white" />
          </label>

          {!sources ? <div className="h-32" /> : (
            <>
              <section>
                <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-zinc-500 mb-2">{t('magazine.journeys')}</div>
                {sources.journeys.length === 0 ? <p className="text-[13px] text-zinc-500">{t('magazine.noJourneys')}</p> : (
                  <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">
                    {sources.journeys.map(j => <Row key={j.id} k={`j:${j.id}`} title={j.title} icon={<BookOpen size={15} />}
                      sub={[fmt(j.date_min), t('magazine.photos', { count: j.photo_count })].filter(Boolean).join(' · ')} />)}
                  </div>
                )}
              </section>
              <section>
                <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-zinc-500 mb-2">{t('magazine.stories')}</div>
                {sources.stories.length === 0 ? <p className="text-[13px] text-zinc-500">{t('magazine.noStories')}</p> : (
                  <div className="flex flex-col gap-1.5 max-h-[180px] overflow-y-auto pr-1">
                    {sources.stories.map(s => <Row key={s.id} k={`s:${s.id}`} title={s.title} icon={<Newspaper size={15} />} sub={fmt(s.post_date)} />)}
                  </div>
                )}
              </section>
            </>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">{t('magazine.note')}</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={600} className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[13px] text-zinc-900 dark:text-white resize-none" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-5 mt-2">
          <span className="text-[12px] text-zinc-500 min-w-0 truncate" aria-live="polite">{busy || t('magazine.format')}</span>
          <button type="button" onClick={create} disabled={!picked.length || !!busy} data-testid="mag-create"
            className="h-10 px-5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[14px] font-semibold disabled:opacity-40 shrink-0">
            {t('magazine.create')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
