import React, { useMemo } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useTranslation } from '../../i18n'
import { MapPin, Clock, Calendar, Users, Sparkles } from 'lucide-react'

function formatTime(timeStr, is12h) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  if (is12h) {
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${String(m).padStart(2, '0')} ${period}`
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatDayLabel(date, t, locale) {
  const now = new Date()
  const nowDate = now.toISOString().split('T')[0]
  const tomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const tomorrowDate = tomorrowUtc.toISOString().split('T')[0]

  if (date === nowDate) return t('collab.whatsNext.today') || 'Today'
  if (date === tomorrowDate) return t('collab.whatsNext.tomorrow') || 'Tomorrow'

  return new Date(date + 'T00:00:00Z').toLocaleDateString(locale || undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

interface TripMember {
  id: number
  username: string
  avatar_url?: string | null
  avatar?: string | null
}

interface WhatsNextWidgetProps {
  tripMembers?: TripMember[]
}

export default function WhatsNextWidget({ tripMembers = [] }: WhatsNextWidgetProps) {
  const { days, assignments } = useTripStore()
  const { t, locale } = useTranslation()
  const is12h = useSettingsStore(s => s.settings.time_format) === '12h'

  const upcoming = useMemo(() => {
    const now = new Date()
    const nowDate = now.toISOString().split('T')[0]
    const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const items = []

    for (const day of (days || [])) {
      if (!day.date) continue
      const dayAssignments = assignments[String(day.id)] || []
      for (const a of dayAssignments) {
        if (!a.place) continue
        // Include: today (future times) + all future days
        const isFutureDay = day.date > nowDate
        const isTodayFuture = day.date === nowDate && (!a.place.place_time || a.place.place_time >= nowTime)
        if (isFutureDay || isTodayFuture) {
          items.push({
            id: a.id,
            name: a.place.name,
            time: a.place.place_time,
            endTime: a.place.end_time,
            date: day.date,
            dayTitle: day.title,
            category: a.place.category,
            participants: (a.participants && a.participants.length > 0)
              ? a.participants
              : tripMembers.map(m => ({ user_id: m.id, username: m.username, avatar: m.avatar })),
            address: a.place.address,
          })
        }
      }
    }

    items.sort((a, b) => {
      const da = a.date + (a.time || '99:99')
      const db = b.date + (b.time || '99:99')
      return da.localeCompare(db)
    })

    return items.slice(0, 8)
  }, [days, assignments, tripMembers])

  return (
    <div className="!flex !flex-col !h-[100%] !overflow-hidden">
      {/* Header */}
      <div className="!p-[10px_14px] !flex !items-center !gap-[7px] !shrink-[0]">
        <Sparkles size={14} color="var(--text-faint)" />
        <span className="!text-[length:12px] !font-[600] ![color:var(--text-muted)] !tracking-[0.3px] !uppercase">
          {t('collab.whatsNext.title') || "What's Next"}
        </span>
      </div>

      {/* List */}
      <div className="chat-scroll !flex-[1] !overflow-y-auto !p-[8px_10px]">
        {upcoming.length === 0 ? (
          <div className="!flex !flex-col !items-center !justify-center !h-[100%] !p-[48px_20px] !text-center">
            <Calendar size={36} color="var(--text-faint)" strokeWidth={1.3} style={{ marginBottom: 12 }} />
            <div className="!text-[length:14px] !font-[600] ![color:var(--text-secondary)] !mb-[4px]">{t('collab.whatsNext.empty')}</div>
            <div className="!text-[length:12px] ![color:var(--text-faint)]">{t('collab.whatsNext.emptyHint')}</div>
          </div>
        ) : (
          <div className="!flex !flex-col !gap-[6px]">
            {upcoming.map((item, idx) => {
              const prevItem = upcoming[idx - 1]
              const showDayHeader = !prevItem || prevItem.date !== item.date

              return (
                <React.Fragment key={item.id}>
                  {showDayHeader && (
                    <div className="!text-[length:10px] !font-[500] ![color:var(--text-faint)] !uppercase !tracking-[0.5px]" style={{ padding: idx === 0 ? '0 4px 4px' : '8px 4px 4px' }}>
                      {formatDayLabel(item.date, t, locale)}
                      {item.dayTitle ? ` — ${item.dayTitle}` : ''}
                    </div>
                  )}

                  <div className="trek-hover !flex !gap-[10px] !p-[8px_10px] !rounded-[10px] ![background:var(--bg-secondary)] ![transition:background_0.1s]" >
                    {/* Time column */}
                    <div className="!flex !flex-col !items-center !justify-center !min-w-[44px] !shrink-[0]">
                      <span className="!text-[length:11px] !font-[700] ![color:var(--text-primary)] !whitespace-nowrap !leading-[1]">
                        {item.time ? formatTime(item.time, is12h) : 'TBD'}
                      </span>
                      {item.endTime && (
                        <>
                          <span className="!text-[length:7px] ![color:var(--text-faint)] !font-[600] !tracking-[0.3px] !m-[2px_0] !uppercase">
                            {t('collab.whatsNext.until') || 'bis'}
                          </span>
                          <span className="!text-[length:11px] !font-[700] ![color:var(--text-primary)] !whitespace-nowrap !leading-[1]">
                            {formatTime(item.endTime, is12h)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="!w-[1px] !self-stretch ![background:var(--border-faint)] !shrink-[0] !m-[2px_0]" />

                    {/* Details */}
                    <div className="!flex-[1] !min-w-[0]">
                      <div className="!text-[length:12px] !font-[600] ![color:var(--text-primary)] !leading-[1.3] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                        {item.name}
                      </div>
                      {item.address && (
                        <div className="!flex !items-center !gap-[3px] !mt-[2px]">
                          <MapPin size={9} color="var(--text-faint)" style={{ flexShrink: 0 }} />
                          <span className="!text-[length:10px] ![color:var(--text-faint)] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                            {item.address}
                          </span>
                        </div>
                      )}

                      {/* Participants */}
                      {item.participants.length > 0 && (
                        <div className="!flex !flex-wrap !gap-[4px] !mt-[5px]">
                          {item.participants.map(p => (
                            <div className="!flex !items-center !gap-[4px] !p-[2px_8px_2px_3px] !rounded-[99px] ![background:var(--bg-tertiary)] ![border:1px_solid_var(--border-faint)]" key={p.user_id}>
                              <div className="!w-[16px] !h-[16px] !rounded-[50%] ![background:var(--bg-secondary)] !flex !items-center !justify-center !text-[length:7px] !font-[700] ![color:var(--text-muted)] !overflow-hidden !shrink-[0]">
                                {p.avatar
                                  ? <img className="!w-[100%] !h-[100%] !object-cover" src={`/uploads/avatars/${p.avatar}`} />
                                  : p.username?.[0]?.toUpperCase()
                                }
                              </div>
                              <span className="!text-[length:10px] !font-[500] ![color:var(--text-muted)]">{p.username}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
