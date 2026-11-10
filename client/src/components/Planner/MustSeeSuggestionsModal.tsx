// ─────────────────────────────────────────────────────────────────────────────
// MustSeeSuggestionsModal.tsx
//
// AI-powered "Must See Places" modal.
// Calls the backend to get Claude suggestions for a trip, shows a checklist
// with photos, and adds selected places to the trip.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { X, Sparkles, Loader2, MapPin, CheckCircle2, AlertCircle, ImageOff } from 'lucide-react'
import { suggestionsApi, placesApi, assignmentsApi } from '../../api/client'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { findNearestDay } from '../../utils/geoUtils'
import type { Day, AssignmentsMap } from '../../types'

interface Suggestion {
  name: string
  description: string
  category: string
  lat: number | null
  lng: number | null
  address: string | null
  photo_url?: string | null
  /** Which confirmed stop or intermediate town this is near (from the backend) */
  near_place?: string | null
}

interface Props {
  tripId: number | string
  onClose: () => void
  onAdded: () => void       // called after places are successfully added
  lang?: string
  days?: Day[]
  assignments?: AssignmentsMap
}

const CATEGORY_COLORS: Record<string, string> = {
  Nature:        '#16a34a',
  Museum:        '#7c3aed',
  Monument:      '#b45309',
  Viewpoint:     '#0284c7',
  Food:          '#dc2626',
  Market:        '#ea580c',
  Beach:         '#0891b2',
  Architecture:  '#6d28d9',
  Park:          '#15803d',
  Religious:     '#92400e',
  Entertainment: '#be185d',
  Other:         '#64748b',
}

function getCategoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Other
}

export default function MustSeeSuggestionsModal({ tripId, onClose, onAdded, lang = 'en', days = [], assignments = {} }: Props) {
  const { t } = useTranslation()
  const toast = useToast()

  const [step, setStep]             = useState<'loading' | 'results' | 'adding' | 'done' | 'error'>('loading')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selected, setSelected]     = useState<Set<number>>(new Set())
  const [error, setError]           = useState('')
  const [addingProgress, setAddingProgress] = useState(0)

  useEffect(() => { fetchSuggestions() }, [])

  async function fetchSuggestions() {
    setStep('loading')
    setError('')
    try {
      const data = await suggestionsApi.mustSee(tripId, lang)
      setSuggestions(data.suggestions)
      // Pre-select all
      setSelected(new Set(data.suggestions.map((_, i) => i)))
      setStep('results')
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Unknown error'
      setError(msg)
      setStep('error')
    }
  }

  function toggleSelect(idx: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === suggestions.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(suggestions.map((_, i) => i)))
    }
  }

  async function handleAdd() {
    const toAdd = suggestions.filter((_, i) => selected.has(i))
    if (toAdd.length === 0) return
    setStep('adding')
    setAddingProgress(0)

    // Keep a live snapshot of assignments so each new place is placed correctly
    // even when previous additions in this batch shift the centroid
    const liveAssignments: AssignmentsMap = { ...assignments }

    // Pre-sort suggestions by latitude so the fallback round-robin distributes
    // them geographically across days (north→south or vice-versa)
    const sorted = [...toAdd].sort((a, b) => (a.lat ?? 0) - (b.lat ?? 0))

    let added = 0
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]
      try {
        const data = await placesApi.create(tripId, {
          name:        s.name,
          description: s.description,
          lat:         s.lat,
          lng:         s.lng,
          address:     s.address,
          image_url:   s.photo_url ?? null,
        })
        const place = data?.place
        added++

        if (place?.id && days.length > 0) {
          // 1st choice: geo-based nearest day (works when days already have places)
          let targetDayId: number | null = null
          if (place.lat != null && place.lng != null) {
            targetDayId = findNearestDay(place.lat, place.lng, days, liveAssignments)
          }
          // Fallback: distribute evenly across days when centroids aren't available
          if (!targetDayId) {
            targetDayId = days[i % days.length].id
          }

          try {
            const assignData = await assignmentsApi.create(tripId, targetDayId, { place_id: place.id })
            // Update live snapshot so subsequent places use up-to-date centroids
            const existing = liveAssignments[String(targetDayId)] ?? []
            liveAssignments[String(targetDayId)] = [...existing, assignData.assignment]
          } catch { /* best effort */ }
        }
      } catch { /* skip silently — partial success is fine */ }
      setAddingProgress(Math.round((added / toAdd.length) * 100))
    }

    setStep('done')
    toast.success(`${added} ${added === 1 ? 'lugar añadido' : 'lugares añadidos'} al viaje`)
    setTimeout(() => {
      onAdded()
      onClose()
    }, 1200)
  }

  const allSelected = suggestions.length > 0 && selected.size === suggestions.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 ![background:rgba(0,0,0,0.55)] ![backdrop-filter:blur(3px)]">
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full !max-w-[540px] !max-h-[90vh] !flex-col"
        style={{ display: 'flex' }}
      >

        {/* ── Header ── */}
        <div className="!items-center !gap-[8px] !p-[16px_20px_12px] ![border-bottom:1px_solid_var(--border-faint)] !shrink-[0]" style={{ display: 'flex' }}>
          <Sparkles size={18} style={{ color: '#f59e0b' }} />
          <span className="!font-[700] !text-[length:15px] !flex-[1] ![color:var(--text-primary)]">
            Lugares imprescindibles
          </span>
          <button className="!items-center !justify-center !w-[28px] !h-[28px] !rounded-[8px] ![border:none] ![background:var(--bg-hover)] ![color:var(--text-muted)] !cursor-pointer"
            onClick={onClose}
            style={{ display: 'flex' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="!flex-[1] !overflow-y-auto !p-[0_20px]">

          {/* Loading */}
          {step === 'loading' && (
            <div className="!flex-col !items-center !justify-center !gap-[14px] !p-[48px_0] ![color:var(--text-muted)]" style={{ display: 'flex' }}>
              <Loader2 size={32} className="animate-spin" style={{ color: '#f59e0b' }} />
              <div className="!text-center">
                <div className="!font-[600] !text-[length:14px] !mb-[4px] ![color:var(--text-primary)]">Consultando con la IA…</div>
                <div className="!text-[length:12px]">Esto puede tardar unos segundos</div>
              </div>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="!flex-col !items-center !justify-center !gap-[12px] !p-[40px_0]" style={{ display: 'flex' }}>
              <AlertCircle size={32} style={{ color: '#ef4444' }} />
              <div className="!text-center">
                <div className="!font-[600] !text-[length:14px] !mb-[6px] ![color:var(--text-primary)]">No se pudieron obtener sugerencias</div>
                <div className="!text-[length:12px] ![color:var(--text-muted)] !max-w-[320px]">{error}</div>
              </div>
              <button className="!mt-[8px] !p-[8px_20px] !rounded-[10px] ![background:var(--accent)] ![color:var(--accent-text)] ![border:none] !text-[length:13px] !font-[600] !cursor-pointer"
                onClick={fetchSuggestions}
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Done */}
          {step === 'done' && (
            <div className="!flex-col !items-center !justify-center !gap-[12px] !p-[48px_0] ![color:#16a34a]" style={{ display: 'flex' }}>
              <CheckCircle2 size={40} />
              <span className="!font-[700] !text-[length:15px]">¡Lugares añadidos!</span>
            </div>
          )}

          {/* Adding (progress) */}
          {step === 'adding' && (
            <div className="!flex-col !items-center !justify-center !gap-[14px] !p-[48px_0]" style={{ display: 'flex' }}>
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <div className="!w-[60%] !h-[6px] !rounded-[99px] ![background:var(--border-faint)] !overflow-hidden">
                <div className="!h-[100%] ![background:var(--accent)] ![transition:width_0.3s_ease] !rounded-[99px]" style={{ width: `${addingProgress}%` }} />
              </div>
              <span className="!text-[length:12px] ![color:var(--text-muted)]">Añadiendo lugares… {addingProgress}%</span>
            </div>
          )}

          {/* Results */}
          {step === 'results' && (
            <>
              <div className="!items-center !justify-between !p-[12px_0_8px]" style={{ display: 'flex' }}>
                <span className="!text-[length:12px] ![color:var(--text-muted)]">
                  {selected.size} de {suggestions.length} seleccionados
                </span>
                <button className="!text-[length:12px] ![color:var(--accent)] ![background:none] ![border:none] !cursor-pointer !font-[500] !p-[0]"
                  onClick={toggleAll}
                >
                  {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </button>
              </div>

              <div className="!flex-col !gap-[8px] !pb-[16px]" style={{ display: 'flex' }}>
                {suggestions.map((s, idx) => {
                  const isSelected = selected.has(idx)
                  const catColor = getCategoryColor(s.category)
                  return (
                    <div className="!gap-[0] !rounded-[12px] !overflow-hidden !cursor-pointer ![transition:border-color_0.15s]"
                      key={idx}
                      onClick={() => toggleSelect(idx)}
                      style={{ display: 'flex', border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-faint)'}`, background: isSelected ? 'var(--accent-bg, rgba(99,102,241,0.04))' : 'var(--bg-primary)' }}
                    >
                      {/* Photo */}
                      <div className="!w-[72px] !shrink-[0] ![background:#f1f5f9] !overflow-hidden !relative">
                        {s.photo_url ? (
                          <img className="!w-[100%] !h-[100%] !object-cover"
                            src={s.photo_url}
                            alt={s.name}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div className="!items-center !justify-center !h-[100%] ![color:#94a3b8]" style={{ display: 'flex' }}>
                            <ImageOff size={20} />
                          </div>
                        )}
                        {/* Selection indicator */}
                        <div className="!absolute !top-[4px] !right-[4px] !w-[18px] !h-[18px] !rounded-[50%] !items-center !justify-center ![transition:all_0.15s]" style={{ background: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.85)', border: `2px solid ${isSelected ? 'var(--accent)' : 'rgba(0,0,0,0.2)'}`, display: 'flex' }}>
                          {isSelected && <CheckCircle2 size={11} style={{ color: '#fff' }} />}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="!flex-[1] !p-[10px_12px] !min-w-[0]">
                        <div className="!items-start !gap-[6px] !mb-[3px]" style={{ display: 'flex' }}>
                          <span className="!font-[600] !text-[length:13px] ![color:var(--text-primary)] !flex-[1] !leading-[1.3]">{s.name}</span>
                          <span className="!shrink-[0] !text-[length:10px] !font-[600] !p-[2px_7px] !rounded-[99px]" style={{ background: catColor + '22', color: catColor }}>
                            {s.category}
                          </span>
                        </div>
                        {s.near_place && (
                          <div className="!text-[length:10px] ![color:var(--text-faint)] !mb-[3px] !italic">
                            cerca de {s.near_place.split(',')[0]}
                          </div>
                        )}
                        <p className="!text-[length:11.5px] ![color:var(--text-muted)] !m-[0] !leading-[1.45]">{s.description}</p>
                        {s.address && (
                          <div className="!items-center !gap-[3px] !mt-[5px]" style={{ display: 'flex' }}>
                            <MapPin size={10} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                            <span className="!text-[length:10px] ![color:var(--text-faint)] !overflow-hidden !text-ellipsis !whitespace-nowrap">
                              {s.address}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        {step === 'results' && (
          <div className="!items-center !justify-end !gap-[8px] !p-[12px_20px] ![border-top:1px_solid_var(--border-faint)] !shrink-[0]" style={{ display: 'flex' }}>
            <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] ![color:var(--text-secondary)] !text-[length:13px] !cursor-pointer"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="!items-center !gap-[6px] !p-[8px_18px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[600] ![transition:background_0.15s]"
              onClick={handleAdd}
              disabled={selected.size === 0}
              style={{ display: 'flex', background: selected.size === 0 ? 'var(--border-faint)' : 'var(--accent)', color: selected.size === 0 ? 'var(--text-muted)' : 'var(--accent-text)', cursor: selected.size === 0 ? 'not-allowed' : 'pointer' }}
            >
              <MapPin size={13} />
              Añadir {selected.size} lugar{selected.size !== 1 ? 'es' : ''}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
