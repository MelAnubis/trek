import { normalizeImageFile } from '../../utils/convertHeic'
import { useState, useEffect, useRef } from 'react'
import Modal from '../shared/Modal'
import { Calendar, Camera, X, Clipboard, UserPlus, Bell, Sparkles } from 'lucide-react'
import { tripsApi, authApi } from '../../api/client'
import CustomSelect from '../shared/CustomSelect'
import { useAuthStore } from '../../store/authStore'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { CustomDatePicker } from '../shared/CustomDateTimePicker'
import type { Trip } from '../../types'

interface TripFormModalProps {
  isOpen: boolean
  onClose: () => void
  /** Resolves to the created/updated trip when the caller has it (used to add members and the cover). */
  onSave: (data: Record<string, unknown>) => Promise<{ trip?: { id: number } } | void> | void
  trip: Trip | null
  onCoverUpdate?: (tripId: number, coverUrl: string) => void
}

export default function TripFormModal({ isOpen, onClose, onSave, trip, onCoverUpdate }: TripFormModalProps) {
  const isEditing = !!trip
  const fileRef = useRef(null)
  const toast = useToast()
  const { t, language } = useTranslation()
  const currentUser = useAuthStore(s => s.user)
  const tripRemindersEnabled = useAuthStore(s => s.tripRemindersEnabled)
  const setTripRemindersEnabled = useAuthStore(s => s.setTripRemindersEnabled)
  const can = useCanDo()
  const canUploadCover = !isEditing || can('trip_cover_upload', trip)
  const canEditTrip = !isEditing || can('trip_edit', trip)
  // Solo el dueño pone un viaje en la zona pública (el servidor lo comprueba igual).
  const canMakePublic = !isEditing || !!(trip as { is_owner?: number | boolean } | null)?.is_owner

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    start_date: '',
    end_date: '',
    reminder_days: 0 as number,
    trip_type: 'general' as string,
    day_count: 7,
    is_public: false,
  })
  const [customReminder, setCustomReminder] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [coverPreview, setCoverPreview] = useState(null)
  const [pendingCoverFile, setPendingCoverFile] = useState(null)
  const [pendingCoverUrl, setPendingCoverUrl] = useState<string | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [suggestingCover, setSuggestingCover] = useState(false)
  const [coverSuggestions, setCoverSuggestions] = useState<{ url: string; thumb: string; attribution: string; source: string }[]>([])
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([])
  const [selectedMembers, setSelectedMembers] = useState<number[]>([])
  const [existingMembers, setExistingMembers] = useState<{ id: number; username: string }[]>([])
  const [memberSelectValue, setMemberSelectValue] = useState('')

  useEffect(() => {
    if (trip) {
      const rd = trip.reminder_days ?? 3
      setFormData({
        title: trip.title || '',
        description: trip.description || '',
        start_date: trip.start_date || '',
        end_date: trip.end_date || '',
        reminder_days: rd,
        trip_type: trip.trip_type || 'general',
        day_count: trip.day_count || 7,
        is_public: !!(trip as { is_public?: number | boolean }).is_public,
      })
      setCustomReminder(![0, 1, 3, 9].includes(rd))
      setCoverPreview(trip.cover_image || null)
    } else {
      setFormData({ title: '', description: '', start_date: '', end_date: '', reminder_days: tripRemindersEnabled ? 3 : 0, day_count: 7, trip_type: 'general', is_public: false })
      setCustomReminder(false)
      setCoverPreview(null)
    }
    setPendingCoverFile(null)
    setSelectedMembers([])
    setError('')
    if (isOpen) {
      authApi.getAppConfig().then((c: { trip_reminders_enabled?: boolean }) => {
        if (c?.trip_reminders_enabled !== undefined) setTripRemindersEnabled(c.trip_reminders_enabled)
      }).catch(() => {})
    }
    authApi.listUsers().then(d => setAllUsers(d.users || [])).catch(() => {})
    if (trip) {
      tripsApi.getMembers(trip.id).then(d => setExistingMembers(d.members || [])).catch(() => {})
    } else {
      setExistingMembers([])
    }
  }, [trip, isOpen])

  useEffect(() => {
    if (!trip && isOpen) {
      setFormData(prev => ({ ...prev, reminder_days: tripRemindersEnabled ? 3 : 0 }))
    }
  }, [tripRemindersEnabled])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!formData.title.trim()) { setError(t('dashboard.titleRequired')); return }
    if (formData.start_date && formData.end_date && new Date(formData.end_date) < new Date(formData.start_date)) {
      setError(t('dashboard.endDateError')); return
    }
    setIsLoading(true)
    try {
      const result = (await onSave({
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        reminder_days: formData.reminder_days,
        trip_type: formData.trip_type,
        ...(canMakePublic ? { is_public: formData.is_public ? 1 : 0 } : {}),
        ...(!formData.start_date && !formData.end_date ? { day_count: formData.day_count } : {}),
      })) || undefined
      // Add selected members for newly created trips
      if (selectedMembers.length > 0 && result?.trip?.id) {
        for (const userId of selectedMembers) {
          const user = allUsers.find(u => u.id === userId)
          if (user) {
            try { await tripsApi.addMember(result.trip.id, user.username) } catch {}
          }
        }
      }
      // Upload pending cover for newly created trips
      if (pendingCoverFile && result?.trip?.id) {
        try {
          const fd = new FormData()
          fd.append('cover', pendingCoverFile)
          const data = await tripsApi.uploadCover(result.trip.id, fd)
          onCoverUpdate?.(result.trip.id, data.cover_image)
        } catch {
          // Cover upload failed but trip was created
        }
      } else if (pendingCoverUrl && result?.trip?.id) {
        try {
          await tripsApi.update(result.trip.id, { cover_image: pendingCoverUrl })
          onCoverUpdate?.(result.trip.id, pendingCoverUrl)
        } catch {
          // Cover suggestion failed but trip was created
        }
      }
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('places.saveError'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleCoverSelect = async (file) => {
    file = await normalizeImageFile(file)
    if (!file) return
    setPendingCoverUrl(null)
    setCoverSuggestions([])
    if (isEditing && trip?.id) {
      // Existing trip: upload immediately
      uploadCoverNow(file)
    } else {
      // New trip: stage for upload after creation
      setPendingCoverFile(file)
      setCoverPreview(URL.createObjectURL(file))
    }
  }

  const handleSuggestCover = async () => {
    if (!formData.title.trim()) {
      toast.error(t('dashboard.suggestCoverTitleRequired'))
      return
    }
    setSuggestingCover(true)
    setCoverSuggestions([])
    try {
      const data = await tripsApi.suggestCovers(formData.title.trim(), language)
      if (!data.photos || data.photos.length === 0) {
        toast.error(t('dashboard.suggestCoverNoResults'))
      } else {
        setCoverSuggestions(data.photos)
      }
    } catch {
      toast.error(t('dashboard.suggestCoverError'))
    } finally {
      setSuggestingCover(false)
    }
  }

  const handleSelectSuggestion = async (photo: { url: string }) => {
    setCoverSuggestions([])
    setPendingCoverFile(null)
    if (isEditing && trip?.id) {
      try {
        await tripsApi.update(trip.id, { cover_image: photo.url })
        setCoverPreview(photo.url)
        onCoverUpdate?.(trip.id, photo.url)
        toast.success(t('dashboard.coverSaved'))
      } catch {
        toast.error(t('dashboard.coverUploadError'))
      }
    } else {
      setPendingCoverUrl(photo.url)
      setCoverPreview(photo.url)
    }
  }

  const handleCoverChange = (e) => {
    handleCoverSelect((e.target as HTMLInputElement).files?.[0])
    e.target.value = ''
  }

  const uploadCoverNow = async (file) => {
    setUploadingCover(true)
    try {
      const fd = new FormData()
      fd.append('cover', file)
      const data = await tripsApi.uploadCover(trip.id, fd)
      setCoverPreview(data.cover_image)
      onCoverUpdate?.(trip.id, data.cover_image)
      toast.success(t('dashboard.coverSaved'))
    } catch {
      toast.error(t('dashboard.coverUploadError'))
    } finally {
      setUploadingCover(false)
    }
  }

  const handleRemoveCover = async () => {
    setCoverSuggestions([])
    if (pendingCoverFile || pendingCoverUrl) {
      setPendingCoverFile(null)
      setPendingCoverUrl(null)
      setCoverPreview(null)
      return
    }
    if (!trip?.id) return
    try {
      await tripsApi.update(trip.id, { cover_image: null })
      setCoverPreview(null)
      onCoverUpdate?.(trip.id, null)
    } catch {
      toast.error(t('dashboard.coverRemoveError'))
    }
  }

  // Paste support for cover image
  const handlePaste = (e: React.ClipboardEvent) => {
    if (!canUploadCover) return
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) handleCoverSelect(file)
        return
      }
    }
  }

  const update = (field, value) => setFormData(prev => {
    const next = { ...prev, [field]: value }
    if (field === 'start_date' && value) {
      if (!prev.end_date || prev.end_date < value) {
        next.end_date = value
      } else if (prev.start_date) {
        const oldStart = new Date(prev.start_date + 'T00:00:00Z')
        const oldEnd = new Date(prev.end_date + 'T00:00:00Z')
        const duration = Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000)
        const newEnd = new Date(value + 'T00:00:00Z')
        newEnd.setDate(newEnd.getDate() + duration)
        next.end_date = newEnd.toISOString().split('T')[0]
      }
    }
    return next
  })

  const inputCls = "w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent text-sm"

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('dashboard.editTrip') : t('dashboard.createTrip')}
      size="md"
      footer={
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            {t('common.cancel')}
          </button>
          <button onClick={handleSubmit} disabled={isLoading}
            className="px-4 py-2 text-sm bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white rounded-lg transition-colors flex items-center gap-2">
            {isLoading
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t('common.saving')}</>
              : isEditing ? t('common.update') : t('dashboard.createTrip')}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" onPaste={handlePaste}>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        {/* Cover image — gated by trip_cover_upload permission */}
        {canUploadCover && <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('dashboard.coverImage')}</label>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverChange} />
          {coverPreview ? (
            <div className="!relative !rounded-[10px] !overflow-hidden !h-[130px]">
              <img className="!w-[100%] !h-[100%] !object-cover" src={coverPreview} alt="" />
              <div className="!absolute !bottom-[8px] !right-[8px] !flex !gap-[6px]">
                <button className="!flex !items-center !gap-[4px] !p-[5px_10px] !rounded-[8px] ![color:white] !text-[length:11.5px] !font-[600] !cursor-pointer ![backdrop-filter:blur(4px)]" type="button" onClick={() => fileRef.current?.click()} disabled={uploadingCover}
                  style={{ background: 'rgba(0,0,0,0.55)', border: 'none' }}>
                  <Camera size={12} /> {uploadingCover ? t('common.uploading') : t('common.change')}
                </button>
                <button className="!flex !items-center !p-[5px_8px] !rounded-[8px] ![color:white] !cursor-pointer ![backdrop-filter:blur(4px)]" type="button" onClick={handleRemoveCover}
                  style={{ background: 'rgba(0,0,0,0.55)', border: 'none' }}>
                  <X size={12} />
                </button>
              </div>
            </div>
          ) : (
            <button className="trek-h-border-color-b6a5da trek-h-color-908c64 !w-[100%] !p-[18px] !rounded-[10px] !cursor-pointer !flex !items-center !justify-center !gap-[6px] !text-[length:13px] ![color:#9ca3af] ![font-family:inherit] ![transition:all_0.15s]" type="button" onClick={() => fileRef.current?.click()} disabled={uploadingCover}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)' }}
              onDragLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = 'none' }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = 'none'; const file = e.dataTransfer.files?.[0]; if (file?.type.startsWith('image/')) handleCoverSelect(file) }}
              style={{ border: '2px dashed #e5e7eb', background: 'none' }}>
              <Camera size={15} /> {uploadingCover ? t('common.uploading') : t('dashboard.addCoverImage')}
            </button>
          )}
          <button className="!flex !items-center !gap-[5px] !mt-[8px] !p-[2px_0] !text-[length:12.5px] !font-[600] ![color:#6366f1] ![font-family:inherit]" type="button" onClick={handleSuggestCover} disabled={suggestingCover}
            style={{ border: 'none', background: 'none', cursor: suggestingCover ? 'wait' : 'pointer', opacity: suggestingCover ? 0.6 : 1 }}>
            <Sparkles size={13} />
            {suggestingCover ? t('common.loading') : t('dashboard.suggestCover')}
          </button>
          {coverSuggestions.length > 0 && (
            <div className="!flex !gap-[8px] !overflow-x-auto !mt-[8px] !pb-[4px]">
              {coverSuggestions.map((photo, i) => (
                <button className="trek-hover-border-accent !shrink-[0] !w-[84px] !h-[56px] !rounded-[8px] !overflow-hidden !p-[0] !cursor-pointer" key={i} type="button" onClick={() => handleSelectSuggestion(photo)}
                  title={photo.attribution}
                  style={{ border: '2px solid transparent' }}>
                  <img className="!w-[100%] !h-[100%] !object-cover" src={photo.thumb} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            {t('dashboard.tripTitle')} <span className="text-red-500">*</span>
          </label>
          <input type="text" value={formData.title} onChange={e => canEditTrip && update('title', e.target.value)}
            required readOnly={!canEditTrip} placeholder={t('dashboard.tripTitlePlaceholder')} className={inputCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('dashboard.tripDescription')}</label>
          <textarea value={formData.description} onChange={e => canEditTrip && update('description', e.target.value)}
            readOnly={!canEditTrip} placeholder={t('dashboard.tripDescriptionPlaceholder')} rows={3}
            className={`${inputCls} resize-none`} />
        </div>

        {/* ── Tipo de viaje ──────────────────────────────────────────── */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Tipo de viaje
          </label>
          <div className="!flex !gap-[8px]">
            {[
              { value: 'general', label: '🌍 General', desc: 'Viaje estándar' },
              { value: 'cycling', label: '🚴 Bicicleta', desc: 'GPX + Elevación + IBP' },
              { value: 'trekking', label: '🥾 Trekking', desc: 'GPX + Elevación + IBP' },
            ].map(opt => (
              <button className="!flex-[1] !p-[10px_12px] !rounded-[10px] !text-left ![font-family:inherit]" key={opt.value} type="button"
                onClick={() => canEditTrip && update('trip_type', opt.value)}
                style={{ cursor: canEditTrip ? 'pointer' : 'default', border: (formData as any).trip_type === opt.value
                    ? '2px solid #3b82f6'
                    : '1.5px solid #e2e8f0', background: (formData as any).trip_type === opt.value ? '#eff6ff' : '#f8fafc' }}
              >
                <div className="!text-[length:13px] !font-[600] ![color:#1e293b] !mb-[2px]">{opt.label}</div>
                <div className="!text-[length:11px] ![color:#94a3b8]">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {canMakePublic && (
          <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer" data-testid="trip-public-toggle">
            <input type="checkbox" checked={formData.is_public} onChange={e => update('is_public', e.target.checked)} className="mt-1 w-4 h-4 accent-black" />
            <span>
              <span className="block text-sm font-medium text-slate-800">{t('trip.public.label')}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{t('trip.public.hint')}</span>
            </span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <Calendar className="inline w-4 h-4 mr-1" />{t('dashboard.startDate')}
            </label>
            <CustomDatePicker value={formData.start_date} onChange={v => update('start_date', v)} placeholder={t('dashboard.startDate')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <Calendar className="inline w-4 h-4 mr-1" />{t('dashboard.endDate')}
            </label>
            <CustomDatePicker value={formData.end_date} onChange={v => update('end_date', v)} placeholder={t('dashboard.endDate')} />
          </div>
        </div>

        {!formData.start_date && !formData.end_date && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              {t('dashboard.dayCount')}
            </label>
            <input type="number" min={1} max={365} value={formData.day_count}
              onChange={e => update('day_count', Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              className={inputCls} />
            <p className="text-xs text-slate-400 mt-1.5">{t('dashboard.dayCountHint')}</p>
          </div>
        )}

        {/* Reminder — only visible to owner (or when creating) */}
        {(!isEditing || trip?.user_id === currentUser?.id || currentUser?.role === 'admin') && (
        <div className={!tripRemindersEnabled ? 'opacity-50' : ''}>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            <Bell className="inline w-4 h-4 mr-1" />{t('trips.reminder')}
          </label>
          {!tripRemindersEnabled ? (
            <p className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
              {t('trips.reminderDisabledHint')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 0, label: t('trips.reminderNone') },
                  { value: 1, label: `1 ${t('trips.reminderDay')}` },
                  { value: 3, label: `3 ${t('trips.reminderDays')}` },
                  { value: 9, label: `9 ${t('trips.reminderDays')}` },
                ].map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => { update('reminder_days', opt.value); setCustomReminder(false) }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      !customReminder && formData.reminder_days === opt.value
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}>
                    {opt.label}
                  </button>
                ))}
                <button type="button"
                  onClick={() => { setCustomReminder(true); if ([0, 1, 3, 9].includes(formData.reminder_days)) update('reminder_days', 7) }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    customReminder
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}>
                  {t('trips.reminderCustom')}
                </button>
              </div>
              {customReminder && (
                <div className="flex items-center gap-2 mt-2">
                  <input type="number" min={1} max={30}
                    value={formData.reminder_days}
                    onChange={e => update('reminder_days', Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                    className="w-20 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300" />
                  <span className="text-xs text-slate-500">{t('trips.reminderDaysBefore')}</span>
                </div>
              )}
            </>
          )}
        </div>
        )}

        {/* Members */}
        {allUsers.filter(u => u.id !== currentUser?.id).length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <UserPlus className="inline w-4 h-4 mr-1" />{isEditing ? t('dashboard.addMembers') : t('dashboard.addMembers')}
            </label>
            {/* Existing members (editing mode) */}
            {isEditing && existingMembers.length > 0 && (
              <div className="!flex !flex-wrap !gap-[6px] !mb-[8px]">
                {existingMembers.map(m => (
                  <span className="!flex !items-center !gap-[5px] !p-[4px_10px] !rounded-[99px] !text-[length:12px] !font-[500] ![color:var(--text-primary)]" key={m.id}
                    onClick={async () => {
                      if (m.id === currentUser?.id) return
                      try {
                        await tripsApi.removeMember(trip!.id, m.id)
                        setExistingMembers(prev => prev.filter(x => x.id !== m.id))
                        toast.success(t('trips.memberRemoved', { username: m.username }))
                      } catch { toast.error(t('trips.memberRemoveError')) }
                    }}
                    style={{ background: 'var(--bg-secondary)', cursor: m.id === currentUser?.id ? 'default' : 'pointer', border: '1px solid var(--border-primary)' }}>
                    {m.username}
                    {m.id !== currentUser?.id && <X size={11} style={{ color: 'var(--text-faint)' }} />}
                  </span>
                ))}
              </div>
            )}
            {/* Newly selected members (both modes) */}
            {selectedMembers.length > 0 && (
              <div className="!flex !flex-wrap !gap-[6px] !mb-[8px]">
                {selectedMembers.map(uid => {
                  const user = allUsers.find(u => u.id === uid)
                  if (!user) return null
                  return (
                    <span className="!flex !items-center !gap-[5px] !p-[4px_10px] !rounded-[99px] !text-[length:12px] !font-[500] ![color:var(--text-primary)] !cursor-pointer" key={uid} onClick={() => setSelectedMembers(prev => prev.filter(id => id !== uid))}
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
                      {user.username}
                      <X size={11} style={{ color: 'var(--text-faint)' }} />
                    </span>
                  )
                })}
              </div>
            )}
            <div className="!flex !gap-[8px]">
              <CustomSelect
                value={memberSelectValue}
                onChange={async value => {
                  if (!value) return
                  if (isEditing && trip?.id) {
                    const user = allUsers.find(u => u.id === Number(value))
                    if (user) {
                      try {
                        await tripsApi.addMember(trip.id, user.username)
                        setExistingMembers(prev => [...prev, { id: user.id, username: user.username }])
                        toast.success(t('trips.memberAdded', { username: user.username }))
                      } catch { toast.error(t('trips.memberAddError')) }
                    }
                  } else {
                    setSelectedMembers(prev => prev.includes(Number(value)) ? prev : [...prev, Number(value)])
                  }
                  setMemberSelectValue('')
                }}
                placeholder={t('dashboard.addMember')}
                options={allUsers.filter(u => u.id !== currentUser?.id && !selectedMembers.includes(u.id) && !existingMembers.some(m => m.id === u.id)).map(u => ({ value: u.id, label: u.username }))}
                searchable
                size="sm"
              />
            </div>
          </div>
        )}

      </form>
    </Modal>
  )
}
