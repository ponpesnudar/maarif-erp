// Cadangan database yang aman walau server sedang berjalan (SQLite online backup).
const fs = require('fs'), path = require('path');
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace(' ', '_').replace(/:/g, '') + '-' + String(Date.now() % 1000).padStart(3, '0');
function daftar(folder) {
  return fs.existsSync(folder) ? fs.readdirSync(folder).filter(f => /^maarif-.*\.db$/.test(f)).map(f => ({ nama: f, ukuran: fs.statSync(path.join(folder, f)).size })).sort((a, b) => a.nama < b.nama ? 1 : -1) : [];
}
async function cadangkan(db, folder, simpan) {
  fs.mkdirSync(folder, { recursive: true }); const nama = 'maarif-' + stamp() + '.db';
  await db.backup(path.join(folder, nama)); daftar(folder).slice(simpan).forEach(f => fs.unlinkSync(path.join(folder, f.nama))); return nama;
}
function perluBackup(sekarang, folder, jam) {   // sekali sehari, setelah jam yang ditentukan (WIB)
  const [tgl, jm] = sekarang.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).split(' '), last = daftar(folder)[0];
  return Number(jm.slice(0, 2)) >= jam && (!last || last.nama.slice(7, 17) !== tgl);
}
module.exports = { cadangkan, daftar, perluBackup };
