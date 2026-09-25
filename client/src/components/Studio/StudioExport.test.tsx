// FE-COMP-STUDIOEXPORT-001 to FE-COMP-STUDIOEXPORT-006
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioExport } from './StudioExport'
import type { BookDocument } from '../../types/book'

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function doc(): BookDocument {
  return {
    version: 1,
    title: 'Test',
    page: PAGE,
    spreads: [
      { id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null },
      { id: 'sp-1', role: 'inner', background: null, elements: [], parked: [], entryId: null },
    ],
  }
}

describe('StudioExport — format picker', () => {
  it('FE-COMP-STUDIOEXPORT-001: defaults to "print" format, with the layout/finishing sections visible', () => {
    render(<StudioExport doc={doc()} title="Test" onClose={() => {}} />)
    expect(screen.getByText('journey.studio.exportFormatPrint').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('journey.studio.exportLayout')).toBeInTheDocument()
    expect(screen.getByText('journey.studio.exportHomeFinish')).toBeInTheDocument()
    expect(screen.getByText('journey.studio.exportFinishing')).toBeInTheDocument()
  })

  it('FE-COMP-STUDIOEXPORT-002: switching to "digital" hides the print-only sections (layout, home finish, marks)', () => {
    render(<StudioExport doc={doc()} title="Test" onClose={() => {}} />)
    fireEvent.click(screen.getByText('journey.studio.exportFormatDigital'))
    expect(screen.getByText('journey.studio.exportFormatDigital').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('journey.studio.exportLayout')).not.toBeInTheDocument()
    expect(screen.queryByText('journey.studio.exportHomeFinish')).not.toBeInTheDocument()
    expect(screen.queryByText('journey.studio.exportFinishing')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOEXPORT-003: switching back to "print" restores the print-only sections', () => {
    render(<StudioExport doc={doc()} title="Test" onClose={() => {}} />)
    fireEvent.click(screen.getByText('journey.studio.exportFormatDigital'))
    fireEvent.click(screen.getByText('journey.studio.exportFormatPrint'))
    expect(screen.getByText('journey.studio.exportLayout')).toBeInTheDocument()
  })
})

describe('StudioExport — print-on-demand gating', () => {
  it('FE-COMP-STUDIOEXPORT-004: no "Order a printed copy" button when printOnDemandAvailable is not passed', () => {
    render(<StudioExport doc={doc()} title="Test" onClose={() => {}} />)
    expect(screen.queryByText('journey.studio.print.orderButton')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOEXPORT-005: no "Order a printed copy" button when printOnDemandAvailable is false', () => {
    render(<StudioExport doc={doc()} title="Test" onClose={() => {}} printOnDemandAvailable={false} onOrderPrint={() => {}} />)
    expect(screen.queryByText('journey.studio.print.orderButton')).not.toBeInTheDocument()
  })

  it('FE-COMP-STUDIOEXPORT-006: clicking "Order a printed copy" calls onOrderPrint when available', () => {
    const onOrderPrint = vi.fn()
    render(<StudioExport doc={doc()} title="Test" onClose={() => {}} printOnDemandAvailable onOrderPrint={onOrderPrint} />)
    fireEvent.click(screen.getByText('journey.studio.print.orderButton'))
    expect(onOrderPrint).toHaveBeenCalled()
  })
})
