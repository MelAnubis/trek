/**
 * Offline settings tab — shows cached trips, storage info, and controls
 * to re-sync or clear the offline cache.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Wifi, RefreshCw, Trash2, Database } from 'lucide-react'
import Section from './Section'
import { offlineDb, clearAll } from '../../db/offlineDb'
import { tripSyncManager } from '../../sync/tripSyncManager'
import { mutationQueue } from '../../sync/mutationQueue'
import type { SyncMeta } from '../../db/offlineDb'
import type { Trip } from '../../types'

interface CachedTripRow {
  trip: Trip
  meta: SyncMeta
  placeCount: number
  fileCount: number
}

export default function OfflineTab(): React.ReactElement {
  const [rows, setRows] = useState<CachedTripRow[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [metas, pending] = await Promise.all([
        offlineDb.syncMeta.toArray(),
        mutationQueue.pendingCount(),
      ])
      setPendingCount(pending)

      const result: CachedTripRow[] = []
      for (const meta of metas) {
        const trip = await offlineDb.trips.get(meta.tripId)
        if (!trip) continue
        const [placeCount, fileCount] = await Promise.all([
          offlineDb.places.where('trip_id').equals(meta.tripId).count(),
          offlineDb.tripFiles.where('trip_id').equals(meta.tripId).count(),
        ])
        result.push({ trip, meta, placeCount, fileCount })
      }
      result.sort((a, b) => (a.trip.start_date ?? '').localeCompare(b.trip.start_date ?? ''))
      setRows(result)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleResync() {
    setSyncing(true)
    try {
      await tripSyncManager.syncAll()
      await load()
    } finally {
      setSyncing(false)
    }
  }

  async function handleClear() {
    if (!window.confirm('Clear all offline trip data? You can re-sync anytime while online.')) return
    setClearing(true)
    try {
      await clearAll()
      await load()
    } finally {
      setClearing(false)
    }
  }

  const formatDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  return (
    <Section title="Offline Cache" icon={Database}>
      <div className="!flex !flex-col !gap-[20px]">

        {/* Stats row */}
        <div className="!flex !gap-[12px] !flex-wrap">
          <Stat label="Cached trips" value={rows.length} />
          <Stat label="Pending changes" value={pendingCount} />
        </div>

        {/* Actions */}
        <div className="!flex !gap-[8px]">
          <button className="!flex !items-center !gap-[6px] !p-[8px_14px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-secondary)] ![color:var(--text-primary)] !text-[length:13px] !font-[500]"
            onClick={handleResync}
            disabled={syncing || !navigator.onLine}
            style={{ cursor: syncing || !navigator.onLine ? 'not-allowed' : 'pointer', opacity: !navigator.onLine ? 0.5 : 1 }}
          >
            <RefreshCw size={14} style={syncing ? { animation: 'spin 1s linear infinite' } : {}} />
            {syncing ? 'Syncing…' : 'Re-sync now'}
          </button>

          <button className="!flex !items-center !gap-[6px] !p-[8px_14px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-secondary)] ![color:#ef4444] !text-[length:13px] !font-[500]"
            onClick={handleClear}
            disabled={clearing || rows.length === 0}
            style={{ cursor: clearing || rows.length === 0 ? 'not-allowed' : 'pointer', opacity: rows.length === 0 ? 0.5 : 1 }}
          >
            <Trash2 size={14} />
            Clear cache
          </button>
        </div>

        {/* Cached trip list */}
        {loading ? (
          <p className="![color:var(--text-muted)] !text-[length:13px]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="![color:var(--text-muted)] !text-[length:13px]">
            No trips cached yet. Connect to internet to sync.
          </p>
        ) : (
          <div className="!flex !flex-col !gap-[8px]">
            {rows.map(({ trip, meta, placeCount, fileCount }) => (
              <div className="!p-[10px_14px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-secondary)] !flex !flex-col !gap-[2px]"
                key={trip.id}
              >
                <div className="!flex !justify-between !items-center">
                  <span className="!font-[600] !text-[length:14px] ![color:var(--text-primary)]">
                    {trip.title}
                  </span>
                  <span className="!text-[length:11px] ![color:var(--text-muted)]">
                    <Wifi size={10} style={{ display: 'inline', marginRight: 3 }} />
                    {meta.lastSyncedAt
                      ? new Date(meta.lastSyncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </span>
                </div>
                <span className="!text-[length:12px] ![color:var(--text-muted)]">
                  {formatDate(trip.start_date)} – {formatDate(trip.end_date)}
                  {' · '}
                  {placeCount} place{placeCount !== 1 ? 's' : ''}
                  {' · '}
                  {fileCount} file{fileCount !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="!p-[8px_14px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] ![background:var(--bg-secondary)] !min-w-[100px]">
      <div className="!text-[length:20px] !font-[700] ![color:var(--text-primary)]">{value}</div>
      <div className="!text-[length:11px] ![color:var(--text-muted)]">{label}</div>
    </div>
  )
}
