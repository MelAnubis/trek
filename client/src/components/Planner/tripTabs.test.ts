// FE-TRIPTABS-001 to FE-TRIPTABS-003
import { splitTripTabs } from './tripTabs'

const tabs = ['plan', 'tours', 'transports', 'buchungen', 'listen', 'finanzplan', 'gpx'].map(id => ({ id }))
const ids = (l: { id: string }[]) => l.map(t => t.id)

describe('splitTripTabs', () => {
  it('FE-TRIPTABS-001: few tabs → all visible, nothing under «Más»', () => {
    expect(splitTripTabs(tabs.slice(0, 4), 'plan', 5)).toEqual({ visible: tabs.slice(0, 4), overflow: [] })
  })

  it('FE-TRIPTABS-002: the first ones stay, the rest go to «Más» (one slot is the button)', () => {
    const { visible, overflow } = splitTripTabs(tabs, 'plan', 5)
    expect(ids(visible)).toEqual(['plan', 'tours', 'transports', 'buchungen'])
    expect(ids(overflow)).toEqual(['listen', 'finanzplan', 'gpx'])
  })

  it('FE-TRIPTABS-003: an active tab from the overflow takes the last visible slot', () => {
    const { visible, overflow } = splitTripTabs(tabs, 'finanzplan', 5)
    expect(ids(visible)).toEqual(['plan', 'tours', 'transports', 'finanzplan'])
    expect(ids(overflow)).toEqual(['buchungen', 'listen', 'gpx'])
  })
})
