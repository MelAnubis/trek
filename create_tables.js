const Database = require('better-sqlite3');
const db = new Database('/app/data/trek.db');
db.exec("CREATE TABLE IF NOT EXISTS gpx_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, track_name TEXT NOT NULL, orig_name TEXT, total_distance REAL DEFAULT 0, total_elevation_gain REAL DEFAULT 0, total_elevation_loss REAL DEFAULT 0, max_elevation REAL, min_elevation REAL, duration_seconds INTEGER, point_count INTEGER DEFAULT 0, start_lat REAL, start_lng REAL, end_lat REAL, end_lng REAL, points_json TEXT DEFAULT '[]', waypoints_json TEXT DEFAULT '[]', ibp INTEGER, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, day_id INTEGER REFERENCES days(id) ON DELETE SET NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
db.exec("CREATE INDEX IF NOT EXISTS idx_gpx_tracks_trip_id ON gpx_tracks(trip_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_gpx_tracks_day_id ON gpx_tracks(day_id)");
try { db.exec("ALTER TABLE trips ADD COLUMN trip_type TEXT DEFAULT 'general'"); } catch(e) {}
console.log('OK');
