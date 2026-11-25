import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { History, X } from 'lucide-react'
import { loadNavDraft, type NavDraft } from '../../services/navDraftStore'

/**
 * When Android closes the app in the middle of a ride, it comes back on the
 * dashboard, not on the navigation screen. This notice says there is a
 * recording to recover and takes you back to where it was being made, where
 * the navigation screen offers to carry on with it or to save it.
 */
export default function NavDraftNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<NavDraft | null>(null)
  const [hidden, setHidden] = useState(false)

  const onNavigation = location.pathname.startsWith('/navigate')

  useEffect(() => {
    if (onNavigation) return
    let alive = true
    loadNavDraft().then(d => { if (alive) setDraft(d) })
    return () => { alive = false }
  }, [onNavigation])

  if (!draft || hidden || onNavigation) return null

  return (
    <div
      data-testid="nav-draft-notice"
      className="!fixed !left-[12px] !right-[12px] !z-[1000] !rounded-[14px] !p-[12px_14px] !flex !items-center !gap-[10px] ![background:#0f172a] ![border:1px_solid_rgba(56,189,248,0.4)] ![box-shadow:0_8px_30px_rgba(0,0,0,0.35)]"
      style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}
    >
      <History size={18} color="#38bdf8" style={{ flexShrink: 0 }} />
      <button
        className="!flex-[1] !text-left ![background:none] ![border:none] !p-[0] !cursor-pointer !min-w-[0]"
        onClick={() => navigate(draft.path || '/navigate')}
      >
        <div className="!text-[length:13px] ![color:#f1f5f9] !font-[700]">Tienes una grabación sin terminar</div>
        <div className="!text-[length:11px] ![color:#94a3b8] !overflow-hidden !text-ellipsis !whitespace-nowrap">
          {draft.trackName} · toca para recuperarla
        </div>
      </button>
      <button
        aria-label="Ocultar"
        className="![background:none] ![border:none] !p-[4px] !cursor-pointer"
        onClick={() => setHidden(true)}
      >
        <X size={16} color="#64748b" />
      </button>
    </div>
  )
}
