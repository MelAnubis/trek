import { useState, useEffect, useMemo } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useTranslation } from '../../i18n'
import { MessageCircle, StickyNote, BarChart3, Sparkles } from 'lucide-react'
import CollabChat from './CollabChat'
import CollabNotes from './CollabNotes'
import CollabPolls from './CollabPolls'
import WhatsNextWidget from './WhatsNextWidget'

function useIsDesktop(breakpoint = 1024) {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= breakpoint)
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= breakpoint)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return isDesktop
}

const card: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-faint)',
  overflow: 'hidden', minHeight: 0,
}

interface TripMember {
  id: number
  username: string
  avatar_url?: string | null
}

interface CollabFeatures {
  chat: boolean
  notes: boolean
  polls: boolean
  whatsnext: boolean
}

interface CollabPanelProps {
  tripId: number | string
  tripMembers?: TripMember[]
  collabFeatures?: CollabFeatures
}

const ALL_TABS = [
  { id: 'chat', featureKey: 'chat' as const, labelKey: 'collab.tabs.chat', fallback: 'Chat', icon: MessageCircle },
  { id: 'notes', featureKey: 'notes' as const, labelKey: 'collab.tabs.notes', fallback: 'Notes', icon: StickyNote },
  { id: 'polls', featureKey: 'polls' as const, labelKey: 'collab.tabs.polls', fallback: 'Polls', icon: BarChart3 },
  { id: 'next', featureKey: 'whatsnext' as const, labelKey: 'collab.whatsNext.title', fallback: "What's Next", icon: Sparkles },
]

export default function CollabPanel({ tripId, tripMembers = [], collabFeatures }: CollabPanelProps) {
  const { user } = useAuthStore()
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()

  const features = collabFeatures || { chat: true, notes: true, polls: true, whatsnext: true }

  const tabs = useMemo(() =>
    ALL_TABS.filter(tab => features[tab.featureKey]).map(tab => ({
      ...tab,
      label: t(tab.labelKey) || tab.fallback,
    })),
  [features, t])

  const [mobileTab, setMobileTab] = useState(() => tabs[0]?.id || 'chat')

  // If active tab gets disabled, switch to first available
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some(t => t.id === mobileTab)) {
      setMobileTab(tabs[0].id)
    }
  }, [tabs, mobileTab])

  const chatOn = features.chat
  const rightPanels = [
    features.notes && 'notes',
    features.polls && 'polls',
    features.whatsnext && 'whatsnext',
  ].filter(Boolean) as string[]

  if (tabs.length === 0) return null

  if (isDesktop) {
    // Chat always 380px fixed when on. Right panels share remaining space.
    // If chat off, all panels share full width equally.
    if (chatOn && rightPanels.length === 0) {
      // Only chat
      return (
        <div className="!h-[100%] !flex !gap-[12px] !p-[12px] !overflow-hidden !min-h-[0]">
          <div className="!flex-[1]" style={{ ...card }}>
            <CollabChat tripId={tripId} currentUser={user} />
          </div>
        </div>
      )
    }

    if (chatOn) {
      // Chat left (380px) + right panels
      return (
        <div className="!h-[100%] !flex !gap-[12px] !p-[12px] !overflow-hidden !min-h-[0]">
          <div className="!flex-[0_0_380px]" style={{ ...card }}>
            <CollabChat tripId={tripId} currentUser={user} />
          </div>
          <div className="!flex-[1] !flex !flex-col !gap-[12px] !overflow-hidden !min-h-[0]">
            {rightPanels.length === 1 && (
              <div className="!flex-[1]" style={{ ...card }}>
                {rightPanels[0] === 'notes' && <CollabNotes tripId={tripId} currentUser={user} />}
                {rightPanels[0] === 'polls' && <CollabPolls tripId={tripId} currentUser={user} />}
                {rightPanels[0] === 'whatsnext' && <WhatsNextWidget tripMembers={tripMembers} />}
              </div>
            )}
            {rightPanels.length === 2 && rightPanels.map(p => (
              <div className="!flex-[1]" key={p} style={{ ...card }}>
                {p === 'notes' && <CollabNotes tripId={tripId} currentUser={user} />}
                {p === 'polls' && <CollabPolls tripId={tripId} currentUser={user} />}
                {p === 'whatsnext' && <WhatsNextWidget tripMembers={tripMembers} />}
              </div>
            ))}
            {rightPanels.length === 3 && (
              <>
                <div className="!flex-[1]" style={{ ...card }}>
                  <CollabNotes tripId={tripId} currentUser={user} />
                </div>
                <div className="!flex-[1] !flex !gap-[12px] !overflow-hidden !min-h-[0]">
                  <div className="!flex-[1]" style={{ ...card }}>
                    <CollabPolls tripId={tripId} currentUser={user} />
                  </div>
                  <div className="!flex-[1]" style={{ ...card }}>
                    <WhatsNextWidget tripMembers={tripMembers} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )
    }

    // Chat off — remaining panels share full width
    const panels = rightPanels
    if (panels.length === 1) {
      return (
        <div className="!h-[100%] !flex !gap-[12px] !p-[12px] !overflow-hidden !min-h-[0]">
          <div className="!flex-[1]" style={{ ...card }}>
            {panels[0] === 'notes' && <CollabNotes tripId={tripId} currentUser={user} />}
            {panels[0] === 'polls' && <CollabPolls tripId={tripId} currentUser={user} />}
            {panels[0] === 'whatsnext' && <WhatsNextWidget tripMembers={tripMembers} />}
          </div>
        </div>
      )
    }

    return (
      <div className="!h-[100%] !flex !gap-[12px] !p-[12px] !overflow-hidden !min-h-[0]">
        {panels.map(p => (
          <div className="!flex-[1]" key={p} style={{ ...card }}>
            {p === 'notes' && <CollabNotes tripId={tripId} currentUser={user} />}
            {p === 'polls' && <CollabPolls tripId={tripId} currentUser={user} />}
            {p === 'whatsnext' && <WhatsNextWidget tripMembers={tripMembers} />}
          </div>
        ))}
      </div>
    )
  }

  // Mobile: tab bar + single panel (only enabled tabs)
  return (
    <div className="!h-[100%] !flex !flex-col !overflow-hidden !absolute !inset-[0]">
      <div className="!flex !gap-[2px] !p-[8px_12px] ![border-bottom:1px_solid_var(--border-faint)] ![background:var(--bg-card)] !shrink-[0]">
        {tabs.map(tab => {
          const active = mobileTab === tab.id
          return (
            <button className="!flex-[1] !flex !items-center !justify-center !gap-[6px] !p-[8px_0] !rounded-[10px] ![border:none] !cursor-pointer !text-[length:11px] !font-[600] ![font-family:inherit] ![transition:all_0.15s]" key={tab.id} onClick={() => setMobileTab(tab.id)} style={{ background: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent-text)' : 'var(--text-muted)' }}>
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="!flex-[1] !overflow-hidden !min-h-[0]">
        {mobileTab === 'chat' && features.chat && <CollabChat tripId={tripId} currentUser={user} />}
        {mobileTab === 'notes' && features.notes && <CollabNotes tripId={tripId} currentUser={user} />}
        {mobileTab === 'polls' && features.polls && <CollabPolls tripId={tripId} currentUser={user} />}
        {mobileTab === 'next' && features.whatsnext && <WhatsNextWidget tripMembers={tripMembers} />}
      </div>
    </div>
  )
}
