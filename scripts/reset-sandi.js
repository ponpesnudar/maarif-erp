// npm run reset-sandi -- <username>   -> sandi sementara acak (tampil sekali), wajib ganti saat login. Untuk admin yang lupa sandi.
const path = require('path'), crypto = require('crypto'), { buka } = require('../src/db'), A = require('../src/auth');
function resetSandi(db, username) {
  const u = db.prepare('SELECT id, username FROM users WHERE username=?').get(String(username || '')); if (!u) throw new Error('Username tidak ditemukan: ' + username);
  const temp = Array.from(crypto.randomBytes(10), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  db.prepare('UPDATE users SET password_hash=?, wajib_ganti=1, aktif=1 WHERE id=?').run(A.hash(temp), u.id); db.prepare('DELETE FROM sesi WHERE username=?').run(u.username); db.prepare('DELETE FROM percobaan_login WHERE kunci=?').run('u_' + u.username.toLowerCase());
  A.audit(db, 'cli', 'reset_sandi', u.username, 'lewat reset-sandi.js'); return temp;
}
module.exports = { resetSandi };
if (require.main === module) {
  try { const t = resetSandi(buka(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maarif.db')), process.argv[2]); console.log(`Sandi sementara untuk ${process.argv[2]}: ${t}\nLogin lalu ganti sandi. Tidak ditampilkan lagi.`); } catch (e) { console.error(e.message); process.exit(1); }
}
