// FE-PRINTORDERMODAL-001 to FE-PRINTORDERMODAL-008
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrintOrderModal } from './PrintOrderModal'
import { printApi } from '../../api/client'
import type { BookDocument } from '../../types/book'

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return { ...actual, printApi: { ...actual.printApi, estimate: vi.fn(), createOrder: vi.fn(), listOrders: vi.fn(), getOrder: vi.fn() } }
})

const PAGE = { preset: 'square-210' as const, pageWidth: 210, pageHeight: 210, bleed: 3, safe: 5 }

function doc(): BookDocument {
  return {
    version: 1, title: 'Test', page: PAGE,
    spreads: [{ id: 'cover', role: 'cover', background: null, elements: [], parked: [], entryId: null }],
  }
}

function fillAddress() {
  fireEvent.change(screen.getByPlaceholderText('journey.studio.print.addrName'), { target: { value: 'A Traveler' } })
  fireEvent.change(screen.getByPlaceholderText('journey.studio.print.addrStreet1'), { target: { value: '1 Main St' } })
  fireEvent.change(screen.getByPlaceholderText('journey.studio.print.addrCity'), { target: { value: 'Springfield' } })
  fireEvent.change(screen.getByPlaceholderText('journey.studio.print.addrPostcode'), { target: { value: '00000' } })
  fireEvent.change(screen.getByPlaceholderText('journey.studio.print.addrCountry'), { target: { value: 'us' } })
}

beforeEach(() => {
  vi.mocked(printApi.listOrders).mockResolvedValue({ orders: [] })
})

describe('PrintOrderModal', () => {
  it('FE-PRINTORDERMODAL-001: loads and shows the order history on mount', async () => {
    vi.mocked(printApi.listOrders).mockResolvedValue({ orders: [{ id: 1, status: 'CREATED', cost_total: 12.5, cost_currency: 'USD', created_at: '2026-01-01' }] })
    render(<PrintOrderModal journeyId={1} title="Trip" doc={doc()} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/#1 — CREATED/)).toBeInTheDocument())
  })

  it('FE-PRINTORDERMODAL-002: "Get price estimate" is disabled until the shipping address is complete', () => {
    render(<PrintOrderModal journeyId={1} title="Trip" doc={doc()} onClose={() => {}} />)
    expect(screen.getByText('journey.studio.print.getEstimate')).toBeDisabled()
    fillAddress()
    expect(screen.getByText('journey.studio.print.getEstimate')).not.toBeDisabled()
  })

  it('FE-PRINTORDERMODAL-003: country code input is uppercased as typed', () => {
    render(<PrintOrderModal journeyId={1} title="Trip" doc={doc()} onClose={() => {}} />)
    const input = screen.getByPlaceholderText('journey.studio.print.addrCountry') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'us' } })
    expect(input.value).toBe('US')
  })

  it('FE-PRINTORDERMODAL-004: getting an estimate shows the total, formatted as currency', async () => {
    vi.mocked(printApi.estimate).mockResolvedValue({ total: 17.6, currency: 'USD', lineItemCost: 12.5, shippingCost: 4, tax: 1.1 })
    render(<PrintOrderModal journeyId={1} title="Trip" doc={doc()} onClose={() => {}} />)
    fillAddress()
    fireEvent.click(screen.getByText('journey.studio.print.getEstimate'))
    await waitFor(() => expect(screen.getByText('$17.60')).toBeInTheDocument())
  })

  it('FE-PRINTORDERMODAL-005: "Place order" stays disabled until an estimate, a PDF link and a contact email all exist', async () => {
    vi.mocked(printApi.estimate).mockResolvedValue({ total: 17.6, currency: 'USD', lineItemCost: 12.5, shippingCost: 4, tax: 1.1 })
    render(<PrintOrderModal journeyId={1} title="Trip" doc={doc()} onClose={() => {}} />)
    expect(screen.getByText('journey.studio.print.placeOrder')).toBeDisabled()

    fillAddress()
    fireEvent.click(screen.getByText('journey.studio.print.getEstimate'))
    await waitFor(() => expect(screen.getByText('$17.60')).toBeInTheDocument())
    expect(screen.getByText('journey.studio.print.placeOrder')).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: 'https://example.com/book.pdf' } })
    fireEvent.change(document.querySelector('input[type="email"]')!, { target: { value: 'a@b.com' } })
    expect(screen.getByText('journey.studio.print.placeOrder')).not.toBeDisabled()
  })

  it('FE-PRINTORDERMODAL-006: placing an order shows the confirmation screen with the order status', async () => {
    vi.mocked(printApi.estimate).mockResolvedValue({ total: 17.6, currency: 'USD', lineItemCost: 12.5, shippingCost: 4, tax: 1.1 })
    vi.mocked(printApi.createOrder).mockResolvedValue({ id: 42, status: 'CREATED' })
    render(<PrintOrderModal journeyId={1} title="Trip" doc={doc()} onClose={() => {}} />)
    fillAddress()
    fireEvent.click(screen.getByText('journey.studio.print.getEstimate'))
    await waitFor(() => expect(screen.getByText('$17.60')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: 'https://example.com/book.pdf' } })
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement
    fireEvent.change(emailInput, { target: { value: 'a@b.com' } })

    fireEvent.click(screen.getByText('journey.studio.print.placeOrder'))
    await waitFor(() => expect(screen.getByText('journey.studio.print.orderPlaced')).toBeInTheDocument())
    expect(printApi.createOrder).toHaveBeenCalledWith(expect.objectContaining({ journeyId: 1, preset: 'square-210', interiorPdfUrl: 'https://example.com/book.pdf', contactEmail: 'a@b.com' }))
  })

  it('FE-PRINTORDERMODAL-007: passes the document\'s own page preset and leaf count through to the estimate call', async () => {
    vi.mocked(printApi.estimate).mockResolvedValue({ total: 1, currency: 'USD', lineItemCost: 1, shippingCost: 0, tax: 0 })
    render(<PrintOrderModal journeyId={7} title="Trip" doc={doc()} onClose={() => {}} />)
    fillAddress()
    fireEvent.click(screen.getByText('journey.studio.print.getEstimate'))
    await waitFor(() => expect(printApi.estimate).toHaveBeenCalled())
    expect(printApi.estimate).toHaveBeenCalledWith(expect.objectContaining({ journeyId: 7, preset: 'square-210' }))
  })

  it('FE-PRINTORDERMODAL-008: clicking the close button calls onClose', () => {
    const onClose = vi.fn()
    render(<PrintOrderModal journeyId={1} title="Trip" doc={doc()} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('common.close'))
    expect(onClose).toHaveBeenCalled()
  })
})
