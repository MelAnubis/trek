import React from 'react'
import ReactDOM from 'react-dom'
import { useState, useRef, useEffect } from 'react'
import { Upload, Plane, Train, Hotel, UtensilsCrossed, Car, Anchor, Calendar, ArrowLeft, X } from 'lucide-react'
import type { BookingImportPreviewItem } from '../../types'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { reservationsApi } from '../../api/client'
import { useTripStore } from '../../store/tripStore'

interface BookingImportModalProps {
  isOpen: boolean
  onClose: () => void
  tripId: number | string
  pushUndo?: (label: string, undoFn: () => Promise<void> | void) => void
}

const ACCEPTED_EXTS = ['.eml', '.pdf', '.pkpass', '.html', '.htm', '.txt']
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5

const TYPE_ICONS: Record<string, React.ElementType> = {
  flight: Plane,
  train: Train,
  hotel: Hotel,
  restaurant: UtensilsCrossed,
  car: Car,
  cruise: Anchor,
  event: Calendar,
}

function typeColor(type: string): string {
  const map: Record<string, string> = {
    flight: '#3b82f6',
    train: '#10b981',
    hotel: '#8b5cf6',
    restaurant: '#f59e0b',
    car: '#6b7280',
    cruise: '#06b6d4',
    event: '#ec4899',
  }
  return map[type] ?? 'var(--text-faint)'
}

function formatDateTime(iso: unknown): string {
  if (!iso) return ''
  const str = typeof iso === 'string' ? iso : typeof iso === 'object' ? JSON.stringify(iso) : String(iso)
  const date = str.slice(0, 10)
  const time = str.length > 10 ? str.slice(11, 16) : ''
  return [date, time].filter(Boolean).join(' ')
}

export default function BookingImportModal({ isOpen, onClose, tripId, pushUndo }: BookingImportModalProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const loadTrip = useTripStore((s) => s.loadTrip)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mouseDownTarget = useRef<EventTarget | null>(null)

  type Phase = 'upload' | 'preview' | 'confirming'
  const [phase, setPhase] = useState<Phase>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewItems, setPreviewItems] = useState<BookingImportPreviewItem[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set())

  const reset = () => {
    setPhase('upload')
    setFiles([])
    setIsDragOver(false)
    setLoading(false)
    setError('')
    setPreviewItems([])
    setWarnings([])
    setExcluded(new Set())
  }

  useEffect(() => {
    if (isOpen) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleClose = () => { reset(); onClose() }

  const validateFile = (f: File): string | null => {
    const ext = ('.' + f.name.toLowerCase().split('.').pop()) as string
    if (!ACCEPTED_EXTS.includes(ext)) return t('reservations.import.unsupportedFormat')
    if (f.size > MAX_FILE_BYTES) return t('reservations.import.fileTooLarge', { name: f.name })
    return null
  }

  const selectFiles = (incoming: File[]) => {
    const valid: File[] = []
    let firstErr: string | null = null
    for (const f of incoming.slice(0, MAX_FILES)) {
      const err = validateFile(f)
      if (err) { firstErr = firstErr ?? err; continue }
      valid.push(f)
    }
    if (valid.length === 0) { setError(firstErr ?? ''); return }
    setFiles(valid)
    setError(firstErr ?? '')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : []
    e.target.value = ''
    if (list.length) selectFiles(list)
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = (e: React.DragEvent) => { if (e.target === e.currentTarget) setIsDragOver(false) }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const list = Array.from(e.dataTransfer.files)
    if (list.length) selectFiles(list)
  }

  const handleParse = async () => {
    if (files.length === 0 || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await reservationsApi.importBookingPreview(tripId, files)
      setPreviewItems(result.items ?? [])
      setWarnings(result.warnings ?? [])
      setExcluded(new Set())
      setPhase('preview')
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? t('reservations.import.error')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    const toImport = previewItems.filter((_, i) => !excluded.has(i))
    if (toImport.length === 0) return
    setPhase('confirming')
    setError('')
    try {
      const result = await reservationsApi.importBookingConfirm(tripId, toImport)
      const created = result.created ?? []
      await loadTrip(tripId)

      if (created.length > 0) {
        pushUndo?.(t('undo.importBooking'), async () => {
          try {
            const { reservationsApi: rApi } = await import('../../api/client')
            await Promise.all(created.map((r) => rApi.delete(tripId, r.id).catch(() => {})))
          } catch {}
          await loadTrip(tripId)
        })
        toast.success(t('reservations.import.success', { count: created.length }))
      } else {
        toast.warning(t('reservations.import.previewEmpty'))
      }

      handleClose()
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('reservations.import.error'))
      setPhase('preview')
    }
  }

  const toggleExclude = (idx: number) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const activeCount = previewItems.filter((_, i) => !excluded.has(i)).length

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div
      className="bg-[rgba(0,0,0,0.4)] !fixed !inset-[0] !z-[99999] !flex !items-center !justify-center !p-[16px]"
      onMouseDown={e => { mouseDownTarget.current = e.target }}
      onClick={e => {
        if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) handleClose()
        mouseDownTarget.current = null
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface-card !rounded-[16px] !w-[100%] !max-w-[540px] !p-[24px] ![box-shadow:0_8px_32px_rgba(0,0,0,0.2)] ![font-family:var(--font-system)] !max-h-[90vh] !flex !flex-col"
      >
        {/* Header */}
        <div className="!flex !items-center !gap-[8px] !mb-[14px]">
          {phase === 'preview' && (
            <button onClick={() => setPhase('upload')} className="bg-transparent text-content-faint ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] !flex !items-center">
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="!flex-[1] !text-[length:15px] !font-[700] ![color:var(--text-primary)]">
            {t('reservations.import.title')}
          </div>
          <button onClick={handleClose} className="bg-transparent text-content-faint ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] !flex !items-center">
            <X size={16} />
          </button>
        </div>

        <div className="!flex-[1] !overflow-y-auto !min-h-[0]">
          {/* Upload phase */}
          {phase === 'upload' && (
            <>
              <div className="!text-[length:12px] ![color:var(--text-faint)] !mb-[14px] !leading-[1.45]">
                {t('reservations.import.acceptedFormats')}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTS.join(',')}
                multiple
                style={{ display: 'none' }}
                onChange={handleInputChange}
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={[isDragOver ? 'bg-surface-tertiary' : 'bg-transparent', '!w-[100%] !min-h-[100px] !rounded-[12px] !flex !flex-col !items-center !justify-center !gap-[6px] !text-[length:13px] !font-[500] !cursor-pointer !mb-[12px] !p-[16px] !box-border ![transition:border-color_0.15s,_background_0.15s]'].join(' ')}
                style={{ border: `2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border-primary)'}` }}
              >
                <Upload size={18} strokeWidth={1.8} color={isDragOver ? 'var(--accent)' : 'var(--text-faint)'} style={{ pointerEvents: 'none' }} />
                {isDragOver ? (
                  <span className="text-accent !pointer-events-none">{t('reservations.import.dropActive')}</span>
                ) : files.length > 0 ? (
                  <span className="![color:var(--text-primary)] !text-center !break-all !pointer-events-none">{files.map(f => f.name).join(', ')}</span>
                ) : (
                  <span className="![color:var(--text-faint)] !text-center !pointer-events-none">{t('reservations.import.dropHere')}</span>
                )}
              </div>
            </>
          )}

          {/* Preview phase */}
          {(phase === 'preview' || phase === 'confirming') && (
            <>
              <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary)] !mb-[10px]">
                {t('reservations.import.previewHeading', { count: previewItems.length })}
              </div>

              {previewItems.length === 0 && (
                <div className="text-content-faint !text-[length:13px] !text-center !p-[24px_0]">
                  {t('reservations.import.previewEmpty')}
                </div>
              )}

              {previewItems.map((item, idx) => {
                const Icon = TYPE_ICONS[item.type] ?? Calendar
                const isExcluded = excluded.has(idx)
                const fromEp = item.endpoints?.find(e => e.role === 'from')
                const toEp = item.endpoints?.find(e => e.role === 'to')

                return (
                  <div
                    key={`${item.source.fileName}-${idx}`}
                    className={[isExcluded ? 'bg-surface-tertiary' : 'bg-surface-secondary', '!rounded-[10px] !p-[10px_12px] !mb-[8px] ![transition:opacity_0.15s] !flex !gap-[10px] !items-start'].join(' ')}
                    style={{ border: `1px solid ${isExcluded ? 'var(--border-faint)' : 'var(--border-primary)'}`, opacity: isExcluded ? 0.5 : 1 }}
                  >
                    <div className="!shrink-[0] !mt-[2px]">
                      <Icon size={15} color={typeColor(item.type)} />
                    </div>
                    <div className="!flex-[1] !min-w-[0]">
                      <div className="!text-[length:13px] !font-[600] ![color:var(--text-primary)] !mb-[2px] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                        {item.title}
                      </div>
                      {fromEp && toEp && (
                        <div className="!text-[length:11px] ![color:var(--text-muted)] !mb-[2px]">
                          {fromEp.code ?? fromEp.name} → {toEp.code ?? toEp.name}
                        </div>
                      )}
                      {item.reservation_time && (
                        <div className="!text-[length:11px] ![color:var(--text-faint)]">
                          {formatDateTime(item.reservation_time)}
                          {item.reservation_end_time && ` – ${formatDateTime(item.reservation_end_time)}`}
                        </div>
                      )}
                      {item._accommodation?.check_in && (
                        <div className="!text-[length:11px] ![color:var(--text-faint)]">
                          {formatDateTime(item._accommodation.check_in)} – {formatDateTime(item._accommodation.check_out)}
                        </div>
                      )}
                      {item.confirmation_number && (
                        <div className="!text-[length:11px] ![color:var(--text-faint)] ![font-family:monospace]">
                          {item.confirmation_number}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => toggleExclude(idx)}
                      className="bg-transparent text-content-faint ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] !shrink-[0] !text-[length:11px] ![font-family:inherit] !font-[500]"
                      title={t('reservations.import.removeItem')}
                    >
                      {isExcluded ? '＋' : <X size={12} />}
                    </button>
                  </div>
                )
              })}
            </>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="bg-[rgba(245,158,11,0.08)] text-[#92400e] ![border:1px_solid_rgba(245,158,11,0.3)] !rounded-[10px] !p-[8px_10px] !text-[length:12px] !mt-[8px] !whitespace-pre-wrap">
              {warnings.join('\n')}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-[rgba(239,68,68,0.08)] text-[#b91c1c] ![border:1px_solid_rgba(239,68,68,0.35)] !rounded-[10px] !p-[8px_10px] !text-[length:12px] !whitespace-pre-wrap !mt-[8px]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="!flex !gap-[8px] !justify-end !mt-[14px] !pt-[14px] ![border-top:1px_solid_var(--border-faint)]">
          <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-primary)] !text-[length:13px] !font-[500] !cursor-pointer ![font-family:inherit]"
            onClick={handleClose}
          >
            {t('common.cancel')}
          </button>

          {phase === 'upload' && (
            <button
              onClick={handleParse}
              disabled={files.length === 0 || loading}
              className={[files.length > 0 && !loading ? 'bg-accent text-accent-text' : 'bg-surface-tertiary text-content-faint', '!p-[8px_16px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[500] ![font-family:inherit]'].join(' ')}
              style={{ cursor: files.length > 0 && !loading ? 'pointer' : 'default' }}
            >
              {loading ? t('reservations.import.parsing') : t('common.import')}
            </button>
          )}

          {(phase === 'preview' || phase === 'confirming') && (
            <button
              onClick={handleConfirm}
              disabled={activeCount === 0 || phase === 'confirming'}
              className={[activeCount > 0 && phase !== 'confirming' ? 'bg-accent text-accent-text' : 'bg-surface-tertiary text-content-faint', '!p-[8px_16px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[500] ![font-family:inherit]'].join(' ')}
              style={{ cursor: activeCount > 0 && phase !== 'confirming' ? 'pointer' : 'default' }}
            >
              {phase === 'confirming' ? t('common.loading') : t('reservations.import.confirm', { count: activeCount })}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
