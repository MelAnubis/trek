import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, X, Check, BarChart3, Lock, Clock } from 'lucide-react'
import { collabApi } from '../../api/client'
import { addListener, removeListener } from '../../api/websocket'
import { useTranslation } from '../../i18n'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'
import ReactDOM from 'react-dom'
import type { User } from '../../types'

interface PollVoter {
  user_id: number
  username: string
  avatar_url: string | null
}

interface PollOption {
  id: number
  text: string
  /** Older polls stored the option text as `label`. */
  label?: string
  voters: PollVoter[]
}

interface Poll {
  id: number
  question: string
  options: PollOption[]
  /** The server's field name (collabService formats it from `multiple`). */
  multiple_choice: boolean
  is_closed: boolean
  deadline: string | null
  created_by: number
  created_at: string
}

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"

function timeRemaining(deadline) {
  if (!deadline) return null
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff <= 0) return null
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) return `${days}d ${hrs % 24}h`
  if (hrs > 0) return `${hrs}h ${mins % 60}m`
  return `${mins}m`
}

function isExpired(deadline) {
  if (!deadline) return false
  return new Date(deadline).getTime() <= Date.now()
}

function totalVotes(poll) {
  return (poll.options || []).reduce((s, o) => s + (o.voters?.length || 0), 0)
}

// ── Create Poll Modal ────────────────────────────────────────────────────────
interface CreatePollModalProps {
  onClose: () => void
  onCreate: (data: { question: string; options: string[]; multiple_choice: boolean }) => Promise<void>
  t: (key: string) => string
}

function CreatePollModal({ onClose, onCreate, t }: CreatePollModalProps) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiChoice, setMultiChoice] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const addOption = () => setOptions(prev => [...prev, ''])
  const removeOption = (i) => setOptions(prev => prev.filter((_, j) => j !== i))
  const updateOption = (i, v) => setOptions(prev => prev.map((o, j) => j === i ? v : o))

  const canSubmit = question.trim() && options.filter(o => o.trim()).length >= 2 && !submitting

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onCreate({ question: question.trim(), options: options.filter(o => o.trim()), multiple_choice: multiChoice })
      onClose()
    } catch {} finally { setSubmitting(false) }
  }

  return ReactDOM.createPortal(
    <div className="!fixed !inset-[0] ![background:var(--overlay-bg,_rgba(0,0,0,0.35))] ![backdrop-filter:blur(6px)] ![-webkit-backdrop-filter:blur(6px)] !flex !items-center !justify-center !z-[9999] !p-[16px]" style={{ fontFamily: FONT }} onClick={onClose}>
      <form className="![background:var(--bg-card)] !rounded-[16px] !w-[100%] !max-w-[400px] !max-h-[90vh] !overflow-auto ![border:1px_solid_var(--border-faint)]" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="!flex !items-center !justify-between !p-[14px_16px_12px] ![border-bottom:1px_solid_var(--border-faint)]">
          <h3 className="!text-[length:14px] !font-[700] ![color:var(--text-primary)] !m-[0]">{t('collab.polls.new')}</h3>
          <button className="![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !p-[2px] !flex" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="!p-[14px_16px_16px] !flex !flex-col !gap-[12px]">
          {/* Question */}
          <div>
            <div className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.05em] !mb-[4px]">{t('collab.polls.question')}</div>
            <input className="!w-[100%] ![border:1px_solid_var(--border-primary)] !rounded-[10px] !p-[8px_12px] !text-[length:13px] ![background:var(--bg-input)] ![color:var(--text-primary)] ![font-family:inherit] ![outline:none] !box-border" autoFocus value={question} onChange={e => setQuestion(e.target.value)} placeholder={t('collab.polls.questionPlaceholder') || 'Ask a question...'} />
          </div>

          {/* Options */}
          <div>
            <div className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.05em] !mb-[4px]">{t('collab.polls.options')}</div>
            <div className="!flex !flex-col !gap-[6px]">
              {options.map((opt, i) => (
                <div className="!flex !gap-[6px] !items-center" key={i}>
                  <input className="!flex-[1] ![border:1px_solid_var(--border-primary)] !rounded-[10px] !p-[8px_12px] !text-[length:13px] ![background:var(--bg-input)] ![color:var(--text-primary)] ![font-family:inherit] ![outline:none]" value={opt} onChange={e => updateOption(i, e.target.value)} placeholder={`${t('collab.polls.option')} ${i + 1}`} />
                  {options.length > 2 && (
                    <button className="![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !flex !p-[2px]" type="button" onClick={() => removeOption(i)}><X size={14} /></button>
                  )}
                </div>
              ))}
              <button className="!flex !items-center !gap-[4px] !p-[6px_12px] !rounded-[10px] ![border:1px_dashed_var(--border-faint)] ![background:transparent] !cursor-pointer ![color:var(--text-faint)]" type="button" onClick={addOption} style={{ fontSize: 12, fontFamily: FONT }}>
                <Plus size={12} /> {t('collab.polls.addOption')}
              </button>
            </div>
          </div>

          {/* Multi choice toggle */}
          <label className="!flex !items-center !gap-[8px] !cursor-pointer">
            <div className="!w-[36px] !h-[20px] !rounded-[10px] !p-[2px] !cursor-pointer ![transition:background_0.2s] !flex !items-center" onClick={() => setMultiChoice(!multiChoice)} style={{ background: multiChoice ? '#007AFF' : 'var(--border-primary)' }}>
              <div className="!w-[16px] !h-[16px] !rounded-[50%] ![background:#fff] ![transition:transform_0.2s]" style={{ transform: multiChoice ? 'translateX(16px)' : 'translateX(0)' }} />
            </div>
            <span className="![color:var(--text-muted)]" style={{ fontSize: 12, fontFamily: FONT }}>{t('collab.polls.multiChoice')}</span>
          </label>

          {/* Submit */}
          <button className="!w-[100%] !rounded-[99px] !p-[9px_14px] ![border:none]" type="submit" disabled={!canSubmit} style={{ background: canSubmit ? 'var(--accent)' : 'var(--border-primary)', color: canSubmit ? 'var(--accent-text)' : 'var(--text-faint)', fontSize: 13, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default', fontFamily: FONT }}>
            {submitting ? '...' : t('collab.polls.create')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}

// ── Voter Chip with custom tooltip ────────────────────────────────────────────
interface VoterChipProps {
  voter: PollVoter
  offset: boolean
}

function VoterChip({ voter, offset }: VoterChipProps) {
  const [hover, setHover] = useState(false)
  const ref = React.useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  return (
    <>
      <div ref={ref}
        onMouseEnter={() => {
          if (ref.current) {
            const rect = ref.current.getBoundingClientRect()
            setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 })
          }
          setHover(true)
        }}
        onMouseLeave={() => setHover(false)}
        style={{
          width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, fontWeight: 700, color: 'var(--text-muted)', overflow: 'hidden',
          border: '1.5px solid var(--bg-card)', marginLeft: offset ? -5 : 0, flexShrink: 0,
        }}>
        {voter.avatar_url ? <img className="!w-[100%] !h-[100%] !object-cover" src={voter.avatar_url} /> : (voter.username || '?')[0].toUpperCase()}
      </div>
      {hover && ReactDOM.createPortal(
        <div className="!fixed !pointer-events-none !z-[10000] !whitespace-nowrap ![background:var(--bg-card)] ![color:var(--text-primary)] !text-[length:11px] !font-[500] !p-[5px_10px] !rounded-[8px] ![box-shadow:0_4px_12px_rgba(0,0,0,0.15)] ![border:1px_solid_var(--border-faint)]" style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}>
          {voter.username}
        </div>,
        document.body
      )}
    </>
  )
}

// ── Poll Card ────────────────────────────────────────────────────────────────
interface PollCardProps {
  poll: Poll
  currentUser: User
  canEdit: boolean
  onVote: (pollId: number, optionId: number) => Promise<void>
  onClose: (pollId: number) => Promise<void>
  onDelete: (pollId: number) => Promise<void>
  t: (key: string) => string
}

function PollCard({ poll, currentUser, canEdit, onVote, onClose, onDelete, t }: PollCardProps) {
  const total = totalVotes(poll)
  const isClosed = poll.is_closed || isExpired(poll.deadline)
  const remaining = timeRemaining(poll.deadline)
  const hasVoted = (poll.options || []).some(o => (o.voters || []).some(v => String(v.user_id) === String(currentUser.id)))

  return (
    <div className="!rounded-[14px] ![border:1px_solid_var(--border-faint)] !overflow-hidden ![background:var(--bg-card)]" style={{ fontFamily: FONT }}>
      {/* Header */}
      <div className="!p-[10px_12px] !flex !items-start !gap-[8px]" style={{ background: isClosed ? 'var(--bg-secondary)' : 'transparent' }}>
        <div className="!flex-[1] !min-w-[0]">
          <div className="!text-[length:13px] !font-[700] ![color:var(--text-primary)] !leading-[1.35] !break-words">
            {poll.question}
          </div>
          <div className="!flex !items-center !gap-[6px] !mt-[4px] !flex-wrap">
            {isClosed && (
              <span className="!inline-flex !items-center !gap-[3px] !text-[length:9px] !font-[600] ![color:var(--text-faint)] ![background:var(--bg-tertiary)] !p-[2px_7px] !rounded-[99px]">
                <Lock size={8} /> {t('collab.polls.closed')}
              </span>
            )}
            {remaining && !isClosed && (
              <span className="!inline-flex !items-center !gap-[3px] !text-[length:9px] !font-[600] ![color:#f59e0b] ![background:#f59e0b18] !p-[2px_7px] !rounded-[99px]">
                <Clock size={8} /> {remaining}
              </span>
            )}
            {poll.multiple_choice && (
              <span className="!text-[length:9px] !font-[600] ![color:var(--text-faint)] ![background:var(--bg-tertiary)] !p-[2px_7px] !rounded-[99px]">
                {t('collab.polls.multiChoice')}
              </span>
            )}
            <span className="!text-[length:9px] ![color:var(--text-faint)]">
              {total} {total === 1 ? 'vote' : 'votes'}
            </span>
          </div>
        </div>
        {/* Actions */}
        {canEdit && (
          <div className="!flex !gap-[2px] !shrink-[0]">
            {!isClosed && (
              <button className="trek-hover-text !p-[4px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !flex !rounded-[6px]" onClick={() => onClose(poll.id)} title={t('collab.polls.close')}>
                <Lock size={12} />
              </button>
            )}
            <button className="trek-hover-danger !p-[4px] ![background:none] ![border:none] !cursor-pointer ![color:var(--text-faint)] !flex !rounded-[6px]" onClick={() => onDelete(poll.id)} title={t('collab.polls.delete')}>
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Options */}
      <div className="!p-[4px_12px_12px] !flex !flex-col !gap-[6px]">
        {(poll.options || []).map((opt, idx) => {
          const count = opt.voters?.length || 0
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          const myVote = (opt.voters || []).some(v => String(v.user_id) === String(currentUser.id))
          const isWinner = isClosed && count === Math.max(...(poll.options || []).map(o => o.voters?.length || 0)) && count > 0

          return (
            <button key={idx} onClick={() => !isClosed && onVote(poll.id, idx)}
              disabled={isClosed}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 12px', borderRadius: 10, border: 'none', cursor: isClosed ? 'default' : 'pointer',
                background: 'var(--bg-secondary)', fontFamily: FONT, textAlign: 'left', width: '100%',
                overflow: 'hidden', transition: 'transform 0.1s',
              }}
              onMouseEnter={e => { if (!isClosed) e.currentTarget.style.transform = 'scale(1.01)' }}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              {/* Progress bar background */}
              <div className="!absolute !left-[0] !top-[0] !bottom-[0] !rounded-[10px] ![transition:width_0.4s_ease]" style={{ width: `${pct}%`, background: myVote ? '#007AFF20' : isWinner ? '#10b98118' : 'var(--bg-tertiary)' }} />

              {/* Check circle */}
              <div className="!w-[20px] !h-[20px] !rounded-[50%] !shrink-[0] !relative !flex !items-center !justify-center ![transition:all_0.2s]" style={{ border: myVote ? '2px solid #007AFF' : '2px solid var(--border-primary)', background: myVote ? '#007AFF' : 'transparent' }}>
                {myVote && <Check size={11} color="#fff" strokeWidth={3} />}
              </div>

              {/* Label */}
              <span className={['!flex-[1] ![color:var(--text-primary)] !relative !z-[1]', (myVote || isWinner) ? '!font-[600]' : '!font-[400]', '!text-[length:13px]'].join(' ')}>
                {typeof opt === 'string' ? opt : opt.label || opt.text}
              </span>

              {/* Voter avatars */}
              {(opt.voters || []).length > 0 && (hasVoted || isClosed) && (
                <div className="!flex !relative !z-[1]">
                  {(opt.voters || []).slice(0, 3).map((v, vi) => (
                    <VoterChip key={v.user_id || vi} voter={v} offset={vi > 0} />
                  ))}
                </div>
              )}

              {/* Percentage */}
              {(hasVoted || isClosed) && (
                <span className="!text-[length:12px] !font-[700] !relative !z-[1] !min-w-[32px] !text-right" style={{ color: myVote ? '#007AFF' : 'var(--text-muted)' }}>
                  {pct}%
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
interface CollabPollsProps {
  tripId: number | string
  currentUser: User
}

export default function CollabPolls({ tripId, currentUser }: CollabPollsProps) {
  const { t } = useTranslation()
  const can = useCanDo()
  const trip = useTripStore((s) => s.trip)
  const canEdit = can('collab_edit', trip)
  const [polls, setPolls] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    collabApi.getPolls(tripId).then(data => {
      setPolls(Array.isArray(data) ? data : data.polls || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [tripId])

  // WebSocket
  useEffect(() => {
    const handler = (msg) => {
      if (!msg?.type) return
      if (msg.type === 'collab:poll:created' && msg.poll) {
        setPolls(prev => prev.some(p => p.id === msg.poll.id) ? prev : [msg.poll, ...prev])
      }
      if (msg.type === 'collab:poll:voted' && msg.poll) {
        setPolls(prev => prev.map(p => p.id === msg.poll.id ? msg.poll : p))
      }
      if (msg.type === 'collab:poll:closed' && msg.poll) {
        setPolls(prev => prev.map(p => p.id === msg.poll.id ? { ...p, ...msg.poll, is_closed: true } : p))
      }
      if (msg.type === 'collab:poll:deleted') {
        const id = msg.pollId || msg.poll?.id
        if (id) setPolls(prev => prev.filter(p => p.id !== id))
      }
    }
    addListener(handler)
    return () => removeListener(handler)
  }, [])

  const handleCreate = useCallback(async (data) => {
    const result = await collabApi.createPoll(tripId, data)
    const created = result.poll || result
    setPolls(prev => prev.some(p => p.id === created.id) ? prev : [created, ...prev])
    setShowForm(false)
  }, [tripId])

  const handleVote = useCallback(async (pollId, optionIndex) => {
    try {
      const result = await collabApi.votePoll(tripId, pollId, optionIndex)
      const updated = result.poll || result
      setPolls(prev => prev.map(p => p.id === updated.id ? updated : p))
    } catch {}
  }, [tripId])

  const handleClose = useCallback(async (pollId) => {
    try {
      await collabApi.closePoll(tripId, pollId)
      setPolls(prev => prev.map(p => p.id === pollId ? { ...p, is_closed: true } : p))
    } catch {}
  }, [tripId])

  const handleDelete = useCallback(async (pollId) => {
    try {
      await collabApi.deletePoll(tripId, pollId)
      setPolls(prev => prev.filter(p => p.id !== pollId))
    } catch {}
  }, [tripId])

  const activePolls = polls.filter(p => !p.is_closed && !isExpired(p.deadline))
  const closedPolls = polls.filter(p => p.is_closed || isExpired(p.deadline))

  // Deadline ticker
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!polls.some(p => p.deadline && !p.is_closed)) return
    const iv = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(iv)
  }, [polls])

  if (loading) {
    return (
      <div className="!h-[100%] !flex !items-center !justify-center" style={{ fontFamily: FONT }}>
        <div className="!w-[20px] !h-[20px] ![border:2px_solid_var(--border-primary)] [&&]:![border-top-color:var(--text-primary)] !rounded-[50%]" style={{ animation: 'collab-poll-spin 0.7s linear infinite' }} />
        <style>{`@keyframes collab-poll-spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  return (
    <div className="!h-[100%] !flex !flex-col" style={{ fontFamily: FONT }}>
      {/* Header */}
      <div className="!flex !items-center !justify-between !p-[10px_16px] !shrink-[0]">
        <h3 className="!m-[0] !text-[length:12px] !font-[600] ![color:var(--text-muted)] !flex !items-center !gap-[7px] !tracking-[0.3px] !uppercase">
          <BarChart3 size={14} color="var(--text-faint)" />
          {t('collab.polls.title')}
        </h3>
        {canEdit && (
          <button className="!inline-flex !items-center !gap-[4px] !rounded-[99px] !p-[6px_12px] ![background:var(--accent)] ![color:var(--accent-text)] ![border:none] !cursor-pointer" onClick={() => setShowForm(true)} style={{ fontSize: 11, fontWeight: 600, fontFamily: FONT }}>
            <Plus size={12} /> {t('collab.polls.new')}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="chat-scroll !flex-[1] !overflow-y-auto !p-[0_12px_12px]">
        {polls.length === 0 ? (
          <div className="!flex !flex-col !items-center !justify-center !p-[48px_20px] !text-center !h-[100%]">
            <BarChart3 size={36} color="var(--text-faint)" strokeWidth={1.3} style={{ marginBottom: 12 }} />
            <div className="!text-[length:14px] !font-[600] ![color:var(--text-secondary)] !mb-[4px]">{t('collab.polls.empty')}</div>
            <div className="!text-[length:12px] ![color:var(--text-faint)]">{t('collab.polls.emptyHint')}</div>
          </div>
        ) : (
          <div className="!flex !flex-col !gap-[10px]">
            {activePolls.length > 0 && activePolls.map(poll => (
              <PollCard key={poll.id} poll={poll} currentUser={currentUser} canEdit={canEdit} onVote={handleVote} onClose={handleClose} onDelete={handleDelete} t={t} />
            ))}
            {closedPolls.length > 0 && (
              <>
                {activePolls.length > 0 && (
                  <div className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.3px] !p-[8px_0_2px]">
                    {t('collab.polls.closedSection') || 'Closed'}
                  </div>
                )}
                {closedPolls.map(poll => (
                  <PollCard key={poll.id} poll={poll} currentUser={currentUser} canEdit={canEdit} onVote={handleVote} onClose={handleClose} onDelete={handleDelete} t={t} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showForm && <CreatePollModal onClose={() => setShowForm(false)} onCreate={handleCreate} t={t} />}
    </div>
  )
}
