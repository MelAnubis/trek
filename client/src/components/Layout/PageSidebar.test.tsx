// FE-COMP-PAGESIDEBAR-001 to 002
import { render, screen, fireEvent } from '../../../tests/helpers/render'
import { Settings, Bell } from 'lucide-react'
import PageSidebar from './PageSidebar'

const tabs = [
  { id: 'display', label: 'Display', icon: Settings },
  { id: 'alerts', label: 'Alerts', icon: Bell },
]

function phone(on: boolean) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: on ? 390 : 1400 })
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
}

describe('PageSidebar on a phone', () => {
  afterEach(() => phone(false))

  it('FE-COMP-PAGESIDEBAR-001: shows the list of sections first, the section after a tap, and back again', () => {
    phone(true)
    const onTabChange = vi.fn()
    render(<PageSidebar sidebarLabel="Settings" tabs={tabs} activeTab="display" onTabChange={onTabChange}><p>panel body</p></PageSidebar>)
    // list first: both sections listed, the panel hidden
    expect(screen.getAllByRole('button', { name: /alerts/i })).toHaveLength(1)
    expect(screen.getByText('panel body').parentElement).toHaveClass('max-lg:hidden')
    fireEvent.click(screen.getByRole('button', { name: /alerts/i }))
    expect(onTabChange).toHaveBeenCalledWith('alerts')
    expect(screen.getByText('panel body').parentElement).not.toHaveClass('max-lg:hidden')
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByText('panel body').parentElement).toHaveClass('max-lg:hidden')
  })

  it('FE-COMP-PAGESIDEBAR-002: on a wide screen there is no phone list or back button', () => {
    phone(false)
    render(<PageSidebar sidebarLabel="Settings" tabs={tabs} activeTab="display" onTabChange={vi.fn()}><p>panel body</p></PageSidebar>)
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
    expect(screen.getByText('panel body').parentElement).not.toHaveClass('max-lg:hidden')
  })
})
