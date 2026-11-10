import ReactDOM from 'react-dom'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, Trash2, ExternalLink, Download, X, FileText, FileImage, File, MapPin, Ticket, StickyNote, Star, RotateCcw, Pencil, Check, ChevronLeft, ChevronRight, Plane, Train, Car, Ship, Bus, Sailboat, Bike, CarTaxiFront, Route } from 'lucide-react'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { filesApi } from '../../api/client'
import type { Place, Reservation, TripFile, Day, AssignmentsMap } from '../../types'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'

import { getAuthUrl } from '../../api/authUrl'
import { downloadFile, openFile as openFileUrl } from '../../utils/fileDownload'

function isImage(mimeType?: string, filename?: string) {
  if (filename) {
    const ext = filename.toLowerCase().split('.').pop()
    if (['heic', 'heif', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tiff'].includes(ext || '')) return true
  }
  return (mimeType || '').startsWith('image/')
}

function getFileIcon(mimeType) {
  if (!mimeType) return File
  if (mimeType === 'application/pdf') return FileText
  if (isImage(mimeType)) return FileImage
  return File
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function triggerDownload(url: string, filename: string) {
  downloadFile(url, filename).catch(() => {})
}

function formatDateWithLocale(dateStr, locale) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return '' }
}

// Image lightbox with gallery navigation
interface ImageLightboxProps {
  files: TripFile[]
  initialIndex: number
  onClose: () => void
}

function ImageLightbox({ files, initialIndex, onClose }: ImageLightboxProps) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(initialIndex)
  const [imgSrc, setImgSrc] = useState('')
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const file = files[index]

  useEffect(() => {
    setImgSrc('')
    if (file) getAuthUrl(file.url, 'download').then(setImgSrc)
  }, [file?.url])

  const goPrev = () => setIndex(i => Math.max(0, i - 1))
  const goNext = () => setIndex(i => Math.min(files.length - 1, i + 1))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!file) return null

  const hasPrev = index > 0
  const hasNext = index < files.length - 1
  const navBtn = (side: 'left' | 'right', onClick: () => void, show: boolean): React.ReactNode => show ? (
    <button className="trek-h-background-d3ab94 !absolute !top-[50%] !z-[10] ![background:rgba(0,0,0,0.5)] ![border:none] !rounded-[50%] !w-[40px] !h-[40px] !flex !items-center !justify-center !cursor-pointer ![color:rgba(255,255,255,0.8)] ![transition:background_0.15s]" onClick={e => { e.stopPropagation(); onClick() }}
      style={{ [side]: 12, transform: 'translateY(-50%)' }}>
      {side === 'left' ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  ) : null

  return (
    <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.92)] !z-[2000] !flex !flex-col !pb-[var(--bottom-nav-h)]"
      onClick={onClose}
      onTouchStart={e => setTouchStart(e.touches[0].clientX)}
      onTouchEnd={e => {
        if (touchStart === null) return
        const diff = e.changedTouches[0].clientX - touchStart
        if (diff > 60) goPrev()
        else if (diff < -60) goNext()
        setTouchStart(null)
      }}
    >
      {/* Header */}
      <div className="!flex !items-center !justify-between !p-[10px_16px] !shrink-[0]" onClick={e => e.stopPropagation()}>
        <span className="!text-[length:12px] ![color:rgba(255,255,255,0.7)] !overflow-hidden !text-ellipsis !whitespace-nowrap !flex-[1]">
          {file.original_name}
          <span className="!ml-[8px] ![color:rgba(255,255,255,0.4)]">{index + 1} / {files.length}</span>
        </span>
        <div className="!flex !gap-[8px] !shrink-[0]">
          <button className="![background:none] ![border:none] !cursor-pointer ![color:rgba(255,255,255,0.7)] !flex !p-[4px]"
            onClick={() => openFileUrl(file.url, file.original_name).catch(() => {})}
            title={t('files.openTab')}>
            <ExternalLink size={16} />
          </button>
          <button className="![background:none] ![border:none] !cursor-pointer ![color:rgba(255,255,255,0.7)] !flex !p-[4px]"
            onClick={() => triggerDownload(file.url, file.original_name)}
            title={t('files.download') || 'Download'}>
            <Download size={16} />
          </button>
          <button className="![background:none] ![border:none] !cursor-pointer ![color:rgba(255,255,255,0.7)] !flex !p-[4px]" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main image + nav */}
      <div className="!flex-[1] !flex !items-center !justify-center !relative !min-h-[0]"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        {navBtn('left', goPrev, hasPrev)}
        {imgSrc && <img className="!max-w-[85vw] !max-h-[80vh] !object-contain !rounded-[8px] !block" src={imgSrc} alt={file.original_name} onClick={e => e.stopPropagation()} />}
        {navBtn('right', goNext, hasNext)}
      </div>

      {/* Thumbnail strip */}
      {files.length > 1 && (
        <div className="!flex !gap-[4px] !justify-center !p-[10px_16px] !shrink-[0] !overflow-x-auto" onClick={e => e.stopPropagation()}>
          {files.map((f, i) => (
            <ThumbImg key={f.id} file={f} active={i === index} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ThumbImg({ file, active, onClick }: { file: TripFile; active: boolean; onClick: () => void }) {
  const [src, setSrc] = useState('')
  useEffect(() => { getAuthUrl(file.url, 'download').then(setSrc) }, [file.url])
  return (
    <button className="!w-[48px] !h-[48px] !rounded-[6px] !overflow-hidden !cursor-pointer !p-[0] ![background:#111] !shrink-[0] ![transition:opacity_0.15s]" onClick={onClick} style={{ border: active ? '2px solid #fff' : '2px solid transparent', opacity: active ? 1 : 0.5 }}>
      {src && <img className="!w-[100%] !h-[100%] !object-cover !block" src={src} alt="" />}
    </button>
  )
}

// Authenticated image — fetches a short-lived download token and renders the image
function AuthedImg({ src, style }: { src: string; style?: React.CSSProperties }) {
  const [authSrc, setAuthSrc] = useState('')
  useEffect(() => {
    getAuthUrl(src, 'download').then(setAuthSrc)
  }, [src])
  return authSrc ? <img src={authSrc} alt="" style={style} /> : null
}

// Source badge
interface SourceBadgeProps {
  icon: React.ElementType
  label: string
}

function SourceBadge({ icon: Icon, label }: SourceBadgeProps) {
  return (
    <span className="!inline-flex !items-center !gap-[4px] !text-[length:10.5px] ![color:#4b5563] ![background:var(--bg-tertiary)] ![border:1px_solid_var(--border-primary)] !rounded-[6px] !p-[2px_7px] !font-[500] !max-w-[100%] !overflow-hidden">
      <Icon size={10} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{label}</span>
    </span>
  )
}

function AvatarChip({ name, avatarUrl, size = 20 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)

  const onEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 })
    }
    setHover(true)
  }

  return (
    <>
      <div ref={ref} onMouseEnter={onEnter} onMouseLeave={() => setHover(false)}
        style={{
          width: size, height: size, borderRadius: '50%', border: '1.5px solid var(--border-primary)',
          background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.4, fontWeight: 700, color: 'var(--text-muted)', overflow: 'hidden', flexShrink: 0,
          cursor: 'default',
        }}>
        {avatarUrl
          ? <img className="!w-[100%] !h-[100%] !object-cover" src={avatarUrl} />
          : name?.[0]?.toUpperCase()
        }
      </div>
      {hover && ReactDOM.createPortal(
        <div className="!fixed ![background:var(--bg-elevated)] ![color:var(--text-primary)] !text-[length:11px] !font-[500] !p-[3px_8px] !rounded-[6px] ![box-shadow:0_2px_8px_rgba(0,0,0,0.15)] !whitespace-nowrap !z-[9999] !pointer-events-none" style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}>
          {name}
        </div>,
        document.body
      )}
    </>
  )
}

const TRANSPORT_TYPES = new Set(['flight', 'train', 'bus', 'car', 'taxi', 'bicycle', 'cruise', 'ferry', 'transport_other'])

function transportIcon(type: string) {
  if (type === 'train') return Train
  if (type === 'bus') return Bus
  if (type === 'car') return Car
  if (type === 'taxi') return CarTaxiFront
  if (type === 'bicycle') return Bike
  if (type === 'cruise') return Ship
  if (type === 'ferry') return Sailboat
  if (type === 'transport_other') return Route
  return Plane
}

interface FileManagerProps {
  files?: TripFile[]
  onUpload: (fd: FormData) => Promise<any>
  onDelete: (fileId: number) => Promise<void>
  onUpdate?: (fileId: number, data: Partial<TripFile>) => Promise<unknown>
  places: Place[]
  days?: Day[]
  assignments?: AssignmentsMap
  reservations?: Reservation[]
  tripId: number | string
  /** Comma-separated extensions the admin allows ("jpg,png,pdf"), or null for the default list. */
  allowedFileTypes?: string | null
}

export default function FileManager({ files = [], onUpload, onDelete, onUpdate, places, days = [], assignments = {}, reservations = [], tripId, allowedFileTypes }: FileManagerProps) {
  const [uploading, setUploading] = useState(false)
  const [filterType, setFilterType] = useState('all')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [trashFiles, setTrashFiles] = useState<TripFile[]>([])
  const [loadingTrash, setLoadingTrash] = useState(false)
  const toast = useToast()
  const can = useCanDo()
  const trip = useTripStore((s) => s.trip)
  const { t, locale } = useTranslation()

  const loadTrash = useCallback(async () => {
    setLoadingTrash(true)
    try {
      const data = await filesApi.list(tripId, true)
      setTrashFiles(data.files || [])
    } catch { /* */ }
    setLoadingTrash(false)
  }, [tripId])

  const toggleTrash = useCallback(() => {
    if (!showTrash) loadTrash()
    setShowTrash(v => !v)
  }, [showTrash, loadTrash])

  const refreshFiles = useCallback(async () => {
    if (onUpdate) onUpdate(0, {} as any)
  }, [onUpdate])

  const handleStar = async (fileId: number) => {
    try {
      await filesApi.toggleStar(tripId, fileId)
      refreshFiles()
    } catch { /* */ }
  }

  const handleRestore = async (fileId: number) => {
    try {
      await filesApi.restore(tripId, fileId)
      setTrashFiles(prev => prev.filter(f => f.id !== fileId))
      refreshFiles()
      toast.success(t('files.toast.restored'))
    } catch {
      toast.error(t('files.toast.restoreError'))
    }
  }

  const handlePermanentDelete = async (fileId: number) => {
    if (!confirm(t('files.confirm.permanentDelete'))) return
    try {
      await filesApi.permanentDelete(tripId, fileId)
      setTrashFiles(prev => prev.filter(f => f.id !== fileId))
      toast.success(t('files.toast.deleted'))
    } catch {
      toast.error(t('files.toast.deleteError'))
    }
  }

  const handleEmptyTrash = async () => {
    if (!confirm(t('files.confirm.emptyTrash'))) return
    try {
      await filesApi.emptyTrash(tripId)
      setTrashFiles([])
      toast.success(t('files.toast.trashEmptied') || 'Trash emptied')
    } catch {
      toast.error(t('files.toast.deleteError'))
    }
  }

  const [lastUploadedIds, setLastUploadedIds] = useState<number[]>([])

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return
    setUploading(true)
    const uploadedIds: number[] = []
    try {
      for (const file of acceptedFiles) {
        const formData = new FormData()
        formData.append('file', file)
        const result = await onUpload(formData)
        const fileObj = result?.file || result
        if (fileObj?.id) uploadedIds.push(fileObj.id)
      }
      toast.success(t('files.uploaded', { count: acceptedFiles.length }))
      // Open assign modal for the last uploaded file
      const lastId = uploadedIds[uploadedIds.length - 1]
      if (lastId && (places.length > 0 || reservations.length > 0)) {
        setAssignFileId(lastId)
      }
    } catch {
      toast.error(t('files.uploadError'))
    } finally {
      setUploading(false)
    }
  }, [onUpload, toast, t, places, reservations])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: 50 * 1024 * 1024,
    noClick: false,
  })

  const handlePaste = useCallback((e) => {
    if (!can('file_upload', trip)) return
    const items = e.clipboardData?.items
    if (!items) return
    const pastedFiles: File[] = []
    for (const item of Array.from(items) as DataTransferItem[]) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) pastedFiles.push(file)
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault()
      onDrop(pastedFiles)
    }
  }, [onDrop])

  const filteredFiles = files.filter(f => {
    if (filterType === 'starred') return !!f.starred
    if (filterType === 'pdf') return f.mime_type === 'application/pdf'
    if (filterType === 'image') return isImage(f.mime_type, f.original_name)
    if (filterType === 'doc') return (f.mime_type || '').includes('word') || (f.mime_type || '').includes('excel') || (f.mime_type || '').includes('text')
    if (filterType === 'collab') return !!f.note_id
    return true
  })

  const handleDelete = async (id) => {
    try {
      await onDelete(id)
      toast.success(t('files.toast.trashed') || 'Moved to trash')
    } catch {
      toast.error(t('files.toast.deleteError'))
    }
  }

  const [previewFile, setPreviewFile] = useState(null)
  const [previewFileUrl, setPreviewFileUrl] = useState('')
  useEffect(() => {
    if (previewFile) {
      getAuthUrl(previewFile.url, 'download').then(setPreviewFileUrl)
    } else {
      setPreviewFileUrl('')
    }
  }, [previewFile?.url])
  const [assignFileId, setAssignFileId] = useState<number | null>(null)

  const handleAssign = async (fileId: number, data: { place_id?: number | null; reservation_id?: number | null }) => {
    try {
      await filesApi.update(tripId, fileId, data)
      refreshFiles()
    } catch {
      toast.error(t('files.toast.assignError'))
    }
  }

  const imageFiles = filteredFiles.filter(f => isImage(f.mime_type, f.original_name))

  const openFile = (file) => {
    if (isImage(file.mime_type, file.original_name)) {
      const idx = imageFiles.findIndex(f => f.id === file.id)
      setLightboxIndex(idx >= 0 ? idx : 0)
    } else {
      setPreviewFile(file)
    }
  }

  const renderFileRow = (file: TripFile, isTrash = false) => {
    const FileIcon = getFileIcon(file.mime_type)
    const allLinkedPlaceIds = new Set<number>()
    if (file.place_id) allLinkedPlaceIds.add(file.place_id)
    for (const pid of (file.linked_place_ids || [])) allLinkedPlaceIds.add(pid)
    const linkedPlaces = [...allLinkedPlaceIds].map(pid => places?.find(p => p.id === pid)).filter(Boolean)
    // All linked reservations (primary + file_links)
    const allLinkedResIds = new Set<number>()
    if (file.reservation_id) allLinkedResIds.add(file.reservation_id)
    for (const rid of (file.linked_reservation_ids || [])) allLinkedResIds.add(rid)
    const linkedReservations = [...allLinkedResIds].map(rid => reservations?.find(r => r.id === rid)).filter(Boolean)
    return (
      <div className="trek-hover-border-faint group ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[12px] !p-[10px_12px] !flex !items-start !gap-[10px] ![transition:border-color_0.12s]" key={file.id} style={{ opacity: isTrash ? 0.7 : 1 }}
      >
        {/* Icon or thumbnail */}
        <div className="!shrink-[0] !w-[36px] !h-[36px] !rounded-[8px] ![background:var(--bg-tertiary)] !flex !items-center !justify-center !overflow-hidden"
          onClick={() => !isTrash && openFile(file)}
          style={{ cursor: isTrash ? 'default' : 'pointer' }}
        >
          {isImage(file.mime_type, file.original_name)
            ? <AuthedImg src={file.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (() => {
                const ext = (file.original_name || '').split('.').pop()?.toUpperCase() || '?'
                const isPdf = file.mime_type === 'application/pdf'
                return (
                  <div className="!flex !flex-col !items-center !justify-center !w-[100%] !h-[100%]" style={{ background: isPdf ? '#ef44441a' : 'var(--bg-tertiary)' }}>
                    <span className="!text-[length:9px] !font-[700] !tracking-[0.3px]" style={{ color: isPdf ? '#ef4444' : 'var(--text-muted)' }}>{ext}</span>
                  </div>
                )
              })()
          }
        </div>

        {/* Info */}
        <div className="!flex-[1] !min-w-[0]">
          <div className="!flex !items-center !gap-[5px]">
            {file.uploaded_by_name && (
              <AvatarChip name={file.uploaded_by_name} avatarUrl={file.uploaded_by_avatar} size={20} />
            )}
            {!isTrash && file.starred ? <Star size={12} fill="#facc15" color="#facc15" style={{ flexShrink: 0 }} /> : null}
            <span className="!font-[500] !text-[length:13px] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap"
              onClick={() => !isTrash && openFile(file)}
              style={{ cursor: isTrash ? 'default' : 'pointer' }}
            >
              {file.original_name}
            </span>
          </div>

          {file.description && (
            <p className="!text-[length:11.5px] ![color:var(--text-faint)] !m-[2px_0_0] !overflow-hidden !text-ellipsis !whitespace-nowrap">{file.description}</p>
          )}

          <div className="!flex !items-center !flex-wrap !gap-[6px] !mt-[4px]">
            {file.file_size && <span className="!text-[length:11px] ![color:var(--text-faint)]">{formatSize(file.file_size)}</span>}
            <span className="!text-[length:11px] ![color:var(--text-faint)]">{formatDateWithLocale(file.created_at, locale)}</span>

            {linkedPlaces.map(p => (
              <SourceBadge key={p.id} icon={MapPin} label={`${t('files.sourcePlan')} · ${p.name}`} />
            ))}
            {linkedReservations.map(r => (
              TRANSPORT_TYPES.has(r.type)
                ? <SourceBadge key={r.id} icon={transportIcon(r.type)} label={`${t('files.sourceTransport')} · ${r.title || t('files.sourceTransport')}`} />
                : <SourceBadge key={r.id} icon={Ticket} label={`${t('files.sourceBooking')} · ${r.title || t('files.sourceBooking')}`} />
            ))}
            {file.note_id && (
              <SourceBadge icon={StickyNote} label={t('files.sourceCollab') || 'Collab Notes'} />
            )}
          </div>
        </div>

        {/* Actions — always visible on mobile, hover on desktop */}
        <div className="file-actions !flex !gap-[2px] !shrink-[0]">
          {isTrash ? (
            <>
              {can('file_delete', trip) && <button className="trek-hover-success !p-[6px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !rounded-[6px] !flex" onClick={() => handleRestore(file.id)} title={t('files.restore') || 'Restore'}>
                <RotateCcw size={14} />
              </button>}
              {can('file_delete', trip) && <button className="trek-hover-danger !p-[6px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !rounded-[6px] !flex" onClick={() => handlePermanentDelete(file.id)} title={t('common.delete')}>
                <Trash2 size={14} />
              </button>}
            </>
          ) : (
            <>
              <button className={[(!file.starred) ? 'trek-h-color-bcbd42' : undefined, '!p-[6px] ![background:none] ![border:none] !cursor-pointer !rounded-[6px] !flex'].join(' ')} onClick={() => handleStar(file.id)} title={file.starred ? t('files.unstar') || 'Unstar' : t('files.star') || 'Star'} style={{ color: file.starred ? '#facc15' : 'var(--text-faint)' }}>
                <Star size={14} fill={file.starred ? '#facc15' : 'none'} />
              </button>
              {can('file_edit', trip) && <button className="trek-hover-text !p-[6px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !rounded-[6px] !flex" onClick={() => setAssignFileId(file.id)} title={t('files.assign') || 'Assign'}>
                <Pencil size={14} />
              </button>}
              <button className="trek-hover-text !p-[6px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !rounded-[6px] !flex" onClick={() => openFile(file)} title={t('common.open')}>
                <ExternalLink size={14} />
              </button>
              <button className="trek-hover-text !p-[6px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !rounded-[6px] !flex" onClick={() => triggerDownload(file.url, file.original_name)} title={t('files.download') || 'Download'}>
                <Download size={14} />
              </button>
              {can('file_delete', trip) && <button className="trek-hover-danger !p-[6px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !rounded-[6px] !flex" onClick={() => handleDelete(file.id)} title={t('common.delete')}>
                <Trash2 size={14} />
              </button>}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }} onPaste={handlePaste} tabIndex={-1}>
      {/* Lightbox */}
      {lightboxIndex !== null && <ImageLightbox files={imageFiles} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />}

      {/* Assign modal */}
      {assignFileId && ReactDOM.createPortal(
        <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.5)] !z-[5000] !flex !items-center !justify-center"
          onClick={() => setAssignFileId(null)}>
          <div className="![background:var(--bg-card)] !rounded-[16px] ![box-shadow:0_20px_60px_rgba(0,0,0,0.2)] !w-[min(600px,_calc(100vw_-_32px))] !max-h-[70vh] !overflow-hidden !flex !flex-col" onClick={e => e.stopPropagation()}>
            <div className="!p-[16px_20px_12px] ![border-bottom:1px_solid_var(--border-primary)] !flex !items-center !justify-between !gap-[12px]">
              <div className="!flex-[1] !min-w-[0]">
                <div className="!text-[length:15px] !font-[600] ![color:var(--text-primary)]">{t('files.assignTitle')}</div>
                <div className="!text-[length:12px] ![color:var(--text-faint)] !mt-[2px] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                  {files.find(f => f.id === assignFileId)?.original_name || ''}
                </div>
              </div>
              <button className="![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !p-[4px] !flex !shrink-[0]" onClick={() => setAssignFileId(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="!p-[8px_12px_0]">
              <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !p-[0_2px_4px] !uppercase !tracking-[0.5px]">
                {t('files.noteLabel') || 'Note'}
              </div>
              <input className="!w-[100%] !p-[7px_10px] !text-[length:13px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-secondary)] ![color:var(--text-primary)] ![font-family:inherit] ![outline:none]"
                type="text"
                placeholder={t('files.notePlaceholder')}
                defaultValue={files.find(f => f.id === assignFileId)?.description || ''}
                onBlur={e => {
                  const val = e.target.value.trim()
                  const file = files.find(f => f.id === assignFileId)
                  if (file && val !== (file.description || '')) {
                    handleAssign(file.id, { description: val } as any)
                  }
                }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              />
            </div>
            <div className="!overflow-y-auto !p-[8px]">
              {(() => {
                const file = files.find(f => f.id === assignFileId)
                if (!file) return null
                const assignedPlaceIds = new Set<number>()
                const dayGroups: { day: Day; dayPlaces: Place[] }[] = []
                for (const day of days) {
                  const da = assignments[String(day.id)] || []
                  const dayPlaces = da.map(a => places.find(p => p.id === a.place?.id || p.id === a.place_id)).filter(Boolean) as Place[]
                  if (dayPlaces.length > 0) {
                    dayGroups.push({ day, dayPlaces })
                    dayPlaces.forEach(p => assignedPlaceIds.add(p.id))
                  }
                }
                const unassigned = places.filter(p => !assignedPlaceIds.has(p.id))
                const placeBtn = (p: Place) => {
                  const isLinked = file.place_id === p.id || (file.linked_place_ids || []).includes(p.id)
                  return (
                    <button className="trek-hover !w-[100%] !text-left !p-[6px_10px_6px_20px] ![border:none] !cursor-pointer ![color:var(--text-primary)] !rounded-[8px] !flex !items-center !gap-[6px]" key={p.id} onClick={async () => {
                      if (isLinked) {
                        if (file.place_id === p.id) {
                          await handleAssign(file.id, { place_id: null })
                        } else {
                          try {
                            const linksRes = await filesApi.getLinks(tripId, file.id)
                            const link = (linksRes.links || []).find((l: any) => l.place_id === p.id)
                            if (link) await filesApi.removeLink(tripId, file.id, link.id)
                            refreshFiles()
                          } catch {}
                        }
                      } else {
                        if (!file.place_id) {
                          await handleAssign(file.id, { place_id: p.id })
                        } else {
                          try {
                            await filesApi.addLink(tripId, file.id, { place_id: p.id })
                            refreshFiles()
                          } catch {}
                        }
                      }
                    }} style={{ background: isLinked ? 'var(--bg-hover)' : 'none', fontSize: 13, fontFamily: 'inherit', fontWeight: isLinked ? 600 : 400 }}>
                      <MapPin size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                      <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{p.name}</span>
                      {isLinked && <Check size={14} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--accent)' }} />}
                    </button>
                  )
                }

                const placesSection = places.length > 0 && (
                  <div className="!flex-[1] !min-w-[0]">
                    <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !p-[8px_10px_4px] !uppercase !tracking-[0.5px]">
                      {t('files.assignPlace')}
                    </div>
                    {dayGroups.map(({ day, dayPlaces }) => (
                      <div key={day.id}>
                        <div className="!flex !items-center !gap-[6px] !text-[length:11px] !font-[600] ![color:var(--text-muted)] !p-[8px_10px_2px]">
                          <span>{day.title || t('dayplan.dayN', { n: day.day_number })}</span>
                          {(() => {
                            const badge = day.date || (day.title ? t('dayplan.dayN', { n: day.day_number }) : null)
                            return badge ? (
                              <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] ![background:var(--bg-tertiary)] !p-[1px_6px] !rounded-[999px]">{badge}</span>
                            ) : null
                          })()}
                        </div>
                        {dayPlaces.map(placeBtn)}
                      </div>
                    ))}
                    {unassigned.length > 0 && (
                      <div>
                        {dayGroups.length > 0 && <div className="!text-[length:11px] !font-[600] ![color:var(--text-muted)] !p-[8px_10px_2px]">{t('files.unassigned')}</div>}
                        {unassigned.map(placeBtn)}
                      </div>
                    )}
                  </div>
                )

                const bookingReservations = reservations.filter(r => !TRANSPORT_TYPES.has(r.type))
                const transportReservations = reservations.filter(r => TRANSPORT_TYPES.has(r.type))

                const reservationBtn = (r: Reservation) => {
                  const isLinked = file.reservation_id === r.id || (file.linked_reservation_ids || []).includes(r.id)
                  const Icon = TRANSPORT_TYPES.has(r.type) ? transportIcon(r.type) : Ticket
                  return (
                    <button className="trek-hover !w-[100%] !text-left !p-[6px_10px_6px_20px] ![border:none] !cursor-pointer ![color:var(--text-primary)] !rounded-[8px] !flex !items-center !gap-[6px]" key={r.id} onClick={async () => {
                      if (isLinked) {
                        if (file.reservation_id === r.id) {
                          await handleAssign(file.id, { reservation_id: null })
                        } else {
                          try {
                            const linksRes = await filesApi.getLinks(tripId, file.id)
                            const link = (linksRes.links || []).find((l: any) => l.reservation_id === r.id)
                            if (link) await filesApi.removeLink(tripId, file.id, link.id)
                            refreshFiles()
                          } catch {}
                        }
                      } else {
                        if (!file.reservation_id) {
                          await handleAssign(file.id, { reservation_id: r.id })
                        } else {
                          try {
                            await filesApi.addLink(tripId, file.id, { reservation_id: r.id })
                            refreshFiles()
                          } catch {}
                        }
                      }
                    }} style={{ background: isLinked ? 'var(--bg-hover)' : 'none', fontSize: 13, fontFamily: 'inherit', fontWeight: isLinked ? 600 : 400 }}>
                      <Icon size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                      <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{r.title || r.name}</span>
                      {isLinked && <Check size={14} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--accent)' }} />}
                    </button>
                  )
                }

                const bookingsSection = reservations.length > 0 && (
                  <div className="!flex-[1] !min-w-[0]">
                    {bookingReservations.length > 0 && (
                      <>
                        <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !p-[8px_10px_4px] !uppercase !tracking-[0.5px]">
                          {t('files.assignBooking')}
                        </div>
                        {bookingReservations.map(reservationBtn)}
                      </>
                    )}
                    {transportReservations.length > 0 && (
                      <>
                        <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !p-[8px_10px_4px] !uppercase !tracking-[0.5px]" style={{ marginTop: bookingReservations.length > 0 ? 4 : 0 }}>
                          {t('files.assignTransport')}
                        </div>
                        {transportReservations.map(reservationBtn)}
                      </>
                    )}
                  </div>
                )

                const hasBoth = placesSection && bookingsSection
                return (
                  <div className={hasBoth ? 'md:flex' : ''}>
                    <div className={[hasBoth ? 'md:w-1/2' : '', '!overflow-y-auto !max-h-[55vh]'].join(' ')} style={{ paddingRight: hasBoth ? 6 : 0 }}>{placesSection}</div>
                    {hasBoth && <div className="hidden md:block !w-[1px] ![background:var(--border-primary)] !shrink-[0]" />}
                    {hasBoth && <div className="block md:hidden !h-[1px] ![background:var(--border-primary)] !m-[8px_0]" />}
                    <div className={[hasBoth ? 'md:w-1/2' : '', '!overflow-y-auto !max-h-[55vh]'].join(' ')} style={{ paddingLeft: hasBoth ? 6 : 0 }}>{bookingsSection}</div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* PDF preview modal */}
      {previewFile && ReactDOM.createPortal(
        <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.85)] !z-[10000] !flex !items-center !justify-center !p-[16px]"
          onClick={() => setPreviewFile(null)}
        >
          <div className="!w-[100%] !max-w-[950px] !h-[94vh] ![background:var(--bg-card)] !rounded-[12px] !overflow-hidden !flex !flex-col ![box-shadow:0_20px_60px_rgba(0,0,0,0.3)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="!flex !items-center !justify-between !p-[10px_16px] ![border-bottom:1px_solid_var(--border-primary)] !shrink-[0]">
              <span className="!text-[length:13px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap !flex-[1]">{previewFile.original_name}</span>
              <div className="!flex !items-center !gap-[8px] !shrink-[0]">
                <button className="trek-hover-text !flex !items-center !gap-[4px] !text-[length:12px] ![color:var(--text-muted)] ![background:none] ![border:none] !cursor-pointer ![text-decoration:none] !p-[4px_8px] !rounded-[6px] ![transition:color_0.15s]"
                  onClick={() => openFileUrl(previewFile.url, previewFile.original_name).catch(() => toast.error(t('files.openError')))}>
                  <ExternalLink size={13} /> {t('files.openTab')}
                </button>
                <button className="trek-hover-text !flex !items-center !gap-[4px] !text-[length:12px] ![color:var(--text-muted)] ![background:none] ![border:none] !cursor-pointer ![text-decoration:none] !p-[4px_8px] !rounded-[6px] ![transition:color_0.15s]"
                  onClick={() => triggerDownload(previewFile.url, previewFile.original_name)}>
                  <Download size={13} /> {t('files.download') || 'Download'}
                </button>
                <button className="trek-hover-text ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !flex !p-[4px] !rounded-[6px] ![transition:color_0.15s]" onClick={() => setPreviewFile(null)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <object className="!flex-[1] !w-[100%] ![border:none]"
              data={previewFileUrl ? `${previewFileUrl}#view=FitH` : undefined}
              type="application/pdf"
              title={previewFile.original_name}
            >
              <p className="!p-[24px] !text-center ![color:var(--text-muted)]">
                <button className="![color:var(--text-primary)] ![text-decoration:underline] ![background:none] ![border:none] !cursor-pointer ![font:inherit]" onClick={() => openFileUrl(previewFile.url, previewFile.original_name).catch(() => toast.error(t('files.openError')))}>{t('files.downloadPdf')}</button>
              </p>
            </object>
          </div>
        </div>,
        document.body
      )}

      {/* Toolbar */}
      <div className="max-md:!px-4 max-md:!pt-4 !p-[24px_28px_0] !shrink-[0]">
        <div className="![background:var(--bg-tertiary)] !rounded-[18px] !p-[14px_16px_14px_22px] !flex !items-center !gap-[16px] !flex-wrap">
          <h2 className="!m-[0] !text-[length:18px] !font-[600] ![color:var(--text-primary)] !tracking-[-0.01em] !shrink-[0]">
            {showTrash ? (t('files.trash') || 'Trash') : t('files.title')}
          </h2>

          {!showTrash && (
            <>
              <div className="hidden md:block !w-[1px] !h-[22px] ![background:var(--border-faint)] !shrink-[0]" />
              <div className="hidden md:inline-flex !gap-[4px] !flex-wrap !flex-[1] !min-w-[0]">
                {[
                  { id: 'all', label: t('files.filterAll') },
                  ...(files.some(f => f.starred) ? [{ id: 'starred', icon: Star } as const] : []),
                  { id: 'pdf', label: t('files.filterPdf') },
                  { id: 'image', label: t('files.filterImages') },
                  { id: 'doc', label: t('files.filterDocs') },
                  ...(files.some(f => f.note_id) ? [{ id: 'collab', label: t('files.filterCollab') || 'Collab' }] : []),
                ].map(tab => {
                  const active = filterType === tab.id
                  const TabIcon = 'icon' in tab ? tab.icon : null
                  const count = tab.id === 'all' ? files.length
                    : tab.id === 'starred' ? files.filter(f => f.starred).length
                    : tab.id === 'pdf' ? files.filter(f => (f.mime_type || '').includes('pdf') || /\.pdf$/i.test(f.original_name)).length
                    : tab.id === 'image' ? files.filter(f => (f.mime_type || '').startsWith('image/')).length
                    : tab.id === 'doc' ? files.filter(f => /\.(docx?|xlsx?|txt|csv)$/i.test(f.original_name)).length
                    : tab.id === 'collab' ? files.filter(f => f.note_id).length
                    : 0
                  return (
                    <button className="![appearance:none] ![border:none] !cursor-pointer !inline-flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[99px] !whitespace-nowrap ![transition:all_0.15s_ease]" key={tab.id} onClick={() => setFilterType(tab.id)}
                      style={{ fontFamily: 'inherit', fontSize: 13, background: active ? 'var(--bg-card)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 500 : 400, boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}
                    >
                      {TabIcon ? <TabIcon size={13} fill={active ? '#facc15' : 'none'} color={active ? '#facc15' : 'currentColor'} /> : null}
                      {'label' in tab && tab.label}
                      <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !p-[1px_6px] !rounded-[99px] !min-w-[16px] !text-center" style={{ background: active ? 'var(--bg-tertiary)' : 'rgba(0,0,0,0.06)' }}>{count}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <button className="trek-hover-opaque ![appearance:none] ![border:none] !cursor-pointer ![font-family:inherit] !inline-flex !items-center !gap-[6px] !p-[9px_14px] !rounded-[10px] !text-[length:13px] !font-[500] ![background:var(--accent)] ![color:var(--accent-text)] !shrink-[0] !ml-[auto] ![transition:opacity_0.15s_ease]" onClick={toggleTrash} style={{ opacity: showTrash ? 1 : 0.88 }} >
            <Trash2 size={14} strokeWidth={2.5} /> <span className="hidden sm:inline">{t('files.trash') || 'Trash'}</span>
          </button>
        </div>
      </div>

      {showTrash ? (
        /* Trash view */
        <div className="!flex-[1] !overflow-y-auto !p-[12px_16px_16px]">
          {trashFiles.length > 0 && can('file_delete', trip) && (
            <div className="!flex !justify-end !mb-[12px]">
              <button className="!p-[5px_12px] !rounded-[8px] ![border:1px_solid_#fecaca] ![background:#fef2f2] ![color:#dc2626] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={handleEmptyTrash}>
                {t('files.emptyTrash') || 'Empty Trash'}
              </button>
            </div>
          )}
          {loadingTrash ? (
            <div className="!text-center !p-[40px] ![color:var(--text-faint)]">
              <div className="!w-[20px] !h-[20px] ![border:2px_solid_var(--text-faint)] ![border-top-color:transparent] !rounded-[50%] !m-[0_auto]" style={{ animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : trashFiles.length === 0 ? (
            <div className="!text-center !p-[60px_20px] ![color:var(--text-faint)]">
              <Trash2 size={40} style={{ color: 'var(--text-faint)', display: 'block', margin: '0 auto 12px' }} />
              <p className="!text-[length:14px] !font-[600] ![color:var(--text-secondary)] !m-[0_0_4px]">{t('files.trashEmpty') || 'Trash is empty'}</p>
            </div>
          ) : (
            <div className="!flex !flex-col !gap-[8px]">
              {trashFiles.map(file => renderFileRow(file, true))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Upload zone */}
          {can('file_upload', trip) && <div
            {...getRootProps()}
            style={{
              margin: '16px 28px 0', border: '2px dashed', borderRadius: 14, padding: '20px 16px',
              textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
              borderColor: isDragActive ? 'var(--text-secondary)' : 'var(--border-primary)',
              background: isDragActive ? 'var(--bg-secondary)' : 'var(--bg-card)',
            }}
          >
            <input {...getInputProps()} />
            <Upload size={24} style={{ margin: '0 auto 8px', color: isDragActive ? 'var(--text-secondary)' : 'var(--text-faint)', display: 'block' }} />
            {uploading ? (
              <div className="!flex !items-center !justify-center !gap-[6px] !text-[length:13px] ![color:var(--text-secondary)]">
                <div className="!w-[14px] !h-[14px] ![border:2px_solid_var(--text-secondary)] ![border-top-color:transparent] !rounded-[50%]" style={{ animation: 'spin 0.8s linear infinite' }} />
                {t('files.uploading')}
              </div>
            ) : (
              <>
                <p className="!text-[length:13px] ![color:var(--text-secondary)] !font-[500] !m-[0]">{t('files.dropzone')}</p>
                <p className="!text-[length:11.5px] ![color:var(--text-faint)] !mt-[3px]">{t('files.dropzoneHint')}</p>
                <p className="!text-[length:10px] ![color:var(--text-faint)] !mt-[6px]" style={{ opacity: 0.7 }}>
                  {(allowedFileTypes || 'jpg,jpeg,png,gif,webp,heic,pdf,doc,docx,xls,xlsx,txt,csv').toUpperCase().split(',').join(', ')} · Max 50 MB
                </p>
              </>
            )}
          </div>}

          {/* Filter tabs */}
          <div className="md:!hidden !flex !gap-[4px] !p-[12px_16px_0] !shrink-[0] !flex-wrap">
            {[
              { id: 'all', label: t('files.filterAll') },
              ...(files.some(f => f.starred) ? [{ id: 'starred', icon: Star }] : []),
              { id: 'pdf', label: t('files.filterPdf') },
              { id: 'image', label: t('files.filterImages') },
              { id: 'doc', label: t('files.filterDocs') },
              ...(files.some(f => f.note_id) ? [{ id: 'collab', label: t('files.filterCollab') || 'Collab' }] : []),
            ].map(tab => (
              <button className="!p-[4px_12px] !rounded-[99px] ![border:none] !cursor-pointer ![transition:all_0.12s]" key={tab.id} onClick={() => setFilterType(tab.id)} style={{ fontSize: 12, fontFamily: 'inherit', background: filterType === tab.id ? 'var(--accent)' : 'transparent', color: filterType === tab.id ? 'var(--accent-text)' : 'var(--text-muted)', fontWeight: filterType === tab.id ? 600 : 400 }}>{tab.icon ? <tab.icon size={13} fill={filterType === tab.id ? '#facc15' : 'none'} color={filterType === tab.id ? '#facc15' : 'currentColor'} /> : tab.label}</button>
            ))}
            <span className="!ml-[auto] !text-[length:11.5px] ![color:var(--text-faint)] !self-center">
              {filteredFiles.length === 1 ? t('files.countSingular') : t('files.count', { count: filteredFiles.length })}
            </span>
          </div>

          {/* File list */}
          <div className="max-md:!px-4 !flex-[1] !overflow-y-auto !p-[12px_28px_16px]">
            {filteredFiles.length === 0 ? (
              <div className="!text-center !p-[60px_20px] ![color:var(--text-faint)]">
                <FileText size={40} style={{ color: 'var(--text-faint)', display: 'block', margin: '0 auto 12px' }} />
                <p className="!text-[length:14px] !font-[600] ![color:var(--text-secondary)] !m-[0_0_4px]">{t('files.empty')}</p>
                <p className="!text-[length:13px] ![color:var(--text-faint)] !m-[0]">{t('files.emptyHint')}</p>
              </div>
            ) : (
              <div className="!flex !flex-col !gap-[8px]">
                {filteredFiles.map(file => renderFileRow(file))}
              </div>
            )}
          </div>
        </>
      )}

      <style>{`
        @media (max-width: 767px) {
          .file-actions button { padding: 8px !important; }
          .file-actions svg { width: 18px !important; height: 18px !important; }
        }
      `}</style>
    </div>
  )
}
