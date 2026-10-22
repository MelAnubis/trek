// FE-APPEARANCECONTROLS-001 to FE-APPEARANCECONTROLS-003
import { render, screen, fireEvent, act } from '@testing-library/react'
import AppearanceControls from './AppearanceControls'
import { useSettingsStore } from '../../store/settingsStore'

const t = (k: string) => k
const updateSetting = vi.fn(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
  updateSetting.mockClear()
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, appearance: undefined, dark_mode: 'light' }, updateSetting } as any)
})
afterEach(() => vi.useRealTimers())

describe('AppearanceControls', () => {
  it('FE-APPEARANCECONTROLS-001: picking a scheme saves the whole, normalized look', () => {
    render(<AppearanceControls t={t} />)
    fireEvent.click(document.querySelector('[data-scheme-option="teal"]')!)
    expect(updateSetting).toHaveBeenCalledWith('appearance', { scheme: 'teal', accent: null, transparency: true, density: 'comfortable', fontScale: 1, reduceMotion: false })
  })

  it('FE-APPEARANCECONTROLS-002: the text-size slider previews at once and saves once, after it stops', () => {
    render(<AppearanceControls t={t} />)
    const slider = screen.getByLabelText('settings.appearance.textSize')
    fireEvent.change(slider, { target: { value: '1.1' } })
    fireEvent.change(slider, { target: { value: '1.2' } })
    expect((useSettingsStore.getState().settings.appearance as any).fontScale).toBe(1.2)
    expect(updateSetting).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(600) })
    expect(updateSetting).toHaveBeenCalledTimes(1)
    expect((updateSetting.mock.calls[0] as any[])[1]).toMatchObject({ fontScale: 1.2 })
  })

  it('FE-APPEARANCECONTROLS-003: a preset accent switches to the custom scheme; reset goes back to the default', () => {
    useSettingsStore.setState(s => ({ settings: { ...s.settings, appearance: { scheme: 'rose' } } }))
    render(<AppearanceControls t={t} />)
    fireEvent.click(screen.getByLabelText('#059669'))
    expect((updateSetting.mock.calls[0] as any[])[1]).toMatchObject({ scheme: 'custom', accent: '#059669' })
    fireEvent.click(screen.getByText('settings.appearance.reset'))
    expect((updateSetting.mock.calls[1] as any[])[1]).toMatchObject({ scheme: 'default', fontScale: 1 })
  })
})
