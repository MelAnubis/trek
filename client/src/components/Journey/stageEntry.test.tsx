import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../../../tests/helpers/render'
import { buildStageEntry, formatDuration, stageTitle } from './stageEntry'
import { DayRouteCard } from './GpxRouteCards'
import type { PdfGpxTrack } from '../PDF/gpxDrawing'

function track(over: Partial<PdfGpxTrack> = {}): PdfGpxTrack {
  const points = Array.from({ length: 5 }, (_, i) => ({ lat: 40 + i * 0.01, lng: -4, ele: 900 + i * 5, time: new Date(Date.UTC(2026, 4, 1, 8, i * 30)).toISOString() }))
  return { id: 1, track_name: 'Día 1', total_distance: 12.34, total_elevation_gain: 410.4, total_elevation_loss: 120.6, max_elevation: 920, min_elevation: 900, points, ...over }
}

const stats = (v: { km: string; up: number; down: number; duration: string | null }) => `${v.km}|${v.up}|${v.down}|${v.duration}`

describe('buildStageEntry', () => {
  it('takes the title, numbers, start time and end of a recorded stage', () => {
    const d = buildStageEntry([track({ label: 'Etapa 1 · Travesía', tour_place_id: 20, end_name: 'Refugio' })], stats, 'es-ES')!
    expect(d.title).toBe('Etapa 1 · Travesía')
    expect(d.story).toBe('12,3|410|121|2 h')
    expect(d.entry_time).toBe(new Date(Date.UTC(2026, 4, 1, 8, 0)).toTimeString().slice(0, 5))
    expect(d.location_name).toBe('Refugio')
    expect(d.location_lat).toBeCloseTo(40.04, 5)
    expect(d.tour_place_id).toBe(20)
  })

  it('has no time for a planned line, and falls back to the track name', () => {
    const d = buildStageEntry([track({ points: track().points.map(p => ({ ...p, time: null })) })], stats)!
    expect(d.title).toBe('Día 1')
    expect(d.entry_time).toBeNull()
    expect(d.story.endsWith('|null')).toBe(true)
    expect(d.tour_place_id).toBeNull()
  })

  it('returns nothing for a day without points', () => {
    expect(buildStageEntry([track({ points: [] })], stats)).toBeNull()
  })

  it('formats durations and joins several names once', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(130)).toBe('2 h 10 min')
    expect(stageTitle([track({ label: 'A' }), track({ label: 'B' }), track({ label: 'A' })])).toBe('A · B')
  })
})

describe('DayRouteCard stage entry button', () => {
  it('creates the entry, and says when there is one', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<DayRouteCard tracks={[track()]} onCreateEntry={onCreate} />)
    fireEvent.click(screen.getByTestId('stage-entry-create'))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    rerender(<DayRouteCard tracks={[track()]} onCreateEntry={onCreate} entryExists />)
    expect(screen.queryByTestId('stage-entry-create')).toBeNull()
    expect(screen.getByTestId('stage-entry-done')).toBeTruthy()
  })

  it('shows no button to who cannot edit', () => {
    render(<DayRouteCard tracks={[track()]} />)
    expect(screen.queryByTestId('stage-entry-create')).toBeNull()
  })
})
