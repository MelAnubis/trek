// ─────────────────────────────────────────────────────────────────────────────
// MustSeeSuggestionsModal.tsx
//
// AI-powered "Must See Places" modal.
// Calls the backend to get suggestions for a trip, shows a checklist
// with photos, and adds selected places to the trip.
//
// Smart insertion: each added place is automatically assigned to the correct
// day and inserted at the position that minimises route detour.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { X, Sparkles, Loader2, MapPin, CheckCircle2, AlertCircle, ImageOff } from 'lucide-react'
import { suggestionsApi, placesApi, assignmentsApi } from '../../api/client'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import type { Day, Assignment } from '../../types'

interface Suggestion {
  name: string
  description: string
  category: string
  lat: number | null
  lng: number | null
  address: string | null
  photo_url?: string | null
  near_place?: string | null
}

interface Props {
  tripId: number
  days: Day[]                  // current days with their assignments (including place coords)
  onClose: () => void
  onAdded: () => void
  lang?: string
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

// ── Geographic helpers ────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

/**
 * Given a suggestion and a mutable snapshot of days (with their current
 * assignments), return:
 *  - `dayId`:    the day to assign this suggestion to
 *  - `insertAt`: the 0-based index to insert at within that day's assignments
 *
 * Day selection:
 *   1. Match `near_place` against assignment place names (case-insensitive partial)
 *   2. Fallback: day whose assignments contain the geographically closest place
 *   3. Last resort: first day
 *
 * Position selection (minimum-detour algorithm):
 *   For each candidate gap between consecutive assignments A and B, the cost is
 *   dist(A→S) + dist(S→B) − dist(A→B).  We also consider inserting before the
 *   first or after the last assignment.  The position with lowest cost wins.
 */
function findBestDayAndPosition(
  suggestion: Suggestion,
  localDays: Array<{ id: number; assignments: Assignment[] }>,
): { dayId: number; insertAt: number } {
  if (localDays.length === 0) return { dayId: 0, insertAt: 0 }

  // ── 1. Find target day ────────────────────────────────────────────────────
  let targetIdx = -1

  // Try near_place name match
  if (suggestion.near_place) {
    const needle = suggestion.near_place.toLowerCase()
    for (let i = 0; i < localDays.length; i++) {
      const hit = localDays[i].assignments.some(a => {
        const n = a.place?.name?.toLowerCase() ?? ''
        return n.includes(needle.substring(0, 12)) || needle.includes(n.substring(0, 12))
      })
      if (hit) { targetIdx = i; break }
    }
  }

  // Fallback: geographically closest existing assignment
  if (targetIdx === -1 && suggestion.lat != null && suggestion.lng != null) {
    let bestDist = Infinity
    for (let i = 0; i < localDays.length; i++) {
      for (const a of localDays[i].assignments) {
        if (a.place?.lat == null || a.place?.lng == null) continue
        const d = haversineKm(suggestion.lat, suggestion.lng, a.place.lat, a.place.lng)
        if (d < bestDist) { bestDist = d; targetIdx = i }
      }
    }
  }

  if (targetIdx === -1) targetIdx = 0
  const targetDay = localDays[targetIdx]

  // ── 2. Find best insertion position ──────────────────────────────────────
  const assignments = targetDay.assignments
  if (assignments.length === 0 || suggestion.lat == null || suggestion.lng == null) {
    return { dayId: targetDay.id, insertAt: assignments.length }
  }

  // Only consider assignments that have valid coordinates
  const pts = assignments
    .map((a, i) => ({ i, lat: a.place?.lat, lng: a.place?.lng }))
    .filter((p): p is { i: number; lat: number; lng: number } =>
      p.lat != null && p.lng != null)

  if (pts.length === 0) return { dayId: targetDay.id, insertAt: assignments.length }

  const sLat = suggestion.lat, sLng = suggestion.lng
  let bestPos = assignments.length  // default: append at end
  let bestCost = Infinity

  // Before the first assignment
  const costFirst = haversineKm(sLat, sLng, pts[0].lat, pts[0].lng)
  if (costFirst < bestCost) { bestCost = costFirst; bestPos = 0 }

  // Between each consecutive pair
  for (let k = 0; k < pts.length - 1; k++) {
    const A = pts[k], B = pts[k + 1]
    const detour =
      haversineKm(A.lat, A.lng, sLat, sLng) +
      haversineKm(sLat, sLng, B.lat, B.lng) -
      haversineKm(A.lat, A.lng, B.lat, B.lng)
    if (detour < bestCost) { bestCost = detour; bestPos = A.i + 1 }
  }

  // After the last assignment
  const last = pts[pts.length - 1]
  const costLast = haversineKm(sLat, sLng, last.lat, last.lng)
  if (costLast < bestCost) { bestPos = last.i + 1 }

  return { dayId: targetDay.id, insertAt: bestPos }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MustSeeSuggestionsModal({
  tripId, days, onClose, onAdded, lang = 'en',
}: Props) {
  const { t } = useTranslation()
  const toast = useToast()

  const [step, setStep]               = useState<'loading' | 'results' | 'adding' | 'done' | 'error'>('loading')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selected, setSelected]       = useState<Set<number>>(new Set())
  const [error, setError]             = useState('')
  const [addingProgress, setAddingProgress] = useState(0)

  useEffect(() => { fetchSuggestions() }, [])

  async function fetchSuggestions() {
    setStep('loading')
    setError('')
    try {
      const data = await suggestionsApi.mustSee(tripId, lang)
      setSuggestions(data.suggestions)
      setSelected(new Set(data.suggestions.map((_: any, i: number) => i)))
      setStep('results')
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Unknown error')
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
    setSelected(
      selected.size === suggestions.length
        ? new Set()
        : new Set(suggestions.map((_: any, i: number) => i)),
    )
  }

  async function handleAdd() {
    const toAdd = suggestions.filter((_, i) => selected.has(i))
    if (toAdd.length === 0) return
    setStep('adding')
    setAddingProgress(0)

    // Mutable local snapshot of days + assignments so that each successive
    // insertion sees the positions already taken by previous insertions.
    const localDays: Array<{ id: number; assignments: Assignment[] }> =
      days.map(d => ({ id: d.id, assignments: [...(d.assignments ?? [])] }))

    let added = 0
    for (const s of toAdd) {
      try {
        // 1. Create the place record
        const createRes = await placesApi.create(tripId, {
          name:        s.name,
          description: s.description,
          lat:         s.lat,
          lng:         s.lng,
          address:     s.address,
          image_url:   s.photo_url ?? null,
        })
        const placeId: number = createRes?.place?.id ?? createRes?.id

        if (placeId && localDays.length > 0) {
          // 2. Find the best day + insertion index
          const { dayId, insertAt } = findBestDayAndPosition(s, localDays)

          // 3. Assign the place to that day
          const assignRes = await assignmentsApi.create(tripId, dayId, { place_id: placeId })
          const newAssignment: Assignment = assignRes?.assignment ?? assignRes

          // 4. Reorder if not inserting at the end
          const daySnap = localDays.find(d => d.id === dayId)
          if (daySnap) {
            const existingIds = daySnap.assignments.map(a => a.id)
            if (insertAt < existingIds.length) {
              const reorderedIds = [
                ...existingIds.slice(0, insertAt),
                newAssignment.id,
                ...existingIds.slice(insertAt),
              ]
              await assignmentsApi.reorder(tripId, dayId, reorderedIds)
            }
            // Update local snapshot so next iteration sees this place
            daySnap.assignments.splice(insertAt, 0, newAssignment)
          }
        }

        added++
      } catch { /* skip silently — partial success is fine */ }
      setAddingProgress(Math.round((added / toAdd.length) * 100))
    }

    setStep('done')
    const dayCount = new Set(
      toAdd.map(s => findBestDayAndPosition(s, days.map(d => ({ id: d.id, assignments: d.assignments ?? [] }))).dayId)
    ).size
    toast.success(
      `${added} ${added === 1 ? 'lugar añadido' : 'lugares añadidos'} ` +
      `en ${dayCount} ${dayCount === 1 ? 'día' : 'días'}`
    )
    setTimeout(() => { onAdded(); onClose() }, 1200)
  }

  const allSelected = suggestions.length > 0 && selected.size === suggestions.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full"
        style={{ maxWidth: 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px 12px', borderBottom: '1px solid var(--border-faint)', flexShrink: 0 }}>
          <Sparkles size={18} style={{ color: '#f59e0b' }} />
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1, color: 'var(--text-primary)' }}>
            Lugares imprescindibles
          </span>
          <button
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--bg-hover)', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>

          {step === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '48px 0', color: 'var(--text-muted)' }}>
              <Loader2 size={32} className="animate-spin" style={{ color: '#f59e0b' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>Buscando lugares…</div>
                <div style={{ fontSize: 12 }}>Esto puede tardar unos segundos</div>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 0' }}>
              <AlertCircle size={32} style={{ color: '#ef4444' }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: 'var(--text-primary)' }}>No se pudieron obtener sugerencias</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 320 }}>{error}</div>
              </div>
              <button
                onClick={fetchSuggestions}
                style={{ marginTop: 8, padding: '8px 20px', borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Reintentar
              </button>
            </div>
          )}

          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '48px 0', color: '#16a34a' }}>
              <CheckCircle2 size={40} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>¡Lugares añadidos!</span>
            </div>
          )}

          {step === 'adding' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '48px 0' }}>
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <div style={{ width: '60%', height: 6, borderRadius: 99, background: 'var(--border-faint)', overflow: 'hidden' }}>
                <div style={{ width: `${addingProgress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s ease', borderRadius: 99 }} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Añadiendo y ordenando… {addingProgress}%</span>
            </div>
          )}

          {step === 'results' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 8px' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {selected.size} de {suggestions.length} seleccionados
                </span>
                <button
                  onClick={toggleAll}
                  style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, padding: 0 }}
                >
                  {allSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 16 }}>
                {suggestions.map((s, idx) => {
                  const isSelected = selected.has(idx)
                  const catColor = getCategoryColor(s.category)
                  return (
                    <div
                      key={idx}
                      onClick={() => toggleSelect(idx)}
                      style={{
                        display: 'flex', gap: 0, borderRadius: 12, overflow: 'hidden',
                        border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border-faint)'}`,
                        cursor: 'pointer', transition: 'border-color 0.15s',
                        background: isSelected ? 'var(--accent-bg, rgba(99,102,241,0.04))' : 'var(--bg-primary)',
                      }}
                    >
                      {/* Photo */}
                      <div style={{ width: 72, flexShrink: 0, background: '#f1f5f9', overflow: 'hidden', position: 'relative' }}>
                        {s.photo_url ? (
                          <img
                            src={s.photo_url}
                            alt={s.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>
                            <ImageOff size={20} />
                          </div>
                        )}
                        <div style={{
                          position: 'absolute', top: 4, right: 4,
                          width: 18, height: 18, borderRadius: '50%',
                          background: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
                          border: `2px solid ${isSelected ? 'var(--accent)' : 'rgba(0,0,0,0.2)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.15s',
                        }}>
                          {isSelected && <CheckCircle2 size={11} style={{ color: '#fff' }} />}
                        </div>
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 3 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', flex: 1, lineHeight: 1.3 }}>{s.name}</span>
                          <span style={{
                            flexShrink: 0, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99,
                            background: catColor + '22', color: catColor,
                          }}>
                            {s.category}
                          </span>
                        </div>
                        {s.near_place && (
                          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 3, fontStyle: 'italic' }}>
                            cerca de {s.near_place.split(',')[0]}
                          </div>
                        )}
                        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>{s.description}</p>
                        {s.address && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5 }}>
                            <MapPin size={10} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                            <span style={{ fontSize: 10, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
            padding: '12px 20px', borderTop: '1px solid var(--border-faint)', flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'none', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              onClick={handleAdd}
              disabled={selected.size === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 18px', borderRadius: 10, border: 'none',
                background: selected.size === 0 ? 'var(--border-faint)' : 'var(--accent)',
                color: selected.size === 0 ? 'var(--text-muted)' : 'var(--accent-text)',
                fontSize: 13, fontWeight: 600, cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
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
