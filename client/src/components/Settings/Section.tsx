import React from 'react'
import type { LucideIcon } from 'lucide-react'

interface SectionProps {
  title: string
  icon: LucideIcon
  children: React.ReactNode
}

export default function Section({ title, icon: Icon, children }: SectionProps): React.ReactElement {
  return (
    <div
      className="rounded-2xl overflow-hidden ![background:var(--glass-bg)] ![backdrop-filter:var(--glass-blur)] ![-webkit-backdrop-filter:var(--glass-blur)] ![border:1px_solid_var(--glass-border)] ![box-shadow:var(--glass-shadow)] !mb-[24px]"
    >
      <div
        className="px-5 py-3.5 flex items-center gap-2 ![border-bottom:1px_solid_var(--glass-border-inner)]"
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ![background:var(--glass-bg-subtle)] ![border:1px_solid_var(--glass-border-inner)]"
        >
          <Icon className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
        </div>
        <h2 className="text-sm font-semibold ![color:var(--text-primary)]">{title}</h2>
      </div>
      <div className="p-5 space-y-4">
        {children}
      </div>
    </div>
  )
}
