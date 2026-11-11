import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { openFile } from '../../utils/fileDownload'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { X, Clock, MapPin, ExternalLink, Phone, Euro, Edit2, Trash2, Plus, Minus, ChevronDown, ChevronUp, FileText, Upload, File, FileImage, Star, Navigation, Users, Mountain, TrendingUp } from 'lucide-react'
import PlaceAvatar from '../shared/PlaceAvatar'
import PlaceAbout from './PlaceAbout'
import { mapsApi } from '../../api/client'
import { useSettingsStore } from '../../store/settingsStore'
import { getCategoryIcon } from '../shared/categoryIcons'
import { useTranslation } from '../../i18n'
import type { Place, Category, Day, Assignment, Reservation, TripFile, AssignmentsMap } from '../../types'
import { splitReservationDateTime } from '../../utils/formatters'
import { NAV_APPS, isNavAppId, navAppName, navUrl } from '../../utils/navApps'
import { useContextMenu, ContextMenu } from '../shared/ContextMenu'

const detailsCache = new Map()

function getSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch { return undefined }
}

function setSessionCache(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function usePlaceDetails(googlePlaceId, osmId, language) {
  const [details, setDetails] = useState(null)
  const detailId = googlePlaceId || osmId
  const cacheKey = `gdetails_${detailId}_${language}`
  useEffect(() => {
    if (!detailId) { setDetails(null); return }
    if (detailsCache.has(cacheKey)) { setDetails(detailsCache.get(cacheKey)); return }
    const cached = getSessionCache(cacheKey)
    if (cached) { detailsCache.set(cacheKey, cached); setDetails(cached); return }
    mapsApi.details(detailId, language).then(data => {
      detailsCache.set(cacheKey, data.place)
      setSessionCache(cacheKey, data.place)
      setDetails(data.place)
    }).catch(() => {})
  }, [detailId, language])
  return details
}

function getWeekdayIndex(dateStr) {
  // weekdayDescriptions[0] = Monday … [6] = Sunday
  const d = dateStr ? new Date(dateStr + 'T12:00:00') : new Date()
  const jsDay = d.getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

function convertHoursLine(line, timeFormat) {
  if (!line) return ''
  const hasAmPm = /\d{1,2}:\d{2}\s*(AM|PM)/i.test(line)

  if (timeFormat === '12h' && !hasAmPm) {
    // 24h → 12h: "10:00" → "10:00 AM", "21:00" → "9:00 PM", "Uhr" entfernen
    return line.replace(/\s*Uhr/g, '').replace(/(\d{1,2}):(\d{2})/g, (match, h, m) => {
      const hour = parseInt(h)
      if (isNaN(hour)) return match
      const period = hour >= 12 ? 'PM' : 'AM'
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      return `${h12}:${m} ${period}`
    })
  }
  if (timeFormat !== '12h' && hasAmPm) {
    // 12h → 24h: "10:00 AM" → "10:00", "9:00 PM" → "21:00"
    return line.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi, (_, h, m, p) => {
      let hour = parseInt(h)
      if (p.toUpperCase() === 'PM' && hour !== 12) hour += 12
      if (p.toUpperCase() === 'AM' && hour === 12) hour = 0
      return `${String(hour).padStart(2, '0')}:${m}`
    })
  }
  return line
}

function formatTime(timeStr, locale, timeFormat) {
  if (!timeStr) return ''
  try {
    const parts = timeStr.split(':')
    const h = Number(parts[0]) || 0
    const m = Number(parts[1]) || 0
    if (isNaN(h)) return timeStr
    if (timeFormat === '12h') {
      const period = h >= 12 ? 'PM' : 'AM'
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
      return `${h12}:${String(m).padStart(2, '0')} ${period}`
    }
    const str = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    return locale?.startsWith('de') ? `${str} Uhr` : str
  } catch { return timeStr }
}


function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface TripMember {
  id: number
  username: string
  avatar_url?: string | null
  /** Older endpoints send the avatar file name under this key. */
  avatar?: string | null
}

interface PlaceInspectorProps {
  place: Place | null
  categories: Category[]
  days: Day[]
  selectedDayId: number | null
  selectedAssignmentId: number | null
  assignments: AssignmentsMap
  reservations?: Reservation[]
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  /** Without a day, the selected day is used. */
  onAssignToDay: (placeId: number, dayId?: number) => void
  onRemoveAssignment: (assignmentId: number, dayId: number) => void
  files: TripFile[]
  onFileUpload?: (fd: FormData) => Promise<unknown>
  tripMembers?: TripMember[]
  onSetParticipants: (assignmentId: number, dayId: number, participantIds: number[]) => void
  onUpdatePlace: (placeId: number, data: Partial<Place>) => void
  leftWidth?: number
  rightWidth?: number
}

export default function PlaceInspector({
  place, categories, days, selectedDayId, selectedAssignmentId, assignments, reservations = [],
  onClose, onEdit, onDelete, onAssignToDay, onRemoveAssignment,
  files, onFileUpload, tripMembers = [], onSetParticipants, onUpdatePlace,
  leftWidth = 0, rightWidth = 0,
}: PlaceInspectorProps) {
  const { t, locale, language } = useTranslation()
  const preferredNav = useSettingsStore(s => s.settings.preferred_nav_app)
  const navMenu = useContextMenu()
  const timeFormat = useSettingsStore(s => s.settings.time_format) || '24h'
  const [hoursExpanded, setHoursExpanded] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const googleDetails = usePlaceDetails(place?.google_place_id, place?.osm_id, language)

  const startNameEdit = () => {
    if (!onUpdatePlace) return
    setNameValue(place.name || '')
    setEditingName(true)
    setTimeout(() => nameInputRef.current?.focus(), 0)
  }

  const commitNameEdit = () => {
    if (!editingName) return
    const trimmed = nameValue.trim()
    setEditingName(false)
    if (!trimmed || trimmed === place.name) return
    onUpdatePlace(place.id, { name: trimmed })
  }

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitNameEdit() }
    if (e.key === 'Escape') setEditingName(false)
  }

  if (!place) return null

  const category = categories?.find(c => c.id === place.category_id)
  const dayAssignments = selectedDayId ? (assignments[String(selectedDayId)] || []) : []
  const assignmentInDay = selectedDayId
    ? ((selectedAssignmentId ? dayAssignments.find(a => a.id === selectedAssignmentId) : null)
      ?? dayAssignments.find(a => a.place?.id === place.id))
    : null

  const openingHours = googleDetails?.opening_hours || null
  const openNow = googleDetails?.open_now ?? null
  const selectedDay = days?.find(d => d.id === selectedDayId)
  const weekdayIndex = getWeekdayIndex(selectedDay?.date)

  const placeFiles = (files || []).filter(f => String(f.place_id) === String(place.id) || (f.linked_place_ids || []).includes(place.id))

  const handleFileUpload = useCallback(async (e) => {
    const selectedFiles = Array.from((e.target as HTMLInputElement).files || [])
    if (!selectedFiles.length || !onFileUpload) return
    setIsUploading(true)
    try {
      for (const file of selectedFiles) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('place_id', String(place.id))
        await onFileUpload(fd)
      }
      setFilesExpanded(true)
    } catch (err: unknown) {
      console.error('Upload failed', err)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [onFileUpload, place.id])

  return (
    <div className="!absolute !z-[50]"
      style={{ bottom: 20, left: `calc(${leftWidth}px + (100% - ${leftWidth}px - ${rightWidth}px) / 2)`, transform: 'translateX(-50%)', width: `min(800px, calc(100% - ${leftWidth}px - ${rightWidth}px - 32px))`, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
    >
      <div className="![backdrop-filter:blur(40px)_saturate(180%)] ![-webkit-backdrop-filter:blur(40px)_saturate(180%)] !rounded-[20px] ![box-shadow:0_8px_40px_rgba(0,0,0,0.14),_0_0_0_1px_rgba(0,0,0,0.06)] !overflow-hidden !max-h-[60vh] !flex !flex-col" style={{ background: 'var(--bg-elevated)' }}>
        {/* Header */}
        <div className="!flex !items-center ![border-bottom:1px_solid_var(--border-faint)]" style={{ gap: openNow !== null ? 26 : 14, padding: openNow !== null ? '18px 16px 14px 28px' : '18px 16px 14px' }}>
          {/* Avatar with open/closed ring + tag */}
          <div className="!relative !shrink-[0]" style={{ marginBottom: openNow !== null ? 8 : 0 }}>
            <div className="!rounded-[50%] !p-[2.5px]" style={{ background: openNow === true ? '#22c55e' : openNow === false ? '#ef4444' : 'transparent' }}>
              <PlaceAvatar place={place} category={category} size={52} />
            </div>
            {openNow !== null && (
              <span className="!absolute !bottom-[-7px] !left-[50%] !text-[length:9px] !font-[500] !tracking-[0.02em] ![color:white] !p-[1.5px_7px] !rounded-[99px] !whitespace-nowrap ![box-shadow:0_1px_4px_rgba(0,0,0,0.2)]" style={{ transform: 'translateX(-50%)', background: openNow ? '#16a34a' : '#dc2626' }}>
                {openNow ? t('inspector.opened') : t('inspector.closed')}
              </span>
            )}
          </div>
          <div className="!flex-[1] !min-w-[0]">
            <div className="!flex !items-center !gap-[6px] !flex-wrap">
              {editingName ? (
                <input
                  ref={nameInputRef}
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  onBlur={commitNameEdit}
                  onKeyDown={handleNameKeyDown}
                  style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', lineHeight: '1.3', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 6, padding: '1px 6px', fontFamily: 'inherit', outline: 'none', width: '100%' }}
                />
              ) : (
                <span className="!font-[600] !text-[length:15px] ![color:var(--text-primary)] !leading-[1.3]"
                  onDoubleClick={startNameEdit}
                  style={{ cursor: onUpdatePlace ? 'text' : 'default' }}
                >{place.name}</span>
              )}
              {category && (() => {
                const CatIcon = getCategoryIcon(category.icon)
                return (
                  <span className="!inline-flex !items-center !gap-[4px] !text-[length:11px] !font-[500] !p-[2px_8px] !rounded-[99px]" style={{ color: category.color || '#6b7280', background: category.color ? `${category.color}18` : 'rgba(0,0,0,0.06)', border: `1px solid ${category.color ? `${category.color}30` : 'transparent'}` }}>
                    <CatIcon size={10} />
                    <span className="hidden sm:inline">{category.name}</span>
                  </span>
                )
              })()}
            </div>
            {place.address && (
              <div className="!flex !items-start !gap-[4px] !mt-[6px]">
                <MapPin size={11} color="var(--text-faint)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span className="!text-[length:12px] ![color:var(--text-muted)] !leading-[1.4] ![display:-webkit-box] ![-webkit-line-clamp:2px] ![-webkit-box-orient:vertical] !overflow-hidden">{place.address}</span>
              </div>
            )}
            {place.place_time && (
              <div className="!flex !items-center !gap-[4px] !mt-[3px]">
                <Clock size={10} color="var(--text-faint)" style={{ flexShrink: 0 }} />
                <span className="!text-[length:12px] ![color:var(--text-muted)]">{formatTime(place.place_time, locale, timeFormat)}{place.end_time ? ` – ${formatTime(place.end_time, locale, timeFormat)}` : ''}</span>
              </div>
            )}
            {place.lat && place.lng && (
              <div className="hidden sm:block !text-[length:11px] ![color:var(--text-faint)] !mt-[4px] ![font-variant-numeric:tabular-nums]">
                {Number(place.lat).toFixed(6)}, {Number(place.lng).toFixed(6)}
              </div>
            )}
          </div>
          <button className="trek-hover-tertiary !w-[28px] !h-[28px] !rounded-[50%] ![border:none] !flex !items-center !justify-center !cursor-pointer !shrink-[0] !self-start ![transition:background_0.15s]"
            onClick={onClose}
            style={{ background: 'var(--bg-hover)' }} >
            <X size={14} strokeWidth={2} color="var(--text-secondary)" />
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="!overflow-y-auto !p-[12px_16px] !flex !flex-col !gap-[10px]">

          {/* Info-Chips — hidden on mobile, shown on desktop */}
          <div className="hidden sm:flex !flex-wrap !gap-[6px] !items-center">
            {googleDetails?.rating && (() => {
              const shortReview = (googleDetails.reviews || []).find(r => r.text && r.text.length > 5)
              return (
                <Chip
                  icon={<Star size={12} fill="#facc15" color="#facc15" />}
                  text={<>
                    {googleDetails.rating.toFixed(1)}
                    {googleDetails.rating_count ? <span style={{ opacity: 0.5 }}> ({googleDetails.rating_count.toLocaleString(locale)})</span> : ''}
                    {shortReview && <span className="hidden md:inline !font-[400] !italic !overflow-hidden !text-ellipsis !whitespace-nowrap" style={{ opacity: 0.6 }}> · „{shortReview.text}"</span>}
                  </>}
                  color="var(--text-secondary)" bg="var(--bg-hover)"
                />
              )
            })()}
            {Number(place.price) > 0 && (
              <Chip icon={<Euro size={12} />} text={`${place.price} ${place.currency || '€'}`} color="#059669" bg="#ecfdf5" />
            )}
          </div>

          {/* Telefon */}
          {(place.phone || googleDetails?.phone) && (
            <div className="!flex !gap-[12px]">
              <a className="!inline-flex !items-center !gap-[4px] !text-[length:12px] ![color:var(--text-primary)] ![text-decoration:none]" href={`tel:${place.phone || googleDetails.phone}`}>
                <Phone size={12} /> {place.phone || googleDetails.phone}
              </a>
            </div>
          )}

          {/* Description / Summary */}
          {(place.description || googleDetails?.summary) && (
            <div className="collab-note-md !rounded-[10px] !overflow-hidden !text-[length:12px] ![color:var(--text-muted)] !leading-[1.5] !p-[8px_12px]" style={{ background: 'var(--bg-hover)' }}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{place.description || googleDetails?.summary || ''}</Markdown>
            </div>
          )}

          {/* Notes */}
          {place.notes && (
            <div className="collab-note-md !rounded-[10px] !overflow-hidden !text-[length:12px] ![color:var(--text-muted)] !leading-[1.5] !p-[8px_12px] !break-words ![overflow-wrap:anywhere]" style={{ background: 'var(--bg-hover)' }}>
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{place.notes}</Markdown>
            </div>
          )}

          {/* About this place — Wikipedia / Wikidata / Commons */}
          <PlaceAbout
            place={place}
            categoryName={categories.find(c => c.id === place.category_id)?.name ?? null}
            language={language}
            locale={locale}
            t={t}
          />

          {/* Reservation + Participants — side by side */}
          {(() => {
            const res = selectedAssignmentId ? reservations.find(r => r.assignment_id === selectedAssignmentId) : null
            const assignment = selectedAssignmentId ? (assignments[String(selectedDayId)] || []).find(a => a.id === selectedAssignmentId) : null
            const currentParticipants = assignment?.participants || []
            const participantIds = currentParticipants.map(p => p.user_id)
            const allJoined = currentParticipants.length === 0
            const showParticipants = selectedAssignmentId && tripMembers.length > 1
            if (!res && !showParticipants) return null
            return (
              <div className={`grid ${res && showParticipants ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-2`}>
                {/* Reservation */}
                {res && (() => {
                  const confirmed = res.status === 'confirmed'
                  return (
                    <div className="!rounded-[12px] !overflow-hidden" style={{ border: `1px solid ${confirmed ? 'rgba(22,163,74,0.2)' : 'rgba(217,119,6,0.2)'}` }}>
                      <div className="!flex !items-center !gap-[8px] !p-[6px_10px]" style={{ background: confirmed ? 'rgba(22,163,74,0.08)' : 'rgba(217,119,6,0.08)' }}>
                        <div className="!w-[6px] !h-[6px] !rounded-[50%] !shrink-[0]" style={{ background: confirmed ? '#16a34a' : '#d97706' }} />
                        <span className="!text-[length:10px] !font-[700]" style={{ color: confirmed ? '#16a34a' : '#d97706' }}>{confirmed ? t('reservations.confirmed') : t('reservations.pending')}</span>
                        <span className="!flex-[1]" />
                        <span className="!text-[length:11px] !font-[600] ![color:var(--text-primary)] !overflow-hidden !text-ellipsis !whitespace-nowrap">{res.title}</span>
                      </div>
                      <div className="!p-[6px_10px] !flex !gap-[12px] !flex-wrap">
                        {(() => {
                          const { date, time: startTime } = splitReservationDateTime(res.reservation_time)
                          const { time: endTime } = splitReservationDateTime(res.reservation_end_time)
                          return (
                            <>
                              {date && (
                                <div>
                                  <div className="!text-[length:8px] !font-[600] ![color:var(--text-faint)] !uppercase">{t('reservations.date')}</div>
                                  <div className="!text-[length:10px] !font-[500] ![color:var(--text-primary)] !mt-[1px]">{new Date(date + 'T00:00:00Z').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
                                </div>
                              )}
                              {(startTime || endTime) && (
                                <div>
                                  <div className="!text-[length:8px] !font-[600] ![color:var(--text-faint)] !uppercase">{t('reservations.time')}</div>
                                  <div className="!text-[length:10px] !font-[500] ![color:var(--text-primary)] !mt-[1px]">
                                    {startTime ? formatTime(startTime, locale, timeFormat) : ''}
                                    {endTime ? ` – ${formatTime(endTime, locale, timeFormat)}` : ''}
                                  </div>
                                </div>
                              )}
                            </>
                          )
                        })()}
                        {res.confirmation_number && (
                          <div>
                            <div className="!text-[length:8px] !font-[600] ![color:var(--text-faint)] !uppercase">{t('reservations.confirmationCode')}</div>
                            <div className="!text-[length:10px] !font-[500] ![color:var(--text-primary)] !mt-[1px]">{res.confirmation_number}</div>
                          </div>
                        )}
                      </div>
                      {res.notes && <div className="collab-note-md !p-[0_10px_6px] !text-[length:10px] ![color:var(--text-faint)] !leading-[1.4] !break-words ![overflow-wrap:anywhere]"><Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{res.notes}</Markdown></div>}
                      {(() => {
                        const meta = typeof res.metadata === 'string' ? JSON.parse(res.metadata || '{}') : (res.metadata || {})
                        if (!meta || Object.keys(meta).length === 0) return null
                        const parts: string[] = []
                        if (meta.airline && meta.flight_number) parts.push(`${meta.airline} ${meta.flight_number}`)
                        else if (meta.flight_number) parts.push(meta.flight_number)
                        if (meta.departure_airport && meta.arrival_airport) parts.push(`${meta.departure_airport} → ${meta.arrival_airport}`)
                        if (meta.train_number) parts.push(meta.train_number)
                        if (meta.platform) parts.push(`Gl. ${meta.platform}`)
                        if (meta.check_in_time) parts.push(`Check-in ${meta.check_in_time}`)
                        if (meta.check_out_time) parts.push(`Check-out ${meta.check_out_time}`)
                        if (parts.length === 0) return null
                        return <div className="!p-[0_10px_6px] !text-[length:10px] ![color:var(--text-muted)] !font-[500]">{parts.join(' · ')}</div>
                      })()}
                    </div>
                  )
                })()}

                {/* Participants */}
                {showParticipants && (
                  <ParticipantsBox
                    tripMembers={tripMembers}
                    participantIds={participantIds}
                    allJoined={allJoined}
                    onSetParticipants={onSetParticipants}
                    selectedAssignmentId={selectedAssignmentId}
                    selectedDayId={selectedDayId}
                    t={t}
                  />
                )}
              </div>
            )
          })()}

          {/* Opening hours + Files — side by side on desktop only if both exist */}
          <div className={`grid grid-cols-1 ${openingHours?.length > 0 ? 'sm:grid-cols-2' : ''} gap-2`}>
          {openingHours && openingHours.length > 0 && (
            <div className="!rounded-[10px] !overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
              <button className="!w-[100%] !flex !items-center !justify-between !p-[8px_12px] ![border:none] !cursor-pointer ![font-family:inherit]"
                onClick={() => setHoursExpanded(h => !h)}
                style={{ background: 'none' }}
              >
                <div className="!flex !items-center !gap-[6px]">
                  <Clock size={13} color="#9ca3af" />
                  <span className="!text-[length:12px] ![color:var(--text-secondary)] !font-[500]">
                    {hoursExpanded ? t('inspector.openingHours') : (convertHoursLine(openingHours[weekdayIndex] || '', timeFormat) || t('inspector.showHours'))}
                  </span>
                </div>
                {hoursExpanded ? <ChevronUp size={13} color="#9ca3af" /> : <ChevronDown size={13} color="#9ca3af" />}
              </button>
              {hoursExpanded && (
                <div className="!p-[0_12px_10px]">
                  {openingHours.map((line, i) => (
                    <div className={['!p-[2px_0]', (i === weekdayIndex) ? '![color:var(--text-primary)]' : '![color:var(--text-muted)]', (i === weekdayIndex) ? '!font-[600]' : '!font-[400]', '!text-[length:12px]'].join(' ')} key={i}>{convertHoursLine(line, timeFormat)}</div>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* GPX Track stats */}
          {place.route_geometry && (() => {
            try {
              const pts: number[][] = JSON.parse(place.route_geometry)
              if (!pts || pts.length < 2) return null
              const hasEle = pts[0].length >= 3

              // Haversine distance
              const toRad = (d: number) => d * Math.PI / 180
              let totalDist = 0
              for (let i = 1; i < pts.length; i++) {
                const [lat1, lng1] = pts[i - 1], [lat2, lng2] = pts[i]
                const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
                const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
                totalDist += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
              }
              const distKm = totalDist / 1000

              // Elevation stats
              let minEle = Infinity, maxEle = -Infinity, totalUp = 0, totalDown = 0
              if (hasEle) {
                for (let i = 0; i < pts.length; i++) {
                  const e = pts[i][2]
                  if (e < minEle) minEle = e
                  if (e > maxEle) maxEle = e
                  if (i > 0) {
                    const diff = e - pts[i - 1][2]
                    if (diff > 0) totalUp += diff; else totalDown += Math.abs(diff)
                  }
                }
              }

              // Elevation profile SVG
              const chartW = 280, chartH = 60
              const elevations = hasEle ? pts.map(p => p[2]) : []
              let pathD = ''
              if (elevations.length > 1) {
                const step = Math.max(1, Math.floor(elevations.length / chartW))
                const sampled = elevations.filter((_, i) => i % step === 0)
                const eMin = Math.min(...sampled), eMax = Math.max(...sampled)
                const range = eMax - eMin || 1
                pathD = sampled.map((e, i) => {
                  const x = (i / (sampled.length - 1)) * chartW
                  const y = chartH - ((e - eMin) / range) * (chartH - 4) - 2
                  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
                }).join(' ')
              }

              return (
                <div className="!rounded-[10px] !p-[10px_12px] !flex !flex-col !gap-[8px]" style={{ background: 'var(--bg-hover)' }}>
                  <div className="!flex !items-center !gap-[6px]">
                    <TrendingUp size={13} color="#9ca3af" />
                    <span className="!text-[length:12px] ![color:var(--text-secondary)] !font-[500]">{t('inspector.trackStats')}</span>
                  </div>
                  <div className="!flex !flex-wrap !gap-[8px]">
                    <div className="!flex !items-center !gap-[4px] !text-[length:12px] ![color:var(--text-primary)] !font-[600]">
                      <MapPin size={12} color="#3b82f6" />
                      {distKm < 1 ? `${Math.round(totalDist)} m` : `${distKm.toFixed(1)} km`}
                    </div>
                    {hasEle && (
                      <>
                        <div className="!flex !items-center !gap-[4px] !text-[length:12px] ![color:var(--text-primary)] !font-[600]">
                          <Mountain size={12} color="#22c55e" />
                          {Math.round(maxEle)} m
                        </div>
                        <div className="!flex !items-center !gap-[4px] !text-[length:12px] ![color:var(--text-primary)] !font-[600]">
                          <Mountain size={12} color="#ef4444" />
                          {Math.round(minEle)} m
                        </div>
                        <div className="!text-[length:12px] ![color:var(--text-muted)]">
                          ↑{Math.round(totalUp)} m &nbsp;↓{Math.round(totalDown)} m
                        </div>
                      </>
                    )}
                  </div>
                  {pathD && (
                    <svg className="!block !rounded-[6px]" width="100%" viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" style={{ background: 'var(--bg-tertiary)' }}>
                      <defs>
                        <linearGradient id={`ele-grad-${place.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <path d={`${pathD} L${chartW},${chartH} L0,${chartH} Z`} fill={`url(#ele-grad-${place.id})`} />
                      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    </svg>
                  )}
                </div>
              )
            } catch { return null }
          })()}

          {/* Files section */}
          {(placeFiles.length > 0 || onFileUpload) && (
            <div className="!rounded-[10px] !overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
              <div className="!flex !items-center !p-[8px_12px] !gap-[6px]">
                <button className="!flex-[1] !flex !items-center !gap-[6px] ![border:none] !cursor-pointer !p-[0] ![font-family:inherit] !text-left"
                  onClick={() => setFilesExpanded(f => !f)}
                  style={{ background: 'none' }}
                >
                  <FileText size={13} color="#9ca3af" />
                  <span className="!text-[length:12px] ![color:var(--text-secondary)] !font-[500]">
                    {placeFiles.length > 0 ? t('inspector.filesCount', { count: placeFiles.length }) : t('inspector.files')}
                  </span>
                  {filesExpanded ? <ChevronUp size={12} color="#9ca3af" /> : <ChevronDown size={12} color="#9ca3af" />}
                </button>
                {onFileUpload && (
                  <label className="!cursor-pointer !flex !items-center !gap-[4px] !text-[length:11px] ![color:var(--text-muted)] !p-[2px_6px] !rounded-[6px]" style={{ background: 'var(--bg-tertiary)' }}>
                    <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload} />
                    {isUploading ? (
                      <span className="!text-[length:11px]">…</span>
                    ) : (
                      <><Upload size={11} strokeWidth={2} /> {t('common.upload')}</>
                    )}
                  </label>
                )}
              </div>
              {filesExpanded && placeFiles.length > 0 && (
                <div className="!p-[0_12px_10px] !flex !flex-col !gap-[4px]">
                  {placeFiles.map(f => (
                    <button className="!flex !items-center !gap-[8px] ![text-decoration:none] !cursor-pointer ![border:none] !w-[100%] !text-left" key={f.id} onClick={() => openFile(f.url).catch(() => {})} style={{ background: 'none' }}>
                      {(f.mime_type || '').startsWith('image/') ? <FileImage size={12} color="#6b7280" /> : <File size={12} color="#6b7280" />}
                      <span className="!text-[length:12px] ![color:var(--text-secondary)] !flex-[1] !overflow-hidden !text-ellipsis !whitespace-nowrap">{f.original_name}</span>
                      {f.file_size && <span className="!text-[length:11px] ![color:var(--text-faint)] !shrink-[0]">{formatFileSize(f.file_size)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>

        </div>

        {/* Footer actions */}
        <div className="!p-[10px_16px] ![border-top:1px_solid_var(--border-faint)] !flex !gap-[6px] !items-center !flex-wrap">
          {selectedDayId && (
            assignmentInDay ? (
              <ActionButton onClick={() => onRemoveAssignment(selectedDayId, assignmentInDay.id)} variant="ghost" icon={<Minus size={13} />}
                label={<><span className="hidden sm:inline">{t('inspector.removeFromDay')}</span><span className="sm:hidden">{t('inspector.remove')}</span></>} />
            ) : (
              <ActionButton onClick={() => onAssignToDay(place.id)} variant="primary" icon={<Plus size={13} />} label={t('inspector.addToDay')} />
            )
          )}
          {googleDetails?.google_maps_url && (
            <ActionButton onClick={() => window.open(googleDetails.google_maps_url, '_blank')} variant="ghost" icon={<Navigation size={13} />}
              label={<span className="hidden sm:inline">{t('inspector.google')}</span>} />
          )}
          {!googleDetails?.google_maps_url && place.lat && place.lng && (
            <ActionButton
              onClick={(e: React.MouseEvent) => {
                // A preferred map app opens straight away; without one, every app is offered (TREK v5).
                if (isNavAppId(preferredNav)) { const url = navUrl(preferredNav, place); if (url) window.open(url, '_blank'); return }
                navMenu.open(e, NAV_APPS.map(app => ({ label: app.name, icon: Navigation, onClick: () => { const url = navUrl(app.id, place); if (url) window.open(url, '_blank') } })))
              }}
              variant="ghost" icon={<Navigation size={13} />}
              label={<span className="hidden sm:inline">{navAppName(preferredNav) ?? t('inspector.openWith')}</span>} />
          )}
          {(place.website || googleDetails?.website) && (
            <ActionButton onClick={() => window.open(place.website || googleDetails?.website, '_blank')} variant="ghost" icon={<ExternalLink size={13} />}
              label={<span className="hidden sm:inline">{t('inspector.website')}</span>} />
          )}
          <div className="!flex-[1]" />
          <ActionButton onClick={onEdit} variant="ghost" icon={<Edit2 size={13} />} label={<span className="hidden sm:inline">{t('common.edit')}</span>} />
          <ActionButton onClick={onDelete} variant="danger" icon={<Trash2 size={13} />} label={<span className="hidden sm:inline">{t('common.delete')}</span>} />
        </div>
        <ContextMenu menu={navMenu.menu} onClose={navMenu.close} />
      </div>
    </div>
  )
}

interface ChipProps {
  icon: React.ReactNode
  text: React.ReactNode
  color?: string
  bg?: string
}

function Chip({ icon, text, color = 'var(--text-secondary)', bg = 'var(--bg-hover)' }: ChipProps) {
  return (
    <div className="!flex !items-center !gap-[4px] !p-[3px_9px] !rounded-[99px] !text-[length:12px] !overflow-hidden !text-ellipsis !whitespace-nowrap !min-w-[0]" style={{ background: bg, color }}>
      <span className="!shrink-[0] !flex">{icon}</span>
      <span className="!overflow-hidden !text-ellipsis !whitespace-nowrap">{text}</span>
    </div>
  )
}

interface RowProps {
  icon: React.ReactNode
  children: React.ReactNode
}

function Row({ icon, children }: RowProps) {
  return (
    <div className="!flex !items-center !gap-[8px]">
      <div className="!shrink-[0]">{icon}</div>
      <div className="!flex-[1] !min-w-[0]">{children}</div>
    </div>
  )
}

interface ActionButtonProps {
  onClick: (e: React.MouseEvent) => void
  variant: 'primary' | 'ghost' | 'danger'
  icon: React.ReactNode
  label: React.ReactNode
}

function ActionButton({ onClick, variant, icon, label }: ActionButtonProps) {
  const base = {
    primary: { background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', hoverBg: 'var(--text-secondary)' },
    ghost: { background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: 'none', hoverBg: 'var(--bg-tertiary)' },
    danger: { background: 'rgba(239,68,68,0.08)', color: '#dc2626', border: 'none', hoverBg: 'rgba(239,68,68,0.16)' },
  }
  const s = base[variant] || base.ghost
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 12px', borderRadius: 10, minHeight: 30,
        fontSize: 12, fontWeight: 500, cursor: 'pointer',
        fontFamily: 'inherit', transition: 'background 0.15s, opacity 0.15s',
        background: s.background, color: s.color, border: s.border,
      }}
      onMouseEnter={e => e.currentTarget.style.background = s.hoverBg}
      onMouseLeave={e => e.currentTarget.style.background = s.background}
    >
      {icon}{label}
    </button>
  )
}

interface ParticipantsBoxProps {
  tripMembers: TripMember[]
  participantIds: number[]
  allJoined: boolean
  onSetParticipants: (assignmentId: number, dayId: number, participantIds: number[]) => void
  selectedAssignmentId: number | null
  selectedDayId: number | null
  t: (key: string) => string
}

function ParticipantsBox({ tripMembers, participantIds, allJoined, onSetParticipants, selectedAssignmentId, selectedDayId, t }: ParticipantsBoxProps) {
  const [showAdd, setShowAdd] = React.useState(false)
  const [hoveredId, setHoveredId] = React.useState(null)

  // Active participants: if allJoined, show all members; otherwise show only those in participantIds
  const activeMembers = allJoined ? tripMembers : tripMembers.filter(m => participantIds.includes(m.id))
  const availableToAdd = allJoined ? [] : tripMembers.filter(m => !participantIds.includes(m.id))

  const handleRemove = (userId) => {
    if (!onSetParticipants) return
    let newIds
    if (allJoined) {
      newIds = tripMembers.filter(m => m.id !== userId).map(m => m.id)
    } else {
      newIds = participantIds.filter(id => id !== userId)
    }
    if (newIds.length === tripMembers.length) newIds = []
    onSetParticipants(selectedAssignmentId, selectedDayId, newIds)
  }

  const handleAdd = (userId) => {
    if (!onSetParticipants) return
    const newIds = [...participantIds, userId]
    if (newIds.length === tripMembers.length) {
      onSetParticipants(selectedAssignmentId, selectedDayId, [])
    } else {
      onSetParticipants(selectedAssignmentId, selectedDayId, newIds)
    }
    setShowAdd(false)
  }

  return (
    <div className="!rounded-[12px] ![border:1px_solid_var(--border-faint)] !p-[8px_10px]">
      <div className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.03em] !mb-[6px] !flex !items-center !gap-[4px]">
        <Users size={10} /> {t('inspector.participants')}
      </div>
      <div className="!flex !flex-wrap !gap-[4px] !items-center">
        {activeMembers.map(member => {
          const isHovered = hoveredId === member.id
          const canRemove = activeMembers.length > 1
          return (
            <div key={member.id}
              onMouseEnter={() => setHoveredId(member.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => { if (canRemove) handleRemove(member.id) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px 2px 3px', borderRadius: 99,
                border: `1.5px solid ${isHovered && canRemove ? 'rgba(239,68,68,0.4)' : 'var(--accent)'}`,
                background: isHovered && canRemove ? 'rgba(239,68,68,0.06)' : 'var(--bg-hover)',
                fontSize: 10, fontWeight: 500,
                color: isHovered && canRemove ? '#ef4444' : 'var(--text-primary)',
                cursor: canRemove ? 'pointer' : 'default',
                transition: 'all 0.15s',
              }}>
              <div className="!w-[16px] !h-[16px] !rounded-[50%] !flex !items-center !justify-center !text-[length:7px] !font-[700] ![color:var(--text-muted)] !overflow-hidden !shrink-[0]" style={{ background: 'var(--bg-tertiary)' }}>
                {(member.avatar_url || member.avatar) ? <img className="!w-[100%] !h-[100%] !object-cover" src={member.avatar_url || `/uploads/avatars/${member.avatar}`} /> : member.username?.[0]?.toUpperCase()}
              </div>
              <span style={{ textDecoration: isHovered && canRemove ? 'line-through' : 'none' }}>{member.username}</span>
            </div>
          )
        })}

        {/* Add button */}
        {availableToAdd.length > 0 && (
          <div className="!relative">
            <button className="trek-hover-border-muted trek-hover-text !w-[22px] !h-[22px] !rounded-[50%] ![border:1.5px_dashed_var(--border-primary)] !cursor-pointer !flex !items-center !justify-center ![color:var(--text-faint)] !text-[length:12px] ![transition:all_0.12s]" onClick={() => setShowAdd(!showAdd)} style={{ background: 'none' }} >+</button>

            {showAdd && (
              <div className="!absolute !top-[26px] !left-[0] !z-[100] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !min-w-[140px]" style={{ background: 'var(--bg-card)' }}>
                {availableToAdd.map(member => (
                  <button className="trek-hover !flex !items-center !gap-[6px] !w-[100%] !p-[5px_8px] !rounded-[6px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:11px] ![color:var(--text-primary)] !text-left ![transition:background_0.1s]" key={member.id} onClick={() => handleAdd(member.id)} style={{ background: 'none' }} >
                    <div className="!w-[18px] !h-[18px] !rounded-[50%] !flex !items-center !justify-center !text-[length:8px] !font-[700] ![color:var(--text-muted)] !overflow-hidden !shrink-[0]" style={{ background: 'var(--bg-tertiary)' }}>
                      {(member.avatar_url || member.avatar) ? <img className="!w-[100%] !h-[100%] !object-cover" src={member.avatar_url || `/uploads/avatars/${member.avatar}`} /> : member.username?.[0]?.toUpperCase()}
                    </div>
                    {member.username}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
