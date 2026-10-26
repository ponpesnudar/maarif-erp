// Modul Madrasah: nilai harian oleh guru pengampu, penugasan pengampu, data raport (kitab per kelas, data kelas, sikap).
const A = require('./auth'), { Galat } = A, H = {};
const angka = v => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw new Galat('Nilai harus angka 0 sampai 100.'); return Math.round(n * 10) / 10; };
const semua = s => A.punya(s, 'madrasah.nilai.semua');
function bolehMenilai(c, kelas, mapel) {
  A.peran(c.s, 'madrasah.nilai.harian'); if (semua(c.s)) return;
  if (!c.db.prepare('SELECT 1 FROM pengampu WHERE username=? AND kelas=? AND mapel=?').get(c.s.username, kelas, mapel)) throw new Galat('Anda bukan pengampu mapel ini di kelas ini.');
}
H.nhDaftar = c => {   // kelas dan mapel yang boleh dinilai oleh pemanggil
  if (!A.punya(c.s, 'madrasah.nilai.harian') && !semua(c.s)) throw new Galat('Peran Anda tidak diizinkan.');
  return semua(c.s) ? c.db.prepare('SELECT kelas, mapel FROM mapel_kitab ORDER BY kelas, urut, mapel').all()
    : c.db.prepare('SELECT p.kelas, p.mapel FROM pengampu p WHERE p.username=? ORDER BY p.kelas, p.mapel').all(c.s.username);
};
H.nhList = (c, kelas, mapel, semester, tahun) => {
  bolehMenilai(c, kelas, mapel);
  return c.db.prepare(`SELECT s.nis, s.nama, n.harian, n.ujian FROM santri s LEFT JOIN nilai n ON n.nis=s.nis AND n.semester=? AND n.tahun=? AND n.mapel=? WHERE s.kelas=? AND s.status<>'Nonaktif' ORDER BY s.nama`).all(semester, tahun, mapel, kelas);
};
H.nhSimpan = (c, kelas, mapel, semester, tahun, nis, nilai) => {
  bolehMenilai(c, kelas, mapel); const v = angka(nilai);
  if (!['Ganjil', 'Genap'].includes(semester) || !/^\d{4}\/\d{4}$/.test(String(tahun))) throw new Galat('Semester (Ganjil/Genap) dan tahun ajaran (2026/2027) tidak valid.');
  if (!c.db.prepare('SELECT 1 FROM mapel_kitab WHERE kelas=? AND mapel=?').get(kelas, mapel)) throw new Galat('Mapel ini belum terdaftar untuk kelas tersebut (Data Raport).');
  if (!c.db.prepare('SELECT 1 FROM santri WHERE nis=? AND kelas=?').get(String(nis), kelas)) throw new Galat('Santri bukan anggota kelas ' + kelas + '.');
  const lama = c.db.prepare('SELECT harian FROM nilai WHERE nis=? AND semester=? AND tahun=? AND mapel=?').get(String(nis), semester, tahun, mapel);
  c.db.prepare('INSERT INTO nilai(nis,semester,tahun,mapel,harian) VALUES(?,?,?,?,?) ON CONFLICT(nis,semester,tahun,mapel) DO UPDATE SET harian=excluded.harian').run(String(nis), semester, tahun, mapel, v);
  if ((lama ? lama.harian : null) !== v) A.audit(c.db, c.s.username, 'nilai_harian', `${nis} ${mapel} ${semester} ${tahun}`, `${lama && lama.harian !== null ? lama.harian : '-'} -> ${v === null ? '-' : v}`);
  return v;
};
H.pgList = c => { A.peran(c.s, 'madrasah.pengampu.kelola'); return c.db.prepare('SELECT p.username, u.nama, p.kelas, p.mapel FROM pengampu p JOIN users u ON u.username=p.username ORDER BY p.kelas, p.mapel, u.nama').all(); };
H.pgSimpan = (c, username, kelas, mapel) => {
  A.peran(c.s, 'madrasah.pengampu.kelola');
  if (!c.db.prepare('SELECT 1 FROM users WHERE username=? AND aktif=1').get(String(username))) throw new Galat('Pengguna tidak ditemukan atau tidak aktif.');
  if (!c.db.prepare('SELECT 1 FROM mapel_kitab WHERE kelas=? AND mapel=?').get(kelas, mapel)) throw new Galat('Kelas dan mapel ini belum ada di Data Raport.');
  c.db.prepare('INSERT OR IGNORE INTO pengampu(username,kelas,mapel) VALUES(?,?,?)').run(username, kelas, mapel); A.audit(c.db, c.s.username, 'pengampu_tambah', `${username} ${kelas} ${mapel}`); return true;
};
H.pgOpsi = c => { A.peran(c.s, 'madrasah.pengampu.kelola'); return { kelasMapel: c.db.prepare('SELECT kelas, mapel FROM mapel_kitab ORDER BY kelas, urut, mapel').all(), pengguna: c.db.prepare('SELECT username, nama FROM users WHERE aktif=1 ORDER BY nama').all() }; };
H.pgHapus = (c, username, kelas, mapel) => { A.peran(c.s, 'madrasah.pengampu.kelola'); c.db.prepare('DELETE FROM pengampu WHERE username=? AND kelas=? AND mapel=?').run(username, kelas, mapel); A.audit(c.db, c.s.username, 'pengampu_hapus', `${username} ${kelas} ${mapel}`); return true; };

const kelolaRaport = c => A.peran(c.s, 'madrasah.raport.kelola');
H.drKelasList = c => { kelolaRaport(c); return c.db.prepare(`SELECT k.kelas, (SELECT COUNT(*) FROM santri s WHERE s.kelas=k.kelas) santri, (SELECT COUNT(*) FROM mapel_kitab m WHERE m.kelas=k.kelas) mapel, EXISTS(SELECT 1 FROM raport_kelas r WHERE r.kelas=k.kelas) adaData FROM (SELECT DISTINCT kelas FROM santri) k ORDER BY k.kelas`).all(); };
H.drKelas = (c, kelas) => { kelolaRaport(c); return { kelas: c.db.prepare('SELECT * FROM raport_kelas WHERE kelas=?').get(kelas) || { kelas, fasl: '', wali_fasl: '', mudir: '', tempat: '', tanggal: '' }, mapel: c.db.prepare('SELECT * FROM mapel_kitab WHERE kelas=? ORDER BY urut, mapel').all(kelas) }; };
H.drSimpanKelas = (c, d) => {
  kelolaRaport(c); d = d || {}; if (!c.db.prepare('SELECT 1 FROM santri WHERE kelas=?').get(d.kelas)) throw new Galat('Kelas tidak ada di data santri.');
  c.db.prepare('INSERT INTO raport_kelas(kelas,fasl,wali_fasl,mudir,tempat,tanggal) VALUES(?,?,?,?,?,?) ON CONFLICT(kelas) DO UPDATE SET fasl=excluded.fasl,wali_fasl=excluded.wali_fasl,mudir=excluded.mudir,tempat=excluded.tempat,tanggal=excluded.tanggal')
    .run(d.kelas, d.fasl || '', d.wali_fasl || '', d.mudir || '', d.tempat || '', d.tanggal || ''); A.audit(c.db, c.s.username, 'raport_kelas', d.kelas); return true;
};
H.drSimpanMapel = (c, d) => {
  kelolaRaport(c); d = d || {}; if (!c.db.prepare('SELECT 1 FROM santri WHERE kelas=?').get(d.kelas)) throw new Galat('Kelas tidak ada di data santri.');
  if (!String(d.mapel || '').trim() || !String(d.kitab || '').trim()) throw new Galat('Mapel dan judul kitab wajib diisi.');
  const kkm = d.kkm === '' || d.kkm == null ? 65 : Number(d.kkm), urut = d.urut === '' || d.urut == null ? 99 : Number(d.urut); if (!(kkm >= 0 && kkm <= 100) || !Number.isInteger(urut)) throw new Galat('KKM 0 sampai 100 dan urutan bilangan bulat.');
  c.db.prepare('INSERT INTO mapel_kitab(kelas,mapel,kitab,kkm,urut) VALUES(?,?,?,?,?) ON CONFLICT(kelas,mapel) DO UPDATE SET kitab=excluded.kitab,kkm=excluded.kkm,urut=excluded.urut').run(d.kelas, d.mapel.trim(), d.kitab.trim(), kkm, urut);
  A.audit(c.db, c.s.username, 'raport_mapel', d.kelas + ' ' + d.mapel); return true;
};
H.drHapusMapel = (c, kelas, mapel) => {
  kelolaRaport(c); if (c.db.prepare('SELECT 1 FROM nilai n JOIN santri s ON s.nis=n.nis WHERE s.kelas=? AND n.mapel=? LIMIT 1').get(kelas, mapel)) throw new Galat('Mapel ini sudah punya nilai, tidak bisa dihapus.');
  c.db.prepare('DELETE FROM pengampu WHERE kelas=? AND mapel=?').run(kelas, mapel); c.db.prepare('DELETE FROM mapel_kitab WHERE kelas=? AND mapel=?').run(kelas, mapel); A.audit(c.db, c.s.username, 'raport_mapel_hapus', kelas + ' ' + mapel); return true;
};
H.drSikapList = (c, kelas, semester, tahun) => { kelolaRaport(c); return c.db.prepare(`SELECT s.nis, s.nama, r.akhlak, r.istiqamah, r.ubudiyah, r.sakit, r.izin, r.alfa, r.wasiat, r.naik FROM santri s LEFT JOIN raport_sikap r ON r.nis=s.nis AND r.semester=? AND r.tahun=? WHERE s.kelas=? AND s.status<>'Nonaktif' ORDER BY s.nama`).all(semester, tahun, kelas); };
H.drSimpanSikap = (c, d) => {
  kelolaRaport(c); d = d || {}; if (!c.db.prepare('SELECT 1 FROM santri WHERE nis=?').get(String(d.nis))) throw new Galat('Santri tidak ditemukan.');
  const n = k => { const v = angka(d[k]); return v; }, h = k => { if (d[k] === '' || d[k] == null) return null; const v = Number(d[k]); if (!Number.isInteger(v) || v < 0 || v > 400) throw new Galat('Jumlah absensi harus bilangan bulat 0 sampai 400.'); return v; };
  c.db.prepare(`INSERT INTO raport_sikap(nis,semester,tahun,akhlak,istiqamah,ubudiyah,sakit,izin,alfa,wasiat,naik) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(nis,semester,tahun) DO UPDATE SET akhlak=excluded.akhlak,istiqamah=excluded.istiqamah,ubudiyah=excluded.ubudiyah,sakit=excluded.sakit,izin=excluded.izin,alfa=excluded.alfa,wasiat=excluded.wasiat,naik=excluded.naik`)
    .run(String(d.nis), d.semester, d.tahun, n('akhlak'), n('istiqamah'), n('ubudiyah'), h('sakit'), h('izin'), h('alfa'), d.wasiat || '', d.naik || ''); return true;
};
module.exports = H;
