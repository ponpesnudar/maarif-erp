// node scripts/setup.js [--demo]   -> membuat database dan akun admin (sandi acak dicetak sekali)
const path = require('path'), crypto = require('crypto');
const { buka } = require('../src/db'), A = require('../src/auth');
function pastikanAdmin(db, sandi) {
  if (db.prepare("SELECT 1 FROM users WHERE username='admin'").get()) return null;
  const pw = sandi || crypto.randomBytes(9).toString('base64url');
  const r = db.prepare("INSERT INTO users(username,password_hash,nama) VALUES('admin',?, 'Administrator')").run(A.hash(pw));
  db.prepare("INSERT INTO user_roles(user_id,role) VALUES(?, 'Admin')").run(r.lastInsertRowid); return pw;
}
function seedDemo(db) {
  const user = (u, n, role) => { if (db.prepare('SELECT 1 FROM users WHERE username=?').get(u)) return; const r = db.prepare('INSERT INTO users(username,password_hash,nama) VALUES(?,?,?)').run(u, A.hash('demo12345'), n); db.prepare('INSERT INTO user_roles VALUES(?,?)').run(r.lastInsertRowid, role); };
  user('demo_guru', 'Guru Demo', 'Guru Putra'); user('demo_panitia', 'Panitia Demo', 'Panitia Ujian');
  ['Ahmad', 'Budi', 'Cahya', 'Dimas', 'Eko', 'Fajar', 'Galih', 'Hasan', 'Irfan', 'Jamal'].forEach((n, i) => {
    db.prepare("INSERT OR IGNORE INTO santri(nis,nama,kelas,status,no_hp) VALUES(?,?, 'DEMO-1','Aktif',?)").run('D' + (100 + i), n + ' Demo', '0812000000' + i);
    db.prepare('INSERT OR IGNORE INTO wali_akun(nis,pin_hash) VALUES(?,?)').run('D' + (100 + i), A.hash('123456'));
  });
  db.prepare("INSERT OR IGNORE INTO ujian(id,nama,semester,tahun,tgl_mulai,tgl_selesai) VALUES('DEMO-UJ','Simulasi Imtihan','Ganjil','2026/2027','2026-12-10','2026-12-17')").run();
  [['DEMO-I1', 'Safinah', 'Kitab', 'Makna:50,Nahwu:50'], ['DEMO-I2', 'Fiqih', 'Tulis', 'Soal 1:50,Soal 2:50'], ['DEMO-I3', 'Tauhid', 'PG', 'PG:ABCDABCDAB'], ['DEMO-I4', 'Hafalan', 'Lisan', 'Makhraj:30,Kelancaran:40,Pemahaman:30']]
    .forEach(i => db.prepare("INSERT OR IGNORE INTO ujian_item(id,ujian_id,kelas,mapel,jenis,penguji,aspek) VALUES(?, 'DEMO-UJ','DEMO-1',?,?, 'demo_guru',?)").run(i[0], i[1], i[2], i[3]));
  [['Fiqih', 'متن تقريب'], ['Tauhid', 'قطر الغيث'], ['Hafalan', 'ألفية ابن مالك']].forEach((m, i) => db.prepare("INSERT OR IGNORE INTO mapel_kitab(kelas,mapel,kitab,kkm,urut) VALUES('DEMO-1',?,?,65,?)").run(m[0], m[1], i + 1));
  db.prepare("INSERT OR IGNORE INTO raport_kelas VALUES('DEMO-1','تجريبي (أ)','Ustadz Demo','Kiai Demo','Karangdadap','10 Desember 2026')").run();
  for (let i = 0; i < 10; i++) { ['Fiqih', 'Tauhid'].forEach(m => db.prepare("INSERT OR IGNORE INTO nilai(nis,semester,tahun,mapel,harian) VALUES(?, 'Ganjil','2026/2027',?,?)").run('D' + (100 + i), m, 60 + i * 3));
    db.prepare("INSERT OR IGNORE INTO raport_sikap(nis,semester,tahun,akhlak,istiqamah,ubudiyah,wasiat) VALUES(?, 'Ganjil','2026/2027',70,70,70,'Tetap semangat belajar.')").run('D' + (100 + i)); }
  for (let i = 0; i < 10; i++)   // koreksian kitab; Jamal sengaja di bawah syarat
    db.prepare("INSERT OR IGNORE INTO ujian_skor(item_id,nis,detail,total,penilai,waktu) VALUES('DEMO-I1',?,?,?, 'Seed demo','2026-10-24 08:00')").run('D' + (100 + i), JSON.stringify(i === 9 ? [20, 20] : [40, 40]), i === 9 ? 40 : 80);
}
module.exports = { pastikanAdmin, seedDemo };
if (require.main === module) {
  const db = buka(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maarif.db')), pw = pastikanAdmin(db, process.env.ADMIN_PASSWORD);
  if (pw) console.log(`\nAkun admin dibuat.\n  username : admin\n  sandi    : ${pw}\nCatat sandi ini, tidak ditampilkan lagi (ganti lewat tab Akun).\n`); else console.log('Akun admin sudah ada.');
  if (process.argv.includes('--demo')) { seedDemo(db); console.log('Data demo siap: demo_guru / demo_panitia (sandi demo12345), PIN wali demo 123456, santri D100 sampai D109.'); }
}
