/**
 * Ajustes → Tracking en vivo (5.7.1). Replaces the old "Ubicación en vivo"
 * tab: Trek no longer reads the GPS itself — a phone running Overland sends
 * its points here. This tab adds a phone, shows the endpoint and the token to
 * paste into Overland (the token only once, it is stored hashed), and lets
 * each phone be renamed, re-keyed, given a retention, or removed.
 */
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, Map as MapIcon, Plus, Radio, Smartphone, Trash2 } from 'lucide-react'
import Section from './Section'
import { trackingApi } from '../../api/client'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import { CopyField } from '../Tracking/CopyField'
import { BatteryBadge, DeviceStatusChip, useAgo } from '../Tracking/DeviceStatus'
import { overlandEndpoint, type TrackingDevice } from '../Tracking/trackingModel'

const RETENTION = [null, 7, 30, 90, 365] as const

export default function TrackingTab(): React.ReactElement {
  const { t } = useTranslation()
  const toast = useToast()
  const ago = useAgo()
  const [devices, setDevices] = useState<TrackingDevice[] | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  /** The token just made for a device — shown once, then gone. */
  const [revealed, setRevealed] = useState<{ id: number; token: string } | null>(null)
  const endpoint = overlandEndpoint(window.location.origin)

  const load = () => trackingApi.devices().then((r: { devices: TrackingDevice[] }) => setDevices(r.devices)).catch(() => setDevices([]))
  useEffect(() => { void load() }, [])

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const r = await trackingApi.createDevice(name)
      setRevealed({ id: r.device.id, token: r.token })
      setNewName('')
      await load()
    } catch { toast.error(t('tracking.error')) } finally { setBusy(false) }
  }

  const regenerate = async (d: TrackingDevice) => {
    if (!window.confirm(t('tracking.regenerateConfirm', { name: d.name }))) return
    const r = await trackingApi.regenerateToken(d.id)
    setRevealed({ id: d.id, token: r.token })
    await load()
  }

  const remove = async (d: TrackingDevice) => {
    if (!window.confirm(t('tracking.deleteConfirm', { name: d.name }))) return
    await trackingApi.deleteDevice(d.id)
    if (revealed?.id === d.id) setRevealed(null)
    await load()
  }

  const rename = async (d: TrackingDevice, name: string) => {
    const v = name.trim()
    if (!v || v === d.name) return
    await trackingApi.updateDevice(d.id, { name: v })
    await load()
  }

  const setRetention = async (d: TrackingDevice, v: string) => {
    const days = v === '' ? null : Number(v)
    if (days != null && !window.confirm(t('tracking.retentionConfirm', { days }))) return
    await trackingApi.updateDevice(d.id, { retention_days: days })
    await load()
  }

  return (
    <Section title={t('tracking.title')} icon={Radio}>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('tracking.intro')}</p>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>{t('tracking.endpoint')}</div>
        <CopyField value={endpoint} label={t('tracking.copyEndpoint')} mono testId="overland-endpoint" />
      </div>

      <ol className="text-sm space-y-1 list-decimal pl-5" style={{ color: 'var(--text-secondary)' }}>
        <li>{t('tracking.step1')}</li>
        <li>{t('tracking.step2')}</li>
        <li>{t('tracking.step3')}</li>
        <li>{t('tracking.step4')}</li>
      </ol>

      <div className="flex gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={60} placeholder={t('tracking.newDevicePlaceholder')}
          onKeyDown={e => { if (e.key === 'Enter') void add() }} aria-label={t('tracking.newDevicePlaceholder')}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl text-sm"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }} />
        <button type="button" onClick={() => void add()} disabled={busy || !newName.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'white', opacity: busy || !newName.trim() ? 0.6 : 1 }}>
          <Plus className="w-4 h-4" /> {t('tracking.addDevice')}
        </button>
      </div>

      {devices && devices.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>{t('tracking.noDevices')}</p>
      )}

      <div className="space-y-3">
        {devices?.map(d => (
          <div key={d.id} data-testid="tracking-device" className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--border-primary)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <Smartphone className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input defaultValue={d.name} aria-label={t('tracking.deviceName')} maxLength={60}
                onBlur={e => void rename(d, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                className="flex-1 min-w-[120px] bg-transparent text-sm font-semibold outline-none" style={{ color: 'var(--text-primary)' }} />
              <DeviceStatusChip device={d} />
              <BatteryBadge level={d.battery_level} state={d.battery_state} />
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('tracking.lastPoint')}: {ago(d.last_position?.recorded_at)}
              {d.overland_device_id ? ` · ${d.overland_device_id}` : ''}
              {d.token_hint ? ` · ${t('tracking.tokenEnds', { hint: d.token_hint })}` : ''}
            </div>

            {revealed?.id === d.id && (
              <div className="space-y-1.5 rounded-lg p-2" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid #f59e0b' }}>
                <div className="text-xs font-semibold" style={{ color: '#b45309' }}>{t('tracking.tokenOnce')}</div>
                <CopyField value={revealed.token} label={t('tracking.copyToken')} mono testId="device-token" />
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Link to={`/tracking?device=${d.id}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                <MapIcon className="w-3.5 h-3.5" /> {t('tracking.openMap')}
              </Link>
              <button type="button" onClick={() => void regenerate(d)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                style={{ border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}>
                <KeyRound className="w-3.5 h-3.5" /> {t('tracking.newToken')}
              </button>
              <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {t('tracking.keep')}
                <select value={d.retention_days ?? ''} onChange={e => void setRetention(d, e.target.value)}
                  className="px-2 py-1 rounded-lg text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)' }}>
                  {RETENTION.map(r => <option key={String(r)} value={r ?? ''}>{r == null ? t('tracking.keepForever') : t('tracking.keepDays', { n: r })}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void remove(d)} aria-label={t('tracking.deleteDevice')} title={t('tracking.deleteDevice')}
                className="ml-auto p-1.5 rounded-lg" style={{ color: '#dc2626' }}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
