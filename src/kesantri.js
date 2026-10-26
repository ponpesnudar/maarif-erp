// Modul Kesantrian: data santri, pindah kelas, kualitas data. Santri tidak pernah dihapus, hanya dinonaktifkan (riwayat nilai dan ujian tetap utuh).
const A = require('./auth'), { Galat } = A, WA = require('./wa'), H = {};
const lihat = c => A.peran(c.s, 'kesantrian.lihat'), kelola = c => A.peran(c.s, 'kesantrian.kelola');
const KOLOM = ['nama', 'kelas', 'jk', 'kamar', 'tahun_masuk', 'status', 'wali', 'no_hp'];
H.ksList = (c, f) => {
  lihat(c); f = f || {}; const w = [], p = [];
  if (f.cari) { w.push('(lower(nama) LIKE ? OR nis LIKE ?)'); p.push('%' + String(f.cari).toLowerCase() + '%', '%' + String(f.cari) + '%'); }
  if (f.kelas) { w.push('kelas=?'); p.push(f.kelas); } if (f.status) { w.push('status=?'); p.push(f.status); }
  const W = w.length ? 'WHERE ' + w.join(' AND ') : '', lim = Math.min(Number(f.limit) || 50, 100), off = Math.max(Number(f.offset) || 0, 0);
  return { total: c.db.prepare(`SELECT COUNT(*) n FROM santri ${W}`).get(...p).n, baris: c.db.prepare(`SELECT nis,nama,kelas,jk,kamar,tahun_masuk,status,wali,no_hp FROM santri ${W} ORDER BY kelas, nama LIMIT ? OFFSET ?`).all(...p, lim, off) };
};
H.ksKelas = c => { lihat(c); return c.db.prepare("SELECT kelas, COUNT(*) total, SUM(CASE WHEN status<>'Nonaktif' THEN 1 ELSE 0 END) aktif FROM santri GROUP BY kelas ORDER BY kelas").all(); };
H.ksSimpan = (c, d) => {
  kelola(c); d = d || {}; const nis = String(d.nis || '').trim();
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(nis)) throw new Galat('NIS 1 sampai 20 karakter: huruf, angka, titik, strip, garis bawah.');
  const nama = String(d.nama || '').trim(), kelas = String(d.kelas || '').trim(), status = d.status || 'Aktif', jk = d.jk || '';
  if (!nama || nama.length > 100) throw new Galat('Nama wajib diisi (maksimal 100 karakter).'); if (!kelas || kelas.length > 40) throw new Galat('Kelas wajib diisi (maksimal 40 karakter).');
  if (!['Aktif', 'Nonaktif'].includes(status)) throw new Galat('Status harus Aktif atau Nonaktif.'); if (!['', 'L', 'P'].includes(jk)) throw new Galat('Jenis kelamin L atau P.');
  const hp = String(d.no_hp || '').trim(); if (hp && !WA.nomor(hp)) throw new Galat('Nomor HP tidak valid. Contoh: 081234567890.');
  const baru = { nama, kelas, jk, kamar: String(d.kamar || '').trim(), tahun_masuk: String(d.tahun_masuk || '').trim(), status, wali: String(d.wali || '').trim(), no_hp: hp }, ada = c.db.prepare('SELECT * FROM santri WHERE nis=?').get(nis);
  if (d.baru) {
    if (ada) throw new Galat('NIS sudah dipakai oleh ' + ada.nama + '.');
    c.db.prepare('INSERT INTO santri(nis,nama,kelas,jk,kamar,tahun_masuk,status,wali,no_hp) VALUES(?,?,?,?,?,?,?,?,?)').run(nis, nama, kelas, jk, baru.kamar, baru.tahun_masuk, status, baru.wali, hp); A.audit(c.db, c.s.username, 'santri_baru', nis, `${nama} ${kelas}`);
  } else {
    if (!ada) throw new Galat('Santri dengan NIS ' + nis + ' tidak ditemukan.');
    const ubah = KOLOM.filter(k => String(ada[k] ?? '') !== String(baru[k] ?? '')).map(k => `${k}: ${ada[k] ?? ''} -> ${baru[k]}`);
    if (!ubah.length) return { berubah: 0 };
    c.db.prepare('UPDATE santri SET nama=?,kelas=?,jk=?,kamar=?,tahun_masuk=?,status=?,wali=?,no_hp=? WHERE nis=?').run(nama, kelas, jk, baru.kamar, baru.tahun_masuk, status, baru.wali, hp, nis);
    A.audit(c.db, c.s.username, 'santri_ubah', nis, ubah.join('; ').replace(/no_hp: ([^;]*) -> (.*)/, 'no_hp diubah'));
    return { berubah: ubah.length };
  }
  return { berubah: 1 };
};
H.ksPindahKelas = (c, daftar, kelasBaru) => {
  kelola(c); const kb = String(kelasBaru || '').trim(), nis = [...new Set((daftar || []).map(String))];
  if (!kb || kb.length > 40) throw new Galat('Kelas tujuan wajib diisi.'); if (!nis.length || nis.length > 500) throw new Galat('Pilih 1 sampai 500 santri.');
  let n = 0; c.db.transaction(() => nis.forEach(x => { n += c.db.prepare('UPDATE santri SET kelas=? WHERE nis=? AND kelas<>?').run(kb, x, kb).changes; }))();
  A.audit(c.db, c.s.username, 'santri_pindah_kelas', kb, `${n} santri`); return { dipindah: n };
};
H.ksKualitas = c => {
  lihat(c); const aktif = c.db.prepare("SELECT nis,nama,kelas,wali,no_hp FROM santri WHERE status<>'Nonaktif'").all(), ring = a => ({ jumlah: a.length, contoh: a.slice(0, 15).map(s => ({ nis: s.nis, nama: s.nama, kelas: s.kelas })) });
  const ganda = {}; aktif.forEach(s => { const k = s.nama.toLowerCase() + '|' + s.kelas; (ganda[k] = ganda[k] || []).push(s); });
  return { aktif: aktif.length, tanpaHp: ring(aktif.filter(s => !s.no_hp)), hpTidakValid: ring(aktif.filter(s => s.no_hp && !WA.nomor(s.no_hp))), tanpaWali: ring(aktif.filter(s => !s.wali)),
    namaGanda: ring(Object.values(ganda).filter(g => g.length > 1).flat()), tanpaPin: c.db.prepare("SELECT COUNT(*) n FROM santri s WHERE s.status<>'Nonaktif' AND s.nis NOT IN (SELECT nis FROM wali_akun)").get().n };
};
H.ksExport = c => { lihat(c); return c.db.prepare('SELECT nis,nama,kelas,jk,kamar,tahun_masuk,status,wali,no_hp FROM santri ORDER BY kelas, nama').all(); };
module.exports = H;
