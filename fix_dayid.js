const Database = require('better-sqlite3');
const db = new Database('/app/data/trek.db');
try {
  db.exec('ALTER TABLE gpx_tracks ADD COLUMN day_id INTEGER REFERENCES days(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gpx_tracks_day_id ON gpx_tracks(day_id)');
  console.log('OK: day_id column added');
} catch(e) {
  console.log('Result:', e.message);
}
