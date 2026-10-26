// Modul Administrator: pengguna, role dan izin, jejak audit, kesehatan sistem.
const crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os');
const A = require('./auth'), { Galat } = A, BK = require('./backup'), WA = require('./wa'), M = require('./metrics'), { config } = require('./config');
const acak = (n, abjad) => Array.from(crypto.randomBytes(n), b => abjad[b % abjad.length]).join('');
const H = {};
const adaAdminLain = (db, kecualiId) => db.prepare("SELECT COUNT(*) n FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='Admin' AND u.aktif=1 AND u.id<>?").get(kecualiId || 0).n > 0;

H.admUsers = (c, f) => {
  A.peran(c.s, 'administrator.user.lihat'); f = f || {};
  const q = '%' + String(f.cari || '').toLowerCase() + '%';
  return c.db.prepare(`SELECT u.id, u.username, u.nama, u.aktif, u.wajib_ganti wajibGanti, (SELECT MAX(waktu) FROM audit a WHERE a.pelaku=u.username AND a.aksi='login') loginTerakhir
    FROM users u WHERE (lower(u.nama) LIKE ? OR lower(u.username) LIKE ?) AND (?=0 OR u.aktif=1) ORDER BY u.nama`).all(q, q, f.aktifSaja ? 1 : 0)
    .map(u => ({ ...u, roles: c.db.prepare('SELECT role FROM user_roles WHERE user_id=? ORDER BY role').all(u.id).map(r => r.role) }));
};
H.admSimpanUser = (c, d) => {
  A.peran(c.s, 'administrator.user.kelola'); d = d || {}; const roles = [...new Set((d.roles || []).map(String))], db = c.db;
  if (!String(d.nama || '').trim()) throw new Galat('Nama wajib diisi.');
  roles.forEach(r => { if (!db.prepare('SELECT 1 FROM role WHERE kode=?').get(r)) throw new Galat('Role tidak dikenal: ' + r); });
  let temp = null, uid = d.id;
  db.transaction(() => {
    if (!uid) {
      const un = String(d.username || '').trim(); if (!/^[a-z0-9_.-]{3,30}$/i.test(un)) throw new Galat('Username 3 sampai 30 karakter: huruf, angka, titik, strip, garis bawah.');
      if (db.prepare('SELECT 1 FROM users WHERE username=?').get(un)) throw new Galat('Username sudah dipakai.');
      temp = acak(10, 'abcdefghjkmnpqrstuvwxyz23456789'); uid = db.prepare('INSERT INTO users(username,password_hash,nama,aktif,wajib_ganti) VALUES(?,?,?,?,1)').run(un, A.hash(temp), d.nama.trim(), d.aktif === false ? 0 : 1).lastInsertRowid;
      A.audit(db, c.s.username, 'user_baru', un, roles.join(','));
    } else {
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid); if (!u) throw new Galat('Pengguna tidak ditemukan.');
      const aktif = d.aktif === false ? 0 : 1, adaAdmin = roles.includes('Admin') && aktif;
      if (!adaAdmin && !adaAdminLain(db, uid) && db.prepare("SELECT 1 FROM user_roles WHERE user_id=? AND role='Admin'").get(uid)) throw new Galat('Minimal harus ada satu Administrator aktif.');
      if (u.id && c.s.username === u.username && !aktif) throw new Galat('Anda tidak bisa menonaktifkan akun sendiri.');
      db.prepare('UPDATE users SET nama=?, aktif=? WHERE id=?').run(d.nama.trim(), aktif, uid);
      A.audit(db, c.s.username, 'user_ubah', u.username, `aktif=${aktif} roles=${roles.join(',')}`);
      if (!aktif) db.prepare('DELETE FROM sesi WHERE username=?').run(u.username);
    }
    db.prepare('DELETE FROM user_roles WHERE user_id=?').run(uid); roles.forEach(r => db.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').run(uid, r));
  })();
  return { id: Number(uid), temp };
};
H.admRoles = c => {
  A.peran(c.s, 'administrator.role.lihat');
  return { total: c.db.prepare('SELECT COUNT(*) n FROM permission').get().n, role: c.db.prepare(`SELECT r.kode, r.nama, r.keterangan, r.bawaan, (SELECT COUNT(*) FROM role_permission p WHERE p.role_kode=r.kode) izin,
    (SELECT COUNT(*) FROM user_roles ur WHERE ur.role=r.kode) pengguna FROM role r ORDER BY r.bawaan DESC, r.nama`).all() };
};
H.admRole = (c, kode) => {
  A.peran(c.s, 'administrator.role.lihat'); const r = c.db.prepare('SELECT * FROM role WHERE kode=?').get(kode); if (!r) throw new Galat('Role tidak ditemukan.');
  return { role: r, izin: c.db.prepare('SELECT permission_kode k FROM role_permission WHERE role_kode=?').all(kode).map(x => x.k),
    katalog: c.db.prepare('SELECT kode, modul, sumber, aksi, label, sensitif FROM permission ORDER BY modul, sumber, kode').all() };
};
H.admSimpanRole = (c, d) => {
  A.peran(c.s, 'administrator.role.kelola'); d = d || {}; const db = c.db, kode = String(d.kode || '').trim();
  if (!String(d.nama || '').trim()) throw new Galat('Nama role wajib diisi.');
  const izin = [...new Set(d.izin || [])]; izin.forEach(i => { if (!db.prepare('SELECT 1 FROM permission WHERE kode=?').get(i)) throw new Galat('Izin tidak dikenal: ' + i); });
  const ada = db.prepare('SELECT * FROM role WHERE kode=?').get(kode);
  if (!ada && !/^[A-Za-z0-9 _.-]{3,40}$/.test(kode)) throw new Galat('Kode role 3 sampai 40 karakter (huruf, angka, spasi, titik, strip).');
  if (!ada && d.baru !== true) throw new Galat('Role tidak ditemukan.'); if (ada && d.baru === true) throw new Galat('Kode role sudah dipakai.');
  if (kode === 'Admin') { const sekarang = db.prepare('SELECT COUNT(*) n FROM role_permission WHERE role_kode=?').get(kode).n; if (izin.length !== sekarang) throw new Galat('Izin role Administrator Sistem tidak bisa diubah.'); }
  let tambah = [], cabut = [];
  db.transaction(() => {
    if (!ada) db.prepare('INSERT INTO role(kode,nama,keterangan,bawaan) VALUES(?,?,?,0)').run(kode, d.nama.trim(), d.keterangan || '');
    else db.prepare('UPDATE role SET nama=?, keterangan=? WHERE kode=?').run(d.nama.trim(), d.keterangan || '', kode);
    if (kode !== 'Admin') {
      const lama = db.prepare('SELECT permission_kode k FROM role_permission WHERE role_kode=?').all(kode).map(x => x.k); tambah = izin.filter(i => !lama.includes(i)); cabut = lama.filter(i => !izin.includes(i));
      tambah.forEach(i => db.prepare('INSERT INTO role_permission VALUES(?,?)').run(kode, i)); cabut.forEach(i => db.prepare('DELETE FROM role_permission WHERE role_kode=? AND permission_kode=?').run(kode, i));
    }
    A.audit(db, c.s.username, ada ? 'role_ubah' : 'role_baru', kode, `+${tambah.join(',') || '-'} -${cabut.join(',') || '-'}`);
  })();
  return { tambah: tambah.length, cabut: cabut.length };
};
H.admHapusRole = (c, kode) => {
  A.peran(c.s, 'administrator.role.kelola'); const r = c.db.prepare('SELECT * FROM role WHERE kode=?').get(kode); if (!r) throw new Galat('Role tidak ditemukan.');
  if (r.bawaan) throw new Galat('Role bawaan tidak bisa dihapus. Izinnya masih bisa disesuaikan.');
  if (c.db.prepare('SELECT COUNT(*) n FROM user_roles WHERE role=?').get(kode).n) throw new Galat('Role masih dipakai pengguna. Lepaskan dulu dari penggunanya.');
  c.db.prepare('DELETE FROM role WHERE kode=?').run(kode); A.audit(c.db, c.s.username, 'role_hapus', kode); return true;
};
H.admAudit = (c, f) => {
  A.peran(c.s, 'administrator.audit.lihat'); f = f || {}; const w = [], p = [];
  if (f.aksi) { w.push('aksi=?'); p.push(f.aksi); } if (f.pelaku) { w.push('lower(pelaku) LIKE ?'); p.push('%' + String(f.pelaku).toLowerCase() + '%'); }
  if (f.dari) { w.push('waktu>=?'); p.push(f.dari); } if (f.sampai) { w.push('waktu<?'); p.push(f.sampai + 'T99'); }
  const W = w.length ? 'WHERE ' + w.join(' AND ') : '', lim = Math.min(Number(f.limit) || 50, 200), off = Math.max(Number(f.offset) || 0, 0);
  return { total: c.db.prepare(`SELECT COUNT(*) n FROM audit ${W}`).get(...p).n, baris: c.db.prepare(`SELECT id, waktu, pelaku, aksi, objek, detail FROM audit ${W} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, lim, off),
    aksi: c.db.prepare('SELECT DISTINCT aksi FROM audit ORDER BY aksi').all().map(x => x.aksi) };
};
H.admKesehatan = c => {
  A.peran(c.s, 'administrator.kesehatan.lihat'); const db = c.db, t0 = process.hrtime.bigint(); db.prepare('SELECT 1').get(); const dbMs = Number(process.hrtime.bigint() - t0) / 1e6;
  let ukuran = 0, disk = null; try { ukuran = fs.statSync(db.name).size; const s = fs.statfsSync(path.dirname(db.name)); disk = { bebasGB: Math.round(s.bavail * s.bsize / 1e8) / 10, totalGB: Math.round(s.blocks * s.bsize / 1e8) / 10 }; } catch (e) { /* basis data memori */ }
  const hitung = Object.fromEntries(['users', 'santri', 'nilai', 'ujian', 'ujian_skor', 'notifikasi', 'audit', 'wa_antrian'].map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  const m = M.ringkasan(24), n = (sql, ...p) => db.prepare(sql).get(...p).n, sesiAktif = n('SELECT COUNT(*) n FROM sesi WHERE kedaluwarsa>?', Date.now()), gagal24 = n("SELECT COUNT(*) n FROM audit WHERE aksi='login_gagal' AND waktu>?", new Date(Date.now() - 864e5).toISOString());
  const cfg = config(), bk = BK.daftar(cfg.backup.folder)[0], wa = WA.status(db, cfg), cek = [], add = (s, t) => cek.push({ s, t });
  add(dbMs < 50 ? 'ok' : 'warn', `Basis data merespons ${Math.round(dbMs * 10) / 10} ms.`);
  add(!disk || disk.bebasGB > 2 ? 'ok' : 'warn', disk ? `Ruang disk bebas ${disk.bebasGB} GB dari ${disk.totalGB} GB.` : 'Ruang disk tidak terbaca.');
  const umur = bk ? (Date.now() - new Date(bk.nama.slice(7, 17) + 'T' + bk.nama.slice(18, 20) + ':' + bk.nama.slice(20, 22) + ':00+07:00').getTime()) / 36e5 : null;
  add(bk && umur < 36 ? 'ok' : 'warn', bk ? (umur < 36 ? 'Cadangan terakhir: ' + bk.nama : 'Cadangan terakhir lebih dari 36 jam lalu.') : 'Belum ada cadangan.');
  add(m.p95 < 1000 ? 'ok' : 'warn', `Waktu respons p95: ${m.p95} ms (${m.jumlah} permintaan dalam 24 jam).`); add(m.galat5xx === 0 ? 'ok' : 'warn', m.galat5xx ? m.galat5xx + ' galat server (5xx) dalam 24 jam. Lihat data/server.log.' : 'Tidak ada galat server dalam 24 jam.');
  add(gagal24 < 20 ? 'ok' : 'warn', gagal24 + ' percobaan login gagal dalam 24 jam.'); add(wa.hitung.Gagal === 0 ? 'ok' : 'warn', wa.aktif ? `WhatsApp: ${wa.hitung.Menunggu} menunggu, ${wa.hitung.Gagal} gagal.` : 'WhatsApp belum diatur (opsional).');
  add(n('SELECT COUNT(*) n FROM users WHERE wajib_ganti=1 AND aktif=1') === 0 ? 'ok' : 'warn', n('SELECT COUNT(*) n FROM users WHERE wajib_ganti=1 AND aktif=1') + ' akun aktif belum mengganti sandi awal.');
  return { versiNode: process.version, uptimeDetik: m.uptimeDetik, memoriMB: Math.round(process.memoryUsage().rss / 1048576), cpu: os.loadavg()[0], dbUkuranKB: Math.round(ukuran / 1024), disk, dbMs: Math.round(dbMs * 10) / 10, hitung, metrik: m, sesiAktif, loginGagal24: gagal24, pemeriksaan: cek, cadanganTerakhir: bk ? bk.nama : null, waktu: new Date().toISOString() };
};
module.exports = H;
