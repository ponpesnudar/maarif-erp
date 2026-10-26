// npm run backup   -> membuat cadangan sekarang (aman walau server menyala)
const path = require('path'), { buka } = require('../src/db'), { cadangkan } = require('../src/backup'), { config } = require('../src/config');
const db = buka(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maarif.db')), c = config();
cadangkan(db, c.backup.folder, c.backup.simpan).then(n => console.log('Cadangan dibuat:', path.join(c.backup.folder, n))).catch(e => { console.error('Gagal:', e.message); process.exit(1); });
