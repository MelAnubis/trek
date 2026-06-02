import express, { Request, Response } from 'express';
import { db } from '../db/database';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = express.Router();

// ── Seed default data for first-time users ───────────────────────────────────
function seedUser(userId: number | string) {
  const hasGroups = (db.prepare('SELECT COUNT(*) as c FROM bikepack_groups WHERE user_id=?').get(userId) as { c: number }).c;
  if (hasGroups > 0) return;

  const insG = db.prepare('INSERT INTO bikepack_groups (user_id,name,color,sort_order) VALUES (?,?,?,?)');
  db.transaction(() => {
    insG.run(userId, 'Ropa',       '#1B6CA8', 1);
    insG.run(userId, 'Acampada',   '#3B6D11', 2);
    insG.run(userId, 'Tools',      '#BA7517', 3);
    insG.run(userId, 'Electronica','#534AB7', 4);
    insG.run(userId, 'Accesorios', '#993556', 5);
  })();

  const insB = db.prepare(
    'INSERT INTO bikepack_bags (user_id,config_idx,name,color,has_pos,pos_x,pos_y,pos_w,pos_h) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  db.transaction(() => {
    const bags: [number, string, string, number, number|null, number|null, number|null, number|null][] = [
      [0,'Alforja Trasera 1','#E85D24',1,8,68,46,52],
      [0,'Alforja Trasera 2','#C04828',1,8,122,46,38],
      [0,'Alforja Delantera 1','#1B6CA8',1,204,56,58,56],
      [0,'Alforja Delantera 2','#0C447C',1,204,114,58,38],
      [0,'Bolsa Cuadro','#3B6D11',1,118,94,76,48],
      [0,'Bolsa Manillar','#BA7517',1,224,20,52,32],
      [0,'Bolsa Top Barra','#854F0B',1,120,78,80,14],
      [0,'SteamBag 1','#993556',0,null,null,null,null],
      [0,'Puesto','#888780',0,null,null,null,null],
      [0,'Colgado','#888780',0,null,null,null,null],
      [1,'Bolsa Sillin','#E85D24',1,84,48,42,30],
      [1,'Bolsa Horquilla 1','#C04828',1,204,56,28,80],
      [1,'Bolsa Horquilla 2','#D85A30',1,234,56,28,80],
      [1,'Bolsa Manillar','#BA7517',1,224,20,52,32],
      [1,'Bolsa Top Barra','#854F0B',1,120,78,80,14],
      [1,'Bolsa Cuadro','#3B6D11',1,118,94,76,48],
      [1,'SteamBag 1','#8B3D6B',0,null,null,null,null],
      [1,'Puesto','#888780',0,null,null,null,null],
      [1,'Colgado','#888780',0,null,null,null,null],
    ];
    for (const [ci, name, color, has_pos, px, py, pw, ph] of bags) {
      insB.run(userId, ci, name, color, has_pos, px, py, pw, ph);
    }
  })();

  const insI = db.prepare(
    'INSERT INTO bikepack_items (user_id,name,peso,grupo,loc_c1,loc_c2,uds_c1,uds_c2) VALUES (?,?,?,?,?,?,?,?)'
  );
  db.transaction(() => {
    const items: [string, number, string, string, string, number, number][] = [
      ['Calcetines',0.05,'Ropa','Alforja Trasera 2','Bolsa Sillin',4,3],
      ['Calzado normal',0.5,'Ropa','Puesto','Puesto',1,1],
      ['Camiseta m/c',0.2,'Ropa','Alforja Trasera 2','Bolsa Sillin',2,2],
      ['Camiseta Termica m/l',0.2,'Ropa','Alforja Trasera 1','Bolsa Sillin',2,2],
      ['Culotte Corto',0.175,'Ropa','Alforja Trasera 1','Bolsa Sillin',1,0],
      ['Culotte Largo',0.25,'Ropa','Alforja Trasera 1','Bolsa Sillin',2,3],
      ['Guantes cortos',0.1,'Ropa','Puesto','Bolsa Sillin',1,0],
      ['Guantes largos',0.1,'Ropa','Puesto','Puesto',1,1],
      ['Maillot m/l',0.2,'Ropa','Alforja Trasera 1','Bolsa Sillin',2,3],
      ['Pijama',0.2,'Ropa','Alforja Trasera 2','Bolsa Sillin',1,1],
      ['Plumas',0.25,'Ropa','Bolsa Manillar','Bolsa Sillin',1,1],
      ['Ropa Interior',0.2,'Ropa','Alforja Trasera 2','Bolsa Sillin',4,4],
      ['Pantalon de Agua',0.15,'Ropa','Alforja Trasera 1','Bolsa Sillin',1,1],
      ['Chubasquero Agua',0.15,'Ropa','Alforja Trasera 1','Bolsa Sillin',1,1],
      ['Bolsa de Aseo',0.4,'Accesorios','Alforja Trasera 1','Bolsa Sillin',1,0],
      ['Botiquin',0.4,'Tools','Bolsa Cuadro','Bolsa Cuadro',1,0],
      ['Herramienta',0.5,'Tools','Bolsa Cuadro','Bolsa Cuadro',1,1],
      ['Agua Bidon 750',0.8,'Tools','Puesto','Bolsa Horquilla 1',1,1],
      ['PowerBank',0.3,'Electronica','Bolsa Cuadro','Bolsa Top Barra',1,1],
      ['Telefono',0.4,'Electronica','Puesto','Puesto',1,1],
      ['GPS',0.12,'Electronica','Puesto','Puesto',1,0],
      ['Faro Delantero',0.1,'Electronica','Bolsa Cuadro','Puesto',1,1],
      ['Faro Trasero',0.07,'Electronica','Puesto','Puesto',1,1],
      ['Cargador Cables',0.2,'Electronica','Bolsa Cuadro','Bolsa Cuadro',1,1],
      ['Gafas Sol',0.08,'Accesorios','Puesto','Puesto',1,1],
      ['Buff',0.2,'Accesorios','Puesto','Puesto',1,1],
    ];
    for (const [name, peso, grupo, loc_c1, loc_c2, uds_c1, uds_c2] of items) {
      insI.run(userId, name, peso, grupo, loc_c1, loc_c2, uds_c1, uds_c2);
    }
  })();
}

// ── Profile (all user data, used by import modal) ────────────────────────────
router.get('/profile', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  seedUser(userId);
  const groups = db.prepare('SELECT id,name,color FROM bikepack_groups WHERE user_id=? ORDER BY sort_order,name').all(userId);
  const items  = db.prepare('SELECT id,name,peso,grupo,loc_c1,loc_c2,uds_c1,uds_c2 FROM bikepack_items WHERE user_id=? ORDER BY grupo,name').all(userId) as any[];
  const bags   = db.prepare('SELECT id,name,color,config_idx FROM bikepack_bags WHERE user_id=? ORDER BY config_idx,name').all(userId);
  res.json({
    groups,
    items: items.map(i => ({
      id:           i.id,
      name:         i.name,
      weight_grams: Math.round(i.peso * 1000),
      category:     i.grupo,
      quantity:     i.uds_c1,
      bag_names:    [i.loc_c1, i.loc_c2].filter((b: string) => b?.trim()),
    })),
    bags,
  });
});

// ── Groups ───────────────────────────────────────────────────────────────────
router.get('/groups', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  seedUser(userId);
  res.json(db.prepare('SELECT * FROM bikepack_groups WHERE user_id=? ORDER BY sort_order,name').all(userId));
});

router.post('/groups', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  const { name, color, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO bikepack_groups (user_id,name,color,sort_order) VALUES (?,?,?,?)').run(userId, name, color || '#888780', sort_order ?? 99);
  res.json(db.prepare('SELECT * FROM bikepack_groups WHERE id=?').get(info.lastInsertRowid));
});

router.patch('/groups/:id', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  const id = Number(req.params.id);
  const fields = ['name', 'color', 'sort_order'] as const;
  const updates: string[] = [], vals: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f}=?`); vals.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(id, userId);
  db.prepare(`UPDATE bikepack_groups SET ${updates.join(',')} WHERE id=? AND user_id=?`).run(...vals);
  res.json(db.prepare('SELECT * FROM bikepack_groups WHERE id=?').get(id));
});

router.delete('/groups/:id', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  db.prepare('DELETE FROM bikepack_groups WHERE id=? AND user_id=?').run(Number(req.params.id), userId);
  res.json({ ok: true });
});

// ── Items ────────────────────────────────────────────────────────────────────
router.get('/items', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  seedUser(userId);
  res.json(db.prepare('SELECT * FROM bikepack_items WHERE user_id=? ORDER BY grupo,name').all(userId));
});

router.post('/items', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  const { name, peso, grupo, loc_c1, loc_c2, uds_c1, uds_c2 } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO bikepack_items (user_id,name,peso,grupo,loc_c1,loc_c2,uds_c1,uds_c2) VALUES (?,?,?,?,?,?,?,?)').run(userId, name, peso ?? 0, grupo ?? 'Accesorios', loc_c1 ?? '', loc_c2 ?? '', uds_c1 ?? 0, uds_c2 ?? 0);
  res.json(db.prepare('SELECT * FROM bikepack_items WHERE id=?').get(info.lastInsertRowid));
});

router.patch('/items/:id', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  const id = Number(req.params.id);
  const fields = ['name', 'peso', 'grupo', 'loc_c1', 'loc_c2', 'uds_c1', 'uds_c2'] as const;
  const updates: string[] = [], vals: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f}=?`); vals.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(id, userId);
  db.prepare(`UPDATE bikepack_items SET ${updates.join(',')} WHERE id=? AND user_id=?`).run(...vals);
  res.json(db.prepare('SELECT * FROM bikepack_items WHERE id=?').get(id));
});

router.delete('/items/:id', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  db.prepare('DELETE FROM bikepack_items WHERE id=? AND user_id=?').run(Number(req.params.id), userId);
  res.json({ ok: true });
});

// ── Bags ─────────────────────────────────────────────────────────────────────
router.get('/bags', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  seedUser(userId);
  res.json(db.prepare('SELECT * FROM bikepack_bags WHERE user_id=? ORDER BY config_idx,name').all(userId));
});

router.post('/bags', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  const { config_idx, name, color, has_pos, pos_x, pos_y, pos_w, pos_h } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO bikepack_bags (user_id,config_idx,name,color,has_pos,pos_x,pos_y,pos_w,pos_h) VALUES (?,?,?,?,?,?,?,?,?)').run(userId, config_idx ?? 0, name, color ?? '#888780', has_pos ? 1 : 0, pos_x ?? null, pos_y ?? null, pos_w ?? null, pos_h ?? null);
  res.json(db.prepare('SELECT * FROM bikepack_bags WHERE id=?').get(info.lastInsertRowid));
});

router.patch('/bags/:id', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  const id = Number(req.params.id);
  const fields = ['name', 'color', 'has_pos', 'pos_x', 'pos_y', 'pos_w', 'pos_h'] as const;
  const updates: string[] = [], vals: unknown[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f}=?`); vals.push(f === 'has_pos' ? (req.body[f] ? 1 : 0) : req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(id, userId);
  db.prepare(`UPDATE bikepack_bags SET ${updates.join(',')} WHERE id=? AND user_id=?`).run(...vals);
  res.json(db.prepare('SELECT * FROM bikepack_bags WHERE id=?').get(id));
});

router.delete('/bags/:id', authenticate, (req: Request, res: Response) => {
  const { id: userId } = (req as AuthRequest).user;
  db.prepare('DELETE FROM bikepack_bags WHERE id=? AND user_id=?').run(Number(req.params.id), userId);
  res.json({ ok: true });
});

export default router;
