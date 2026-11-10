import React from 'react'

export default function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button className="!relative !w-[44px] !h-[24px] !min-w-[44px] !shrink-[0] !rounded-[12px] ![border:none] !p-[0] !cursor-pointer ![transition:background_0.2s]" type="button" onClick={onToggle}
      style={{ background: on ? 'var(--accent, #111827)' : 'var(--border-primary, #d1d5db)' }}>
      <span className="!absolute !w-[20px] !h-[20px] !rounded-[50%] ![background:white] ![transition:left_0.2s] ![box-shadow:0_1px_3px_rgba(0,0,0,0.2)]" style={{ top: 2, left: on ? 22 : 2 }} />
    </button>
  )
}
