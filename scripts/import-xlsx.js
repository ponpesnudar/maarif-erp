// node scripts/import-xlsx.js <file.xlsx>   (File > Download > Microsoft Excel (.xlsx) dari spreadsheet Maarif Online)
// Memindahkan sheet Santri, User_Accounts, Madrasah_Nilai, Madrasah_Absen, Mapel_Kitab, Raport_Kelas, Raport_Sikap. Impor ulang aman: nilai imtihan yang sudah ada tidak ditimpa. Semua akun hasil impor wajib ganti sandi saat login pertama.
const path = require('path'), crypto = require('crypto'), XLSX = require('xlsx');
const { buka } = require('../src/db'), A = require('../src/auth');
const t = v => String(v == null ? '' : v).trim(), angka = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
function importXlsx(db, file) {
  const wb = XLSX.readFile(file), rows = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }) : [];
  const h = { santri: 0, akun: 0, nilai: 0, absen: 0, mapel: 0, kelas: 0, sikap: 0, lewat: [] };
  db.transaction(() => {
    rows('Santri').forEach(r => {
      if (!t(r.NIS) || !t(r.Nama) || !t(r.Kelas)) { h.lewat.push('Santri tanpa NIS, nama, atau kelas dilewati'); return; }
      db.prepare(`INSERT INTO santri(nis,nama,kelas,jk,kamar,tahun_masuk,status,wali,no_hp) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(nis) DO UPDATE SET nama=excluded.nama,kelas=excluded.kelas,jk=excluded.jk,kamar=excluded.kamar,tahun_masuk=excluded.tahun_masuk,status=excluded.status,wali=excluded.wali,no_hp=excluded.no_hp`)
        .run(t(r.NIS), t(r.Nama), t(r.Kelas), t(r.Jenis_Kelamin), t(r.Kamar), t(r.Tahun_Masuk), t(r.Status) || 'Aktif', t(r.Wali), t(r.No_HP)); h.santri++;
    });
    rows('User_Accounts').forEach(r => {
      const u = t(r.Username); if (!u) return;
      if (db.prepare('SELECT 1 FROM users WHERE username=?').get(u)) { h.lewat.push(u + ': sudah ada, dilewati'); return; }
      const pw = t(r.Password), terhash = pw.startsWith('h1$') || !pw;
      if (terhash) h.lewat.push(u + ': sandi sudah ter-hash di Apps Script dan tidak bisa dipindah, dibuat sandi acak (gunakan Reset sandi)');
      const x = db.prepare('INSERT INTO users(username,password_hash,nama,wajib_ganti) VALUES(?,?,?,1)').run(u, A.hash(terhash ? crypto.randomBytes(12).toString('hex') : pw), t(r.Nama_Lengkap) || u);
      t(r.Role).split(',').map(s => s.trim()).filter(Boolean).forEach(role => {
        if (db.prepare('INSERT OR IGNORE INTO role(kode,nama,keterangan,bawaan) VALUES(?,?,?,0)').run(role, role, 'Dibuat saat impor, belum punya izin').changes) h.lewat.push('Peran baru "' + role + '" dibuat tanpa izin (atur di Administrator > Role)');
        db.prepare('INSERT OR IGNORE INTO user_roles VALUES(?,?)').run(x.lastInsertRowid, role);
      }); h.akun++;
    });
    rows('Madrasah_Nilai').forEach(r => {
      if (!db.prepare('SELECT 1 FROM santri WHERE nis=?').get(t(r.NIS))) { h.lewat.push('Nilai untuk NIS ' + t(r.NIS) + ' dilewati (santri tidak ada)'); return; }
      db.prepare(`INSERT INTO nilai(nis,semester,tahun,mapel,harian,ujian,akhlak) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(nis,semester,tahun,mapel) DO UPDATE SET harian=COALESCE(excluded.harian,harian), akhlak=COALESCE(excluded.akhlak,akhlak), ujian=COALESCE(ujian,excluded.ujian)`)   // nilai imtihan dari sistem ini tidak ditimpa
        .run(t(r.NIS), t(r.Semester), t(r.Tahun), t(r.Mapel), angka(r.Nilai_Harian), angka(r.Nilai_Ujian), angka(r.Nilai_Akhlak)); h.nilai++;
    });
    rows('Mapel_Kitab').forEach(r => {
      if (!t(r.Kelas) || !t(r.Mapel)) { h.lewat.push('Mapel_Kitab tanpa kelas atau mapel dilewati'); return; }
      db.prepare('INSERT INTO mapel_kitab(kelas,mapel,kitab,kkm,urut) VALUES(?,?,?,?,?) ON CONFLICT(kelas,mapel) DO UPDATE SET kitab=excluded.kitab,kkm=excluded.kkm,urut=excluded.urut').run(t(r.Kelas), t(r.Mapel), t(r.Kitab), angka(r.KKM) ?? 65, angka(r.Urut) ?? 99); h.mapel++;
    });
    rows('Raport_Kelas').forEach(r => {
      if (!t(r.Kelas)) return;
      db.prepare('INSERT INTO raport_kelas(kelas,fasl,wali_fasl,mudir,tempat,tanggal) VALUES(?,?,?,?,?,?) ON CONFLICT(kelas) DO UPDATE SET fasl=excluded.fasl,wali_fasl=excluded.wali_fasl,mudir=excluded.mudir,tempat=excluded.tempat,tanggal=excluded.tanggal').run(t(r.Kelas), t(r.Fasl), t(r.Wali_Fasl), t(r.Mudir), t(r.Tempat), t(r.Tanggal)); h.kelas++;
    });
    rows('Raport_Sikap').forEach(r => {
      if (!db.prepare('SELECT 1 FROM santri WHERE nis=?').get(t(r.NIS))) { h.lewat.push('Raport_Sikap untuk NIS ' + t(r.NIS) + ' dilewati (santri tidak ada)'); return; }
      db.prepare(`INSERT INTO raport_sikap(nis,semester,tahun,akhlak,istiqamah,ubudiyah,sakit,izin,alfa,wasiat,naik) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(nis,semester,tahun) DO UPDATE SET akhlak=excluded.akhlak,istiqamah=excluded.istiqamah,ubudiyah=excluded.ubudiyah,sakit=excluded.sakit,izin=excluded.izin,alfa=excluded.alfa,wasiat=excluded.wasiat,naik=excluded.naik`)
        .run(t(r.NIS), t(r.Semester), t(r.Tahun), angka(r.Akhlak), angka(r.Istiqamah), angka(r.Ubudiyah), angka(r.Sakit), angka(r.Izin), angka(r.Alfa), t(r.Wasiat), t(r.Naik)); h.sikap++;
    });
    rows('Madrasah_Absen').forEach(r => {
      if (!db.prepare('SELECT 1 FROM santri WHERE nis=?').get(t(r.NIS))) return;
      db.prepare('INSERT INTO absensi(nis,tanggal,mapel,status) VALUES(?,?,?,?)').run(t(r.NIS), t(r.Tanggal), t(r.Mapel), t(r.Status)); h.absen++;
    });
  })();
  return h;
}
module.exports = { importXlsx };
if (require.main === module) {
  const f = process.argv[2]; if (!f) { console.log('Pakai: npm run import -- <file.xlsx>'); process.exit(1); }
  const h = importXlsx(buka(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maarif.db')), f);
  console.log(`Selesai: ${h.santri} santri, ${h.akun} akun, ${h.nilai} nilai, ${h.absen} absensi, ${h.mapel} mapel-kitab, ${h.kelas} data kelas, ${h.sikap} data sikap.`); h.lewat.forEach(x => console.log(' - ' + x));
}
