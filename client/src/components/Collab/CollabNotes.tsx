import ReactDOM from 'react-dom'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import DOM from 'react-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { Plus, Trash2, Pin, PinOff, Pencil, X, Check, StickyNote, Settings, ExternalLink, Maximize2, Loader2 } from 'lucide-react'
import { collabApi } from '../../api/client'
import { getAuthUrl } from '../../api/authUrl'
import { openFile } from '../../utils/fileDownload'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'
import { addListener, removeListener } from '../../api/websocket'
import { useTranslation } from '../../i18n'
import type { User } from '../../types'

interface NoteFile {
  id: number
  filename: string
  original_name: string
  mime_type: string
  url?: string
}

interface NoteAttachment { id: number; filename: string; original_name: string; mime_type: string; url?: string }

interface CollabNote {
  id: number
  attachments?: NoteAttachment[]
  trip_id: number
  title: string
  content: string
  category: string
  website: string | null
  pinned: boolean
  color: string | null
  username: string
  avatar_url: string | null
  avatar: string | null
  user_id: number
  created_at: string
  author?: { username: string; avatar: string | null }
  user?: { username: string; avatar: string | null }
  files?: NoteFile[]
}

interface NoteAuthor {
  username: string
  avatar?: string | null
}

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"

// ── Website Thumbnail (fetches OG image) ────────────────────────────────────
const ogCache = {}

interface WebsiteThumbnailProps {
  url: string
  tripId: number | string
  color: string
}

function WebsiteThumbnail({ url, tripId, color }: WebsiteThumbnailProps) {
  const [data, setData] = useState(ogCache[url] || null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (ogCache[url]) { setData(ogCache[url]); return }
    collabApi.linkPreview(tripId, url).then(d => { ogCache[url] = d; setData(d) }).catch(() => setFailed(true))
  }, [url, tripId])

  const domain = (() => { try { return new URL(url).hostname.replace('www.', '') } catch { return 'link' } })()

  return (
    <a className="trek-h-transform-244d20 trek-h-box-shadow-7cd433 !w-[48px] !h-[48px] !rounded-[8px] !cursor-pointer !overflow-hidden ![border:none] !flex !flex-col !items-center !justify-center !gap-[2px] ![text-decoration:none] ![transition:transform_0.12s,_box-shadow_0.12s] !shrink-[0]" href={url} target="_blank" rel="noopener noreferrer" title={data?.title || url}
      style={{ background: data?.image ? 'none' : 'var(--bg-tertiary)' }}>
      {data?.image && !failed ? (
        <img className="!w-[100%] !h-[100%] !object-cover" src={data.image} alt="" onError={() => setFailed(true)} />
      ) : (
        <>
          <ExternalLink size={14} color="var(--text-muted)" />
          <span className="!text-[length:7px] !font-[600] !max-w-[42px] !overflow-hidden !text-ellipsis !whitespace-nowrap !text-center" style={{ color: 'var(--text-muted)' }}>
            {domain}
          </span>
        </>
      )}
    </a>
  )
}

// ── File Preview Portal ─────────────────────────────────────────────────────
interface FilePreviewPortalProps {
  file: NoteFile | null
  onClose: () => void
}

function FilePreviewPortal({ file, onClose }: FilePreviewPortalProps) {
  const [authUrl, setAuthUrl] = useState('')
  const rawUrl = file?.url || ''
  useEffect(() => {
    setAuthUrl('')
    if (!rawUrl) return
    getAuthUrl(rawUrl, 'download').then(setAuthUrl)
  }, [rawUrl])

  if (!file) return null
  const isImage = file.mime_type?.startsWith('image/')
  const isPdf = file.mime_type === 'application/pdf'
  const isTxt = file.mime_type?.startsWith('text/')

  const openInNewTab = () => openFile(rawUrl).catch(() => {})

  return ReactDOM.createPortal(
    <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.88)] !z-[10000] !flex !items-center !justify-center !p-[16px]" onClick={onClose}>
      {isImage ? (
        /* Image lightbox — floating controls */
        <div className="!relative !max-w-[90vw] !max-h-[90vh]" onClick={e => e.stopPropagation()}>
          {authUrl
            ? <img className="!max-w-[90vw] !max-h-[90vh] !object-contain !rounded-[8px] !block" src={authUrl} alt={file.original_name} />
            : <Loader2 size={32} className="animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />
          }
          <div className="!absolute !top-[-36px] !left-[0] !right-[0] !flex !items-center !justify-between !p-[0_4px]">
            <span className="!text-[length:11px] !overflow-hidden !text-ellipsis !whitespace-nowrap !max-w-[70%]" style={{ color: 'rgba(255,255,255,0.7)' }}>{file.original_name}</span>
            <div className="!flex !gap-[8px]">
              <button className="![background:none] ![border:none] !cursor-pointer !flex !p-[0]" onClick={openInNewTab} style={{ color: 'rgba(255,255,255,0.7)' }}><ExternalLink size={15} /></button>
              <button className="![background:none] ![border:none] !cursor-pointer !flex !p-[0]" onClick={onClose} style={{ color: 'rgba(255,255,255,0.7)' }}><X size={17} /></button>
            </div>
          </div>
        </div>
      ) : (
        /* Document viewer — card with header */
        <div className="!w-[100%] !max-w-[950px] !h-[94vh] !flex !flex-col ![background:var(--bg-card)] !rounded-[12px] !overflow-hidden ![box-shadow:0_20px_60px_rgba(0,0,0,0.3)]" onClick={e => e.stopPropagation()}>
          <div className="!flex !items-center !justify-between !p-[10px_16px] ![border-bottom:1px_solid_var(--border-primary)] !shrink-[0]">
            <span className="!text-[length:13px] !font-[600] !overflow-hidden !text-ellipsis !whitespace-nowrap !flex-[1]" style={{ color: 'var(--text-primary)' }}>{file.original_name}</span>
            <div className="!flex !gap-[8px] !shrink-[0]">
              <button className="![background:none] ![border:none] !cursor-pointer !flex !items-center !gap-[3px] !text-[length:11px] !p-[0]" onClick={openInNewTab} style={{ color: 'var(--text-muted)' }}><ExternalLink size={13} /></button>
              <button className="![background:none] ![border:none] !cursor-pointer !flex !p-[2px]" onClick={onClose} style={{ color: 'var(--text-faint)' }}><X size={18} /></button>
            </div>
          </div>
          {(isPdf || isTxt) ? (
            <object className="!flex-[1] !w-[100%] ![border:none] ![background:#fff]" data={authUrl ? `${authUrl}#view=FitH` : ''} type={file.mime_type} title={file.original_name}>
              <p className="!p-[24px] !text-center" style={{ color: 'var(--text-muted)' }}>
                <button className="![background:none] ![border:none] !cursor-pointer ![text-decoration:underline] !text-[length:14px] !p-[0]" onClick={openInNewTab} style={{ color: 'var(--text-primary)' }}>Download</button>
              </p>
            </object>
          ) : (
            <div className="!flex-[1] !flex !items-center !justify-center !p-[40px]">
              <button className="![background:none] ![border:none] !cursor-pointer ![text-decoration:underline] !text-[length:14px] !p-[0]" onClick={openInNewTab} style={{ color: 'var(--text-primary)' }}>Download {file.original_name}</button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  )
}

function AuthedImg({ src, style, className, onClick, onMouseEnter, onMouseLeave, alt }: { src: string; style?: React.CSSProperties; className?: string; onClick?: () => void; onMouseEnter?: React.MouseEventHandler<HTMLImageElement>; onMouseLeave?: React.MouseEventHandler<HTMLImageElement>; alt?: string }) {
  const [authSrc, setAuthSrc] = useState('')
  useEffect(() => {
    getAuthUrl(src, 'download').then(setAuthSrc)
  }, [src])
  return authSrc ? <img src={authSrc} alt={alt} style={style} className={className} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} /> : null
}

const NOTE_COLORS = [
  { value: '#6366f1', label: 'Indigo' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#10b981', label: 'Emerald' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Violet' },
]

const formatTimestamp = (ts, t, locale) => {
  if (!ts) return ''
  const d = new Date(ts.endsWith?.('Z') ? ts : ts + 'Z')
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return t('collab.chat.justNow') || 'just now'
  if (diffMins < 60) return t('collab.chat.minutesAgo', { n: diffMins }) || `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return t('collab.chat.hoursAgo', { n: diffHrs }) || `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7) return t('collab.notes.daysAgo', { n: diffDays }) || `${diffDays}d ago`
  return d.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric' })
}

// ── Avatar ──────────────────────────────────────────────────────────────────
interface UserAvatarProps {
  user: NoteAuthor | null
  size?: number
}

function UserAvatar({ user, size = 14 }: UserAvatarProps) {
  if (!user) return null
  if (user.avatar) {
    return (
      <img className="!rounded-[50%] !object-cover !shrink-[0] ![background:var(--bg-tertiary)]"
        src={user.avatar}
        alt={user.username}
        style={{ width: size, height: size }}
      />
    )
  }
  const initials = (user.username || '?').slice(0, 1)
  return (
    <div className="!rounded-[50%] ![background:var(--bg-tertiary)] !flex !items-center !justify-center !shrink-[0] !uppercase" style={{ width: size, height: size, fontSize: size * 0.45, fontWeight: 600, color: 'var(--text-faint)', fontFamily: FONT }}>
      {initials}
    </div>
  )
}

// ── New Note Modal (portal to body) ─────────────────────────────────────────
interface NoteFormModalProps {
  onClose: () => void
  onSubmit: (data: { title: string; content: string; category: string | null; color?: string | null; website: string | null; _pendingFiles?: File[]; files?: File[] }) => Promise<void>
  onDeleteFile?: (noteId: number, fileId: number) => Promise<void>
  existingCategories: string[]
  categoryColors: Record<string, string>
  getCategoryColor: (category: string) => string
  note: CollabNote | null
  tripId: number | string
  t: (key: string) => string
}

function NoteFormModal({ onClose, onSubmit, onDeleteFile, existingCategories, categoryColors, getCategoryColor, note, tripId, t }: NoteFormModalProps) {
  const can = useCanDo()
  const tripObj = useTripStore((s) => s.trip)
  const canUploadFiles = can('file_upload', tripObj)
  const isEdit = !!note
  const allCategories = [...new Set([...existingCategories, ...Object.keys(categoryColors || {})])].filter(Boolean)

  const [title, setTitle] = useState(note?.title || '')
  const [content, setContent] = useState(note?.content || '')
  const [category, setCategory] = useState(note?.category || allCategories[0] || '')
  const [website, setWebsite] = useState(note?.website || '')
  const [pendingFiles, setPendingFiles] = useState([])
  const [existingAttachments, setExistingAttachments] = useState(note?.attachments || [])
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef(null)

  const finalCategory = category

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        content: content.trim(),
        category: finalCategory || null,
        color: getCategoryColor(finalCategory),
        website: website.trim() || null,
        _pendingFiles: pendingFiles,
      })
      onClose()
    } catch {
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteAttachment = async (fileId) => {
    if (onDeleteFile && note) {
      await onDeleteFile(note.id, fileId)
      setExistingAttachments(prev => prev.filter(a => a.id !== fileId))
    }
  }

  const canSubmit = title.trim() && !submitting

  return ReactDOM.createPortal(
    <div className="!fixed !inset-[0] ![background:var(--overlay-bg,_rgba(0,0,0,0.35))] ![backdrop-filter:blur(6px)] ![-webkit-backdrop-filter:blur(6px)] !flex !items-center !justify-center !z-[9999] !p-[16px]"
      style={{ fontFamily: FONT }}
    >
      <form className="![background:var(--bg-card)] !rounded-[16px] !w-[100%] !max-w-[400px] !max-h-[90vh] !overflow-auto ![border:1px_solid_var(--border-faint)]"
        onClick={e => e.stopPropagation()}
        onPaste={e => {
          if (!canUploadFiles) return
          const items = e.clipboardData?.items
          if (!items) return
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/') || item.type === 'application/pdf') {
              e.preventDefault()
              const file = item.getAsFile()
              if (file) setPendingFiles(prev => [...prev, file])
              return
            }
          }
        }}
        onSubmit={handleSubmit}
      >
        {/* Modal header */}
        <div className="!flex !items-center !justify-between !p-[14px_16px_12px] ![border-bottom:1px_solid_var(--border-faint)]">
          <h3 className="!m-[0]" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: FONT }}>
            {isEdit ? t('collab.notes.edit') : t('collab.notes.new')}
          </h3>
          <button className="![background:none] ![border:none] !cursor-pointer !p-[2px] !rounded-[6px] !flex"
            type="button"
            onClick={onClose}
            style={{ color: 'var(--text-faint)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal body */}
        <div className="!p-[14px_16px_16px] !flex !flex-col !gap-[12px]">
          {/* Title */}
          <div>
            <div className="!uppercase !tracking-[0.05em] !mb-[4px]" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', fontFamily: FONT }}>
              {t('collab.notes.title')}
            </div>
            <input className="!w-[100%] ![border:1px_solid_var(--border-primary)] !rounded-[10px] !p-[8px_12px] !text-[length:13px] ![background:var(--bg-input)] ![font-family:inherit] ![outline:none] !box-border"
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('collab.notes.titlePlaceholder')}
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {/* Content */}
          <div>
            <div className="!uppercase !tracking-[0.05em] !mb-[4px]" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', fontFamily: FONT }}>
              {t('collab.notes.contentPlaceholder')}
            </div>
            <textarea className="!w-[100%] ![border:1px_solid_var(--border-primary)] !rounded-[10px] !p-[8px_12px] !text-[length:13px] ![background:var(--bg-input)] ![font-family:inherit] ![outline:none] !box-border ![resize:vertical] !min-h-[180px] !leading-[1.5]"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={t('collab.notes.contentPlaceholder')}
              style={{ color: 'var(--text-primary)' }}
            />
          </div>

          {/* Category pills */}
          <div>
            <div className="!uppercase !tracking-[0.05em] !mb-[6px]" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', fontFamily: FONT }}>
              {t('collab.notes.category')}
            </div>
            <div className="!flex !gap-[6px] !flex-wrap">
              {allCategories.map(cat => {
                const c = getCategoryColor(cat)
                const active = category === cat
                return (
                  <button className="!p-[4px_12px] !rounded-[99px] !cursor-pointer" key={cat} type="button" onClick={() => setCategory(cat)}
                    style={{ border: active ? `1.5px solid ${c}` : '1px solid var(--border-faint)', background: active ? `${c}18` : 'transparent', color: active ? c : 'var(--text-muted)', fontSize: 11, fontWeight: 600, fontFamily: FONT }}>
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Website */}
          <div>
            <div className="!uppercase !tracking-[0.05em] !mb-[4px]" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', fontFamily: FONT }}>
              {t('collab.notes.website')}
            </div>
            <input className="!w-[100%] ![border:1px_solid_var(--border-primary)] !rounded-[10px] !p-[8px_12px] !text-[length:13px] ![background:var(--bg-input)] ![font-family:inherit] ![outline:none] !box-border" value={website} onChange={e => setWebsite(e.target.value)}
              placeholder={t('collab.notes.websitePlaceholder')}
              style={{ color: 'var(--text-primary)' }} />
          </div>

          {/* File attachments */}
          {canUploadFiles && <div>
            <div className="!uppercase !tracking-[0.05em] !mb-[4px]" style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', fontFamily: FONT }}>
              {t('collab.notes.attachFiles')}
            </div>
            <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => { const files = e.target.files; if (files?.length) setPendingFiles(prev => [...prev, ...Array.from(files)]); e.target.value = '' }} />
            <div className="!flex !gap-[6px] !flex-wrap !items-center">
              {/* Existing attachments (edit mode) */}
              {existingAttachments.map(a => {
                const isImage = a.mime_type?.startsWith('image/')
                return (
                  <div className="!flex !items-center !gap-[4px] !p-[3px_8px] !rounded-[8px] ![background:var(--bg-secondary)] !text-[length:11px]" key={a.id} style={{ color: 'var(--text-muted)' }}>
                    {isImage && <AuthedImg src={a.url} style={{ width: 18, height: 18, objectFit: 'cover', borderRadius: 3 }} />}
                    {(a.original_name || '').length > 20 ? a.original_name.slice(0, 17) + '...' : a.original_name}
                    <button className="![background:none] ![border:none] !cursor-pointer !p-[0] !flex" type="button" onClick={() => handleDeleteAttachment(a.id)} style={{ color: '#ef4444' }}>
                      <X size={10} />
                    </button>
                  </div>
                )
              })}
              {/* New pending files */}
              {pendingFiles.map((f, i) => (
                <div className="!flex !items-center !gap-[4px] !p-[3px_8px] !rounded-[8px] ![background:var(--bg-secondary)] !text-[length:11px]" key={`new-${i}`} style={{ color: 'var(--text-muted)' }}>
                  {f.name.length > 20 ? f.name.slice(0, 17) + '...' : f.name}
                  <button className="![background:none] ![border:none] !cursor-pointer !p-[0] !flex" type="button" onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} style={{ color: 'var(--text-faint)' }}>
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button className="!p-[4px_10px] !rounded-[8px] ![border:1px_dashed_var(--border-faint)] ![background:transparent] !cursor-pointer !inline-flex !items-center !gap-[4px]" type="button" onClick={() => fileRef.current?.click()}
                style={{ color: 'var(--text-faint)', fontSize: 11, fontFamily: FONT }}>
                <Plus size={11} /> {t('files.attach') || 'Add'}
              </button>
            </div>
          </div>}

          {/* Submit */}
          <button className="!w-[100%] !rounded-[99px] !p-[7px_14px] ![border:none] !mt-[4px]"
            type="submit"
            disabled={!canSubmit}
            style={{ background: canSubmit ? 'var(--accent)' : 'var(--border-primary)', color: canSubmit ? 'var(--accent-text)' : 'var(--text-faint)', fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: canSubmit ? 'pointer' : 'default' }}
          >
            {submitting ? '...' : isEdit ? t('collab.notes.save') : t('collab.notes.create')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}

interface EditableCatNameProps {
  name: string
  onRename: (newName: string) => void
}

function EditableCatName({ name, onRename }: EditableCatNameProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const inputRef = useRef(null)

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select() } }, [editing])

  const save = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== name) onRename(value.trim())
    else setValue(name)
  }

  if (editing) {
    return <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
      onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(name); setEditing(false) } }}
      style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '2px 8px', background: 'var(--bg-input)', fontFamily: 'inherit', outline: 'none' }} />
  }

  return (
    <span className="!flex-[1] !text-[length:13px] !font-[600] !cursor-pointer !p-[2px_0]" onClick={() => { setValue(name); setEditing(true) }}
      style={{ color: 'var(--text-primary)' }}
      title="Click to rename">
      {name}
    </span>
  )
}

// ── Category Settings Modal ──────────────────────────────────────────────────
interface CategorySettingsModalProps {
  onClose: () => void
  categories: string[]
  categoryColors: Record<string, string>
  onSave: (colors: Record<string, string>) => void
  onRenameCategory: (oldName: string, newName: string) => Promise<void>
  t: (key: string) => string
}

function CategorySettingsModal({ onClose, categories, categoryColors, onSave, onRenameCategory, t }: CategorySettingsModalProps) {
  const [localColors, setLocalColors] = useState({ ...categoryColors })
  const [renames, setRenames] = useState<Record<string, string>>({}) // { oldName: newName }
  const [newCatName, setNewCatName] = useState('')

  const handleColorChange = (cat, color) => {
    setLocalColors(prev => ({ ...prev, [cat]: color }))
  }

  const handleAddCategory = () => {
    if (!newCatName.trim() || localColors[newCatName.trim()]) return
    setLocalColors(prev => ({ ...prev, [newCatName.trim()]: NOTE_COLORS[Object.keys(prev).length % NOTE_COLORS.length].value }))
    setNewCatName('')
  }

  const handleRemoveCategory = (cat) => {
    setLocalColors(prev => { const n = { ...prev }; delete n[cat]; return n })
  }

  const handleRenameCategory = (oldName, newName) => {
    if (!newName.trim() || newName.trim() === oldName || localColors[newName.trim()]) return
    // Track rename for saving to DB later
    const originalName = Object.entries(renames).find(([, v]) => v === oldName)?.[0] || oldName
    setRenames(prev => ({ ...prev, [originalName]: newName.trim() }))
    setLocalColors(prev => {
      const n = {}
      for (const [k, v] of Object.entries(prev)) {
        n[k === oldName ? newName.trim() : k] = v
      }
      return n
    })
  }

  const handleSave = async () => {
    // Apply renames to notes in DB
    for (const [oldName, newName] of Object.entries(renames)) {
      if (oldName !== newName) await onRenameCategory(oldName, newName)
    }
    await onSave(localColors)
    onClose()
  }

  // Merge existing categories from notes with saved colors
  const allCats = [...new Set([...categories, ...Object.keys(localColors)])]

  return ReactDOM.createPortal(
    <div className="!fixed !inset-[0] ![background:var(--overlay-bg,_rgba(0,0,0,0.35))] ![backdrop-filter:blur(6px)] ![-webkit-backdrop-filter:blur(6px)] !flex !items-center !justify-center !z-[9999] !p-[16px]" style={{ fontFamily: FONT }} onClick={onClose}>
      <div className="![background:var(--bg-card)] !rounded-[16px] !w-[100%] !max-w-[420px] !max-h-[80vh] !overflow-auto ![border:1px_solid_var(--border-faint)]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="!flex !items-center !justify-between !p-[14px_16px_12px] ![border-bottom:1px_solid_var(--border-faint)]">
          <h3 className="!text-[length:14px] !font-[700] !m-[0]" style={{ color: 'var(--text-primary)' }}>
            {t('collab.notes.categorySettings') || 'Category Settings'}
          </h3>
          <button className="![background:none] ![border:none] !cursor-pointer !p-[2px] !flex" onClick={onClose} style={{ color: 'var(--text-faint)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Categories list */}
        <div className="!p-[12px_16px] !flex !flex-col !gap-[10px]">
          {allCats.length === 0 && (
            <p className="!text-[length:12px] !text-center !p-[16px]" style={{ color: 'var(--text-faint)' }}>
              {t('collab.notes.noCategoriesYet') || 'No categories yet'}
            </p>
          )}
          {allCats.map(cat => (
            <div className="!flex !items-center !gap-[10px]" key={cat}>
              {/* Color swatches */}
              <div className="!flex !gap-[4px]">
                {NOTE_COLORS.map(c => (
                  <button className={['!w-[20px] !h-[20px] !rounded-[6px] ![border:none] !cursor-pointer !p-[0] ![transition:transform_0.1s]', ((localColors[cat] || NOTE_COLORS[0].value) === c.value) ? '![outline:2px_solid_var(--text-primary)]' : '![outline:2px_solid_transparent]', '[&&]:![outline-offset:1px]'].join(' ')} key={c.value} onClick={() => handleColorChange(cat, c.value)} style={{ background: c.value, transform: (localColors[cat] || NOTE_COLORS[0].value) === c.value ? 'scale(1.1)' : 'scale(1)' }} />
                ))}
              </div>
              {/* Category name — editable */}
              <EditableCatName name={cat} onRename={(newName) => handleRenameCategory(cat, newName)} />
              {/* Delete */}
              <button className="trek-hover-danger ![background:none] ![border:none] !cursor-pointer !p-[3px] !flex" onClick={() => handleRemoveCategory(cat)} style={{ color: 'var(--text-faint)' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {/* Add new */}
          <div className="!flex !gap-[6px] !mt-[4px]">
            <input className="!flex-[1] ![border:1px_solid_var(--border-primary)] !rounded-[10px] !p-[8px_12px] !text-[length:13px] ![background:var(--bg-input)] ![font-family:inherit] ![outline:none]" value={newCatName} onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
              placeholder={t('collab.notes.newCategory')}
              style={{ color: 'var(--text-primary)' }} />
            <button className="![border:none] !rounded-[10px] !p-[8px_14px] !flex !items-center !shrink-[0]" onClick={handleAddCategory} disabled={!newCatName.trim()} style={{ background: newCatName.trim() ? 'var(--accent)' : 'var(--border-primary)', color: 'var(--accent-text)', cursor: newCatName.trim() ? 'pointer' : 'default' }}>
              <Plus size={14} />
            </button>
          </div>

          {/* Save */}
          <button className="!w-[100%] !rounded-[99px] !p-[9px_14px] ![background:var(--accent)] !text-[length:13px] !font-[600] ![border:none] !cursor-pointer !mt-[8px]" onClick={handleSave} style={{ color: 'var(--accent-text)' }}>
            {t('collab.notes.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Note Card ───────────────────────────────────────────────────────────────
interface NoteCardProps {
  note: CollabNote
  currentUser: User
  canEdit: boolean
  onUpdate: (noteId: number, data: Partial<CollabNote>) => Promise<void>
  onDelete: (noteId: number) => Promise<void>
  onEdit: (note: CollabNote) => void
  onView: (note: CollabNote) => void
  onPreviewFile: (file: NoteFile) => void
  getCategoryColor: (category: string) => string
  tripId: number | string
  t: (key: string) => string
}

function NoteCard({ note, currentUser, canEdit, onUpdate, onDelete, onEdit, onView, onPreviewFile, getCategoryColor, tripId, t }: NoteCardProps) {
  const [hovered, setHovered] = useState(false)

  const author = note.author || note.user || { username: note.username, avatar: note.avatar_url || (note.avatar ? `/uploads/avatars/${note.avatar}` : null) }
  const color = getCategoryColor ? getCategoryColor(note.category) : (note.color || '#6366f1')

  const handleTogglePin = useCallback(() => {
    onUpdate(note.id, { pinned: !note.pinned })
  }, [note.id, note.pinned, onUpdate])

  const handleDelete = useCallback(() => {
    onDelete(note.id)
  }, [note.id, onDelete])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${note.pinned ? color + '40' : color + '25'}`,
        background: note.pinned ? `${color}08` : 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT,
        transition: 'transform 0.12s, box-shadow 0.12s',
        ...(hovered ? { transform: 'translateY(-1px)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' } : {}),
      }}
    >
      {/* Header bar — like reservation cards */}
      <div className="!flex !items-center !gap-[6px] !p-[7px_10px]" style={{ background: `${color}0d` }}>
        {!!note.pinned && <Pin size={9} color={color} style={{ flexShrink: 0 }} />}
        <span className="!flex !items-center !gap-[5px] !overflow-hidden !flex-[1] !min-w-[0]">
          <span className="!text-[length:11px] !font-[700] !overflow-hidden !text-ellipsis !whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
            {note.title}
          </span>
          {note.category && (
            <span className="!text-[length:8px] !font-[600] !p-[2px_6px] !rounded-[99px] !shrink-[0] !tracking-[0.02em] !uppercase" style={{ color, background: `${color}18` }}>
              {note.category}
            </span>
          )}
        </span>

        {/* Hover actions in header */}
        {(
          <div className="!flex !gap-[2px]">
            {note.content && (
              <button className="trek-hover-text !p-[3px] ![background:none] ![border:none] !cursor-pointer !flex" onClick={() => onView?.(note)} title={t('collab.notes.expand') || 'Expand'}
                style={{ color: 'var(--text-faint)' }}>
                <Maximize2 size={10} />
              </button>
            )}
            {canEdit && <button onClick={handleTogglePin} title={note.pinned ? t('collab.notes.unpin') : t('collab.notes.pin')}
              style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }}
              onMouseEnter={e => e.currentTarget.style.color = color}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}>
              {note.pinned ? <PinOff size={10} /> : <Pin size={10} />}
            </button>}
            {canEdit && <button className="trek-hover-text !p-[3px] ![background:none] ![border:none] !cursor-pointer !flex" onClick={() => onEdit?.(note)} title={t('collab.notes.edit')}
              style={{ color: 'var(--text-faint)' }}>
              <Pencil size={10} />
            </button>}
            {canEdit && <button className="trek-hover-danger !p-[3px] ![background:none] ![border:none] !cursor-pointer !flex" onClick={handleDelete} title={t('collab.notes.delete')}
              style={{ color: 'var(--text-faint)' }}>
              <Trash2 size={10} />
            </button>}
            <div className="!w-[1px] !h-[12px] ![background:var(--border-faint)] !shrink-[0] !ml-[1px] !mr-[1px]" />
            {/* Author avatar */}
            <div style={{ position: 'relative', flexShrink: 0 }}
              onMouseEnter={e => { const tip = e.currentTarget.querySelector<HTMLElement>('[data-tip]'); if (tip) tip.style.opacity = '1' }}
              onMouseLeave={e => { const tip = e.currentTarget.querySelector<HTMLElement>('[data-tip]'); if (tip) tip.style.opacity = '0' }}>
              <UserAvatar user={author} size={16} />
              <div className="!absolute !bottom-[100%] !left-[50%] !mb-[6px] !pointer-events-none ![transition:opacity_0.12s] !whitespace-nowrap !z-[10] ![background:var(--bg-card)] !text-[length:11px] !font-[500] !p-[5px_10px] !rounded-[8px] ![box-shadow:0_4px_12px_rgba(0,0,0,0.15)] ![border:1px_solid_var(--border-faint)]" data-tip style={{ transform: 'translateX(-50%)', opacity: 0, color: 'var(--text-primary)' }}>
                {author.username}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="!p-[8px_12px_10px] !flex !flex-col !gap-[4px] !flex-[1]">
        <div className="!flex !gap-[8px]">
          <div className="!flex-[1] !min-w-[0]">
            {note.content && (
              <div className="collab-note-md !leading-[1.5] !m-[0] !max-h-[4.5em] !overflow-hidden !break-words" style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: FONT }}>
                <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.content}</Markdown>
              </div>
            )}
          </div>
              {/* Right: website + attachment thumbnails */}
              {(note.website || note.attachments?.length > 0) && (
                <div className="!flex !gap-[6px] !shrink-[0] !items-start">
                  {/* Website */}
                  {note.website && (
                    <div className="!flex !flex-col !items-center !gap-[2px]">
                      <span className="!text-[length:7px] !font-[600] !uppercase !tracking-[0.3px]" style={{ color: 'var(--text-faint)' }}>Link</span>
                      <WebsiteThumbnail url={note.website} tripId={tripId} color={color} />
                    </div>
                  )}
                  {/* Files */}
                  {(note.attachments || []).length > 0 && (
                    <div className="!flex !flex-col !items-center !gap-[2px]">
                      <span className="!text-[length:7px] !font-[600] !uppercase !tracking-[0.3px]" style={{ color: 'var(--text-faint)' }}>{t('files.title')}</span>
                      <div className="!flex !gap-[4px]">
                  {(note.attachments || []).slice(0, note.website ? 1 : 2).map(a => {
                    const isImage = a.mime_type?.startsWith('image/')
                    const ext = (a.original_name || '').split('.').pop()?.toUpperCase() || '?'
                    return isImage ? (
                      <AuthedImg className="trek-h-transform-244d20 trek-h-box-shadow-7cd433" key={a.id} src={a.url} alt={a.original_name}
                        style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', transition: 'transform 0.12s, box-shadow 0.12s' }}
                        onClick={() => onPreviewFile?.(a)} />
                    ) : (
                      <div className="trek-h-transform-244d20 trek-h-box-shadow-7cd433 !w-[48px] !h-[48px] !rounded-[8px] !cursor-pointer !flex !flex-col !items-center !justify-center !gap-[1px] ![transition:transform_0.12s,_box-shadow_0.12s]" key={a.id} title={a.original_name} onClick={() => onPreviewFile?.(a)}
                        style={{ background: a.mime_type === 'application/pdf' ? '#ef44441a' : 'var(--bg-secondary)' }}>
                        <span className="!text-[length:9px] !font-[700] !tracking-[0.3px]" style={{ color: a.mime_type === 'application/pdf' ? '#ef4444' : 'var(--text-muted)' }}>{ext}</span>
                      </div>
                    )
                  })}
                  {(note.attachments?.length || 0) > (note.website ? 1 : 2) && (
                    <span className="!text-[length:8px] !text-center" style={{ color: 'var(--text-faint)' }}>+{(note.attachments?.length || 0) - (note.website ? 1 : 2)}</span>
                  )}
                      </div>
                    </div>
                  )}
                </div>
              )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────
interface CollabNotesProps {
  tripId: number | string
  currentUser: User
}

export default function CollabNotes({ tripId, currentUser }: CollabNotesProps) {
  const { t } = useTranslation()
  const can = useCanDo()
  const trip = useTripStore((s) => s.trip)
  const canEdit = can('collab_edit', trip)
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNewModal, setShowNewModal] = useState(false)
  const [editingNote, setEditingNote] = useState(null)
  const [viewingNote, setViewingNote] = useState<CollabNote | null>(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [activeCategory, setActiveCategory] = useState(null)

  // Empty categories (no notes yet) stored in localStorage
  const [emptyCategories, setEmptyCategories] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`collab-cats-${tripId}`)) || {} } catch { return {} }
  })
  const saveEmptyCategories = (map) => {
    setEmptyCategories(map)
    localStorage.setItem(`collab-cats-${tripId}`, JSON.stringify(map))
  }

  // Category colors: from notes first, then from empty categories
  const categoryColors = useMemo(() => {
    const map = { ...emptyCategories }
    for (const n of notes) {
      if (n.category && n.color) map[n.category] = n.color
    }
    return map
  }, [notes, emptyCategories])

  const getCategoryColor = (cat) => {
    if (!cat) return NOTE_COLORS[0].value
    if (categoryColors[cat]) return categoryColors[cat]
    return NOTE_COLORS[Object.keys(categoryColors).length % NOTE_COLORS.length].value
  }

  // ── Load notes on mount ──
  useEffect(() => {
    if (!tripId) return
    let cancelled = false
    setLoading(true)
    collabApi.getNotes(tripId)
      .then(data => { if (!cancelled) setNotes(data?.notes || data || []) })
      .catch(() => { if (!cancelled) setNotes([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId])

  // ── WebSocket real-time sync ──
  useEffect(() => {
    if (!tripId) return

    const handler = (msg) => {
      if (msg.type === 'collab:note:created' && msg.note) {
        setNotes(prev => {
          if (prev.some(n => n.id === msg.note.id)) return prev
          return [msg.note, ...prev]
        })
      }
      if (msg.type === 'collab:note:updated' && msg.note) {
        setNotes(prev =>
          prev.map(n => (n.id === msg.note.id ? { ...n, ...msg.note } : n))
        )
      }
      if (msg.type === 'collab:note:deleted') {
        const deletedId = msg.noteId || msg.id
        if (deletedId) {
          setNotes(prev => prev.filter(n => n.id !== deletedId))
        }
      }
    }

    addListener(handler)
    return () => removeListener(handler)
  }, [tripId])

  // ── Actions ──
  const handleCreateNote = useCallback(async (data) => {
    const pendingFiles = data._pendingFiles || []
    delete data._pendingFiles
    const created = await collabApi.createNote(tripId, data)
    if (created) {
      const note = created.note || created
      // Upload pending files
      if (pendingFiles.length > 0 && note.id) {
        for (const file of pendingFiles) {
          const fd = new FormData()
          fd.append('file', file)
          try { await collabApi.uploadNoteFile(tripId, note.id, fd) } catch (err) { console.error('Failed to upload note attachment:', err) }
        }
        // Reload note with attachments
        const fresh = await collabApi.getNotes(tripId)
        if (fresh?.notes) setNotes(fresh.notes)
        window.dispatchEvent(new Event('collab-files-changed'))
        return
      }
      setNotes(prev => {
        if (prev.some(n => n.id === note.id)) return prev
        return [note, ...prev]
      })
    }
  }, [tripId])

  const handleUpdateNote = useCallback(async (noteId, data) => {
    const result = await collabApi.updateNote(tripId, noteId, data)
    const updated = result?.note || result
    if (updated) {
      setNotes(prev =>
        prev.map(n => (n.id === noteId ? { ...n, ...updated } : n))
      )
    }
  }, [tripId])

  const saveCategoryColors = useCallback(async (newMap) => {
    // Update notes with changed colors
    for (const [cat, color] of Object.entries(newMap)) {
      const notesInCat = notes.filter(n => n.category === cat)
      if (notesInCat.length > 0 && categoryColors[cat] !== color) {
        for (const n of notesInCat) {
          await handleUpdateNote(n.id, { color })
        }
      }
    }
    // Save all categories (including empty ones) to localStorage
    const emptyCats = {}
    for (const [cat, color] of Object.entries(newMap)) {
      if (!notes.some(n => n.category === cat)) {
        emptyCats[cat] = color
      }
    }
    saveEmptyCategories(emptyCats)
  }, [categoryColors, notes, handleUpdateNote])

  const handleEditSubmit = useCallback(async (data) => {
    if (!editingNote) return
    const pendingFiles = data._pendingFiles || []
    delete data._pendingFiles
    await handleUpdateNote(editingNote.id, data)
    if (pendingFiles.length > 0) {
      for (const file of pendingFiles) {
        const fd = new FormData()
        fd.append('file', file)
        try { await collabApi.uploadNoteFile(tripId, editingNote.id, fd) } catch {}
      }
      const fresh = await collabApi.getNotes(tripId)
      if (fresh?.notes) setNotes(fresh.notes)
      window.dispatchEvent(new Event('collab-files-changed'))
    }
  }, [editingNote, tripId, handleUpdateNote])

  const handleDeleteNoteFile = useCallback(async (noteId, fileId) => {
    try { await collabApi.deleteNoteFile(tripId, noteId, fileId) } catch {}
    window.dispatchEvent(new Event('collab-files-changed'))
  }, [tripId])

  const handleDeleteNote = useCallback(async (noteId) => {
    await collabApi.deleteNote(tripId, noteId)
    setNotes(prev => prev.filter(n => n.id !== noteId))
    window.dispatchEvent(new Event('collab-files-changed'))
  }, [tripId])

  // ── Derived data ──
  const categories = [...new Set(notes.map(n => n.category).filter(Boolean))]

  const sortedNotes = [...notes]
    .filter(n => activeCategory === null || n.category === activeCategory)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      const tA = new Date(a.updated_at || a.created_at || 0).getTime()
      const tB = new Date(b.updated_at || b.created_at || 0).getTime()
      return tB - tA
    })

  // ── Loading state ──
  if (loading) {
    return (
      <div className="!h-[100%] !flex !flex-col" style={{ fontFamily: FONT }}>
        <div className="!p-[12px_16px] ![border-bottom:1px_solid_var(--border-faint)]">
          <h3 className="!m-[0]" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: FONT }}>
            {t('collab.notes.title')}
          </h3>
        </div>
        <div className="!flex-[1] !flex !items-center !justify-center">
          <div className="!w-[20px] !h-[20px] ![border:2px_solid_var(--border-primary)] [&&]:![border-top-color:var(--text-primary)] !rounded-[50%]" style={{ animation: 'collab-notes-spin 0.7s linear infinite' }} />
          <style>{`@keyframes collab-notes-spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    )
  }

  return (
    <div className="!h-[100%] !flex !flex-col" style={{ fontFamily: FONT }}>
      {/* ── Header ── */}
      <div className="!flex !items-center !justify-between !p-[10px_16px] !shrink-[0]">
        <h3 className="!m-[0] !tracking-[0.3px] !uppercase !flex !items-center !gap-[7px]" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', fontFamily: FONT }}>
          <StickyNote size={14} color="var(--text-faint)" />
          {t('collab.notes.title')}
        </h3>
        <div className="!flex !gap-[4px] !items-center">
          {canEdit && <button className="trek-hover-text !flex !items-center !justify-center !w-[28px] !h-[28px] !rounded-[8px] ![border:none] ![background:transparent] !cursor-pointer ![transition:color_0.12s]" onClick={() => setShowSettings(true)} title={t('collab.notes.categorySettings') || 'Categories'}
            style={{ color: 'var(--text-faint)' }}>
            <Settings size={14} />
          </button>}
          {canEdit && <button className="!inline-flex !items-center !gap-[4px] !rounded-[99px] !p-[6px_12px] ![background:var(--accent)] ![border:none] !cursor-pointer !whitespace-nowrap" onClick={() => setShowNewModal(true)}
            style={{ color: 'var(--accent-text)', fontSize: 11, fontWeight: 600, fontFamily: FONT }}>
            <Plus size={12} />
            {t('collab.notes.new')}
          </button>}
        </div>
      </div>

      {/* ── Category filter pills ── */}
      {categories.length > 0 && (
        <div className="!flex !gap-[4px] !p-[8px_12px_0] !overflow-x-auto !shrink-[0]">
          <button className="!shrink-[0] !rounded-[99px] !p-[3px_10px] !cursor-pointer !whitespace-nowrap !uppercase !tracking-[0.03em]"
            onClick={() => setActiveCategory(null)}
            style={{ fontSize: 10, fontWeight: 600, fontFamily: FONT, border: activeCategory === null
                ? '1px solid var(--accent)'
                : '1px solid var(--border-faint)', background: activeCategory === null
                ? 'var(--accent)'
                : 'transparent', color: activeCategory === null
                ? 'var(--accent-text)'
                : 'var(--text-secondary)' }}
          >
            {t('collab.notes.all')}
          </button>
          {categories.map(cat => (
            <button className="!shrink-[0] !rounded-[99px] !p-[3px_10px] !cursor-pointer !whitespace-nowrap !uppercase !tracking-[0.03em]"
              key={cat}
              onClick={() => setActiveCategory(prev => prev === cat ? null : cat)}
              style={{ fontSize: 10, fontWeight: 600, fontFamily: FONT, border: activeCategory === cat
                  ? '1px solid var(--accent)'
                  : '1px solid var(--border-faint)', background: activeCategory === cat
                  ? 'var(--accent)'
                  : 'transparent', color: activeCategory === cat
                  ? 'var(--accent-text)'
                  : 'var(--text-secondary)' }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div className="!flex-[1] !overflow-y-auto !p-[12px]">
        {sortedNotes.length === 0 ? (
          /* ── Empty state ── */
          <div className="!flex !flex-col !items-center !justify-center !p-[48px_20px] !text-center !h-[100%]">
            <Pencil size={36} color="var(--text-faint)" style={{ marginBottom: 12 }} />
            <div className="!mb-[4px]" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: FONT }}>
              {t('collab.notes.empty')}
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--text-faint)',
              fontFamily: FONT,
            }}>
              {t('collab.notes.emptyDesc') || 'Create a note to get started'}
            </div>
          </div>
        ) : (
          /* ── Notes grid — 2 columns ── */
          <div className="!grid !gap-[8px]" style={{ gridTemplateColumns: window.innerWidth < 768 ? '1fr' : 'repeat(2, 1fr)' }}>
            {sortedNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                currentUser={currentUser}
                canEdit={canEdit}
                onUpdate={handleUpdateNote}
                onDelete={handleDeleteNote}
                onEdit={setEditingNote}
                onView={setViewingNote}
                onPreviewFile={setPreviewFile}
                getCategoryColor={getCategoryColor}
                tripId={tripId}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── New Note Modal ── */}
      {/* View note modal */}
      {viewingNote && ReactDOM.createPortal(
        <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.5)] ![backdrop-filter:blur(6px)] ![-webkit-backdrop-filter:blur(6px)] !flex !items-center !justify-center !z-[10000] !p-[16px]"
          onClick={() => setViewingNote(null)}
        >
          <div className="![background:var(--bg-card)] !rounded-[16px] ![box-shadow:0_20px_60px_rgba(0,0,0,0.2)] !w-[min(700px,_calc(100vw_-_32px))] !max-h-[80vh] !overflow-hidden !flex !flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="!p-[16px_20px_12px] ![border-bottom:1px_solid_var(--border-primary)] !flex !items-center !justify-between !gap-[12px]">
              <div className="!flex-[1] !min-w-[0]">
                <div className="!text-[length:17px] !font-[600]" style={{ color: 'var(--text-primary)' }}>{viewingNote.title}</div>
                {viewingNote.category && (
                  <span className="!inline-block !mt-[4px] !text-[length:10px] !font-[600] !p-[2px_8px] !rounded-[6px]" style={{ color: getCategoryColor(viewingNote.category), background: `${getCategoryColor(viewingNote.category)}18` }}>{viewingNote.category}</span>
                )}
              </div>
              <div className="!flex !gap-[4px] !shrink-[0]">
                {canEdit && <button className="trek-hover-text !p-[6px] ![background:none] ![border:none] !cursor-pointer !flex !rounded-[6px]" onClick={() => { setViewingNote(null); setEditingNote(viewingNote) }}
                  style={{ color: 'var(--text-faint)' }}>
                  <Pencil size={16} />
                </button>}
                <button className="trek-hover-text !p-[6px] ![background:none] ![border:none] !cursor-pointer !flex !rounded-[6px]" onClick={() => setViewingNote(null)}
                  style={{ color: 'var(--text-faint)' }}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="collab-note-md-full !p-[16px_20px] !overflow-y-auto !text-[length:14px] !leading-[1.7]" style={{ color: 'var(--text-primary)' }}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{viewingNote.content || ''}</Markdown>
              {(viewingNote.attachments || []).length > 0 && (
                <div className="!mt-[16px] !pt-[16px] ![border-top:1px_solid_var(--border-primary)]">
                  <div className="!text-[length:11px] !font-[600] !uppercase !tracking-[0.5px] !mb-[10px]" style={{ color: 'var(--text-faint)' }}>{t('files.title')}</div>
                  <div className="!flex !flex-wrap !gap-[8px]">
                    {(viewingNote.attachments || []).map(a => {
                      const isImage = a.mime_type?.startsWith('image/')
                      const ext = (a.original_name || '').split('.').pop()?.toUpperCase() || '?'
                      return (
                        <div className="!flex !flex-col !items-center !gap-[4px] !max-w-[72px]" key={a.id}>
                          {isImage ? (
                            <AuthedImg className="trek-h-transform-6b162d trek-h-box-shadow-7cd433" src={a.url} alt={a.original_name}
                              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', transition: 'transform 0.12s, box-shadow 0.12s' }}
                              onClick={() => setPreviewFile(a)} />
                          ) : (
                            <div className="trek-h-transform-6b162d trek-h-box-shadow-7cd433 !w-[64px] !h-[64px] !rounded-[8px] !cursor-pointer !flex !flex-col !items-center !justify-center !gap-[1px] ![transition:transform_0.12s,_box-shadow_0.12s]" title={a.original_name} onClick={() => setPreviewFile(a)}
                              style={{ background: a.mime_type === 'application/pdf' ? '#ef44441a' : 'var(--bg-secondary)' }}>
                              <span className="!text-[length:10px] !font-[700] !tracking-[0.3px]" style={{ color: a.mime_type === 'application/pdf' ? '#ef4444' : 'var(--text-muted)' }}>{ext}</span>
                            </div>
                          )}
                          <span className="!text-[length:9px] !text-center !overflow-hidden !text-ellipsis !whitespace-nowrap !w-[100%]" style={{ color: 'var(--text-faint)' }}>{a.original_name}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showNewModal && (
        <NoteFormModal
          note={null}
          tripId={tripId}
          onClose={() => setShowNewModal(false)}
          onSubmit={handleCreateNote}
          existingCategories={categories}
          categoryColors={categoryColors}
          getCategoryColor={getCategoryColor}
          t={t}
        />
      )}

      {/* ── Edit Note Modal ── */}
      {editingNote && (
        <NoteFormModal
          note={editingNote}
          tripId={tripId}
          onClose={() => setEditingNote(null)}
          onSubmit={handleEditSubmit}
          onDeleteFile={handleDeleteNoteFile}
          existingCategories={categories}
          categoryColors={categoryColors}
          getCategoryColor={getCategoryColor}
          t={t}
        />
      )}

      {/* ── File Preview ── */}
      <FilePreviewPortal file={previewFile} onClose={() => setPreviewFile(null)} />

      {/* ── Category Settings Modal ── */}
      {showSettings && (
        <CategorySettingsModal
          onClose={() => setShowSettings(false)}
          categories={categories}
          categoryColors={categoryColors}
          onSave={saveCategoryColors}
          onRenameCategory={async (oldName, newName) => {
            // Update all notes with this category in DB
            const toUpdate = notes.filter(n => n.category === oldName)
            for (const n of toUpdate) {
              await handleUpdateNote(n.id, { category: newName })
            }
          }}
          t={t}
        />
      )}
    </div>
  )
}
