import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Home, Moon, Navigation, PauseCircle, WifiOff } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { isFresh, mainMotion, minutesAgo, type TrackingDevice } from './trackingModel'

/** "hace 3 min", "hace 2 h", "hace 4 d" — or the time itself for older. */
export function useAgo() {
  const { t } = useTranslation()
  return (iso: string | null | undefined): string => {
    const m = minutesAgo(iso)
    if (m == null) return t('tracking.never')
    if (m < 1) return t('tracking.justNow')
    if (m < 60) return t('tracking.minutesAgo', { n: m })
    if (m < 48 * 60) return t('tracking.hoursAgo', { n: Math.round(m / 60) })
    return t('tracking.daysAgo', { n: Math.round(m / 1440) })
  }
}

/**
 * What the phone is doing, from Overland's status records and the age of
 * its last fix: moving (and how), parked, in a quiet zone, asleep, stopped,
 * or silent for longer than it should be.
 */
export function DeviceStatusChip({ device }: { device: Pick<TrackingDevice, 'status' | 'last_position' | 'last_seen_at'> }) {
  const { t } = useTranslation()
  const fresh = isFresh(device)
  const motion = mainMotion(device.last_position?.motion)
  let label: string
  let color = 'var(--text-muted)'
  let Icon = Navigation
  if (device.status === 'stopped') { label = t('tracking.status.stopped'); Icon = PauseCircle; color = '#dc2626' }
  else if (device.status === 'quiet') { label = t('tracking.status.quiet'); Icon = Home }
  else if (device.status === 'sleeping') { label = t('tracking.status.sleeping'); Icon = Moon }
  else if (!device.last_position) { label = t('tracking.status.waiting'); Icon = WifiOff }
  else if (!fresh) { label = t('tracking.status.silent'); Icon = WifiOff; color = '#b45309' }
  else if (motion && motion !== 'stationary') { label = t(`tracking.motion.${motion}`); color = '#16a34a' }
  else { label = t('tracking.motion.stationary') }
  return (
    <span data-testid="device-status" className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ color, background: 'var(--bg-tertiary)' }}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  )
}

export function BatteryBadge({ level, state }: { level: number | null; state?: string | null }) {
  if (level == null) return null
  const pct = Math.round(level * 100)
  const Icon = state === 'charging' || state === 'full' ? BatteryCharging : pct > 70 ? BatteryFull : pct > 30 ? BatteryMedium : BatteryLow
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: pct <= 15 ? '#dc2626' : 'var(--text-muted)' }}>
      <Icon className="w-3.5 h-3.5" /> {pct}%
    </span>
  )
}
