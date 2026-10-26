// Sandi/PIN di-hash dengan scrypt (bawaan Node), sesi disimpan di database dalam bentuk hash, login dibatasi.
const crypto = require('crypto');
class Galat extends Error {}            // pesan yang boleh dilihat pengguna
const ADMIN = 'ujian.kelola', VERIF = 'ujian.verifikasi', STAFF = 'ujian.akses';   // izin, bukan nama role
const BATAS_GAGAL = 5, KUNCI_MS = 15 * 60e3, SESI_MS = 8 * 3600e3;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return 'scrypt$' + s + '$' + crypto.scryptSync(String(pw), s, 32).toString('hex'); };
const cocok = (h, pw) => {
  const [t, s, x] = String(h).split('$'); if (t !== 'scrypt' || !pw) return false;
  const a = Buffer.from(x, 'hex'), b = crypto.scryptSync(String(pw), s, 32); return a.length === b.length && crypto.timingSafeEqual(a, b);
};
function kebijakan(baru, user, wali) {
  const b = String(baru || '');
  if (wali) return /^\d{6,8}$/.test(b) ? '' : 'PIN harus 6 sampai 8 angka.';
  if (b.length < 8) return 'Kata sandi minimal 8 karakter.';
  if (b.toLowerCase() === String(user).toLowerCase()) return 'Kata sandi tidak boleh sama dengan username.';
  if (['12345678', '123456789', 'password', 'password1', 'qwertyui'].includes(b.toLowerCase()) || /^(.)\1+$/.test(b)) return 'Kata sandi terlalu mudah ditebak.';
  return '';
}
const kunciAktif = (db, k) => { const r = db.prepare('SELECT * FROM percobaan_login WHERE kunci=?').get(k); return !!r && r.gagal >= BATAS_GAGAL && Date.now() - r.mulai < KUNCI_MS; };
function gagal(db, k) {
  const r = db.prepare('SELECT * FROM percobaan_login WHERE kunci=?').get(k), n = Date.now();
  if (r && n - r.mulai < KUNCI_MS) db.prepare('UPDATE percobaan_login SET gagal=gagal+1 WHERE kunci=?').run(k);
  else db.prepare('INSERT INTO percobaan_login(kunci,gagal,mulai) VALUES(?,1,?) ON CONFLICT(kunci) DO UPDATE SET gagal=1, mulai=excluded.mulai').run(k, n);
}
const lulus = (db, k) => db.prepare('DELETE FROM percobaan_login WHERE kunci=?').run(k);
function buatSesi(db, d) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesi(token_hash,username,nis,nama,role,kedaluwarsa,terbatas) VALUES(?,?,?,?,?,?,?)').run(sha(token), d.username || null, d.nis || null, d.nama, d.role, Date.now() + SESI_MS, d.terbatas ? 1 : 0);
  db.prepare('DELETE FROM sesi WHERE kedaluwarsa<?').run(Date.now());
  return token;
}
function izinDari(db, roles) {   // dihitung ulang tiap permintaan, jadi perubahan role langsung berlaku tanpa login ulang
  if (roles.includes('Wali')) return new Set(['portal.wali']);
  const s = new Set(); if (roles.includes('Admin')) db.prepare('SELECT kode FROM permission').all().forEach(r => s.add(r.kode));
  if (roles.length) db.prepare(`SELECT DISTINCT permission_kode k FROM role_permission WHERE role_kode IN (${roles.map(() => '?').join(',')})`).all(...roles).forEach(r => s.add(r.k));
  return s;
}
function ambilSesi(db, token) {
  const r = token ? db.prepare('SELECT * FROM sesi WHERE token_hash=? AND kedaluwarsa>?').get(sha(String(token)), Date.now()) : null;
  if (!r) throw new Galat('Sesi habis, silakan login lagi.');
  if (r.username) { const u = db.prepare('SELECT aktif FROM users WHERE username=?').get(r.username); if (!u || !u.aktif) throw new Galat('Sesi habis, silakan login lagi.'); }
  const roles = r.role.split(',').map(x => x.trim()).filter(Boolean);
  return { username: r.username, nis: r.nis, nama: r.nama, role: r.role, terbatas: !!r.terbatas, roles, izin: izinDari(db, roles) };
}
const punya = (s, izin) => s.izin.has(izin);
const peran = (s, izin) => { if (!s.izin.has(izin)) throw new Galat('Peran Anda tidak diizinkan.'); };
function audit(db, pelaku, aksi, objek, detail) {
  db.prepare('INSERT INTO audit(waktu,pelaku,aksi,objek,detail) VALUES(?,?,?,?,?)').run(new Date().toISOString(), pelaku || null, aksi, objek || null, detail ? String(detail).slice(0, 300) : null);
}
module.exports = { Galat, ADMIN, VERIF, STAFF, hash, cocok, kebijakan, kunciAktif, gagal, lulus, buatSesi, ambilSesi, punya, peran, audit };
