const Database = require('better-sqlite3'), fs = require('fs'), path = require('path');
function buka(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')); require('./rbac').seed(db);
  return db;
}
module.exports = { buka };
