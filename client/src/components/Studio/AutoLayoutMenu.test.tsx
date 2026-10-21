// FE-AUTOLAYOUTMENU-001 to FE-AUTOLAYOUTMENU-004
import { render, screen, fireEvent } from '@testing-library/react'
import { AutoLayoutMenu, readAutoStyle } from './AutoLayoutMenu'

const t = (k: string) => k

function open(props: Partial<Parameters<typeof AutoLayoutMenu>[0]> = {}) {
  const h = { onStyle: vi.fn(), onSpread: vi.fn(), onDesign: vi.fn(), onBook: vi.fn() }
  render(<AutoLayoutMenu t={t} style="classic" canSpread building={false} {...h} {...props} />)
  fireEvent.click(screen.getByText('journey.studio.autoLayout'))
  return h
}

beforeEach(() => { try { localStorage.clear() } catch { /* */ } })

describe('AutoLayoutMenu', () => {
  it('FE-AUTOLAYOUTMENU-001: opens on a click (not hover), so it works on touch screens', () => {
    render(<AutoLayoutMenu t={t} style="classic" canSpread building={false} onStyle={vi.fn()} onSpread={vi.fn()} onDesign={vi.fn()} onBook={vi.fn()} />)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByText('journey.studio.autoLayout'))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('FE-AUTOLAYOUTMENU-002: picking a style reports it and remembers it for next time', () => {
    const h = open()
    fireEvent.click(screen.getByRole('radio', { name: 'journey.studio.autoStyle.editorial' }))
    expect(h.onStyle).toHaveBeenCalledWith('editorial')
    expect(readAutoStyle()).toBe('editorial')
  })

  it('FE-AUTOLAYOUTMENU-003: each of the seven designs applies to the current spread and closes the menu', () => {
    const h = open()
    expect(document.querySelectorAll('[data-design]')).toHaveLength(7)
    fireEvent.click(document.querySelector('[data-design="band"]')!)
    expect(h.onDesign).toHaveBeenCalledWith('band')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('FE-AUTOLAYOUTMENU-004: on a spread not made from an entry, the per-spread actions are disabled and say why', () => {
    const h = open({ canSpread: false })
    fireEvent.click(document.querySelector('[data-design="place"]')!)
    fireEvent.click(screen.getByText('journey.studio.autoLayoutSpread'))
    expect(h.onDesign).not.toHaveBeenCalled()
    expect(h.onSpread).not.toHaveBeenCalled()
    expect(screen.getByText('journey.studio.design.needsEntry')).toBeTruthy()
    fireEvent.click(screen.getByText('journey.studio.autoLayoutBook'))
    expect(h.onBook).toHaveBeenCalled()
  })
})
