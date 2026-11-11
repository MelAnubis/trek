import { useState, useMemo, useRef, useEffect } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { packingApi, tripsApi, adminApi } from '../../api/client'
import BikepackImportModal from './BikepackImportModal'
import BikepackDrawer from './BikepackDrawer'


import ReactDOM from 'react-dom'
import {
  CheckSquare, Square, Trash2, Plus, ChevronDown, ChevronRight,
  X, Pencil, Check, MoreHorizontal, CheckCheck, RotateCcw, Luggage, UserPlus, Package, FolderPlus, Upload, Printer,
} from 'lucide-react'
import type { PackingItem } from '../../types'

const VORSCHLAEGE = [
  { name: 'Passport', category: 'Documents' },
  { name: 'Travel Insurance', category: 'Documents' },
  { name: 'Visa Documents', category: 'Documents' },
  { name: 'Flight Tickets', category: 'Documents' },
  { name: 'Hotel Bookings', category: 'Documents' },
  { name: 'Vaccination Card', category: 'Documents' },
  { name: 'T-Shirts (5x)', category: 'Clothing' },
  { name: 'Pants (2x)', category: 'Clothing' },
  { name: 'Underwear (7x)', category: 'Clothing' },
  { name: 'Socks (7x)', category: 'Clothing' },
  { name: 'Jacket', category: 'Clothing' },
  { name: 'Swimwear', category: 'Clothing' },
  { name: 'Sport Shoes', category: 'Clothing' },
  { name: 'Toothbrush', category: 'Toiletries' },
  { name: 'Toothpaste', category: 'Toiletries' },
  { name: 'Shampoo', category: 'Toiletries' },
  { name: 'Sunscreen', category: 'Toiletries' },
  { name: 'Deodorant', category: 'Toiletries' },
  { name: 'Razor', category: 'Toiletries' },
  { name: 'Phone Charger', category: 'Electronics' },
  { name: 'Travel Adapter', category: 'Electronics' },
  { name: 'Headphones', category: 'Electronics' },
  { name: 'Camera', category: 'Electronics' },
  { name: 'Power Bank', category: 'Electronics' },
  { name: 'First Aid Kit', category: 'Health' },
  { name: 'Prescription Medication', category: 'Health' },
  { name: 'Pain Medication', category: 'Health' },
  { name: 'Insect Repellent', category: 'Health' },
  { name: 'Cash', category: 'Finances' },
  { name: 'Credit Card', category: 'Finances' },
]

// Cycling color palette — works in light & dark mode
const KAT_COLORS = [
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#22c55e', // green
  '#f97316', // orange
  '#06b6d4', // cyan
  '#ef4444', // red
  '#eab308', // yellow
  '#8b5cf6', // violet
  '#14b8a6', // teal
]
// Stable color assignment: category name → index via simple hash
function katColor(kat, allCategories) {
  const idx = allCategories ? allCategories.indexOf(kat) : -1
  if (idx >= 0) return KAT_COLORS[idx % KAT_COLORS.length]
  // Fallback: hash-based
  let h = 0
  for (let i = 0; i < kat.length; i++) h = ((h << 5) - h + kat.charCodeAt(i)) | 0
  return KAT_COLORS[Math.abs(h) % KAT_COLORS.length]
}

interface PackingBag { id: number; trip_id: number; name: string; color: string; weight_limit_grams: number | null; user_id?: number | null; assigned_username?: string | null; members?: { user_id: number; username: string; avatar?: string | null }[] }

// ── Bag Card ──────────────────────────────────────────────────────────────

interface BagCardProps {
  bag: PackingBag; bagItems: PackingItem[]; totalWeight: number; pct: number; tripId: number | string
  tripMembers: TripMember[]; canEdit: boolean; onDelete: () => void
  onUpdate: (bagId: number, data: Record<string, any>) => void
  onSetMembers: (bagId: number, userIds: number[]) => void; t: any; compact?: boolean
}

function BagCard({ bag, bagItems, totalWeight, pct, tripId, tripMembers, canEdit, onDelete, onUpdate, onSetMembers, t, compact }: BagCardProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(bag.name)
  const [showUserPicker, setShowUserPicker] = useState(false)
  useEffect(() => setNameVal(bag.name), [bag.name])

  const saveName = () => {
    if (nameVal.trim() && nameVal.trim() !== bag.name) onUpdate(bag.id, { name: nameVal.trim() })
    setEditingName(false)
  }

  const memberIds = (bag.members || []).map(m => m.user_id)
  const toggleMember = (userId: number) => {
    const next = memberIds.includes(userId) ? memberIds.filter(id => id !== userId) : [...memberIds, userId]
    onSetMembers(bag.id, next)
  }

  const sz = compact ? { dot: 10, name: 12, weight: 11, bar: 6, count: 10, gap: 6, mb: 14, icon: 11, avatar: 18 } : { dot: 12, name: 14, weight: 13, bar: 8, count: 11, gap: 8, mb: 16, icon: 13, avatar: 22 }

  return (
    <div style={{ marginBottom: sz.mb }}>
      <div className="!flex !items-center !mb-[4px]" style={{ gap: sz.gap }}>
        <span className="!rounded-[50%] !shrink-[0]" style={{ width: sz.dot, height: sz.dot, background: bag.color }} />
        {editingName && canEdit ? (
          <input className="!flex-[1] !p-[1px_4px] !rounded-[4px] ![border:1px_solid_var(--border-primary)] ![outline:none] ![color:var(--text-primary)]" autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
            onBlur={saveName} onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameVal(bag.name) } }}
            style={{ fontSize: sz.name, fontWeight: 600, fontFamily: 'inherit', background: 'transparent' }} />
        ) : (
          <span className="!flex-[1]" onClick={() => canEdit && setEditingName(true)} style={{ fontSize: sz.name, fontWeight: 600, color: compact ? 'var(--text-secondary)' : 'var(--text-primary)', cursor: canEdit ? 'text' : 'default' }}>{bag.name}</span>
        )}
        <span className="![color:var(--text-faint)]" style={{ fontSize: sz.weight, fontWeight: 500 }}>
          {totalWeight >= 1000 ? `${(totalWeight / 1000).toFixed(1)} kg` : `${totalWeight} g`}
        </span>
        {canEdit && <button className="![border:none] !cursor-pointer !p-[2px] ![color:var(--text-faint)] !flex" onClick={onDelete} style={{ background: 'none' }}><X size={sz.icon} /></button>}
      </div>
      {/* Members */}
      <div className="!flex !items-center !gap-[4px] !mb-[4px] !flex-wrap !relative">
        {(bag.members || []).map(m => (
          <span className="!inline-flex" key={m.user_id} title={m.username} onClick={() => canEdit && toggleMember(m.user_id)} style={{ cursor: canEdit ? 'pointer' : 'default' }}>
            {m.avatar ? (
              <img className="!rounded-[50%] !object-cover !box-border" src={m.avatar} alt={m.username} style={{ width: sz.avatar, height: sz.avatar, border: `1.5px solid ${bag.color}` }} />
            ) : (
              <span className="!rounded-[50%] !inline-flex !items-center !justify-center !box-border" style={{ width: sz.avatar, height: sz.avatar, background: bag.color + '25', color: bag.color, fontSize: sz.avatar * 0.45, fontWeight: 700, border: `1.5px solid ${bag.color}` }}>
                {m.username[0].toUpperCase()}
              </span>
            )}
          </span>
        ))}
        {canEdit && (
          <button className="!rounded-[50%] ![border:1.5px_dashed_var(--border-primary)] ![color:var(--text-faint)] !cursor-pointer !flex !items-center !justify-center !p-[0] !box-border" onClick={() => setShowUserPicker(v => !v)} style={{ width: sz.avatar, height: sz.avatar, background: 'none' }}>
            <Plus size={sz.avatar * 0.5} />
          </button>
        )}
        {showUserPicker && (
          <div className="!absolute !left-[0] !top-[100%] !mt-[4px] !z-[50] ![border:1px_solid_var(--border-primary)] !rounded-[8px] ![box-shadow:0_4px_12px_rgba(0,0,0,0.1)] !p-[4px] !min-w-[160px]" style={{ background: 'var(--bg-card)' }}>
            {tripMembers.map(m => {
              const isSelected = memberIds.includes(m.id)
              return (
                <button className={[(!isSelected) ? 'trek-hover-secondary' : undefined, '!flex !items-center !gap-[8px] !w-[100%] !p-[6px_10px] !rounded-[6px] ![border:none] !cursor-pointer !text-[length:11px] ![color:var(--text-primary)] ![font-family:inherit]'].join(' ')} key={m.id} onClick={() => { toggleMember(m.id); }}
                  style={{ background: isSelected ? 'var(--bg-tertiary)' : 'transparent' }}>
                  {m.avatar ? (
                    <img className="!w-[20px] !h-[20px] !rounded-[50%] !object-cover" src={m.avatar} alt="" />
                  ) : (
                    <span className="!w-[20px] !h-[20px] !rounded-[50%] !text-[length:10px] !font-[700] !inline-flex !items-center !justify-center ![color:var(--text-faint)]" style={{ background: 'var(--bg-tertiary)' }}>
                      {m.username[0].toUpperCase()}
                    </span>
                  )}
                  <span className="!flex-[1]" style={{ fontWeight: isSelected ? 600 : 400 }}>{m.username}</span>
                  {isSelected && <Check size={12} style={{ color: '#10b981' }} />}
                </button>
              )
            })}
            {tripMembers.length === 0 && <div className="!p-[8px_10px] !text-[length:11px] ![color:var(--text-faint)]">{t('packing.noMembers')}</div>}
            <div className="![border-top:1px_solid_var(--border-secondary)] !mt-[4px] !pt-[4px]">
              <button className="!w-[100%] !p-[6px_10px] !rounded-[6px] ![border:none] !cursor-pointer !text-[length:11px] ![color:var(--text-faint)] ![font-family:inherit] !text-center" onClick={() => setShowUserPicker(false)} style={{ background: 'transparent' }}>
                {t('common.close')}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="!rounded-[99px] !overflow-hidden" style={{ height: sz.bar, background: 'var(--bg-tertiary)' }}>
        <div className="!h-[100%] !rounded-[99px] ![transition:width_0.3s]" style={{ background: bag.color, width: `${pct}%` }} />
      </div>
      <div className="![color:var(--text-faint)] !mt-[2px]" style={{ fontSize: sz.count }}>{bagItems.length} {t('admin.packingTemplates.items')}</div>
    </div>
  )
}

// ── Quantity Input ─────────────────────────────────────────────────────────

function QuantityInput({ value, onSave }: { value: number; onSave: (qty: number) => void }) {
  const [local, setLocal] = useState(String(value))
  useEffect(() => setLocal(String(value)), [value])

  const commit = () => {
    const qty = Math.max(1, Math.min(999, Number(local) || 1))
    setLocal(String(qty))
    if (qty !== value) onSave(qty)
  }

  return (
    <div className="!flex !items-center !gap-[2px] ![border:1px_solid_var(--border-primary)] !rounded-[8px] !p-[3px_6px] !shrink-[0]" style={{ background: 'transparent' }}>
      <input className="!w-[24px] ![border:none] ![outline:none] !text-[length:12px] !text-right ![font-family:inherit] ![color:var(--text-secondary)] !p-[0]"
        type="text" inputMode="numeric"
        value={local}
        onChange={e => setLocal(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } }}
        style={{ background: 'transparent' }}
      />
      <span className="!text-[length:10px] ![color:var(--text-faint)] !font-[500]">x</span>
    </div>
  )
}

// ── Artikel-Zeile ──────────────────────────────────────────────────────────
interface ArtikelZeileProps {
  item: PackingItem
  tripId: number | string
  categories: string[]
  onCategoryChange: () => void
  bagTrackingEnabled?: boolean
  bags?: PackingBag[]
  onCreateBag: (name: string) => Promise<PackingBag | undefined>
  canEdit?: boolean
}

// A category's first item is seeded with this sentinel because the server
// rejects empty names. Treat it as a placeholder in the UI.
const PACKING_PLACEHOLDER_NAME = '...'

function ArtikelZeile({ item, tripId, categories, onCategoryChange, bagTrackingEnabled, bags = [], onCreateBag, canEdit = true }: ArtikelZeileProps) {
  const isPlaceholder = item.name === PACKING_PLACEHOLDER_NAME
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(isPlaceholder ? '' : item.name)
  const [hovered, setHovered] = useState(false)
  const [showCatPicker, setShowCatPicker] = useState(false)
  const [showBagPicker, setShowBagPicker] = useState(false)
  const [bagInlineCreate, setBagInlineCreate] = useState(false)
  const [bagInlineName, setBagInlineName] = useState('')
  const { togglePackingItem, updatePackingItem, deletePackingItem } = useTripStore()
  const toast = useToast()
  const { t } = useTranslation()

  const handleToggle = () => togglePackingItem(tripId, item.id, !item.checked)

  const handleSaveName = async () => {
    if (!editName.trim()) { setEditing(false); setEditName(isPlaceholder ? '' : item.name); return }
    try { await updatePackingItem(tripId, item.id, { name: editName.trim() }); setEditing(false) }
    catch { toast.error(t('packing.toast.saveError')) }
  }

  const handleDelete = async () => {
    try { await deletePackingItem(tripId, item.id) }
    catch { toast.error(t('packing.toast.deleteError')) }
  }

  const handleCatChange = async (cat) => {
    setShowCatPicker(false)
    if (cat === item.category) return
    try { await updatePackingItem(tripId, item.id, { category: cat }) }
    catch { toast.error(t('common.error')) }
  }

  return (
    <div
      className="group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowCatPicker(false); setShowBagPicker(false) }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 10, position: 'relative',
        background: hovered ? 'var(--bg-secondary)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <button className="!shrink-[0] ![border:none] !cursor-pointer !p-[0] !relative !w-[18px] !h-[18px] ![transition:color_200ms_cubic-bezier(0.23,1,0.32,1)]" onClick={handleToggle} style={{ background: 'none', color: item.checked ? '#10b981' : 'var(--text-faint)' }}>
        <Square size={18} style={{
          position: 'absolute', inset: 0,
          opacity: item.checked ? 0 : 1,
          transform: item.checked ? 'scale(0.7)' : 'scale(1)',
          transition: 'opacity 180ms cubic-bezier(0.23,1,0.32,1), transform 180ms cubic-bezier(0.23,1,0.32,1)',
        }} />
        <CheckSquare size={18} style={{
          position: 'absolute', inset: 0,
          opacity: item.checked ? 1 : 0,
          transform: item.checked ? 'scale(1)' : 'scale(0.5)',
          transition: 'opacity 200ms cubic-bezier(0.23,1,0.32,1), transform 220ms cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </button>

      {editing && canEdit ? (
        <input className="!flex-[1] !text-[length:13.5px] !p-[2px_8px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] ![outline:none] ![font-family:inherit]"
          type="text" value={editName} autoFocus
          placeholder={isPlaceholder ? '...' : undefined}
          onChange={e => setEditName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setEditing(false); setEditName(isPlaceholder ? '' : item.name) } }}
        />
      ) : (
        <span className="!flex-[1] !text-[length:13.5px] ![transition:color_200ms_cubic-bezier(0.23,1,0.32,1)]"
          onClick={() => canEdit && !item.checked && setEditing(true)}
          style={{ cursor: !canEdit || item.checked ? 'default' : 'text', color: isPlaceholder ? 'var(--text-faint)' : (item.checked ? 'var(--text-faint)' : 'var(--text-primary)'), textDecoration: item.checked ? 'line-through' : 'none' }}
        >
          {item.name}
        </span>
      )}

      {/* Quantity */}
      {canEdit && <QuantityInput value={item.quantity || 1} onSave={qty => updatePackingItem(tripId, item.id, { quantity: qty })} />}

      {/* Weight + Bag (when enabled) */}
      {bagTrackingEnabled && (
        <div className="!flex !items-center !gap-[6px] !shrink-[0]">
          <div className="!flex !items-center !gap-[2px] ![border:1px_solid_var(--border-primary)] !rounded-[8px] !p-[3px_6px]" style={{ background: 'transparent' }}>
            <input className="!w-[36px] ![border:none] !text-[length:12px] !text-right ![font-family:inherit] ![outline:none] ![color:var(--text-secondary)] !p-[0]"
              type="text" inputMode="numeric"
              value={item.weight_grams ?? ''}
              readOnly={!canEdit}
              onChange={async e => {
                if (!canEdit) return
                const raw = e.target.value.replace(/[^0-9]/g, '')
                const v = raw === '' ? null : parseInt(raw)
                try { await updatePackingItem(tripId, item.id, { weight_grams: v }) } catch {}
              }}
              placeholder="—"
              style={{ background: 'transparent' }}
            />
            <span className="!text-[length:10px] ![color:var(--text-faint)] !select-none">g</span>
          </div>
          <div className="!relative">
            <button className="!w-[22px] !h-[22px] !rounded-[50%] !p-[0] !flex !items-center !justify-center"
              onClick={() => canEdit && setShowBagPicker(p => !p)}
              style={{ cursor: canEdit ? 'pointer' : 'default', border: item.bag_id ? `2.5px solid ${bags.find(b => b.id === item.bag_id)?.color || 'var(--border-primary)'}` : '2px dashed var(--border-primary)', background: item.bag_id ? `${bags.find(b => b.id === item.bag_id)?.color || 'var(--border-primary)'}30` : 'transparent' }}
            >
              {!item.bag_id && <Package size={9} style={{ color: 'var(--text-faint)' }} />}
            </button>
            {showBagPicker && (
              <div className="!absolute !right-[0] !top-[100%] !mt-[4px] !z-[50] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !min-w-[160px]" style={{ background: 'var(--bg-card)' }}>
                {item.bag_id && (
                  <button className="!flex !items-center !gap-[7px] !w-[100%] !p-[6px_10px] ![border:none] !cursor-pointer !text-[length:12px] ![font-family:inherit] ![color:var(--text-faint)] !rounded-[7px]" onClick={async () => { setShowBagPicker(false); try { await updatePackingItem(tripId, item.id, { bag_id: null }) } catch {} }}
                    style={{ background: 'none' }}>
                    <span className="!w-[10px] !h-[10px] !rounded-[50%] ![border:2px_dashed_var(--border-primary)]" />
                    {t('packing.noBag')}
                  </button>
                )}
                {bags.map(b => (
                  <button className={[(item.bag_id !== b.id) ? 'trek-hover-tertiary' : undefined, '!flex !items-center !gap-[7px] !w-[100%] !p-[6px_10px] ![border:none] !cursor-pointer !text-[length:12px] ![font-family:inherit] ![color:var(--text-secondary)] !rounded-[7px]'].join(' ')} key={b.id} onClick={async () => { setShowBagPicker(false); try { await updatePackingItem(tripId, item.id, { bag_id: b.id }) } catch {} }}
                    style={{ background: item.bag_id === b.id ? 'var(--bg-tertiary)' : 'none' }}>
                    <span className="!w-[10px] !h-[10px] !rounded-[50%] !shrink-[0]" style={{ background: b.color }} />
                    {b.name}
                  </button>
                ))}
                {bags.length > 0 && <div className="!h-[1px] !m-[4px_0]" style={{ background: 'var(--bg-tertiary)' }} />}
                <div className="!p-[4px_6px]">
                  {bagInlineCreate ? (
                    <div className="!flex !gap-[4px]">
                      <input className="!flex-[1] !p-[4px_8px] !rounded-[6px] ![border:1px_solid_var(--border-primary)] !text-[length:11px] ![font-family:inherit] ![outline:none]" autoFocus value={bagInlineName} onChange={e => setBagInlineName(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key === 'Enter' && bagInlineName.trim()) {
                            const newBag = await onCreateBag(bagInlineName.trim())
                            if (newBag) { try { await updatePackingItem(tripId, item.id, { bag_id: newBag.id }) } catch {} }
                            setBagInlineName(''); setBagInlineCreate(false); setShowBagPicker(false)
                          }
                          if (e.key === 'Escape') { setBagInlineCreate(false); setBagInlineName('') }
                        }}
                        placeholder={t('packing.bagName')} />
                      <button className="!p-[3px_6px] !rounded-[6px] ![border:none] ![color:var(--bg-primary)] !cursor-pointer !flex !items-center" onClick={async () => {
                        if (bagInlineName.trim()) {
                          const newBag = await onCreateBag(bagInlineName.trim())
                          if (newBag) { try { await updatePackingItem(tripId, item.id, { bag_id: newBag.id }) } catch {} }
                          setBagInlineName(''); setBagInlineCreate(false); setShowBagPicker(false)
                        }
                      }}
                        style={{ background: 'var(--text-primary)' }}>
                        <Plus size={11} />
                      </button>
                    </div>
                  ) : (
                    <button className="trek-hover-text2 !flex !items-center !gap-[5px] !w-[100%] !p-[5px_6px] ![border:none] !cursor-pointer !text-[length:11px] ![font-family:inherit] ![color:var(--text-faint)] !rounded-[7px]" onClick={() => setBagInlineCreate(true)}
                      style={{ background: 'none' }}>
                      <Plus size={11} /> {t('packing.addBag')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {canEdit && (
      <div className="sm:opacity-0 sm:group-hover:opacity-100 !flex !gap-[2px] !items-center ![transition:opacity_0.12s] !shrink-[0]">
        <div className="!relative">
          <button className="![border:none] !cursor-pointer !p-[3px_5px] !rounded-[6px] !flex !items-center ![color:var(--text-faint)] !text-[length:10px] !gap-[2px]"
            onClick={() => setShowCatPicker(p => !p)}
            title={t('packing.changeCategory')}
            style={{ background: 'none' }}
          >
            <span className="!w-[7px] !h-[7px] !rounded-[50%] !inline-block" style={{ background: katColor(item.category || t('packing.defaultCategory'), categories) }} />
          </button>
          {showCatPicker && (
            <div className="!absolute !right-[0] !top-[100%] !z-[50] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.1)] !p-[4px] !min-w-[140px]" style={{ background: 'var(--bg-card)' }}>
              {categories.map(cat => (
                <button className="!flex !items-center !gap-[7px] !w-[100%] !p-[6px_10px] ![border:none] !cursor-pointer !text-[length:12.5px] ![font-family:inherit] ![color:var(--text-secondary)] !rounded-[7px] !text-left" key={cat} onClick={() => handleCatChange(cat)} style={{ background: cat === (item.category || t('packing.defaultCategory')) ? 'var(--bg-tertiary)' : 'none' }}>
                  <span className="!w-[8px] !h-[8px] !rounded-[50%] !shrink-[0]" style={{ background: katColor(cat, categories) }} />
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="trek-hover-text2 ![border:none] !cursor-pointer !p-[3px_4px] !rounded-[6px] !flex ![color:var(--text-faint)]" onClick={() => setEditing(true)} title={t('common.rename')} style={{ background: 'none' }}>
          <Pencil size={13} />
        </button>

        <button className="trek-hover-danger ![border:none] !cursor-pointer !p-[3px_4px] !rounded-[6px] !flex ![color:var(--text-faint)]" onClick={handleDelete} title={t('common.delete')} style={{ background: 'none' }}>
          <Trash2 size={13} />
        </button>
      </div>
      )}
    </div>
  )
}

// ── Kategorie-Gruppe ───────────────────────────────────────────────────────
interface TripMember {
  id: number
  username: string
  avatar?: string | null
  avatar_url?: string | null
}

interface CategoryAssignee {
  user_id: number
  username: string
  avatar?: string | null
}

interface KategorieGruppeProps {
  kategorie: string
  items: PackingItem[]
  tripId: number | string
  allCategories: string[]
  onRename: (oldName: string, newName: string) => Promise<void>
  onDeleteAll: (items: PackingItem[]) => Promise<void>
  onAddItem: (category: string, name: string) => Promise<void>
  assignees: CategoryAssignee[]
  tripMembers: TripMember[]
  onSetAssignees: (category: string, userIds: number[]) => Promise<void>
  bagTrackingEnabled?: boolean
  bags?: PackingBag[]
  onCreateBag: (name: string) => Promise<PackingBag | undefined>
  canEdit?: boolean
}

function KategorieGruppe({ kategorie, items, tripId, allCategories, onRename, onDeleteAll, onAddItem, assignees, tripMembers, onSetAssignees, bagTrackingEnabled, bags, onCreateBag, canEdit = true }: KategorieGruppeProps) {
  const [offen, setOffen] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [editKatName, setEditKatName] = useState(kategorie)
  const [showMenu, setShowMenu] = useState(false)
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const addItemRef = useRef<HTMLInputElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const assigneeDropdownRef = useRef<HTMLDivElement>(null)
  const { togglePackingItem } = useTripStore()
  const toast = useToast()
  const { t } = useTranslation()
  useEffect(() => {
    if (!showAssigneeDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(e.target as Node)) {
        setShowAssigneeDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAssigneeDropdown])

  const abgehakt = items.filter(i => i.checked).length
  const alleAbgehakt = abgehakt === items.length
  const dot = katColor(kategorie, allCategories)

  const handleSaveKatName = async () => {
    const neu = editKatName.trim()
    if (!neu || neu === kategorie) { setEditingName(false); setEditKatName(kategorie); return }
    try { await onRename(kategorie, neu); setEditingName(false) }
    catch { toast.error(t('packing.toast.renameError')) }
  }

  const handleCheckAll = async () => {
    for (const item of Array.from(items)) {
      if (!item.checked) await togglePackingItem(tripId, item.id, true)
    }
  }
  const handleUncheckAll = async () => {
    for (const item of Array.from(items)) {
      if (item.checked) await togglePackingItem(tripId, item.id, false)
    }
  }
  const handleDeleteAll = async () => {
    await onDeleteAll(items)
    setShowMenu(false)
  }

  return (
    <div className="!mb-[6px] !rounded-[14px] ![border:1px_solid_var(--border-secondary)] !overflow-visible" style={{ background: 'var(--bg-card)' }}>
      <div className="!flex !items-center !gap-[8px] !p-[10px_12px]" style={{ borderBottom: offen ? '1px solid var(--border-secondary)' : 'none' }}>
        <button className="![border:none] !cursor-pointer !p-[0] !flex ![color:var(--text-faint)] !shrink-[0]" onClick={() => setOffen(o => !o)} style={{ background: 'none' }}>
          {offen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>

        <span className="!w-[10px] !h-[10px] !rounded-[50%] !shrink-[0]" style={{ background: dot }} />

        {editingName && canEdit ? (
          <input className="!flex-[1] !text-[length:12.5px] !font-[600] ![border:none] [&&]:![border-bottom:2px_solid_var(--text-primary)] ![outline:none] ![font-family:inherit] ![color:var(--text-primary)] !p-[0_2px]"
            autoFocus value={editKatName}
            onChange={e => setEditKatName(e.target.value)}
            onBlur={handleSaveKatName}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveKatName(); if (e.key === 'Escape') { setEditingName(false); setEditKatName(kategorie) } }}
            style={{ background: 'transparent' }}
          />
        ) : (
          <span className="!text-[length:12.5px] !font-[700] ![color:var(--text-secondary)] !uppercase !tracking-[0.04em]">
            {kategorie}
          </span>
        )}

        {/* Assignee chips */}
        <div className="!flex !items-center !gap-[3px] !flex-[1] !min-w-[0] !ml-[4px]">
          {assignees.map(a => (
            <div className="!relative" key={a.user_id}
              onClick={e => { e.stopPropagation(); if (canEdit) onSetAssignees(kategorie, assignees.filter(x => x.user_id !== a.user_id).map(x => x.user_id)) }}
            >
              <div className="assignee-chip !w-[22px] !h-[22px] !rounded-[50%] !shrink-[0] !flex !items-center !justify-center !text-[length:10px] !font-[700] ![color:white] !uppercase ![border:2px_solid_var(--bg-card)] ![transition:opacity_0.15s]"
                style={{ cursor: canEdit ? 'pointer' : 'default', background: `hsl(${a.username.charCodeAt(0) * 37 % 360}, 55%, 55%)` }}
              >
                {a.username[0]}
              </div>
              <div className="assignee-tooltip !absolute !top-[100%] !left-[50%] !mt-[6px] !p-[3px_8px] !rounded-[6px] !z-[60] ![color:var(--bg-primary)] !text-[length:10px] !font-[600] !whitespace-nowrap !pointer-events-none ![transition:opacity_0.15s]" style={{ transform: 'translateX(-50%)', background: 'var(--text-primary)', opacity: 0 }}>
                {a.username}
              </div>
            </div>
          ))}
          {canEdit && (
          <div ref={assigneeDropdownRef} style={{ position: 'relative' }}>
            <button className="trek-hover-border-muted trek-h-color-5b795a !w-[20px] !h-[20px] !rounded-[50%] ![border:1.5px_dashed_var(--border-primary)] !cursor-pointer !flex !items-center !justify-center ![color:var(--text-faint)] !shrink-[0] !p-[0] ![transition:all_0.15s]" onClick={e => { e.stopPropagation(); setShowAssigneeDropdown(v => !v) }}
              style={{ background: 'none' }} >
              <UserPlus size={10} />
            </button>
            {showAssigneeDropdown && (
              <div className="!absolute !left-[0] !top-[100%] !mt-[4px] !z-[50] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !min-w-[160px]" style={{ background: 'var(--bg-card)' }}>
                {tripMembers.map(m => {
                  const isAssigned = assignees.some(a => a.user_id === m.id)
                  return (
                    <button className={[(!isAssigned) ? 'trek-hover-tertiary' : undefined, '!flex !items-center !gap-[8px] !w-[100%] !p-[6px_10px] !rounded-[8px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12px] ![color:var(--text-primary)] ![transition:background_0.1s]'].join(' ')} key={m.id} onClick={e => {
                      e.stopPropagation()
                      const newIds = isAssigned
                        ? assignees.filter(a => a.user_id !== m.id).map(a => a.user_id)
                        : [...assignees.map(a => a.user_id), m.id]
                      onSetAssignees(kategorie, newIds)
                    }}
                      style={{ background: isAssigned ? 'var(--bg-hover)' : 'transparent' }} >
                      <div className="!w-[20px] !h-[20px] !rounded-[50%] !shrink-[0] !flex !items-center !justify-center !text-[length:10px] !font-[700] ![color:white] !uppercase" style={{ background: `hsl(${m.username.charCodeAt(0) * 37 % 360}, 55%, 55%)` }}>
                        {m.username[0]}
                      </div>
                      <span className="!flex-[1]">{m.username}</span>
                      {isAssigned && <Check size={12} style={{ color: 'var(--text-muted)' }} />}
                    </button>
                  )
                })}
                {tripMembers.length === 0 && (
                  <div className="!p-[8px_10px] !text-[length:11px] ![color:var(--text-faint)]">{t('packing.noMembers')}</div>
                )}
              </div>
            )}
          </div>
          )}
        </div>

        <span className="!text-[length:11px] !font-[600] !p-[1px_8px] !rounded-[99px]" style={{ background: alleAbgehakt ? 'rgba(22,163,74,0.12)' : 'var(--bg-tertiary)', color: alleAbgehakt ? '#16a34a' : 'var(--text-muted)' }}>
          {abgehakt}/{items.length}
        </span>

        <div className="!relative">
          <button className="trek-hover-text2" ref={menuBtnRef} onClick={() => setShowMenu(m => !m)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 6, display: 'flex', color: 'var(--text-faint)' }}>
            <MoreHorizontal size={15} />
          </button>
          {showMenu && (() => {
            const rect = menuBtnRef.current?.getBoundingClientRect();
            return (
            <>
              <div className="!fixed !inset-[0] !z-[99]" onClick={() => setShowMenu(false)} />
              <div className="!fixed !z-[100] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.1)] !p-[4px] !min-w-[170px]" style={{ right: rect ? window.innerWidth - rect.right : 0, top: rect ? rect.bottom + 4 : 0, background: 'var(--bg-card)' }}>
                {canEdit && <MenuItem icon={<Pencil size={13} />} label={t('packing.menuRename')} onClick={() => { setEditingName(true); setShowMenu(false) }} />}
                <MenuItem icon={<CheckCheck size={13} />} label={t('packing.menuCheckAll')} onClick={() => { handleCheckAll(); setShowMenu(false) }} />
                <MenuItem icon={<RotateCcw size={13} />} label={t('packing.menuUncheckAll')} onClick={() => { handleUncheckAll(); setShowMenu(false) }} />
                {canEdit && <>
                <div className="!h-[1px] !m-[4px_0]" style={{ background: 'var(--bg-tertiary)' }} />
                <MenuItem icon={<Trash2 size={13} />} label={t('packing.menuDeleteCat')} danger onClick={handleDeleteAll} />
                </>}
              </div>
            </>
            );
          })()}
        </div>
      </div>

      {offen && (
        <div className="!p-[4px_4px_6px]">
          {items.map(item => (
            <ArtikelZeile key={item.id} item={item} tripId={tripId} categories={allCategories} onCategoryChange={() => {}} bagTrackingEnabled={bagTrackingEnabled} bags={bags} onCreateBag={onCreateBag} canEdit={canEdit} />
          ))}
          {/* Inline add item */}
          {canEdit && (showAddItem ? (
            <div className="!flex !items-center !gap-[6px] !p-[4px_8px]">
              <input
                ref={addItemRef}
                autoFocus
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newItemName.trim()) {
                    onAddItem(kategorie, newItemName.trim())
                    setNewItemName('')
                    setTimeout(() => addItemRef.current?.focus(), 30)
                  }
                  if (e.key === 'Escape') { setShowAddItem(false); setNewItemName('') }
                }}
                placeholder={t('packing.addItemPlaceholder')}
                style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-primary)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', color: 'var(--text-primary)', background: 'var(--bg-input)' }}
              />
              <button className="!p-[5px_8px] !rounded-[8px] ![border:none] ![color:var(--bg-primary)] !flex" onClick={() => { if (newItemName.trim()) { onAddItem(kategorie, newItemName.trim()); setNewItemName(''); setTimeout(() => addItemRef.current?.focus(), 30) } }}
                disabled={!newItemName.trim()}
                style={{ background: newItemName.trim() ? 'var(--text-primary)' : 'var(--border-primary)', cursor: newItemName.trim() ? 'pointer' : 'default' }}>
                <Plus size={14} />
              </button>
              <button className="![border:none] !cursor-pointer !p-[2px] !flex ![color:var(--text-faint)]" onClick={() => { setShowAddItem(false); setNewItemName('') }}
                style={{ background: 'none' }}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button className="trek-hover-text2 !flex !items-center !gap-[5px] !p-[5px_10px] !m-[2px_4px] !rounded-[8px] ![border:none] !cursor-pointer !text-[length:12px] ![color:var(--text-faint)] ![font-family:inherit]" onClick={() => { setShowAddItem(true); setTimeout(() => addItemRef.current?.focus(), 30) }}
              style={{ background: 'none' }}>
              <Plus size={12} /> {t('packing.addItem')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}

function MenuItem({ icon, label, onClick, danger }: MenuItemProps) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
      padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 12.5, fontFamily: 'inherit', borderRadius: 7, textAlign: 'left',
      color: danger ? '#ef4444' : 'var(--text-secondary)',
    }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? '#fef2f2' : 'var(--bg-tertiary)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      {icon}{label}
    </button>
  )
}

// ── Haupt-Panel ────────────────────────────────────────────────────────────
interface PackingListPanelProps {
  tripId: number | string
  items: PackingItem[]
  openImportSignal?: number
  clearCheckedSignal?: number
  saveTemplateSignal?: number
  inlineHeader?: boolean
}

export default function PackingListPanel({ tripId, items, openImportSignal = 0, clearCheckedSignal = 0, saveTemplateSignal = 0, inlineHeader = true }: PackingListPanelProps) {
  const [filter, setFilter] = useState('alle') // 'alle' | 'offen' | 'erledigt'
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const { addPackingItem, updatePackingItem, deletePackingItem } = useTripStore()
  const can = useCanDo()
  const trip = useTripStore((s) => s.trip)
  const canEdit = can('packing_edit', trip)
  const toast = useToast()
  const { t, locale } = useTranslation()

  // Trip members & category assignees
  const [tripMembers, setTripMembers] = useState<TripMember[]>([])
  const [categoryAssignees, setCategoryAssignees] = useState<Record<string, CategoryAssignee[]>>({})

  useEffect(() => {
    tripsApi.getMembers(tripId).then(data => {
      const all: TripMember[] = []
      if (data.owner) all.push({ id: data.owner.id, username: data.owner.username, avatar: data.owner.avatar_url })
      if (data.members) all.push(...data.members.map((m: any) => ({ id: m.id, username: m.username, avatar: m.avatar_url })))
      setTripMembers(all)
    }).catch(() => {})
    packingApi.getCategoryAssignees(tripId).then(data => {
      setCategoryAssignees(data.assignees || {})
    }).catch(() => {})
  }, [tripId])

  const handleSetAssignees = async (category: string, userIds: number[]) => {
    try {
      const data = await packingApi.setCategoryAssignees(tripId, category, userIds)
      setCategoryAssignees(prev => ({ ...prev, [category]: data.assignees || [] }))
    } catch {
      toast.error(t('packing.toast.saveError'))
    }
  }

  const allCategories = useMemo(() => {
    const seen: string[] = []
    for (const item of items) {
      const cat = item.category || t('packing.defaultCategory')
      if (!seen.includes(cat)) seen.push(cat)
    }
    return seen
  }, [items, t])

  const gruppiert = useMemo((): Record<string, PackingItem[]> => {
    const filtered = items.filter(i => {
      if (filter === 'offen') return !i.checked
      if (filter === 'erledigt') return i.checked
      return true
    })
    const groups = {}
    for (const item of filtered) {
      const kat = item.category || t('packing.defaultCategory')
      if (!groups[kat]) groups[kat] = []
      groups[kat].push(item)
    }
    return groups
  }, [items, filter, t])

  const abgehakt = items.filter(i => i.checked).length
  const fortschritt = items.length > 0 ? Math.round((abgehakt / items.length) * 100) : 0

  const handleAddItemToCategory = async (category: string, name: string) => {
    try {
      await addPackingItem(tripId, { name, category })
    } catch { toast.error(t('packing.toast.addError')) }
  }

  const handleAddNewCategory = async () => {
    if (!newCatName.trim()) return
    let catName = newCatName.trim()
    // Allow duplicate display names — append invisible zero-width spaces to make unique internally
    while (allCategories.includes(catName)) {
      catName += '\u200B'
    }
    try {
      await addPackingItem(tripId, { name: '...', category: catName })
      setNewCatName('')
      setAddingCategory(false)
    } catch { toast.error(t('packing.toast.addError')) }
  }

  const handleRenameCategory = async (oldName, newName) => {
    const toUpdate = items.filter(i => (i.category || t('packing.defaultCategory')) === oldName)
    for (const item of toUpdate) {
      await updatePackingItem(tripId, item.id, { category: newName })
    }
  }

  const handleDeleteCategory = async (catItems) => {
    for (const item of catItems) {
      try { await deletePackingItem(tripId, item.id) } catch {}
    }
  }

  const handleClearChecked = async () => {
    if (!confirm(t('packing.confirm.clearChecked', { count: abgehakt }))) return
    for (const item of items.filter(i => i.checked)) {
      try { await deletePackingItem(tripId, item.id) } catch {}
    }
  }

  // Bag tracking
  const [bagTrackingEnabled, setBagTrackingEnabled] = useState(false)
  const [bags, setBags] = useState<PackingBag[]>([])
  const [newBagName, setNewBagName] = useState('')
  const [showAddBag, setShowAddBag] = useState(false)
  const [showBagModal, setShowBagModal] = useState(false)

  useEffect(() => {
    adminApi.getBagTracking().then(d => {
      setBagTrackingEnabled(d.enabled)
      if (d.enabled) packingApi.listBags(tripId).then(r => setBags(r.bags || [])).catch(() => {})
    }).catch(() => {})
  }, [tripId])

  const BAG_COLORS = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#f59e0b']

  const handleCreateBag = async () => {
    if (!newBagName.trim()) return
    try {
      const data = await packingApi.createBag(tripId, { name: newBagName.trim(), color: BAG_COLORS[bags.length % BAG_COLORS.length] })
      setBags(prev => [...prev, data.bag])
      setNewBagName(''); setShowAddBag(false)
    } catch { toast.error(t('packing.toast.saveError')) }
  }

  const handleCreateBagByName = async (name: string): Promise<PackingBag | undefined> => {
    try {
      const data = await packingApi.createBag(tripId, { name, color: BAG_COLORS[bags.length % BAG_COLORS.length] })
      setBags(prev => [...prev, data.bag])
      return data.bag
    } catch { toast.error(t('packing.toast.saveError')); return undefined }
  }

  const handleDeleteBag = async (bagId: number) => {
    try {
      await packingApi.deleteBag(tripId, bagId)
      setBags(prev => prev.filter(b => b.id !== bagId))
    } catch { toast.error(t('packing.toast.deleteError')) }
  }

  const handleUpdateBag = async (bagId: number, data: Record<string, any>) => {
    try {
      const result = await packingApi.updateBag(tripId, bagId, data)
      setBags(prev => prev.map(b => b.id === bagId ? { ...b, ...result.bag } : b))
    } catch { toast.error(t('common.error')) }
  }

  const handleSetBagMembers = async (bagId: number, userIds: number[]) => {
    try {
      const result = await packingApi.setBagMembers(tripId, bagId, userIds)
      setBags(prev => prev.map(b => b.id === bagId ? { ...b, members: result.members } : b))
    } catch { toast.error(t('common.error')) }
  }

  // Templates
  const [availableTemplates, setAvailableTemplates] = useState<{ id: number; name: string; item_count: number }[]>([])
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [importText, setImportText] = useState('')
  const [showBikepackModal, setShowBikepackModal] = useState(false)
  const [showBikepackDrawer, setShowBikepackDrawer] = useState(false)
  const lastHandledImportSignal = useRef(openImportSignal)
  const lastHandledClearSignal = useRef(clearCheckedSignal)
  const lastHandledSaveSignal = useRef(saveTemplateSignal)

  useEffect(() => {
    if (openImportSignal !== lastHandledImportSignal.current && openImportSignal > 0) {
      setShowImportModal(true)
    }
    lastHandledImportSignal.current = openImportSignal
  }, [openImportSignal])

  useEffect(() => {
    if (clearCheckedSignal !== lastHandledClearSignal.current && clearCheckedSignal > 0) {
      handleClearChecked()
    }
    lastHandledClearSignal.current = clearCheckedSignal
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearCheckedSignal])

  useEffect(() => {
    if (saveTemplateSignal !== lastHandledSaveSignal.current && saveTemplateSignal > 0) {
      setShowSaveTemplate(true)
    }
    lastHandledSaveSignal.current = saveTemplateSignal
  }, [saveTemplateSignal])
  const csvInputRef = useRef<HTMLInputElement>(null)
  const templateDropdownRef = useRef<HTMLDivElement>(null)

  // Print checklist (by category / by bag)
  const [showPrintMenu, setShowPrintMenu] = useState(false)
  const printMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPrintMenu) return
    const handler = (e: MouseEvent) => {
      if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) setShowPrintMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPrintMenu])

  const handlePrintChecklist = async (groupBy: 'category' | 'bag') => {
    setShowPrintMenu(false)
    try {
      const { downloadPackingListPDF } = await import('../PDF/PackingListPDF')
      await downloadPackingListPDF({ trip, items, bags, groupBy, t, locale })
    } catch { toast.error(t('common.error')) }
  }

  useEffect(() => {
    adminApi.packingTemplates().then(d => setAvailableTemplates(d.templates || [])).catch(() => {})
  }, [tripId])

  useEffect(() => {
    if (!showTemplateDropdown) return
    const handler = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) setShowTemplateDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTemplateDropdown])

  const handleApplyTemplate = async (templateId: number) => {
    setApplyingTemplate(true)
    try {
      const data = await packingApi.applyTemplate(tripId, templateId)
      useTripStore.setState(s => ({ packingItems: [...s.packingItems, ...(data.items || [])] }))
      toast.success(t('packing.templateApplied', { count: data.count }))
      setShowTemplateDropdown(false)
    } catch {
      toast.error(t('packing.templateError'))
    } finally {
      setApplyingTemplate(false)
    }
  }

  const handleSaveAsTemplate = async () => {
    if (!saveTemplateName.trim()) return
    try {
      await packingApi.saveAsTemplate(tripId, saveTemplateName.trim())
      toast.success(t('packing.templateSaved'))
      setShowSaveTemplate(false)
      setSaveTemplateName('')
      adminApi.packingTemplates().then(d => setAvailableTemplates(d.templates || [])).catch(() => {})
    } catch {
      toast.error(t('common.error'))
    }
  }

  // Parse CSV line respecting quoted values (e.g. "Shirt, blue" stays as one field)
  const parseCsvLine = (line: string): string[] => {
    const parts: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) { parts.push(current.trim()); current = ''; continue }
      current += ch
    }
    parts.push(current.trim())
    return parts
  }

  const parseImportLines = (text: string) => {
    return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      // Format: Category, Name, Weight (optional), Bag (optional), checked/unchecked (optional)
      const parts = parseCsvLine(line)
      if (parts.length >= 2) {
        const category = parts[0]
        const name = parts[1]
        const weight_grams = parts[2] || undefined
        const bag = parts[3] || undefined
        const checked = parts[4]?.toLowerCase() === 'checked' || parts[4] === '1'
        return { name, category, weight_grams, bag, checked }
      }
      // Single value = just a name
      return { name: parts[0], category: undefined, weight_grams: undefined, bag: undefined, checked: false }
    }).filter(i => i.name)
  }

  const handleBulkImport = async () => {
    const parsed = parseImportLines(importText)
    if (parsed.length === 0) { toast.error(t('packing.importEmpty')); return }
    try {
      const result = await packingApi.bulkImport(tripId, parsed)
      useTripStore.setState(s => ({ packingItems: [...s.packingItems, ...(result.items || [])] }))
      toast.success(t('packing.importSuccess', { count: result.count }))
      setImportText('')
      setShowImportModal(false)
    } catch { toast.error(t('packing.importError')) }
  }

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') setImportText(reader.result) }
    reader.readAsText(file)
  }

  const font = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', ...font }}>

      {/* ── Header ── */}
      <div className="!shrink-[0]" style={{ padding: inlineHeader ? '20px 24px 16px' : '0 0 16px', borderBottom: inlineHeader ? '1px solid rgba(0,0,0,0.06)' : undefined }}>
        <div className="!flex !justify-between !gap-[14px]" style={{ alignItems: inlineHeader ? 'flex-start' : 'center' }}>
          {inlineHeader ? (
            <div>
              <h2 className="!m-[0] !text-[length:18px] !font-[700] ![color:var(--text-primary)]">{t('packing.title')}</h2>
              {items.length > 0 && (
                <p className="!m-[2px_0_0] !text-[length:12.5px] ![color:var(--text-faint)]">
                  {t('packing.progress', { packed: abgehakt, total: items.length, percent: fortschritt })}
                </p>
              )}
            </div>
          ) : <span />}
          <div className="!flex !gap-[6px] !flex-wrap !justify-end">
            {canEdit && items.length > 0 && showSaveTemplate && (
              <div className="!flex !items-center !gap-[4px]">
                <input className="!text-[length:12px] !p-[5px_10px] !rounded-[99px] ![border:1px_solid_var(--border-primary)] ![outline:none] ![font-family:inherit] !w-[140px] ![color:var(--text-primary)]"
                  type="text" autoFocus
                  value={saveTemplateName}
                  onChange={e => setSaveTemplateName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveAsTemplate(); if (e.key === 'Escape') { setShowSaveTemplate(false); setSaveTemplateName('') } }}
                  placeholder={t('packing.templateName')}
                  style={{ background: 'var(--bg-card)' }}
                />
                <button className="![border:none] !cursor-pointer !p-[2px] ![color:#10b981]" onClick={handleSaveAsTemplate} style={{ background: 'none' }}><Check size={14} /></button>
                <button className="![border:none] !cursor-pointer !p-[2px] ![color:var(--text-faint)]" onClick={() => { setShowSaveTemplate(false); setSaveTemplateName('') }} style={{ background: 'none' }}><X size={14} /></button>
              </div>
            )}
             {inlineHeader && canEdit && (
              <div className="!flex !gap-[6px]">
                <button className="!flex !items-center !gap-[5px] !p-[5px_11px] !rounded-[99px] ![border:1px_solid_var(--border-primary)] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setShowImportModal(true)} style={{ background: 'var(--bg-card)' }}>
                  <Upload size={12} /> <span className="hidden sm:inline">{t('packing.import')}</span>
                </button>
                <button className="!flex !items-center !gap-[5px] !p-[5px_11px] !rounded-[99px] ![border:1px_solid_#0d9488] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit] ![color:#0d9488]"
                  onClick={() => setShowBikepackModal(true)}
                  style={{ background: 'var(--bg-card)' }}
                  title="Importar perfil de equipaje desde Bikepack"
                >
                  🚴 <span className="hidden sm:inline">Bikepack</span>
                </button>
              </div>
            )}

            {inlineHeader && canEdit && abgehakt > 0 && (
              <button className="!text-[length:11.5px] !p-[5px_10px] !rounded-[99px] ![border:1px_solid_rgba(239,68,68,0.3)] ![color:#ef4444] !cursor-pointer ![font-family:inherit]" onClick={handleClearChecked} style={{ background: 'rgba(239,68,68,0.1)' }}>
                <span className="hidden sm:inline">{t('packing.clearChecked', { count: abgehakt })}</span>
                <span className="sm:hidden">{t('packing.clearCheckedShort', { count: abgehakt })}</span>
              </button>
            )}
            {inlineHeader && canEdit && availableTemplates.length > 0 && (
              <div ref={templateDropdownRef} style={{ position: 'relative' }}>
                <button className={['!flex !items-center !gap-[5px] !p-[5px_11px] !rounded-[99px] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]', (showTemplateDropdown) ? '[&&]:![border-color:var(--text-primary)]' : '[&&]:![border-color:var(--border-primary)]', (showTemplateDropdown) ? '![color:var(--bg-primary)]' : '![color:var(--text-muted)]', '![border:1px_solid]'].join(' ')} onClick={() => setShowTemplateDropdown(v => !v)} disabled={applyingTemplate} style={{ background: showTemplateDropdown ? 'var(--text-primary)' : 'var(--bg-card)' }}>
                  <Package size={12} /> <span className="hidden sm:inline">{t('packing.applyTemplate')}</span><span className="sm:hidden">{t('packing.template')}</span>
                </button>
                {showTemplateDropdown && (
                  <div className="!absolute !right-[0] !top-[100%] !mt-[6px] !z-[50] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !min-w-[200px]" style={{ background: 'var(--bg-card)' }}>
                    {availableTemplates.map(tmpl => (
                      <button className="trek-hover-tertiary !flex !items-center !gap-[8px] !w-[100%] !p-[8px_12px] !rounded-[8px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12px] ![color:var(--text-primary)] ![transition:background_0.1s]" key={tmpl.id} onClick={() => handleApplyTemplate(tmpl.id)}
                        style={{ background: 'transparent' }} >
                        <Package size={13} style={{ color: 'var(--text-faint)' }} />
                        <div className="!flex-[1] !text-left">
                          <div className="!font-[600]">{tmpl.name}</div>
                          <div className="!text-[length:10px] ![color:var(--text-faint)]">{tmpl.item_count} {t('admin.packingTemplates.items')}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {inlineHeader && canEdit && items.length > 0 && !showSaveTemplate && (
              <button className="!flex !items-center !gap-[5px] !p-[5px_11px] !rounded-[99px] ![border:1px_solid_var(--border-primary)] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit] ![color:var(--text-muted)]" onClick={() => setShowSaveTemplate(true)} style={{ background: 'var(--bg-card)' }}>
                <FolderPlus size={12} /> <span className="hidden sm:inline">{t('packing.saveAsTemplate')}</span>
              </button>
            )}
            {items.length > 0 && (
              <div ref={printMenuRef} style={{ position: 'relative' }}>
                <button className={['!flex !items-center !gap-[5px] !p-[5px_11px] !rounded-[99px] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]', (showPrintMenu) ? '[&&]:![border-color:var(--text-primary)]' : '[&&]:![border-color:var(--border-primary)]', (showPrintMenu) ? '![color:var(--bg-primary)]' : '![color:var(--text-muted)]', '![border:1px_solid]'].join(' ')} onClick={() => setShowPrintMenu(v => !v)} style={{ background: showPrintMenu ? 'var(--text-primary)' : 'var(--bg-card)' }}>
                  <Printer size={12} /> <span className="hidden sm:inline">{t('packing.print')}</span>
                </button>
                {showPrintMenu && (
                  <div className="!absolute !right-[0] !top-[100%] !mt-[6px] !z-[50] ![border:1px_solid_var(--border-primary)] !rounded-[10px] ![box-shadow:0_4px_16px_rgba(0,0,0,0.12)] !p-[4px] !min-w-[190px]" style={{ background: 'var(--bg-card)' }}>
                    <button className="trek-hover-tertiary !flex !items-center !gap-[8px] !w-[100%] !p-[8px_12px] !rounded-[8px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12.5px] ![color:var(--text-primary)] !text-left" onClick={() => handlePrintChecklist('category')} style={{ background: 'transparent' }}>
                      {t('packing.printByCategory')}
                    </button>
                    {bagTrackingEnabled && bags.length > 0 && (
                      <button className="trek-hover-tertiary !flex !items-center !gap-[8px] !w-[100%] !p-[8px_12px] !rounded-[8px] ![border:none] !cursor-pointer ![font-family:inherit] !text-[length:12.5px] ![color:var(--text-primary)] !text-left" onClick={() => handlePrintChecklist('bag')} style={{ background: 'transparent' }}>
                        {t('packing.printByBag')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {bagTrackingEnabled && (
              <button onClick={() => setShowBagModal(true)} className={['xl:!hidden !flex !items-center !gap-[5px] !p-[5px_11px] !rounded-[99px] !text-[length:12px] !font-[500] !cursor-pointer ![font-family:inherit]', (showBagModal) ? '[&&]:![border-color:var(--text-primary)]' : '[&&]:![border-color:var(--border-primary)]', (showBagModal) ? '![color:var(--bg-primary)]' : '![color:var(--text-muted)]', '![border:1px_solid]'].join(' ')}
                style={{ background: showBagModal ? 'var(--text-primary)' : 'var(--bg-card)' }}>
                <Luggage size={12} /> {t('packing.bags')}
              </button>
            )}
          </div>
        </div>

          {items.length > 0 && (
          <div className="hidden sm:block !mt-[14px] !mb-[14px]">
            <div className="flex items-center !gap-[14px]">
              {fortschritt === 100 ? (
                <div className="!flex !items-center !gap-[8px] !text-[length:16px] !font-[700] ![color:#10b981] !tracking-[-0.01em] !shrink-[0]">
                  <CheckCheck size={18} strokeWidth={2.5} />
                  <span>{t('packing.allPacked')}</span>
                </div>
              ) : (
                <div className="!flex !items-baseline !gap-[8px] !shrink-[0]">
                  <div className="!flex !items-baseline">
                    <span className="!text-[length:22px] !font-[700] ![color:var(--text-primary)] ![font-variant-numeric:tabular-nums] !tracking-[-0.02em] !leading-[1]">{abgehakt}</span>
                    <span className="!text-[length:14px] !font-[500] ![color:var(--text-faint)] ![font-variant-numeric:tabular-nums] !leading-[1] !ml-[1px]">/{items.length}</span>
                  </div>
                  <span className="!text-[length:11px] !font-[600] !p-[2px_7px] !rounded-[99px] ![color:var(--text-muted)] ![font-variant-numeric:tabular-nums] !leading-[1.4]" style={{ background: 'var(--bg-tertiary)' }}>{fortschritt}%</span>
                </div>
              )}

              <div className="!flex-[1] !h-[8px] !rounded-[99px] !overflow-hidden !relative !w-[100%]" style={{ background: 'var(--bg-tertiary)' }}>
                <div className="!h-[100%] !rounded-[99px] ![transition:width_600ms_cubic-bezier(0.23,_1,_0.32,_1),_background_400ms_ease,_box-shadow_400ms_ease] !relative" style={{ background: fortschritt === 100
                    ? 'linear-gradient(90deg, #10b981 0%, #34d399 100%)'
                    : 'var(--accent)', width: `${fortschritt}%`, boxShadow: fortschritt === 100 ? '0 0 14px rgba(16,185,129,0.45)' : 'none' }}>
                  <div className="!absolute !inset-[0] !rounded-[99px] !pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 55%)' }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {canEdit && (addingCategory ? (
          <div className="!flex !gap-[6px]">
            <input className="!flex-[1] !p-[8px_12px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] !text-[length:13.5px] ![font-family:inherit] ![outline:none] ![color:var(--text-primary)]"
              autoFocus
              type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddNewCategory(); if (e.key === 'Escape') { setAddingCategory(false); setNewCatName('') } }}
              placeholder={t('packing.newCategoryPlaceholder')}
            />
            <button className="!p-[8px_12px] !rounded-[10px] ![border:none] ![color:var(--bg-primary)] !flex !items-center" onClick={handleAddNewCategory} disabled={!newCatName.trim()}
              style={{ background: newCatName.trim() ? 'var(--text-primary)' : 'var(--border-primary)', cursor: newCatName.trim() ? 'pointer' : 'default' }}>
              <Check size={16} />
            </button>
            <button className="!p-[8px_12px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] !cursor-pointer !flex !items-center ![color:var(--text-faint)]" onClick={() => { setAddingCategory(false); setNewCatName('') }}
              style={{ background: 'none' }}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <button className="trek-hover-border-muted trek-hover-text2 !flex !items-center !gap-[6px] !w-[100%] !p-[9px_14px] !rounded-[10px] ![border:1px_dashed_var(--border-primary)] !cursor-pointer !text-[length:13px] ![color:var(--text-faint)] ![font-family:inherit] ![transition:all_0.15s]" onClick={() => setAddingCategory(true)}
            style={{ background: 'none' }}>
            <FolderPlus size={14} /> {t('packing.addCategory')}
          </button>
        ))}
      </div>

      {/* ── Filter-Tabs ── */}
      {items.length > 0 && (
        <div className="!flex !gap-[4px] !p-[10px_0_0] !shrink-[0]">
          {[['alle', t('packing.filterAll')], ['offen', t('packing.filterOpen')], ['erledigt', t('packing.filterDone')]].map(([id, label]) => (
            <button className={['!p-[4px_12px] !rounded-[99px] ![border:none] !cursor-pointer', (filter === id) ? '!font-[600]' : '!font-[400]', (filter === id) ? '![color:var(--bg-primary)]' : '![color:var(--text-muted)]', '!text-[length:12px] ![font-family:inherit]'].join(' ')} key={id} onClick={() => setFilter(id)} style={{ background: filter === id ? 'var(--text-primary)' : 'transparent' }}>{label}</button>
          ))}
        </div>
      )}

      {/* ── Liste + Bags Sidebar ── */}
      <div className="!flex-[1] !flex !overflow-hidden">
      <div className="!flex-[1] !overflow-y-auto !p-[10px_0_16px]">
        {items.length === 0 ? (
          <div className="!text-center !p-[60px_20px]">
            <Luggage size={40} style={{ color: 'var(--text-faint)', display: 'block', margin: '0 auto 10px' }} />
            <p className="!text-[length:14px] !font-[600] ![color:var(--text-secondary)] !m-[0_0_4px]">{t('packing.emptyTitle')}</p>
            <p className="!text-[length:13px] ![color:var(--text-faint)] !m-[0]">{t('packing.emptyHint')}</p>
          </div>
        ) : Object.keys(gruppiert).length === 0 ? (
          <div className="!text-center !p-[40px_20px] ![color:var(--text-faint)]">
            <p className="!text-[length:13px] !m-[0]">{t('packing.emptyFiltered')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {Object.entries(gruppiert).map(([kat, katItems]) => (
              <KategorieGruppe
                key={kat}
                kategorie={kat}
                items={katItems}
                tripId={tripId}
                allCategories={allCategories}
                onRename={handleRenameCategory}
                onDeleteAll={handleDeleteCategory}
                onAddItem={handleAddItemToCategory}
                assignees={categoryAssignees[kat] || []}
                tripMembers={tripMembers}
                onSetAssignees={handleSetAssignees}
                bagTrackingEnabled={bagTrackingEnabled}
                bags={bags}
                onCreateBag={handleCreateBagByName}
                canEdit={canEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Bag Weight Sidebar ── */}
      {bagTrackingEnabled && bags.length > 0 && (
        <div className="hidden xl:block !w-[260px] ![border-left:1px_solid_var(--border-secondary)] !overflow-y-auto !p-[16px] !shrink-[0]">
          <div className="!flex !items-center !justify-between !mb-[12px]">
            <div className="!text-[length:11px] !font-[700] !uppercase !tracking-[0.05em] ![color:var(--text-faint)]">
              {t('packing.bags')}
            </div>
            <button className="!flex !items-center !gap-[4px] !text-[length:11px] !font-[600] ![color:#0d9488] !p-[3px_8px] !rounded-[99px] ![border:1px_solid_#0d9488] !cursor-pointer ![font-family:inherit]" onClick={() => setShowBikepackDrawer(true)}
              style={{ background: 'none', opacity: 0.8 }}
              title='Abrir Bikepack'>
              🚴 Bikepack
            </button>
          </div>

          {bags.map(bag => {
            const bagItems = items.filter(i => i.bag_id === bag.id)
            const totalWeight = bagItems.reduce((sum, i) => sum + (i.weight_grams || 0), 0)
            const maxWeight = bag.weight_limit_grams || Math.max(...bags.map(b => items.filter(i => i.bag_id === b.id).reduce((s, i) => s + (i.weight_grams || 0), 0)), 1)
            const pct = Math.min(100, Math.round((totalWeight / maxWeight) * 100))
            return (
              <BagCard key={bag.id} bag={bag} bagItems={bagItems} totalWeight={totalWeight} pct={pct} tripId={tripId} tripMembers={tripMembers} canEdit={canEdit} onDelete={() => handleDeleteBag(bag.id)} onUpdate={handleUpdateBag} onSetMembers={handleSetBagMembers} t={t} compact />
            )
          })}

          {/* Unassigned */}
          {(() => {
            const unassigned = items.filter(i => !i.bag_id)
            const unassignedWeight = unassigned.reduce((s, i) => s + (i.weight_grams || 0), 0)
            if (unassigned.length === 0) return null
            return (
              <div className="!mb-[14px]" style={{ opacity: 0.6 }}>
                <div className="!flex !items-center !gap-[6px] !mb-[4px]">
                  <span className="!w-[10px] !h-[10px] !rounded-[50%] ![border:2px_dashed_var(--border-primary)] !shrink-[0]" />
                  <span className="!flex-[1] !text-[length:12px] !font-[600] ![color:var(--text-faint)]">{t('packing.noBag')}</span>
                  <span className="!text-[length:11px] ![color:var(--text-faint)]">
                    {unassignedWeight >= 1000 ? `${(unassignedWeight / 1000).toFixed(1)} kg` : `${unassignedWeight} g`}
                  </span>
                </div>
                <div className="!text-[length:10px] ![color:var(--text-faint)]">{unassigned.length} {t('admin.packingTemplates.items')}</div>
              </div>
            )
          })()}

          {/* Total */}
          <div className="![border-top:1px_solid_var(--border-secondary)] !pt-[10px] !mt-[6px]">
            <div className="!flex !justify-between !text-[length:12px] !font-[700] ![color:var(--text-primary)]">
              <span>{t('packing.totalWeight')}</span>
              <span>{(() => { const w = items.reduce((s, i) => s + (i.weight_grams || 0), 0); return w >= 1000 ? `${(w / 1000).toFixed(1)} kg` : `${w} g` })()}</span>
            </div>
          </div>

          {/* Add bag */}
          {canEdit && (showAddBag ? (
            <div className="!flex !gap-[4px] !mt-[12px]">
              <input className="!flex-[1] !p-[5px_8px] !rounded-[8px] ![border:1px_solid_var(--border-primary)] !text-[length:11px] ![font-family:inherit] ![outline:none]" autoFocus value={newBagName} onChange={e => setNewBagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateBag(); if (e.key === 'Escape') { setShowAddBag(false); setNewBagName('') } }}
                placeholder={t('packing.bagName')} />
              <button className="!p-[4px_8px] !rounded-[8px] ![border:none] ![color:var(--bg-primary)] !cursor-pointer !flex !items-center" onClick={handleCreateBag} style={{ background: 'var(--text-primary)' }}>
                <Plus size={12} />
              </button>
            </div>
          ) : (
            <button className="!flex !items-center !gap-[4px] !mt-[12px] !p-[5px_8px] !rounded-[8px] ![border:1px_dashed_var(--border-primary)] !cursor-pointer !text-[length:11px] ![color:var(--text-faint)] ![font-family:inherit] !w-[100%]" onClick={() => setShowAddBag(true)}
              style={{ background: 'none' }}>
              <Plus size={11} /> {t('packing.addBag')}
            </button>
          ))}
        </div>
      )}
      </div>

      {/* ── Bag Modal (mobile + click) ── */}
      {showBagModal && bagTrackingEnabled && (
        <div className="!fixed !inset-[0] !z-[100] !flex !items-start !justify-center !p-[20px] [&&]:!pt-[140px] [&&]:!pb-[calc(20px_+_var(--bottom-nav-h))] !overflow-y-auto" style={{ background: 'rgba(0,0,0,0.3)' }}
          onClick={() => setShowBagModal(false)}>
          <div className="!rounded-[16px] !w-[100%] !max-w-[360px] !max-h-[calc(100vh_-_80px)] !overflow-auto !p-[20px] ![box-shadow:0_16px_48px_rgba(0,0,0,0.15)] !shrink-[0]" style={{ background: 'var(--bg-card)' }}
            onClick={e => e.stopPropagation()}>
            <div className="!flex !items-center !justify-between !mb-[16px]">
              <h3 className="!m-[0] !text-[length:16px] !font-[700] ![color:var(--text-primary)]">{t('packing.bags')}</h3>
              <button className="![border:none] !cursor-pointer ![color:var(--text-faint)] !flex" onClick={() => setShowBagModal(false)} style={{ background: 'none' }}><X size={18} /></button>
            </div>

            {bags.map(bag => {
              const bagItems = items.filter(i => i.bag_id === bag.id)
              const totalWeight = bagItems.reduce((sum, i) => sum + (i.weight_grams || 0), 0)
              const maxWeight = Math.max(...bags.map(b => items.filter(i => i.bag_id === b.id).reduce((s, i) => s + (i.weight_grams || 0), 0)), 1)
              const pct = Math.min(100, Math.round((totalWeight / maxWeight) * 100))
              return (
                <BagCard key={bag.id} bag={bag} bagItems={bagItems} totalWeight={totalWeight} pct={pct} tripId={tripId} tripMembers={tripMembers} canEdit={canEdit} onDelete={() => handleDeleteBag(bag.id)} onUpdate={handleUpdateBag} onSetMembers={handleSetBagMembers} t={t} />
              )
            })}

            {/* Unassigned */}
            {(() => {
              const unassigned = items.filter(i => !i.bag_id)
              const unassignedWeight = unassigned.reduce((s, i) => s + (i.weight_grams || 0), 0)
              if (unassigned.length === 0) return null
              return (
                <div className="!mb-[16px]" style={{ opacity: 0.6 }}>
                  <div className="!flex !items-center !gap-[8px] !mb-[6px]">
                    <span className="!w-[12px] !h-[12px] !rounded-[50%] ![border:2px_dashed_var(--border-primary)] !shrink-[0]" />
                    <span className="!flex-[1] !text-[length:14px] !font-[600] ![color:var(--text-faint)]">{t('packing.noBag')}</span>
                    <span className="!text-[length:13px] ![color:var(--text-faint)]">
                      {unassignedWeight >= 1000 ? `${(unassignedWeight / 1000).toFixed(1)} kg` : `${unassignedWeight} g`}
                    </span>
                  </div>
                  <div className="!text-[length:11px] ![color:var(--text-faint)]">{unassigned.length} {t('admin.packingTemplates.items')}</div>
                </div>
              )
            })()}

            {/* Total */}
            <div className="![border-top:1px_solid_var(--border-secondary)] !pt-[12px] !mt-[8px]">
              <div className="!flex !justify-between !text-[length:14px] !font-[700] ![color:var(--text-primary)]">
                <span>{t('packing.totalWeight')}</span>
                <span>{(() => { const w = items.reduce((s, i) => s + (i.weight_grams || 0), 0); return w >= 1000 ? `${(w / 1000).toFixed(1)} kg` : `${w} g` })()}</span>
              </div>
            </div>

            {/* Add bag */}
            {canEdit && (showAddBag ? (
              <div className="!flex !gap-[6px] !mt-[14px]">
                <input className="!flex-[1] !p-[8px_12px] !rounded-[10px] ![border:1px_solid_var(--border-primary)] !text-[length:13px] ![font-family:inherit] ![outline:none]" autoFocus value={newBagName} onChange={e => setNewBagName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateBag(); if (e.key === 'Escape') { setShowAddBag(false); setNewBagName('') } }}
                  placeholder={t('packing.bagName')} />
                <button className="!p-[8px_12px] !rounded-[10px] ![border:none] ![color:var(--bg-primary)] !flex !items-center" onClick={handleCreateBag} disabled={!newBagName.trim()}
                  style={{ background: newBagName.trim() ? 'var(--text-primary)' : 'var(--border-primary)', cursor: newBagName.trim() ? 'pointer' : 'default' }}>
                  <Plus size={14} />
                </button>
              </div>
            ) : (
              <button className="trek-hover-border-muted trek-hover-text2 !flex !items-center !gap-[6px] !mt-[14px] !p-[9px_14px] !rounded-[10px] ![border:1px_dashed_var(--border-primary)] !cursor-pointer !text-[length:13px] ![color:var(--text-faint)] ![font-family:inherit] !w-[100%] ![transition:all_0.15s]" onClick={() => setShowAddBag(true)}
                style={{ background: 'none' }}>
                <Plus size={14} /> {t('packing.addBag')}
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .assignee-chip:hover + .assignee-tooltip { opacity: 1 !important; }
        .assignee-chip:hover { opacity: 0.7; }
      `}</style>

      {/* Bulk Import Modal */}
      {showImportModal && ReactDOM.createPortal(
        <div className="!fixed !inset-[0] !z-[1000] !flex !items-center !justify-center ![backdrop-filter:blur(3px)]" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowImportModal(false)}>
          <div className="!w-[420px] !max-h-[80vh] !rounded-[16px] ![box-shadow:0_16px_48px_rgba(0,0,0,0.22)] !p-[22px_22px_18px] !flex !flex-col !gap-[14px]" style={{ background: 'var(--bg-card)' }} onClick={e => e.stopPropagation()}>
            <div className="!text-[length:15px] !font-[600] ![color:var(--text-primary)]">{t('packing.importTitle')}</div>
            <div className="!text-[length:12px] ![color:var(--text-faint)] !leading-[1.5]">{t('packing.importHint')}</div>
            <div className="!flex ![border:1px_solid_var(--border-primary)] !rounded-[10px] !overflow-hidden" style={{ background: 'var(--bg-input)' }}>
              <div className="!p-[10px_0] !text-[length:13px] ![font-family:monospace] !leading-[1.5] ![color:var(--text-faint)] !text-right !select-none ![border-right:1px_solid_var(--border-faint)] !min-w-[32px] !shrink-[0]" style={{ background: 'var(--bg-hover)' }}>
                {(importText || ' ').split('\n').map((_, i) => (
                  <div className="!p-[0_6px]" key={i}>{i + 1}</div>
                ))}
              </div>
              <textarea className="!flex-[1] ![border:none] !p-[10px_12px] !text-[length:13px] ![font-family:monospace] ![outline:none] !box-border ![color:var(--text-primary)] ![resize:vertical] !leading-[1.5]"
                value={importText}
                onChange={e => setImportText(e.target.value)}
                rows={10}
                placeholder={t('packing.importPlaceholder')}
                style={{ background: 'transparent' }}
              />
            </div>
            <div className="!flex !items-center !justify-between">
              <div>
                <input ref={csvInputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCsvFile} />
                <button className="!flex !items-center !gap-[5px] !p-[5px_10px] ![border:1px_dashed_var(--border-primary)] !rounded-[8px] !text-[length:11px] ![color:var(--text-faint)] !cursor-pointer ![font-family:inherit]" onClick={() => csvInputRef.current?.click()} style={{ background: 'none' }}>
                  <Upload size={11} /> {t('packing.importCsv')}
                </button>
              </div>
              <div className="!flex !gap-[8px]">
                <button className="!text-[length:12px] ![border:1px_solid_var(--border-primary)] !rounded-[8px] !p-[6px_14px] !cursor-pointer ![color:var(--text-muted)] ![font-family:inherit]" onClick={() => setShowImportModal(false)} style={{ background: 'none' }}>{t('common.cancel')}</button>
                <button className="!text-[length:12px] ![color:var(--accent-text)] ![border:none] !rounded-[8px] !p-[6px_16px] !cursor-pointer !font-[600] ![font-family:inherit]" onClick={handleBulkImport} disabled={!importText.trim()} style={{ background: 'var(--accent)', opacity: importText.trim() ? 1 : 0.5 }}>{t('packing.importAction', { count: parseImportLines(importText).length })}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showBikepackDrawer && (
        <BikepackDrawer
          onClose={() => setShowBikepackDrawer(false)}
          onImport={() => { setShowBikepackDrawer(false); setShowBikepackModal(true) }}
        />
      )}
      {showBikepackModal && (
        <BikepackImportModal
          tripId={tripId}
          onClose={() => setShowBikepackModal(false)}
          onImported={() => {
            // recarga los items del packing list
            window.dispatchEvent(new CustomEvent('bikepack:imported', { detail: { tripId } }))
          }}
        />
      )}
    </div>
  )
}

        