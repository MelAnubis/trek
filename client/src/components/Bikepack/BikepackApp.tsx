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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000 }}>
      <div style={{ background:'#fff', borderRadius:12, padding:24, width:380, maxWidth:'90vw', maxHeight:'80vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <span style={{ fontSize:14, fontWeight:700, color:'#2C2C2A' }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'#888780', lineHeight:1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:10, fontWeight:700, color:'#888780', ...mono, letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:4 }}>{label}</label>
      {children}
    </div>
  )
}

const COLORS = ['#E85D24','#C04828','#1B6CA8','#0C447C','#3B6D11','#BA7517','#854F0B','#993556','#534AB7','#888780']
function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
      {COLORS.map(c => (
        <div key={c} onClick={() => onChange(c)}
          style={{ width:22, height:22, borderRadius:4, background:c, cursor:'pointer', border: value===c ? '2px solid #2C2C2A' : '2px solid transparent', transition:'border .1s' }}
        />
      ))}
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width:22, height:22, padding:0, border:'0.5px solid #D3D1C7', borderRadius:4, cursor:'pointer' }}/>
    </div>
  )
}

// ── BikeSVG ────────────────────────────────────────────────────────────────
function BikeSVG({ bags, byBag }: { bags: Bag[]; byBag: Record<string, {name:string;uds:number;peso:number}[]> }) {
  return (
    <svg width="100%" viewBox="0 0 308 203" style={{ display:'block' }}>
      <image href={bikeImg} x="0" y="0" width="308" height="203" preserveAspectRatio="xMidYMid meet"/>
      {bags.filter(b => b.has_pos).map(b => {
        const items = byBag[b.name] || []
        const total = items.reduce((s, i) => s + i.peso, 0)
        const active = items.length > 0
        const ry = Math.min(5, (b.pos_h ?? 0) / 2)
        return (
          <g key={b.id}>
            <rect x={b.pos_x!} y={b.pos_y!} width={b.pos_w!} height={b.pos_h!} rx={ry}
              fill={b.color} opacity={active ? 0.85 : 0.18}
              stroke="white" strokeWidth={active ? 0.8 : 0.3} strokeOpacity={active ? 0.6 : 0.2}/>
            {active && total > 0 && (
              <g>
                <clipPath id={`clip-${b.id}`}>
                  <rect x={b.pos_x!+1} y={b.pos_y!+1} width={b.pos_w!-2} height={b.pos_h!-2} rx={Math.min(4,(b.pos_h??0)/2)}/>
                </clipPath>
                <text x={b.pos_x!+b.pos_w!/2} y={b.pos_y!+b.pos_h!*0.36} textAnchor="middle" dominantBaseline="central"
                  fontSize="5" fontFamily="DM Mono,monospace" fontWeight="700" fill="white" clipPath={`url(#clip-${b.id})`}>
                  {abbrevBag(b.name)}
                </text>
                <text x={b.pos_x!+b.pos_w!/2} y={b.pos_y!+b.pos_h!*0.68} textAnchor="middle" dominantBaseline="central"
                  fontSize="5" fontFamily="DM Mono,monospace" fontWeight="500" fill="white" opacity={0.85} clipPath={`url(#clip-${b.id})`}>
                  {total.toFixed(2)}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2100 }}>
      <div style={{ background:'#fff', borderRadius:12, width:'min(760px,95vw)', maxHeight:'90vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'0.5px solid #D3D1C7' }}>
          <span style={{ fontSize:14, fontWeight:700, color:'#2C2C2A' }}>Editar posiciones de bolsas</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'#888780' }}>×</button>
        </div>
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
          <div style={{ flex:1, overflow:'hidden', padding:12 }}>
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
                    <text x={b.pos_x!+b.pos_w!/2} y={b.pos_y!+b.pos_h!*0.38} textAnchor="middle" dominantBaseline="central"
                      fontSize={Math.min(7,Math.max(5,(b.pos_w??0)/5))} fontFamily="DM Mono,monospace" fontWeight="700" fill="white"
                      clipPath={`url(#eclip-${b.id})`} style={{ pointerEvents:'none' }}>
                      {b.name.replace('Alforja ','Af.').replace('Bolsa ','').replace('Delantera','Del.').replace('Trasera','Tras.')}
                    </text>
                    {isSel && (
                      <rect x={b.pos_x!+b.pos_w!-6} y={b.pos_y!+b.pos_h!-6} width={8} height={8} rx={2}
                        fill="#fff" stroke={b.color} strokeWidth={1} style={{ cursor:'se-resize' }}
                        onMouseDown={e => startDrag(e,b.id,'resize')} onTouchStart={e => startDrag(e,b.id,'resize')}/>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
          <div style={{ width:190, borderLeft:'0.5px solid #D3D1C7', overflowY:'auto', padding:10, flexShrink:0 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1px', color:'#888780', ...mono, textTransform:'uppercase', marginBottom:8 }}>Bolsas</div>
            {localBags.map(b => (
              <div key={b.id} onClick={() => b.has_pos && setSelected(b.id)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 8px', borderRadius:6, marginBottom:4, background:selected===b.id?'#FFF0E8':'#F7F6F2', cursor:b.has_pos?'pointer':'default', border:selected===b.id?'0.5px solid #E85D24':'0.5px solid transparent' }}>
                <div style={{ width:10, height:10, borderRadius:2, background:b.color, flexShrink:0 }}/>
                <span style={{ fontSize:11, color:'#2C2C2A', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.name}</span>
                <button onClick={e => { e.stopPropagation(); toggleVisible(b.id) }}
                  style={{ background:'none', border:'none', fontSize:14, cursor:'pointer', color:b.has_pos?'#E85D24':'#C2C0B6', padding:0, lineHeight:1 }}>
                  {b.has_pos ? 'o' : '-'}
                </button>
              </div>
            ))}
            <div style={{ marginTop:12, padding:8, background:'#F1EFE8', borderRadius:6 }}>
              <div style={{ fontSize:9, color:'#888780', ...mono, lineHeight:1.5 }}>
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
      <div onClick={() => onToggle(sectionKey)} style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 14px', background:'#F1EFE8', borderTop:'0.5px solid #D3D1C7', borderBottom:open?'0.5px solid #D3D1C7':'none', cursor:'pointer', userSelect:'none' }}>
        <div style={{ width:9, height:9, borderRadius:'50%', background:color, flexShrink:0 }}/>
        <span style={{ fontSize:11, fontWeight:700, color:'#444441', ...mono, letterSpacing:'0.5px' }}>{label}</span>
        <span style={{ fontSize:10, color:'#B4B2A9', ...mono }}>({count})</span>
        <span style={{ marginLeft:'auto', fontSize:11, ...mono, color:'#888780' }}>{weight} kg</span>
        <span style={{ fontSize:10, color:'#B4B2A9', marginLeft:4 }}>{open ? '▲' : '▼'}</span>
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
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <Field label="Peso (kg)"><input type="number" step="0.001" min="0" style={inp} value={f.peso} onChange={e=>set('peso',parseFloat(e.target.value)||0)}/></Field>
        <Field label="Categoria">
          <select style={inp} value={f.grupo} onChange={e=>set('grupo',e.target.value)}>
            {groupKeys.map(g=><option key={g}>{g}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
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
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <Field label="Uds Config 1"><input type="number" min="0" style={inp} value={f.uds_c1} onChange={e=>set('uds_c1',parseInt(e.target.value)||0)}/></Field>
          <Field label="Uds Config 2"><input type="number" min="0" style={inp} value={f.uds_c2} onChange={e=>set('uds_c2',parseInt(e.target.value)||0)}/></Field>
        </div>
      )}
      <div style={{ display:'flex', gap:8, marginTop:18 }}>
        <button onClick={()=>onSave(f)} style={{ ...btn(), flex:1 }}>{item.id?'Guardar':'Crear'}</button>
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
        <div key={g.id} onClick={()=>onEdit({...g})} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, border:'0.5px solid #D3D1C7', marginBottom:7, background:'#fff', cursor:'pointer' }}>
          <div style={{ width:14, height:14, borderRadius:'50%', background:g.color, flexShrink:0 }}/>
          <span style={{ fontSize:13, fontWeight:500, color:'#2C2C2A', flex:1 }}>{g.name}</span>
          <span style={{ fontSize:10, ...mono, color:'#B4B2A9' }}>orden {g.sort_order}</span>
          <span style={{ fontSize:12, color:'#B4B2A9' }}>›</span>
        </div>
      ))}
      <button onClick={onNew} style={{ ...btn(), width:'100%', marginTop:4 }}>+ Nueva categoria</button>
    </>
  )
}

function GroupForm({ group, onSave, onDelete, onCancel }: { group: Partial<Group>; onSave: (d:Partial<Group>)=>void; onDelete: ((id:number)=>void)|null; onCancel: ()=>void }) {
  const [f, setF] = useState({ name:'', color:'#888780', sort_order:99, ...group })
  const set = (k: string, v: unknown) => setF((p: any) => ({...p,[k]:v}))
  return (
    <>
      <button onClick={onCancel} style={{ background:'none', border:'none', color:'#888780', cursor:'pointer', fontSize:12, ...mono, marginBottom:14, padding:0 }}>← volver</button>
      <Field label="Nombre de la categoria"><input style={inp} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
      <Field label="Color"><ColorPicker value={f.color} onChange={v=>set('color',v)}/></Field>
      <Field label="Orden (menor = primero)"><input type="number" style={inp} value={f.sort_order} onChange={e=>set('sort_order',parseInt(e.target.value)||99)}/></Field>
      <div style={{ display:'flex', gap:8, marginTop:18 }}>
        <button onClick={()=>onSave(f)} style={{ ...btn(), flex:1 }}>{group.id?'Guardar':'Crear'}</button>
        {onDelete && group.id && <button onClick={()=>onDelete!(group.id!)} style={btn('#FCEBEB','#A32D2D')}>Eliminar</button>}
      </div>
    </>
  )
}

// ── BagList / BagForm ────────────────────────────────────────────────────
function BagList({ bags, onEdit, onNew }: { bags: Bag[]; onEdit: (b:Bag)=>void; onNew: ()=>void }) {
  return (
    <>
      {bags.length===0 && <p style={{ fontSize:12, color:'#B4B2A9', ...mono, textAlign:'center', padding:12 }}>Sin bolsas</p>}
      {bags.map(b => (
        <div key={b.id} onClick={()=>onEdit({...b})} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, border:'0.5px solid #D3D1C7', marginBottom:7, background:'#fff', cursor:'pointer' }}>
          <div style={{ width:12, height:12, borderRadius:3, background:b.color, flexShrink:0 }}/>
          <span style={{ fontSize:13, fontWeight:500, color:'#2C2C2A', flex:1 }}>{b.name}</span>
          {b.has_pos ? <span style={{ fontSize:10, ...mono, color:'#B4B2A9' }}>{Math.round(b.pos_x!)},{Math.round(b.pos_y!)} {Math.round(b.pos_w!)}x{Math.round(b.pos_h!)}</span> : <span style={{ fontSize:10, ...mono, color:'#C2C0B6' }}>sin pos.</span>}
          <span style={{ fontSize:12, color:'#B4B2A9' }}>›</span>
        </div>
      ))}
      <button onClick={onNew} style={{ ...btn(), width:'100%', marginTop:4 }}>+ Nueva bolsa</button>
    </>
  )
}

function BagForm({ bag, config, onSave, onDelete, onCancel }: { bag: Partial<Bag>; config: number; onSave: (d:Partial<Bag>)=>void; onDelete: ((id:number)=>void)|null; onCancel: ()=>void }) {
  const [f, setF] = useState({ config_idx:config, name:'', color:'#888780', has_pos:0, pos_x:100, pos_y:100, pos_w:30, pos_h:30, ...bag })
  const set = (k: string, v: unknown) => setF((p: any) => ({...p,[k]:v}))
  return (
    <>
      <button onClick={onCancel} style={{ background:'none', border:'none', color:'#888780', cursor:'pointer', fontSize:12, ...mono, marginBottom:14, padding:0 }}>← volver</button>
      <Field label="Nombre de la bolsa"><input style={inp} value={f.name} onChange={e=>set('name',e.target.value)}/></Field>
      <Field label="Color"><ColorPicker value={f.color} onChange={v=>set('color',v)}/></Field>
      <Field label="Visible en bici">
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
          <input type="checkbox" checked={!!f.has_pos} onChange={e=>set('has_pos',e.target.checked?1:0)} style={{ width:16, height:16 }}/>
          <span style={{ fontSize:12, color:'#2C2C2A' }}>Mostrar en el dibujo</span>
        </label>
      </Field>
      {!!f.has_pos && (
        <div style={{ background:'#F7F6F2', borderRadius:8, padding:12, marginBottom:8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'#888780', ...mono, marginBottom:10, letterSpacing:'0.5px', textTransform:'uppercase' }}>Posicion (viewBox 308x230)</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <Field label="X"><input type="number" style={inp} value={f.pos_x??0} onChange={e=>set('pos_x',Number(e.target.value))}/></Field>
            <Field label="Y"><input type="number" style={inp} value={f.pos_y??0} onChange={e=>set('pos_y',Number(e.target.value))}/></Field>
            <Field label="Ancho"><input type="number" style={inp} value={f.pos_w??30} onChange={e=>set('pos_w',Number(e.target.value))}/></Field>
            <Field label="Alto"><input type="number" style={inp} value={f.pos_h??30} onChange={e=>set('pos_h',Number(e.target.value))}/></Field>
          </div>
        </div>
      )}
      <div style={{ display:'flex', gap:8, marginTop:18 }}>
        <button onClick={()=>onSave(f)} style={{ ...btn(), flex:1 }}>{bag.id?'Guardar':'Crear bolsa'}</button>
        {onDelete && bag.id && <button onClick={()=>onDelete!(bag.id!)} style={btn('#FCEBEB','#A32D2D')}>Eliminar</button>}
      </div>
    </>
  )
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
      <div style={{ display:'grid', gridTemplateColumns:'5px 1fr 56px 60px', alignItems:'center', borderBottom:'0.5px solid #E8E6E0', background:qty>0?'#fff':'#FAFAF8' }}>
        <div style={{ background:color, opacity:qty>0?0.6:0.12, alignSelf:'stretch' }}/>
        <div style={{ padding:'6px 8px 6px 10px', cursor:'pointer' }} onClick={()=>setEditItem({...it})}>
          <div style={{ fontSize:13, fontWeight:500, color:qty>0?'#2C2C2A':'#B4B2A9', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.name}</div>
          <div style={{ fontSize:10, color:'#C2C0B6', ...mono, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{loc} - {it.peso} kg/u</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', background:'#F1EFE8', border:'0.5px solid #D3D1C7', borderRadius:5, overflow:'hidden', margin:'6px 4px' }}>
          <button onClick={()=>changeQty(it,-1)} style={{ background:'none',border:'none',color:'#888780',padding:'4px 6px',fontSize:14,...mono,lineHeight:1,cursor:'pointer' }}>-</button>
          <span style={{ fontSize:12,fontWeight:600,minWidth:16,textAlign:'center',...mono,color:qty>0?'#E85D24':'#C2C0B6' }}>{qty}</span>
          <button onClick={()=>changeQty(it,+1)} style={{ background:'none',border:'none',color:'#888780',padding:'4px 6px',fontSize:14,...mono,lineHeight:1,cursor:'pointer' }}>+</button>
        </div>
        <div style={{ textAlign:'right', padding:'6px 10px 6px 2px' }}>
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

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:300}}><span style={{...mono,fontSize:13,color:'#888780'}}>Cargando...</span></div>

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'#F7F6F2' }}>

      {/* Config tabs */}
      <div style={{ display:'flex', background:'#F1EFE8', borderBottom:'0.5px solid #D3D1C7', flexShrink:0 }}>
        {([0,1] as const).map(i => (
          <button key={i} onClick={()=>setConfig(i)} style={{ fontSize:13, fontWeight:500, color:config===i?'#E85D24':'#888780', padding:'9px 20px', cursor:'pointer', background:'none', border:'none', borderBottom:config===i?'2px solid #E85D24':'2px solid transparent', fontFamily:'Syne,sans-serif' }}>
            {i===0?'Config 1 - Alforjas':'Config 2 - Bikepacking'}
          </button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'0 12px' }}>
          <button onClick={()=>setShowGroups(true)} style={{ ...mono, fontSize:11, color:'#3B6D11', background:'#EAF3DE', border:'0.5px solid #97C459', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>Categorias</button>
          <button onClick={()=>setShowBags(true)} style={{ ...mono, fontSize:11, color:'#534AB7', background:'#EEEDFE', border:'0.5px solid #AFA9EC', borderRadius:5, padding:'4px 10px', cursor:'pointer' }}>Bolsas</button>
          <span style={{ background:'#E85D24', color:'#fff', ...mono, fontSize:12, fontWeight:600, padding:'4px 12px', borderRadius:20 }}>{total.toFixed(3)} kg</span>
        </div>
      </div>

      {/* Panels */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left panel */}
        <div style={{ display:'flex', flexDirection:'column', overflow:'hidden', background:'#fff', width:`${leftWidth}%`, flexShrink:0 }}>
          <div style={{ padding:'10px 12px 8px', borderBottom:'0.5px solid #E8E6E0', background:'#FAFAF8', flexShrink:0 }}>
            <input placeholder="Buscar elemento, categoria, bolsa..." value={search} onChange={e=>setSearch(e.target.value)} style={{ ...inp, marginBottom:7 }}/>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:10, color:'#C2C0B6', ...mono, flexShrink:0 }}>orden:</span>
              {(['grupo','bolsa','nombre','peso'] as const).map(v=>(
                <button key={v} onClick={()=>setSortBy(v)} style={pill(sortBy===v)}>{v.charAt(0).toUpperCase()+v.slice(1)}</button>
              ))}
              {search && <span style={{ marginLeft:'auto', fontSize:10, color:'#B4B2A9', ...mono }}>{filteredItems.length}</span>}
            </div>
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {filteredItems.length===0
              ? <p style={{ textAlign:'center', padding:24, fontSize:12, color:'#B4B2A9', ...mono }}>Sin resultados</p>
              : renderList()}
          </div>
          <div style={{ padding:'10px 12px', borderTop:'0.5px solid #D3D1C7', background:'#F7F6F2', flexShrink:0 }}>
            <button onClick={()=>setEditItem({name:'',peso:0.1,grupo:groupKeys[0]||'',loc_c1:bagNamesC1[0]||'',loc_c2:bagNamesC2[0]||''})}
              style={{ ...btn(), width:'100%', padding:'9px' }}>+ Nuevo elemento</button>
          </div>
        </div>

        {/* Resize handle */}
        <div onMouseDown={startResize} style={{ background:'transparent', cursor:'col-resize', display:'flex', alignItems:'center', justifyContent:'center', userSelect:'none', zIndex:10, flexShrink:0, width:6 }}>
          <div style={{ width:3, height:48, background:'#D3D1C7', borderRadius:2, transition:'background .15s' }}
            onMouseEnter={e=>(e.currentTarget.style.background='#E85D24')}
            onMouseLeave={e=>(e.currentTarget.style.background='#D3D1C7')}/>
        </div>

        {/* Right panel */}
        <div style={{ overflowY:'auto', background:'#F7F6F2', flex:1, minWidth:0 }}>
          <div style={{ padding:'12px 14px 8px', background:'#fff', borderBottom:'0.5px solid #D3D1C7' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#B4B2A9', ...mono }}>distribucion visual</div>
              <button onClick={()=>setShowBagEditor(true)} style={{ ...mono, fontSize:10, color:'#E85D24', background:'#FFF0E8', border:'0.5px solid #E85D24', borderRadius:4, padding:'3px 8px', cursor:'pointer' }}>Editar posiciones</button>
            </div>
            <BikeSVG bags={configBags} byBag={byBag}/>
          </div>

          <div style={{ padding:'10px 14px 0' }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#B4B2A9', ...mono, marginBottom:8 }}>bolsas activas</div>
          </div>
          <div style={{ padding:'0 14px 12px' }}>
            {Object.entries(byBag).sort((a,b)=>b[1].reduce((s,i)=>s+i.peso,0)-a[1].reduce((s,i)=>s+i.peso,0)).map(([name,bi])=>{
              const t=bi.reduce((s,i)=>s+i.peso,0), color=configBags.find(b=>b.name===name)?.color||'#888780'
              return (
                <div key={name} style={{ border:'0.5px solid #D3D1C7', borderRadius:8, marginBottom:7, overflow:'hidden', background:'#fff' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 10px', background:'#F7F6F2' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7 }}><div style={{ width:7,height:7,borderRadius:2,background:color }}/><span style={{ fontSize:11,fontWeight:700,color:'#2C2C2A' }}>{name}</span></div>
                    <span style={{ fontSize:11,fontWeight:600,color:'#E85D24',...mono }}>{t.toFixed(3)} kg</span>
                  </div>
                  <div style={{ padding:'4px 10px 7px' }}>
                    {bi.map((item,idx)=>(
                      <div key={idx} style={{ display:'flex', justifyContent:'space-between', fontSize:11, padding:'1px 0', ...mono, color:'#888780' }}>
                        <span>{item.uds>1?`${item.uds}x `:''}{item.name}</span>
                        <span style={{ color:'#B4B2A9' }}>{item.peso.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {Object.keys(byBag).length===0 && <p style={{ fontSize:12,color:'#B4B2A9',...mono,textAlign:'center',padding:16 }}>Sin elementos activos</p>}
          </div>

          <div style={{ padding:'8px 14px 0', borderTop:'0.5px solid #D3D1C7' }}>
            <div style={{ fontSize:10,fontWeight:700,letterSpacing:'1.5px',textTransform:'uppercase',color:'#B4B2A9',...mono,marginBottom:8 }}>peso por categoria</div>
          </div>
          <div style={{ padding:'0 14px 24px' }}>
            {groupKeys.map(grp=>{
              const w=byGroup[grp]||0
              return (
                <div key={grp} style={{ marginBottom:9 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3, fontSize:11, ...mono }}>
                    <span style={{ color:'#888780' }}>{grp}</span><span style={{ color:'#B4B2A9' }}>{w.toFixed(3)} kg</span>
                  </div>
                  <div style={{ height:5, background:'#F1EFE8', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${(w/maxGW)*100}%`, background:groupMap[grp]||'#888', borderRadius:3, transition:'width .4s' }}/>
                  </div>
                </div>
              )
            })}
            <div style={{ marginTop:14,paddingTop:10,borderTop:'0.5px solid #D3D1C7',display:'flex',justifyContent:'space-between',...mono,fontSize:12 }}>
              <span style={{ color:'#888780',fontWeight:500 }}>Total</span>
              <span style={{ color:'#E85D24',fontWeight:700 }}>{total.toFixed(3)} kg</span>
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
