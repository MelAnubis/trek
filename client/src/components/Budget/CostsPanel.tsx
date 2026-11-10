import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, BarChart3, Plus, Search, ArrowRight, Check, RotateCcw, History, Pencil, Trash2, Wallet, Paperclip, ScanLine, Loader2, X, FileText, List, Table2 } from 'lucide-react'
import { useTripStore } from '../../store/tripStore'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { budgetApi, filesApi } from '../../api/client'
import { useExchangeRates } from '../../hooks/useExchangeRates'
import { useIsMobile } from '../../hooks/useIsMobile'
import { formatMoney, currencyDecimals, currencyLocale } from '../../utils/formatters'
import { normalizeImageFiles } from '../../utils/convertHeic'
import Modal from '../shared/Modal'
import CustomSelect from '../shared/CustomSelect'
import { CustomDatePicker } from '../shared/CustomDateTimePicker'
import { SYMBOLS, CURRENCIES, SPLIT_COLORS } from './BudgetPanel.constants'
import { COST_CATEGORY_LIST, catMeta } from './costsCategories'
import type { BudgetItem, TripFile } from '../../types'
import type { TripMember } from './BudgetPanelMemberChips'

interface CostsPanelProps {
  tripId: number | string
  tripMembers?: TripMember[]
}

interface Settlement {
  id: number
  from_user_id: number
  to_user_id: number
  amount: number
  created_at?: string
  from_username?: string
  to_username?: string
}
interface SettlementData {
  balances: { user_id: number; username: string; avatar_url: string | null; balance: number }[]
  flows: { from: { user_id: number; username: string }; to: { user_id: number; username: string }; amount: number }[]
  settlements: Settlement[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const FIELD_H = 40 // shared height for the amount / currency / day row in the modal

export default function CostsPanel({ tripId, tripMembers = [] }: CostsPanelProps) {
  const { trip, budgetItems, deleteBudgetItem, loadBudgetItems } = useTripStore()
  const me = useAuthStore(s => s.user?.id ?? -1)
  const can = useCanDo()
  const canEdit = can('budget_edit', trip)
  const toast = useToast()
  const { t, locale } = useTranslation()
  const isMobile = useIsMobile()

  // Display/base currency = the user's preferred currency (Settings), falling back
  // to the trip's own currency. Everything in Costs is converted to and shown in it.
  const displayCurrency = useSettingsStore(s => s.settings.default_currency)
  const base = (displayCurrency || trip?.currency || 'EUR').toUpperCase()
  // Pre-rework rows stored currency = NULL, meaning "the trip's own currency".
  const tripCurrency = (trip?.currency || base).toUpperCase()
  const { convert } = useExchangeRates(base)
  const curOf = useCallback((e: BudgetItem) => (e.currency || tripCurrency), [tripCurrency])
  const [settlement, setSettlement] = useState<SettlementData | null>(null)
  const [filter, setFilter] = useState<'all' | 'mine' | 'owed'>('all')
  // Costs › Vista: Lista (by day) or Tabla (TREK v5), remembered on this device.
  const [view, setView] = useState<'list' | 'table'>(() => { try { return localStorage.getItem('trek-costs-view') === 'table' ? 'table' : 'list' } catch { return 'list' } })
  const chooseView = (v: 'list' | 'table') => { setView(v); try { localStorage.setItem('trek-costs-view', v) } catch { /* private mode */ } }
  const [tableSort, setTableSort] = useState<{ col: 'date' | 'name' | 'category' | 'total' | 'net'; dir: 1 | -1 }>({ col: 'date', dir: -1 })
  const [search, setSearch] = useState('')
  const [histOpen, setHistOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BudgetItem | null>(null)

  const people = tripMembers
  const personById = useCallback((id: number) => people.find(p => p.id === id), [people])
  const personName = useCallback((id: number) => id === me ? t('costs.you') : (personById(id)?.username || '?'), [me, personById, t])
  const colorFor = useCallback((id: number) => {
    const idx = people.findIndex(p => p.id === id)
    return SPLIT_COLORS[(idx >= 0 ? idx : 0) % SPLIT_COLORS.length].gradient
  }, [people])
  const initial = useCallback((id: number) => id === me ? t('costs.youShort') : (personById(id)?.username || '?').charAt(0).toUpperCase(), [me, personById, t])

  const fmt = useCallback((v: number, c = base) => formatMoney(v, c, locale), [base, locale])
  const fmt0 = useCallback((v: number, c = base) => formatMoney(v, c, locale, { decimals: 0 }), [base, locale])

  const loadSettlement = useCallback(() => {
    budgetApi.settlement(tripId, base).then(setSettlement).catch(() => {})
  }, [tripId, base])

  useEffect(() => { loadBudgetItems(tripId); loadSettlement() }, [tripId])
  useEffect(() => { loadSettlement() }, [budgetItems.length, base])

  // The bottom-nav "+" on the Costs tab opens the add-expense modal via ?create=expense.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('create') === 'expense') {
      setEditing(null); setModalOpen(true)
      setSearchParams(p => { p.delete('create'); return p }, { replace: true })
    }
  }, [searchParams])

  // ── derived expense maths (everything converted to the base currency) ────
  const baseTotal = (e: BudgetItem) => convert(e.total_price || 0, curOf(e))
  const myPaidOf = (e: BudgetItem) => (e.payers || []).filter(p => p.user_id === me).reduce((a, p) => a + convert(p.amount, curOf(e)), 0)
  const myShareOf = (e: BudgetItem) => {
    const n = (e.members || []).length
    if (!n || !(e.members || []).some(m => m.user_id === me)) return 0
    return baseTotal(e) / n
  }

  const totals = useMemo(() => {
    const totalSpend = budgetItems.reduce((a, e) => a + baseTotal(e), 0)
    const myPaid = budgetItems.reduce((a, e) => a + myPaidOf(e), 0)
    const myShare = budgetItems.reduce((a, e) => a + myShareOf(e), 0)
    const owe = (settlement?.flows || []).filter(f => f.from.user_id === me).reduce((a, f) => a + f.amount, 0)
    const owed = (settlement?.flows || []).filter(f => f.to.user_id === me).reduce((a, f) => a + f.amount, 0)
    return { totalSpend, myPaid, myShare, owe, owed }
  }, [budgetItems, settlement, me])

  // ── filtering + day grouping ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = budgetItems.slice()
    if (filter === 'mine') list = list.filter(e => myPaidOf(e) > 0)
    if (filter === 'owed') list = list.filter(e => round2(myPaidOf(e) - myShareOf(e)) > 0)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(e => e.name.toLowerCase().includes(q))
    return list
  }, [budgetItems, filter, search, me])

  const dayGroups = useMemo(() => {
    const groups: { day: string; items: BudgetItem[] }[] = []
    const labelOf = (e: BudgetItem) => {
      if (!e.expense_date) return t('costs.noDate')
      try { return new Date(e.expense_date + 'T00:00:00Z').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) } catch { return e.expense_date }
    }
    const sorted = filtered.slice().sort((a, b) => (b.expense_date || '').localeCompare(a.expense_date || ''))
    for (const e of sorted) {
      const day = labelOf(e)
      let g = groups.find(x => x.day === day)
      if (!g) { g = { day, items: [] }; groups.push(g) }
      g.items.push(e)
    }
    return groups
  }, [filtered, locale, t])

  // ── settle actions ──────────────────────────────────────────────────────
  const settleFlow = async (fromId: number, toId: number, amount: number) => {
    try {
      await budgetApi.createSettlement(tripId, { from_user_id: fromId, to_user_id: toId, amount })
      loadSettlement()
    } catch { toast.error(t('common.unknownError')) }
  }
  const undoSettlement = async (id: number) => {
    try { await budgetApi.deleteSettlement(tripId, id); loadSettlement() } catch { toast.error(t('common.unknownError')) }
  }
  const settleAll = async () => {
    const flows = settlement?.flows || []
    if (!flows.length) return
    try {
      for (const f of flows) await budgetApi.createSettlement(tripId, { from_user_id: f.from.user_id, to_user_id: f.to.user_id, amount: f.amount })
      loadSettlement()
    } catch { toast.error(t('common.unknownError')) }
  }

  const dateMeta = useMemo(() => {
    if (!trip?.start_date || !trip?.end_date) return null
    try {
      const s = new Date(trip.start_date + 'T00:00:00Z'), e = new Date(trip.end_date + 'T00:00:00Z')
      const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
      const opt = { day: 'numeric', month: 'short', timeZone: 'UTC' } as const
      return { range: `${s.toLocaleDateString(locale, opt)} – ${e.toLocaleDateString(locale, opt)}`, days }
    } catch { return null }
  }, [trip?.start_date, trip?.end_date, locale])

  const handleDelete = async (id: number) => {
    try { await deleteBudgetItem(tripId, id); loadSettlement() } catch { toast.error(t('common.unknownError')) }
  }

  // ── small presentational helpers ────────────────────────────────────────
  const Avatar = ({ id, size = 24 }: { id: number; size?: number }) => {
    const url = personById(id)?.avatar_url
    if (url) return <img className="!rounded-[50%] !object-cover !shrink-[0] !block" src={url} alt="" style={{ width: size, height: size }} />
    return <span className="!rounded-[50%] ![color:#fff] !grid ![place-items:center] !shrink-[0]" style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.4, fontWeight: 700 }}>{initial(id)}</span>
  }

  const cardCls = 'bg-surface-card border border-edge'
  const labelCls = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-content-faint'

  // Big money number with the design's muted symbol/decimals, locale-correct via Intl.
  const bigMoney = (amount: number, smallSize: number, mutedColor: string) => {
    let parts: Intl.NumberFormatPart[] | null = null
    try {
      const d = currencyDecimals(base)
      parts = new Intl.NumberFormat(currencyLocale(base), { style: 'currency', currency: base, minimumFractionDigits: d, maximumFractionDigits: d }).formatToParts(amount || 0)
    } catch { return <>{formatMoney(amount, base, locale)}</> }
    const isBig = (p: Intl.NumberFormatPart) => p.type === 'integer' || p.type === 'group' || p.type === 'minusSign'
    return <>{parts.map((p, i) => <span key={i} style={isBig(p) ? undefined : { fontSize: smallSize, fontWeight: 500, color: mutedColor }}>{p.value}</span>)}</>
  }

  return (
    <div className="costs-root !min-h-[100%] ![background:var(--c-bg)]" style={{ padding: isMobile ? '6px 14px 28px' : '40px 24px 48px' }}>
     {isMobile ? <MobileBody /> : (
     <div className="!max-w-[100%] !m-[0_auto]">
      {/* ── Header bar ── */}
      <div className="!flex !items-end !justify-between !gap-[24px] !mb-[28px] !flex-wrap">
        <div className="!flex !gap-[10px] !flex-wrap">
          {dateMeta && (
            <span className="bg-surface-card border border-edge text-content-muted !inline-flex !items-center !gap-[6px] !p-[8px_14px] !rounded-[999px] !text-[length:13px] !font-[500] !whitespace-nowrap">
              {dateMeta.range} · <b className="text-content">{t('costs.daysCount', { count: dateMeta.days })}</b>
            </span>
          )}
          <span className="bg-surface-card border border-edge text-content-muted !inline-flex !items-center !gap-[8px] !p-[8px_14px_8px_10px] !rounded-[999px] !text-[length:13px] !font-[500]">
            <span className="!inline-flex">
              {people.slice(0, 4).map((p, i) => {
                const common = { width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--bg-card)', marginLeft: i ? -8 : 0, flexShrink: 0 } as const
                return p.avatar_url
                  ? <img className="!object-cover !block" key={p.id} src={p.avatar_url} alt="" style={{ ...common }} />
                  : <span className="![color:#fff] !grid ![place-items:center] !text-[length:9px] !font-[700]" key={p.id} style={{ ...common, background: colorFor(p.id) }}>{(p.id === me ? t('costs.youShort') : p.username.charAt(0)).toUpperCase()}</span>
              })}
            </span>
            <b className="text-content">{t('costs.travelers', { count: people.length })}</b>
          </span>
        </div>
        {canEdit && (
          <div className="!flex !gap-[10px]">
            <button onClick={settleAll} disabled={!(settlement?.flows || []).length}
              className="bg-surface-card border border-edge text-content disabled:opacity-40 !inline-flex !items-center !gap-[7px] !p-[10px_16px] !rounded-[12px] !text-[length:14px] !font-[500] !cursor-pointer ![font-family:inherit]">
              <Check size={16} /> {t('costs.settleUp')}
            </button>
            <button onClick={() => { setEditing(null); setModalOpen(true) }}
              className="bg-[var(--text-primary)] text-[var(--bg-primary)] !inline-flex !items-center !gap-[7px] !p-[10px_18px] !rounded-[12px] !text-[length:14px] !font-[600] ![border:0] !cursor-pointer ![font-family:inherit]">
              <Plus size={16} /> {t('costs.addExpense')}
            </button>
          </div>
        )}
      </div>

      {/* ── Summary cards ── */}
      <div className="costs-summary !grid ![grid-template-columns:1fr_1fr_1.15fr] !gap-[16px] !mb-[36px]">
        <SummaryCard label={t('costs.youOwe')} sub={t('costs.youOweSub')} amount={totals.owe} currency={base} locale={locale}
          icon={<ArrowDown size={18} />} tone="owe"
          foot={totals.owe > 0.01
            ? <FlowPills ids={(settlement?.flows || []).filter(f => f.from.user_id === me).map(f => f.to.user_id)} lead={t('costs.to')} Avatar={Avatar} name={personName} />
            : <span className="text-content-faint">{t('costs.allSettled')}</span>} />
        <SummaryCard label={t('costs.youreOwed')} sub={t('costs.youreOwedSub')} amount={totals.owed} currency={base} locale={locale}
          icon={<ArrowUp size={18} />} tone="owed"
          foot={totals.owed > 0.01
            ? <FlowPills ids={(settlement?.flows || []).filter(f => f.to.user_id === me).map(f => f.from.user_id)} lead={t('costs.from')} Avatar={Avatar} name={personName} />
            : <span className="text-content-faint">{t('costs.nothingOwed')}</span>} />
        <SummaryCard label={t('costs.totalSpend')} sub={t('costs.totalSpendSub')} amount={totals.totalSpend} currency={base} locale={locale}
          icon={<BarChart3 size={18} />} tone="total"
          foot={<span className="!flex !gap-[16px]"><span>{t('costs.yourShare')} · <b>{fmt0(totals.myShare)}</b></span><span>{t('costs.youPaid')} · <b>{fmt0(totals.myPaid)}</b></span></span>} />
      </div>

      {/* ── Main grid ── */}
      <div className="costs-grid !grid ![grid-template-columns:1fr_380px] !gap-[32px] !items-start">
        {/* expenses */}
        <div>
          <div className="!flex !items-center !justify-between !mb-[16px] !gap-[12px] !flex-wrap">
            <h3 className="text-content !text-[length:24px] !font-[600] !tracking-[-0.025em] !m-[0]">
              {t('costs.expenses')}
            </h3>
            <div className="!flex !gap-[8px] !items-center !flex-wrap">
              <div role="group" aria-label={t('costs.view.label')} className="bg-surface-secondary !flex !rounded-[9px] !p-[3px]">
                {(['list', 'table'] as const).map(v => (
                  <button key={v} data-testid={`costs-view-${v}`} aria-pressed={view === v} onClick={() => chooseView(v)}
                    className={[view === v ? 'bg-surface-card text-content' : 'text-content-muted', '!inline-flex !items-center !gap-[5px] !p-[6px_11px] !text-[length:12px] !rounded-[7px] !font-[500] ![border:0] !cursor-pointer ![font-family:inherit]'].join(' ')}>
                    {v === 'list' ? <List size={13} /> : <Table2 size={13} />}{t('costs.view.' + v)}
                  </button>
                ))}
              </div>
              <div className="bg-surface-input border border-edge !flex !items-center !gap-[6px] !rounded-[10px] !p-[0_10px] !h-[34px]">
                <Search size={15} className="text-content-faint" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('costs.searchPlaceholder')}
                  className="text-content ![border:0] ![background:none] ![outline:none] !text-[length:13px] !w-[150px] ![font-family:inherit]" />
              </div>
              <div className="bg-surface-secondary !flex !rounded-[9px] !p-[3px]">
                {(['all', 'mine', 'owed'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={[filter === f ? 'bg-surface-card text-content' : 'text-content-muted', '!p-[6px_11px] !text-[length:12px] !rounded-[7px] !font-[500] ![border:0] !cursor-pointer ![font-family:inherit]'].join(' ')}>
                    {t('costs.filter.' + f)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {dayGroups.length === 0 ? (
            <div className="text-content-faint !text-center !p-[60px_20px]">
              {search ? t('costs.noMatch') : t('costs.emptyText')}
            </div>
          ) : view === 'table' ? <ExpenseTable /> : dayGroups.map(g => {
            const dtot = g.items.reduce((a, e) => a + baseTotal(e), 0)
            return (
              <div className="!mb-[22px]" key={g.day}>
                <div className={[labelCls, '!flex !items-center !m-[0_0_10px_4px]'].join(' ')}>
                  {g.day}<span className="text-content-muted !ml-[auto] !normal-case !tracking-[0] !font-[500] !text-[length:12px]">{t('costs.spent', { amount: fmt(dtot) })}</span>
                </div>
                <div className="!flex !flex-col !gap-[8px]">
                  {g.items.map(e => <ExpenseRow key={e.id} e={e} />)}
                </div>
              </div>
            )
          })}
        </div>

        {/* sidebar */}
        <div className="!flex !flex-col !gap-[16px]">
          {/* settle up */}
          <div className={[cardCls, '!rounded-[22px] !p-[22px_24px]'].join(' ')}>
            <div className="!flex !items-center !justify-between !mb-[14px]">
              <div className={labelCls}>{t('costs.settleUp')} · <span className="text-content">{(settlement?.flows || []).length}</span></div>
              <button disabled={!(settlement?.settlements || []).length} onClick={() => setHistOpen(true)}
                className="text-content-muted bg-surface-secondary border border-edge disabled:opacity-40 !inline-flex !items-center !gap-[5px] !p-[5px_9px] !rounded-[8px] !text-[length:11.5px] !font-[600] !cursor-pointer ![font-family:inherit]">
                <History size={13} /> {t('costs.history')}{(settlement?.settlements || []).length ? ` (${settlement!.settlements.length})` : ''}
              </button>
            </div>
            <SettleFlows />
          </div>

          {/* balances */}
          <div className={[cardCls, '!rounded-[22px] !p-[22px_24px]'].join(' ')}>
            <div className={[labelCls, '!mb-[14px]'].join(' ')}>{t('costs.balances')}</div>
            <BalancesList balances={settlement?.balances || []} />
          </div>

          {/* by category */}
          <div className={[cardCls, '!rounded-[22px] !p-[22px_24px]'].join(' ')}>
            <div className={[labelCls, '!mb-[14px]'].join(' ')}>{t('costs.byCategory')}</div>
            <CategoryBreakdown />
          </div>
        </div>
      </div>
      </div>)}

      {modalOpen && (
        <ExpenseModal tripId={tripId} base={base} people={people} me={me} editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); loadBudgetItems(tripId); loadSettlement() }} />
      )}

      <Modal isOpen={histOpen} onClose={() => setHistOpen(false)} title={t('costs.settleHistory')} size="md">
        <SettleHistory settlements={settlement?.settlements || []} fmt={fmt} Avatar={Avatar} name={personName} onUndo={undoSettlement} canEdit={canEdit} />
      </Modal>

      <style>{`
        .costs-root {
          --c-bg: #f8fafc; --c-bg2: oklch(0.965 0.01 70);
          --c-surface: #ffffff; --c-surface2: oklch(0.985 0.006 78);
          --c-ink: oklch(0.22 0.012 65); --c-ink2: oklch(0.42 0.012 65); --c-ink3: oklch(0.62 0.01 65);
          --c-line: oklch(0.92 0.008 70);
        }
        html.dark .costs-root {
          --c-bg: #121215; --c-bg2: #18181c;
          --c-surface: #1a1a1e; --c-surface2: #202027;
          --c-ink: #f4f4f5; --c-ink2: #a1a1aa; --c-ink3: #71717a;
          --c-line: #2a2a31;
        }
        .costs-root .bg-surface-card { background: var(--c-surface) !important; }
        .costs-root .bg-surface-secondary, .costs-root .bg-surface-input { background: var(--c-surface2) !important; }
        .costs-root .border-edge { border-color: var(--c-line) !important; }
        /* dark = neutral zinc + a touch of liquid glass, matching the dashboard */
        html.dark .costs-root .bg-surface-card {
          background: rgba(255,255,255,0.035) !important;
          border-color: rgba(255,255,255,0.08) !important;
          backdrop-filter: blur(20px) saturate(1.4);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
        }
        html.dark .costs-root .bg-surface-secondary,
        html.dark .costs-root .bg-surface-input { background: rgba(255,255,255,0.05) !important; }
        html.dark .costs-root .border-edge { border-color: rgba(255,255,255,0.08) !important; }
        .costs-root .text-content { color: var(--c-ink) !important; }
        .costs-root .text-content-muted { color: var(--c-ink2) !important; }
        .costs-root .text-content-faint { color: var(--c-ink3) !important; }
        .costs-root .exp-actions { opacity: 1; }
        @media (max-width: 1100px) {
          .costs-root .costs-summary { grid-template-columns: 1fr !important; }
          .costs-root .costs-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )

  // ── shared settle-flow list ──────────────────────────────────────────────
  function SettleFlows() {
    const flows = settlement?.flows || []
    if (flows.length === 0) return (
      <div className="!text-center !p-[14px_8px]">
        <div className="!w-[46px] !h-[46px] !rounded-[50%] !m-[0_auto_10px] !grid ![place-items:center] ![background:rgba(22,163,74,0.12)] ![color:#16a34a]"><Check size={22} /></div>
        <div className="text-content !text-[length:14.5px] !font-[600]">{t('costs.everyoneSquare')}</div>
        <div className="text-content-faint !text-[length:12px] !mt-[2px]">{t('costs.nothingOutstanding')}</div>
      </div>
    )
    return (
      <div className="!flex !flex-col !gap-[12px]">
        {flows.map((f, i) => (
          <div className="!flex !items-center !justify-between !gap-[10px]" key={i}>
            <div className="!flex !items-center !gap-[8px] !min-w-[0]" title={`${personName(f.from.user_id)} → ${f.to.user_id === me ? t('costs.youLower') : personName(f.to.user_id)}`}>
              <Avatar id={f.from.user_id} size={32} /><ArrowRight size={15} className="text-content-faint" /><Avatar id={f.to.user_id} size={32} />
            </div>
            <div className="!flex !items-center !gap-[8px] !shrink-[0]">
              <span className="text-content !text-[length:14px] !font-[700]">{fmt(f.amount)}</span>
              {canEdit && <button onClick={() => settleFlow(f.from.user_id, f.to.user_id, f.amount)} className="bg-[var(--text-primary)] text-[var(--bg-primary)] !p-[7px_12px] !rounded-[9px] !text-[length:12px] !font-[600] ![border:0] !cursor-pointer ![font-family:inherit]">{t('costs.settle')}</button>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ── mobile layout (Budget1Mobile.html): single flat column, total card on top ──
  function MobileBody() {
    return (
      <div className="!flex !flex-col !gap-[16px] !pt-[8px]">
        {/* Total card */}
        <section className="![background:linear-gradient(135deg,#1f2937,#111827)] ![color:#fff] !rounded-[22px] !p-[20px_20px_16px] ![box-shadow:0_8px_24px_-8px_rgba(0,0,0,0.28)]">
          <div className="!text-[length:11.5px] !uppercase !tracking-[0.12em] ![color:rgba(255,255,255,0.6)] !font-[600]">{t('costs.totalSpend')}</div>
          <div className="!text-[length:44px] !font-[700] !tracking-[-0.04em] !leading-[1] !mt-[8px] !flex !items-baseline">{bigMoney(totals.totalSpend, 24, 'rgba(255,255,255,0.6)')}</div>
          <div className="!flex !gap-[18px] !mt-[12px] !text-[length:12px] ![color:rgba(255,255,255,0.6)] !flex-wrap">
            <span>{t('costs.yourShare')} · <b className="![color:#fff] !font-[600]">{fmt0(totals.myShare)}</b></span>
            <span>{t('costs.youPaid')} · <b className="![color:#fff] !font-[600]">{fmt0(totals.myPaid)}</b></span>
          </div>
          {canEdit && (
            <button className="!mt-[16px] !w-[100%] !flex !items-center !justify-center !gap-[8px] ![background:rgba(255,255,255,0.14)] ![border:1px_solid_rgba(255,255,255,0.16)] ![color:#fff] !p-[13px] !rounded-[14px] !text-[length:14px] !font-[600] !cursor-pointer ![font-family:inherit]" onClick={() => { setEditing(null); setModalOpen(true) }}>
              <Plus size={17} /> {t('costs.addExpense')}
            </button>
          )}
        </section>

        {/* Owe / Owed */}
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[10px]">
          <div className={[cardCls, '!rounded-[18px] !p-[16px]'].join(' ')}>
            <div className="!w-[34px] !h-[34px] !rounded-[10px] !grid ![place-items:center] !mb-[10px] ![background:#dc262622] ![color:#dc2626]"><ArrowDown size={17} /></div>
            <div className="text-content !text-[length:12.5px] !font-[600]">{t('costs.youOwe')}</div>
            <div className="text-content-faint !text-[length:10.5px]">{t('costs.youOweSub')}</div>
            <div className="!text-[length:27px] !font-[700] !tracking-[-0.03em] !leading-[1] !mt-[12px] !flex !items-baseline ![color:#dc2626]">{bigMoney(totals.owe, 16, 'var(--c-ink3)')}</div>
          </div>
          <div className={[cardCls, '!rounded-[18px] !p-[16px]'].join(' ')}>
            <div className="!w-[34px] !h-[34px] !rounded-[10px] !grid ![place-items:center] !mb-[10px] ![background:#16a34a22] ![color:#16a34a]"><ArrowUp size={17} /></div>
            <div className="text-content !text-[length:12.5px] !font-[600]">{t('costs.youreOwed')}</div>
            <div className="text-content-faint !text-[length:10.5px]">{t('costs.youreOwedSub')}</div>
            <div className="!text-[length:27px] !font-[700] !tracking-[-0.03em] !leading-[1] !mt-[12px] !flex !items-baseline ![color:#16a34a]">{bigMoney(totals.owed, 16, 'var(--c-ink3)')}</div>
          </div>
        </div>

        {/* Settle up */}
        <div className={[cardCls, '!rounded-[18px] !p-[16px]'].join(' ')}>
          <div className="!flex !items-center !justify-between !mb-[14px] !gap-[8px]">
            <div className="text-content !text-[length:19px] !font-[700] !tracking-[-0.02em] !flex !items-baseline !gap-[8px]">{t('costs.settleUp')} <span className="text-content-faint !text-[length:12px] !font-[500]">{(settlement?.flows || []).length}</span></div>
            <button disabled={!(settlement?.settlements || []).length} onClick={() => setHistOpen(true)} className="text-content-muted bg-surface-card border border-edge disabled:opacity-40 !inline-flex !items-center !gap-[5px] !p-[6px_10px] !rounded-[9px] !text-[length:11.5px] !font-[600] !cursor-pointer ![font-family:inherit]"><History size={13} /> {t('costs.history')}</button>
          </div>
          <SettleFlows />
        </div>

        {/* Expenses */}
        <div className="!flex !flex-col !gap-[12px]">
          <div className="text-content !text-[length:19px] !font-[700] !tracking-[-0.02em]">{t('costs.expenses')}</div>
          <div className="bg-surface-card border border-edge !flex !items-center !gap-[8px] !rounded-[12px] !p-[0_12px] !h-[42px]">
            <Search size={16} className="text-content-faint" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('costs.searchPlaceholder')} className="text-content ![border:0] ![background:none] ![outline:none] !text-[length:14px] !w-[100%] ![font-family:inherit]" />
          </div>
          <div className="bg-surface-secondary !flex !rounded-[11px] !p-[3px] !gap-[2px]">
            {(['all', 'mine', 'owed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} className={[filter === f ? 'bg-surface-card text-content' : 'text-content-muted', '!flex-[1] !p-[8px_6px] !text-[length:12.5px] !font-[500] !rounded-[8px] ![border:0] !cursor-pointer ![font-family:inherit] !whitespace-nowrap'].join(' ')}>{t('costs.filter.' + f)}</button>
            ))}
          </div>
          {dayGroups.length === 0
            ? <div className="text-content-faint !text-center !p-[36px_16px] !text-[length:13px]">{search ? t('costs.noMatch') : t('costs.emptyText')}</div>
            : dayGroups.map(g => {
                const dtot = g.items.reduce((a, e) => a + baseTotal(e), 0)
                return (
                  <div className="!flex !flex-col !gap-[8px]" key={g.day}>
                    <div className={[labelCls, '!flex !items-center !p-[0_2px]'].join(' ')}>{g.day}<span className="text-content-muted !ml-[auto] !normal-case !tracking-[0] !font-[500] !text-[length:11.5px]">{t('costs.spent', { amount: fmt(dtot) })}</span></div>
                    <div className="!flex !flex-col !gap-[8px]">{g.items.map(e => <ExpenseRow key={e.id} e={e} />)}</div>
                  </div>
                )
              })}
        </div>

        {/* Balances */}
        <div className={[cardCls, '!rounded-[18px] !p-[16px]'].join(' ')}>
          <div className={[labelCls, '!mb-[14px]'].join(' ')}>{t('costs.balances')}</div>
          <BalancesList balances={settlement?.balances || []} />
        </div>

        {/* By category */}
        <div className={[cardCls, '!rounded-[18px] !p-[16px]'].join(' ')}>
          <div className={[labelCls, '!mb-[14px]'].join(' ')}>{t('costs.byCategory')}</div>
          <CategoryBreakdown />
        </div>
      </div>
    )
  }

  // ── inline subcomponents (close over helpers) ────────────────────────────
  function ExpenseTable() {
    const valueOf = (e: BudgetItem): string | number => {
      switch (tableSort.col) {
        case 'date': return e.expense_date || ''
        case 'name': return e.name.toLowerCase()
        case 'category': return t(catMeta(e.category).labelKey).toLowerCase()
        case 'total': return baseTotal(e)
        case 'net': return round2(myPaidOf(e) - myShareOf(e))
      }
    }
    const rows = filtered.slice().sort((a, b) => { const x = valueOf(a), y = valueOf(b); return (x < y ? -1 : x > y ? 1 : 0) * tableSort.dir })
    const sum = rows.reduce((a, e) => a + baseTotal(e), 0)
    const head = (col: typeof tableSort.col, label: string, right = false) => (
      <th key={col} onClick={() => setTableSort(s => ({ col, dir: s.col === col ? (s.dir === 1 ? -1 : 1) : 1 }))}
        className="text-content-muted !p-[10px_12px] !text-[length:11px] !font-[600] !tracking-[0.04em] !cursor-pointer !whitespace-nowrap !select-none ![border-bottom:1px_solid_var(--border-primary)]" style={{ textTransform: 'uppercase', textAlign: right ? 'right' : 'left' }}>
        <span className="!inline-flex !items-center !gap-[4px]">{label}{tableSort.col === col && (tableSort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}</span>
      </th>
    )
    const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid var(--border-faint)', verticalAlign: 'middle' }
    return (
      <div data-testid="costs-table" className="bg-surface-card border border-edge !rounded-[14px] !overflow-x-auto">
        <table className="!w-[100%] ![border-collapse:collapse]">
          <thead><tr>
            {head('date', t('budget.table.date'))}
            {head('name', t('budget.table.name'))}
            {head('category', t('costs.view.category'))}
            <th className="text-content-muted !p-[10px_12px] !text-[length:11px] !font-[600] !uppercase !tracking-[0.04em] !text-left ![border-bottom:1px_solid_var(--border-primary)]">{t('costs.view.paidBy')}</th>
            {head('total', t('budget.table.total'), true)}
            {head('net', t('costs.view.yourBalance'), true)}
            {canEdit && <th className="![border-bottom:1px_solid_var(--border-primary)]" />}
          </tr></thead>
          <tbody>
            {rows.map(e => {
              const c = catMeta(e.category)
              const net = round2(myPaidOf(e) - myShareOf(e))
              return (
                <tr key={e.id}>
                  <td className="text-content-muted !whitespace-nowrap" style={{ ...td }}>{e.expense_date ? new Date(e.expense_date + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—'}</td>
                  <td className="text-content !font-[600]" style={{ ...td }}>{e.name}</td>
                  <td className="text-content-muted" style={td}><span className="!inline-flex !items-center !gap-[6px]"><span className="!w-[8px] !h-[8px] !rounded-[2px]" style={{ background: c.color }} />{t(c.labelKey)}</span></td>
                  <td style={td}><span className="!inline-flex !gap-[3px]">{(e.payers || []).filter(p => p.amount > 0).map(p => <span key={p.user_id} title={personName(p.user_id)}><Avatar id={p.user_id} size={20} /></span>)}</span></td>
                  <td className="text-content !text-right !font-[600] !whitespace-nowrap" style={{ ...td }}>{fmt(baseTotal(e))}</td>
                  <td className="!text-right !whitespace-nowrap" style={{ ...td, color: net > 0.01 ? '#16a34a' : net < -0.01 ? '#dc2626' : 'var(--text-faint)' }}>{net > 0.01 ? '+' + fmt(net) : net < -0.01 ? '−' + fmt(-net) : '—'}</td>
                  {canEdit && (
                    <td className="!whitespace-nowrap !text-right" style={{ ...td }}>
                      <button title={t('common.edit')} onClick={() => { setEditing(e); setModalOpen(true) }} className="text-content-muted ![border:0] ![background:none] !cursor-pointer !p-[4px]"><Pencil size={13} /></button>
                      <button className="![border:0] ![background:none] !cursor-pointer !p-[4px] ![color:#dc2626]" title={t('common.delete')} onClick={() => handleDelete(e.id)}><Trash2 size={13} /></button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot><tr>
            <td colSpan={4} className="text-content-muted ![border-bottom:0] !font-[600]" style={{ ...td }}>{t('budget.table.total')}</td>
            <td className="text-content ![border-bottom:0] !text-right !font-[700] !whitespace-nowrap" style={{ ...td }}>{fmt(sum)}</td>
            <td className="![border-bottom:0]" colSpan={canEdit ? 2 : 1} style={{ ...td }} />
          </tr></tfoot>
        </table>
      </div>
    )
  }

  function ExpenseRow({ e }: { e: BudgetItem }) {
    const c = catMeta(e.category)
    const Icon = c.Icon
    const cur = curOf(e)
    const payers = (e.payers || []).filter(p => p.amount > 0)
    const net = round2(myPaidOf(e) - myShareOf(e))
    return (
      <div className="bg-surface-card border border-edge exp-row !grid ![grid-template-columns:46px_1fr_auto] !gap-[16px] !items-center !rounded-[18px] !p-[16px_20px]">
        <span className="!w-[46px] !h-[46px] !rounded-[13px] !grid ![place-items:center]" style={{ background: c.color + '22', color: c.color }}><Icon size={21} /></span>
        <div className="!min-w-[0]">
          <div className="text-content !text-[length:15px] !font-[600] !mb-[6px]">{e.name}</div>
          {payers.length > 0 && (
            <div className="!flex !flex-wrap !gap-[5px] !mb-[5px]">
              {payers.map(p => (
                <span key={p.user_id} className="bg-surface-secondary border border-edge !inline-flex !items-center !gap-[6px] !p-[3px_10px_3px_3px] !rounded-[999px] !text-[length:11.5px]" title={personName(p.user_id)}>
                  <Avatar id={p.user_id} size={18} />
                  <span className="text-content !font-[700]">{fmt(convert(p.amount, cur))}</span>
                </span>
              ))}
            </div>
          )}
          {!isMobile && (
            <div className="text-content-faint !text-[length:12px] !whitespace-nowrap !overflow-hidden !text-ellipsis">
              {t(c.labelKey)}{cur !== base ? ` · ${fmt(e.total_price, cur)} → ${fmt(baseTotal(e))}` : ''}
            </div>
          )}
        </div>
        <div className="!flex !items-center !gap-[10px] !self-center">
          <div className="!text-right !whitespace-nowrap">
            <div className="text-content !text-[length:18px] !font-[600]">{fmt(baseTotal(e))}</div>
            {(e.members || []).length > 0 && Math.abs(net) > 0.01 && (
              <div className="!text-[length:12px] !mt-[2px] !font-[500] !whitespace-nowrap" style={{ color: net > 0 ? '#16a34a' : '#dc2626' }}>
                {net > 0 ? t('costs.youLent', { amount: fmt(net) }) : t('costs.youBorrowed', { amount: fmt(-net) })}
              </div>
            )}
          </div>
          {canEdit && (
            <div className="exp-actions !flex !flex-col !gap-[6px] !shrink-[0]">
              <button title={t('common.edit')} onClick={() => { setEditing(e); setModalOpen(true) }} className="bg-surface-secondary border border-edge text-content-muted !inline-flex !items-center !justify-center !w-[28px] !h-[28px] !rounded-[999px] !cursor-pointer"><Pencil size={13} /></button>
              <button title={t('common.delete')} onClick={() => handleDelete(e.id)} className="bg-surface-secondary border border-edge !inline-flex !items-center !justify-center !w-[28px] !h-[28px] !rounded-[999px] !cursor-pointer ![color:#dc2626]"><Trash2 size={13} /></button>
            </div>
          )}
        </div>
      </div>
    )
  }

  function BalancesList({ balances }: { balances: SettlementData['balances'] }) {
    const rows = people.map(p => balances.find(b => b.user_id === p.id) || { user_id: p.id, username: p.username, avatar_url: null, balance: 0 })
    const max = Math.max(1, ...rows.map(r => Math.abs(r.balance)))
    return (
      <div className="!flex !flex-col !gap-[14px]">
        {rows.map(r => {
          const pct = Math.min(100, Math.abs(r.balance) / max * 100)
          const pos = r.balance > 0.01, neg = r.balance < -0.01
          return (
            <div className="!grid ![grid-template-columns:28px_1fr_auto] !gap-[10px] !items-center" key={r.user_id}>
              <Avatar id={r.user_id} size={28} />
              <div>
                <div className="text-content !text-[length:13px] !font-[600]">{personName(r.user_id)}</div>
                <div className="bg-surface-secondary !h-[5px] !rounded-[3px] !mt-[5px] !relative !overflow-hidden">
                  <span className="!absolute !left-[50%] !top-[-1px] !bottom-[-1px] !w-[1px] ![background:var(--border-primary)]" />
                  {pos && <span className="!absolute !left-[50%] !top-[0] !bottom-[0] ![background:#16a34a] !rounded-[3px]" style={{ width: pct / 2 + '%' }} />}
                  {neg && <span className="!absolute !right-[50%] !top-[0] !bottom-[0] ![background:#dc2626] !rounded-[3px]" style={{ width: pct / 2 + '%' }} />}
                </div>
              </div>
              <div className="!text-[length:13px] !font-[600] !text-right" style={{ color: pos ? '#16a34a' : neg ? '#dc2626' : 'var(--text-faint)' }}>
                {pos ? '+' + fmt(r.balance) : neg ? '−' + fmt(-r.balance) : fmt(0)}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function CategoryBreakdown() {
    const tot: Record<string, number> = {}
    let grand = 0
    for (const e of budgetItems) { const k = catMeta(e.category).key; tot[k] = (tot[k] || 0) + baseTotal(e); grand += baseTotal(e) }
    const rows = COST_CATEGORY_LIST.filter(c => (tot[c.key] || 0) > 0).sort((a, b) => (tot[b.key] || 0) - (tot[a.key] || 0))
    if (rows.length === 0) return <div className="text-content-faint !text-[length:12.5px]">{t('costs.noCategories')}</div>
    return (
      <div className="!flex !flex-col !gap-[12px]">
        {rows.map(c => {
          const v = tot[c.key]; const pct = grand ? v / grand * 100 : 0
          return (
            <div className="!grid ![grid-template-columns:auto_1fr_auto] !gap-[10px] !items-center" key={c.key}>
              <span className="!w-[10px] !h-[10px] !rounded-[3px]" style={{ background: c.color }} />
              <span className="text-content !text-[length:13px] !font-[500]">{t(c.labelKey)}</span>
              <span className="text-content-muted !text-[length:13px] !font-[600]">{fmt0(v)}</span>
              <div className="bg-surface-secondary ![grid-column:1_/_-1] !h-[5px] !rounded-[3px] !overflow-hidden !mt-[-2px]">
                <span className="!block !h-[100%] !rounded-[3px]" style={{ width: pct + '%', background: c.color }} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }
}

// ── pure subcomponents ─────────────────────────────────────────────────────
function SummaryCard({ label, sub, amount, currency, locale, icon, foot, tone }: { label: string; sub: string; amount: number; currency: string; locale: string; icon: React.ReactNode; foot: React.ReactNode; tone: 'owe' | 'owed' | 'total' }) {
  const total = tone === 'total'
  const accent = tone === 'owe' ? '#dc2626' : tone === 'owed' ? '#16a34a' : undefined
  const muted = total ? 'rgba(255,255,255,0.55)' : 'var(--text-faint)'
  // formatToParts keeps the design's "big integer + muted symbol/decimals" styling
  // while letting Intl place the symbol and pick separators per locale + currency.
  let parts: Intl.NumberFormatPart[] | null = null
  try {
    const d = currencyDecimals(currency)
    parts = new Intl.NumberFormat(currencyLocale(currency), { style: 'currency', currency: (currency || 'EUR').toUpperCase(), minimumFractionDigits: d, maximumFractionDigits: d }).formatToParts(amount || 0)
  } catch { parts = null }
  const big = (p: Intl.NumberFormatPart) => p.type === 'integer' || p.type === 'group' || p.type === 'minusSign'
  return (
    <div className={total ? '' : 'bg-surface-card border border-edge'}
      style={{ borderRadius: 22, padding: '26px 28px', position: 'relative', overflow: 'hidden', ...(total ? { background: 'linear-gradient(135deg,#1f2937,#111827)', color: '#fff' } : {}) }}>
      <div className="!flex !items-center !gap-[11px]">
        <span className="!w-[36px] !h-[36px] !rounded-[11px] !grid ![place-items:center]" style={{ background: total ? 'rgba(255,255,255,0.12)' : (accent + '22'), color: total ? '#fff' : accent }}>{icon}</span>
        <div>
          <div className={[total ? '' : 'text-content', '!text-[length:13px] !font-[600]'].join(' ')}>{label}</div>
          <div style={{ opacity: total ? 0.6 : 1 }} className={[total ? '' : 'text-content-faint', '!text-[length:12px]'].join(' ')}>{sub}</div>
        </div>
      </div>
      <div className="!text-[length:46px] !font-[600] !tracking-[-0.035em] !leading-[1] !mt-[20px] !flex !items-baseline" style={{ color: total ? '#fff' : accent }}>
        {parts
          ? parts.map((p, i) => <span key={i} style={big(p) ? undefined : { fontSize: 26, fontWeight: 500, color: muted }}>{p.value}</span>)
          : <span>{formatMoney(amount, currency, locale)}</span>}
      </div>
      <div className="!mt-[16px] !text-[length:12.5px] !flex !items-center !gap-[6px] !flex-wrap" style={{ opacity: total ? 0.85 : 1 }}>{foot}</div>
    </div>
  )
}

function FlowPills({ ids, lead, Avatar, name }: { ids: number[]; lead: string; Avatar: (p: { id: number; size?: number }) => React.JSX.Element; name: (id: number) => string }) {
  const uniq = Array.from(new Set(ids))
  return (
    <span className="!inline-flex !items-center !gap-[6px] !flex-wrap">
      <span className="text-content-faint">{lead}</span>
      {uniq.map(id => (
        <span key={id} className="bg-surface-secondary border border-edge text-content !inline-flex !items-center !gap-[5px] !p-[3px_10px_3px_3px] !rounded-[999px] !text-[length:12px] !font-[600]">
          <Avatar id={id} size={18} />{name(id)}
        </span>
      ))}
    </span>
  )
}

function SettleHistory({ settlements, fmt, Avatar, name, onUndo, canEdit }: {
  settlements: Settlement[]; fmt: (v: number) => string; Avatar: (p: { id: number; size?: number }) => React.JSX.Element; name: (id: number) => string; onUndo: (id: number) => void; canEdit: boolean
}) {
  const { t } = useTranslation()
  if (settlements.length === 0) return <div className="text-content-faint !text-center !p-[30px] !text-[length:13px]">{t('costs.noSettlements')}</div>
  const total = settlements.reduce((a, s) => a + s.amount, 0)
  return (
    <div>
      <div className="!flex !justify-between !p-[12px_14px] !rounded-[12px] !mb-[14px] ![background:rgba(22,163,74,0.1)] ![color:#16a34a] !font-[600] !text-[length:13px]">
        <span>{t('costs.paymentsSettled', { count: settlements.length })}</span><span>{fmt(total)}</span>
      </div>
      <div className="!flex !flex-col !gap-[10px]">
        {settlements.map(s => (
          <div key={s.id} className="bg-surface-secondary border border-edge !flex !items-center !justify-between !gap-[12px] !p-[12px_14px] !rounded-[12px]">
            <div className="!flex !items-center !gap-[8px] !min-w-[0]" title={`${name(s.from_user_id)} → ${name(s.to_user_id)}`}>
              <Avatar id={s.from_user_id} size={30} /><ArrowRight size={15} className="text-content-faint" /><Avatar id={s.to_user_id} size={30} />
            </div>
            <div className="!flex !items-center !gap-[10px]">
              <span className="text-content !text-[length:14px] !font-[600]">{fmt(s.amount)}</span>
              {canEdit && <button onClick={() => onUndo(s.id)} className="bg-surface-card border border-edge text-content-muted !inline-flex !items-center !gap-[5px] !p-[6px_10px] !rounded-[8px] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit]"><RotateCcw size={12} /> {t('costs.undo')}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Divides `total` into `n` shares down to the cent, so the shares always sum
// back to exactly `total` regardless of rounding (e.g. 10.00 / 3 → 3.34/3.33/3.33).
function splitEqually(total: number, n: number): number[] {
  if (n <= 0) return []
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / n)
  const remainder = cents - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100)
}

// ── Add / edit expense modal ───────────────────────────────────────────────
function ExpenseModal({ tripId, base, people, me, editing, onClose, onSaved }: {
  tripId: number | string; base: string; people: TripMember[]; me: number; editing: BudgetItem | null; onClose: () => void; onSaved: () => void
}) {
  const { t, locale } = useTranslation()
  const toast = useToast()
  const { addBudgetItem, updateBudgetItem } = useTripStore()
  const { convert } = useExchangeRates(base)
  const sym = (c: string) => SYMBOLS[c] || (c + ' ')

  const [name, setName] = useState(editing?.name || '')
  const [cat, setCat] = useState<string>(editing ? catMeta(editing.category).key : 'food')
  const [currency, setCurrency] = useState((editing?.currency || base).toUpperCase())
  const [day, setDay] = useState(editing?.expense_date || new Date().toISOString().slice(0, 10))
  const [payers, setPayers] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {}
    for (const p of editing?.payers || []) m[p.user_id] = String(p.amount)
    return m
  })
  const [split, setSplit] = useState<Set<number>>(() =>
    editing ? new Set((editing.members || []).map(m => m.user_id)) : new Set(people.map(p => p.id)))
  const [saving, setSaving] = useState(false)

  // "Paid from a shared kitty": a single total, auto-split equally across
  // everyone in "split" — no one is individually tracked as the payer, since
  // it came out of a pot everyone already put into.
  const [sharedPayment, setSharedPayment] = useState(false)
  const [sharedTotal, setSharedTotal] = useState('')

  // Receipt / document attachments. Editing an existing item uploads (and
  // links via budget_item_id) right away; a brand-new item has no id yet, so
  // picked files are queued and uploaded right after the item is created.
  const [attachments, setAttachments] = useState<TripFile[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [scanning, setScanning] = useState(false)
  const attachRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    filesApi.list(tripId).then(({ files }: { files: TripFile[] }) => {
      setAttachments(files.filter(f => f.budget_item_id === editing.id))
    }).catch(() => {})
  }, [editing, tripId])

  const uploadAttachment = async (file: File, budgetItemId: number): Promise<TripFile> => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('budget_item_id', String(budgetItemId))
    const { file: uploaded } = await filesApi.upload(tripId, fd)
    return uploaded
  }

  const removeAttachment = async (file: TripFile) => {
    try {
      await filesApi.delete(tripId, file.id)
      setAttachments(prev => prev.filter(f => f.id !== file.id))
    } catch { toast.error(t('common.unknownError')) }
  }

  // Fire-and-forget: a failed/unconfigured scan just means the traveler
  // fills the form by hand, same as before this feature existed.
  const scanReceiptPhoto = async (file: File) => {
    setScanning(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { result } = await budgetApi.scanReceipt(tripId, fd)
      if (result?.name) setName(result.name)
      if (result?.category) setCat(result.category)
      if (result?.currency) setCurrency(result.currency)
      if (result?.expense_date) setDay(result.expense_date)
      if (result?.total_price != null) {
        if (sharedPayment) setSharedTotal(String(result.total_price))
        else setPayers(prev => ({ ...prev, [me]: String(result.total_price) }))
      }
    } catch { /* no AI key configured, or scan failed — attach-only is still fine */ }
    finally { setScanning(false) }
  }

  const handleAttachFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const normalized = await normalizeImageFiles(fileList)
    // Only the first photo of a fresh expense triggers a scan — scanning
    // several at once would just overwrite each other's prefill.
    let shouldScan = attachments.length === 0 && pendingFiles.length === 0
    for (const file of normalized) {
      if (shouldScan && file.type.startsWith('image/')) {
        shouldScan = false
        scanReceiptPhoto(file)
      }
      if (editing) {
        setUploadingAttachment(true)
        try {
          const uploaded = await uploadAttachment(file, editing.id)
          setAttachments(prev => [...prev, uploaded])
        } catch { toast.error(t('common.unknownError')) } finally { setUploadingAttachment(false) }
      } else {
        setPendingFiles(prev => [...prev, file])
      }
    }
  }

  const manualTotal = Object.values(payers).reduce((a, v) => a + (parseFloat(v) || 0), 0)
  const payersTotal = sharedPayment ? (parseFloat(sharedTotal) || 0) : manualTotal
  const each = split.size > 0 ? payersTotal / split.size : 0
  const valid = name.trim().length > 0 && split.size > 0 && payersTotal > 0

  const save = async () => {
    if (!valid) return
    setSaving(true)
    const payerList = sharedPayment
      ? [...split].map((uid, i) => ({ user_id: uid, amount: splitEqually(payersTotal, split.size)[i] })).filter(p => p.amount > 0)
      : Object.entries(payers).map(([uid, v]) => ({ user_id: Number(uid), amount: parseFloat(v) || 0 })).filter(p => p.amount > 0)
    const data = {
      name: name.trim(), category: cat,
      // Store the actual currency the amounts were entered in; conversion to the
      // viewer's display currency happens live (real rates), no manual rate.
      currency,
      payers: payerList, member_ids: [...split],
      expense_date: day || null,
    }
    try {
      if (editing) {
        await updateBudgetItem(tripId, editing.id, data)
      } else {
        const created = await addBudgetItem(tripId, data)
        for (const file of pendingFiles) {
          try { await uploadAttachment(file, created.id) } catch { /* non-fatal — expense is saved either way */ }
        }
      }
      onSaved()
    } catch { toast.error(t('common.unknownError')) } finally { setSaving(false) }
  }

  const inputCls = 'w-full bg-surface-input border border-edge text-content'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-[0.08em] text-content-faint mb-[6px]'

  return (
    <Modal isOpen onClose={onClose} title={editing ? t('costs.editExpense') : t('costs.addExpense')} size="2xl"
      footer={
        <div className="!flex !justify-end !gap-[8px]">
          <button onClick={onClose} className="text-content-muted border border-edge !p-[8px_16px] !rounded-[10px] ![background:none] !text-[length:13px] !cursor-pointer ![font-family:inherit]">{t('common.cancel')}</button>
          <button onClick={save} disabled={!valid || saving} className="bg-[var(--text-primary)] text-[var(--bg-primary)] !p-[8px_20px] !rounded-[10px] ![border:0] !text-[length:13px] !font-[600] !cursor-pointer ![font-family:inherit]" style={{ opacity: !valid || saving ? 0.5 : 1 }}>{editing ? t('common.save') : t('costs.addExpense')}</button>
        </div>
      }>
      <div className="!flex !flex-col !gap-[14px]">
        <div>
          <label className={labelCls}>{t('costs.whatFor')}</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('costs.namePlaceholder')} className={[inputCls, '!rounded-[10px] !p-[11px_13px] !text-[length:14px] ![outline:none]'].join(' ')} />
        </div>

        <div>
          <label className={labelCls}>{t('costs.totalAmount')}</label>
          <div className="bg-surface-input border border-edge !box-border !flex !items-center !rounded-[10px] !p-[0_12px]" style={{ height: FIELD_H }}>
            <span className="text-content-faint !text-[length:15px]">{sym(currency)}</span>
            {sharedPayment ? (
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={sharedTotal}
                onChange={e => setSharedTotal(e.target.value)}
                className="text-content !flex-[1] ![border:0] ![background:none] ![outline:none] !text-[length:15px] !font-[600] !p-[8px_0_8px_6px]" />
            ) : (
              <span className="text-content !flex-[1] !text-[length:15px] !font-[600] !pl-[6px]">{payersTotal.toFixed(2)}</span>
            )}
          </div>
        </div>
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[10px]">
          <div className="!min-w-[0]">
            <label className={labelCls}>{t('costs.currency')}</label>
            <CustomSelect value={currency} onChange={v => setCurrency(String(v))} searchable
              options={CURRENCIES.map(c => ({ value: c, label: SYMBOLS[c] ? `${c}  ${SYMBOLS[c]}` : c }))}
              style={{ width: '100%' }} />
          </div>
          <div className="!min-w-[0]">
            <label className={labelCls}>{t('costs.day')}</label>
            <CustomDatePicker value={day} onChange={setDay} style={{ width: '100%' }} />
          </div>
        </div>

        {currency !== base && payersTotal > 0 && (
          <div className="bg-surface-secondary border border-edge text-content-muted !rounded-[10px] !p-[10px_12px] !text-[length:12.5px] !flex !items-center !gap-[8px] !flex-wrap">
            <span>{formatMoney(payersTotal, currency, locale)}</span>
            <span className="text-content-faint">≈</span>
            <span className="text-content !font-[600]">{formatMoney(convert(payersTotal, currency), base, locale)}</span>
            <span className="text-content-faint">· {t('costs.liveRate')}</span>
          </div>
        )}

        <div>
          <label className={labelCls}>{t('costs.category')}</label>
          <div className="!flex !flex-wrap !gap-[7px]">
            {COST_CATEGORY_LIST.map(c => {
              const Icon = c.Icon; const on = cat === c.key
              return (
                <button key={c.key} onClick={() => setCat(c.key)}
                  className={[on ? 'bg-surface-card text-content border' : 'bg-surface-secondary text-content-muted border border-edge', '!inline-flex !items-center !gap-[6px] !p-[6px_11px_6px_7px] !rounded-[999px] !text-[length:12.5px] !font-[500] !cursor-pointer ![font-family:inherit]'].join(' ')}
                  style={{ borderColor: on ? 'var(--text-primary)' : undefined }}>
                  <span className="!w-[20px] !h-[20px] !rounded-[6px] !grid ![place-items:center]" style={{ background: c.color + '22', color: c.color }}><Icon size={12} /></span>
                  {t(c.labelKey)}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="!flex !items-center !justify-between !mb-[7px]">
            <label className={[labelCls, '!m-[0]'].join(' ')}>{t('costs.whoPaid')}</label>
            <button
              type="button"
              onClick={() => setSharedPayment(v => {
                const next = !v
                if (next && !sharedTotal && manualTotal > 0) setSharedTotal(manualTotal.toFixed(2))
                return next
              })}
              className={[sharedPayment ? 'bg-surface-card text-content border' : 'bg-surface-secondary text-content-faint border border-edge', '!inline-flex !items-center !gap-[6px] !p-[5px_10px] !rounded-[999px] !text-[length:11.5px] !font-[500] !cursor-pointer ![font-family:inherit]'].join(' ')}
              style={{ borderColor: sharedPayment ? 'var(--text-primary)' : undefined }}
            >
              <Wallet size={12} />
              {t('costs.sharedPayment')}
            </button>
          </div>
          {sharedPayment ? (
            <p className="text-content-faint !text-[length:12.5px] !m-[0]">{t('costs.sharedPaymentHint')}</p>
          ) : (
            <div className="!flex !flex-col !gap-[7px]">
              {people.map(p => (
                <div key={p.id} className="bg-surface-secondary border border-edge !grid ![grid-template-columns:1fr_130px] !gap-[10px] !items-center !p-[8px_11px] !rounded-[10px]">
                  <span className="text-content !text-[length:14px] !font-[500]">{p.id === me ? t('costs.you') : p.username}</span>
                  <div className="bg-surface-input border border-edge !flex !items-center !gap-[4px] !rounded-[8px] !p-[0_10px]">
                    <span className="text-content-faint !text-[length:13px]">{sym(currency)}</span>
                    <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={payers[p.id] || ''}
                      onChange={e => setPayers(prev => ({ ...prev, [p.id]: e.target.value }))}
                      className="text-content !w-[100%] ![border:0] ![background:none] ![outline:none] !text-[length:14px] !font-[600] !p-[8px_0] !text-right" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className={labelCls}>{t('costs.splitBetween')}</label>
          <div className="!flex !flex-wrap !gap-[7px]">
            {people.map(p => {
              const on = split.has(p.id)
              return (
                <button key={p.id} onClick={() => setSplit(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })}
                  className={[on ? 'bg-surface-card text-content border' : 'bg-surface-secondary text-content-faint border border-edge', '!inline-flex !items-center !gap-[7px] !p-[6px_13px_6px_7px] !rounded-[999px] !text-[length:13px] !font-[500] !cursor-pointer ![font-family:inherit]'].join(' ')}
                  style={{ borderColor: on ? 'var(--text-primary)' : undefined }}>
                  {p.avatar_url
                    ? <img className="!w-[22px] !h-[22px] !rounded-[50%] !object-cover !block" src={p.avatar_url} alt="" style={{ opacity: on ? 1 : 0.45 }} />
                    : <span className="!w-[22px] !h-[22px] !rounded-[50%] ![color:#fff] !grid ![place-items:center] !text-[length:9px] !font-[700]" style={{ background: SPLIT_COLORS[people.findIndex(x => x.id === p.id) % SPLIT_COLORS.length].gradient, opacity: on ? 1 : 0.45 }}>{(p.id === me ? t('costs.youShort') : p.username.charAt(0)).toUpperCase()}</span>}
                  {p.id === me ? t('costs.you') : p.username}
                </button>
              )
            })}
          </div>
          <div className="text-content-faint !mt-[10px] !text-[length:12.5px]">
            {split.size === 0 ? t('costs.pickSomeone') : t('costs.splitSummary', { count: split.size, amount: sym(currency) + each.toFixed(2) })}
          </div>
        </div>

        <div>
          <div className="!flex !items-center !justify-between !mb-[7px]">
            <label className={[labelCls, '!m-[0]'].join(' ')}>{t('costs.attachments')}</label>
            {scanning && (
              <span className="text-content-faint !inline-flex !items-center !gap-[5px] !text-[length:11.5px]">
                <Loader2 size={12} className="animate-spin" /> {t('costs.scanningReceipt')}
              </span>
            )}
          </div>
          <input ref={attachRef} type="file" accept="image/*,.pdf" multiple aria-label={t('costs.attachments')} onChange={e => { handleAttachFiles(e.target.files); e.target.value = '' }} className="hidden" />
          <div className="!flex !flex-col !gap-[6px]">
            {attachments.map(file => (
              <div key={file.id} className="bg-surface-secondary border border-edge !flex !items-center !gap-[8px] !p-[7px_10px] !rounded-[10px]">
                {file.mime_type?.startsWith('image/')
                  ? <img className="!w-[28px] !h-[28px] !rounded-[6px] !object-cover !shrink-[0]" src={file.url} alt="" />
                  : <span className="!w-[28px] !h-[28px] !rounded-[6px] ![background:var(--surface-input)] !grid ![place-items:center] !shrink-[0]"><FileText size={14} className="text-content-faint" /></span>}
                <span className="text-content !text-[length:12.5px] !flex-[1] !min-w-[0] !overflow-hidden !text-ellipsis !whitespace-nowrap">{file.original_name}</span>
                <button type="button" onClick={() => removeAttachment(file)} className="text-content-faint ![background:none] ![border:0] !cursor-pointer !flex !p-[2px]"><X size={13} /></button>
              </div>
            ))}
            {pendingFiles.map((file, i) => (
              <div key={i} className="bg-surface-secondary border border-edge !flex !items-center !gap-[8px] !p-[7px_10px] !rounded-[10px]">
                <span className="!w-[28px] !h-[28px] !rounded-[6px] ![background:var(--surface-input)] !grid ![place-items:center] !shrink-[0]"><Paperclip size={13} className="text-content-faint" /></span>
                <span className="text-content !text-[length:12.5px] !flex-[1] !min-w-[0] !overflow-hidden !text-ellipsis !whitespace-nowrap">{file.name}</span>
                <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-content-faint ![background:none] ![border:0] !cursor-pointer !flex !p-[2px]"><X size={13} /></button>
              </div>
            ))}
          </div>
          <div className="!flex !items-center !gap-[10px] !flex-wrap" style={{ marginTop: attachments.length || pendingFiles.length ? 8 : 0 }}>
            <button type="button" onClick={() => attachRef.current?.click()} disabled={uploadingAttachment}
              className="bg-surface-secondary text-content-muted border border-edge disabled:opacity-50 !inline-flex !items-center !gap-[6px] !p-[7px_12px] !rounded-[999px] !text-[length:12.5px] !font-[500] !cursor-pointer ![font-family:inherit]">
              <ScanLine size={13} /> {t('costs.addAttachment')}
            </button>
            {attachments.length === 0 && pendingFiles.length === 0 && (
              <span className="text-content-faint !text-[length:11.5px]">{t('costs.scanReceiptHint')}</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
