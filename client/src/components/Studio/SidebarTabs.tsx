/** A row of tabs inside a rail section (5.7.12): Elementos and Viaje are sorted this way, as upstream sorts them. */
export function SidebarTabs<V extends string>({ value, onChange, tabs, label, testId }: {
  value: V; onChange: (v: V) => void; tabs: { id: V; label: string }[]; label: string; testId?: string
}) {
  return (
    <div role="tablist" aria-label={label} data-testid={testId} style={{ display: 'flex', gap: 2, padding: 2, marginBottom: 10, borderRadius: 8, background: 'var(--bg-tertiary)' }}>
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id} data-value={tab.id} onClick={() => onChange(tab.id)}
          style={{
            flex: 1, minWidth: 0, padding: '5px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            background: value === tab.id ? 'var(--bg-card)' : 'transparent', color: value === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
            boxShadow: value === tab.id ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
          }}>{tab.label}</button>
      ))}
    </div>
  )
}
