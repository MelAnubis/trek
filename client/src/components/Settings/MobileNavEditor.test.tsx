// FE-MOBILENAV-001 to FE-MOBILENAV-005
import { render, screen, fireEvent } from '@testing-library/react'
import MobileNavEditor from './MobileNavEditor'
import { useSettingsStore } from '../../store/settingsStore'
import { useAddonStore } from '../../store/addonStore'
import { resolveMobileNav, normalizeMobileNav, DEFAULT_MOBILE_NAV } from '../Layout/mobileNav'

const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(',')}` : k)
const updateSetting = vi.fn(async () => {})

function setup(mobile_nav: unknown, addons = ['journey', 'atlas']) {
  updateSetting.mockClear()
  useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mobile_nav }, updateSetting } as any)
  useAddonStore.setState({ addons: addons.map(id => ({ id, type: 'global', enabled: true })) } as any)
  render(<MobileNavEditor t={t} />)
}
const order = () => [...document.querySelectorAll('[data-nav-item]')].map(e => e.getAttribute('data-nav-item'))

describe('mobileNav', () => {
  it('FE-MOBILENAV-001: the default is the old bar, minus addons that are off', () => {
    expect(resolveMobileNav(undefined, ['journey']).map(i => i.id)).toEqual(['trips', 'journey', 'navigate'])
    expect(resolveMobileNav([], ['vacay', 'atlas', 'journey']).map(i => i.id)).toEqual(DEFAULT_MOBILE_NAV)
  })

  it('FE-MOBILENAV-002: unknown, unavailable and repeated ids are skipped; never empty, never more than five', () => {
    expect(resolveMobileNav(['nope', 'atlas', 'planner', 'planner'], []).map(i => i.id)).toEqual(['planner'])
    expect(resolveMobileNav(['atlas'], []).map(i => i.id)).toEqual(['trips'])
    expect(normalizeMobileNav(['trips', 'planner', 'navigate', 'notifications', 'settings', 'journey', 'x', 3])).toEqual(['trips', 'planner', 'navigate', 'notifications', 'settings'])
    // "My trips" goes to the real trip list route, so the bar can show it active.
    expect(resolveMobileNav(['trips'], [])[0].to).toBe('/dashboard')
  })
})

describe('MobileNavEditor', () => {
  it('FE-MOBILENAV-003: shows the current bar in order, with a preview that ends in Profile', () => {
    setup(['planner', 'trips'])
    expect(order()).toEqual(['planner', 'trips'])
    expect(screen.getByTestId('mobile-nav-preview').textContent).toContain('nav.profile')
  })

  it('FE-MOBILENAV-004: move, remove and add save the new list', () => {
    setup(['planner', 'trips'])
    fireEvent.click(screen.getAllByLabelText('settings.mobileNav.down')[0])
    expect(updateSetting).toHaveBeenLastCalledWith('mobile_nav', ['trips', 'planner'])
    fireEvent.click(screen.getAllByLabelText('settings.mobileNav.remove')[1])
    expect(updateSetting).toHaveBeenLastCalledWith('mobile_nav', ['planner'])
    fireEvent.click(document.querySelector('[data-nav-add="journey"]')!)
    expect(updateSetting).toHaveBeenLastCalledWith('mobile_nav', ['planner', 'trips', 'journey'])
  })

  it('FE-MOBILENAV-005: at five, nothing more can be added; the last one cannot be removed; reset clears the list', () => {
    setup(['trips', 'planner', 'navigate', 'notifications', 'settings'])
    const add = document.querySelector('[data-nav-add="journey"]') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.click(screen.getByText('settings.mobileNav.reset'))
    expect(updateSetting).toHaveBeenLastCalledWith('mobile_nav', [])
  })
})
