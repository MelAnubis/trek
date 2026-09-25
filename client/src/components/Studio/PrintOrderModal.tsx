import { useEffect, useState } from 'react'
import { CheckCircle, Package, X } from 'lucide-react'
import type { BookDocument } from '../../types/book'
import { sheetsFor } from './bookSheets'
import { printApi, type PrintShippingAddress } from '../../api/client'
import { getApiErrorMessage } from '../../types'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'

const SHIPPING_LEVELS = ['MAIL', 'GROUND', 'EXPEDITED', 'EXPRESS'] as const

interface OrderRow {
  id: number
  status: string
  cost_total: number | null
  cost_currency: string | null
  created_at: string
}

const FIELD: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }
const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }
const INPUT: React.CSSProperties = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', width: '100%' }

/**
 * The "Order a printed copy" flow — a real, working call to the Lulu Print
 * API (price estimate, then order creation) gated on an admin having
 * configured credentials (see AdminPage.tsx's Print-on-Demand card and
 * GET /api/health/features's printOnDemand flag, which is what puts this
 * modal's own entry point in StudioExport.tsx behind a conditional).
 *
 * One honest gap: this app has no server-side book-to-PDF renderer yet
 * (export today is entirely the browser's own print dialog — see
 * printSheets.ts), so the interior PDF is a URL the traveler supplies
 * themselves rather than something generated automatically here.
 */
export function PrintOrderModal({ journeyId, title, doc, onClose }: { journeyId: number; title: string; doc: BookDocument; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const pageCount = sheetsFor(doc, 'pages').length

  const [quantity, setQuantity] = useState(1)
  const [interiorPdfUrl, setInteriorPdfUrl] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [shippingLevel, setShippingLevel] = useState<typeof SHIPPING_LEVELS[number]>('MAIL')
  const [address, setAddress] = useState<PrintShippingAddress>({ name: '', street1: '', city: '', postcode: '', countryCode: '' })

  const [estimating, setEstimating] = useState(false)
  const [estimate, setEstimate] = useState<{ total: number; currency: string } | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [orderResult, setOrderResult] = useState<{ id: number; status: string } | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])

  useEffect(() => {
    printApi.listOrders().then(d => setOrders(d.orders || [])).catch(() => {})
  }, [])

  const addressComplete = address.name && address.street1 && address.city && address.postcode && address.countryCode

  const getEstimate = async () => {
    setEstimating(true)
    setEstimate(null)
    try {
      const result = await printApi.estimate({ journeyId, preset: doc.page.preset, pageCount, quantity, shippingAddress: address, shippingLevel })
      setEstimate({ total: result.total, currency: result.currency })
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('journey.studio.print.estimateFailed')))
    } finally {
      setEstimating(false)
    }
  }

  const placeOrder = async () => {
    setOrdering(true)
    try {
      const order = await printApi.createOrder({
        journeyId, preset: doc.page.preset, pageCount, quantity, interiorPdfUrl,
        shippingAddress: address, shippingLevel, contactEmail, title,
      })
      setOrderResult({ id: order.id, status: order.status })
      setOrders(o => [order, ...o])
      toast.success(t('journey.studio.print.orderPlaced'))
    } catch (err) {
      toast.error(getApiErrorMessage(err, t('journey.studio.print.orderFailed')))
    } finally {
      setOrdering(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t('journey.studio.print.title')}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-secondary)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Package size={15} /> {t('journey.studio.print.title')}
          </span>
          <button onClick={onClose} aria-label={t('common.close')}
            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {orderResult ? (
            <div style={{ textAlign: 'center', padding: '20px 10px' }}>
              <CheckCircle size={32} color="#16a34a" style={{ margin: '0 auto 10px' }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>{t('journey.studio.print.orderPlaced')}</p>
              <p style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('journey.studio.print.orderStatus', { status: orderResult.status })}</p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5, margin: '0 0 12px', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-tertiary)' }}>
                {t('journey.studio.print.pdfUrlHint')}
              </p>

              <div style={FIELD}>
                <span style={LABEL}>{t('journey.studio.print.pdfUrl')}</span>
                <input style={INPUT} type="url" placeholder="https://…" value={interiorPdfUrl} onChange={e => setInteriorPdfUrl(e.target.value)} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={FIELD}>
                  <span style={LABEL}>{t('journey.studio.print.quantity')}</span>
                  <input style={INPUT} type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
                </div>
                <div style={FIELD}>
                  <span style={LABEL}>{t('journey.studio.print.shippingLevel')}</span>
                  <select style={INPUT} value={shippingLevel} onChange={e => setShippingLevel(e.target.value as typeof shippingLevel)}>
                    {SHIPPING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div style={FIELD}>
                <span style={LABEL}>{t('journey.studio.print.contactEmail')}</span>
                <input style={INPUT} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '14px 0 8px' }}>
                {t('journey.studio.print.shippingAddress')}
              </div>
              <div style={FIELD}>
                <input style={INPUT} placeholder={t('journey.studio.print.addrName')} value={address.name} onChange={e => setAddress(a => ({ ...a, name: e.target.value }))} />
              </div>
              <div style={FIELD}>
                <input style={INPUT} placeholder={t('journey.studio.print.addrStreet1')} value={address.street1} onChange={e => setAddress(a => ({ ...a, street1: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={FIELD}>
                  <input style={INPUT} placeholder={t('journey.studio.print.addrCity')} value={address.city} onChange={e => setAddress(a => ({ ...a, city: e.target.value }))} />
                </div>
                <div style={FIELD}>
                  <input style={INPUT} placeholder={t('journey.studio.print.addrPostcode')} value={address.postcode} onChange={e => setAddress(a => ({ ...a, postcode: e.target.value }))} />
                </div>
              </div>
              <div style={FIELD}>
                <input style={INPUT} placeholder={t('journey.studio.print.addrCountry')} maxLength={2} value={address.countryCode}
                  onChange={e => setAddress(a => ({ ...a, countryCode: e.target.value.toUpperCase() }))} />
              </div>

              {estimate && (
                <div style={{ margin: '10px 0', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('journey.studio.print.estimatedTotal')}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {new Intl.NumberFormat(undefined, { style: 'currency', currency: estimate.currency }).format(estimate.total)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {orders.length > 0 && (
          <div style={{ padding: '0 18px 14px', borderTop: orderResult ? 'none' : '1px solid var(--border-secondary)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', margin: '12px 0 6px' }}>
              {t('journey.studio.print.yourOrders')}
            </div>
            {orders.slice(0, 5).map(o => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', padding: '3px 0' }}>
                <span>#{o.id} — {o.status}</span>
                {o.cost_total != null && <span>{o.cost_currency} {o.cost_total.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        )}

        {!orderResult && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid var(--border-secondary)' }}>
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'none', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-muted)' }}>
              {t('common.cancel')}
            </button>
            <button onClick={() => void getEstimate()} disabled={!addressComplete || estimating}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border-primary)', background: 'none', fontSize: 13, fontWeight: 600, cursor: !addressComplete || estimating ? 'default' : 'pointer', opacity: !addressComplete || estimating ? 0.5 : 1, fontFamily: 'inherit', color: 'var(--text-primary)' }}>
              {estimating ? t('journey.studio.print.estimating') : t('journey.studio.print.getEstimate')}
            </button>
            <button onClick={() => void placeOrder()} disabled={!estimate || !interiorPdfUrl || !contactEmail || ordering}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 600, cursor: ordering ? 'default' : 'pointer', opacity: !estimate || !interiorPdfUrl || !contactEmail || ordering ? 0.5 : 1, fontFamily: 'inherit', background: 'var(--text-primary)', color: 'var(--bg-primary)' }}>
              {ordering ? t('journey.studio.print.placingOrder') : t('journey.studio.print.placeOrder')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
