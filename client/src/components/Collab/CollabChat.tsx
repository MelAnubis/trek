import React, { useState, useEffect, useRef, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { ArrowUp, Trash2, Reply, ChevronUp, MessageCircle, Smile, X } from 'lucide-react'
import { collabApi } from '../../api/client'
import { useSettingsStore } from '../../store/settingsStore'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'
import { addListener, removeListener } from '../../api/websocket'
import { useTranslation } from '../../i18n'
import type { User } from '../../types'

interface ChatReaction {
  emoji: string
  count: number
  users: { id: number; username: string }[]
}

interface ChatMessage {
  id: number
  trip_id: number
  user_id: number
  text: string
  reply_to_id: number | null
  reactions: ChatReaction[]
  created_at: string
  user?: { username: string; avatar_url: string | null }
  reply_to?: ChatMessage | null
}

// ── Twemoji helper (Apple-style emojis via CDN) ──
function emojiToCodepoint(emoji) {
  const codepoints = []
  for (const c of emoji) {
    const cp = c.codePointAt(0)
    if (cp !== 0xfe0f) codepoints.push(cp.toString(16)) // skip variation selector
  }
  return codepoints.join('-')
}

function TwemojiImg({ emoji, size = 20, style = {} }) {
  const cp = emojiToCodepoint(emoji)
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <span style={{ fontSize: size, lineHeight: 1, display: 'inline-block', verticalAlign: 'middle', ...style }}>{emoji}</span>
  }

  return (
    <img
      src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cp}.png`}
      alt={emoji}
      draggable={false}
      style={{ width: size, height: size, display: 'inline-block', verticalAlign: 'middle', ...style }}
      onError={() => setFailed(true)}
    />
  )
}

const EMOJI_CATEGORIES = {
  'Smileys': ['😀','😂','🥹','😍','🤩','😎','🥳','😭','🤔','👀','🙈','🫠','😴','🤯','🥺','😤','💀','👻','🫡','🤝'],
  'Reactions': ['❤️','🔥','👍','👎','👏','🎉','💯','✨','⭐','💪','🙏','😱','😂','💖','💕','🤞','✅','❌','⚡','🏆'],
  'Travel': ['✈️','🏖️','🗺️','🧳','🏔️','🌅','🌴','🚗','🚂','🛳️','🏨','🍽️','🍕','🍹','📸','🎒','⛱️','🌍','🗼','🎌'],
}

// SQLite stores UTC without 'Z' suffix — append it so JS parses as UTC
function parseUTC(s) { return new Date(s && !s.endsWith('Z') ? s + 'Z' : s) }

function formatTime(isoString, is12h) {
  const d = parseUTC(isoString)
  const h = d.getHours()
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (is12h) {
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${mm} ${period}`
  }
  return `${String(h).padStart(2, '0')}:${mm}`
}

function formatDateSeparator(isoString, t) {
  const d = parseUTC(isoString)
  const now = new Date()
  const yesterday = new Date(); yesterday.setDate(now.getDate() - 1)

  if (d.toDateString() === now.toDateString()) return t('collab.chat.today') || 'Today'
  if (d.toDateString() === yesterday.toDateString()) return t('collab.chat.yesterday') || 'Yesterday'

  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function shouldShowDateSeparator(msg, prevMsg) {
  if (!prevMsg) return true
  const d1 = parseUTC(msg.created_at).toDateString()
  const d2 = parseUTC(prevMsg.created_at).toDateString()
  return d1 !== d2
}

/* ── Emoji Picker ── */
interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  containerRef: React.RefObject<HTMLElement | null>
}

function EmojiPicker({ onSelect, onClose, anchorRef, containerRef }: EmojiPickerProps) {
  const [cat, setCat] = useState(Object.keys(EMOJI_CATEGORIES)[0])
  const ref = useRef(null)

  const getPos = () => {
    const container = containerRef?.current
    const anchor = anchorRef?.current
    if (container && anchor) {
      const cRect = container.getBoundingClientRect()
      const aRect = anchor.getBoundingClientRect()
      return { bottom: window.innerHeight - aRect.top + 16, left: cRect.left + cRect.width / 2 - 140 }
    }
    return { bottom: 80, left: 0 }
  }
  const pos = getPos()

  useEffect(() => {
    const close = (e) => {
      if (ref.current && ref.current.contains(e.target)) return
      if (anchorRef?.current && anchorRef.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [onClose, anchorRef])

  return ReactDOM.createPortal(
    <div ref={ref} style={{
      position: 'fixed', bottom: pos.bottom, left: pos.left, zIndex: 10000,
      background: 'var(--bg-card)', border: '1px solid var(--border-faint)', borderRadius: 16,
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)', width: 280, overflow: 'hidden',
    }}>
      {/* Category tabs */}
      <div className="![border-bottom:1px_solid_var(--border-faint)] !p-[6px_8px] !gap-[2px]" style={{ display: 'flex' }}>
        {Object.keys(EMOJI_CATEGORIES).map(c => (
          <button className="!flex-[1] !p-[4px_0] !rounded-[6px] ![border:none] !cursor-pointer ![color:var(--text-primary)] !text-[length:10px] !font-[600] ![font-family:inherit]" key={c} onClick={() => setCat(c)} style={{ background: cat === c ? 'var(--bg-hover)' : 'transparent' }}>
            {c}
          </button>
        ))}
      </div>
      {/* Emoji grid */}
      <div className="![grid-template-columns:repeat(10,_1fr)] !gap-[2px] !p-[8px]" style={{ display: 'grid' }}>
        {EMOJI_CATEGORIES[cat].map((emoji, i) => (
          <button className="trek-hover trek-h-transform-8d07d0 !w-[28px] !items-center !justify-center ![background:none] ![border:none] !cursor-pointer !rounded-[6px] !p-[2px] ![transition:transform_0.1s]" key={i} onClick={() => onSelect(emoji)} style={{ height: 28, display: 'flex' }} >
            <TwemojiImg emoji={emoji} size={20} />
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}

/* ── Reaction Quick Menu (right-click) ── */
const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥', '👏', '🎉']

interface ReactionMenuProps {
  x: number
  y: number
  onReact: (emoji: string) => void
  onClose: () => void
}

function ReactionMenu({ x, y, onReact, onClose }: ReactionMenuProps) {
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [onClose])

  // Clamp to viewport
  const menuWidth = 156
  const clampedLeft = Math.max(menuWidth / 2 + 8, Math.min(x, window.innerWidth - menuWidth / 2 - 8))

  return (
    <div ref={ref} style={{
      position: 'fixed', top: y - 80, left: clampedLeft, transform: 'translateX(-50%)', zIndex: 10000,
      background: 'var(--bg-card)', border: '1px solid var(--border-faint)', borderRadius: 16,
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '6px 8px',
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, width: menuWidth,
    }}>
      {QUICK_REACTIONS.map(emoji => (
        <button className="trek-h-transform-8d07d0 trek-hover !w-[30px] !items-center !justify-center ![background:none] ![border:none] !cursor-pointer !rounded-[50%] !p-[3px] ![transition:transform_0.1s,_background_0.1s]" key={emoji} onClick={() => onReact(emoji)} style={{ height: 30, display: 'flex' }} >
          <TwemojiImg emoji={emoji} size={18} />
        </button>
      ))}
    </div>
  )
}

/* ── Message Text with clickable URLs ── */
interface MessageTextProps {
  text: string
}

function MessageText({ text }: MessageTextProps) {
  const parts = text.split(URL_REGEX)
  const urls = text.match(URL_REGEX) || []
  const result = []
  parts.forEach((part, i) => {
    if (part) result.push(part)
    if (urls[i]) result.push(
      <a className="![color:inherit] ![text-decoration:underline] ![text-underline-offset:2px]" key={i} href={urls[i]} target="_blank" rel="noopener noreferrer" style={{ opacity: 0.85 }}>
        {urls[i]}
      </a>
    )
  })
  return <>{result}</>
}

/* ── Link Preview ── */
const URL_REGEX = /https?:\/\/[^\s<>"']+/g
const previewCache = {}

interface LinkPreviewProps {
  url: string
  tripId: number | string
  own: boolean
  onLoad: (() => void) | undefined
}

function LinkPreview({ url, tripId, own, onLoad }: LinkPreviewProps) {
  const [data, setData] = useState(previewCache[url] || null)
  const [loading, setLoading] = useState(!previewCache[url])

  useEffect(() => {
    if (previewCache[url]) return
    collabApi.linkPreview(tripId, url).then(d => {
      previewCache[url] = d
      setData(d)
      setLoading(false)
      if (d?.title || d?.description || d?.image) onLoad?.()
    }).catch(() => setLoading(false))
  }, [url, tripId])

  if (loading || !data || (!data.title && !data.description && !data.image)) return null

  const domain = (() => { try { return new URL(url).hostname.replace('www.', '') } catch { return '' } })()

  return (
    <a className="trek-hover-o85 ![text-decoration:none] !mt-[6px] !rounded-[12px] !max-w-[280px] ![transition:opacity_0.15s]" href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', overflow: 'hidden', border: own ? '1px solid rgba(255,255,255,0.15)' : '1px solid var(--border-faint)', background: own ? 'rgba(255,255,255,0.1)' : 'var(--bg-secondary)' }} >
      {data.image && (
        <img className="!w-[100%] !object-cover" src={data.image} alt="" style={{ height: 140, display: 'block' }}
          onError={e => { (e.target as HTMLElement).style.display = 'none' }} />
      )}
      <div className="!p-[8px_10px]">
        {domain && (
          <div className="!text-[length:10px] !font-[600] !uppercase !tracking-[0.3px] !mb-[2px]" style={{ color: own ? 'rgba(255,255,255,0.5)' : 'var(--text-faint)' }}>
            {data.site_name || domain}
          </div>
        )}
        {data.title && (
          <div className="!text-[length:12px] !font-[600] !leading-[1.3] !mb-[2px] ![-webkit-line-clamp:2px] ![-webkit-box-orient:vertical]" style={{ color: own ? '#fff' : 'var(--text-primary)', display: '-webkit-box', overflow: 'hidden' }}>
            {data.title}
          </div>
        )}
        {data.description && (
          <div className="!text-[length:11px] !leading-[1.3] ![-webkit-line-clamp:2px] ![-webkit-box-orient:vertical]" style={{ color: own ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', display: '-webkit-box', overflow: 'hidden' }}>
            {data.description}
          </div>
        )}
      </div>
    </a>
  )
}

/* ── Reaction Badge with NOMAD tooltip ── */
interface ReactionBadgeProps {
  reaction: ChatReaction
  currentUserId: number
  onReact: () => void
}

function ReactionBadge({ reaction, currentUserId, onReact }: ReactionBadgeProps) {
  const [hover, setHover] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef(null)
  const names = reaction.users.map(u => u.username).join(', ')

  return (
    <>
      <button ref={ref} onClick={onReact}
        onMouseEnter={() => {
          if (ref.current) {
            const rect = ref.current.getBoundingClientRect()
            setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 })
          }
          setHover(true)
        }}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 3px',
          borderRadius: 99, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          background: 'transparent', transition: 'transform 0.1s',
        }}
      >
        <TwemojiImg emoji={reaction.emoji} size={16} />
        {reaction.count > 1 && <span className="!text-[length:10px] !font-[700] ![color:var(--text-muted)] !min-w-[8px]">{reaction.count}</span>}
      </button>
      {hover && names && ReactDOM.createPortal(
        <div className="!fixed !pointer-events-none !z-[10000] !whitespace-nowrap ![background:var(--bg-card,_white)] ![color:var(--text-primary,_#111827)] !text-[length:11px] !font-[500] !p-[5px_10px] !rounded-[8px] ![box-shadow:0_4px_12px_rgba(0,0,0,0.15)] ![border:1px_solid_var(--border-faint,_#e5e7eb)]" style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}>
          {names}
        </div>,
        document.body
      )}
    </>
  )
}

/* ── Main Component ── */
interface CollabChatProps {
  tripId: number | string
  currentUser: User
}

export default function CollabChat({ tripId, currentUser }: CollabChatProps) {
  const { t } = useTranslation()
  const is12h = useSettingsStore(s => s.settings.time_format) === '12h'
  const can = useCanDo()
  const trip = useTripStore((s) => s.trip)
  const canEdit = can('collab_edit', trip)

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [sending, setSending] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [reactMenu, setReactMenu] = useState(null) // { msgId, x, y }
  const [deletingIds, setDeletingIds] = useState(new Set())
  const deleteTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return () => { deleteTimersRef.current.forEach(clearTimeout) }
  }, [])

  const containerRef = useRef(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const emojiBtnRef = useRef(null)
  const isAtBottom = useRef(true)

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior }))
  }, [])

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  /* ── load messages ── */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    collabApi.getMessages(tripId).then(data => {
      if (cancelled) return
      const msgs = (Array.isArray(data) ? data : data.messages || []).map(m => m.deleted ? { ...m, _deleted: true } : m)
      setMessages(msgs)
      setHasMore(msgs.length >= 100)
      setLoading(false)
      setTimeout(() => scrollToBottom(), 30)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tripId, scrollToBottom])

  /* ── load more ── */
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || messages.length === 0) return
    setLoadingMore(true)
    const el = scrollRef.current
    const prevHeight = el ? el.scrollHeight : 0
    try {
      const data = await collabApi.getMessages(tripId, messages[0]?.id)
      const older = (Array.isArray(data) ? data : data.messages || []).map(m => m.deleted ? { ...m, _deleted: true } : m)
      if (older.length === 0) { setHasMore(false) }
      else {
        setMessages(prev => [...older, ...prev])
        setHasMore(older.length >= 100)
        requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight })
      }
    } catch {} finally { setLoadingMore(false) }
  }, [tripId, loadingMore, messages])

  /* ── websocket ── */
  useEffect(() => {
    const handler = (event) => {
      if (event.type === 'collab:message:created' && String(event.tripId) === String(tripId)) {
        setMessages(prev => prev.some(m => m.id === event.message.id) ? prev : [...prev, event.message])
        if (isAtBottom.current) setTimeout(() => scrollToBottom('smooth'), 30)
      }
      if (event.type === 'collab:message:deleted' && String(event.tripId) === String(tripId)) {
        setMessages(prev => prev.map(m => m.id === event.messageId ? { ...m, _deleted: true } : m))
        if (isAtBottom.current) setTimeout(() => scrollToBottom('smooth'), 50)
      }
      if (event.type === 'collab:message:reacted' && String(event.tripId) === String(tripId)) {
        setMessages(prev => prev.map(m => m.id === event.messageId ? { ...m, reactions: event.reactions } : m))
      }
    }
    addListener(handler)
    return () => removeListener(handler)
  }, [tripId, scrollToBottom])

  /* ── auto-resize textarea ── */
  const handleTextChange = useCallback((e) => {
    setText(e.target.value)
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      const h = Math.min(ta.scrollHeight, 100)
      ta.style.height = h + 'px'
      ta.style.overflowY = ta.scrollHeight > 100 ? 'auto' : 'hidden'
    }
  }, [])

  /* ── send ── */
  const handleSend = useCallback(async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const payload: { text: string; reply_to?: number } = { text: body }
      if (replyTo) payload.reply_to = replyTo.id
      const data = await collabApi.sendMessage(tripId, payload)
      if (data?.message) {
        setMessages(prev => prev.some(m => m.id === data.message.id) ? prev : [...prev, data.message])
      }
      setText(''); setReplyTo(null); setShowEmoji(false)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      isAtBottom.current = true
      setTimeout(() => scrollToBottom('smooth'), 50)
    } catch {} finally { setSending(false) }
  }, [text, sending, replyTo, tripId, scrollToBottom])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const handleDelete = useCallback(async (msgId) => {
    const msg = messages.find(m => m.id === msgId)
    requestAnimationFrame(() => {
      setDeletingIds(prev => new Set(prev).add(msgId))
    })
    const t = setTimeout(async () => {
      try {
        await collabApi.deleteMessage(tripId, msgId)
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, _deleted: true } : m))
      } catch {}
      setDeletingIds(prev => { const s = new Set(prev); s.delete(msgId); return s })
    }, 400)
    deleteTimersRef.current.push(t)
  }, [tripId])

  const handleReact = useCallback(async (msgId, emoji) => {
    setReactMenu(null)
    try {
      const data = await collabApi.reactMessage(tripId, msgId, emoji)
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: data.reactions } : m))
    } catch {}
  }, [tripId])

  const handleEmojiSelect = useCallback((emoji) => {
    setText(prev => prev + emoji)
    textareaRef.current?.focus()
  }, [])

  const isOwn = (msg) => String(msg.user_id) === String(currentUser.id)

  // Check if message is only emoji (1-3 emojis, no other text)
  const isEmojiOnly = (text) => {
    const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}[\uFE0F]?(?:\u200D\p{Extended_Pictographic}[\uFE0F]?)*){1,3}$/u
    return emojiRegex.test(text.trim())
  }

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="!flex-[1] !items-center !justify-center" style={{ display: 'flex' }}>
        <div className="!w-[24px] ![border:2px_solid_var(--border-faint)] [&&]:![border-top-color:var(--accent)] !rounded-[50%]" style={{ height: 24, animation: 'spin .7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  /* ── Main ── */
  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0, height: '100%' }}>
      {/* Messages */}
      {messages.length === 0 ? (
        <div className="!flex-[1] !flex-col !items-center !justify-center !gap-[8px] ![color:var(--text-faint)] !p-[32px]" style={{ display: 'flex' }}>
          <MessageCircle size={40} strokeWidth={1.2} style={{ opacity: 0.4 }} />
          <span className="!text-[length:14px] !font-[600]">{t('collab.chat.empty')}</span>
          <span className="!text-[length:12px]" style={{ opacity: 0.6 }}>{t('collab.chat.emptyDesc') || ''}</span>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={checkAtBottom} className="chat-scroll" style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 14px 4px', WebkitOverflowScrolling: 'touch',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {hasMore && (
            <div className="!justify-center !p-[4px_0_10px]" style={{ display: 'flex' }}>
              <button className="!items-center !gap-[4px] !text-[length:11px] !font-[600] ![color:var(--text-muted)] ![background:var(--bg-secondary)] ![border:1px_solid_var(--border-faint)] !rounded-[99px] !p-[5px_14px] !cursor-pointer ![font-family:inherit]" onClick={handleLoadMore} disabled={loadingMore} style={{ display: 'inline-flex' }}>
                <ChevronUp size={13} />
                {loadingMore ? '...' : t('collab.chat.loadMore')}
              </button>
            </div>
          )}

          {messages.map((msg, idx) => {
            const own = isOwn(msg)
            const prevMsg = messages[idx - 1]
            const nextMsg = messages[idx + 1]
            const isNewGroup = idx === 0 || String(prevMsg?.user_id) !== String(msg.user_id)
            const isLastInGroup = !nextMsg || String(nextMsg?.user_id) !== String(msg.user_id)
            const showDate = shouldShowDateSeparator(msg, prevMsg)
            const showAvatar = !own && isLastInGroup
            const bigEmoji = isEmojiOnly(msg.text)
            const hasReply = msg.reply_text || msg.reply_to
            // Deleted message placeholder
            if (msg._deleted) {
              return (
                <React.Fragment key={msg.id}>
                  {showDate && (
                    <div className="!justify-center !p-[14px_0_6px]" style={{ display: 'flex' }}>
                      <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] ![background:var(--bg-secondary)] !p-[3px_12px] !rounded-[99px] !tracking-[0.3px] !uppercase">
                        {formatDateSeparator(msg.created_at, t)}
                      </span>
                    </div>
                  )}
                  <div className="!justify-center !p-[4px_0]" style={{ display: 'flex' }}>
                    <span className="!text-[length:11px] ![color:var(--text-faint)] !italic">
                      {msg.username} {t('collab.chat.deletedMessage') || 'deleted a message'} · {formatTime(msg.created_at, is12h)}
                    </span>
                  </div>
                </React.Fragment>
              )
            }

            // Bubble border radius — iMessage style tails
            const br = own
              ? `18px 18px ${isLastInGroup ? '4px' : '18px'} 18px`
              : `18px 18px 18px ${isLastInGroup ? '4px' : '18px'}`

            return (
              <React.Fragment key={msg.id}>
                {/* Date separator */}
                {showDate && (
                  <div className="!justify-center !p-[14px_0_6px]" style={{ display: 'flex' }}>
                    <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] ![background:var(--bg-secondary)] !p-[3px_12px] !rounded-[99px] !tracking-[0.3px] !uppercase">
                      {formatDateSeparator(msg.created_at, t)}
                    </span>
                  </div>
                )}

                <div style={{
                  display: 'flex', alignItems: own ? 'flex-end' : 'flex-start',
                  flexDirection: own ? 'row-reverse' : 'row',
                  gap: 6, marginTop: isNewGroup ? 10 : 1,
                  paddingLeft: own ? 40 : 0, paddingRight: own ? 0 : 40,
                  transition: 'transform 0.3s ease, opacity 0.3s ease, max-height 0.3s ease',
                  ...(deletingIds.has(msg.id) ? { transform: 'scale(0.3)', opacity: 0, maxHeight: 0, marginTop: 0, overflow: 'hidden' } : {}),
                }}>
                  {/* Avatar slot for others */}
                  {!own && (
                    <div className="!w-[28px] !shrink-[0] !self-end">
                      {showAvatar && (
                        msg.user_avatar ? (
                          <img className="!w-[28px] !rounded-[50%] !object-cover" src={msg.user_avatar} alt="" style={{ height: 28 }} />
                        ) : (
                          <div className="!w-[28px] !rounded-[50%] ![background:var(--bg-tertiary)] !items-center !justify-center !text-[length:11px] !font-[700] ![color:var(--text-muted)]" style={{ height: 28, display: 'flex' }}>
                            {(msg.username || '?')[0].toUpperCase()}
                          </div>
                        )
                      )}
                    </div>
                  )}

                  <div className="!flex-col !max-w-[78%] !min-w-[0]" style={{ display: 'flex', alignItems: own ? 'flex-end' : 'flex-start' }}>
                    {/* Username for others at group start */}
                    {!own && isNewGroup && (
                      <span className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !mb-[2px] !pl-[4px]">
                        {msg.username}
                      </span>
                    )}

                    {/* Bubble */}
                    <div
                      style={{ position: 'relative' }}
                      onMouseEnter={() => setHoveredId(msg.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onContextMenu={e => { e.preventDefault(); if (canEdit) setReactMenu({ msgId: msg.id, x: e.clientX, y: e.clientY }) }}
                      onTouchEnd={e => {
                        const now = Date.now()
                        const lastTap = Number(e.currentTarget.dataset.lastTap || 0)
                        if (now - lastTap < 300 && canEdit) {
                          e.preventDefault()
                          const touch = e.changedTouches?.[0]
                          if (touch) setReactMenu({ msgId: msg.id, x: touch.clientX, y: touch.clientY })
                        }
                        e.currentTarget.dataset.lastTap = String(now)
                      }}
                    >
                      {bigEmoji ? (
                        <div className="!text-[length:40px] !leading-[1.2] !p-[2px_0]">
                          {msg.text}
                        </div>
                      ) : (
                        <div className="!text-[length:14px] !leading-[1.4] !break-words !whitespace-pre-wrap" style={{ background: own ? '#007AFF' : 'var(--bg-secondary)', color: own ? '#fff' : 'var(--text-primary)', borderRadius: br, padding: hasReply ? '4px 4px 8px 4px' : '8px 14px' }}>
                          {/* Inline reply quote */}
                          {hasReply && (
                            <div className="!p-[5px_10px] !mb-[4px] !rounded-[12px] !text-[length:12px] !leading-[1.3]" style={{ background: own ? 'rgba(255,255,255,0.15)' : 'var(--bg-tertiary)' }}>
                              <div className="!font-[600] !text-[length:11px] !mb-[1px]" style={{ opacity: 0.7 }}>
                                {msg.reply_username || ''}
                              </div>
                              <div className="!text-ellipsis !whitespace-nowrap" style={{ opacity: 0.8, overflow: 'hidden' }}>
                                {(msg.reply_text || '').slice(0, 80)}
                              </div>
                            </div>
                          )}
                          {hasReply ? (
                            <div className="!p-[0_10px_4px]"><MessageText text={msg.text} /></div>
                          ) : <MessageText text={msg.text} />}
                          {(msg.text.match(URL_REGEX) || []).slice(0, 1).map(url => (
                            <LinkPreview key={url} url={url} tripId={tripId} own={own} onLoad={() => { if (isAtBottom.current) setTimeout(() => scrollToBottom('smooth'), 50) }} />
                          ))}
                        </div>
                      )}

                      {/* Hover actions */}
                      <div style={{
                        position: 'absolute', top: -14,
                        display: 'flex', gap: 2,
                        opacity: hoveredId === msg.id ? 1 : 0,
                        pointerEvents: hoveredId === msg.id ? 'auto' : 'none',
                        transition: 'opacity .1s',
                        ...(own ? { left: -6 } : { right: -6 }),
                      }}>
                        <button className="trek-h-transform-8d07d0 !w-[24px] !rounded-[50%] ![border:none] ![background:var(--accent)] !items-center !justify-center !cursor-pointer ![color:var(--accent-text)] !p-[0] ![box-shadow:0_2px_8px_rgba(0,0,0,0.15)] ![transition:transform_0.12s]" onClick={() => setReplyTo(msg)} title={t('collab.chat.reply')} style={{ height: 24, display: 'flex' }} >
                          <Reply size={11} />
                        </button>
                        {own && canEdit && (
                          <button className="trek-h-transform-8d07d0 trek-h-background-82b6ef trek-h-color-4eb23a !w-[24px] !rounded-[50%] ![border:none] ![background:var(--accent)] !items-center !justify-center !cursor-pointer ![color:var(--accent-text)] !p-[0] ![box-shadow:0_2px_8px_rgba(0,0,0,0.15)] ![transition:transform_0.12s,_background_0.15s,_color_0.15s]" onClick={() => handleDelete(msg.id)} title={t('common.delete')} style={{ height: 24, display: 'flex' }} >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Reactions — iMessage style floating badge */}
                    {msg.reactions?.length > 0 && (
                      <div className="!gap-[3px] !mt-[-6px] !mb-[4px] !relative !z-[1]" style={{ display: 'flex', justifyContent: own ? 'flex-end' : 'flex-start', paddingLeft: own ? 0 : 8, paddingRight: own ? 8 : 0 }}>
                        <div className="!items-center !gap-[2px] !p-[3px_6px] !rounded-[99px] ![background:var(--bg-card)] ![box-shadow:0_1px_6px_rgba(0,0,0,0.12)] ![border:1px_solid_var(--border-faint)]" style={{ display: 'inline-flex' }}>
                          {msg.reactions.map(r => {
                            const myReaction = r.users.some(u => String(u.user_id) === String(currentUser.id))
                            return (
                              <ReactionBadge key={r.emoji} reaction={r} currentUserId={currentUser.id} onReact={() => { if (canEdit) handleReact(msg.id, r.emoji) }} />
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Timestamp — only on last message of group */}
                    {isLastInGroup && (
                      <span className="!text-[length:9px] ![color:var(--text-faint)] !mt-[2px] !p-[0_4px]">
                        {formatTime(msg.created_at, is12h)}
                      </span>
                    )}
                  </div>
                </div>
              </React.Fragment>
            )
          })}
        </div>
      )}

      {/* Composer */}
      <div className="pb-3 !shrink-[0] !pt-[8px] !pl-[12px] !pr-[12px] ![border-top:1px_solid_var(--border-faint)] ![background:var(--bg-card)]">
        {/* Reply preview */}
        {replyTo && (
          <div className="!items-center !gap-[8px] !mb-[8px] !p-[6px_10px] !rounded-[10px] ![background:var(--bg-secondary)] ![border-left:3px_solid_#007AFF] !text-[length:12px] ![color:var(--text-muted)]" style={{ display: 'flex' }}>
            <Reply size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
            <span className="!text-ellipsis !whitespace-nowrap !flex-[1]" style={{ overflow: 'hidden' }}>
              <strong>{replyTo.username}</strong>: {(replyTo.text || '').slice(0, 60)}
            </span>
            <button className="![background:none] ![border:none] !cursor-pointer !p-[2px] ![color:var(--text-faint)] !shrink-[0]" onClick={() => setReplyTo(null)} style={{ display: 'flex' }}>
              <X size={14} />
            </button>
          </div>
        )}

        <div className="!items-end !gap-[6px]" style={{ display: 'flex' }}>
          {/* Emoji button */}
          {canEdit && (
            <button ref={emojiBtnRef} onClick={() => setShowEmoji(!showEmoji)} style={{
              width: 34, height: 34, borderRadius: '50%', border: 'none',
              background: showEmoji ? 'var(--bg-hover)' : 'transparent',
              color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'background 0.15s',
            }}>
              <Smile size={20} />
            </button>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            disabled={!canEdit}
            style={{
              flex: 1, resize: 'none', border: '1px solid var(--border-primary)', borderRadius: 20,
              padding: '8px 14px', fontSize: 14, lineHeight: 1.4, fontFamily: 'inherit',
              background: 'var(--bg-input)', color: 'var(--text-primary)', outline: 'none',
              maxHeight: 100, overflowY: 'hidden',
              opacity: canEdit ? 1 : 0.5,
            }}
            placeholder={t('collab.chat.placeholder')}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
          />

          {/* Send */}
          {canEdit && (
            <button className="!w-[34px] !rounded-[50%] ![border:none] ![color:#fff] !items-center !justify-center !shrink-[0] ![transition:background_0.15s]" onClick={handleSend} disabled={!text.trim() || sending} style={{ height: 34, background: text.trim() ? '#007AFF' : 'var(--border-primary)', display: 'flex', cursor: text.trim() ? 'pointer' : 'default' }}>
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Emoji picker */}
      {showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} anchorRef={emojiBtnRef} containerRef={containerRef} />}

      {/* Reaction quick menu (right-click) */}
      {reactMenu && ReactDOM.createPortal(
        <ReactionMenu x={reactMenu.x} y={reactMenu.y} onReact={(emoji) => handleReact(reactMenu.msgId, emoji)} onClose={() => setReactMenu(null)} />,
        document.body
      )}
    </div>
  )
}
