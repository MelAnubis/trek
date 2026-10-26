// Una tarjeta plegable de la columna del planificador (RailCard de la v5).
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export default function RailCard({ icon, title, aside, children, defaultOpen = true, testId }: {
  icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-testid={testId} style={{ border: '1px solid var(--border-faint)', borderRadius: 14, background: 'var(--bg-card)' }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '11px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 600, textAlign: 'left' }}>
        <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {aside}
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && <div style={{ padding: '2px 12px 12px', borderTop: '1px solid var(--border-faint)' }}>{children}</div>}
    </div>
  )
}
