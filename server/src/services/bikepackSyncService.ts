import { db } from '../db/database';
import { broadcast } from '../websocket';
import { resolveOrCreateBagByName } from './packingService';

// Bidirectional sync between a trip's packing_items (imported from Bikepack)
// and the user's master bikepack_items profile. Only the "definition" fields
// (name, category, weight, quantity, bag) are kept in sync — `checked` stays
// trip-local, and deleting either side only unlinks the other (see the
// ON DELETE SET NULL on packing_items.bikepack_item_id for that direction).

interface SyncablePackingItem {
  bikepack_item_id: number | null;
  name: string;
  category: string | null;
  weight_grams: number | null;
  quantity: number;
  bag_id: number | null;
}

// Push a trip packing_item's current definition to its linked bikepack_items row.
export function pushPackingItemToBikepack(item: SyncablePackingItem) {
  if (!item.bikepack_item_id) return;

  let bagName = '';
  if (item.bag_id) {
    const bag = db.prepare('SELECT name FROM packing_bags WHERE id = ?').get(item.bag_id) as { name: string } | undefined;
    bagName = bag?.name || '';
  }
  const peso = item.weight_grams != null ? item.weight_grams / 1000 : 0;

  db.prepare('UPDATE bikepack_items SET name = ?, grupo = ?, peso = ?, uds_c1 = ?, loc_c1 = ? WHERE id = ?')
    .run(item.name, item.category || 'Accesorios', peso, item.quantity || 1, bagName, item.bikepack_item_id);
}

// Push a bikepack_items row's current definition to every packing_item (in
// any trip) linked to it. Uses config 0 (uds_c1/loc_c1) — the same config
// the "import to trip" flow reads from.
export function pushBikepackItemToTrips(bikepackItemId: number | string) {
  const src = db.prepare('SELECT name, peso, grupo, loc_c1, uds_c1 FROM bikepack_items WHERE id = ?').get(bikepackItemId) as
    { name: string; peso: number; grupo: string; loc_c1: string; uds_c1: number } | undefined;
  if (!src) return;

  const linked = db.prepare('SELECT id, trip_id FROM packing_items WHERE bikepack_item_id = ?').all(bikepackItemId) as { id: number; trip_id: number }[];
  if (linked.length === 0) return;

  const weightGrams = Math.round(src.peso * 1000);
  const update = db.prepare('UPDATE packing_items SET name = ?, category = ?, weight_grams = ?, quantity = ?, bag_id = ? WHERE id = ?');

  const touchedTripIds = new Set<number>();
  for (const row of linked) {
    const bagId = resolveOrCreateBagByName(row.trip_id, src.loc_c1);
    update.run(src.name, src.grupo, weightGrams, src.uds_c1 || 1, bagId, row.id);
    touchedTripIds.add(row.trip_id);
  }

  for (const tripId of touchedTripIds) {
    const items = db.prepare('SELECT * FROM packing_items WHERE trip_id = ? AND bikepack_item_id = ?').all(tripId, bikepackItemId);
    for (const item of items) broadcast(tripId, 'packing:updated', { item });
  }
}
