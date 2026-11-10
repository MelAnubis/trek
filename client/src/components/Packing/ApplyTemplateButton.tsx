import React, { useEffect, useRef, useState } from 'react'
import { Package } from 'lucide-react'
import { adminApi, packingApi } from '../../api/client'
import { useTripStore } from '../../store/tripStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'

interface Template {
  id: number
  name: string
  item_count: number
}

interface ApplyTemplateButtonProps {
  tripId: number | string
  style: React.CSSProperties
  className?: string
}

// Dropdown-Button um ein Packing-Template auf den aktuellen Trip anzuwenden.
// Rendert nichts wenn keine Templates existieren.
export default function ApplyTemplateButton({ tripId, style, className }: ApplyTemplateButtonProps): React.ReactElement | null {
  const [templates, setTemplates] = useState<Template[]>([])
  const [open, setOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const { t } = useTranslation()

  useEffect(() => {
    adminApi.packingTemplates().then(d => setTemplates(d.templates || [])).catch(() => {})
  }, [tripId])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleApply = async (templateId: number) => {
    setApplying(true)
    try {
      const data = await packingApi.applyTemplate(tripId, templateId)
      useTripStore.setState(s => ({ packingItems: [...s.packingItems, ...(data.items || [])] }))
      toast.success(t('packing.templateApplied', { count: data.count }))
      setOpen(false)
    } catch {
      toast.error(t('packing.templateError'))
    } finally {
      setApplying(false)
    }
  }

  if (templates.length === 0) return null

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        disabled={applying}
        className={className ?? 'hover:opacity-[0.88]'}
        style={style}
      >
        <Package size={14} strokeWidth={2.5} />
        <span className="hidden sm:inline">{t('packing.applyTemplate')}</span>
      </button>
      {open && (
        <div
          className="trek-menu-enter !absolute !right-[0] !top-[100%] !mt-[6px] !z-[50] ![background:var(--bg-card)] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !min-w-[220px] ![transform-origin:top_right]"
        >
          {templates.map(tmpl => (
            <button className="trek-hover-tertiary !flex !items-center !gap-[8px] !w-[100%] !p-[8px_12px] !rounded-[8px] ![border:none] !cursor-pointer ![background:transparent] ![font-family:inherit] !text-[length:12px] ![color:var(--text-primary)]" key={tmpl.id} onClick={() => handleApply(tmpl.id)} >
              <Package size={13} style={{ color: 'var(--text-faint)' }} />
              <div className="!flex-[1] !text-left">
                <div className="!font-[600]">{tmpl.name}</div>
                <div className="!text-[length:10px] ![color:var(--text-faint)]">
                  {tmpl.item_count} {t('admin.packingTemplates.items')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
