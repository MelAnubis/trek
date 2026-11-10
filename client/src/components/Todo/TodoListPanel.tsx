import { useState, useMemo, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useToast } from '../shared/Toast'
import { useTranslation } from '../../i18n'
import { tripsApi } from '../../api/client'
import apiClient from '../../api/client'
import CustomSelect from '../shared/CustomSelect'
import { CustomDatePicker } from '../shared/CustomDateTimePicker'
import { formatDate as fmtDate } from '../../utils/formatters'
import {
  CheckSquare, Square, Plus, ChevronRight, Flag,
  X, Check, Calendar, User, FolderPlus, AlertCircle, ListChecks, Inbox, CheckCheck, Trash2,
} from 'lucide-react'
import type { TodoItem } from '../../types'

const KAT_COLORS = [
  '#3b82f6', '#a855f7', '#ec4899', '#22c55e', '#f97316',
  '#06b6d4', '#ef4444', '#eab308', '#8b5cf6', '#14b8a6',
]

const PRIO_CONFIG: Record<number, { label: string; color: string }> = {
  1: { label: 'P1', color: '#ef4444' },
  2: { label: 'P2', color: '#f59e0b' },
  3: { label: 'P3', color: '#3b82f6' },
}

function katColor(kat: string, allCategories: string[]) {
  const idx = allCategories.indexOf(kat)
  if (idx >= 0) return KAT_COLORS[idx % KAT_COLORS.length]
  let h = 0
  for (let i = 0; i < kat.length; i++) h = ((h << 5) - h + kat.charCodeAt(i)) | 0
  return KAT_COLORS[Math.abs(h) % KAT_COLORS.length]
}

type FilterType = 'all' | 'my' | 'overdue' | 'done' | string

interface Member { id: number; username: string; avatar: string | null }

export default function TodoListPanel({ tripId, items, addItemSignal = 0 }: { tripId: number | string; items: TodoItem[]; addItemSignal?: number }) {
  const { addTodoItem, updateTodoItem, deleteTodoItem, toggleTodoItem } = useTripStore()
  // useCanDo() returns the checker; calling it with the key used to hand back
  // the function itself, so canEdit was always truthy (edit controls for everyone).
  const can = useCanDo()
  const trip = useTripStore(s => s.trip)
  const canEdit = can('packing_edit', trip)
  const toast = useToast()
  const { t, locale } = useTranslation()
  const formatDate = (d: string) => fmtDate(d, locale) || d

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [filter, setFilter] = useState<FilterType>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const lastHandledAddSignal = useRef(addItemSignal)

  useEffect(() => {
    if (addItemSignal !== lastHandledAddSignal.current && addItemSignal > 0) {
      setSelectedId(null)
      setIsAddingNew(true)
    }
    lastHandledAddSignal.current = addItemSignal
  }, [addItemSignal])
  const [sortByPrio, setSortByPrio] = useState(false)
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  useEffect(() => {
    apiClient.get(`/trips/${tripId}/members`).then(r => {
      const owner = r.data?.owner
      const mems = r.data?.members || []
      const all = owner ? [owner, ...mems] : mems
      setMembers(all)
      setCurrentUserId(r.data?.current_user_id || null)
    }).catch(() => {})
  }, [tripId])

  const categories = useMemo(() => {
    const cats = new Set<string>()
    items.forEach(i => { if (i.category) cats.add(i.category) })
    return Array.from(cats).sort()
  }, [items])

  const today = new Date().toISOString().split('T')[0]

  const filtered = useMemo(() => {
    let result: TodoItem[]
    if (filter === 'all') result = items.filter(i => !i.checked)
    else if (filter === 'done') result = items.filter(i => !!i.checked)
    else if (filter === 'my') result = items.filter(i => !i.checked && i.assigned_user_id === currentUserId)
    else if (filter === 'overdue') result = items.filter(i => !i.checked && i.due_date && i.due_date < today)
    else result = items.filter(i => i.category === filter)
    if (sortByPrio) result = [...result].sort((a, b) => {
      const ap = a.priority || 99
      const bp = b.priority || 99
      return ap - bp
    })
    return result
  }, [items, filter, currentUserId, today, sortByPrio])

  const selectedItem = items.find(i => i.id === selectedId) || null
  const totalCount = items.length
  const doneCount = items.filter(i => !!i.checked).length
  const overdueCount = items.filter(i => !i.checked && i.due_date && i.due_date < today).length
  const myCount = currentUserId ? items.filter(i => !i.checked && i.assigned_user_id === currentUserId).length : 0

  const addCategory = () => {
    const name = newCategoryName.trim()
    if (!name || categories.includes(name)) { setAddingCategory(false); setNewCategoryName(''); return }
    addTodoItem(tripId, { name: t('todo.newItem'), category: name } as any)
      .then(() => { setAddingCategory(false); setNewCategoryName(''); setFilter(name) })
      .catch(err => toast.error(err instanceof Error ? err.message : t('common.error')))
  }

  // Get category count (non-done items)
  const catCount = (cat: string) => items.filter(i => i.category === cat && !i.checked).length

  // Sidebar filter item
  const SidebarItem = ({ id, icon: Icon, label, count, color }: { id: string; icon: any; label: string; count: number; color?: string }) => (
    <button className={[(filter !== id) ? 'trek-hover' : undefined, '!flex !items-center !cursor-pointer ![transition:all_0.1s] !relative'].join(' ')} onClick={() => setFilter(id as FilterType)}
      title={isMobile ? label : undefined}
      style={{ justifyContent: isMobile ? 'center' : 'flex-start', gap: isMobile ? 0 : 8, width: '100%', padding: isMobile ? '8px 0' : '7px 12px', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, background: filter === id ? 'var(--bg-hover)' : 'transparent', color: filter === id ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: filter === id ? 600 : 400 }}>
      {color ? (
        <span className="!shrink-[0]" style={{ width: isMobile ? 12 : 10, height: isMobile ? 12 : 10, borderRadius: '50%', background: color }} />
      ) : (
        <Icon size={isMobile ? 18 : 15} style={{ flexShrink: 0, opacity: 0.7 }} />
      )}
      {!isMobile && <span className="!flex-[1] !text-left">{label}</span>}
      {!isMobile && count > 0 && (
        <span className="!text-[length:11px] ![color:var(--text-faint)] ![background:var(--bg-hover)] !p-[1px_7px] !min-w-[20px] !text-center" style={{ borderRadius: 10 }}>
          {count}
        </span>
      )}
      {isMobile && count > 0 && (
        <span className="!absolute !top-[2px] !right-[2px] !text-[length:8px] !font-[700] ![color:var(--bg-primary)] ![background:var(--text-faint)] !h-[14px] !flex !items-center !justify-center" style={{ borderRadius: '50%', width: 14 }}>
          {count}
        </span>
      )}
    </button>
  )

  // Filter title
  const filterTitle = (() => {
    if (filter === 'all') return t('todo.filter.all')
    if (filter === 'done') return t('todo.filter.done')
    if (filter === 'my') return t('todo.filter.my')
    if (filter === 'overdue') return t('todo.filter.overdue')
    return filter
  })()

  return (
    <div className="!flex !h-[calc(100vh_-_180px)] !min-h-[400px]">

      {/* ── Left Sidebar ── */}
      <div className="!shrink-[0] !flex !flex-col !gap-[2px] !overflow-y-auto ![transition:width_0.2s]" style={{ width: isMobile ? 52 : 220, borderRight: '1px solid var(--border-faint)', padding: isMobile ? '12px 6px' : '16px 12px 16px 0' }}>
        {/* Progress Card */}
        {!isMobile && <div className="!m-[0_0_12px] !p-[14px_14px_12px] ![background:var(--bg-hover)] ![box-shadow:0_1px_2px_rgba(0,0,0,0.02)]" style={{ borderRadius: 14, border: '1px solid var(--border-primary)' }}>
          <div className="!flex !items-baseline !gap-[4px] !mb-[8px]">
            <span className="!text-[length:18px] !font-[700] ![color:var(--text-primary)] !leading-[1] !tracking-[-0.02em]">
              {totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%
            </span>
          </div>
          <div className="!h-[4px] ![background:var(--border-faint)] !overflow-hidden !mb-[6px]" style={{ borderRadius: 2 }}>
            <div className="!h-[100%] ![background:#22c55e] ![transition:width_0.3s]" style={{ width: totalCount > 0 ? `${Math.round((doneCount / totalCount) * 100)}%` : '0%', borderRadius: 2 }} />
          </div>
          <div className="!text-[length:11px] ![color:var(--text-faint)]">
            {doneCount} / {totalCount} {t('todo.completed')}
          </div>
        </div>}

        {/* Smart filters */}
        {!isMobile && <div className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !p-[8px_12px_4px] !uppercase !tracking-[0.05em]">
          {t('todo.sidebar.tasks')}
        </div>}
        <SidebarItem id="all" icon={Inbox} label={t('todo.filter.all')} count={items.filter(i => !i.checked).length} />
        <SidebarItem id="my" icon={User} label={t('todo.filter.my')} count={myCount} />
        <SidebarItem id="overdue" icon={AlertCircle} label={t('todo.filter.overdue')} count={overdueCount} />
        <SidebarItem id="done" icon={CheckCheck} label={t('todo.filter.done')} count={doneCount} />

        {/* Sort by */}
        {!isMobile && <div className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !p-[16px_12px_4px] !uppercase !tracking-[0.05em]">
          {t('todo.sidebar.sortBy')}
        </div>}
        <button className={[(!sortByPrio) ? 'trek-hover' : undefined, '!flex !items-center !cursor-pointer ![transition:all_0.1s]'].join(' ')} onClick={() => setSortByPrio(v => !v)}
          title={isMobile ? t('todo.priority') : undefined}
          style={{ justifyContent: isMobile ? 'center' : 'flex-start', gap: isMobile ? 0 : 8, width: '100%', padding: isMobile ? '8px 0' : '7px 12px', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, background: sortByPrio ? '#f59e0b12' : 'transparent', color: sortByPrio ? '#f59e0b' : 'var(--text-secondary)', fontWeight: sortByPrio ? 600 : 400 }}>
          <Flag size={isMobile ? 18 : 15} style={{ flexShrink: 0, opacity: 0.7 }} />
          {!isMobile && <span className="!flex-[1] !text-left">{t('todo.priority')}</span>}
        </button>

        {/* Categories */}
        {!isMobile && <div className="!text-[length:10px] !font-[600] ![color:var(--text-faint)] !p-[16px_12px_4px] !uppercase !tracking-[0.05em]">
          {t('todo.sidebar.categories')}
        </div>}
        {isMobile && <div className="!h-[1px] ![background:var(--border-faint)] !m-[8px_4px]" />}
        {categories.map(cat => (
          <SidebarItem key={cat} id={cat} icon={null} label={cat} count={catCount(cat)} color={katColor(cat, categories)} />
        ))}

        {canEdit && (
          addingCategory && !isMobile ? (
            <div className="!flex !items-center !gap-[4px] !p-[4px_12px]">
              <input className="!flex-[1] !text-[length:12px] !p-[4px_6px] ![background:var(--bg-hover)] ![color:var(--text-primary)] ![font-family:inherit] !min-w-[0]" autoFocus value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') { setAddingCategory(false); setNewCategoryName('') } }}
                placeholder={t('todo.newCategory')}
                style={{ border: '1px solid var(--border-primary)', borderRadius: 5 }} />
              <button className="![background:none] !cursor-pointer ![color:#22c55e] !p-[2px]" onClick={addCategory} style={{ border: 'none' }}><Check size={13} /></button>
            </div>
          ) : (
            <button className="!flex !items-center !text-[length:12px] ![color:var(--text-faint)] ![background:none] !cursor-pointer ![font-family:inherit] !text-left" onClick={() => setAddingCategory(true)}
              title={isMobile ? t('todo.addCategory') : undefined}
              style={{ justifyContent: isMobile ? 'center' : 'flex-start', gap: isMobile ? 0 : 6, padding: isMobile ? '8px 0' : '7px 12px', border: 'none', width: '100%' }}>
              <Plus size={isMobile ? 18 : 13} /> {!isMobile && t('todo.addCategory')}
            </button>
          )
        )}
      </div>

      {/* ── Middle: Task List ── */}
      <div className="!flex-[1] !flex !flex-col !min-w-[0]">
        {/* Header */}
        <div className="!p-[16px_20px_12px]" style={{ borderBottom: '1px solid var(--border-faint)' }}>
          <div className="!flex !items-center !gap-[10px]">
            <h2 className="!m-[0] !text-[length:22px] !font-[700] ![color:var(--text-primary)] !tracking-[-0.02em]">
              {filterTitle}
            </h2>
            <span className="!text-[length:13px] ![color:var(--text-faint)] ![background:var(--bg-hover)] !p-[2px_8px] !font-[600]" style={{ borderRadius: 6 }}>
              {filtered.length}
            </span>
          </div>
        </div>

        {/* Task list */}
        <div className="!flex-[1] !overflow-y-auto !p-[4px_0]">
          {filtered.length === 0 ? null : (
            filtered.map(item => {
              const done = !!item.checked
              const assignedUser = members.find(m => m.id === item.assigned_user_id)
              const isOverdue = item.due_date && !done && item.due_date < today
              const isSelected = selectedId === item.id
              const catColor = item.category ? katColor(item.category, categories) : null

              return (
                <div className={[(!isSelected) ? 'trek-h-background-d9ff9a' : undefined, '!flex !items-center !gap-[10px] !p-[10px_20px] !cursor-pointer ![transition:background_0.1s]'].join(' ')} key={item.id}
                  onClick={() => { setSelectedId(isSelected ? null : item.id); setIsAddingNew(false) }}
                  style={{ borderBottom: '1px solid var(--border-faint)', background: isSelected ? 'var(--bg-hover)' : 'transparent' }}>

                  {/* Checkbox */}
                  <button className="![background:none] !p-[0] !shrink-[0]" onClick={e => { e.stopPropagation(); canEdit && toggleTodoItem(tripId, item.id, !done) }}
                    style={{ border: 'none', cursor: canEdit ? 'pointer' : 'default', color: done ? '#22c55e' : 'var(--border-primary)' }}>
                    {done ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>

                  {/* Content */}
                  <div className="!flex-[1] !min-w-[0]">
                    <div className="!text-[length:14px] !leading-[1.4] !overflow-hidden !whitespace-nowrap" style={{ color: done ? 'var(--text-faint)' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none', textOverflow: 'ellipsis' }}>
                      {item.name}
                    </div>
                    {/* Description preview */}
                    {item.description && (
                      <div className="!text-[length:12px] ![color:var(--text-faint)] !mt-[2px] !overflow-hidden !text-ellipsis !whitespace-nowrap !leading-[1.4]">
                        {item.description}
                      </div>
                    )}
                    {/* Inline badges */}
                    {(item.priority || item.due_date || catColor || assignedUser) && (
                    <div className="!flex !gap-[5px] !mt-[5px] !flex-wrap">
                      {item.priority > 0 && PRIO_CONFIG[item.priority] && (
                        <span className="!text-[length:10px] !inline-flex !items-center !gap-[3px] !p-[2px_7px] !font-[600]" style={{ borderRadius: 5, color: PRIO_CONFIG[item.priority].color, background: `${PRIO_CONFIG[item.priority].color}10`, border: `1px solid ${PRIO_CONFIG[item.priority].color}25` }}>
                          <Flag size={9} />{PRIO_CONFIG[item.priority].label}
                        </span>
                      )}
                      {item.due_date && (
                        <span className="!text-[length:10px] !inline-flex !items-center !gap-[3px] !p-[2px_7px] !font-[500]" style={{ borderRadius: 5, color: isOverdue ? '#ef4444' : 'var(--text-secondary)', background: isOverdue ? 'rgba(239,68,68,0.08)' : 'var(--bg-hover)', border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.15)' : 'var(--border-faint)'}` }}>
                          <Calendar size={9} />{formatDate(item.due_date)}
                        </span>
                      )}
                      {catColor && (
                        <span className="!text-[length:10px] !inline-flex !items-center !gap-[4px] !p-[2px_7px] !font-[500] ![color:var(--text-secondary)] ![background:var(--bg-hover)]" style={{ borderRadius: 5, border: '1px solid var(--border-faint)' }}>
                          <span className="!h-[6px] !shrink-[0]" style={{ width: 6, borderRadius: '50%', background: catColor }} />
                          {item.category}
                        </span>
                      )}
                      {assignedUser && (
                        <span className="!text-[length:10px] !inline-flex !items-center !gap-[4px] !p-[2px_7px] !font-[500] ![color:var(--text-secondary)] ![background:var(--bg-hover)]" style={{ borderRadius: 5, border: '1px solid var(--border-faint)' }}>
                          {assignedUser.avatar ? (
                            <img className="!h-[13px] !object-cover" src={`/uploads/avatars/${assignedUser.avatar}`} style={{ width: 13, borderRadius: '50%' }} alt="" />
                          ) : (
                            <span className="!h-[13px] ![background:var(--border-primary)] !inline-flex !items-center !justify-center !text-[length:7px] ![color:var(--text-faint)] !font-[700]" style={{ width: 13, borderRadius: '50%' }}>
                              {assignedUser.username.charAt(0).toUpperCase()}
                            </span>
                          )}
                          {assignedUser.username}
                        </span>
                      )}
                    </div>
                    )}
                  </div>

                  {/* Chevron */}
                  <ChevronRight size={16} color="var(--text-faint)" style={{ flexShrink: 0, opacity: 0.4 }} />
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: Detail Pane ── */}
      {selectedItem && !isAddingNew && !isMobile && (
        <DetailPane
          item={selectedItem}
          tripId={tripId}
          categories={categories}
          members={members}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedItem && !isAddingNew && isMobile && (
        <div className="!fixed !inset-[0] !z-[1000] ![background:rgba(0,0,0,0.4)] !flex !justify-center !items-end !pb-[var(--bottom-nav-h)]" onClick={e => { if (e.target === e.currentTarget) setSelectedId(null) }}>
          <div style={{ width: '100%', maxHeight: '85vh', borderRadius: '16px 16px 0 0', overflow: 'auto' }}
            ref={el => { if (el) { const child = el.firstElementChild as HTMLElement; if (child) { child.style.width = '100%'; child.style.borderLeft = 'none'; child.style.borderRadius = '16px 16px 0 0' } } }}>
            <DetailPane
              item={selectedItem}
              tripId={tripId}
              categories={categories}
              members={members}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}
      {isAddingNew && !selectedItem && !isMobile && ReactDOM.createPortal(
        <div onClick={e => { if (e.target === e.currentTarget) setIsAddingNew(false) }}
          className="modal-backdrop !fixed !inset-[0] !z-[1000] ![background:rgba(15,23,42,0.5)] !flex !justify-center !items-start !pt-[calc(var(--nav-h)_+_60px)] !pb-[40px]">
          <div style={{ width: 'min(520px, 92vw)', maxHeight: 'calc(100vh - var(--nav-h) - 120px)', overflow: 'auto', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
            ref={el => { if (el) { const child = el.firstElementChild as HTMLElement; if (child) { child.style.width = '100%'; child.style.borderLeft = 'none'; child.style.borderRadius = '16px' } } }}>
            <NewTaskPane
              tripId={tripId}
              categories={categories}
              members={members}
              defaultCategory={typeof filter === 'string' && categories.includes(filter) ? filter : null}
              onCreated={(id) => { setIsAddingNew(false); setSelectedId(id) }}
              onClose={() => setIsAddingNew(false)}
            />
          </div>
        </div>,
        document.body
      )}
      {isAddingNew && !selectedItem && isMobile && ReactDOM.createPortal(
        <div onClick={e => { if (e.target === e.currentTarget) setIsAddingNew(false) }}
          className="modal-backdrop !fixed !inset-[0] !z-[1000] ![background:rgba(0,0,0,0.4)] !flex !justify-center !items-end !pb-[var(--bottom-nav-h)]">
          <div style={{ width: '100%', maxHeight: '85vh', borderRadius: '16px 16px 0 0', overflow: 'auto' }}
            ref={el => { if (el) { const child = el.firstElementChild as HTMLElement; if (child) { child.style.width = '100%'; child.style.borderLeft = 'none'; child.style.borderRadius = '16px 16px 0 0' } } }}>
            <NewTaskPane
              tripId={tripId}
              categories={categories}
              members={members}
              defaultCategory={typeof filter === 'string' && categories.includes(filter) ? filter : null}
              onCreated={(id) => { setIsAddingNew(false); setSelectedId(id) }}
              onClose={() => setIsAddingNew(false)}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Detail Pane (right side) ──────────────────────────────────────────────

function DetailPane({ item, tripId, categories, members, onClose }: {
  item: TodoItem; tripId: number | string; categories: string[]; members: Member[];
  onClose: () => void;
}) {
  const { updateTodoItem, deleteTodoItem } = useTripStore()
  // useCanDo() returns the checker; calling it with the key used to hand back
  // the function itself, so canEdit was always truthy (edit controls for everyone).
  const can = useCanDo()
  const trip = useTripStore(s => s.trip)
  const canEdit = can('packing_edit', trip)
  const toast = useToast()
  const { t } = useTranslation()

  const [name, setName] = useState(item.name)
  const [desc, setDesc] = useState(item.description || '')
  const [dueDate, setDueDate] = useState(item.due_date || '')
  const [category, setCategory] = useState(item.category || '')
  const [assignedUserId, setAssignedUserId] = useState<number | null>(item.assigned_user_id)
  const [priority, setPriority] = useState(item.priority || 0)
  const [saving, setSaving] = useState(false)

  // Sync when selected item changes
  useEffect(() => {
    setName(item.name)
    setDesc(item.description || '')
    setDueDate(item.due_date || '')
    setCategory(item.category || '')
    setAssignedUserId(item.assigned_user_id)
    setPriority(item.priority || 0)
  }, [item.id, item.name, item.description, item.due_date, item.category, item.assigned_user_id, item.priority])

  const hasChanges = name !== item.name || desc !== (item.description || '') ||
    dueDate !== (item.due_date || '') || category !== (item.category || '') ||
    assignedUserId !== item.assigned_user_id || priority !== (item.priority || 0)

  const save = async () => {
    if (!name.trim() || !hasChanges) return
    setSaving(true)
    try {
      await updateTodoItem(tripId, item.id, {
        name: name.trim(), description: desc || null,
        due_date: dueDate || null, category: category || null,
        assigned_user_id: assignedUserId, priority,
      } as any)
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
    setSaving(false)
  }

  const handleDelete = async () => {
    try {
      await deleteTodoItem(tripId, item.id)
      onClose()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
  }

  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }
  const inputStyle: React.CSSProperties = {
    width: '100%', fontSize: 13, padding: '8px 10px', border: '1px solid var(--border-primary)',
    borderRadius: 8, background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit',
  }

  return (
    <div className="!shrink-[0] !flex !flex-col ![background:var(--bg-primary)]" style={{ width: 320, borderLeft: '1px solid var(--border-faint)' }}>
      {/* Header */}
      <div className="!flex !items-center !justify-between !p-[16px_20px_12px]" style={{ borderBottom: '1px solid var(--border-faint)' }}>
        <span className="!text-[length:14px] !font-[700] ![color:var(--text-primary)]">{t('todo.detail.title')}</span>
        <button className="![background:none] !cursor-pointer ![color:var(--text-faint)] !p-[4px]" onClick={onClose} style={{ border: 'none' }}>
          <X size={16} />
        </button>
      </div>

      {/* Form */}
      <div className="!flex-[1] !overflow-y-auto !p-[16px_20px] !flex !flex-col !gap-[14px]">
        {/* Name */}
        <div>
          <input className="!text-[length:15px] !font-[600] !p-[4px_0] ![background:transparent]" value={name} onChange={e => setName(e.target.value)} disabled={!canEdit}
            style={{ ...inputStyle, border: 'none' }}
            placeholder={t('todo.namePlaceholder')} />
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>{t('todo.detail.description')}</label>
          <textarea className="![resize:vertical] !min-h-[80px]" value={desc} onChange={e => setDesc(e.target.value)} disabled={!canEdit} rows={4}
            placeholder={t('todo.descriptionPlaceholder')}
            style={{ ...inputStyle }} />
        </div>

        {/* Priority */}
        <div>
          <label style={labelStyle}>{t('todo.detail.priority')}</label>
          <div className="!flex !gap-[4px]">
            {[0, 1, 2, 3].map(p => {
              const cfg = PRIO_CONFIG[p]
              const isActive = priority === p
              return (
                <button className="!flex-[1] !p-[6px_0] !text-[length:11px] !font-[600] ![font-family:inherit] !flex !items-center !justify-center !gap-[4px] ![transition:all_0.1s]" key={p} onClick={() => canEdit && setPriority(p)}
                  style={{ borderRadius: 6, cursor: canEdit ? 'pointer' : 'default', border: `1px solid ${isActive && cfg ? cfg.color + '40' : 'var(--border-primary)'}`, background: isActive && cfg ? cfg.color + '12' : 'transparent', color: isActive && cfg ? cfg.color : isActive ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                  {cfg ? <><Flag size={10} />{cfg.label}</> : t('todo.detail.noPriority')}
                </button>
              )
            })}
          </div>
        </div>

        {/* Category */}
        <div>
          <label style={labelStyle}>{t('todo.detail.category')}</label>
          <CustomSelect
            value={category}
            onChange={v => setCategory(v)}
            options={[
              { value: '', label: t('todo.noCategory') },
              ...categories.map(c => ({
                value: c,
                label: c,
                icon: <span className="!h-[8px] !inline-block" style={{ width: 8, borderRadius: '50%', background: katColor(c, categories) }} />,
              })),
            ]}
            placeholder={t('todo.noCategory')}
            size="sm"
            disabled={!canEdit}
          />
        </div>

        {/* Due date */}
        <div>
          <label style={labelStyle}>{t('todo.detail.dueDate')}</label>
          <CustomDatePicker
            value={dueDate}
            onChange={v => setDueDate(v)}
          />
        </div>

        {/* Assigned to */}
        <div>
          <label style={labelStyle}>{t('todo.detail.assignedTo')}</label>
          <CustomSelect
            value={String(assignedUserId ?? '')}
            onChange={v => setAssignedUserId(v ? Number(v) : null)}
            options={[
              { value: '', label: t('todo.unassigned'), icon: <User size={14} style={{ color: 'var(--text-faint)' }} /> },
              ...members.map(m => ({
                value: String(m.id),
                label: m.username,
                icon: m.avatar ? (
                  <img className="!h-[18px]" src={`/uploads/avatars/${m.avatar}`} style={{ width: 18, borderRadius: '50%', objectFit: 'cover' as const }} alt="" />
                ) : (
                  <span className="!h-[18px] ![background:var(--border-primary)] !inline-flex !items-center !justify-center !text-[length:10px] ![color:var(--text-faint)] !font-[600]" style={{ width: 18, borderRadius: '50%' }}>
                    {m.username.charAt(0).toUpperCase()}
                  </span>
                ),
              })),
            ]}
            placeholder={t('todo.unassigned')}
            size="sm"
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* Footer actions */}
      {canEdit && (
        <div className="!p-[12px_20px] !flex !gap-[8px]" style={{ borderTop: '1px solid var(--border-faint)' }}>
          <button className="!flex-[1] !p-[9px_16px] !text-[length:12px] !font-[600] !cursor-pointer ![font-family:inherit] ![background:transparent] ![color:var(--text-secondary)] !flex !items-center !justify-center !gap-[5px]" onClick={handleDelete}
            style={{ borderRadius: 8, border: '1px solid var(--border-primary)' }}>
            <Trash2 size={13} />
            {t('todo.detail.delete')}
          </button>
          <button className="!flex-[1] !p-[9px_16px] !text-[length:12px] !font-[600] ![font-family:inherit] ![transition:all_0.15s]" onClick={save} disabled={!hasChanges || saving}
            style={{ borderRadius: 8, cursor: hasChanges ? 'pointer' : 'default', border: 'none', background: hasChanges ? 'var(--text-primary)' : 'var(--border-faint)', color: hasChanges ? 'var(--bg-primary)' : 'var(--text-faint)' }}>
            {saving ? '...' : t('todo.detail.save')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── New Task Pane (right side, for creating) ──────────────────────────────

function NewTaskPane({ tripId, categories, members, defaultCategory, onCreated, onClose }: {
  tripId: number | string; categories: string[]; members: Member[]; defaultCategory: string | null;
  onCreated: (id: number) => void; onClose: () => void;
}) {
  const { addTodoItem } = useTripStore()
  const toast = useToast()
  const { t } = useTranslation()

  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [category, setCategory] = useState(defaultCategory || '')
  const [addingCategory, setAddingCategoryInline] = useState(false)
  const [assignedUserId, setAssignedUserId] = useState<number | null>(null)
  const [priority, setPriority] = useState(0)
  const [saving, setSaving] = useState(false)

  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }

  const create = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const trimmedCategory = category.trim()
      const item = await addTodoItem(tripId, {
        name: name.trim(), description: desc || null, priority,
        due_date: dueDate || null, category: trimmedCategory || null,
        assigned_user_id: assignedUserId,
      } as any)
      if (item?.id) onCreated(item.id)
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.error')) }
    setSaving(false)
  }

  return (
    <div className="!shrink-[0] !flex !flex-col ![background:var(--bg-primary)]" style={{ width: 320, borderLeft: '1px solid var(--border-faint)' }}>
      <div className="!flex !items-center !justify-between !p-[16px_20px_12px]" style={{ borderBottom: '1px solid var(--border-faint)' }}>
        <span className="!text-[length:14px] !font-[700] ![color:var(--text-primary)]">{t('todo.newItem')}</span>
        <button className="![background:none] !cursor-pointer ![color:var(--text-faint)] !p-[4px]" onClick={onClose} style={{ border: 'none' }}>
          <X size={16} />
        </button>
      </div>

      <div className="!flex-[1] !overflow-y-auto !p-[16px_20px] !flex !flex-col !gap-[14px]">
        <div>
          <input className="!text-[length:15px] !font-[600] !p-[4px_0] ![background:transparent] ![color:var(--text-primary)] ![outline:none] ![font-family:inherit]" autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) create() }}
            style={{ width: '100%', border: 'none' }}
            placeholder={t('todo.namePlaceholder')} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.description')}</label>
          <textarea className="!text-[length:13px] !p-[8px_10px] ![background:var(--bg-primary)] ![color:var(--text-primary)] ![font-family:inherit] ![resize:vertical] !min-h-[80px]" value={desc} onChange={e => setDesc(e.target.value)} rows={4}
            placeholder={t('todo.descriptionPlaceholder')}
            style={{ width: '100%', border: '1px solid var(--border-primary)', borderRadius: 8 }} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.category')}</label>
          {addingCategory ? (
            <div className="!flex !gap-[4px]">
              <input className="!flex-[1] !text-[length:13px] !p-[8px_10px] ![background:var(--bg-primary)] ![color:var(--text-primary)] ![font-family:inherit] ![outline:none]"
                autoFocus
                value={category}
                onChange={e => setCategory(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setAddingCategoryInline(false); if (e.key === 'Escape') { setCategory(''); setAddingCategoryInline(false) } }}
                placeholder={t('todo.newCategory')}
                style={{ border: '1px solid var(--border-primary)', borderRadius: 8 }}
              />
              <button className="![background:var(--bg-hover)] !p-[0_10px] !cursor-pointer ![color:var(--text-primary)]" type="button" onClick={() => setAddingCategoryInline(false)}
                style={{ border: '1px solid var(--border-primary)', borderRadius: 8 }}>
                <Check size={14} />
              </button>
            </div>
          ) : (
            <div className="!flex !gap-[4px]">
              <div className="!flex-[1] !min-w-[0]">
                <CustomSelect
                  value={category}
                  onChange={v => setCategory(v)}
                  options={[
                    { value: '', label: t('todo.noCategory') },
                    ...categories.map(c => ({
                      value: c, label: c,
                      icon: <span className="!h-[8px] !inline-block" style={{ width: 8, borderRadius: '50%', background: katColor(c, categories) }} />,
                    })),
                    ...(category && !categories.includes(category) ? [{
                      value: category, label: `${category} (${t('todo.newCategoryLabel') || 'new'})`,
                      icon: <span className="!h-[8px] ![background:#9ca3af] !inline-block" style={{ width: 8, borderRadius: '50%' }} />,
                    }] : []),
                  ]}
                  placeholder={t('todo.noCategory')}
                  size="sm"
                />
              </div>
              <button className="![background:var(--bg-hover)] !p-[0_10px] !cursor-pointer ![color:var(--text-muted)] ![font-family:inherit]" type="button" onClick={() => { setCategory(''); setAddingCategoryInline(true) }}
                title={t('todo.newCategory')}
                style={{ border: '1px solid var(--border-primary)', borderRadius: 8 }}>
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.priority')}</label>
          <div className="!flex !gap-[4px]">
            {[0, 1, 2, 3].map(p => {
              const cfg = PRIO_CONFIG[p]
              const isActive = priority === p
              return (
                <button className="!flex-[1] !p-[6px_0] !text-[length:11px] !font-[600] !cursor-pointer ![font-family:inherit] !flex !items-center !justify-center !gap-[4px] ![transition:all_0.1s]" key={p} onClick={() => setPriority(p)}
                  style={{ borderRadius: 6, border: `1px solid ${isActive && cfg ? cfg.color + '40' : 'var(--border-primary)'}`, background: isActive && cfg ? cfg.color + '12' : 'transparent', color: isActive && cfg ? cfg.color : isActive ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                  {cfg ? <><Flag size={10} />{cfg.label}</> : t('todo.detail.noPriority')}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.dueDate')}</label>
          <CustomDatePicker value={dueDate} onChange={v => setDueDate(v)} />
        </div>

        <div>
          <label style={labelStyle}>{t('todo.detail.assignedTo')}</label>
          <CustomSelect
            value={String(assignedUserId ?? '')}
            onChange={v => setAssignedUserId(v ? Number(v) : null)}
            options={[
              { value: '', label: t('todo.unassigned'), icon: <User size={14} style={{ color: 'var(--text-faint)' }} /> },
              ...members.map(m => ({
                value: String(m.id), label: m.username,
                icon: m.avatar ? (
                  <img className="!h-[18px]" src={`/uploads/avatars/${m.avatar}`} style={{ width: 18, borderRadius: '50%', objectFit: 'cover' as const }} alt="" />
                ) : (
                  <span className="!h-[18px] ![background:var(--border-primary)] !inline-flex !items-center !justify-center !text-[length:10px] ![color:var(--text-faint)] !font-[600]" style={{ width: 18, borderRadius: '50%' }}>
                    {m.username.charAt(0).toUpperCase()}
                  </span>
                ),
              })),
            ]}
            placeholder={t('todo.unassigned')}
            size="sm"
          />
        </div>
      </div>

      <div className="!p-[12px_20px]" style={{ borderTop: '1px solid var(--border-faint)' }}>
        <button className="!p-[9px_16px] !text-[length:12px] !font-[600] ![font-family:inherit] ![transition:all_0.15s]" onClick={create} disabled={!name.trim() || saving}
          style={{ width: '100%', borderRadius: 8, cursor: name.trim() ? 'pointer' : 'default', border: 'none', background: name.trim() ? 'var(--text-primary)' : 'var(--border-faint)', color: name.trim() ? 'var(--bg-primary)' : 'var(--text-faint)' }}>
          {saving ? '...' : t('todo.detail.create')}
        </button>
      </div>
    </div>
  )
}
