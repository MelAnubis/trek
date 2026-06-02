#!/usr/bin/env node
/**
 * Migrates one user's Bikepack data from the standalone Bikepack SQLite DB
 * into Trek's integrated bikepack tables.
 *
 * Usage:
 *   node migrate-bikepack.js <bikepack-db-path> <trek-db-path> <email>
 *
 * Example:
 *   node migrate-bikepack.js /data/bikepack.db /data/trek.db ortizjm@outlook.es
 */

const Database = require('better-sqlite3');
const path = require('path');

const [,, bikepackDbPath, trekDbPath, email] = process.argv;

if (!bikepackDbPath || !trekDbPath || !email) {
  console.error('Usage: node migrate-bikepack.js <bikepack-db-path> <trek-db-path> <email>');
  process.exit(1);
}

const bp  = new Database(bikepackDbPath, { readonly: true });
const trk = new Database(trekDbPath);

// ── 1. Inspect Bikepack schema ───────────────────────────────────────────────
console.log('\n=== Bikepack tables ===');
const bpTables = bp.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
bpTables.forEach(t => {
  const cols = bp.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`  ${t.name}: ${cols.map(c => c.name).join(', ')}`);
});

// ── 2. Find user in Bikepack ─────────────────────────────────────────────────
// Try common column names for email
let bpUser = null;
const bpUserTables = ['users', 'user'];
for (const tbl of bpUserTables) {
  try {
    bpUser = bp.prepare(`SELECT * FROM ${tbl} WHERE LOWER(email)=LOWER(?) LIMIT 1`).get(email);
    if (bpUser) { console.log(`\nFound Bikepack user in table '${tbl}':`, bpUser); break; }
  } catch { /* table doesn't exist */ }
}
if (!bpUser) {
  console.error(`\nNo user found in Bikepack DB with email: ${email}`);
  process.exit(1);
}
const bpUserId = bpUser.id;

// ── 3. Find user in Trek ─────────────────────────────────────────────────────
const trkUser = trk.prepare('SELECT * FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1').get(email);
if (!trkUser) {
  console.error(`\nNo user found in Trek DB with email: ${email}`);
  process.exit(1);
}
const trkUserId = trkUser.id;
console.log(`\nTrek user id: ${trkUserId}`);

// ── 4. Read Bikepack data ────────────────────────────────────────────────────
// Try to detect table/column names dynamically
function readTable(db, possibleNames, userIdCol, userId) {
  for (const name of possibleNames) {
    try {
      const rows = db.prepare(`SELECT * FROM ${name} WHERE ${userIdCol}=?`).all(userId);
      console.log(`  → '${name}' (${userIdCol}=${userId}): ${rows.length} rows`);
      return { table: name, rows };
    } catch { /* skip */ }
  }
  return { table: null, rows: [] };
}

console.log('\n=== Reading Bikepack data ===');
const { rows: bpGroups } = readTable(bp, ['groups','bikepack_groups'], 'user_id', bpUserId);
const { rows: bpItems  } = readTable(bp, ['items','bikepack_items'],   'user_id', bpUserId);
const { rows: bpBags   } = readTable(bp, ['bags','bikepack_bags'],     'user_id', bpUserId);

console.log(`  Groups: ${bpGroups.length}, Items: ${bpItems.length}, Bags: ${bpBags.length}`);

if (!bpGroups.length && !bpItems.length && !bpBags.length) {
  console.log('\nNothing to migrate. Exiting.');
  process.exit(0);
}

// ── 5. Clear existing Trek bikepack data for this user ───────────────────────
console.log('\n=== Clearing existing Trek bikepack data for user ===');
trk.transaction(() => {
  const dg = trk.prepare('DELETE FROM bikepack_groups WHERE user_id=?').run(trkUserId);
  const di = trk.prepare('DELETE FROM bikepack_items  WHERE user_id=?').run(trkUserId);
  const db2 = trk.prepare('DELETE FROM bikepack_bags  WHERE user_id=?').run(trkUserId);
  console.log(`  Deleted ${dg.changes} groups, ${di.changes} items, ${db2.changes} bags`);
})();

// ── 6. Insert data ───────────────────────────────────────────────────────────
console.log('\n=== Inserting into Trek ===');

trk.transaction(() => {
  // Groups
  const insG = trk.prepare(
    'INSERT INTO bikepack_groups (user_id,name,color,sort_order) VALUES (?,?,?,?)'
  );
  for (const g of bpGroups) {
    insG.run(trkUserId, g.name, g.color ?? '#888780', g.sort_order ?? 99);
  }
  console.log(`  Inserted ${bpGroups.length} groups`);

  // Bags
  const insB = trk.prepare(
    'INSERT INTO bikepack_bags (user_id,config_idx,name,color,has_pos,pos_x,pos_y,pos_w,pos_h) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  for (const b of bpBags) {
    insB.run(
      trkUserId,
      b.config_idx ?? 0,
      b.name,
      b.color ?? '#888780',
      b.has_pos ? 1 : 0,
      b.pos_x ?? null, b.pos_y ?? null, b.pos_w ?? null, b.pos_h ?? null
    );
  }
  console.log(`  Inserted ${bpBags.length} bags`);

  // Items
  const insI = trk.prepare(
    'INSERT INTO bikepack_items (user_id,name,peso,grupo,loc_c1,loc_c2,uds_c1,uds_c2) VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const i of bpItems) {
    insI.run(
      trkUserId,
      i.name,
      i.peso ?? i.weight ?? 0,
      i.grupo ?? i.category ?? i.group ?? 'Accesorios',
      i.loc_c1 ?? i.bag1 ?? i.location1 ?? '',
      i.loc_c2 ?? i.bag2 ?? i.location2 ?? '',
      i.uds_c1 ?? i.qty1 ?? i.quantity1 ?? 0,
      i.uds_c2 ?? i.qty2 ?? i.quantity2 ?? 0
    );
  }
  console.log(`  Inserted ${bpItems.length} items`);
})();

bp.close();
trk.close();

console.log('\n✓ Migration complete!');
