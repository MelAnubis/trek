import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Layout/Navbar'
import { useTranslation } from '../i18n'
import { useArteAccess } from '../hooks/useArteAccess'
import { usePermissionsStore } from '../store/permissionsStore'
import { useAuthStore } from '../store/authStore'

/**
 * Mapas ilustrados (Arte). The module is a self-contained static app (plain
 * HTML + JS modules, see /arte in the repo) served by the server under
 * /api/arte/ and shown here in a same-origin iframe, so its drawing and GPX
 * validation code runs untouched. This page only gives it Trek's chrome and
 * theme: the colour tokens of the current theme are copied onto the frame's
 * root element, and again whenever the theme changes.
 */

const THEME_VARS = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-card', '--bg-input', '--bg-hover', '--bg-selected',
  '--text-primary', '--text-secondary', '--text-muted', '--text-faint',
  '--border-primary', '--border-secondary',
  '--accent', '--accent-hover', '--accent-light', '--accent-text',
  '--modal-backdrop', '--font-system',
]

/** Query parameters handed through to the module (e.g. open one of the user's routes). */
const PASS_PARAMS = ['planner', 'tour', 'track', 'composicion']

export default function ArtePage(): React.ReactElement {
  const { t } = useTranslation()
  const allowed = useArteAccess()
  const permsLoaded = usePermissionsStore(s => Object.keys(s.permissions).length > 0)
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [searchParams] = useSearchParams()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)

  // Fixed for the life of the page: changing the URL would reload the module and lose unsaved work.
  const [src] = useState(() => {
    const q = new URLSearchParams()
    for (const k of PASS_PARAMS) {
      const v = searchParams.get(k)
      if (v) q.set(k, v)
    }
    const qs = q.toString()
    return `/api/arte/${qs ? `?${qs}` : ''}`
  })

  const applyTheme = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc?.documentElement) return
    const root = document.documentElement
    const cs = getComputedStyle(root)
    for (const v of THEME_VARS) {
      const val = cs.getPropertyValue(v).trim()
      if (val) doc.documentElement.style.setProperty(v, val)
    }
    doc.documentElement.classList.toggle('dark', root.classList.contains('dark'))
    doc.documentElement.classList.add('en-trek')
  }, [])

  useEffect(() => {
    const obs = new MutationObserver(applyTheme)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => obs.disconnect()
  }, [applyTheme])

  if (!isAdmin && permsLoaded && !allowed) return <Navigate to="/dashboard" replace />

  return (
    <div className="page-bg ![background:var(--bg-secondary)]">
      <Navbar />
      <div className="!fixed !top-[var(--nav-h)] !left-[0] !right-[0] !bottom-[var(--bottom-nav-h)] ![background:var(--bg-secondary)]">
        <iframe
          ref={frameRef}
          src={src}
          title={t('arte.title')}
          onLoad={() => { applyTheme(); setReady(true) }}
          style={{ width: '100%', height: '100%', border: 0, display: 'block', visibility: ready ? 'visible' : 'hidden' }}
        />
      </div>
    </div>
  )
}
