// FE-UTIL-GROUPDAY-001 to FE-UTIL-GROUPDAY-005
import { groupPhotosByDay, formatPhotoDayHeader } from './groupPhotosByDay'

describe('groupPhotosByDay', () => {
  it('FE-UTIL-GROUPDAY-001: groups photos into one bucket per capture day', () => {
    const groups = groupPhotosByDay([
      { id: 1, taken_at: '2026-09-15T10:00:00Z' },
      { id: 2, taken_at: '2026-09-15T14:00:00Z' },
      { id: 3, taken_at: '2026-09-16T09:00:00Z' },
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.dayKey)).toEqual(['2026-09-16', '2026-09-15'])
    expect(groups[1].photos.map((p: any) => p.id)).toEqual([1, 2])
  })

  it('FE-UTIL-GROUPDAY-002: most recent day comes first', () => {
    const groups = groupPhotosByDay([
      { id: 1, taken_at: '2026-09-01T00:00:00Z' },
      { id: 2, taken_at: '2026-09-20T00:00:00Z' },
      { id: 3, taken_at: '2026-09-10T00:00:00Z' },
    ])
    expect(groups.map(g => g.dayKey)).toEqual(['2026-09-20', '2026-09-10', '2026-09-01'])
  })

  it('FE-UTIL-GROUPDAY-003: within a day, the original (oldest-first) order is preserved', () => {
    const groups = groupPhotosByDay([
      { id: 1, taken_at: '2026-09-15T08:00:00Z' },
      { id: 2, taken_at: '2026-09-15T20:00:00Z' },
      { id: 3, taken_at: '2026-09-15T12:00:00Z' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].photos.map((p: any) => p.id)).toEqual([1, 2, 3])
  })

  it('FE-UTIL-GROUPDAY-004: falls back to created_at when taken_at is unknown, same as the gallery\'s own COALESCE sort', () => {
    const groups = groupPhotosByDay([
      { id: 1, taken_at: null, created_at: new Date('2026-09-05T00:00:00Z').getTime() },
      { id: 2, taken_at: '2026-09-05T23:00:00Z' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].dayKey).toBe('2026-09-05')
  })

  it('FE-UTIL-GROUPDAY-005: formatPhotoDayHeader renders a day/month/year header, not the timeline\'s weekday-first format', () => {
    expect(formatPhotoDayHeader('2026-09-16', 'es')).toBe('16 de septiembre de 2026')
    expect(formatPhotoDayHeader('', 'es')).toBe('')
  })
})
