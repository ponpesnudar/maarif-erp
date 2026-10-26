// npm run restore -- <berkas cadangan>   (HENTIKAN server dulu). Database sekarang disimpan sebagai .sebelum-restore.
const fs = require('fs'), path = require('path'), Database = require('better-sqlite3');
function pulihkan(sumber, target) {
  const d = new Database(sumber, { readonly: true }); const hasil = d.pragma('integrity_check', { simple: true }); d.close();
  if (hasil !== 'ok') throw new Error('Berkas cadangan rusak: ' + hasil);
  if (fs.existsSync(target)) fs.copyFileSync(target, target + '.sebelum-restore-' + Date.now());
  ['-wal', '-shm'].forEach(x => fs.rmSync(target + x, { force: true })); fs.copyFileSync(sumber, target); return target;
}
module.exports = { pulihkan };
if (require.main === module) {
  const s = process.argv[2]; if (!s) { console.log('Pakai: npm run restore -- <berkas cadangan>'); process.exit(1); }
  console.log('Dipulihkan ke', pulihkan(s, process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maarif.db')));
}
