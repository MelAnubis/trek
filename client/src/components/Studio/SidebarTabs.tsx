/** A row of tabs inside a rail section (5.7.12): Elementos and Viaje are sorted this way, as upstream sorts them. */
export function SidebarTabs<V extends string>({ value, onChange, tabs, label, testId }: {
  value: V; onChange: (v: V) => void; tabs: { id: V; label: string }[]; label: string; testId?: string
}) {
  return (
    <div className="!flex !gap-[2px] !p-[2px] !mb-[10px] !rounded-[8px] ![background:var(--bg-tertiary)]" role="tablist" aria-label={label} data-testid={testId}>
      {tabs.map(tab => (
        <button className="!flex-[1] !min-w-[0] !p-[5px_4px] !rounded-[6px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:10.5px] !font-[600] !whitespace-nowrap !overflow-hidden !text-ellipsis" key={tab.id} type="button" role="tab" aria-selected={value === tab.id} data-value={tab.id} onClick={() => onChange(tab.id)}
          style={{ background: value === tab.id ? 'var(--bg-card)' : 'transparent', color: value === tab.id ? 'var(--text-primary)' : 'var(--text-muted)', boxShadow: value === tab.id ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{tab.label}</button>
      ))}
    </div>
  )
}
