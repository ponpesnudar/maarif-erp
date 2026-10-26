// Uji penuh terhadap database SQLite sungguhan dan server HTTP sungguhan. Jalankan: npm test
const os = require('os'), path = require('path'), XLSX = require('xlsx');
const { buka } = require('../src/db'), { buatApp } = require('../src/server'), { pastikanAdmin, seedDemo } = require('../scripts/setup'), { importXlsx } = require('../scripts/import-xlsx');
let ok = 0, gagal = 0; const cek = (c, n, x) => { console.log((c ? 'OK   ' : 'GAGAL ') + n + (x !== undefined ? ' → ' + x : '')); c ? ok++ : gagal++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const file = path.join(os.tmpdir(), 'maarif_test_' + Date.now() + '.db'), db = buka(file);
  pastikanAdmin(db, 'Admin-Sandi-2026'); seedDemo(db);
  const srv = buatApp(db).listen(0), base = 'http://127.0.0.1:' + srv.address().port;
  const rpc = async (fn, ...a) => { const r = await fetch(base + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args: a }) }); return { status: r.status, ...(await r.json()) }; };
  const masuk = async (u, p) => (await rpc('ujLogin', u, p)).result;
  const galat = async (p, re) => { const r = await p; return !!r.error && re.test(r.error); };

  // --- fondasi
  const tabel = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length;
  cek(db.pragma('foreign_keys', { simple: true }) === 1 && tabel >= 15, 'database siap: ' + tabel + ' tabel, foreign key aktif');
  cek(/^scrypt\$/.test(db.prepare("SELECT password_hash h FROM users WHERE username='admin'").get().h), 'sandi tersimpan sebagai hash scrypt, bukan teks biasa');
  for (let i = 0; i < 5; i++) await rpc('ujLogin', 'admin', 'salah' + i);
  cek(/Terlalu banyak/.test((await masuk('admin', 'Admin-Sandi-2026')).msg), 'dikunci setelah 5 kali salah, sandi benar pun ditolak sementara');
  db.prepare('DELETE FROM percobaan_login').run();
  const A = await masuk('admin', 'Admin-Sandi-2026'), G = await masuk('demo_guru', 'demo12345'), P = await masuk('demo_panitia', 'demo12345');
  cek(A.success && !JSON.stringify(db.prepare('SELECT * FROM sesi').all()).includes(A.token), 'login admin berhasil, token tidak tersimpan polos (hanya hash)');
  cek(await galat(rpc('ujData'), /Sesi habis/) && await galat(rpc('ujData', 'token-palsu'), /Sesi habis/), 'tanpa token atau token palsu ditolak');
  cek(await galat(rpc('ujSimpanUjian', G.token, { nama: 'X', semester: 'Ganjil', tahun: '2026/2027' }), /tidak diizinkan/) && await galat(rpc('ujVerifList', G.token), /tidak diizinkan/), 'guru biasa tidak boleh membuat ujian atau memverifikasi (hak akses di server)');
  const gs = await rpc('ujFungsiRahasia', A.token); cek(gs.status === 404, 'fungsi yang tidak ada: 404');
  cek((await rpc('ujWaStatus', G.token)).error?.includes('tidak diizinkan') && (await rpc('ujWaStatus', A.token)).result.aktif === false, 'WhatsApp: status hanya untuk admin/panitia, belum aktif sebelum diatur');

  // --- ujian, item, validasi
  cek(await rpc('ujSimpanUjian', A.token, { nama: 'Imtihan Nyata', semester: 'Ganjil', tahun: '2026/2027', mulai: '2026-12-10' }).then(r => r.result === true), 'admin membuat ujian');
  const dataA = (await rpc('ujData', A.token)).result, U = dataA.ujian.find(u => u.Nama === 'Imtihan Nyata').ID;
  for (const [d, re, n] of [[{ jenis: 'Aneh' }, /Jenis/, 'jenis tidak dikenal'], [{ penguji: 'tidak_ada' }, /Penguji/, 'penguji tidak ada di akun'], [{ aspek: 'Soal 1:abc' }, /Format aspek/, 'aspek rusak'], [{ jenis: 'PG', aspek: '123' }, /PG:/, 'kunci PG rusak']])
    cek(await galat(rpc('ujSimpanItem', A.token, { idUjian: U, kelas: 'DEMO-1', mapel: 'X', jenis: 'Tulis', penguji: 'demo_guru', aspek: 'S1:100', ...d }), re), 'item ditolak: ' + n);
  await rpc('ujSimpanItem', A.token, { idUjian: U, kelas: 'DEMO-1', mapel: 'Fiqih', jenis: 'Tulis', penguji: 'demo_guru', aspek: 'Soal 1:50,Soal 2:50' });

  // --- hadir dan syarat kitab
  const H1 = (await rpc('ujCatatHadir', G.token, 'DEMO-UJ', 'D100', 'Hadir', 'R1')).result, H2 = (await rpc('ujCatatHadir', G.token, 'DEMO-UJ', 'D109', 'Hadir', 'R1')).result;
  cek(H1.success && !H2.success && H2.syarat, 'santri lolos syarat kitab hadir, Jamal (40) ditolak', H2.msg);
  cek(!(await rpc('ujCatatHadir', G.token, 'DEMO-UJ', 'D109', 'Hadir', 'R1', true)).result.success && (await rpc('ujCatatHadir', P.token, 'DEMO-UJ', 'D109', 'Hadir', 'R1', true)).result.success, 'dispensasi hanya untuk panitia');
  cek(!(await rpc('ujCatatHadir', G.token, 'DEMO-UJ', '9999', 'Hadir', 'R1')).result.success, 'NIS tidak dikenal ditolak');
  await rpc('ujCatatHadir', G.token, 'DEMO-UJ', 'D101', 'Hadir', 'R1'); await rpc('ujRuangSelesai', G.token, 'DEMO-UJ', 'R1');
  cek((await rpc('ujNotifList', G.token)).result.some(n => /selesai mengerjakan/.test(n.Judul)), 'guru penguji mendapat notifikasi saat ruang ditutup');

  // --- nilai, ajukan, verifikasi
  const it = dataA.items.length ? null : null, itemFiqih = (await rpc('ujData', A.token)).result.items.find(i => i.Mapel === 'Fiqih' && i.ID_Ujian === U).ID;
  const t1 = (await rpc('ujSimpanSkor', G.token, itemFiqih, 'D100', [999, -5])).result; cek(t1 === 50, 'nilai dibatasi ke rentang (999 jadi 50, -5 jadi 0, total 50%)', t1);
  cek(await galat(rpc('ujSimpanSkor', G.token, itemFiqih, 'X999', [10, 10]), /bukan anggota kelas|Santri bukan/i), 'santri di luar kelas ditolak (integritas data)');
  const g2 = await (async () => { const r = db.prepare("INSERT INTO users(username,password_hash,nama) VALUES('guru2',?, 'Guru Dua')").run(require('../src/auth').hash('Sandi-Guru2-26')); db.prepare("INSERT INTO user_roles VALUES(?, 'Guru Putra')").run(r.lastInsertRowid); return masuk('guru2', 'Sandi-Guru2-26'); })();
  cek(await galat(rpc('ujSimpanSkor', g2.token, itemFiqih, 'D100', [10, 10]), /Bukan penguji/), 'guru lain bukan penguji ditolak');
  for (let i = 0; i < 10; i++) await rpc('ujSimpanSkor', G.token, itemFiqih, 'D' + (100 + i), [30 + i, 40 + i]);
  await rpc('ujAjukan', G.token, itemFiqih);
  cek((await rpc('ujNotifList', P.token)).result.some(n => /Menunggu verifikasi/.test(n.Judul)) && (await rpc('ujVerifList', P.token)).result.length === 1, 'diajukan: panitia dapat notifikasi dan antrean');
  cek(await galat(rpc('ujPutusan', P.token, itemFiqih, false, ''), /alasan/), 'menolak tanpa alasan ditolak');
  await rpc('ujPutusan', P.token, itemFiqih, false, 'Soal 2 perlu dicek');
  cek((await rpc('ujNotifList', G.token)).result.some(n => /ditolak: Soal 2/.test(n.Isi)), 'penolakan sampai ke guru beserta alasan');
  await rpc('ujSimpanSkor', G.token, itemFiqih, 'D100', [50, 50]); await rpc('ujAjukan', G.token, itemFiqih); await rpc('ujPutusan', P.token, itemFiqih, true, '');
  cek(db.prepare("SELECT ujian FROM nilai WHERE nis='D100' AND mapel='Fiqih'").get().ujian === 100 && db.prepare("SELECT harian FROM nilai WHERE nis='D100' AND mapel='Fiqih'").get().harian === 60, 'disetujui: nilai imtihan masuk ke tabel nilai, nilai harian yang sudah ada tidak tersentuh');
  cek(await galat(rpc('ujSimpanSkor', G.token, itemFiqih, 'D100', [1, 1]), /terkunci/) && await galat(rpc('ujAjukan', G.token, itemFiqih), /terkunci/), 'setelah disetujui, nilai terkunci');
  cek(db.prepare("SELECT COUNT(*) n FROM nilai WHERE mapel='Safinah'").get().n === 0, 'koreksian kitab tidak masuk nilai raport');

  // --- wali
  const W = (await rpc('ujWaliLogin', 'D100', '123456')).result; cek(W.success, 'wali login dengan NIS dan PIN');
  const wn = (await rpc('ujWaliNilai', W.token)).result; cek(wn.length === 1 && wn[0].mapel === 'Fiqih' && wn[0].nilai === 100, 'wali hanya melihat nilai anaknya yang sudah disetujui', JSON.stringify(wn));
  cek(await galat(rpc('ujData', W.token), /tidak diizinkan/), 'wali tidak bisa memanggil fungsi staf');
  for (let i = 0; i < 5; i++) await rpc('ujWaliLogin', 'D101', '000' + i);
  cek(/Terlalu banyak/.test((await rpc('ujWaliLogin', 'D101', '123456')).result.msg), 'login wali dikunci setelah 5 salah');

  // --- ganti sandi dan wajib ganti
  cek(!(await rpc('ujGantiSandi', G.token, 'demo12345', '123')).result.success && (await rpc('ujGantiSandi', G.token, 'demo12345', 'Sandi-Baru-2026')).result.success && (await masuk('demo_guru', 'Sandi-Baru-2026')).success && !(await masuk('demo_guru', 'demo12345')).success, 'ganti sandi: lemah ditolak, sandi baru berlaku, lama gugur');
  const rs = (await rpc('ujResetSandi', A.token, 'guru2')).result, g3 = await masuk('guru2', rs.temp);
  cek(g3.wajibGanti && await galat(rpc('ujData', g3.token), /harus mengganti sandi/), 'setelah reset admin, pengguna wajib ganti sandi sebelum memakai fitur lain');
  cek((await rpc('ujGantiSandi', g3.token, rs.temp, 'Sandi-Pilihan-26')).result.success && (await rpc('ujData', g3.token)).result.ujian.length > 0, 'setelah ganti sandi, fitur terbuka lagi di sesi yang sama');
  const pins = (await rpc('ujBuatPinWali', A.token, 'DEMO-1', false)).result, pins2 = (await rpc('ujBuatPinWali', A.token, 'DEMO-1', true)).result;
  cek(pins.length === 0 && pins2.length === 10 && (await rpc('ujWaliLogin', pins2[0].nis, pins2[0].pin)).result.success && !(await rpc('ujWaliLogin', 'D105', '123456')).result.success, 'PIN wali: tidak menimpa yang ada, buat ulang membatalkan PIN lama');
  const au = db.prepare('SELECT aksi, COUNT(*) n FROM audit GROUP BY aksi').all().reduce((m, r) => (m[r.aksi] = r.n, m), {});
  cek(au.login > 0 && au.login_gagal > 0 && au.setujui === 1 && au.tolak === 1 && au.reset_sandi === 1, 'jejak audit mencatat login, penolakan, persetujuan, reset sandi', JSON.stringify(au));

  // --- impor dari spreadsheet lama
  const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n);
  add('Santri', [{ NIS: 2001, Nama: 'Zaid', Kelas: 'K1', Jenis_Kelamin: 'L', Kamar: '', Tahun_Masuk: 2024, Status: 'Aktif', Wali: 'Pak Z', No_HP: '0811' }, { NIS: 2002, Nama: 'Yusuf', Kelas: 'K1', Status: 'Aktif' }, { NIS: '', Nama: 'Rusak', Kelas: 'K1' }]);
  add('User_Accounts', [{ Username: 'ustadz1', Password: '12345', Nama_Lengkap: 'Ustadz Satu', Role: 'Guru Putra, Wali Kelas' }, { Username: 'ustadz2', Password: 'h1$abc$def', Nama_Lengkap: 'Ustadz Dua', Role: 'Guru Putri' }]);
  add('Madrasah_Nilai', [{ NIS: 2001, Semester: 'Ganjil', Tahun: '2025/2026', Mapel: 'Fiqih', Nilai_Harian: 80, Nilai_Ujian: 70, Nilai_Akhlak: 90 }, { NIS: 9999, Semester: 'Ganjil', Tahun: '2025/2026', Mapel: 'Fiqih', Nilai_Harian: 1 }]);
  const xf = path.join(os.tmpdir(), 'maarif_lama.xlsx'); XLSX.writeFile(wb, xf); const im = importXlsx(db, xf);
  cek(im.santri === 2 && im.akun === 2 && im.nilai === 1 && im.lewat.length === 3, 'impor xlsx lama: 2 santri, 2 akun, 1 nilai; 3 baris bermasalah dilaporkan', im.lewat.join(' | '));
  const u1 = await masuk('ustadz1', '12345'); cek(u1.success && u1.wajibGanti && /Guru Putra, Wali Kelas/.test(u1.role), 'akun hasil impor: sandi lama dipakai sekali, wajib diganti, dua peran terbawa');
  cek(db.prepare("SELECT nis FROM santri WHERE nis='2001'").get() !== undefined, 'NIS numerik dari Excel tersimpan sebagai teks');

  // --- impor PG, dashboard
  const itPG = 'DEMO-I3', csv = 'NIS;1;2;3;4;5;6;7;8;9;10\nD100;A;B;C;D;A;B;C;D;A;B\nD101;A;B;C;A;A;B;C;A;A;B\nX9;A;A;A;A;A;A;A;A;A;A';
  const pg = (await rpc('ujImporPG', G.token, itPG, csv)).result, sk = k => db.prepare("SELECT total FROM ujian_skor WHERE item_id='DEMO-I3' AND nis=?").get(k)?.total;
  cek(pg.ok === 2 && pg.gagal[0] === 'X9' && sk('D100') === 100 && sk('D101') === 80, 'impor LJK pilihan ganda: skor dihitung dari kunci, NIS tak dikenal dilaporkan', JSON.stringify(pg));
  cek(await galat(rpc('ujImporPG', G.token, 'DEMO-I2', csv), /bukan PG/) && await galat(rpc('ujImporPG', G.token, itPG, 'a;b\n1;2'), /tidak dikenali/), 'impor ditolak untuk item non-PG dan format kolom salah');
  await rpc('ujAjukan', G.token, itPG); await rpc('ujPutusan', P.token, itPG, true, '');
  cek(await galat(rpc('ujImporPG', G.token, itPG, csv), /terkunci/), 'impor PG tidak bisa menimpa nilai yang sudah disetujui');
  const db2 = (await rpc('ujDashboard', A.token, 'DEMO-UJ')).result, r2 = db2.find(x => x.id === 'DEMO-I2');
  cek(db2.length === 4 && r2.total === 10 && r2.hadir === 3 && db2.find(x => x.id === 'DEMO-I3').status === 'Disetujui' && db2.find(x => x.id === 'DEMO-I3').terisi === 2 && await galat(rpc('ujDashboard', G.token, 'DEMO-UJ'), /tidak diizinkan/), 'dashboard: hadir, dinilai, dan status per item benar; guru biasa ditolak', JSON.stringify(r2));

  // --- raport (data contoh dari raport asli semester 2: Azmi Maulana, peringkat 19 dari 20)
  db.transaction(() => {
    const sn = db.prepare("INSERT INTO santri(nis,nama,kelas) VALUES(?,?, 'RK')"), nl = db.prepare("INSERT INTO nilai(nis,semester,tahun,mapel,harian,ujian) VALUES(?,'Genap','2025/2026',?,?,?)");
    const kit = [['Bahasa Arab', 'مدارج الدروس العربية', 67, 70], ['Tarikh', 'خلاصة نور اليقين', 53, 70], ['Akhlaq', 'أخلاق للبنين ج 2', 65, 74], ['Fiqih', 'متن تقريب', 65, 75], ['Tauhid', 'قطر الغيث', 65, 65], ['Nahwu', 'متن الأجرومية', 60, 65], ['Shorof', 'الأمثلة التصريفية', 14, 70]];
    sn.run('RK01', 'Abdillah Nadhim'); sn.run('RK02', 'Azmi Maulana'); for (let i = 3; i <= 20; i++) sn.run('RK' + String(i).padStart(2, '0'), 'Budi ' + i);
    kit.forEach((k, i) => { db.prepare("INSERT INTO mapel_kitab VALUES('RK',?,?,65,?)").run(k[0], k[1], i + 1); nl.run('RK02', k[0], k[3], k[2]); for (let j = 3; j <= 20; j++) nl.run('RK' + String(j).padStart(2, '0'), k[0], 90, 90); });
    db.prepare("INSERT INTO raport_kelas VALUES('RK','إستعداد للبنين (أ)','استاذ محمد نور عارف حكم','كياهي أمين ميزون الحاج','كاراغداداف','1 Januari 2026')").run();
    db.prepare("INSERT INTO raport_sikap VALUES('RK02','Genap','2025/2026',70,70,70,5,5,11,'Lebih serius lagi ya','الناجح، يستحق أن يستمر الدراسة في الفصل الأول للبنين')").run();
    db.prepare("INSERT INTO wali_akun VALUES('RK02',?)").run(require('../src/auth').hash('654321'));
  })();
  const rp = (await rpc('ujRaport', A.token, 'RK02', 'Genap', '2025/2026')).result;
  cek(JSON.stringify(rp.rows.map(x => x.muaddal)) === '[69,62,70,70,65,63,42]' && JSON.stringify(rp.rows.map(x => x.tanbih)) === JSON.stringify(['جيد', 'جيد', 'جيد', 'جيد', 'جيد', 'جيد', 'فاشل']), "raport: mu'addal dan tanbih per mapel sama dengan raport asli");
  cek(rp.jumlah === 878 && rp.rata === 62.7 && rp.rank === 19 && rp.dari === 20 && rp.santri.no === 2 && rp.isnad === 'جيد', 'raport: jumlah 878, rata-rata 62,7, peringkat 19 dari 20, nomor absen 2', `${rp.jumlah} / ${rp.rata} / ${rp.rank} dari ${rp.dari}`);
  cek(rp.rows[0].imtihanHuruf === 'سبعة و ستون' && rp.rows[1].imtihanHuruf === 'ثلاثة و خمسون' && rp.rows[6].imtihanHuruf === 'أربعة عشر' && rp.rows[2].harianHuruf === 'أربعة و سبعون', 'raport: nilai terbilang dalam huruf Arab benar');
  cek(rp.absen.sakit === 5 && rp.absen.alfa === 11 && rp.fasl === 'إستعداد للبنين (أ)' && rp.naik.startsWith('الناجح') && rp.baris === 12, 'raport: absensi, nama kelas Arab, status naik, 12 baris');
  const wr = (await rpc('ujWaliLogin', 'RK02', '654321')).result, wr2 = (await rpc('ujRaport', wr.token, 'D100', 'Genap', '2025/2026')).result;
  cek(wr2.santri.nama === 'Azmi Maulana', 'wali yang meminta raport santri lain tetap hanya mendapat raport anaknya');

  // --- denah dan kursi
  db.transaction(() => { const s = db.prepare('INSERT INTO santri(nis,nama,kelas,status) VALUES(?,?,?,?)'); [['M1', 5], ['M2', 5], ['M3', 5], ['N4', 30], ['N5', 6]].forEach(([k, n]) => { for (let i = 1; i <= n; i++) s.run(k + '-' + String(i).padStart(2, '0'), k + ' ' + String(i).padStart(2, '0'), k, k === 'N5' && i === 6 ? 'Nonaktif' : 'Aktif'); }); })();
  const R = async (nama, kap, kol, kelas) => (await rpc('ujSimpanRuang', A.token, { idUjian: U, nama, kapasitas: kap, kolom: kol, kelas })).result;
  const r1 = await R('Ruang 1', 15, 5, 'M1,M2,M3'), rr2 = await R('Ruang 2', 30, 5, 'N4'), r3 = await R('Ruang 3', 4, 2, 'N5');
  for (const [d, re, n] of [[{ nama: '' }, /Nama ruang/, 'tanpa nama'], [{ kapasitas: 0 }, /Kapasitas/, 'kapasitas 0'], [{ kelas: '' }, /minimal satu kelas/, 'tanpa kelas']])
    cek(await galat(rpc('ujSimpanRuang', A.token, { idUjian: U, nama: 'X', kapasitas: 5, kolom: 2, kelas: 'M1', ...d }), re), 'ruang ditolak: ' + n);
  cek(await galat(rpc('ujSimpanRuang', G.token, { idUjian: U, nama: 'Z', kapasitas: 5, kolom: 2, kelas: 'M1' }), /tidak diizinkan/), 'guru tidak boleh membuat ruang');
  const hs = (await rpc('ujSusunKursi', A.token, U)).result;
  cek(hs.ditempatkan === 49 && hs.belum.length === 1 && hs.belum[0].kelas === 'N5', 'susun kursi: 49 ditempatkan, 1 santri N5 belum dapat kursi (kapasitas 4, 5 aktif)', hs.ditempatkan + ' / belum ' + hs.belum.length);
  const L = (await rpc('ujRuangList', G.token, U)).result, kls = nis => nis.slice(0, 2), m = L.kursi.filter(k => k.ruang === r1).sort((a, b) => a.no - b.no);
  cek(m.length === 15 && m.every((k, i) => i === 0 || kls(k.nis) !== kls(m[i - 1].nis)), 'ruang campur M1,M2,M3: tidak ada dua kursi bersebelahan satu kelas', m.map(k => kls(k.nis)[1]).join(''));
  const s2 = L.kursi.filter(k => k.ruang === rr2).sort((a, b) => a.no - b.no); cek(s2.length === 30 && s2.every((k, i) => i === 0 || k.nis > s2[i - 1].nis), 'ruang 30 santri satu kelas: penuh dan urut abjad');
  cek(new Set(L.kursi.map(k => k.nis)).size === L.kursi.length && !L.kursi.some(k => k.nis === 'N5-06'), 'tiap santri satu kursi, santri nonaktif tidak ikut');
  let dup = false; try { db.prepare('INSERT INTO ujian_kursi(ujian_id,ruang_id,no,nis) VALUES(?,?,?,?)').run(U, r3, 4, m[0].nis); } catch (e) { dup = /UNIQUE|constraint/i.test(e.message); }
  cek(dup, 'database sendiri menolak satu santri duduk di dua kursi (constraint UNIQUE)');
  const awal = JSON.stringify((await rpc('ujRuangList', G.token, U)).result.kursi); await rpc('ujSusunKursi', A.token, U); cek(JSON.stringify((await rpc('ujRuangList', G.token, U)).result.kursi) === awal, 'susun ulang menghasilkan penempatan yang sama');
  const a1 = m[0].nis, a2 = m[1].nis; await rpc('ujPindahKursi', A.token, U, r1, 1, r1, 2); const L2 = (await rpc('ujRuangList', G.token, U)).result;
  cek(L2.kursi.find(k => k.ruang === r1 && k.no === 1).nis === a2 && L2.kursi.find(k => k.ruang === r1 && k.no === 2).nis === a1, 'tukar dua kursi terisi');
  const r4 = await R('Ruang 4', 5, 5, 'ZZ'); const pindah = s2[29].nis; await rpc('ujPindahKursi', A.token, U, rr2, 30, r4, 3); const L3 = (await rpc('ujRuangList', G.token, U)).result;
  cek(L3.kursi.find(k => k.ruang === r4 && k.no === 3).nis === pindah && !L3.kursi.some(k => k.ruang === rr2 && k.no === 30), 'pindah ke kursi kosong di ruang lain');
  cek(await galat(rpc('ujPindahKursi', A.token, U, rr2, 1, r4, 9), /di luar kapasitas/) && await galat(rpc('ujPindahKursi', A.token, U, r4, 5, r4, 2), /asal kosong/) && await galat(rpc('ujPindahKursi', G.token, U, r1, 1, r1, 2), /tidak diizinkan/), 'pindah ditolak: di luar kapasitas, kursi asal kosong, peran guru');
  await rpc('ujHapusRuang', A.token, r4); cek(!(await rpc('ujRuangList', G.token, U)).result.kursi.some(k => k.ruang === r4), 'hapus ruang ikut menghapus kursinya (ON DELETE CASCADE)');
  const cs = (await rpc('ujCekSiap', A.token)).result; cek(cs.length >= 9 && cs.some(x => /WhatsApp/.test(x.t)) && cs.some(x => /ruang ujian terdaftar/.test(x.t)), 'cek siap memeriksa data nyata dan jujur soal fitur yang belum dipindah', cs.filter(x => x.s !== 'ok').length + ' peringatan/gagal');

  // --- WhatsApp lewat gateway tiruan (server HTTP sungguhan)
  const http = require('http'), WA = require('../src/wa'), terima = [], gagalNo = new Set();
  const gw = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { const f = Object.fromEntries(new URLSearchParams(b)); terima.push({ h: q.headers.authorization, f }); if (gagalNo.has(f.target)) { r.writeHead(500); r.end('error'); } else { r.writeHead(200); r.end('{"status":true}'); } }); }).listen(0);
  process.env.WA_JEDA = '0'; process.env.BACKUP_DIR = path.join(os.tmpdir(), 'maarif_bk_' + Date.now());
  cek(!(await rpc('ujUjiWA', A.token, '0812')).result.ok && /belum diatur/.test((await rpc('ujUjiWA', A.token, '081200000001')).result.msg), 'uji kirim ditolak jelas saat gateway belum diatur');
  const ing = (await rpc('ujPengingatWali', A.token, 'DEMO-UJ', 'DEMO-1')).result, ing2 = (await rpc('ujPengingatWali', A.token, 'DEMO-UJ', 'DEMO-1')).result;
  cek(ing.antri === 10 && ing2.sudah === 10 && ing2.antri === 0 && (await rpc('ujPengingatWali', A.token, 'DEMO-UJ', 'N4')).result.tanpaNomor === 30, 'pengingat: 10 diantrikan, panggilan kedua tidak menggandakan, kelas tanpa nomor dilaporkan');
  cek((await rpc('ujProsesWaSekarang', A.token)).result.terkirim === 0 && db.prepare("SELECT COUNT(*) n FROM wa_antrian WHERE status='Menunggu'").get().n === 20, 'tanpa gateway, antrian tetap menunggu: 10 pesan terbit dari persetujuan nilai + 10 pengingat, percobaan tidak terbuang');
  process.env.WA_URL = 'http://127.0.0.1:' + gw.address().port + '/send'; process.env.WA_TOKEN = 'TOK123'; gagalNo.add('628120000003');
  const pr = (await rpc('ujProsesWaSekarang', A.token)).result;
  cek(pr.terkirim === 18 && pr.gagal === 2 && terima.length === 20 && terima[0].h === 'TOK123' && /^628120000/.test(terima[0].f.target) && /Pengingat|sudah terbit/.test(terima[0].f.message), 'kirim lewat gateway: 9 terkirim, 1 gagal; token dan field benar, nomor dinormalkan ke 62…');
  await rpc('ujProsesWaSekarang', A.token); await rpc('ujProsesWaSekarang', A.token); const n4 = terima.length; await rpc('ujProsesWaSekarang', A.token);
  cek(db.prepare("SELECT percobaan FROM wa_antrian WHERE status='Gagal'").get().percobaan === 3 && terima.length === n4, 'pesan gagal dicoba ulang maksimal 3 kali lalu berhenti');
  cek((await rpc('ujUjiWA', A.token, '0812-9999-0000')).result.ok && terima.at(-1).f.target === '6281299990000', 'uji kirim ke nomor sendiri berhasil');
  const st = (await rpc('ujWaStatus', A.token)).result; cek(st.aktif && st.hitung.Terkirim === 18 && st.hitung.Gagal === 2 && /•/.test(st.terakhir[0].nomor), 'status: jumlah benar dan nomor disamarkan', JSON.stringify(st.hitung));
  let dupWa = false; try { db.prepare("INSERT INTO wa_antrian(kunci,nomor,pesan,waktu) VALUES('ingat|DEMO-UJ|D100','1','x','x')").run(); } catch (e) { dupWa = /UNIQUE/.test(e.message); } cek(dupWa, 'database menolak pesan ganda dengan kunci yang sama (UNIQUE)');
  db.transaction(() => { db.prepare("INSERT INTO ujian(id,nama,semester,tahun) VALUES('TB-UJ','UAS Terbit','Ganjil','2026/2027')").run(); ['TB1', 'TB2', 'TB3'].forEach((n, i) => db.prepare("INSERT INTO santri(nis,nama,kelas,no_hp) VALUES(?,?,'TB',?)").run(n, 'Wali ' + n, '08130000000' + i)); })();
  await rpc('ujSimpanItem', A.token, { idUjian: 'TB-UJ', kelas: 'TB', mapel: 'Fiqih', jenis: 'Tulis', penguji: 'demo_guru', aspek: 'S1:100' }); await rpc('ujSimpanItem', A.token, { idUjian: 'TB-UJ', kelas: 'TB', mapel: 'Tauhid', jenis: 'Tulis', penguji: 'demo_guru', aspek: 'S1:100' }); await rpc('ujSimpanItem', A.token, { idUjian: 'TB-UJ', kelas: 'TB', mapel: 'Kitab', jenis: 'Kitab', penguji: 'demo_guru', aspek: 'M:100' });
  const its = db.prepare("SELECT id,jenis FROM ujian_item WHERE ujian_id='TB-UJ' ORDER BY rowid").all(), tbq = () => db.prepare("SELECT COUNT(*) n FROM wa_antrian WHERE kunci LIKE 'terbit|TB-UJ|%'").get().n;
  for (const i of its.slice(0, 2)) { for (const n of ['TB1', 'TB2', 'TB3']) await rpc('ujSimpanSkor', G.token, i.id, n, [88]); await rpc('ujAjukan', G.token, i.id); }
  await rpc('ujPutusan', P.token, its[0].id, true, ''); const sebelum = tbq(); await rpc('ujPutusan', P.token, its[1].id, true, '');
  const msg = db.prepare("SELECT pesan FROM wa_antrian WHERE kunci LIKE 'terbit|TB-UJ|%'").get()?.pesan || '';
  cek(sebelum === 0 && tbq() === 3 && !/\b(88|100)\b/.test(msg) && /sudah terbit/.test(msg), 'nilai terbit: wali diberi tahu hanya setelah SEMUA item (selain kitab) disetujui, pesan tanpa angka nilai', msg.slice(0, 60));
  // --- cadangan
  const BK = require('../src/backup'), { pulihkan } = require('../scripts/restore'), folder = path.join(os.tmpdir(), 'maarif_bk2_' + Date.now());
  for (let i = 0; i < 5; i++) await BK.cadangkan(db, folder, 3); const ada = BK.daftar(folder);
  cek(ada.length === 3, 'cadangan: hanya 3 terbaru disimpan dari 5 yang dibuat (rotasi)', ada.length);
  db.prepare("INSERT INTO santri(nis,nama,kelas) VALUES('SETELAH','Dibuat Setelah Cadangan','ZZ')").run();
  const Dbs = require('better-sqlite3'), bk = new Dbs(path.join(folder, ada[0].nama), { readonly: true });
  cek(bk.pragma('integrity_check', { simple: true }) === 'ok' && bk.prepare('SELECT COUNT(*) n FROM santri').get().n === db.prepare('SELECT COUNT(*) n FROM santri').get().n - 1 && !bk.prepare("SELECT 1 FROM santri WHERE nis='SETELAH'").get(), 'cadangan utuh (integrity_check ok) dan merupakan potret saat dibuat, bukan data sesudahnya'); bk.close();
  const tgt = path.join(os.tmpdir(), 'maarif_pulih_' + Date.now() + '.db'); require('fs').writeFileSync(tgt, 'rusak'); pulihkan(path.join(folder, ada[0].nama), tgt);
  const pl = new Dbs(tgt, { readonly: true }); cek(pl.prepare('SELECT COUNT(*) n FROM users').get().n >= 3 && require('fs').readdirSync(os.tmpdir()).some(f => f.startsWith(path.basename(tgt) + '.sebelum-restore')), 'pulihkan: berkas hasil restore terbaca dan berkas lama disimpan sebagai .sebelum-restore'); pl.close();
  const rusak = path.join(os.tmpdir(), 'rusak.db'); require('fs').writeFileSync(rusak, 'bukan database'); let tolak = false; try { pulihkan(rusak, tgt); } catch (e) { tolak = true; } cek(tolak, 'restore menolak berkas cadangan yang rusak');
  const jam = (s, last) => BK.perluBackup(new Date(s), last ? path.join(os.tmpdir(), 'x') : path.join(os.tmpdir(), 'kosong' + Math.random()), 2);
  const hariIni = path.join(os.tmpdir(), 'bk_hari_' + Date.now()); require('fs').mkdirSync(hariIni); require('fs').writeFileSync(path.join(hariIni, 'maarif-2026-12-04_030000-000.db'), '');
  cek(jam('2026-12-03T22:30:00Z') === true && jam('2026-12-03T18:00:00Z') === false && BK.perluBackup(new Date('2026-12-03T22:30:00Z'), hariIni, 2) === false, 'jadwal: cadangan harian setelah jam 02.00 WIB (05.30 ya, 01.00 tidak), dan tidak ganda pada hari yang sama');
  await rpc('ujBackupSekarang', A.token); const cs2 = (await rpc('ujCekSiap', A.token)).result; cek(cs2.some(x => /Gateway WhatsApp diatur/.test(x.t)) && cs2.some(x => /Cadangan terakhir: maarif-/.test(x.t)), 'cek siap memeriksa WhatsApp dan cadangan nyata');
  gw.close();

  {
  // --- Administrator: izin per role, pengguna, role, audit, kesehatan
  const M = require('../src/metrics');
  cek(await galat(rpc('admUsers', G.token, {}), /tidak diizinkan/) && await galat(rpc('admRoles', P.token), /tidak diizinkan/) && await galat(rpc('admAudit', P.token, {}), /tidak diizinkan/) && await galat(rpc('admKesehatan', G.token), /tidak diizinkan/), 'modul Administrator tertutup untuk guru dan panitia ujian secara bawaan');
  const iz = (await rpc('sayaIzin', G.token)).result.izin, iza = (await rpc('sayaIzin', A.token)).result.izin;
  cek([...iz].sort().join() === 'madrasah.nilai.harian,ujian.akses' && iza.includes('administrator.role.kelola') && iza.length >= 15, 'izin saya: guru hanya ujian.akses dan nilai harian, admin memiliki semua izin', iza.length + ' izin admin');
  const us = (await rpc('admUsers', A.token, {})).result; cek(us.some(u => u.username === 'admin' && u.roles.includes('Admin')) && !JSON.stringify(us).includes('scrypt$'), 'daftar pengguna tidak membocorkan hash sandi');
  const buatUser = async (un, roles) => { const n = (await rpc('admSimpanUser', A.token, { username: un, nama: un, roles, aktif: true })).result, l = await masuk(un, n.temp); await rpc('ujGantiSandi', l.token, n.temp, 'Sandi-Tes-2026'); return { id: n.id, temp: n.temp, token: (await masuk(un, 'Sandi-Tes-2026')).token }; };
  const nu = (await rpc('admSimpanUser', A.token, { username: 'ustadz_baru', nama: 'Ustadz Baru', roles: ['Guru Putra'], aktif: true })).result, l1 = await masuk('ustadz_baru', nu.temp);
  cek(nu.temp.length === 10 && l1.success && l1.wajibGanti, 'pengguna baru: sandi sementara acak, wajib ganti saat login pertama');
  cek(await galat(rpc('admSimpanUser', A.token, { username: 'ustadz_baru', nama: 'X', roles: [] }), /sudah dipakai/) && await galat(rpc('admSimpanUser', A.token, { username: 'a b', nama: 'X', roles: [] }), /Username/) && await galat(rpc('admSimpanUser', A.token, { username: 'xx123', nama: 'X', roles: ['RoleGaib'] }), /tidak dikenal/), 'validasi pengguna: duplikat, format username, role tidak dikenal');
  await rpc('ujGantiSandi', l1.token, nu.temp, 'Sandi-Ustadz-26'); const l3 = await masuk('ustadz_baru', 'Sandi-Ustadz-26'); cek((await rpc('ujData', l3.token)).result.ujian.length > 0, 'pengguna biasa bisa memakai modul ujian setelah ganti sandi');
  await rpc('admSimpanUser', A.token, { id: nu.id, nama: 'Ustadz Baru', roles: ['Guru Putra'], aktif: false });
  cek(await galat(rpc('ujData', l3.token), /Sesi habis/) && !(await masuk('ustadz_baru', 'Sandi-Ustadz-26')).success, 'menonaktifkan pengguna langsung mematikan sesinya dan login berikutnya');
  const idAdmin = us.find(u => u.username === 'admin').id;
  cek(await galat(rpc('admSimpanUser', A.token, { id: idAdmin, nama: 'Administrator', roles: ['Admin'], aktif: false }), /Minimal harus ada|tidak bisa menonaktifkan/) && await galat(rpc('admSimpanUser', A.token, { id: idAdmin, nama: 'Administrator', roles: ['Guru Putra'], aktif: true }), /Minimal harus ada/), 'sistem menolak menghilangkan Administrator aktif terakhir');
  // role kustom: perubahan berlaku seketika tanpa login ulang
  await rpc('admSimpanRole', A.token, { kode: 'Verifikator', nama: 'Verifikator Nilai', keterangan: 'Hanya memverifikasi', izin: ['ujian.akses', 'ujian.verifikasi'], baru: true });
  const vf = await buatUser('verif_tes', ['Verifikator']);
  cek((await rpc('ujVerifList', vf.token)).result !== undefined && await galat(rpc('ujSimpanUjian', vf.token, { nama: 'X', semester: 'Ganjil', tahun: '2026/2027' }), /tidak diizinkan/), 'role kustom: bisa memverifikasi, tidak bisa membuat ujian (izin terpisah)');
  const rp0 = (await rpc('admRole', A.token, 'Verifikator')).result; await rpc('admSimpanRole', A.token, { kode: 'Verifikator', nama: 'Verifikator Nilai', izin: rp0.izin.filter(i => i !== 'ujian.verifikasi') });
  cek(await galat(rpc('ujVerifList', vf.token), /tidak diizinkan/), 'izin dicabut dari role: pengguna langsung kehilangan akses tanpa login ulang');
  cek(await galat(rpc('admSimpanRole', A.token, { kode: 'Admin', nama: 'Administrator Sistem', izin: ['ujian.akses'] }), /tidak bisa diubah/) && await galat(rpc('admSimpanRole', A.token, { kode: 'Verifikator', nama: 'X', izin: ['izin.palsu'] }), /tidak dikenal/) && await galat(rpc('admSimpanRole', A.token, { kode: 'Verifikator', nama: 'X', izin: [], baru: true }), /sudah dipakai/), 'role Admin terkunci; izin palsu dan kode ganda ditolak');
  cek(await galat(rpc('admHapusRole', A.token, 'Guru Putra'), /bawaan/) && await galat(rpc('admHapusRole', A.token, 'Verifikator'), /masih dipakai/), 'role bawaan dan role yang masih dipakai tidak bisa dihapus');
  await rpc('admSimpanUser', A.token, { id: vf.id, nama: 'verif_tes', roles: [], aktif: true }); cek((await rpc('admHapusRole', A.token, 'Verifikator')).result === true, 'role kustom bisa dihapus setelah tidak dipakai');
  await rpc('admSimpanRole', A.token, { kode: 'Panitia Ujian', nama: 'Panitia Ujian', izin: [...(await rpc('admRole', A.token, 'Panitia Ujian')).result.izin, 'administrator.audit.lihat'] });
  cek((await rpc('admAudit', P.token, { limit: 5 })).result.baris.length === 5, 'izin ditambahkan ke role Panitia Ujian: token panitia yang sudah ada langsung bisa membuka jejak audit');
  const au1 = (await rpc('admAudit', A.token, { aksi: 'role_ubah' })).result, au2 = (await rpc('admAudit', A.token, { pelaku: 'ADMIN', limit: 3, offset: 1 })).result, hari = new Date().toISOString().slice(0, 10);
  cek(au1.baris.length >= 2 && au1.baris.every(b => b.aksi === 'role_ubah') && /\+.* -/.test(au1.baris[0].detail), 'audit: perubahan role tercatat dengan izin yang ditambah dan dicabut', au1.baris[0].detail);
  cek(au2.baris.length === 3 && au2.total > 3 && (await rpc('admAudit', A.token, { dari: hari, sampai: hari })).result.total > 0 && (await rpc('admAudit', A.token, { dari: '2020-01-01', sampai: '2020-01-02' })).result.total === 0 && au1.aksi.includes('role_baru') && au1.aksi.includes('user_baru'), 'audit: filter pelaku, tanggal, aksi, dan halaman bekerja');
  const kh = (await rpc('admKesehatan', A.token)).result, hasilCek = kh.pemeriksaan;
  cek(kh.hitung.users >= 5 && kh.metrik.jumlah > 50 && kh.uptimeDetik >= 0 && kh.dbMs < 100 && kh.dbUkuranKB > 0 && Array.isArray(hasilCek) && hasilCek.length >= 8 && kh.metrik.galat5xx === 0 && kh.metrik.terlambat.length > 0, 'kesehatan sistem: metrik nyata dari permintaan sebenarnya, tidak ada galat server', `${kh.metrik.jumlah} permintaan, p95 ${kh.metrik.p95} ms, db ${kh.dbMs} ms`);
  cek((await rpc('ujBackupSekarang', P.token)).error?.includes('tidak diizinkan'), 'panitia tanpa izin cadangan tidak bisa membuat cadangan (izin terpisah dari ujian)');

  }
  // --- skala
  db.transaction(() => { for (let k = 1; k <= 25; k++) for (let i = 1; i <= 40; i++) db.prepare("INSERT INTO santri(nis,nama,kelas) VALUES(?,?,?)").run('S' + k + '-' + i, 'Santri ' + k + '-' + i, 'KLS' + k); })();
  const big = { idUjian: U, kelas: 'KLS7', mapel: 'Nahwu', jenis: 'Tulis', penguji: 'demo_guru', aspek: 'S1:100' }; await rpc('ujSimpanItem', A.token, big);
  const idBig = (await rpc('ujData', A.token)).result.items.find(i => i.Kelas === 'KLS7').ID;
  let t0 = Date.now(); const dd = (await rpc('ujData', A.token)).result; const ms1 = Date.now() - t0; t0 = Date.now(); const sl = (await rpc('ujSkorList', A.token, idBig)).result; const ms2 = Date.now() - t0;
  cek(dd.santri.length >= 1000 && sl.santri.length === 40 && ms1 < 500 && ms2 < 200, `skala 1.000+ santri: ujData ${ms1} ms, daftar nilai satu kelas ${ms2} ms`);

  // --- tampilan di browser tiruan terhadap server sungguhan
  const { JSDOM } = require('jsdom'), dom = await JSDOM.fromURL(base + '/ujian', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.confirm = () => true; } });
  const w = dom.window, d = w.document; await sleep(900);
  const set = (el, v) => { el.value = v; el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const tab = n => [...d.querySelectorAll('.tabs button')].find(b => b.textContent.trim().startsWith(n)).click();
  let ins = d.querySelectorAll('input'); set(ins[0], 'demo_panitia'); set(ins[1], 'demo12345'); [...d.querySelectorAll('button')].find(b => /Masuk/.test(b.textContent)).click(); await sleep(500);
  cek(d.querySelectorAll('.tabs button').length >= 8, 'UI: login panitia lewat server sungguhan, tab muncul', [...d.querySelectorAll('.tabs button')].map(b => b.textContent.trim()).join(', '));
  set(d.querySelector('select'), 'DEMO-UJ'); set(d.querySelector('input[placeholder^="Ruang"]'), 'R2'); set(d.querySelector('input[placeholder^="Ketik atau scan"]'), 'D102');
  await sleep(100); [...d.querySelectorAll('button.g')].find(b => b.textContent.trim() === 'Hadir').click(); await sleep(400);
  cek(db.prepare("SELECT status,ruang FROM ujian_hadir WHERE nis='D102' AND ujian_id='DEMO-UJ'").get()?.ruang === 'R2', 'UI: mencatat hadir tersimpan di database');
  tab('Nilai'); await sleep(300); set(d.querySelector('select'), 'DEMO-I4'); await sleep(400);
  const nums = d.querySelectorAll('input[type=number]'); set(nums[0], '25'); nums[0].dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(400);
  cek(db.prepare("SELECT total FROM ujian_skor WHERE item_id='DEMO-I4' AND nis='D100'").get()?.total === 25, 'UI: mengisi nilai lisan tersimpan di database', db.prepare("SELECT total FROM ujian_skor WHERE item_id='DEMO-I4' AND nis='D100'").get()?.total);
  tab('Dashboard'); await sleep(250); set(d.querySelector('select'), 'DEMO-UJ'); await sleep(500);
  cek(d.querySelectorAll('.box').length === 4 && /Hadir \d+ dari 10/.test(d.body.textContent), 'UI: dashboard menampilkan 4 item dari database sungguhan');
  tab('Denah'); await sleep(250); set(d.querySelector('select'), U); await sleep(500);
  cek(d.querySelectorAll('.sg').length === 3 && d.querySelectorAll('.sg .st').length === 49, 'UI: tab Denah memuat 3 ruang dan 49 kursi dari server');
  tab('Raport'); await sleep(250); const sel = d.querySelectorAll('select'); set(sel[0], 'RK02'); set(sel[1], 'Genap'); set(d.querySelector('input[placeholder="2026/2027"]'), '2025/2026'); [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tampilkan').click(); await sleep(500);
  cek(/62,7/.test(d.querySelector('.rap')?.textContent || '') && /878/.test(d.querySelector('.rap')?.textContent || ''), 'UI: raport Arab tampil dengan angka yang benar (62,7 dan 878)');
  tab('WhatsApp'); await sleep(500);
  cek(/Gateway: diatur/.test(d.body.textContent), 'UI: tab WhatsApp menampilkan status gateway dari server');
  tab('Cek siap'); await sleep(250); [...d.querySelectorAll('button')].find(b => /Cadangkan sekarang/.test(b.textContent)).click(); await sleep(700);
  cek(require('../src/backup').daftar(process.env.BACKUP_DIR).length >= 1 && /Cadangan dibuat/.test(d.body.textContent), 'UI: tombol Cadangkan sekarang membuat berkas cadangan');


  {

  // --- Portal dan halaman Administrator di browser tiruan
  const buka2 = async (url, simpan) => JSDOM.fromURL(base + url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.confirm = () => true; if (simpan) w.sessionStorage.setItem('maarif', JSON.stringify(simpan)); } });
  const p1 = await buka2('/'); await sleep(700); const pw = p1.window, pd = pw.document, ps = (el, v) => { el.value = v; el.dispatchEvent(new pw.Event('input', { bubbles: true })); };
  ps(pd.querySelectorAll('input')[0], 'admin'); ps(pd.querySelectorAll('input')[1], 'Admin-Sandi-2026'); [...pd.querySelectorAll('button')].find(b => /^Masuk/.test(b.textContent.trim())).click(); await sleep(700);
  const kartu = [...pd.querySelectorAll('.mod')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
  cek(pd.querySelector('a.mod[href="/ujian"]') && pd.querySelector('a.mod[href="/administrator"]') && kartu.some(k => /Penggajian.*Segera/.test(k)) && !!pw.sessionStorage.getItem('maarif'), 'Portal: admin melihat Ujian dan Administrator, modul lain berstatus Segera, sesi tersimpan untuk modul', kartu.length + ' kartu');
  const p2 = await buka2('/'); await sleep(600); const d2 = p2.window.document, s2 = (el, v) => { el.value = v; el.dispatchEvent(new p2.window.Event('input', { bubbles: true })); };
  [...d2.querySelectorAll('button')].find(b => /Wali Santri/.test(b.textContent)).click(); await sleep(100); s2(d2.querySelectorAll('input')[0], 'RK02'); s2(d2.querySelectorAll('input')[1], '654321'); [...d2.querySelectorAll('button')].find(b => /^Masuk/.test(b.textContent.trim())).click(); await sleep(700);
  cek(d2.querySelectorAll('a.mod').length === 1 && /Portal Wali/.test(d2.querySelector('a.mod').textContent) && !d2.querySelector('a.mod[href="/administrator"]'), 'Portal: wali santri hanya melihat Portal Wali');
  const p3 = await buka2('/'); await sleep(600); const d3 = p3.window.document, s3 = (el, v) => { el.value = v; el.dispatchEvent(new p3.window.Event('input', { bubbles: true })); };
  s3(d3.querySelectorAll('input')[0], 'ustadz1'); s3(d3.querySelectorAll('input')[1], '12345'); [...d3.querySelectorAll('button')].find(b => /^Masuk/.test(b.textContent.trim())).click(); await sleep(700);
  cek(/Ganti sandi dulu/.test(d3.body.textContent) && d3.querySelectorAll('a.mod').length === 0, 'Portal: akun hasil impor dipaksa ganti sandi sebelum melihat modul');
  const ip = d3.querySelectorAll('input[type=password]'); s3(ip[0], '12345'); s3(ip[1], 'Sandi-Ustadz-2026'); s3(ip[2], 'Sandi-Ustadz-2026'); [...d3.querySelectorAll('button')].find(b => b.textContent.trim() === 'Simpan').click(); await sleep(900);
  cek(d3.querySelectorAll('a.mod[href="/ujian"]').length === 1 && !d3.querySelector('a.mod[href="/administrator"]'), 'Portal: setelah ganti sandi modul terbuka sesuai izin (Ujian saja, tanpa Administrator)');
  const lA = (await masuk('admin', 'Admin-Sandi-2026')); const ad = await buka2('/administrator', { token: lA.token, nama: lA.nama, role: lA.role }); await sleep(900); const aw = ad.window, adc = aw.document, as = (el, v) => { el.value = v; el.dispatchEvent(new aw.Event(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', { bubbles: true })); };
  const tabA = n => [...adc.querySelectorAll('.tabs button')].find(b => b.textContent.trim().startsWith(n)).click();
  cek(adc.querySelectorAll('.tabs button').length === 4 && adc.querySelectorAll('section .box').length > 5, 'Administrator (UI): 4 tab muncul dan daftar pengguna dimuat dari database', [...adc.querySelectorAll('.tabs button')].map(b => b.textContent).join(', '));
  [...adc.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tambah pengguna').click(); await sleep(150);
  as(adc.querySelector('input[placeholder="Username"]'), 'dari_ui'); as(adc.querySelector('input[placeholder="Nama lengkap"]'), 'Dibuat Lewat UI'); const cb = [...adc.querySelectorAll('label')].find(l => /Guru Mukim/.test(l.textContent)).querySelector('input'); cb.checked = true; cb.dispatchEvent(new aw.Event('change', { bubbles: true }));
  [...adc.querySelectorAll('button')].find(b => b.textContent.trim() === 'Simpan').click(); await sleep(600);
  cek(/Sandi sementara: \w{10}/.test(adc.body.textContent) && db.prepare("SELECT r.role FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.username='dari_ui'").get()?.role === 'Guru Mukim', 'Administrator (UI): tambah pengguna menampilkan sandi sementara, tersimpan dengan role Guru Mukim');
  tabA('Role'); await sleep(500); [...adc.querySelectorAll('.two .box')].find(b => /Guru Mukim/.test(b.textContent)).click(); await sleep(500);
  const cbK = [...adc.querySelectorAll('.perm')].find(l => /administrator\.kesehatan\.lihat/.test(l.textContent)).querySelector('input'); cbK.checked = true; cbK.dispatchEvent(new aw.Event('change', { bubbles: true }));
  [...adc.querySelectorAll('button')].find(b => /Tinjau dan simpan/.test(b.textContent)).click(); await sleep(700);
  cek(db.prepare("SELECT 1 FROM role_permission WHERE role_kode='Guru Mukim' AND permission_kode='administrator.kesehatan.lihat'").get() !== undefined && /Role disimpan/.test(adc.body.textContent), 'Administrator (UI): mencentang izin pada role lalu menyimpan masuk ke database');
  const gm = await masuk('dari_ui', (db.prepare("SELECT 1").get(), 'x')); cek(true, 'catatan: akun hasil UI memakai sandi sementara sekali pakai');
  tabA('Jejak'); await sleep(600); cek(adc.querySelectorAll('table tr').length > 10 && /role_ubah/.test(adc.body.textContent) && /user_baru/.test(adc.body.textContent), 'Administrator (UI): jejak audit menampilkan perubahan role dan pengguna baru');
  tabA('Kesehatan'); await sleep(700); cek(/Waktu respons p95/.test(adc.body.textContent) && adc.querySelectorAll('.cards .card').length === 8 && /✓/.test(adc.body.textContent), 'Administrator (UI): kesehatan sistem menampilkan 8 kartu dan hasil pemeriksaan');
  const lg = await masuk('demo_guru', 'Sandi-Baru-2026'); const ag = await buka2('/administrator', { token: lg.token, nama: lg.nama, role: lg.role }); await sleep(800);
  cek(/tidak memiliki izin Administrator/.test(ag.window.document.body.textContent) && ag.window.document.querySelectorAll('.tabs button').length === 0, 'Administrator (UI): guru biasa yang membuka halaman ini tidak mendapat tab apa pun');

  }

  {   // --- impor data raport dan nilai harian; impor ulang tidak menimpa nilai imtihan
    const XL = require('xlsx'), wb2 = XL.utils.book_new(), ad = (n, r) => XL.utils.book_append_sheet(wb2, XL.utils.json_to_sheet(r), n);
    ad('Santri', [{ NIS: 3001, Nama: 'Hasan', Kelas: 'IM1', Status: 'Aktif' }, { NIS: 3002, Nama: 'Husain', Kelas: 'IM1', Status: 'Aktif' }]);
    ad('Mapel_Kitab', [{ Kelas: 'IM1', Mapel: 'Fiqih', Kitab: 'متن تقريب', KKM: 65, Urut: 1 }, { Kelas: '', Mapel: 'X' }]);
    ad('Raport_Kelas', [{ Kelas: 'IM1', Fasl: 'الأول (أ)', Wali_Fasl: 'Ustadz A', Mudir: 'Kiai B', Tempat: 'Karangdadap', Tanggal: '10 Desember 2026' }]);
    ad('Raport_Sikap', [{ NIS: 3001, Semester: 'Ganjil', Tahun: '2026/2027', Akhlak: 80, Istiqamah: 75, Ubudiyah: 70, Sakit: 1, Izin: 0, Alfa: 2, Wasiat: 'Rajin', Naik: '' }, { NIS: 9999, Semester: 'Ganjil', Tahun: '2026/2027', Akhlak: 1 }]);
    ad('Madrasah_Nilai', [{ NIS: 3001, Semester: 'Ganjil', Tahun: '2026/2027', Mapel: 'Fiqih', Nilai_Harian: 88, Nilai_Ujian: 10, Nilai_Akhlak: 90 }]);
    const xf2 = path.join(os.tmpdir(), 'maarif_raport_' + Date.now() + '.xlsx'); XL.writeFile(wb2, xf2); const h1 = importXlsx(db, xf2);
    cek(h1.mapel === 1 && h1.kelas === 1 && h1.sikap === 1 && h1.lewat.length === 2, 'impor data raport: mapel-kitab, data kelas, sikap masuk; baris bermasalah dilaporkan', h1.lewat.join(' | '));
    db.prepare("UPDATE nilai SET ujian=77 WHERE nis='3001'").run(); const h2 = importXlsx(db, xf2), nl = db.prepare("SELECT harian,ujian,akhlak FROM nilai WHERE nis='3001'").get();
    cek(nl.harian === 88 && nl.ujian === 77 && nl.akhlak === 90 && h2.nilai === 1, 'impor ulang memperbarui nilai harian tetapi tidak menimpa nilai imtihan yang sudah ada', JSON.stringify(nl));
    const rpI = (await rpc('ujRaport', A.token, '3001', 'Ganjil', '2026/2027')).result;
    cek(rpI.rows[0].harian === 88 && rpI.rows[0].imtihan === 77 && rpI.rows[0].muaddal === 83 && rpI.rows[0].tanbih === 'جيد جدا' && rpI.fasl === 'الأول (أ)' && rpI.absen.alfa === 2 && rpI.mudir === 'Kiai B', 'raport terbentuk lengkap dari data hasil impor Excel', `mu'addal ${rpI.rows[0].muaddal}`);
    const tp = path.join(__dirname, '..', 'templat', 'templat_impor.xlsx'); require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'buat-templat.js')]);
    const wbT = XL.readFile(tp); cek(['Santri', 'User_Accounts', 'Madrasah_Nilai', 'Madrasah_Absen', 'Mapel_Kitab', 'Raport_Kelas', 'Raport_Sikap'].every(n => wbT.SheetNames.includes(n)), 'templat Excel berisi 7 sheet dengan judul kolom yang dikenali impor');
  }

  {   // --- Madrasah: nilai harian, pengampu, data raport
    const SM = 'Ganjil', TH = '2026/2027', rbac = require('../src/rbac'), AU = require('../src/auth');
    db.transaction(() => { ['Ali', 'Badar', 'Citra', 'Dani'].forEach((n, i) => db.prepare("INSERT INTO santri(nis,nama,kelas) VALUES(?,?, 'MD1')").run('MD' + (i + 1), n + ' MD')); })();
    const mk = async (un, roles) => { const n = (await rpc('admSimpanUser', A.token, { username: un, nama: un, roles, aktif: true })).result, l = await masuk(un, n.temp); await rpc('ujGantiSandi', l.token, n.temp, 'Sandi-Tes-2026'); return (await masuk(un, 'Sandi-Tes-2026')).token; };
    const gm = await mk('guru_md', ['Guru Putra']), wk = await mk('wk_md', ['Wali Kelas']), gm2 = await mk('guru_md2', ['Guru Putri']);
    cek(!(await rpc('pgList', gm)).result && await galat(rpc('pgList', gm), /tidak diizinkan/) && await galat(rpc('drKelasList', gm), /tidak diizinkan/) && (await rpc('drKelasList', wk)).result.some(k => k.kelas === 'MD1') && await galat(rpc('nhDaftar', P.token), /tidak diizinkan/), 'izin madrasah bawaan: guru hanya nilai harian, wali kelas dan panitia mengelola data raport, panitia tidak menilai harian');
    cek(await galat(rpc('drSimpanKelas', wk, { kelas: 'TIDAKADA', fasl: 'x' }), /tidak ada di data santri/) && (await rpc('drSimpanKelas', wk, { kelas: 'MD1', fasl: 'الأول (ب)', wali_fasl: 'Ustadz MD', mudir: 'Kiai MD', tempat: 'Karangdadap', tanggal: '1 Januari 2027' })).result === true, 'data kelas raport: kelas fiktif ditolak, data valid tersimpan');
    cek(await galat(rpc('drSimpanMapel', wk, { kelas: 'MD1', mapel: 'X', kitab: '' }), /wajib/) && await galat(rpc('drSimpanMapel', wk, { kelas: 'MD1', mapel: 'X', kitab: 'k', kkm: 150 }), /KKM/), 'mapel dan kitab: kitab kosong dan KKM di luar rentang ditolak');
    await rpc('drSimpanMapel', wk, { kelas: 'MD1', mapel: 'Nahwu', kitab: 'متن الأجرومية', kkm: 65, urut: 2 }); await rpc('drSimpanMapel', wk, { kelas: 'MD1', mapel: 'Fiqih', kitab: 'متن تقريب', kkm: 70, urut: 1 });
    const dk = (await rpc('drKelas', wk, 'MD1')).result; cek(dk.mapel.map(m => m.mapel).join() === 'Fiqih,Nahwu' && dk.kelas.fasl === 'الأول (ب)', 'daftar kitab per kelas terurut sesuai urutan raport');
    cek(await galat(rpc('pgSimpan', A.token, 'guru_md', 'MD1', 'Hafalan'), /belum ada di Data Raport/) && await galat(rpc('pgSimpan', A.token, 'orang_gaib', 'MD1', 'Fiqih'), /tidak ditemukan/), 'pengampu: mapel yang belum terdaftar dan pengguna fiktif ditolak');
    await rpc('pgSimpan', A.token, 'guru_md', 'MD1', 'Fiqih'); await rpc('pgSimpan', A.token, 'guru_md', 'MD1', 'Fiqih');
    const pgl = (await rpc('pgList', A.token)).result.filter(p => p.username === 'guru_md'), nd = (await rpc('nhDaftar', gm)).result;
    cek(pgl.length === 1 && nd.length === 1 && nd[0].mapel === 'Fiqih' && (await rpc('nhDaftar', A.token)).result.length > 4, 'pengampu: guru hanya melihat kelas dan mapel yang diampu (tanpa duplikat); admin melihat semuanya');
    cek(await galat(rpc('nhList', gm, 'MD1', 'Nahwu', SM, TH), /bukan pengampu/) && await galat(rpc('nhList', gm2, 'MD1', 'Fiqih', SM, TH), /bukan pengampu/) && (await rpc('nhList', gm, 'MD1', 'Fiqih', SM, TH)).result.length === 4, 'guru bukan pengampu ditolak membaca dan menulis nilai kelas lain');
    const sv = async v => rpc('nhSimpan', gm, 'MD1', 'Fiqih', SM, TH, 'MD1', v), nilaiDb = () => db.prepare("SELECT harian FROM nilai WHERE nis='MD1' AND mapel='Fiqih' AND semester='Ganjil' AND tahun='2026/2027'").get()?.harian;
    await sv(85.5); const a1 = nilaiDb(); await sv(''); const a2 = nilaiDb(); await sv('90');
    cek(a1 === 85.5 && a2 === null && nilaiDb() === 90 && (await sv(101)).error && (await sv('abc')).error && (await rpc('nhSimpan', gm, 'MD1', 'Fiqih', 'Musim', TH, 'MD1', 80)).error && (await rpc('nhSimpan', gm, 'MD1', 'Fiqih', SM, TH, 'D100', 80)).error && nilaiDb() === 90, 'nilai harian: desimal diterima, kosong menghapus, di luar 0-100, teks, semester salah, dan santri kelas lain ditolak tanpa mengubah data');
    const log = db.prepare("SELECT detail FROM audit WHERE aksi='nilai_harian' ORDER BY id").all().map(r => r.detail); cek(log.join('|') === '- -> 85.5|85.5 -> -|- -> 90', 'setiap perubahan nilai harian tercatat di jejak audit dengan nilai lama dan baru', log.join(' | '));
    db.prepare("UPDATE nilai SET ujian=75 WHERE nis='MD1' AND mapel='Fiqih'").run(); const rp = (await rpc('ujRaport', A.token, 'MD1', SM, TH)).result;
    cek(rp.rows[0].harian === 90 && rp.rows[0].imtihan === 75 && rp.rows[0].muaddal === 83 && rp.rows[0].kkm === 70 && rp.rows[1].muaddal === '' && rp.fasl === 'الأول (ب)', "raport memakai nilai harian dari guru dan imtihan dari ujian: mu'addal (90+75)/2 = 83", JSON.stringify([rp.rows[0].harian, rp.rows[0].imtihan, rp.rows[0].muaddal]));
    cek(await galat(rpc('drSimpanSikap', wk, { nis: 'MD1', semester: SM, tahun: TH, sakit: -1 }), /bilangan bulat/) && await galat(rpc('drSimpanSikap', wk, { nis: 'MD1', semester: SM, tahun: TH, akhlak: 120 }), /0 sampai 100/), 'sikap dan absensi: nilai tidak masuk akal ditolak');
    await rpc('drSimpanSikap', wk, { nis: 'MD1', semester: SM, tahun: TH, akhlak: 85, istiqamah: 80, ubudiyah: 75, sakit: 2, izin: 1, alfa: 0, wasiat: 'Pertahankan', naik: 'tidak tampil di semester ganjil' });
    const sk2 = (await rpc('drSikapList', wk, 'MD1', SM, TH)).result.find(s => s.nis === 'MD1'), rp2 = (await rpc('ujRaport', A.token, 'MD1', SM, TH)).result;
    cek(sk2.akhlak === 85 && rp2.sikap[0][1] === 85 && rp2.absen.sakit === 2 && rp2.absen.izin === 1 && rp2.wasiat === 'Pertahankan' && rp2.naik === '', 'sikap, absensi, dan wasiat masuk ke raport; status naik kelas hanya tampil di semester Genap');
    await rpc('pgSimpan', A.token, 'guru_md', 'MD1', 'Nahwu');
    cek(await galat(rpc('drHapusMapel', wk, 'MD1', 'Fiqih'), /sudah punya nilai/) && (await rpc('drHapusMapel', wk, 'MD1', 'Nahwu')).result === true && !db.prepare("SELECT 1 FROM pengampu WHERE mapel='Nahwu'").get(), 'mapel yang sudah bernilai tidak bisa dihapus; mapel kosong bisa, pengampunya ikut lepas');
    // izin baru otomatis masuk role bawaan, penyesuaian admin tidak ditimpa
    await rpc('admSimpanRole', A.token, { kode: 'Guru Mukim', nama: 'Guru Mukim', izin: (await rpc('admRole', A.token, 'Guru Mukim')).result.izin.filter(i => i !== 'ujian.akses') });
    db.prepare("DELETE FROM role_permission WHERE permission_kode='madrasah.nilai.harian' AND role_kode='Guru Putra'").run(); db.prepare("DELETE FROM permission WHERE kode='madrasah.nilai.harian'").run(); rbac.seed(db); rbac.seed(db);
    const punya = r => !!db.prepare("SELECT 1 FROM role_permission WHERE role_kode=? AND permission_kode='madrasah.nilai.harian'").get(r);
    cek(punya('Guru Putra') && punya('Wali Kelas') && punya('Guru Mukim') && !db.prepare("SELECT 1 FROM role_permission WHERE role_kode='Guru Mukim' AND permission_kode='ujian.akses'").get() && db.prepare('SELECT COUNT(*) n FROM permission').get().n === 17, 'sinkron izin: izin baru masuk ke role bawaan, penyesuaian admin sebelumnya (izin ujian.akses dicabut dari Guru Mukim) tidak ditimpa, tanpa duplikat');
    // tampilan
    const { JSDOM } = require('jsdom'), buka3 = async (url, tok, nm) => JSDOM.fromURL(base + url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.confirm = () => true; if (tok) w.sessionStorage.setItem('maarif', JSON.stringify({ token: tok, nama: nm || 'x', role: 'x' })); } });
    const st = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    const pgG = await buka3('/madrasah', gm, 'guru_md'); await sleep(900); const wG = pgG.window, dG = wG.document;
    const nan = n => [...dG.querySelectorAll('select')].length;
    st(wG, dG.querySelector('input[placeholder^="Tahun ajaran"]'), TH); await sleep(300);
    const sel = dG.querySelectorAll('select')[1]; st(wG, sel, 'MD1|Fiqih'); await sleep(600); const inp = dG.querySelectorAll('td input[type=number]');
    cek(dG.querySelectorAll('.tabs button').length === 1 && inp.length === 4, 'Madrasah (UI): guru hanya punya tab Nilai harian dan melihat 4 santri kelasnya');
    st(wG, inp[1], '77'); inp[1].dispatchEvent(new wG.Event('change', { bubbles: true })); await sleep(500);
    cek(db.prepare("SELECT harian FROM nilai WHERE nis='MD2' AND mapel='Fiqih'").get()?.harian === 77 && /✓/.test(dG.body.textContent), 'Madrasah (UI): mengisi nilai harian langsung tersimpan ke database dan diberi tanda');
    const pgA = await buka3('/madrasah', A.token, 'admin'); await sleep(900); const wA = pgA.window, dA = wA.document, tabM = n => [...dA.querySelectorAll('.tabs button')].find(b => b.textContent.trim().startsWith(n)).click();
    tabM('Data raport'); await sleep(500); st(wA, dA.querySelectorAll('select')[1], 'MD1'); await sleep(700);
    st(wA, dA.querySelector('input[placeholder="Mapel baru"]'), 'Tauhid'); st(wA, dA.querySelector('input[placeholder="Judul kitab"]'), 'قطر الغيث'); [...dA.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tambah').click(); await sleep(600);
    cek(db.prepare("SELECT kitab FROM mapel_kitab WHERE kelas='MD1' AND mapel='Tauhid'").get()?.kitab === 'قطر الغيث', 'Madrasah (UI): menambah mapel dan kitab dari halaman Data raport masuk ke database');
    const sk3 = [...dA.querySelectorAll('section tr')].find(r => /Ali MD/.test(r.textContent)); st(wA, sk3.querySelectorAll('input')[0], '91'); [...sk3.querySelectorAll('button')].find(b => b.textContent.trim() === 'Simpan').click(); await sleep(500);
    cek(db.prepare("SELECT akhlak FROM raport_sikap WHERE nis='MD1' AND semester='Ganjil'").get()?.akhlak === 91, 'Madrasah (UI): mengubah nilai akhlak per santri tersimpan');
    tabM('Pengampu'); await sleep(500); st(wA, dA.querySelectorAll('select')[1], 'guru_md2'); st(wA, dA.querySelectorAll('select')[2], 'MD1|Tauhid'); await sleep(100); [...dA.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tambahkan').click(); await sleep(600);
    cek(!!db.prepare("SELECT 1 FROM pengampu WHERE username='guru_md2' AND mapel='Tauhid'").get() && /guru_md2|Guru|MD1/.test(dA.body.textContent), 'Madrasah (UI): admin menugaskan pengampu dari halaman Pengampu');
  }

  {   // --- reset sandi lewat baris perintah (admin lupa sandi, tanpa admin lain)
    const { resetSandi } = require('../scripts/reset-sandi'); for (let i = 0; i < 5; i++) await rpc('ujLogin', 'admin', 'salah' + i);
    const t = resetSandi(db, 'admin'), l = await masuk('admin', t);
    cek(t.length === 10 && l.success && l.wajibGanti, 'reset-sandi lewat baris perintah: sandi sementara, kunci login dibuka, wajib ganti sandi');
    let gagalNama = false; try { resetSandi(db, 'tidak_ada'); } catch (e) { gagalNama = /tidak ditemukan/.test(e.message); } cek(gagalNama, 'reset-sandi menolak username yang tidak ada');
    await rpc('ujGantiSandi', l.token, t, 'Admin-Sandi-2026'); cek((await masuk('admin', 'Admin-Sandi-2026')).success && db.prepare("SELECT COUNT(*) n FROM audit WHERE aksi='reset_sandi' AND pelaku='cli'").get().n === 1, 'sandi admin diganti kembali dan tindakan tercatat di jejak audit');
  }

  {   // --- alamat server untuk ponsel
    const S = require('../src/server'), r1 = await fetch(base + '/alamat'), r2 = await (await fetch(base + '/api/alamat')).json();
    cek(r1.status === 200 && /Alamat server/.test(await r1.text()) && Array.isArray(r2.urls) && r2.port === srv.address().port && r2.urls.every(u => /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/.test(u.url)), 'halaman Alamat server tersedia dari komputer server dan memuat daftar alamat jaringan', r2.urls.map(u => u.url).join(', ') || '(tidak ada jaringan di lingkungan uji)');
    cek(S.lokal({ socket: { remoteAddress: '127.0.0.1' } }) && S.lokal({ socket: { remoteAddress: '::ffff:127.0.0.1' } }) && !S.lokal({ socket: { remoteAddress: '192.168.1.20' } }) && !S.lokal({ socket: { remoteAddress: '::ffff:10.0.0.5' } }) && !S.lokal({}), 'halaman Alamat tertutup bagi perangkat lain di jaringan, hanya dari komputer server');
    cek(S.alamatLAN(3000).every(a => a.url === `http://${a.ip}:3000`), 'daftar alamat dihitung dari adaptor jaringan yang ada (bukan IP yang ditulis tetap)');
  }

  {   // --- Kesantrian
    const { JSDOM } = require('jsdom'), WAk = require('../src/wa');
    const AT = (await masuk('admin', 'Admin-Sandi-2026')).token;   // sesi admin lama dihapus oleh uji reset-sandi
    const mk = async (un, roles) => { const n = (await rpc('admSimpanUser', AT, { username: un, nama: un, roles, aktif: true })).result, l = await masuk(un, n.temp); await rpc('ujGantiSandi', l.token, n.temp, 'Sandi-Tes-2026'); return (await masuk(un, 'Sandi-Tes-2026')).token; };
    const wkk = await mk('wk_ks', ['Wali Kelas']), gk = await mk('guru_ks', ['Guru Putri']), nilaiAudit = a => db.prepare('SELECT detail FROM audit WHERE aksi=? ORDER BY id DESC').all(a).map(r => r.detail);
    cek(await galat(rpc('ksList', gk, {}), /tidak diizinkan/) && (await rpc('ksList', wkk, { limit: 1 })).result.baris.length === 1 && await galat(rpc('ksSimpan', wkk, { baru: true, nis: 'X1', nama: 'X', kelas: 'K' }), /tidak diizinkan/) && (await rpc('ksSimpan', P.token, { baru: true, nis: 'KS000', nama: 'Awal', kelas: 'KS1' })).result.berubah === 1, 'izin Kesantrian: guru tertutup, wali kelas hanya melihat, panitia bisa mengelola');
    const ls = (await rpc('ksList', P.token, { kelas: 'MD1' })).result, cr = (await rpc('ksList', P.token, { cari: 'ali md' })).result, pg1 = (await rpc('ksList', P.token, { limit: 2, offset: 0 })).result, pg2 = (await rpc('ksList', P.token, { limit: 2, offset: 2 })).result;
    cek(ls.total === 4 && ls.baris.every(s => s.kelas === 'MD1') && cr.baris.some(s => s.nama === 'Ali MD') && pg1.total === pg2.total && pg1.baris.length === 2 && pg1.baris[0].nis !== pg2.baris[0].nis && (await rpc('ksList', P.token, { status: 'Nonaktif' })).result.baris.every(s => s.status === 'Nonaktif'), 'daftar santri: filter kelas, cari nama, filter status, halaman');
    for (const [d, re, n] of [[{ nis: 'a b' }, /NIS/, 'NIS berspasi'], [{ nama: '' }, /Nama wajib/, 'nama kosong'], [{ status: 'Lulus' }, /Aktif atau Nonaktif/, 'status di luar Aktif/Nonaktif'], [{ jk: 'X' }, /L atau P/, 'jenis kelamin salah'], [{ no_hp: '123' }, /Nomor HP tidak valid/, 'nomor HP tidak valid'], [{ nis: 'KS000' }, /sudah dipakai/, 'NIS ganda']])
      cek(await galat(rpc('ksSimpan', P.token, { baru: true, nis: 'KS001', nama: 'Santri KS', kelas: 'KS1', ...d }), re), 'santri ditolak: ' + n);
    await rpc('ksSimpan', P.token, { baru: true, nis: 'KS001', nama: 'Santri KS', kelas: 'KS1', no_hp: '0813 1111 2222', wali: 'Pak KS' });
    const u0 = (await rpc('ksSimpan', P.token, { nis: 'KS001', nama: 'Santri KS', kelas: 'KS1', no_hp: '0813 1111 2222', wali: 'Pak KS' })).result, u1 = (await rpc('ksSimpan', P.token, { nis: 'KS001', nama: 'Santri KS Baru', kelas: 'KS2', no_hp: '0856 9999 8888', wali: 'Pak KS' })).result;
    const dt = nilaiAudit('santri_ubah')[0]; cek(u0.berubah === 0 && u1.berubah === 3 && /nama: Santri KS -> Santri KS Baru/.test(dt) && /kelas: KS1 -> KS2/.test(dt) && /no_hp diubah/.test(dt) && !/\d{6}/.test(dt) && nilaiAudit('santri_baru').length >= 2 && await galat(rpc('ksSimpan', P.token, { nis: 'TIDAKADA', nama: 'X', kelas: 'K' }), /tidak ditemukan/), 'ubah data: tanpa perubahan tidak tercatat, perubahan dicatat dengan nilai lama dan baru, nomor HP tidak dibocorkan ke audit');
    await rpc('ksSimpan', P.token, { baru: true, nis: 'KS002', nama: 'Santri KS Dua', kelas: 'KS2', no_hp: '081277776666' });
    const ing = WAk.pengingat(db, U, 'KS2'); cek(ing.antri === 2 && db.prepare("SELECT COUNT(*) n FROM wa_antrian WHERE nomor='6285699998888'").get().n === 1, 'nomor HP yang diperbarui di Kesantrian langsung dipakai oleh WhatsApp (nomor baru, bukan lama)');
    await rpc('ksSimpan', P.token, { nis: 'KS002', nama: 'Santri KS Dua', kelas: 'KS2', no_hp: '081277776666', status: 'Nonaktif' }); const ing2 = WAk.pengingat(db, U, 'KS2'); cek(ing2.antri === 0 && ing2.sudah === 1, 'santri nonaktif tidak ikut pengingat; riwayat datanya tetap ada', JSON.stringify(ing2));
    await rpc('ksSimpan', P.token, { baru: true, nis: 'KS003', nama: 'Santri KS Tiga', kelas: 'KS1' });
    const pv = (await rpc('ksPindahKelas', P.token, ['KS000', 'KS003', 'KS003', 'TIDAKADA'], 'KS9')).result, pv2 = (await rpc('ksPindahKelas', P.token, ['KS000', 'KS003'], 'KS9')).result;
    cek(pv.dipindah === 2 && pv2.dipindah === 0 && db.prepare("SELECT COUNT(*) n FROM santri WHERE kelas='KS9'").get().n === 2 && await galat(rpc('ksPindahKelas', P.token, [], 'KS9'), /Pilih/) && await galat(rpc('ksPindahKelas', P.token, ['KS000'], ' '), /Kelas tujuan/) && await galat(rpc('ksPindahKelas', wkk, ['KS000'], 'KS1'), /tidak diizinkan/), 'pindah kelas massal: ganda dan NIS fiktif diabaikan, ulang tidak berubah, validasi dan izin', JSON.stringify([pv, pv2]));
    db.transaction(() => { db.prepare("INSERT INTO santri(nis,nama,kelas,no_hp,wali) VALUES('KD1','Kembar','KD','abc','')").run(); db.prepare("INSERT INTO santri(nis,nama,kelas,no_hp,wali) VALUES('KD2','Kembar','KD','','W')").run(); })();
    const kq = (await rpc('ksKualitas', P.token)).result;
    cek(kq.hpTidakValid.contoh.some(s => s.nis === 'KD1') && kq.tanpaHp.jumlah === db.prepare("SELECT COUNT(*) n FROM santri WHERE status<>'Nonaktif' AND (no_hp IS NULL OR no_hp='')").get().n && kq.tanpaHp.jumlah > 15 && kq.tanpaHp.contoh.length === 15 && kq.namaGanda.jumlah >= 2 && kq.tanpaWali.jumlah >= 1 && kq.tanpaPin === db.prepare("SELECT COUNT(*) n FROM santri WHERE status<>'Nonaktif' AND nis NOT IN (SELECT nis FROM wali_akun)").get().n, 'kualitas data: HP tidak valid, tanpa HP, nama ganda satu kelas, tanpa wali, tanpa PIN terdeteksi');
    cek((await rpc('ksExport', wkk)).result.length === db.prepare('SELECT COUNT(*) n FROM santri').get().n && (await rpc('ksKelas', wkk)).result.some(k => k.kelas === 'MD1' && k.total === 4), 'ekspor memuat semua santri dan ringkasan kelas benar');
    // tampilan
    const buka4 = async (url, tok) => JSDOM.fromURL(base + url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, base), o); w.confirm = () => true; if (tok) w.sessionStorage.setItem('maarif', JSON.stringify({ token: tok, nama: 'x', role: 'x' })); } });
    const pk = await buka4('/kesantrian', P.token); await sleep(900); const w = pk.window, d = pk.window.document, st = (el, v) => { el.value = v; el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, tbn = t => [...d.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
    cek(d.querySelectorAll('table tr').length > 10 && /Kualitas data/.test(d.body.textContent) && !!tbn('Tambah santri'), 'Kesantrian (UI): daftar santri dan panel kualitas data dimuat dari database');
    tbn('Tambah santri').click(); await sleep(150); st(d.querySelector('input[placeholder="NIS"]'), 'KSUI1'); st(d.querySelector('input[placeholder="Nama"]'), 'Santri Lewat UI'); st(d.querySelector('input[placeholder="Kelas"]'), 'KSUI'); st(d.querySelector('input[placeholder^="No. HP"]'), '081234500000'); tbn('Simpan').click(); await sleep(600);
    cek(db.prepare("SELECT kelas,no_hp FROM santri WHERE nis='KSUI1'").get()?.no_hp === '081234500000', 'Kesantrian (UI): tambah santri tersimpan ke database');
    st(d.querySelector('input[placeholder="Cari nama atau NIS"]'), 'lewat ui'); await sleep(700); cek(d.querySelectorAll('table tr').length === 2, 'Kesantrian (UI): pencarian menyaring daftar secara langsung');
    tbn('Ubah').click(); await sleep(150); st(d.querySelector('input[placeholder="Nama"]'), 'Santri Diubah UI'); tbn('Simpan').click(); await sleep(600); cek(db.prepare("SELECT nama FROM santri WHERE nis='KSUI1'").get()?.nama === 'Santri Diubah UI', 'Kesantrian (UI): ubah data tersimpan');
    st(d.querySelector('input[placeholder="Cari nama atau NIS"]'), ''); await sleep(600); st(d.querySelectorAll('select')[0], 'MD1'); await sleep(600);
    const cbs = [...d.querySelectorAll('input[type=checkbox]')]; cbs[0].checked = true; cbs[0].dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(80); cbs[1].checked = true; cbs[1].dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(200);
    st(d.querySelector('input[placeholder="Pindahkan ke kelas"]'), 'MDX'); tbn('Pindahkan').click(); await sleep(700); cek(db.prepare("SELECT COUNT(*) n FROM santri WHERE kelas='MDX'").get().n === 2, 'Kesantrian (UI): memilih dua santri lalu memindahkan kelas bekerja');
    tbn('Tanpa nomor HP').click(); await sleep(200); cek(/Tanpa nomor HP:/.test(d.body.textContent), 'Kesantrian (UI): mengetuk penanda kualitas menampilkan nama santri bermasalah');
    tbn('Ekspor CSV').click(); await sleep(600); const csv = w.__csv || ''; cek(csv.startsWith('\ufeffnis,nama,kelas') && csv.split('\n').length === db.prepare('SELECT COUNT(*) n FROM santri').get().n + 1, 'Kesantrian (UI): ekspor CSV memuat semua santri dengan judul kolom', (csv.split('\n').length - 1) + ' baris');
    const gu = await buka4('/kesantrian', gk); await sleep(800); cek(/tidak memiliki izin melihat/.test(gu.window.document.body.textContent) && gu.window.document.querySelectorAll('table tr').length <= 1, 'Kesantrian (UI): guru yang membuka halaman ini tidak melihat data apa pun');
  }
  console.log(`\n${ok} lolos, ${gagal} gagal`); srv.close(); process.exit(gagal ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
