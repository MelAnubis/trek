import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { reloadForUpdate, watchForNewBuild } from '../../utils/appUpdate'

/**
 * «Hay una versión nueva»: tras un despliegue, la página abierta (o la app
 * de Android) sigue con la versión anterior hasta recargar. Avisa en vez de
 * recargar sola, porque podrías estar a mitad de escribir.
 */
export default function UpdateBanner() {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  useEffect(() => watchForNewBuild(() => setShow(true)), [])
  if (!show) return null
  return (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 pl-4 pr-2 py-2 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-2xl text-[13px] max-w-[calc(100vw-24px)]"
      style={{ bottom: 'calc(var(--bottom-nav-h, 0px) + 16px)' }}>
      <span>{t('app.update.available')}</span>
      <button type="button" onClick={() => reloadForUpdate()} className="h-8 px-3 rounded-lg bg-white/15 dark:bg-zinc-900/10 font-semibold inline-flex items-center gap-1.5">
        <RefreshCw size={14} />{t('app.update.reload')}
      </button>
      <button type="button" onClick={() => setShow(false)} aria-label={t('common.close')} className="w-8 h-8 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100"><X size={15} /></button>
    </div>
  )
}
