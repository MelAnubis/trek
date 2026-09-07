import { db, canAccessTrip } from '../db/database';
import { avatarUrl } from './authService';

const BAG_COLORS = ['#6366f1', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#f59e0b'];

export function verifyTripAccess(tripId: string | number, userId: number) {
  return canAccessTrip(tripId, userId);
}

// Finds a trip's packing bag by name, creating it if it doesn't exist yet.
// Returns null for an empty/blank name (item has no bag).
export function resolveOrCreateBagByName(tripId: string | number, bagName: string | null | undefined): number | null {
  const name = bagName?.trim();
  if (!name) return null;
  const existing = db.prepare('SELECT id FROM packing_bags WHERE trip_id = ? AND name = ?').get(tripId, name) as { id: number } | undefined;
  if (existing) return existing.id;
  const bagCount = (db.prepare('SELECT COUNT(*) as c FROM packing_bags WHERE trip_id = ?').get(tripId) as { c: number }).c;
  const newBag = db.prepare('INSERT INTO packing_bags (trip_id, name, color) VALUES (?, ?, ?)').run(tripId, name, BAG_COLORS[bagCount % BAG_COLORS.length]);
  return Number(newBag.lastInsertRowid);
}

// ── Items ──────────────────────────────────────────────────────────────────

// Seeded when a new category is created (see PackingListPanel.tsx) — a
// throwaway placeholder, not real gear, so it shouldn't create Bikepack clutter.
const PACKING_PLACEHOLDER_NAME = '...';

// Creates the Bikepack master-profile counterpart for a freshly-added trip
// item, so future edits on either side sync automatically (see
// bikepackSyncService.ts). Returns null when linking isn't appropriate.
function createLinkedBikepackItem(userId: number, data: { name: string; category?: string | null; weight_grams?: number | null; quantity?: number; bagName?: string | null }): number | null {
  if (!data.name || data.name.trim() === PACKING_PLACEHOLDER_NAME) return null;
  const peso = data.weight_grams != null ? data.weight_grams / 1000 : 0;
  const qty = data.quantity && data.quantity > 0 ? data.quantity : 1;
  const result = db.prepare('INSERT INTO bikepack_items (user_id, name, peso, grupo, loc_c1, uds_c1) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, data.name.trim(), peso, data.category?.trim() || 'Accesorios', data.bagName?.trim() || '', qty);
  return Number(result.lastInsertRowid);
}

export function listItems(tripId: string | number) {
  return db.prepare(
    'SELECT * FROM packing_items WHERE trip_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(tripId);
}

export function createItem(tripId: string | number, userId: number, data: { name: string; category?: string; checked?: boolean; quantity?: number }) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  const sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;
  const qty = Math.max(1, Math.min(999, Number(data.quantity) || 1));

  const result = db.prepare(
    'INSERT INTO packing_items (trip_id, name, checked, category, sort_order, quantity) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(tripId, data.name, data.checked ? 1 : 0, data.category || 'Allgemein', sortOrder, qty);

  const bikepackItemId = createLinkedBikepackItem(userId, { name: data.name, category: data.category, quantity: qty });
  if (bikepackItemId) {
    db.prepare('UPDATE packing_items SET bikepack_item_id = ? WHERE id = ?').run(bikepackItemId, result.lastInsertRowid);
  }

  return db.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid);
}

export function updateItem(
  tripId: string | number,
  id: string | number,
  data: { name?: string; checked?: number; category?: string; weight_grams?: number | null; bag_id?: number | null; quantity?: number },
  bodyKeys: string[]
) {
  const item = db.prepare('SELECT * FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return null;

  db.prepare(`
    UPDATE packing_items SET
      name = COALESCE(?, name),
      checked = CASE WHEN ? IS NOT NULL THEN ? ELSE checked END,
      category = COALESCE(?, category),
      weight_grams = CASE WHEN ? THEN ? ELSE weight_grams END,
      bag_id = CASE WHEN ? THEN ? ELSE bag_id END,
      quantity = CASE WHEN ? THEN ? ELSE quantity END
    WHERE id = ?
  `).run(
    data.name || null,
    data.checked !== undefined ? 1 : null,
    data.checked ? 1 : 0,
    data.category || null,
    bodyKeys.includes('weight_grams') ? 1 : 0,
    data.weight_grams ?? null,
    bodyKeys.includes('bag_id') ? 1 : 0,
    data.bag_id ?? null,
    bodyKeys.includes('quantity') ? 1 : 0,
    data.quantity ? Math.max(1, Math.min(999, Number(data.quantity))) : 1,
    id
  );

  return db.prepare('SELECT * FROM packing_items WHERE id = ?').get(id);
}

export function deleteItem(tripId: string | number, id: string | number) {
  const item = db.prepare('SELECT id FROM packing_items WHERE id = ? AND trip_id = ?').get(id, tripId);
  if (!item) return false;

  db.prepare('DELETE FROM packing_items WHERE id = ?').run(id);
  return true;
}

// ── Bulk Import ────────────────────────────────────────────────────────────

interface ImportItem {
  name?: string;
  checked?: boolean;
  category?: string;
  weight_grams?: string | number;
  bag?: string;
  quantity?: number;
  bikepack_item_id?: number;
}

export function bulkImport(tripId: string | number, userId: number, items: ImportItem[]) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  let sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const stmt = db.prepare('INSERT INTO packing_items (trip_id, name, checked, category, weight_grams, bag_id, sort_order, quantity, bikepack_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const created: any[] = [];

  const insertAll = db.transaction(() => {
    for (const item of items) {
      if (!item.name?.trim()) continue;
      const checked = item.checked ? 1 : 0;
      const weight = item.weight_grams != null ? parseInt(String(item.weight_grams)) : null;
      const bagId = resolveOrCreateBagByName(tripId, item.bag);
      const qty = item.quantity && item.quantity > 0 ? parseInt(String(item.quantity)) : 1;
      const category = item.category?.trim() || 'Other';

      // Items that already carry a bikepack_item_id came from "Importar
      // desde Bikepack" and are already linked. Everything else (manual
      // add, CSV import) gets a brand-new Bikepack counterpart created and
      // linked, so it also shows up in — and stays in sync with — the
      // user's own master gear list.
      const bikepackItemId = item.bikepack_item_id ?? createLinkedBikepackItem(userId, { name: item.name, category, weight_grams: weight, quantity: qty, bagName: item.bag });

      const result = stmt.run(tripId, item.name.trim(), checked, category, weight, bagId, sortOrder++, qty, bikepackItemId ?? null);
      created.push(db.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid));
    }
  });

  insertAll();
  return created;
}

// ── Bags ───────────────────────────────────────────────────────────────────

export function listBags(tripId: string | number) {
  const bags = db.prepare('SELECT * FROM packing_bags WHERE trip_id = ? ORDER BY sort_order, id').all(tripId) as any[];
  const members = db.prepare(`
    SELECT bm.bag_id, bm.user_id, u.username, u.avatar
    FROM packing_bag_members bm
    JOIN users u ON bm.user_id = u.id
    JOIN packing_bags b ON bm.bag_id = b.id
    WHERE b.trip_id = ?
  `).all(tripId) as { bag_id: number; user_id: number; username: string; avatar: string | null }[];
  const membersByBag = new Map<number, typeof members>();
  for (const m of members) {
    if (!membersByBag.has(m.bag_id)) membersByBag.set(m.bag_id, []);
    membersByBag.get(m.bag_id)!.push(m);
  }
  return bags.map(b => ({
    ...b,
    members: (membersByBag.get(b.id) || []).map(m => ({ ...m, avatar: avatarUrl(m) })),
  }));
}

export function setBagMembers(tripId: string | number, bagId: string | number, userIds: number[]) {
  const bag = db.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return null;
  db.prepare('DELETE FROM packing_bag_members WHERE bag_id = ?').run(bagId);
  const ins = db.prepare('INSERT OR IGNORE INTO packing_bag_members (bag_id, user_id) VALUES (?, ?)');
  for (const uid of userIds) ins.run(bagId, uid);
  const rows = db.prepare(`
    SELECT bm.user_id, u.username, u.avatar
    FROM packing_bag_members bm JOIN users u ON bm.user_id = u.id
    WHERE bm.bag_id = ?
  `).all(bagId) as { user_id: number; username: string; avatar: string | null }[];
  return rows.map(m => ({ ...m, avatar: avatarUrl(m) }));
}

export function createBag(tripId: string | number, data: { name: string; color?: string }) {
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_bags WHERE trip_id = ?').get(tripId) as { max: number | null };
  const result = db.prepare('INSERT INTO packing_bags (trip_id, name, color, sort_order) VALUES (?, ?, ?, ?)').run(
    tripId, data.name.trim(), data.color || '#6366f1', (maxOrder.max ?? -1) + 1
  );
  return db.prepare('SELECT * FROM packing_bags WHERE id = ?').get(result.lastInsertRowid);
}

export function updateBag(
  tripId: string | number,
  bagId: string | number,
  data: { name?: string; color?: string; weight_limit_grams?: number | null; user_id?: number | null },
  bodyKeys?: string[]
) {
  const bag = db.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return null;

  db.prepare(`UPDATE packing_bags SET
    name = COALESCE(?, name),
    color = COALESCE(?, color),
    weight_limit_grams = ?,
    user_id = CASE WHEN ? THEN ? ELSE user_id END
    WHERE id = ?`).run(
    data.name?.trim() || null,
    data.color || null,
    data.weight_limit_grams ?? (bag as any).weight_limit_grams ?? null,
    bodyKeys?.includes('user_id') ? 1 : 0,
    data.user_id ?? null,
    bagId
  );
  return db.prepare('SELECT b.*, u.username as assigned_username FROM packing_bags b LEFT JOIN users u ON b.user_id = u.id WHERE b.id = ?').get(bagId);
}

export function deleteBag(tripId: string | number, bagId: string | number) {
  const bag = db.prepare('SELECT * FROM packing_bags WHERE id = ? AND trip_id = ?').get(bagId, tripId);
  if (!bag) return false;

  db.prepare('DELETE FROM packing_bags WHERE id = ?').run(bagId);
  return true;
}

// ── Apply Template ─────────────────────────────────────────────────────────

export function applyTemplate(tripId: string | number, templateId: string | number) {
  const templateItems = db.prepare(`
    SELECT ti.name, tc.name as category
    FROM packing_template_items ti
    JOIN packing_template_categories tc ON ti.category_id = tc.id
    WHERE tc.template_id = ?
    ORDER BY tc.sort_order, ti.sort_order
  `).all(templateId) as { name: string; category: string }[];

  if (templateItems.length === 0) return null;

  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM packing_items WHERE trip_id = ?').get(tripId) as { max: number | null };
  let sortOrder = (maxOrder.max !== null ? maxOrder.max : -1) + 1;

  const insert = db.prepare('INSERT INTO packing_items (trip_id, name, checked, category, sort_order) VALUES (?, ?, 0, ?, ?)');
  const added: any[] = [];
  for (const ti of templateItems) {
    const result = insert.run(tripId, ti.name, ti.category, sortOrder++);
    const item = db.prepare('SELECT * FROM packing_items WHERE id = ?').get(result.lastInsertRowid);
    added.push(item);
  }

  return added;
}

// ── Save as Template ──────────────────────────────────────────────────────

export function saveAsTemplate(tripId: string | number, userId: number, templateName: string) {
  const items = db.prepare(
    'SELECT name, category FROM packing_items WHERE trip_id = ? ORDER BY sort_order ASC'
  ).all(tripId) as { name: string; category: string }[];

  if (items.length === 0) return null;

  const result = db.prepare('INSERT INTO packing_templates (name, created_by) VALUES (?, ?)').run(templateName, userId);
  const templateId = result.lastInsertRowid;

  const categories = [...new Set(items.map(i => i.category || 'Other'))];
  const catIdMap = new Map<string, number | bigint>();

  for (let i = 0; i < categories.length; i++) {
    const catResult = db.prepare('INSERT INTO packing_template_categories (template_id, name, sort_order) VALUES (?, ?, ?)').run(templateId, categories[i], i);
    catIdMap.set(categories[i], catResult.lastInsertRowid);
  }

  const itemsByCategory = new Map<string, number>();
  for (const item of items) {
    const catId = catIdMap.get(item.category || 'Other')!;
    const order = itemsByCategory.get(item.category || 'Other') || 0;
    db.prepare('INSERT INTO packing_template_items (category_id, name, sort_order) VALUES (?, ?, ?)').run(catId, item.name, order);
    itemsByCategory.set(item.category || 'Other', order + 1);
  }

  return { id: Number(templateId), name: templateName, categoryCount: categories.length, itemCount: items.length };
}

// ── Category Assignees ─────────────────────────────────────────────────────

export function getCategoryAssignees(tripId: string | number) {
  const rows = db.prepare(`
    SELECT pca.category_name, pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ?
  `).all(tripId);

  // Group by category
  const assignees: Record<string, { user_id: number; username: string; avatar: string | null }[]> = {};
  for (const row of rows as any[]) {
    if (!assignees[row.category_name]) assignees[row.category_name] = [];
    assignees[row.category_name].push({ user_id: row.user_id, username: row.username, avatar: avatarUrl(row) });
  }

  return assignees;
}

export function updateCategoryAssignees(tripId: string | number, categoryName: string, userIds: number[] | undefined) {
  db.prepare('DELETE FROM packing_category_assignees WHERE trip_id = ? AND category_name = ?').run(tripId, categoryName);

  if (Array.isArray(userIds) && userIds.length > 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO packing_category_assignees (trip_id, category_name, user_id) VALUES (?, ?, ?)');
    for (const uid of userIds) insert.run(tripId, categoryName, uid);
  }

  const updated = db.prepare(`
    SELECT pca.user_id, u.username, u.avatar
    FROM packing_category_assignees pca
    JOIN users u ON pca.user_id = u.id
    WHERE pca.trip_id = ? AND pca.category_name = ?
  `).all(tripId, categoryName) as { user_id: number; username: string; avatar: string | null }[];
  return updated.map(m => ({ ...m, avatar: avatarUrl(m) }));
}

// ── Reorder ────────────────────────────────────────────────────────────────

export function reorderItems(tripId: string | number, orderedIds: number[]) {
  const update = db.prepare('UPDATE packing_items SET sort_order = ? WHERE id = ? AND trip_id = ?');
  const updateMany = db.transaction((ids: number[]) => {
    ids.forEach((id, index) => {
      update.run(index, id, tripId);
    });
  });
  updateMany(orderedIds);
}
