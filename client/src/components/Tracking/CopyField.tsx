import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** A read-only value with a copy button — the endpoint, a token, a share link. */
export function CopyField({ value, label, mono, testId }: { value: string; label: string; mono?: boolean; testId?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* the field stays selectable for a manual copy */ }
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
      style={{ background: 'var(--glass-bg-subtle, var(--bg-tertiary))', border: '1px solid var(--glass-border-inner, var(--border-primary))', color: 'var(--text-primary)' }}>
      <input readOnly value={value} aria-label={label} data-testid={testId} onFocus={e => e.currentTarget.select()}
        className="flex-1 min-w-0 bg-transparent outline-none" style={{ fontFamily: mono ? 'ui-monospace, monospace' : undefined, fontSize: mono ? 12 : undefined }} />
      <button type="button" onClick={copy} aria-label={label} title={label} style={{ color: 'var(--text-secondary)' }}>
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  )
}
