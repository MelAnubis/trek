import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Package, X } from 'lucide-react'
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

  // Lulu only has products for the named presets (see luluService's
  // PRESET_TO_PACKAGE) — a custom trim size would be refused by the server
  // with a 422 after the traveler filled in the whole form. Say so up front.
  const unprintableSize = doc.page.preset === 'custom'
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
    <div className="!fixed !inset-[0] !z-[1000] ![background:rgba(0,0,0,0.5)] !flex !items-center !justify-center !p-[20px]" role="dialog" aria-modal="true" aria-label={t('journey.studio.print.title')}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="![background:var(--bg-card)] !rounded-[16px] !max-w-[460px] !w-[100%] !max-h-[90vh] !overflow-y-auto">
        <div className="!flex !items-center !justify-between !p-[14px_18px] ![border-bottom:1px_solid_var(--border-secondary)]">
          <span className="!text-[length:14px] !font-[700] ![color:var(--text-primary)] !flex !items-center !gap-[6px]">
            <Package size={15} /> {t('journey.studio.print.title')}
          </span>
          <button className="!w-[26px] !h-[26px] !flex !items-center !justify-center !rounded-[6px] ![border:none] ![background:none] !cursor-pointer ![color:var(--text-muted)]" onClick={onClose} aria-label={t('common.close')}>
            <X size={15} />
          </button>
        </div>

        <div className="!p-[18px]">
          {orderResult ? (
            <div className="!text-center !p-[20px_10px]">
              <CheckCircle size={32} color="#16a34a" style={{ margin: '0 auto 10px' }} />
              <p className="!text-[length:14px] !font-[600] ![color:var(--text-primary)] !m-[0_0_4px]">{t('journey.studio.print.orderPlaced')}</p>
              <p className="!text-[length:12px] ![color:var(--text-faint)]">{t('journey.studio.print.orderStatus', { status: orderResult.status })}</p>
            </div>
          ) : (
            <>
              {unprintableSize && (
                <p className="!flex !gap-[8px] !items-start !text-[length:12px] ![color:#b45309] !leading-[1.5] !m-[0_0_12px] !p-[8px_10px] !rounded-[8px] ![background:rgba(245,158,11,0.12)] ![border:1px_solid_rgba(245,158,11,0.35)]" role="alert">
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{t('journey.studio.print.customSizeWarning', { w: Math.round(doc.page.pageWidth * 10) / 10, h: Math.round(doc.page.pageHeight * 10) / 10 })}</span>
                </p>
              )}
              <p className="!text-[length:11px] ![color:var(--text-faint)] !leading-[1.5] !m-[0_0_12px] !p-[8px_10px] !rounded-[8px] ![background:var(--bg-tertiary)]">
                {t('journey.studio.print.pdfUrlHint')}
              </p>

              <div style={FIELD}>
                <span style={LABEL}>{t('journey.studio.print.pdfUrl')}</span>
                <input style={INPUT} type="url" placeholder="https://…" value={interiorPdfUrl} onChange={e => setInteriorPdfUrl(e.target.value)} />
              </div>

              <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[8px]">
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

              <div className="!text-[length:11px] !font-[700] !uppercase !tracking-[0.05em] ![color:var(--text-faint)] !m-[14px_0_8px]">
                {t('journey.studio.print.shippingAddress')}
              </div>
              <div style={FIELD}>
                <input style={INPUT} placeholder={t('journey.studio.print.addrName')} value={address.name} onChange={e => setAddress(a => ({ ...a, name: e.target.value }))} />
              </div>
              <div style={FIELD}>
                <input style={INPUT} placeholder={t('journey.studio.print.addrStreet1')} value={address.street1} onChange={e => setAddress(a => ({ ...a, street1: e.target.value }))} />
              </div>
              <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[8px]">
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
                <div className="!m-[10px_0] !p-[10px_12px] !rounded-[8px] ![background:var(--bg-tertiary)] !flex !justify-between !items-center">
                  <span className="!text-[length:12px] ![color:var(--text-muted)]">{t('journey.studio.print.estimatedTotal')}</span>
                  <span className="!text-[length:15px] !font-[700] ![color:var(--text-primary)]">
                    {new Intl.NumberFormat(undefined, { style: 'currency', currency: estimate.currency }).format(estimate.total)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {orders.length > 0 && (
          <div className="!p-[0_18px_14px]" style={{ borderTop: orderResult ? 'none' : '1px solid var(--border-secondary)' }}>
            <div className="!text-[length:11px] !font-[700] !uppercase !tracking-[0.05em] ![color:var(--text-faint)] !m-[12px_0_6px]">
              {t('journey.studio.print.yourOrders')}
            </div>
            {orders.slice(0, 5).map(o => (
              <div className="!flex !justify-between !text-[length:12px] ![color:var(--text-muted)] !p-[3px_0]" key={o.id}>
                <span>#{o.id} — {o.status}</span>
                {o.cost_total != null && <span>{o.cost_currency} {o.cost_total.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        )}

        {!orderResult && (
          <div className="!flex !gap-[8px] !justify-end !p-[14px_18px] ![border-top:1px_solid_var(--border-secondary)]">
            <button className="!p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:13px] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="!flex !items-center !gap-[6px] !p-[8px_16px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] ![background:none] !text-[length:13px] !font-[600] ![font-family:inherit] ![color:var(--text-primary)]" onClick={() => void getEstimate()} disabled={unprintableSize || !addressComplete || estimating}
              style={{ cursor: unprintableSize || !addressComplete || estimating ? 'default' : 'pointer', opacity: unprintableSize || !addressComplete || estimating ? 0.5 : 1 }}>
              {estimating ? t('journey.studio.print.estimating') : t('journey.studio.print.getEstimate')}
            </button>
            <button className="!flex !items-center !gap-[6px] !p-[8px_16px] !rounded-[10px] ![border:none] !text-[length:13px] !font-[600] ![font-family:inherit] ![background:var(--text-primary)] ![color:var(--bg-primary)]" onClick={() => void placeOrder()} disabled={unprintableSize || !estimate || !interiorPdfUrl || !contactEmail || ordering}
              style={{ cursor: ordering ? 'default' : 'pointer', opacity: !estimate || !interiorPdfUrl || !contactEmail || ordering ? 0.5 : 1 }}>
              {ordering ? t('journey.studio.print.placingOrder') : t('journey.studio.print.placeOrder')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
