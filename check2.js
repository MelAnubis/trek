const Database = require('better-sqlite3');
const db = new Database('/app/data/trek.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', JSON.stringify(tables));
