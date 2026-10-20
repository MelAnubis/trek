// FE-PAGEFORMATMENU-001 to FE-PAGEFORMATMENU-004
import { render, screen, fireEvent } from '@testing-library/react'
import { PageFormatMenu } from './PageFormatMenu'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }
const t = (k: string) => k

function open(props: Partial<Parameters<typeof PageFormatMenu>[0]> = {}) {
  const handlers = { onPreset: vi.fn(), onSize: vi.fn(), onEdge: vi.fn() }
  render(<PageFormatMenu page={PAGE} t={t} {...handlers} {...props} />)
  fireEvent.click(screen.getByTitle('journey.studio.format'))
  return handlers
}

beforeEach(() => { try { localStorage.clear() } catch { /* */ } })

describe('PageFormatMenu', () => {
  it('FE-PAGEFORMATMENU-001: picking a preset calls onPreset with reflow on by default, and closes', () => {
    const h = open()
    fireEvent.click(screen.getByText('journey.studio.pagePreset.a4Portrait'))
    expect(h.onPreset).toHaveBeenCalledWith('a4-portrait', true)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('FE-PAGEFORMATMENU-002: a size field commits on blur, not on every keystroke', () => {
    const h = open()
    const w = screen.getByTestId('page-width')
    fireEvent.change(w, { target: { value: '2' } })
    fireEvent.change(w, { target: { value: '200' } })
    expect(h.onSize).not.toHaveBeenCalled()
    fireEvent.blur(w)
    expect(h.onSize).toHaveBeenCalledTimes(1)
    expect(h.onSize).toHaveBeenCalledWith('w', 200, true)
  })

  it('FE-PAGEFORMATMENU-003: Enter commits bleed; an empty field reverts instead of committing 0', () => {
    const h = open()
    const b = screen.getByTestId('page-bleed')
    fireEvent.change(b, { target: { value: '5' } })
    fireEvent.keyDown(b, { key: 'Enter' })
    expect(h.onEdge).toHaveBeenCalledWith('bleed', 5, true)
    const s = screen.getByTestId('page-safe')
    fireEvent.change(s, { target: { value: '' } })
    fireEvent.blur(s)
    expect(h.onEdge).toHaveBeenCalledTimes(1)
    expect((s as HTMLInputElement).value).toBe('5')
  })

  it('FE-PAGEFORMATMENU-004: unticking "fit content" passes reflow=false and is remembered', () => {
    const h = open()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('journey.studio.pagePreset.a5Landscape'))
    expect(h.onPreset).toHaveBeenCalledWith('a5-landscape', false)
    expect(localStorage.getItem('trek.studio.reflowOnResize')).toBe('0')
  })
})
