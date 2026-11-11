import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import bikeImg from './bike.jpg'

// ── Style helpers ──────────────────────────────────────────────────────────
const mono: React.CSSProperties = { fontFamily: 'DM Mono,monospace' }
const inp: React.CSSProperties  = { padding:'7px 10px', border:'0.5px solid #D3D1C7', borderRadius:6, fontSize:12, background:'#fff', color:'#2C2C2A', width:'100%', boxSizing:'border-box', fontFamily:'DM Mono,monospace' }
const btn = (bg='#E85D24', fg='#fff'): React.CSSProperties => ({ background:bg, color:fg, border:'none', borderRadius:6, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'Syne,sans-serif' })
const pill = (active: boolean): React.CSSProperties => ({ ...mono, fontSize:11, fontWeight:active?700:400, color:active?'#E85D24':'#888780', background:active?'#FFF0E8':'transparent', border:`0.5px solid ${active?'#E85D24':'#D3D1C7'}`, borderRadius:4, padding:'3px 8px', cursor:'pointer' })

const abbrevBag = (name: string) =>
  name.replace(/Alforja Trasera (\d+)/i,'AT$1').replace(/Alforja Delantera (\d+)/i,'AD$1')
      .replace(/Alforja (\d+)/i,'A$1').replace(/Bolsa Horquilla (\d+)/i,'BH$1')
      .replace(/Bolsa Manillar/i,'BM').replace(/Bolsa Top Barra/i,'BTB')
      .replace(/Bolsa Cuadro/i,'BC').replace(/Bolsa Sillin/i,'BS')
      .replace(/SteamBag (\d+)/i,'SB$1').replace(/Puesto/i,'PUT').replace(/Colgado/i,'COL')
      .replace(/Bolsa (\w+) (\d+)/i,(_m,w,n)=>w[0].toUpperCase()+n)
      .replace(/Bolsa (\w+)/i,(_m,w)=>w.slice(0,3).toUpperCase())

// ── Types ──────────────────────────────────────────────────────────────────
interface Group { id: number; name: string; color: string; sort_order: number }
interface Item  { id: number; name: string; peso: number; grupo: string; loc_c1: string; loc_c2: string; uds_c1: number; uds_c2: number }
interface Bag   { id: number; name: string; color: string; config_idx: number; has_pos: number; pos_x: number|null; pos_y: number|null; pos_w: number|null; pos_h: number|null }

// ── API helpers ────────────────────────────────────────────────────────────
const api = {
  get:    (path: string) => fetch(`/api/bikepack${path}`, { credentials:'include' }).then(r => r.json()),
  post:   (path: string, body: unknown) => fetch(`/api/bikepack${path}`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(r => r.json()),
  patch:  (path: string, body: unknown) => fetch(`/api/bikepack${path}`, { method:'PATCH', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(r => r.json()),
  delete: (path: string) => fetch(`/api/bikepack${path}`, { method:'DELETE', credentials:'include' }).then(r => r.json()),
}

// ── Modal ──────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.4)] !flex !items-center !justify-center !z-[2000]">
      <div className="![background:#fff] !rounded-[12px] !p-[24px] !w-[380px] !max-w-[90vw] !max-h-[80vh] !overflow-y-auto ![box-shadow:0_20px_60px_rgba(0,0,0,0.2)]">
        <div className="!flex !items-center !justify-between !mb-[18px]">
          <span className="!text-[length:14px] !font-[700] ![color:#2C2C2A]">{title}</span>
          <button className="![background:none] ![border:none] !cursor-pointer !text-[length:18px] ![color:#888780] !leading-[1]" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="!mb-[12px]">
      <label className="!tracking-[0.5px] !uppercase !mb-[4px]" style={{ display:'block', fontSize:10, fontWeight:700, color:'#888780', ...mono }}>{label}</label>
      {children}
    </div>
  )
}

const COLORS = ['#E85D24','#C04828','#1B6CA8','#0C447C','#3B6D11','#BA7517','#854F0B','#993556','#534AB7','#888780']
function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="!flex !flex-wrap !gap-[6px]">
      {COLORS.map(c => (
        <div className="!w-[22px] !h-[22px] !rounded-[4px] !cursor-pointer ![transition:border_.1s]" key={c} onClick={() => onChange(c)}
          style={{ background:c, border: value===c ? '2px solid #2C2C2A' : '2px solid transparent' }}
        />
      ))}
      <input className="!w-[22px] !h-[22px] !p-[0] ![border:0.5px_solid_#D3D1C7] !rounded-[4px] !cursor-pointer" type="color" value={value} onChange={e => onChange(e.target.value)}/>
    </div>
  )
}

// ── BikeSVG ────────────────────────────────────────────────────────────────
function BikeSVGContent({ bags, byBag, scale = 1 }: { bags: Bag[]; byBag: Record<string, {name:string;uds:number;peso:number}[]>; scale?: number }) {
  const fs = Math.max(4, 5.5 / scale)   // font size: smaller when zoomed so text fits better
  return <>
    <image href={bikeImg} x="0" y="0" width="308" height="203" preserveAspectRatio="xMidYMid meet"/>
    {bags.filter(b => b.has_pos).map(b => {
      const items = byBag[b.name] || []
      const total = items.reduce((s, i) => s + i.peso, 0)
      const active = items.length > 0
      const ry = Math.min(5, (b.pos_h ?? 0) / 2)
      const abbr = abbrevBag(b.name)
      return (
        <g key={b.id}>
          <rect x={b.pos_x!} y={b.pos_y!} width={b.pos_w!} height={b.pos_h!} rx={ry}
            fill={b.color} opacity={active ? 0.85 : 0.18}
            stroke="white" strokeWidth={active ? 0.8 : 0.3} strokeOpacity={active ? 0.6 : 0.2}/>
          <clipPath id={`clip-${b.id}-${scale}`}>
            <rect x={b.pos_x!+1} y={b.pos_y!+1} width={b.pos_w!-2} height={b.pos_h!-2} rx={Math.min(4,(b.pos_h??0)/2)}/>
          </clipPath>
          <text x={b.pos_x!+b.pos_w!/2} y={b.pos_y!+b.pos_h!*(active&&total>0?0.36:0.5)} textAnchor="middle" dominantBaseline="central"
            fontSize={fs} fontFamily="DM Mono,monospace" fontWeight="700" fill="white" clipPath={`url(#clip-${b.id}-${scale})`}>
            {abbr}
          </text>
          {active && total > 0 && (
            <text x={b.pos_x!+b.pos_w!/2} y={b.pos_y!+b.pos_h!*0.68} textAnchor="middle" dominantBaseline="central"
              fontSize={fs} fontFamily="DM Mono,monospace" fontWeight="500" fill="white" opacity={0.9} clipPath={`url(#clip-${b.id}-${scale})`}>
              {total.toFixed(2)}kg
            </text>
          )}
        </g>
      )
    })}
  </>
}

function BikeSVG({ bags, byBag, onClick }: { bags: Bag[]; byBag: Record<string, {name:string;uds:number;peso:number}[]>; onClick?: () => void }) {
  return (
    <svg className="!block" width="100%" viewBox="0 0 308 203" style={{ cursor: onClick ? 'zoom-in' : 'default' }} onClick={onClick}>
      <BikeSVGContent bags={bags} byBag={byBag} scale={1}/>
    </svg>
  )
}

function BikeSVGModal({ bags, byBag, onClose }: { bags: Bag[]; byBag: Record<string, {name:string;uds:number;peso:number}[]>; onClose: () => void }) {
  return (
    <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.75)] !flex !items-center !justify-center !z-[3000]" onClick={onClose}>
      <div className="!relative !w-[min(90vw,_820px)] !p-[8px]" onClick={e => e.stopPropagation()}>
        <button className="!absolute !top-[-12px] !right-[-12px] !z-[1] ![background:#fff] ![border:none] !rounded-[50%] !w-[28px] !h-[28px] !text-[length:16px] !cursor-pointer !flex !items-center !justify-center ![box-shadow:0_2px_8px_rgba(0,0,0,0.3)]" onClick={onClose}>×</button>
        <svg className="!block !rounded-[10px] ![box-shadow:0_8px_40px_rgba(0,0,0,0.5)]" width="100%" viewBox="0 0 308 203">
          <BikeSVGContent bags={bags} byBag={byBag} scale={3}/>
        </svg>
        <div className="!mt-[10px] !flex !flex-wrap !gap-[6px] !justify-center">
          {bags.filter(b=>b.has_pos).map(b=>{
            const items = byBag[b.name]||[], total=items.reduce((s,i)=>s+i.peso,0)
            if(!items.length) return null
            return (
              <div className="![background:rgba(255,255,255,0.12)] !rounded-[6px] !p-[3px_10px] !flex !items-center !gap-[6px]" key={b.id} style={{ border:`1px solid ${b.color}66` }}>
                <div className="!w-[8px] !h-[8px] !rounded-[2px]" style={{ background:b.color }}/>
                <span className="!text-[length:11px] ![color:#fff] !font-[700]" style={{ ...mono }}>{abbrevBag(b.name)}</span>
                <span className="!text-[length:10px] ![color:rgba(255,255,255,0.7)]" style={{ ...mono }}>{b.name}</span>
                <span className="!text-[length:11px] !font-[600]" style={{ ...mono, color:b.color }}>{total.toFixed(3)} kg</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── BagEditor ─────────────────────────────────────────────────────────────
const W = 308, H = 230
function BagEditor({ bags, onSave, onClose }: { bags: Bag[]; onSave: (b: Bag) => void; onClose: () => void }) {
  const [localBags, setLocalBags] = useState(() => bags.map(b => ({...b})))
  const [dragging, setDragging]   = useState<{id:number;mode:'move'|'resize';startX:number;startY:number;origX:number;origY:number;origW:number;origH:number}|null>(null)
  const [selected, setSelected]   = useState<number|null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const toSvg = (e: React.MouseEvent | React.TouchEvent) => {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
    return { x:(clientX-rect.left)/rect.width*W, y:(clientY-rect.top)/rect.height*H }
  }

  const startDrag = (e: React.MouseEvent | React.TouchEvent, id: number, mode: 'move'|'resize') => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(id)
    const b = localBags.find(b => b.id===id)!
    const pt = toSvg(e)
    setDragging({ id, mode, startX:pt.x, startY:pt.y, origX:b.pos_x??0, origY:b.pos_y??0, origW:b.pos_w??30, origH:b.pos_h??30 })
  }

  const onMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return
    e.preventDefault()
    const pt = toSvg(e)
    const dx = pt.x - dragging.startX, dy = pt.y - dragging.startY
    setLocalBags(prev => prev.map(b => {
      if (b.id !== dragging.id) return b
      if (dragging.mode === 'move') return { ...b, pos_x: Math.max(0, dragging.origX+dx), pos_y: Math.max(0, dragging.origY+dy) }
      return { ...b, pos_w: Math.max(10, dragging.origW+dx), pos_h: Math.max(8, dragging.origH+dy) }
    }))
  }

  const onMouseUp = () => {
    if (!dragging) return
    const b = localBags.find(b => b.id===dragging.id)
    if (b) onSave(b)
    setDragging(null)
  }

  const toggleVisible = (id: number) => {
    setLocalBags(prev => prev.map(b => b.id===id ? {...b, has_pos: b.has_pos ? 0 : 1} : b))
    const b = localBags.find(b => b.id===id)
    if (b) onSave({ ...b, has_pos: b.has_pos ? 0 : 1 })
  }

  return (
    <div className="!fixed !inset-[0] ![background:rgba(0,0,0,0.5)] !flex !items-center !justify-center !z-[2100]">
      <div className="![background:#fff] !rounded-[12px] !w-[min(760px,95vw)] !max-h-[90vh] !flex !flex-col !overflow-hidden ![box-shadow:0_20px_60px_rgba(0,0,0,0.25)]">
        <div className="!flex !items-center !justify-between !p-[14px_18px] ![border-bottom:0.5px_solid_#D3D1C7]">
          <span className="!text-[length:14px] !font-[700] ![color:#2C2C2A]">Editar posiciones de bolsas</span>
          <button className="![background:none] ![border:none] !cursor-pointer !text-[length:18px] ![color:#888780]" onClick={onClose}>×</button>
        </div>
        <div className="!flex !flex-[1] !overflow-hidden">
          <div className="!flex-[1] !overflow-hidden !p-[12px]">
            <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
              style={{ display:'block', userSelect:'none', cursor:dragging?'grabbing':'default', borderRadius:6 }}
              onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              onTouchMove={onMouseMove} onTouchEnd={onMouseUp}>
              <image href={bikeImg} x="0" y="0" width={W} height={H} preserveAspectRatio="xMidYMid meet"/>
              {localBags.filter(b => b.has_pos).map(b => {
                const isSel = selected===b.id, isDrag = dragging?.id===b.id
                return (
                  <g key={b.id}>
                    <rect x={b.pos_x!} y={b.pos_y!} width={b.pos_w!} height={b.pos_h!} rx={Math.min(4,(b.pos_h??0)/2)}
                      fill={b.color} opacity={0.75} stroke={isSel?'#fff':b.color} strokeWidth={isSel?1.5:0.5} strokeDasharray={isSel?'3 2':'none'}
                      style={{ cursor:isDrag?'grabbing':'grab' }}
                      onMouseDown={e => startDrag(e,b.id,'move')} onTouchStart={e => startDrag(e,b.id,'move')}/>
                    <clipPath id={`eclip-${b.id}`}><rect x={b.pos_x!+1} y={b.pos_y!+1} width={b.pos_w!-2} height={b.pos_h!-2} rx={Math.min(4,(b.pos_h??0)/2)}/></clipPath>
                    <text className="!pointer-events-none" x={b.pos_x!+b.pos_w!/2} y={b.pos_y!+b.pos_h!*0.38} textAnchor="middle" dominantBaseline="central"
                      fontSize={Math.min(7,Math.max(5,(b.pos_w??0)/5))} fontFamily="DM Mono,monospace" fontWeight="700" fill="white"
                      clipPath={`url(#eclip-${b.id})`}>
                      {b.name.replace('Alforja ','Af.').replace('Bolsa ','').replace('Delantera','Del.').replace('Trasera','Tras.')}
                    </text>
                    {isSel && (
                      <rect className="![cursor:se-resize]" x={b.pos_x!+b.pos_w!-6} y={b.pos_y!+b.pos_h!-6} width={8} height={8} rx={2}
                        fill="#fff" stroke={b.color} strokeWidth={1}
                        onMouseDown={e => startDrag(e,b.id,'resize')} onTouchStart={e => startDrag(e,b.id,'resize')}/>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="!w-[190px] ![border-left:0.5px_solid_#D3D1C7] !overflow-y-auto !p-[10px] !shrink-[0]">
            <div className="!uppercase !mb-[8px]" style={{ fontSize:10, fontWeight:700, letterSpacing:'1px', color:'#888780', ...mono }}>Bolsas</div>
            {localBags.map(b => (
              <div className="!flex !items-center !gap-[7px] !p-[6px_8px] !rounded-[6px] !mb-[4px]" key={b.id} onClick={() => b.has_pos && setSelected(b.id)}
                style={{ background:selected===b.id?'#FFF0E8':'#F7F6F2', cursor:b.has_pos?'pointer':'default', border:selected===b.id?'0.5px solid #E85D24':'0.5px solid transparent' }}>
                <div className="!w-[10px] !h-[10px] !rounded-[2px] !shrink-[0]" style={{ background:b.color }}/>
                <span className="!text-[length:11px] ![color:#2C2C2A] !flex-[1] !overflow-hidden !text-ellipsis !whitespace-nowrap">{b.name}</span>
                <button className="![background:none] ![border:none] !text-[length:14px] !cursor-pointer !p-[0] !leading-[1]" onClick={e => { e.stopPropagation(); toggleVisible(b.id) }}
                  style={{ color:b.has_pos?'#E85D24':'#C2C0B6' }}>
                  {b.has_pos ? 'o' : '-'}
                </button>
              </div>
            ))}
            <div className="!mt-[12px] !p-[8px] ![background:#F1EFE8] !rounded-[6px]">
              <div className="!leading-[1.5]" style={{ fontSize:9, color:'#888780', ...mono }}>
                Clic para seleccionar.<br/>Arrastra para mover.<br/>Esquina blanca para redimensionar.<br/>o/- muestra u oculta la bolsa.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CollapsibleSection ────────────────────────────────────────────────────
function CollapsibleSection({ sectionKey, color, label, weight, count, collapsed, onToggle, children }: {
  sectionKey: string; color: string; label: string; weight: string; count: number
  collapsed: Record<string,boolean>; onToggle: (k:string)=>void; children: React.ReactNode
}) {
  const open = !collapsed[sectionKey]
  return (
    <div>
      <div className={['!flex !items-center !gap-[8px] !p-[9px_14px] ![background:#F1EFE8] !cursor-pointer !select-none', (open) ? '![border-bottom:0.5px_solid_#D3D1C7]' : '![border-bottom:none]', '![border-top:0.5px_solid_#D3D1C7]'].join(' ')} onClick={() => onToggle(sectionKey)}>
        <div className="!w-[9px] !h-[9px] !rounded-[50%] !shrink-[0]" style={{ background:color }}/>
        <span className="!tracking-[0.5px]" style={{ fontSize:11, fontWeight:700, color:'#444441', ...mono }}>{label}</span>
        <span style={{ fontSize:10, color:'#B4B2A9', ...mono }}>({count})</span>
        <span className="![color:#888780]" style={{ marginLeft:'auto', fontSize:11, ...mono }}>{weight} kg</span>
        <span className="!text-[length:10px] ![color:#B4B2A9] !ml-[4px]">{open ? '▲' : '▼'}</span>
      </div>
      {open && children}
    </div>
  )
}

// ── ItemForm ──────────────────────────────────────────────────────────────
function ItemForm({ item, groupKeys, bagNamesC1, bagNamesC2, onSave, onDelete }: {
  item: Partial<Item>; groupKeys: string[]; bagNamesC1: string[]; bagNamesC2: string[]
  onSave: (d: Partial<Item>) => void; onDelete: ((id:number)=>void)|null
}) {
  const [f, setF] = useState({ name:'', peso:0.1, grupo:groupKeys[0]||'', loc_c1:bagNamesC1[0]||'', loc_c2:bagNamesC2[0]||'', uds_c1:1, uds_c2:1, ...item })
  const set = (k: string, v: unknown) => setF((p: any) => ({...p,[k]:v}))
  return (
    <>
      <Field label="Nombre"><input style={inp} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
      <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[10px]">
        <Field label="Peso (kg)"><input type="number" step="0.001" min="0" style={inp} value={f.peso} onChange={e=>set('peso',parseFloat(e.target.value)||0)}/></Field>
        <Field label="Categoria">
          <select style={inp} value={f.grupo} onChange={e=>set('grupo',e.target.value)}>
            {groupKeys.map(g=><option key={g}>{g}</option>)}
          </select>
        </Field>
      </div>
      <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[10px]">
        <Field label="Bolsa Config 1">
          <select style={inp} value={f.loc_c1} onChange={e=>set('loc_c1',e.target.value)}>
            {bagNamesC1.map(n=><option key={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Bolsa Config 2">
          <select style={inp} value={f.loc_c2} onChange={e=>set('loc_c2',e.target.value)}>
            {bagNamesC2.map(n=><option key={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      {item.id && (
        <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[10px]">
          <Field label="Uds Config 1"><input type="number" min="0" style={inp} value={f.uds_c1} onChange={e=>set('uds_c1',parseInt(e.target.value)||0)}/></Field>
          <Field label="Uds Config 2"><input type="number" min="0" style={inp} value={f.uds_c2} onChange={e=>set('uds_c2',parseInt(e.target.value)||0)}/></Field>
        </div>
      )}
      <div className="!flex !gap-[8px] !mt-[18px]">
        <button className="!flex-[1]" onClick={()=>onSave(f)} style={{ ...btn() }}>{item.id?'Guardar':'Crear'}</button>
        {onDelete && item.id && <button onClick={()=>onDelete!(item.id!)} style={btn('#FCEBEB','#A32D2D')}>Eliminar</button>}
      </div>
    </>
  )
}

// ── GroupList / GroupForm ─────────────────────────────────────────────────
function GroupList({ groups, onEdit, onNew }: { groups: Group[]; onEdit: (g:Group)=>void; onNew: ()=>void }) {
  return (
    <>
      {groups.map(g => (
        <div className="!flex !items-center !gap-[10px] !p-[10px_12px] !rounded-[8px] ![border:0.5px_solid_#D3D1C7] !mb-[7px] ![background:#fff] !cursor-pointer" key={g.id} onClick={()=>onEdit({...g})}>
          <div className="!w-[14px] !h-[14px] !rounded-[50%] !shrink-[0]" style={{ background:g.color }}/>
          <span className="!text-[length:13px] !font-[500] ![color:#2C2C2A] !flex-[1]">{g.name}</span>
          <span className="![color:#B4B2A9]" style={{ fontSize:10, ...mono }}>orden {g.sort_order}</span>
          <span className="!text-[length:12px] ![color:#B4B2A9]">›</span>
        </div>
      ))}
      <button className="!w-[100%] !mt-[4px]" onClick={onNew} style={{ ...btn() }}>+ Nueva categoria</button>
    </>
  )
}

function GroupForm({ group, onSave, onDelete, onCancel }: { group: Partial<Group>; onSave: (d:Partial<Group>)=>void; onDelete: ((id:number)=>void)|null; onCancel: ()=>void }) {
  const [f, setF] = useState({ name:'', color:'#888780', sort_order:99, ...group })
  const set = (k: string, v: unknown) => setF((p: any) => ({...p,[k]:v}))
  return (
    <>
      <button className="!mb-[14px] !p-[0]" onClick={onCancel} style={{ background:'none', border:'none', color:'#888780', cursor:'pointer', fontSize:12, ...mono }}>← volver</button>
      <Field label="Nombre de la categoria"><input style={inp} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
      <Field label="Color"><ColorPicker value={f.color} onChange={v=>set('color',v)}/></Field>
      <Field label="Orden (menor = primero)"><input type="number" style={inp} value={f.sort_order} onChange={e=>set('sort_order',parseInt(e.target.value)||99)}/></Field>
      <div className="!flex !gap-[8px] !mt-[18px]">
        <button className="!flex-[1]" onClick={()=>onSave(f)} style={{ ...btn() }}>{group.id?'Guardar':'Crear'}</button>
        {onDelete && group.id && <button onClick={()=>onDelete!(group.id!)} style={btn('#FCEBEB','#A32D2D')}>Eliminar</button>}
      </div>
    </>
  )
}

// ── BagList / BagForm ────────────────────────────────────────────────────
function BagList({ bags, onEdit, onNew }: { bags: Bag[]; onEdit: (b:Bag)=>void; onNew: ()=>void }) {
  return (
    <>
      {bags.length===0 && <p className="!text-center !p-[12px]" style={{ fontSize:12, color:'#B4B2A9', ...mono }}>Sin bolsas</p>}
      {bags.map(b => (
        <div className="!flex !items-center !gap-[10px] !p-[10px_12px] !rounded-[8px] ![border:0.5px_solid_#D3D1C7] !mb-[7px] ![background:#fff] !cursor-pointer" key={b.id} onClick={()=>onEdit({...b})}>
          <div className="!w-[12px] !h-[12px] !rounded-[3px] !shrink-[0]" style={{ background:b.color }}/>
          <span className="!text-[length:13px] !font-[500] ![color:#2C2C2A] !flex-[1]">{b.name}</span>
          {b.has_pos ? <span className="![color:#B4B2A9]" style={{ fontSize:10, ...mono }}>{Math.round(b.pos_x!)},{Math.round(b.pos_y!)} {Math.round(b.pos_w!)}x{Math.round(b.pos_h!)}</span> : <span className="![color:#C2C0B6]" style={{ fontSize:10, ...mono }}>sin pos.</span>}
          <span className="!text-[length:12px] ![color:#B4B2A9]">›</span>
        </div>
      ))}
      <button className="!w-[100%] !mt-[4px]" onClick={onNew} style={{ ...btn() }}>+ Nueva bolsa</button>
    </>
  )
}

function BagForm({ bag, config, onSave, onDelete, onCancel }: { bag: Partial<Bag>; config: number; onSave: (d:Partial<Bag>)=>void; onDelete: ((id:number)=>void)|null; onCancel: ()=>void }) {
  const [f, setF] = useState({ config_idx:config, name:'', color:'#888780', has_pos:0, pos_x:100, pos_y:100, pos_w:30, pos_h:30, ...bag })
  const set = (k: string, v: unknown) => setF((p: any) => ({...p,[k]:v}))
  return (
    <>
      <button className="!mb-[14px] !p-[0]" onClick={onCancel} style={{ background:'none', border:'none', color:'#888780', cursor:'pointer', fontSize:12, ...mono }}>← volver</button>
      <Field label="Nombre de la bolsa"><input style={inp} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
      <Field label="Color"><ColorPicker value={f.color} onChange={v=>set('color',v)}/></Field>
      <Field label="Visible en bici">
        <label className="!flex !items-center !gap-[8px] !cursor-pointer">
          <input className="!w-[16px] !h-[16px]" type="checkbox" checked={!!f.has_pos} onChange={e=>set('has_pos',e.target.checked?1:0)}/>
          <span className="!text-[length:12px] ![color:#2C2C2A]">Mostrar en el dibujo</span>
        </label>
      </Field>
      {!!f.has_pos && (
        <div className="![background:#F7F6F2] !rounded-[8px] !p-[12px] !mb-[8px]">
          <div className="!mb-[10px] !tracking-[0.5px] !uppercase" style={{ fontSize:10, fontWeight:700, color:'#888780', ...mono }}>Posicion (viewBox 308x230)</div>
          <div className="!grid ![grid-template-columns:1fr_1fr] !gap-[8px]">
            <Field label="X"><input type="number" style={inp} value={f.pos_x??0} onChange={e=>set('pos_x',Number(e.target.value))}/></Field>
            <Field label="Y"><input type="number" style={inp} value={f.pos_y??0} onChange={e=>set('pos_y',Number(e.target.value))}/></Field>
            <Field label="Ancho"><input type="number" style={inp} value={f.pos_w??30} onChange={e=>set('pos_w',Number(e.target.value))}/></Field>
            <Field label="Alto"><input type="number" style={inp} value={f.pos_h??30} onChange={e=>set('pos_h',Number(e.target.value))}/></Field>
          </div>
        </div>
      )}
      <div className="!flex !gap-[8px] !mt-[18px]">
        <button className="!flex-[1]" onClick={()=>onSave(f)} style={{ ...btn() }}>{bag.id?'Guardar':'Crear bolsa'}</button>
        {onDelete && bag.id && <button onClick={()=>onDelete!(bag.id!)} style={btn('#FCEBEB','#A32D2D')}>Eliminar</button>}
      </div>
    </>
  )
}

// ── Print ─────────────────────────────────────────────────────────────────
function printList(
  items: Item[], groups: Group[], bags: Bag[],
  byGroup: Record<string,number>, byBag: Record<string,{name:string;uds:number;peso:number}[]>,
  total: number, config: number,
  getQty: (i: Item) => number, getLoc: (i: Item) => string,
  groupMap: Record<string,string>
) {
  const configName = config === 0 ? 'Config 1 — Alforjas' : 'Config 2 — Bikepacking'
  const groupKeys = groups.map(g => g.name)

  const groupRows = groupKeys.map(grp => {
    const gi = items.filter(i => i.grupo === grp && getQty(i) > 0)
    if (!gi.length) return ''
    const color = groupMap[grp] || '#888780'
    const rows = gi.map(it => {
      const qty = getQty(it), loc = getLoc(it)
      return `<tr><td>${it.name}</td><td style="text-align:center">${qty}</td><td>${loc}</td><td style="text-align:right">${(it.peso*qty).toFixed(3)} kg</td></tr>`
    }).join('')
    return `<tr><td colspan="4" style="background:${color}22;color:${color};font-weight:700;padding:5px 8px;border-top:1px solid ${color}44">${grp} — ${byGroup[grp]?.toFixed(3)} kg</td></tr>${rows}`
  }).join('')

  const bagRows = Object.entries(byBag)
    .sort((a,b) => b[1].reduce((s,i)=>s+i.peso,0) - a[1].reduce((s,i)=>s+i.peso,0))
    .map(([name, bi]) => {
      const t = bi.reduce((s,i)=>s+i.peso,0)
      const color = bags.find(b=>b.name===name)?.color || '#888780'
      const rows = bi.map(i => `<tr><td>${i.uds>1?`${i.uds}× `:''} ${i.name}</td><td style="text-align:right">${i.peso.toFixed(3)} kg</td></tr>`).join('')
      return `<tr><td colspan="2" style="background:${color}22;color:${color};font-weight:700;padding:5px 8px;border-top:1px solid ${color}44">${name} — ${t.toFixed(3)} kg</td></tr>${rows}`
    }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bikepack — ${configName}</title>
  <style>
    body{font-family:'DM Mono',monospace;font-size:11px;color:#2C2C2A;margin:0;padding:20px}
    h1{font-size:15px;margin:0 0 4px}
    .sub{color:#888780;font-size:10px;margin-bottom:20px}
    h2{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#B4B2A9;margin:20px 0 6px;border-bottom:0.5px solid #D3D1C7;padding-bottom:4px}
    table{width:100%;border-collapse:collapse;margin-bottom:4px}
    td{padding:3px 8px;border-bottom:0.5px solid #F1EFE8;vertical-align:top}
    .total{border-top:1px solid #D3D1C7;padding-top:8px;margin-top:8px;text-align:right;font-weight:700;color:#E85D24;font-size:13px}
    @media print{body{padding:10px}}
  </style></head><body>
  <h1>🚴 Bikepack — ${configName}</h1>
  <div class="sub">Total: ${total.toFixed(3)} kg · ${items.filter(i=>getQty(i)>0).length} elementos activos</div>
  <h2>Lista por categoría</h2>
  <table><thead><tr style="color:#B4B2A9"><th style="text-align:left">Elemento</th><th style="text-align:center">Uds</th><th style="text-align:left">Bolsa</th><th style="text-align:right">Peso</th></tr></thead><tbody>${groupRows}</tbody></table>
  <div class="total">TOTAL ${total.toFixed(3)} kg</div>
  <h2>Por bolsa</h2>
  <table><tbody>${bagRows}</tbody></table>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function BikepackApp() {
  const [items, setItems]     = useState<Item[]>([])
  const [groups, setGroups]   = useState<Group[]>([])
  const [bags, setBags]       = useState<Bag[]>([])
  const [config, setConfig]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [sortBy, setSortBy]   = useState<'grupo'|'bolsa'|'nombre'|'peso'>('grupo')
  const [collapsed, setCollapsed] = useState<Record<string,boolean>>({})
  const [editItem, setEditItem]   = useState<Partial<Item>|null>(null)
  const [showBags, setShowBags]   = useState(false)
  const [showBagEditor, setShowBagEditor] = useState(false)
  const [showBikeZoom, setShowBikeZoom]   = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [editBag, setEditBag]     = useState<Partial<Bag>|null>(null)
  const [editGroup, setEditGroup] = useState<Partial<Group>|null>(null)
  const [leftWidth, setLeftWidth] = useState(58)

  const toggleSection = useCallback((key: string) => setCollapsed(p => ({...p,[key]:!p[key]})), [])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).parentElement!
    const startX = e.clientX, startW = leftWidth
    const totalW = container.getBoundingClientRect().width
    const onMove = (ev: MouseEvent) => { const delta = ((ev.clientX-startX)/totalW)*100; setLeftWidth(Math.min(80,Math.max(20,startW+delta))) }
    const onUp = () => { window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
    window.addEventListener('mousemove',onMove)
    window.addEventListener('mouseup',onUp)
  }, [leftWidth])

  const load = useCallback(async () => {
    try {
      const [ir, gr, br] = await Promise.all([api.get('/items'), api.get('/groups'), api.get('/bags')])
      setItems(ir); setGroups(gr); setBags(br)
    } catch(e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const getQty  = useCallback((it: Item) => config===0 ? (it.uds_c1||0) : (it.uds_c2||0), [config])
  const getLoc  = useCallback((it: Item) => config===0 ? it.loc_c1 : it.loc_c2, [config])
  const groupMap  = useMemo(() => Object.fromEntries(groups.map(g=>[g.name,g.color])), [groups])
  const groupKeys = useMemo(() => groups.map(g=>g.name), [groups])
  const configBags  = useMemo(() => bags.filter(b=>b.config_idx===config), [bags,config])
  const bagNamesC1  = useMemo(() => bags.filter(b=>b.config_idx===0).map(b=>b.name), [bags])
  const bagNamesC2  = useMemo(() => bags.filter(b=>b.config_idx===1).map(b=>b.name), [bags])

  const saveItem = async (data: Partial<Item>) => {
    try {
      if (data.id) { const r = await api.patch(`/items/${data.id}`, data); setItems(p=>p.map(i=>i.id===data.id?r:i)) }
      else { const r = await api.post('/items', {...data,uds_c1:1,uds_c2:1}); setItems(p=>[...p,r]) }
      setEditItem(null)
    } catch(e) { console.error(e) }
  }
  const deleteItem = async (id: number) => {
    if (!window.confirm('¿Eliminar este elemento?')) return
    setItems(p=>p.filter(i=>i.id!==id))
    await api.delete(`/items/${id}`).catch(()=>load())
    setEditItem(null)
  }
  const changeQty = async (it: Item, delta: number) => {
    const field = config===0 ? 'uds_c1' : 'uds_c2'
    const val = Math.max(0, (it[field]||0)+delta)
    setItems(p=>p.map(i=>i.id===it.id?{...i,[field]:val}:i))
    api.patch(`/items/${it.id}`,{[field]:val}).catch(()=>load())
  }

  const saveGroup = async (data: Partial<Group>) => {
    try {
      if (data.id) { const r = await api.patch(`/groups/${data.id}`,data); setGroups(p=>p.map(g=>g.id===data.id?r:g)) }
      else { const r = await api.post('/groups',data); setGroups(p=>[...p,r]) }
      setEditGroup(null)
    } catch(e) { console.error(e) }
  }
  const deleteGroup = async (id: number) => {
    if (!window.confirm('¿Eliminar esta categoria?')) return
    setGroups(p=>p.filter(g=>g.id!==id))
    await api.delete(`/groups/${id}`).catch(()=>load())
    setEditGroup(null)
  }

  const saveBag = async (data: Partial<Bag>) => {
    try {
      if (data.id) { const r = await api.patch(`/bags/${data.id}`,data); setBags(p=>p.map(b=>b.id===data.id?r:b)) }
      else { const r = await api.post('/bags',data); setBags(p=>[...p,r]) }
      setEditBag(null)
    } catch(e) { console.error(e) }
  }
  const deleteBag = async (id: number) => {
    if (!window.confirm('¿Eliminar esta bolsa?')) return
    setBags(p=>p.filter(b=>b.id!==id))
    await api.delete(`/bags/${id}`).catch(()=>load())
    setEditBag(null)
  }

  const filteredItems = useMemo(() => {
    let r = [...items]
    if (search.trim()) { const q=search.toLowerCase(); r=r.filter(i=>i.name.toLowerCase().includes(q)||i.grupo.toLowerCase().includes(q)||(config===0?i.loc_c1:i.loc_c2).toLowerCase().includes(q)) }
    if (sortBy==='grupo') r.sort((a,b)=>(groupKeys.indexOf(a.grupo)-groupKeys.indexOf(b.grupo))||a.name.localeCompare(b.name))
    else if (sortBy==='bolsa') r.sort((a,b)=>getLoc(a).localeCompare(getLoc(b))||a.name.localeCompare(b.name))
    else if (sortBy==='nombre') r.sort((a,b)=>a.name.localeCompare(b.name))
    else if (sortBy==='peso') r.sort((a,b)=>(b.peso*getQty(b))-(a.peso*getQty(a)))
    return r
  }, [items,search,sortBy,config,getQty,getLoc,groupKeys])

  const total    = useMemo(()=>items.reduce((s,i)=>s+i.peso*getQty(i),0),[items,getQty])
  const byGroup  = useMemo(()=>groupKeys.reduce<Record<string,number>>((a,g)=>{a[g]=items.filter(i=>i.grupo===g).reduce((s,i)=>s+i.peso*getQty(i),0);return a;},{}), [items,getQty,groupKeys])
  const byBag    = useMemo(()=>{const r:Record<string,{name:string;uds:number;peso:number}[]>={};items.forEach(it=>{const q=getQty(it);if(!q)return;const l=getLoc(it);if(!r[l])r[l]=[];r[l].push({name:it.name,uds:q,peso:it.peso*q});});return r},[items,getQty,getLoc])
  const maxGW    = Math.max(...(Object.values(byGroup) as number[]),0.001)

  const ItemRow = ({ it }: { it: Item }) => {
    const qty=getQty(it), loc=getLoc(it), color=groupMap[it.grupo]||'#888780'
    return (
      <div className="!grid ![grid-template-columns:5px_1fr_56px_60px] !items-center ![border-bottom:0.5px_solid_#E8E6E0]" style={{ background:qty>0?'#fff':'#FAFAF8' }}>
        <div className="!self-stretch" style={{ background:color, opacity:qty>0?0.6:0.12 }}/>
        <div className="!p-[6px_8px_6px_10px] !cursor-pointer" onClick={()=>setEditItem({...it})}>
          <div className="!text-[length:13px] !font-[500] !overflow-hidden !text-ellipsis !whitespace-nowrap" style={{ color:qty>0?'#2C2C2A':'#B4B2A9' }}>{it.name}</div>
          <div className="!mt-[2px] !overflow-hidden !text-ellipsis !whitespace-nowrap" style={{ fontSize:10, color:'#C2C0B6', ...mono }}>{loc} - {it.peso} kg/u</div>
        </div>
        <div className="!flex !items-center ![background:#F1EFE8] ![border:0.5px_solid_#D3D1C7] !rounded-[5px] !overflow-hidden !m-[6px_4px]">
          <button className="!leading-[1] !cursor-pointer" onClick={()=>changeQty(it,-1)} style={{ background:'none', border:'none', color:'#888780', padding:'4px 6px', fontSize:14, ...mono }}>-</button>
          <span style={{ fontSize:12,fontWeight:600,minWidth:16,textAlign:'center',...mono,color:qty>0?'#E85D24':'#C2C0B6' }}>{qty}</span>
          <button className="!leading-[1] !cursor-pointer" onClick={()=>changeQty(it,+1)} style={{ background:'none', border:'none', color:'#888780', padding:'4px 6px', fontSize:14, ...mono }}>+</button>
        </div>
        <div className="!text-right !p-[6px_10px_6px_2px]">
          <div style={{ fontSize:12,fontWeight:500,color:'#2C2C2A',...mono }}>{(it.peso*qty).toFixed(3)}</div>
          <div style={{ fontSize:10,color:'#B4B2A9',...mono }}>{it.peso.toFixed(3)}</div>
        </div>
      </div>
    )
  }

  const renderList = () => {
    if (sortBy==='grupo') {
      return groupKeys.map(grp => {
        const gi=filteredItems.filter(i=>i.grupo===grp); if(!gi.length)return null
        const gw=gi.reduce((s,i)=>s+i.peso*getQty(i),0)
        return <CollapsibleSection key={grp} sectionKey={grp} color={groupMap[grp]||'#888'} label={grp} weight={gw.toFixed(3)} count={gi.length} collapsed={collapsed} onToggle={toggleSection}>{gi.map(it=><ItemRow key={it.id} it={it}/>)}</CollapsibleSection>
      })
    }
    if (sortBy==='bolsa') {
      const bb: Record<string,Item[]>={}; filteredItems.forEach(it=>{const l=getLoc(it);if(!bb[l])bb[l]=[];bb[l].push(it)})
      return Object.entries(bb).sort((a,b)=>a[0].localeCompare(b[0])).map(([bolsa,bi])=>{
        const bw=bi.reduce((s,i)=>s+i.peso*getQty(i),0)
        const color=configBags.find(b=>b.name===bolsa)?.color||'#888780'
        return <CollapsibleSection key={bolsa} sectionKey={bolsa} color={color} label={bolsa} weight={bw.toFixed(3)} count={bi.length} collapsed={collapsed} onToggle={toggleSection}>{bi.map(it=><ItemRow key={it.id} it={it}/>)}</CollapsibleSection>
      })
    }
    return filteredItems.map(it=><ItemRow key={it.id} it={it}/>)
  }

  if (loading) return <div className="!flex !items-center !justify-center !h-[300px]"><span className="!text-[length:13px] ![color:#888780]" style={{ ...mono }}>Cargando...</span></div>

  return (
    <div className="!flex !flex-col !h-[100%] !overflow-hidden ![background:#F7F6F2]">

      {/* Config tabs */}
      <div className="!flex ![background:#F1EFE8] ![border-bottom:0.5px_solid_#D3D1C7] !shrink-[0]">
        {([0,1] as const).map(i => (
          <button className={['!text-[length:13px] !font-[500] !p-[9px_20px] !cursor-pointer ![background:none] ![font-family:Syne,sans-serif]', (config===i) ? '![color:#E85D24]' : '![color:#888780]', (config===i) ? '[&&]:![border-bottom:2px_solid_#E85D24]' : '[&&]:![border-bottom:2px_solid_transparent]', '![border:none]'].join(' ')} key={i} onClick={()=>setConfig(i)}>
            {i===0?'Config 1 - Alforjas':'Config 2 - Bikepacking'}
          </button>
        ))}
        <div className="!ml-[auto] !flex !items-center !gap-[6px] !p-[0_12px]">
          <button className="!text-[length:11px] ![color:#3B6D11] ![background:#EAF3DE] ![border:0.5px_solid_#97C459] !rounded-[5px] !p-[4px_10px] !cursor-pointer" onClick={()=>setShowGroups(true)} style={{ ...mono }}>Categorias</button>
          <button className="!text-[length:11px] ![color:#534AB7] ![background:#EEEDFE] ![border:0.5px_solid_#AFA9EC] !rounded-[5px] !p-[4px_10px] !cursor-pointer" onClick={()=>setShowBags(true)} style={{ ...mono }}>Bolsas</button>
          <button className="!text-[length:11px] ![color:#888780] ![background:#F1EFE8] ![border:0.5px_solid_#C2C0B6] !rounded-[5px] !p-[4px_10px] !cursor-pointer" onClick={()=>printList(items,groups,configBags,byGroup,byBag,total,config,getQty,getLoc,groupMap)} style={{ ...mono }}>🖨️</button>
          <span className="!text-[length:12px] !font-[600] !p-[4px_12px] !rounded-[20px]" style={{ background:'#E85D24', color:'#fff', ...mono }}>{total.toFixed(3)} kg</span>
        </div>
      </div>

      {/* Panels */}
      <div className="!flex !flex-[1] !overflow-hidden">

        {/* Left panel */}
        <div className="!flex !flex-col !overflow-hidden ![background:#fff] !shrink-[0]" style={{ width:`${leftWidth}%` }}>
          <div className="!p-[10px_12px_8px] ![border-bottom:0.5px_solid_#E8E6E0] ![background:#FAFAF8] !shrink-[0]">
            <input className="!mb-[7px]" placeholder="Buscar elemento, categoria, bolsa..." value={search} onChange={e=>setSearch(e.target.value)} style={{ ...inp }}/>
            <div className="!flex !items-center !gap-[5px]">
              <span className="!shrink-[0]" style={{ fontSize:10, color:'#C2C0B6', ...mono }}>orden:</span>
              {(['grupo','bolsa','nombre','peso'] as const).map(v=>(
                <button key={v} onClick={()=>setSortBy(v)} style={pill(sortBy===v)}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>
              ))}
              {search && <span style={{ marginLeft:'auto', fontSize:10, color:'#B4B2A9', ...mono }}>{filteredItems.length}</span>}
            </div>
          </div>
          <div className="!flex-[1] !overflow-y-auto">
            {filteredItems.length===0
              ? <p style={{ textAlign:'center', padding:24, fontSize:12, color:'#B4B2A9', ...mono }}>Sin resultados</p>
              : renderList()}
          </div>
          <div className="!p-[10px_12px] ![border-top:0.5px_solid_#D3D1C7] ![background:#F7F6F2] !shrink-[0]">
            <button className="!w-[100%] !p-[9px]" onClick={()=>setEditItem({name:'',peso:0.1,grupo:groupKeys[0]||'',loc_c1:bagNamesC1[0]||'',loc_c2:bagNamesC2[0]||''})}
              style={{ ...btn() }}>+ Nuevo elemento</button>
          </div>
        </div>

        {/* Resize handle */}
        <div className="![background:transparent] ![cursor:col-resize] !flex !items-center !justify-center !select-none !z-[10] !shrink-[0] !w-[6px]" onMouseDown={startResize}>
          <div className="trek-h-background-2c9f8f !w-[3px] !h-[48px] ![background:#D3D1C7] !rounded-[2px] ![transition:background_.15s]"/>
        </div>

        {/* Right panel */}
        <div className="!overflow-y-auto ![background:#F7F6F2] !flex-[1] !min-w-[0]">
          <div className="!p-[12px_14px_8px] ![background:#fff] ![border-bottom:0.5px_solid_#D3D1C7]">
            <div className="!flex !items-center !justify-between !mb-[8px]">
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#B4B2A9', ...mono }}>distribucion visual</div>
              <button className="!text-[length:10px] ![color:#E85D24] ![background:#FFF0E8] ![border:0.5px_solid_#E85D24] !rounded-[4px] !p-[3px_8px] !cursor-pointer" onClick={()=>setShowBagEditor(true)} style={{ ...mono }}>Editar posiciones</button>
            </div>
            <BikeSVG bags={configBags} byBag={byBag} onClick={()=>setShowBikeZoom(true)}/>
          </div>

          <div className="!p-[10px_14px_0]">
            <div className="!mb-[8px]" style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#B4B2A9', ...mono }}>bolsas activas</div>
          </div>
          <div className="!p-[0_14px_12px]">
            {Object.entries(byBag).sort((a,b)=>b[1].reduce((s,i)=>s+i.peso,0)-a[1].reduce((s,i)=>s+i.peso,0)).map(([name,bi])=>{
              const t=bi.reduce((s,i)=>s+i.peso,0), color=configBags.find(b=>b.name===name)?.color||'#888780'
              return (
                <div className="![border:0.5px_solid_#D3D1C7] !rounded-[8px] !mb-[7px] !overflow-hidden ![background:#fff]" key={name}>
                  <div className="!flex !items-center !justify-between !p-[6px_10px] ![background:#F7F6F2]">
                    <div className="!flex !items-center !gap-[7px]"><div className="!w-[7px] !h-[7px] !rounded-[2px]" style={{ background:color }}/><span className="!text-[length:11px] !font-[700] ![color:#2C2C2A]">{name}</span></div>
                    <span style={{ fontSize:11,fontWeight:600,color:'#E85D24',...mono }}>{t.toFixed(3)} kg</span>
                  </div>
                  <div className="!p-[4px_10px_7px]">
                    {bi.map((item,idx)=>(
                      <div className="![color:#888780]" key={idx} style={{ display:'flex', justifyContent:'space-between', fontSize:11, padding:'1px 0', ...mono }}>
                        <span>{item.uds>1?`${item.uds}x `:''}{item.name}</span>
                        <span className="![color:#B4B2A9]">{item.peso.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {Object.keys(byBag).length===0 && <p className="!text-center !p-[16px]" style={{ fontSize:12, color:'#B4B2A9', ...mono }}>Sin elementos activos</p>}
          </div>

          <div className="!p-[8px_14px_0] ![border-top:0.5px_solid_#D3D1C7]">
            <div className="!mb-[8px]" style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#B4B2A9', ...mono }}>peso por categoria</div>
          </div>
          <div className="!p-[0_14px_24px]">
            {groupKeys.map(grp=>{
              const w=byGroup[grp]||0
              return (
                <div className="!mb-[9px]" key={grp}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3, fontSize:11, ...mono }}>
                    <span className="![color:#888780]">{grp}</span><span className="![color:#B4B2A9]">{w.toFixed(3)} kg</span>
                  </div>
                  <div className="!h-[5px] ![background:#F1EFE8] !rounded-[3px] !overflow-hidden">
                    <div className="!h-[100%] !rounded-[3px] ![transition:width_.4s]" style={{ width:`${(w/maxGW)*100}%`, background:groupMap[grp]||'#888' }}/>
                  </div>
                </div>
              )
            })}
            <div className="!text-[length:12px]" style={{ marginTop:14, paddingTop:10, borderTop:'0.5px solid #D3D1C7', display:'flex', justifyContent:'space-between', ...mono }}>
              <span className="![color:#888780] !font-[500]">Total</span>
              <span className="![color:#E85D24] !font-[700]">{total.toFixed(3)} kg</span>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {editItem && (
        <Modal title={editItem.id?'Editar elemento':'Nuevo elemento'} onClose={()=>setEditItem(null)}>
          <ItemForm item={editItem} groupKeys={groupKeys} bagNamesC1={bagNamesC1} bagNamesC2={bagNamesC2} onSave={saveItem} onDelete={editItem.id?deleteItem:null}/>
        </Modal>
      )}
      {showGroups && (
        <Modal title="Gestionar categorias" onClose={()=>{setShowGroups(false);setEditGroup(null)}}>
          {editGroup
            ? <GroupForm group={editGroup} onSave={saveGroup} onDelete={editGroup.id?deleteGroup:null} onCancel={()=>setEditGroup(null)}/>
            : <GroupList groups={groups} onEdit={setEditGroup} onNew={()=>setEditGroup({name:'',color:'#888780',sort_order:99})}/>}
        </Modal>
      )}
      {showBikeZoom && (
        <BikeSVGModal bags={configBags} byBag={byBag} onClose={()=>setShowBikeZoom(false)}/>
      )}
      {showBagEditor && (
        <BagEditor bags={configBags} onSave={bag=>setBags(prev=>prev.map(b=>b.id===bag.id?{...b,...bag}:b))} onClose={()=>setShowBagEditor(false)}/>
      )}
      {showBags && (
        <Modal title={`Bolsas Config ${config+1}`} onClose={()=>{setShowBags(false);setEditBag(null)}}>
          {editBag
            ? <BagForm bag={editBag} config={config} onSave={saveBag} onDelete={editBag.id?deleteBag:null} onCancel={()=>setEditBag(null)}/>
            : <BagList bags={configBags} onEdit={setEditBag} onNew={()=>setEditBag({config_idx:config,name:'',color:'#888780',has_pos:0,pos_x:100,pos_y:100,pos_w:30,pos_h:30})}/>}
        </Modal>
      )}
    </div>
  )
}
