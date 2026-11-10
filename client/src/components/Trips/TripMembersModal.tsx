import { useState, useEffect, useRef } from 'react'
import Modal from '../shared/Modal'
import { tripsApi, authApi, shareApi } from '../../api/client'
import { useToast } from '../shared/Toast'
import { useAuthStore } from '../../store/authStore'
import { useCanDo } from '../../store/permissionsStore'
import { useTripStore } from '../../store/tripStore'
import { Crown, UserMinus, UserPlus, Users, LogOut, Link2, Trash2, Copy, Check } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { getApiErrorMessage } from '../../types'
import CustomSelect from '../shared/CustomSelect'

interface AvatarProps {
  username: string
  avatarUrl: string | null
  size?: number
}

function Avatar({ username, avatarUrl, size = 32 }: AvatarProps) {
  if (avatarUrl) {
    return <img className="!rounded-[50%] !object-cover !shrink-[0]" src={avatarUrl} alt="" style={{ width: size, height: size }} />
  }
  const letter = (username || '?')[0].toUpperCase()
  const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']
  const color = colors[letter.charCodeAt(0) % colors.length]
  return (
    <div className="!rounded-[50%] !flex !items-center !justify-center ![color:white] !shrink-[0]" style={{ width: size, height: size, background: color, fontSize: size * 0.4, fontWeight: 700 }}>
      {letter}
    </div>
  )
}

function ShareLinkSection({ tripId, t }: { tripId: number | string; t: (key: string, params?: Record<string, string | number>) => string }) {
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [perms, setPerms] = useState({ share_map: true, share_bookings: true, share_packing: false, share_budget: false, share_collab: false })
  const toast = useToast()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }
  }, [])

  useEffect(() => {
    shareApi.getLink(tripId).then(d => {
      setShareToken(d.token)
      if (d.token) setPerms({ share_map: d.share_map ?? true, share_bookings: d.share_bookings ?? true, share_packing: d.share_packing ?? false, share_budget: d.share_budget ?? false, share_collab: d.share_collab ?? false })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [tripId])

  const shareUrl = shareToken ? `${window.location.origin}/shared/${shareToken}` : null

  const handleCreate = async () => {
    try {
      const d = await shareApi.createLink(tripId, perms)
      setShareToken(d.token)
    } catch { toast.error(t('share.createError')) }
  }

  const handleUpdatePerms = async (key: string, val: boolean) => {
    const newPerms = { ...perms, [key]: val }
    setPerms(newPerms)
    if (shareToken) {
      try { await shareApi.createLink(tripId, newPerms) } catch {}
    }
  }

  const handleDelete = async () => {
    try {
      await shareApi.deleteLink(tripId)
      setShareToken(null)
    } catch {}
  }

  const handleCopy = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) return null

  return (
    <div>
      <div className="!flex !items-center !gap-[6px] !mb-[10px]">
        <Link2 size={14} style={{ color: 'var(--text-muted)' }} />
        <span className="!text-[length:13px] !font-[600] ![color:var(--text-primary)]">{t('share.linkTitle')}</span>
      </div>
      <p className="!text-[length:11px] ![color:var(--text-faint)] !mb-[10px] !leading-[1.5]">{t('share.linkHint')}</p>

      {/* Permission checkboxes */}
      <div className="!flex !flex-wrap !gap-[6px] !mb-[12px]">
        {[
          { key: 'share_map', label: t('share.permMap'), always: true },
          { key: 'share_bookings', label: t('share.permBookings') },
          { key: 'share_packing', label: t('share.permPacking') },
          { key: 'share_budget', label: t('share.permBudget') },
          { key: 'share_collab', label: t('share.permCollab') },
        ].map(opt => (
          <button className="!flex !items-center !gap-[5px] !p-[4px_10px] !rounded-[20px] !text-[length:11px] !font-[500] ![font-family:inherit] ![transition:all_0.12s]" key={opt.key} onClick={() => !opt.always && handleUpdatePerms(opt.key, !perms[opt.key])}
            style={{ border: '1.5px solid', cursor: opt.always ? 'default' : 'pointer', background: perms[opt.key] ? 'var(--text-primary)' : 'transparent', borderColor: perms[opt.key] ? 'var(--text-primary)' : 'var(--border-primary)', color: perms[opt.key] ? 'var(--bg-primary)' : 'var(--text-muted)', opacity: opt.always ? 0.7 : 1 }}>
            {perms[opt.key] ? <Check size={10} /> : null}
            {opt.label}
          </button>
        ))}
      </div>

      {shareUrl ? (
        <div className="!flex !flex-col !gap-[8px]">
          <div className="!flex !items-center !gap-[6px] !p-[8px_10px] ![background:var(--bg-tertiary)] !rounded-[8px] ![border:1px_solid_var(--border-faint)]">
            <input className="!flex-[1] ![border:none] ![background:none] !text-[length:11px] ![color:var(--text-primary)] ![outline:none] ![font-family:monospace]" type="text" value={shareUrl} readOnly />
            <button className="!flex !items-center !gap-[4px] !p-[4px_8px] !rounded-[6px] ![border:none] !text-[length:10px] !font-[600] !cursor-pointer ![font-family:inherit] ![transition:background_0.2s]" onClick={handleCopy} style={{ background: copied ? '#16a34a' : 'var(--accent)', color: copied ? 'white' : 'var(--accent-text)' }}>
              {copied ? <><Check size={10} /> {t('common.copied')}</> : <><Copy size={10} /> {t('common.copy')}</>}
            </button>
          </div>
          <button className="!flex !items-center !justify-center !gap-[5px] !p-[6px_0] !rounded-[8px] ![border:1px_solid_rgba(239,68,68,0.3)] ![background:rgba(239,68,68,0.06)] ![color:#ef4444] !text-[length:11px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={handleDelete}>
            <Trash2 size={11} /> {t('share.deleteLink')}
          </button>
        </div>
      ) : (
        <button className="!flex !items-center !justify-center !gap-[6px] !w-[100%] !p-[8px_0] !rounded-[8px] ![border:1px_dashed_var(--border-primary)] ![background:none] ![color:var(--text-muted)] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]" onClick={handleCreate}>
          <Link2 size={12} /> {t('share.createLink')}
        </button>
      )}
    </div>
  )
}

interface TripMembersModalProps {
  isOpen: boolean
  onClose: () => void
  tripId: number | string
  tripTitle: string
}

export default function TripMembersModal({ isOpen, onClose, tripId, tripTitle }: TripMembersModalProps) {
  const [data, setData] = useState(null)
  const [allUsers, setAllUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const toast = useToast()
  const { user } = useAuthStore()
  const { t } = useTranslation()
  const can = useCanDo()
  const trip = useTripStore((s) => s.trip)
  const canManageMembers = can('member_manage', trip)
  const canManageShare = can('share_manage', trip)

  useEffect(() => {
    if (isOpen && tripId) {
      loadMembers()
      loadAllUsers()
    }
  }, [isOpen, tripId])

  const loadMembers = async () => {
    setLoading(true)
    try {
      const d = await tripsApi.getMembers(tripId)
      setData(d)
    } catch {
      toast.error(t('members.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const loadAllUsers = async () => {
    try {
      const d = await authApi.listUsers()
      setAllUsers(d.users)
    } catch {}
  }

  const handleAdd = async () => {
    if (!selectedUserId) return
    setAdding(true)
    try {
      const target = allUsers.find(u => String(u.id) === String(selectedUserId))
      await tripsApi.addMember(tripId, target.username)
      setSelectedUserId('')
      await loadMembers()
      toast.success(`${target.username} ${t('members.added')}`)
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, t('members.addError')))
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (userId, isSelf) => {
    const msg = isSelf
      ? t('members.confirmLeave')
      : t('members.confirmRemove')
    if (!confirm(msg)) return
    setRemovingId(userId)
    try {
      await tripsApi.removeMember(tripId, userId)
      if (isSelf) { onClose(); window.location.reload() }
      else { await loadMembers(); toast.success(t('members.removed')) }
    } catch {
      toast.error(t('members.removeError'))
    } finally {
      setRemovingId(null)
    }
  }

  // Users not yet in the trip
  const existingIds = new Set([
    data?.owner?.id,
    ...(data?.members?.map(m => m.id) || []),
  ])
  const availableUsers = allUsers.filter(u => !existingIds.has(u.id))

  const isCurrentOwner = data?.owner?.id === user?.id
  const allMembers = data ? [
    { ...data.owner, role: 'owner' },
    ...data.members,
  ] : []

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('members.shareTrip')} size="3xl">
      <div style={{ gridTemplateColumns: canManageShare ? '1fr 1fr' : '1fr', fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }} className="share-modal-grid !grid !gap-[24px]">
        <style>{`@media (max-width: 640px) { .share-modal-grid { grid-template-columns: 1fr !important; } }`}</style>

        {/* Left column: Members */}
        <div className="!flex !flex-col !gap-[16px]">

        {/* Trip name */}
        <div className="!p-[10px_14px] ![background:var(--bg-secondary)] !rounded-[10px] ![border:1px_solid_var(--border-secondary)]">
          <div className="!text-[length:11px] !font-[600] ![color:var(--text-faint)] !uppercase !tracking-[0.05em] !mb-[2px]">{t('nav.trip')}</div>
          <div className="!text-[length:14px] !font-[600] ![color:var(--text-primary)]">{tripTitle}</div>
        </div>

        {/* Add member dropdown */}
        {canManageMembers && <div>
          <label className="!block !text-[length:12px] !font-[600] ![color:var(--text-secondary)] !mb-[8px]">
            {t('members.inviteUser')}
          </label>
          <div className="!flex !gap-[8px]">
            <CustomSelect
              value={selectedUserId}
              onChange={value => setSelectedUserId(value)}
              placeholder={t('members.selectUser')}
              options={[
                { value: '', label: t('members.selectUser') },
                ...availableUsers.map(u => ({
                  value: u.id,
                  label: u.username,
                })),
              ]}
              searchable
              style={{ flex: 1 }}
              size="sm"
            />
            <button className="!flex !items-center !gap-[5px] !p-[8px_14px] ![background:var(--accent)] ![color:var(--accent-text)] ![border:none] !rounded-[10px] !text-[length:13px] !font-[600] ![font-family:inherit] !shrink-[0]"
              onClick={handleAdd}
              disabled={adding || !selectedUserId}
              style={{ cursor: adding || !selectedUserId ? 'default' : 'pointer', opacity: adding || !selectedUserId ? 0.4 : 1 }}
            >
              <UserPlus size={13} /> {adding ? '…' : t('members.invite')}
            </button>
          </div>
          {availableUsers.length === 0 && allUsers.length > 0 && canManageMembers && (
            <p className="!text-[length:11.5px] ![color:var(--text-faint)] !m-[6px_0_0]">{t('members.allHaveAccess')}</p>
          )}
        </div>}

        {/* Members list */}
        <div>
          <div className="!flex !items-center !gap-[6px] !mb-[10px]">
            <Users size={13} style={{ color: 'var(--text-faint)' }} />
            <span className="!text-[length:12px] !font-[600] ![color:var(--text-secondary)]">
              {t('members.access')} ({allMembers.length} {allMembers.length === 1 ? t('members.person') : t('members.persons')})
            </span>
          </div>

          {loading ? (
            <div className="!flex !flex-col !gap-[8px]">
              {[1, 2].map(i => (
                <div className="!h-[48px] ![background:var(--bg-tertiary)] !rounded-[10px]" key={i} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          ) : (
            <div className="!flex !flex-col !gap-[6px]">
              {allMembers.map(member => {
                const isSelf = member.id === user?.id
                const canRemove = isSelf || (canManageMembers && member.role !== 'owner')
                return (
                  <div className="!flex !items-center !gap-[10px] !p-[8px_12px] !rounded-[10px] ![background:var(--bg-secondary)] ![border:1px_solid_var(--border-secondary)]" key={member.id}>
                    <Avatar username={member.username} avatarUrl={member.avatar_url} />
                    <div className="!flex-[1] !min-w-[0]">
                      <div className="!flex !items-center !gap-[6px] !flex-wrap">
                        <span className="!text-[length:13px] !font-[600] ![color:var(--text-primary)]">{member.username}</span>
                        {isSelf && <span className="!text-[length:10px] ![color:var(--text-faint)]">({t('members.you')})</span>}
                        {member.role === 'owner' && (
                          <span className="!inline-flex !items-center !gap-[3px] !text-[length:10px] !font-[700] ![color:#d97706] ![background:#fef9c3] !p-[1px_6px] !rounded-[99px]">
                            <Crown size={9} /> {t('members.owner')}
                          </span>
                        )}
                      </div>
                    </div>
                    {canRemove && (
                      <button className="trek-hover-danger ![background:none] ![border:none] !cursor-pointer !p-[4px] !rounded-[6px] !flex ![color:var(--text-faint)]"
                        onClick={() => handleRemove(member.id, isSelf)}
                        disabled={removingId === member.id}
                        title={isSelf ? t('members.leaveTrip') : t('members.removeAccess')}
                        style={{ opacity: removingId === member.id ? 0.4 : 1 }} >
                        {isSelf ? <LogOut size={14} /> : <UserMinus size={14} />}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        </div>

        {/* Right column: Share Link */}
        {canManageShare && <div className="![border-left:1px_solid_var(--border-faint)] !pl-[24px]">
        <ShareLinkSection tripId={tripId} t={t} />
        </div>}

        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      </div>
    </Modal>
  )
}
