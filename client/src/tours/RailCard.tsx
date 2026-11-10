// Una tarjeta plegable de la columna del planificador (RailCard de la v5).
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export default function RailCard({ icon, title, aside, children, defaultOpen = true, testId }: {
  icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="![border:1px_solid_var(--border-faint)] !rounded-[14px] ![background:var(--bg-card)]" data-testid={testId}>
      <button className="!flex !items-center !gap-[8px] !w-[100%] !p-[11px_12px] ![border:none] ![background:transparent] !cursor-pointer ![font-family:inherit] ![color:var(--text-primary)] !text-[length:13.5px] !font-[600] !text-left" type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="![color:var(--text-muted)] !flex">{icon}</span>
        <span className="!flex-[1]">{title}</span>
        {aside}
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {open && <div className="!p-[2px_12px_12px] ![border-top:1px_solid_var(--border-faint)]">{children}</div>}
    </div>
  )
}
