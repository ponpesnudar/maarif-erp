// Fungsi-fungsi RPC. Nama dan bentuk hasil sengaja sama dengan versi Apps Script agar tampilan ujian bisa dipakai ulang.
const crypto = require('crypto');
const A = require('./auth'), { Galat, ADMIN, VERIF, STAFF } = A, WA = require('./wa'), BK = require('./backup'), { config } = require('./config');
const KITAB_MIN = 60;
const id = () => crypto.randomBytes(4).toString('hex');
const nowStr = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16);
const aspek = s => String(s).startsWith('PG:') ? [{ n: 'Skor PG (0-100)', m: 100 }] : String(s).split(',').map(a => { const p = a.split(':'); return { n: p[0].trim(), m: Number(p[1]) || 0 }; });
const H = {};
const rolesOf = (db, uid) => db.prepare('SELECT role FROM user_roles WHERE user_id=?').all(uid).map(r => r.role);
function notif(db, username, judul, isi) { db.prepare('INSERT INTO notifikasi(username,judul,isi,waktu) VALUES(?,?,?,?)').run(username, judul, isi, nowStr()); }
function notifPeran(db, izin, judul, isi) {   // semua pengguna aktif yang memiliki izin tsb
  db.prepare(`SELECT DISTINCT u.username FROM users u JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN role_permission rp ON rp.role_kode=ur.role
    WHERE u.aktif=1 AND (ur.role='Admin' OR rp.permission_kode=?)`).all(izin).forEach(u => notif(db, u.username, judul, isi));
}
const acak = (n, abjad) => Array.from(crypto.randomBytes(n), b => abjad[b % abjad.length]).join('');

// ---------- login dan akun ----------
H.ujLogin = (c, u, p) => {
  const k = 'u_' + String(u || '').toLowerCase();
  if (A.kunciAktif(c.db, k)) return { success: false, msg: 'Terlalu banyak percobaan gagal. Coba lagi sekitar 15 menit lagi.' };
  const r = u ? c.db.prepare('SELECT * FROM users WHERE username=? AND aktif=1').get(u) : null;
  if (!r || !A.cocok(r.password_hash, p)) { A.gagal(c.db, k); A.audit(c.db, u, 'login_gagal'); return { success: false, msg: 'Username atau Password salah!' }; }
  A.lulus(c.db, k); const role = rolesOf(c.db, r.id).join(', ');
  A.audit(c.db, r.username, 'login');
  return { success: true, token: A.buatSesi(c.db, { username: r.username, nama: r.nama, role, terbatas: r.wajib_ganti }), nama: r.nama, role, wajibGanti: !!r.wajib_ganti };
};
H.ujWaliLogin = (c, nis, pin) => {
  const k = 'wali_' + nis;
  if (A.kunciAktif(c.db, k)) return { success: false, msg: 'Terlalu banyak percobaan gagal. Coba lagi sekitar 15 menit lagi.' };
  const r = c.db.prepare('SELECT s.nis, s.nama, w.pin_hash FROM wali_akun w JOIN santri s ON s.nis=w.nis WHERE w.nis=?').get(String(nis));
  if (!r || !A.cocok(r.pin_hash, pin)) { A.gagal(c.db, k); A.audit(c.db, 'wali:' + nis, 'login_gagal'); return { success: false, msg: 'NIS atau PIN salah.' }; }
  A.lulus(c.db, k); A.audit(c.db, 'wali:' + nis, 'login');
  return { success: true, token: A.buatSesi(c.db, { nis: r.nis, nama: r.nama, role: 'Wali' }), nama: r.nama, role: 'Wali' };
};
H.ujGantiSandi = (c, lama, baru) => {
  const s = c.s;
  if (s.role === 'Wali') {
    const k = 'wali_' + s.nis; if (A.kunciAktif(c.db, k)) return { success: false, msg: 'Terlalu banyak percobaan gagal. Coba lagi sekitar 15 menit lagi.' };
    const w = c.db.prepare('SELECT pin_hash FROM wali_akun WHERE nis=?').get(s.nis);
    if (!w || !A.cocok(w.pin_hash, lama)) { A.gagal(c.db, k); return { success: false, msg: 'PIN saat ini tidak sesuai.' }; }
    const m = A.kebijakan(baru, '', true); if (m) return { success: false, msg: m };
    c.db.prepare('UPDATE wali_akun SET pin_hash=? WHERE nis=?').run(A.hash(baru), s.nis); A.lulus(c.db, k); A.audit(c.db, 'wali:' + s.nis, 'ganti_pin');
    return { success: true, msg: 'PIN berhasil diubah.' };
  }
  const k = 'u_' + s.username.toLowerCase(); if (A.kunciAktif(c.db, k)) return { success: false, msg: 'Terlalu banyak percobaan gagal. Coba lagi sekitar 15 menit lagi.' };
  const u = c.db.prepare('SELECT * FROM users WHERE username=?').get(s.username);
  if (!A.cocok(u.password_hash, lama)) { A.gagal(c.db, k); return { success: false, msg: 'Password lama tidak sesuai!' }; }
  const m = A.kebijakan(baru, u.username, false); if (m) return { success: false, msg: m };
  if (lama === baru) return { success: false, msg: 'Password baru harus berbeda dari yang lama.' };
  c.db.prepare('UPDATE users SET password_hash=?, wajib_ganti=0 WHERE id=?').run(A.hash(baru), u.id); c.db.prepare('UPDATE sesi SET terbatas=0 WHERE username=?').run(u.username); A.lulus(c.db, k); A.audit(c.db, u.username, 'ganti_sandi');
  return { success: true, msg: 'Password berhasil diubah!' };
};
H.ujResetSandi = (c, username) => {
  A.peran(c.s, 'administrator.user.reset'); const u = c.db.prepare('SELECT * FROM users WHERE username=?').get(String(username || ''));
  if (!u) return { success: false, msg: 'Username tidak ditemukan.' };
  const t = acak(8, 'abcdefghjkmnpqrstuvwxyz23456789');
  c.db.prepare('UPDATE users SET password_hash=?, wajib_ganti=1 WHERE id=?').run(A.hash(t), u.id); A.lulus(c.db, 'u_' + u.username.toLowerCase()); A.audit(c.db, c.s.username, 'reset_sandi', u.username);
  return { success: true, temp: t, msg: 'Sandi sementara dibuat untuk ' + u.username + '.' };
};
H.ujBuatPinWali = (c, kelas, ulang) => {
  A.peran(c.s, ADMIN); const out = [];
  const ada = c.db.prepare('SELECT 1 FROM wali_akun WHERE nis=?'), up = c.db.prepare('INSERT INTO wali_akun(nis,pin_hash) VALUES(?,?) ON CONFLICT(nis) DO UPDATE SET pin_hash=excluded.pin_hash');
  c.db.transaction(() => c.db.prepare("SELECT nis,nama FROM santri WHERE kelas=? AND status<>'Nonaktif' ORDER BY nama").all(kelas).forEach(s => {
    if (ada.get(s.nis) && !ulang) return; const pin = acak(6, '0123456789'); up.run(s.nis, A.hash(pin)); A.lulus(c.db, 'wali_' + s.nis); out.push({ nis: s.nis, nama: s.nama, pin });
  }))();
  A.audit(c.db, c.s.username, 'buat_pin_wali', kelas, out.length + ' PIN'); return out;
};

// ---------- data awal, ujian, item ----------
H.ujData = c => {
  A.peran(c.s, STAFF); const admin = A.punya(c.s, ADMIN), verif = A.punya(c.s, VERIF);
  let items = c.db.prepare(`SELECT i.id ID, i.ujian_id ID_Ujian, i.kelas Kelas, i.mapel Mapel, i.jenis Jenis, i.penguji Penguji, i.aspek Aspek, COALESCE(v.status,'Draft') Status
    FROM ujian_item i LEFT JOIN ujian_verif v ON v.item_id=i.id ORDER BY i.rowid`).all();
  if (!admin && !verif) items = items.filter(i => i.Penguji === c.s.username);
  return { ujian: c.db.prepare('SELECT id ID, nama Nama, semester Semester, tahun Tahun, tgl_mulai Tgl_Mulai, tgl_selesai Tgl_Selesai, status Status FROM ujian ORDER BY rowid').all(), items,
    santri: c.db.prepare('SELECT nis NIS, nama Nama, kelas Kelas, status Status, no_hp No_HP FROM santri ORDER BY kelas, nama').all(), bisaAtur: admin, bisaVerif: verif, izin: [...c.s.izin] };
};
H.ujSimpanUjian = (c, d) => {
  A.peran(c.s, ADMIN); if (!d || !String(d.nama || '').trim() || !d.semester || !d.tahun) throw new Galat('Nama, semester, dan tahun ajaran wajib diisi.');
  const i = id(); c.db.prepare('INSERT INTO ujian(id,nama,semester,tahun,tgl_mulai,tgl_selesai) VALUES(?,?,?,?,?,?)').run(i, d.nama.trim(), d.semester, d.tahun, d.mulai || null, d.selesai || null);
  A.audit(c.db, c.s.username, 'buat_ujian', i, d.nama); return true;
};
H.ujSimpanItem = (c, d) => {
  A.peran(c.s, ADMIN); d = d || {};
  if (!c.db.prepare('SELECT 1 FROM ujian WHERE id=?').get(d.idUjian)) throw new Galat('Pilih ujian dulu.');
  if (!['Tulis', 'PG', 'Lisan', 'Praktek', 'Kitab'].includes(d.jenis)) throw new Galat('Jenis penilaian tidak dikenal.');
  if (!String(d.kelas || '').trim() || !String(d.mapel || '').trim()) throw new Galat('Kelas dan mapel wajib diisi.');
  if (!c.db.prepare('SELECT 1 FROM users WHERE username=? AND aktif=1').get(d.penguji || '')) throw new Galat('Penguji tidak ada di daftar akun.');
  const a = String(d.aspek || '').replace(/\s/g, '') ? String(d.aspek).trim() : '';
  if (d.jenis === 'PG' ? !/^PG:[A-Za-z]+$/.test(a.replace(/\s/g, '')) : !a || aspek(a).some(x => !x.m)) throw new Galat(d.jenis === 'PG' ? 'Untuk PG isi kunci seperti PG:ABCDA.' : 'Format aspek: Soal 1:30,Soal 2:70 (angka = nilai maksimal).');
  const i = id(); c.db.prepare('INSERT INTO ujian_item(id,ujian_id,kelas,mapel,jenis,penguji,aspek) VALUES(?,?,?,?,?,?,?)').run(i, d.idUjian, d.kelas.trim(), d.mapel.trim(), d.jenis, d.penguji, a);
  A.audit(c.db, c.s.username, 'buat_item', i, d.mapel + ' ' + d.kelas); return true;
};

// ---------- daftar hadir ----------
function kitabKurang(db, idU, sn) {
  for (const it of db.prepare("SELECT id,mapel FROM ujian_item WHERE ujian_id=? AND kelas=? AND jenis='Kitab'").all(idU, sn.kelas)) {
    const s = db.prepare('SELECT total FROM ujian_skor WHERE item_id=? AND nis=?').get(it.id, sn.nis);
    if (!s) return it.mapel + ' belum dinilai';
    if (s.total < KITAB_MIN) return `${it.mapel} ${s.total} (minimal ${KITAB_MIN})`;
  }
  return '';
}
H.ujHadirList = (c, idU) => { A.peran(c.s, STAFF); return c.db.prepare('SELECT ujian_id ID_Ujian, nis NIS, ruang Ruang, status Status, waktu Waktu, pencatat Pencatat FROM ujian_hadir WHERE ujian_id=?').all(idU); };
H.ujCatatHadir = (c, idU, nis, status, ruang, paksa) => {
  A.peran(c.s, STAFF); const sn = c.db.prepare('SELECT * FROM santri WHERE nis=?').get(String(nis));
  if (!sn) return { success: false, msg: 'NIS ' + nis + ' tidak ditemukan.' };
  if (!c.db.prepare('SELECT 1 FROM ujian WHERE id=?').get(idU)) throw new Galat('Pilih ujian dulu.');
  if (!['Hadir', 'Izin', 'Sakit', 'Alfa'].includes(status)) throw new Galat('Status tidak dikenal.');
  if (status === 'Hadir' && !(paksa && A.punya(c.s, ADMIN))) { const k = kitabKurang(c.db, idU, sn); if (k) return { success: false, syarat: true, msg: sn.nama + ' belum memenuhi syarat kitab: ' + k }; }
  c.db.prepare('INSERT INTO ujian_hadir(ujian_id,nis,ruang,status,waktu,pencatat) VALUES(?,?,?,?,?,?) ON CONFLICT(ujian_id,nis) DO UPDATE SET ruang=excluded.ruang,status=excluded.status,waktu=excluded.waktu,pencatat=excluded.pencatat')
    .run(idU, sn.nis, ruang || null, status, nowStr(), c.s.nama);
  return { success: true, nama: sn.nama };
};
H.ujRuangSelesai = (c, idU, ruang) => {
  A.peran(c.s, STAFF);
  const per = c.db.prepare("SELECT s.kelas, COUNT(*) n FROM ujian_hadir h JOIN santri s ON s.nis=h.nis WHERE h.ujian_id=? AND h.ruang=? AND h.status='Hadir' GROUP BY s.kelas").all(idU, ruang);
  per.forEach(p => c.db.prepare('SELECT mapel,jenis,penguji FROM ujian_item WHERE ujian_id=? AND kelas=?').all(idU, p.kelas)
    .forEach(i => notif(c.db, i.penguji, 'Santri selesai mengerjakan', `Ruang ${ruang}: ${p.n} santri kelas ${p.kelas} selesai (${i.mapel}, ${i.jenis}). Lembar siap dikoreksi.`)));
  return true;
};

// ---------- penilaian ----------
const itemDari = (db, i) => { const r = db.prepare('SELECT * FROM ujian_item WHERE id=?').get(i); if (!r) throw new Galat('Item tidak ditemukan.'); return r; };
H.ujSkorList = (c, idItem) => {
  A.peran(c.s, STAFF); const it = itemDari(c.db, idItem);
  if (it.penguji !== c.s.username && !A.punya(c.s, VERIF)) throw new Galat('Bukan penguji item ini.');
  const v = c.db.prepare('SELECT status,alasan FROM ujian_verif WHERE item_id=?').get(idItem);
  const santri = c.db.prepare(`SELECT s.nis, s.nama, COALESCE(h.status,'') hadir, k.detail, k.total FROM santri s
    LEFT JOIN ujian_hadir h ON h.nis=s.nis AND h.ujian_id=? LEFT JOIN ujian_skor k ON k.nis=s.nis AND k.item_id=? WHERE s.kelas=? ORDER BY s.nama`).all(it.ujian_id, idItem, it.kelas)
    .map(r => ({ nis: r.nis, nama: r.nama, hadir: r.hadir, detail: r.detail ? JSON.parse(r.detail) : [], total: r.total === null ? '' : r.total }));
  return { item: { ID: it.id, ID_Ujian: it.ujian_id, Kelas: it.kelas, Mapel: it.mapel, Jenis: it.jenis, Penguji: it.penguji, Aspek: it.aspek }, aspek: aspek(it.aspek), santri, status: v ? v.status : 'Draft', alasan: v ? v.alasan || '' : '' };
};
H.ujSimpanSkor = (c, idItem, nis, detail) => {
  A.peran(c.s, STAFF); const it = itemDari(c.db, idItem), asp = aspek(it.aspek);
  if (it.penguji !== c.s.username && !A.punya(c.s, ADMIN)) throw new Galat('Bukan penguji item ini.');
  const v = c.db.prepare('SELECT status FROM ujian_verif WHERE item_id=?').get(idItem); if (v && v.status === 'Disetujui') throw new Galat('Nilai sudah disetujui dan terkunci.');
  if (!c.db.prepare('SELECT 1 FROM santri WHERE nis=? AND kelas=?').get(String(nis), it.kelas)) throw new Galat('Santri bukan anggota kelas ' + it.kelas + '.');
  let sum = 0, max = 0; const bersih = asp.map((a, i) => { const x = Math.max(0, Math.min(a.m, Number(detail && detail[i]) || 0)); sum += x; max += a.m; return x; });
  const total = max ? Math.round(sum / max * 1000) / 10 : 0;
  c.db.prepare('INSERT INTO ujian_skor(item_id,nis,detail,total,penilai,waktu) VALUES(?,?,?,?,?,?) ON CONFLICT(item_id,nis) DO UPDATE SET detail=excluded.detail,total=excluded.total,penilai=excluded.penilai,waktu=excluded.waktu')
    .run(idItem, String(nis), JSON.stringify(bersih), total, c.s.nama, nowStr());
  return total;
};
H.ujAjukan = (c, idItem) => {
  A.peran(c.s, STAFF); const it = itemDari(c.db, idItem);
  if (it.penguji !== c.s.username && !A.punya(c.s, ADMIN)) throw new Galat('Bukan penguji item ini.');
  const v = c.db.prepare('SELECT status FROM ujian_verif WHERE item_id=?').get(idItem); if (v && v.status === 'Disetujui') throw new Galat('Nilai sudah disetujui dan terkunci.');
  c.db.prepare("INSERT INTO ujian_verif(item_id,status,alasan,verifikator,waktu) VALUES(?, 'Menunggu', '', '', ?) ON CONFLICT(item_id) DO UPDATE SET status='Menunggu',alasan='',verifikator='',waktu=excluded.waktu").run(idItem, nowStr());
  notifPeran(c.db, ADMIN, 'Menunggu verifikasi', `${c.s.nama} mengajukan ${it.mapel} (${it.jenis}) kelas ${it.kelas}.`); A.audit(c.db, c.s.username, 'ajukan', idItem); return true;
};

// ---------- verifikasi panitia ----------
H.ujVerifList = c => {
  A.peran(c.s, VERIF);
  return c.db.prepare(`SELECT i.id, i.mapel||' · '||i.jenis||' · kelas '||i.kelas label, i.penguji,
    (SELECT COUNT(*) FROM ujian_skor k WHERE k.item_id=i.id) terisi, (SELECT COUNT(*) FROM santri s WHERE s.kelas=i.kelas) total
    FROM ujian_verif v JOIN ujian_item i ON i.id=v.item_id WHERE v.status='Menunggu' ORDER BY v.waktu`).all();
};
function syncNilai(db, it) {   // nilai imtihan yang disetujui masuk ke tabel nilai (kolom ujian); koreksian kitab bukan nilai
  if (it.jenis === 'Kitab') return; const u = db.prepare('SELECT semester,tahun FROM ujian WHERE id=?').get(it.ujian_id);
  const ok = db.prepare("SELECT i.id FROM ujian_item i JOIN ujian_verif v ON v.item_id=i.id AND v.status='Disetujui' WHERE i.ujian_id=? AND i.kelas=? AND i.mapel=? AND i.jenis<>'Kitab'").all(it.ujian_id, it.kelas, it.mapel).map(r => r.id);
  const up = db.prepare('INSERT INTO nilai(nis,semester,tahun,mapel,ujian) VALUES(?,?,?,?,?) ON CONFLICT(nis,semester,tahun,mapel) DO UPDATE SET ujian=excluded.ujian');
  db.prepare('SELECT nis FROM santri WHERE kelas=?').all(it.kelas).forEach(s => {
    const t = ok.map(i => db.prepare('SELECT total FROM ujian_skor WHERE item_id=? AND nis=?').get(i, s.nis)).filter(Boolean).map(r => r.total);
    if (t.length) up.run(s.nis, u.semester, u.tahun, it.mapel, Math.round(t.reduce((a, b) => a + b, 0) / t.length * 10) / 10);
  });
}
H.ujPutusan = (c, idItem, setuju, alasan) => {
  A.peran(c.s, VERIF); const it = itemDari(c.db, idItem);
  if (!setuju && !String(alasan || '').trim()) throw new Galat('Tulis alasan penolakan.');
  if (!c.db.prepare('SELECT 1 FROM ujian_verif WHERE item_id=?').get(idItem)) throw new Galat('Item belum diajukan.');
  c.db.transaction(() => {
    c.db.prepare('UPDATE ujian_verif SET status=?,alasan=?,verifikator=?,waktu=? WHERE item_id=?').run(setuju ? 'Disetujui' : 'Ditolak', setuju ? '' : alasan, c.s.nama, nowStr(), idItem);
    notif(c.db, it.penguji, setuju ? 'Nilai disetujui' : 'Nilai ditolak', `${it.mapel} (${it.jenis}) kelas ${it.kelas}` + (setuju ? ' sudah final.' : ' ditolak: ' + alasan));
    if (setuju) syncNilai(c.db, it); A.audit(c.db, c.s.username, setuju ? 'setujui' : 'tolak', idItem, alasan);
  })();
  if (setuju) { try { WA.cekTerbit(c.db, it.ujian_id, it.kelas, config()); } catch (e) { console.error('[wa] antrian terbit gagal:', e.message); } }
  return true;
};

// ---------- notifikasi dan portal wali ----------
H.ujNotifList = c => c.db.prepare('SELECT id ID, username Username, judul Judul, isi Isi, dibaca Dibaca, waktu Waktu FROM notifikasi WHERE username=? ORDER BY id DESC LIMIT 40').all(c.s.username || '');
H.ujNotifBaca = c => { c.db.prepare('UPDATE notifikasi SET dibaca=1 WHERE username=? AND dibaca=0').run(c.s.username || ''); return true; };
H.ujWaliNilai = c => {
  A.peran(c.s, 'portal.wali');
  return c.db.prepare(`SELECT u.nama ujian, i.mapel, i.jenis, k.total nilai FROM ujian_skor k JOIN ujian_item i ON i.id=k.item_id JOIN ujian u ON u.id=i.ujian_id
    JOIN ujian_verif v ON v.item_id=i.id AND v.status='Disetujui' WHERE k.nis=? AND i.jenis<>'Kitab' ORDER BY u.rowid, i.mapel`).all(c.s.nis);
};

// ---------- impor hasil scan LJK pilihan ganda ----------
function csvBaris(l) {
  const d = l.split(';').length > l.split(',').length ? ';' : ',', out = []; let cur = '', q = false;
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out;
}
H.ujImporPG = (c, idItem, csv) => {
  A.peran(c.s, STAFF); const it = itemDari(c.db, idItem);
  if (!it.aspek.startsWith('PG:')) throw new Galat('Item ini bukan PG. Isi Aspek dengan PG:kunci, mis. PG:ABCDA');
  if (it.penguji !== c.s.username && !A.punya(c.s, ADMIN)) throw new Galat('Bukan penguji item ini.');
  const v = c.db.prepare('SELECT status FROM ujian_verif WHERE item_id=?').get(idItem); if (v && v.status === 'Disetujui') throw new Galat('Nilai sudah disetujui dan terkunci.');
  const kunci = it.aspek.slice(3).replace(/[^A-Za-z]/g, '').toUpperCase().split('');
  const baris = String(csv).split(/\r?\n/).filter(x => x.trim()).map(csvBaris), h = (baris.shift() || []).map(x => x.toLowerCase().trim());
  let cNis = h.findIndex(x => /nis/.test(x)); if (cNis < 0) cNis = h.findIndex(x => /\bid\b/.test(x));
  const cols = []; h.forEach((x, i) => { const m = x.match(/^(?:q|soal|no\.?)?\s*(\d+)$/); if (m) cols[Number(m[1]) - 1] = i; });
  if (cNis < 0 || !cols.length) throw new Galat('Kolom NIS atau jawaban tidak dikenali. Beri judul kolom NIS, 1, 2, 3 (atau Q1, Q2, ...).');
  const sah = new Set(c.db.prepare('SELECT nis FROM santri WHERE kelas=?').all(it.kelas).map(r => r.nis)), hasil = { ok: 0, gagal: [] };
  const up = c.db.prepare('INSERT INTO ujian_skor(item_id,nis,detail,total,penilai,waktu) VALUES(?,?,?,?,?,?) ON CONFLICT(item_id,nis) DO UPDATE SET detail=excluded.detail,total=excluded.total,penilai=excluded.penilai,waktu=excluded.waktu');
  c.db.transaction(() => baris.forEach(r => {
    const nis = String(r[cNis] || '').trim(); if (!sah.has(nis)) { hasil.gagal.push(nis || '(kosong)'); return; }
    let benar = 0; kunci.forEach((k, i) => { if (String(r[cols[i]] || '').trim().toUpperCase().charAt(0) === k) benar++; });
    const total = Math.round(benar / kunci.length * 1000) / 10; up.run(idItem, nis, JSON.stringify([total]), total, c.s.nama + ' (impor LJK)', nowStr()); hasil.ok++;
  }))();
  A.audit(c.db, c.s.username, 'impor_pg', idItem, hasil.ok + ' santri'); return hasil;
};

// ---------- dashboard ----------
H.ujDashboard = (c, idU) => {
  A.peran(c.s, VERIF);
  return c.db.prepare(`SELECT i.id, i.kelas, i.mapel, i.jenis, i.penguji,
    (SELECT COUNT(*) FROM santri s WHERE s.kelas=i.kelas) total,
    (SELECT COUNT(*) FROM ujian_hadir h JOIN santri s ON s.nis=h.nis WHERE h.ujian_id=i.ujian_id AND s.kelas=i.kelas AND h.status='Hadir') hadir,
    (SELECT COUNT(*) FROM ujian_skor k WHERE k.item_id=i.id) terisi, COALESCE(v.status,'Draft') status
    FROM ujian_item i LEFT JOIN ujian_verif v ON v.item_id=i.id WHERE i.ujian_id=? ORDER BY i.rowid`).all(idU);
};

// ---------- denah dan tempat duduk ----------
H.ujRuangList = (c, idU) => {
  A.peran(c.s, STAFF);
  return { ruang: c.db.prepare('SELECT id ID, ujian_id ID_Ujian, nama Nama, kapasitas Kapasitas, kolom Kolom, kelas Kelas FROM ujian_ruang WHERE ujian_id=? ORDER BY rowid').all(idU),
    kursi: c.db.prepare('SELECT ruang_id ruang, no, nis FROM ujian_kursi WHERE ujian_id=?').all(idU) };
};
H.ujSimpanRuang = (c, d) => {
  A.peran(c.s, ADMIN); d = d || {}; const kap = Number(d.kapasitas), kol = Number(d.kolom) || 5, kelas = String(d.kelas || '').split(',').map(x => x.trim()).filter(Boolean).join(',');
  if (!c.db.prepare('SELECT 1 FROM ujian WHERE id=?').get(d.idUjian)) throw new Galat('Pilih ujian dulu.');
  if (!String(d.nama || '').trim()) throw new Galat('Nama ruang wajib diisi.');
  if (!(kap >= 1 && kap <= 60)) throw new Galat('Kapasitas 1 sampai 60 kursi.');
  if (!(kol >= 1 && kol <= 10)) throw new Galat('Jumlah kolom 1 sampai 10.');
  if (!kelas) throw new Galat('Pilih minimal satu kelas untuk ruang ini.');
  const i = d.id || id();
  c.db.prepare('INSERT INTO ujian_ruang(id,ujian_id,nama,kapasitas,kolom,kelas) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nama=excluded.nama,kapasitas=excluded.kapasitas,kolom=excluded.kolom,kelas=excluded.kelas').run(i, d.idUjian, String(d.nama).trim(), kap, kol, kelas);
  c.db.prepare('DELETE FROM ujian_kursi WHERE ruang_id=? AND no>?').run(i, kap); return i;
};
H.ujHapusRuang = (c, i) => { A.peran(c.s, ADMIN); c.db.prepare('DELETE FROM ujian_ruang WHERE id=?').run(i); A.audit(c.db, c.s.username, 'hapus_ruang', i); return true; };
H.ujSusunKursi = (c, idU) => {
  A.peran(c.s, ADMIN); const ruang = c.db.prepare('SELECT * FROM ujian_ruang WHERE ujian_id=? ORDER BY rowid').all(idU);
  if (!ruang.length) throw new Galat('Buat ruang dulu.');
  const ikut = new Set(ruang.flatMap(r => r.kelas.split(',').filter(Boolean))), antri = {};
  c.db.prepare("SELECT nis,nama,kelas FROM santri WHERE status<>'Nonaktif'").all().filter(s => ikut.has(s.kelas)).sort((a, b) => a.nama.toLowerCase() < b.nama.toLowerCase() ? -1 : 1).forEach(s => (antri[s.kelas] = antri[s.kelas] || []).push(s));
  const baru = [], hasil = [];
  ruang.forEach(r => {
    const kls = r.kelas.split(',').filter(Boolean); let no = 0;
    while (no < r.kapasitas) { let ada = false; for (let k = 0; k < kls.length && no < r.kapasitas; k++) { const q = antri[kls[k]]; if (q && q.length) { no++; baru.push([idU, r.id, no, q.shift().nis]); ada = true; } } if (!ada) break; }
    hasil.push({ nama: r.nama, terisi: no, kapasitas: r.kapasitas });
  });
  c.db.transaction(() => { c.db.prepare('DELETE FROM ujian_kursi WHERE ujian_id=?').run(idU); const ins = c.db.prepare('INSERT INTO ujian_kursi(ujian_id,ruang_id,no,nis) VALUES(?,?,?,?)'); baru.forEach(b => ins.run(...b)); })();
  A.audit(c.db, c.s.username, 'susun_kursi', idU, baru.length + ' santri');
  return { ditempatkan: baru.length, belum: Object.values(antri).flat().map(s => ({ nis: s.nis, nama: s.nama, kelas: s.kelas })), ruang: hasil };
};
H.ujPindahKursi = (c, idU, dariRuang, dariNo, keRuang, keNo) => {
  A.peran(c.s, ADMIN); keNo = Number(keNo); dariNo = Number(dariNo);
  const r2 = c.db.prepare('SELECT kapasitas FROM ujian_ruang WHERE id=? AND ujian_id=?').get(keRuang, idU); if (!r2) throw new Galat('Ruang tujuan tidak ditemukan.');
  if (!(keNo >= 1 && keNo <= r2.kapasitas)) throw new Galat('Nomor kursi di luar kapasitas ruang.');
  const q = c.db.prepare('SELECT nis FROM ujian_kursi WHERE ujian_id=? AND ruang_id=? AND no=?'), a = q.get(idU, dariRuang, dariNo), b = q.get(idU, keRuang, keNo);
  if (!a) throw new Galat('Kursi asal kosong.');
  c.db.transaction(() => {
    const del = c.db.prepare('DELETE FROM ujian_kursi WHERE ujian_id=? AND ruang_id=? AND no=?'), ins = c.db.prepare('INSERT INTO ujian_kursi(ujian_id,ruang_id,no,nis) VALUES(?,?,?,?)');
    del.run(idU, dariRuang, dariNo); if (b) del.run(idU, keRuang, keNo);
    ins.run(idU, keRuang, keNo, a.nis); if (b) ins.run(idU, dariRuang, dariNo, b.nis);
  })();
  return true;
};

// ---------- raport (format كشف درجات الطلاب) ----------
const PREDIKAT = [[90, 'ممتاز'], [80, 'جيد جدا'], [60, 'جيد'], [50, 'مقبول'], [0, 'فاشل']];   // sesuaikan dengan aturan madrasah
const predikat = n => (PREDIKAT.find(p => n >= p[0]) || [0, 'فاشل'])[1];
function terbilang(n) {
  n = Math.round(Number(n) || 0); if (n <= 0) return 'صفر'; if (n >= 100) return 'مائة';
  const s = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'], t = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const b = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  if (n < 10) return s[n]; if (n < 20) return b[n - 10]; const p = Math.floor(n / 10), q = n % 10; return q ? s[q] + ' و ' + t[p] : t[p];
}
H.ujRaport = (c, nis, semester, tahun) => {
  if (!A.punya(c.s, STAFF) && !A.punya(c.s, 'portal.wali')) throw new Galat('Peran Anda tidak diizinkan.'); if (c.s.role === 'Wali') nis = c.s.nis;
  const sn = c.db.prepare('SELECT * FROM santri WHERE nis=?').get(String(nis)); if (!sn) throw new Galat('Santri tidak ditemukan.');
  const kelas = c.db.prepare('SELECT nis,nama FROM santri WHERE kelas=?').all(sn.kelas), abjad = kelas.map(x => x.nama.toLowerCase()).sort();
  const kit = c.db.prepare('SELECT * FROM mapel_kitab WHERE kelas=? ORDER BY urut, mapel').all(sn.kelas);
  const kk = c.db.prepare('SELECT * FROM raport_kelas WHERE kelas=?').get(sn.kelas) || {}, sk = c.db.prepare('SELECT * FROM raport_sikap WHERE nis=? AND semester=? AND tahun=?').get(sn.nis, semester, tahun) || {};
  const jml = Object.fromEntries(c.db.prepare('SELECT n.nis, SUM(COALESCE(n.harian,0)+COALESCE(n.ujian,0)) j FROM nilai n JOIN santri s ON s.nis=n.nis WHERE s.kelas=? AND n.semester=? AND n.tahun=? GROUP BY n.nis').all(sn.kelas, semester, tahun).map(r => [r.nis, r.j]));
  const me = jml[sn.nis] || 0, rata = Math.round(me / (2 * (kit.length || 1)) * 10) / 10, rank = 1 + Object.values(jml).filter(j => j > me).length;
  const kosong = v => v === null || v === undefined, ambil = c.db.prepare('SELECT harian,ujian FROM nilai WHERE nis=? AND semester=? AND tahun=? AND mapel=?');
  const rows = kit.map((m, i) => {
    const x = ambil.get(sn.nis, semester, tahun, m.mapel) || {}, im = kosong(x.ujian) ? '' : x.ujian, hr = kosong(x.harian) ? '' : x.harian, mu = (im === '' && hr === '') ? '' : Math.round(((im || 0) + (hr || 0)) / 2);
    return { no: i + 1, mapel: m.mapel, kitab: m.kitab, kkm: m.kkm, imtihan: im, imtihanHuruf: im === '' ? '' : terbilang(im), harian: hr, harianHuruf: hr === '' ? '' : terbilang(hr), muaddal: mu, tanbih: mu === '' ? '' : predikat(mu) };
  });
  const ab = Object.fromEntries(['Sakit', 'Izin', 'Alfa'].map(s => [s, c.db.prepare('SELECT COUNT(*) n FROM absensi WHERE nis=? AND status=?').get(sn.nis, s).n])), pil = (v, d) => kosong(v) ? d : Number(v);
  return { santri: { nama: sn.nama, no: abjad.indexOf(sn.nama.toLowerCase()) + 1 }, fasl: kk.fasl || sn.kelas, semester: semester === 'Genap' ? 'الثاني' : 'الأول', tahun: String(tahun).replace('/', ' / '),
    rows, baris: 12, jumlah: me, rata, rank, dari: kelas.length, isnad: predikat(rata), sikap: [['الأخلاق', sk.akhlak], ['الاستقامة', sk.istiqamah], ['العبودية', sk.ubudiyah]],
    absen: { sakit: pil(sk.sakit, ab.Sakit), izin: pil(sk.izin, ab.Izin), alfa: pil(sk.alfa, ab.Alfa) }, wasiat: sk.wasiat || '', naik: semester === 'Genap' ? (sk.naik || '') : '',
    tempat: kk.tempat || '', tanggal: kk.tanggal || '', waliFasl: kk.wali_fasl || '', mudir: kk.mudir || '' };
};

// ---------- cek kesiapan ----------
H.ujCekSiap = c => {
  A.peran(c.s, ADMIN); const out = [], add = (s, t) => out.push({ s, t }), q = (sql, ...p) => c.db.prepare(sql).all(...p), n = (sql, ...p) => c.db.prepare(sql).get(...p).n;
  const nu = n('SELECT COUNT(*) n FROM ujian'), ni = n('SELECT COUNT(*) n FROM ujian_item');
  add(nu ? 'ok' : 'gagal', nu ? nu + ' ujian terdaftar.' : 'Belum ada ujian. Buat di tab Atur.'); add(ni ? 'ok' : 'gagal', ni ? ni + ' item penilaian.' : 'Belum ada item penilaian.');
  const tp = q("SELECT DISTINCT mapel||' ('||penguji||')' x FROM ujian_item WHERE penguji NOT IN (SELECT username FROM users WHERE aktif=1)");
  add(tp.length ? 'gagal' : 'ok', tp.length ? 'Penguji tidak ada di akun: ' + tp.map(r => r.x).join(', ') : 'Semua penguji punya akun.');
  const tk = q('SELECT DISTINCT kelas FROM ujian_item WHERE kelas NOT IN (SELECT kelas FROM santri)');
  add(tk.length ? 'gagal' : 'ok', tk.length ? 'Kelas tidak cocok dengan data santri: ' + tk.map(r => r.kelas).join(', ') : 'Nama kelas pada item cocok dengan data santri.');
  const kr = q('SELECT DISTINCT kelas FROM ujian_item WHERE kelas NOT IN (SELECT kelas FROM mapel_kitab) OR kelas NOT IN (SELECT kelas FROM raport_kelas)');
  add(kr.length ? 'warn' : 'ok', kr.length ? 'Mapel_Kitab atau Raport_Kelas belum lengkap untuk: ' + kr.map(r => r.kelas).join(', ') : 'Data raport tiap kelas lengkap.');
  const pn = n("SELECT COUNT(*) n FROM user_roles WHERE role='Panitia Ujian'"); add(pn ? 'ok' : 'gagal', pn ? 'Ada akun Panitia Ujian.' : 'Belum ada akun dengan peran Panitia Ujian.');
  const np = n("SELECT COUNT(*) n FROM santri WHERE status<>'Nonaktif' AND nis NOT IN (SELECT nis FROM wali_akun)"); add(np ? 'warn' : 'ok', np ? np + ' santri belum punya PIN wali.' : 'Semua santri punya PIN wali.');
  const nr = n('SELECT COUNT(*) n FROM ujian_ruang'); add(nr ? 'ok' : 'warn', nr ? nr + ' ruang ujian terdaftar.' : 'Denah ruang belum dibuat (opsional, tab Denah).');
  const wl = n('SELECT COUNT(*) n FROM users WHERE wajib_ganti=1'); add(wl ? 'warn' : 'ok', wl ? wl + ' akun masih wajib ganti sandi.' : 'Semua akun sudah mengganti sandi awal.');
  const cfg = config(); add(WA.aktif(cfg) ? 'ok' : 'warn', WA.aktif(cfg) ? 'Gateway WhatsApp diatur.' : 'Gateway WhatsApp belum diatur (opsional, lihat data/config.example.json).');
  const bk = BK.daftar(cfg.backup.folder)[0], umur = bk ? (Date.now() - new Date(bk.nama.slice(7, 17) + 'T' + bk.nama.slice(18, 20) + ':' + bk.nama.slice(20, 22) + ':00+07:00').getTime()) / 36e5 : null;
  add(bk && umur < 36 ? 'ok' : 'warn', bk ? (umur < 36 ? 'Cadangan terakhir: ' + bk.nama : 'Cadangan terakhir sudah lebih dari 36 jam (' + bk.nama + ').') : 'Belum ada cadangan. Tekan Cadangkan sekarang.'); return out;
};

// Fungsi yang masih ada di versi Apps Script dan dijadwalkan dipindah.
H.sayaIzin = c => ({ nama: c.s.nama, role: c.s.role, izin: [...c.s.izin] });
Object.assign(H, require('./admin'), require('./madrasah'), require('./kesantri'));

// ---------- WhatsApp dan cadangan ----------
H.ujWaStatus = c => { A.peran(c.s, ADMIN); return WA.status(c.db, config()); };
H.ujProsesWaSekarang = async c => { A.peran(c.s, ADMIN); return WA.proses(c.db, config()); };
H.ujUjiWA = async (c, nomor) => {
  A.peran(c.s, ADMIN); const no = WA.nomor(nomor); if (!no) return { ok: false, msg: 'Nomor tidak valid.' };
  return WA.kirim(config(), no, 'Uji kirim SIPP NU Darussalam. Jika pesan ini sampai, gateway berfungsi.');
};
H.ujPengingatWali = (c, idU, kelas) => { A.peran(c.s, ADMIN); const h = WA.pengingat(c.db, idU, kelas); if (!h) throw new Galat('Pilih ujian.'); A.audit(c.db, c.s.username, 'pengingat_wali', idU + ' ' + kelas, h.antri + ' pesan'); return h; };
H.ujBackupSekarang = async c => { A.peran(c.s, 'administrator.cadangan'); const k = config().backup, nama = await BK.cadangkan(c.db, k.folder, k.simpan); A.audit(c.db, c.s.username, 'backup', nama); return { nama, daftar: BK.daftar(k.folder) }; };
H.ujBackupDaftar = c => { A.peran(c.s, 'administrator.cadangan'); return BK.daftar(config().backup.folder); };
const BELUM = [];
module.exports = { H, BELUM, PUBLIK: new Set(['ujLogin', 'ujWaliLogin']) };
