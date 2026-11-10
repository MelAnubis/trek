import React from 'react'
import ReactDOM from 'react-dom'
import { useState, useRef, useEffect } from 'react'
import { Upload } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { placesApi } from '../../api/client'
import { useTripStore } from '../../store/tripStore'

interface PlacesImportSummary {
  totalPlacemarks: number
  createdCount: number
  skippedCount: number
  warnings: string[]
  errors: string[]
}

interface FileImportModalProps {
  isOpen: boolean
  onClose: () => void
  tripId: number | string
  pushUndo?: (label: string, undoFn: () => Promise<void> | void) => void
  initialFile?: File | null
}

const MAX_FILE_BYTES = 10 * 1024 * 1024

export default function FileImportModal({ isOpen, onClose, tripId, pushUndo, initialFile }: FileImportModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const loadTrip = useTripStore((s) => s.loadTrip)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<PlacesImportSummary | null>(null)
  const [gpxOpts, setGpxOpts] = useState({ waypoints: true, routes: true, tracks: true })
  const [kmlOpts, setKmlOpts] = useState({ points: true, paths: true })

  const validateFile = (f: File): string | null => {
    const ext = f.name.toLowerCase().split('.').pop()
    if (ext !== 'gpx' && ext !== 'kml' && ext !== 'kmz') {
      return t('places.importFileUnsupported')
    }
    if (f.size > MAX_FILE_BYTES) {
      return t('places.importFileTooLarge', { maxMb: 10 })
    }
    return null
  }

  const reset = () => {
    setFile(null)
    setIsDragOver(false)
    setLoading(false)
    setError('')
    setSummary(null)
  }

  // When the modal opens, reset state and pre-load any file dropped from the sidebar.
  useEffect(() => {
    if (!isOpen) return
    setIsDragOver(false)
    setLoading(false)
    setSummary(null)
    if (initialFile) {
      const err = validateFile(initialFile)
      if (err) {
        setFile(null)
        setError(err)
      } else {
        setFile(initialFile)
        setError('')
      }
    } else {
      setFile(null)
      setError('')
    }
  // validateFile uses t() which is stable — intentionally omitted from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialFile])

  const handleClose = () => {
    reset()
    onClose()
  }

  const selectFile = (f: File) => {
    const validationError = validateFile(f)
    if (validationError) {
      setError(validationError)
      setFile(null)
      return
    }
    setFile(f)
    setError('')
    setSummary(null)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) selectFile(f)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.target === e.currentTarget) setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) selectFile(f)
  }

  const handleImport = async () => {
    if (!file || loading) return
    const ext = file.name.toLowerCase().split('.').pop()
    setLoading(true)
    setError('')
    setSummary(null)

    try {
      if (ext === 'gpx') {
        const result = await placesApi.importGpx(tripId, file, gpxOpts)
        await loadTrip(tripId)
        if (result.count === 0 && result.skipped > 0) {
          toast.warning(t('places.importAllSkipped'))
        } else {
          toast.success(t('places.gpxImported', { count: result.count }))
        }
        if (result.places?.length > 0) {
          const importedIds: number[] = result.places.map((p: { id: number }) => p.id)
          pushUndo?.(t('undo.importGpx'), async () => {
            try { await placesApi.bulkDelete(tripId, importedIds) } catch {}
            await loadTrip(tripId)
          })
        }
        handleClose()
      } else {
        const result = await placesApi.importMapFile(tripId, file, kmlOpts)
        await loadTrip(tripId)
        setSummary(result.summary || null)
        if (result.count === 0 && (result.summary?.skippedCount ?? 0) > 0) {
          toast.warning(t('places.importAllSkipped'))
        } else {
          toast.success(t('places.kmlKmzImported', { count: result.count }))
        }
        if (result.summary?.errors?.length > 0) {
          setError(result.summary.errors.join('\n'))
        }
        if (result.places?.length > 0) {
          const importedIds: number[] = result.places.map((p: { id: number }) => p.id)
          pushUndo?.(t('undo.importKeyholeMarkup'), async () => {
            try { await placesApi.bulkDelete(tripId, importedIds) } catch {}
            await loadTrip(tripId)
          })
        }
      }
    } catch (err: any) {
      const responseSummary = err?.response?.data?.summary as PlacesImportSummary | undefined
      if (responseSummary) setSummary(responseSummary)
      const message = err?.response?.data?.error || t('places.importFileError')
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const fileExt = file?.name.toLowerCase().split('.').pop() ?? ''
  const isGpx = fileExt === 'gpx'
  const isKml = fileExt === 'kml' || fileExt === 'kmz'
  const gpxNoneSelected = isGpx && !gpxOpts.waypoints && !gpxOpts.routes && !gpxOpts.tracks
  const kmlNoneSelected = isKml && !kmlOpts.points && !kmlOpts.paths
  const canImport = !!file && !loading && !gpxNoneSelected && !kmlNoneSelected

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div className="!fixed !inset-[0] !z-[99999] ![background:var(--modal-backdrop)] ![backdrop-filter:blur(12px)_saturate(150%)] ![-webkit-backdrop-filter:blur(12px)_saturate(150%)] !flex !items-center !justify-center !p-[16px]"
      onClick={handleClose}
    >
      <div className="![background:var(--modal-bg)] ![backdrop-filter:var(--glass-blur-lg)] ![-webkit-backdrop-filter:var(--glass-blur-lg)] ![border:1px_solid_var(--modal-border)] !rounded-[16px] !w-[100%] !max-w-[520px] !p-[24px] ![box-shadow:var(--modal-shadow)]"
        onClick={e => e.stopPropagation()}
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
      >
        <div className="!text-[length:15px] !font-[700] ![color:var(--text-primary)] !mb-[6px]">
          {t('places.importFile')}
        </div>
        <div className="!text-[length:12px] ![color:var(--text-faint)] !mb-[14px] !leading-[1.45]">
          {t('places.importFileHint')}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx,.kml,.kmz"
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />

        <div className="!w-[100%] !min-h-[88px] !rounded-[12px] !flex !flex-col !items-center !justify-center !gap-[6px] !text-[length:13px] !font-[500] !cursor-pointer !mb-[12px] ![font-family:inherit] ![transition:border-color_0.15s,_background_0.15s] !box-border !p-[16px]"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{ border: `2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border-primary)'}`, background: isDragOver ? 'var(--bg-tertiary)' : 'transparent' }}
        >
          <Upload size={18} strokeWidth={1.8} color={isDragOver ? 'var(--accent)' : 'var(--text-faint)'} style={{ pointerEvents: 'none' }} />
          {isDragOver ? (
            <span className="![color:var(--accent)] !pointer-events-none">{t('places.importFileDropActive')}</span>
          ) : file ? (
            <span className="![color:var(--text-primary)] !text-center !break-all !pointer-events-none">{file.name}</span>
          ) : (
            <span className="![color:var(--text-faint)] !text-center !pointer-events-none">{t('places.importFileDropHere')}</span>
          )}
        </div>

        {isGpx && (
          <div className="!mb-[12px]">
            <div className="!text-[length:11px] !font-[600] ![color:var(--text-muted)] !mb-[6px] !uppercase !tracking-[0.05em]">
              {t('places.gpxImportTypes')}
            </div>
            {(['waypoints', 'routes', 'tracks'] as const).map(key => (
              <label className="!flex !items-center !gap-[8px] !p-[4px_0] !cursor-pointer" key={key} onClick={() => setGpxOpts(prev => ({ ...prev, [key]: !prev[key] }))}>
                <div className="!w-[16px] !h-[16px] !rounded-[4px] !shrink-[0] !flex !items-center !justify-center" style={{ border: gpxOpts[key] ? 'none' : '1.5px solid var(--border-primary)', background: gpxOpts[key] ? 'var(--accent)' : 'transparent' }}>
                  {gpxOpts[key] && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <span className="!text-[length:12px] ![color:var(--text-primary)] !select-none">
                  {t(key === 'waypoints' ? 'places.gpxImportWaypoints' : key === 'routes' ? 'places.gpxImportRoutes' : 'places.gpxImportTracks')}
                </span>
              </label>
            ))}
            {gpxNoneSelected && (
              <div className="!text-[length:11px] ![color:#b45309] !mt-[4px]">{t('places.gpxImportNoneSelected')}</div>
            )}
          </div>
        )}

        {isKml && (
          <div className="!mb-[12px]">
            <div className="!text-[length:11px] !font-[600] ![color:var(--text-muted)] !mb-[6px] !uppercase !tracking-[0.05em]">
              {t('places.kmlImportTypes')}
            </div>
            {(['points', 'paths'] as const).map(key => (
              <label className="!flex !items-center !gap-[8px] !p-[4px_0] !cursor-pointer" key={key} onClick={() => setKmlOpts(prev => ({ ...prev, [key]: !prev[key] }))}>
                <div className="!w-[16px] !h-[16px] !rounded-[4px] !shrink-[0] !flex !items-center !justify-center" style={{ border: kmlOpts[key] ? 'none' : '1.5px solid var(--border-primary)', background: kmlOpts[key] ? 'var(--accent)' : 'transparent' }}>
                  {kmlOpts[key] && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <span className="!text-[length:12px] ![color:var(--text-primary)] !select-none">
                  {t(key === 'points' ? 'places.kmlImportPoints' : 'places.kmlImportPaths')}
                </span>
              </label>
            ))}
            {kmlNoneSelected && (
              <div className="!text-[length:11px] ![color:#b45309] !mt-[4px]">{t('places.kmlImportNoneSelected')}</div>
            )}
          </div>
        )}

        {summary && (
          <div className="![border:1px_solid_var(--border-primary)] !rounded-[10px] ![background:var(--bg-tertiary)] !p-[10px] !mb-[10px]">
            <div className="!text-[length:12px] ![color:var(--text-muted)]">
              {t('places.kmlKmzSummaryValues', {
                total: summary.totalPlacemarks,
                created: summary.createdCount,
                skipped: summary.skippedCount,
              })}
            </div>
            {summary.warnings?.length > 0 && (
              <div className="!mt-[8px] !text-[length:12px] ![color:#b45309] !whitespace-pre-wrap">
                {summary.warnings.join('\n')}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="![border:1px_solid_rgba(239,68,68,0.35)] !rounded-[10px] ![background:rgba(239,68,68,0.08)] !p-[8px_10px] !text-[length:12px] ![color:#b91c1c] !whitespace-pre-wrap !mb-[10px]">
            {error}
          </div>
        )}

        <div className="!flex !gap-[8px] !justify-end">
          <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-primary)] !text-[length:13px] !font-[500] !cursor-pointer ![font-family:inherit]"
            onClick={handleClose}
          >
            {t('common.cancel')}
          </button>
          <button className="!p-[8px_16px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[500] ![font-family:inherit]"
            onClick={handleImport}
            disabled={!canImport}
            style={{ background: canImport ? 'var(--accent)' : 'var(--bg-tertiary)', color: canImport ? 'var(--accent-text)' : 'var(--text-faint)', cursor: canImport ? 'pointer' : 'default' }}
          >
            {loading ? t('common.loading') : t('common.import')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
