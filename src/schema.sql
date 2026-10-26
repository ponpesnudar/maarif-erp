-- Skema Ma'arif ERP (SQLite untuk uji di laptop; SQL standar, siap dipindah ke PostgreSQL)
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, nama TEXT NOT NULL, aktif INTEGER NOT NULL DEFAULT 1, wajib_ganti INTEGER NOT NULL DEFAULT 0, dibuat TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS role(kode TEXT PRIMARY KEY, nama TEXT NOT NULL, keterangan TEXT, bawaan INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS permission(kode TEXT PRIMARY KEY, modul TEXT NOT NULL, sumber TEXT NOT NULL, aksi TEXT NOT NULL, label TEXT NOT NULL, sensitif INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS role_permission(
  role_kode TEXT NOT NULL REFERENCES role(kode) ON DELETE CASCADE ON UPDATE CASCADE, permission_kode TEXT NOT NULL REFERENCES permission(kode) ON DELETE CASCADE, PRIMARY KEY(role_kode, permission_kode));
CREATE TABLE IF NOT EXISTS user_roles(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL REFERENCES role(kode) ON UPDATE CASCADE, PRIMARY KEY(user_id, role));
CREATE TABLE IF NOT EXISTS santri(
  nis TEXT PRIMARY KEY, nama TEXT NOT NULL, kelas TEXT NOT NULL, jk TEXT, kamar TEXT, tahun_masuk TEXT,
  status TEXT NOT NULL DEFAULT 'Aktif', wali TEXT, no_hp TEXT);
CREATE INDEX IF NOT EXISTS idx_santri_kelas ON santri(kelas);
CREATE TABLE IF NOT EXISTS wali_akun(
  nis TEXT PRIMARY KEY REFERENCES santri(nis) ON DELETE CASCADE, pin_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sesi(
  token_hash TEXT PRIMARY KEY, username TEXT, nis TEXT, nama TEXT NOT NULL, role TEXT NOT NULL, kedaluwarsa INTEGER NOT NULL, terbatas INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS percobaan_login(kunci TEXT PRIMARY KEY, gagal INTEGER NOT NULL, mulai INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, waktu TEXT NOT NULL, pelaku TEXT, aksi TEXT NOT NULL, objek TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS nilai(   -- nilai raport; nilai akhir dihitung saat dibaca, tidak disimpan
  nis TEXT NOT NULL REFERENCES santri(nis) ON DELETE CASCADE, semester TEXT NOT NULL, tahun TEXT NOT NULL, mapel TEXT NOT NULL,
  harian REAL, ujian REAL, akhlak REAL, PRIMARY KEY(nis, semester, tahun, mapel));
CREATE TABLE IF NOT EXISTS ujian(
  id TEXT PRIMARY KEY, nama TEXT NOT NULL, semester TEXT NOT NULL, tahun TEXT NOT NULL, tgl_mulai TEXT, tgl_selesai TEXT,
  status TEXT NOT NULL DEFAULT 'Aktif');
CREATE TABLE IF NOT EXISTS ujian_item(
  id TEXT PRIMARY KEY, ujian_id TEXT NOT NULL REFERENCES ujian(id) ON DELETE CASCADE, kelas TEXT NOT NULL, mapel TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK(jenis IN ('Tulis','PG','Lisan','Praktek','Kitab')), penguji TEXT NOT NULL, aspek TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_item_ujian ON ujian_item(ujian_id, kelas);
CREATE TABLE IF NOT EXISTS ujian_hadir(
  ujian_id TEXT NOT NULL REFERENCES ujian(id) ON DELETE CASCADE, nis TEXT NOT NULL REFERENCES santri(nis) ON DELETE CASCADE,
  ruang TEXT, status TEXT NOT NULL CHECK(status IN ('Hadir','Izin','Sakit','Alfa')), waktu TEXT NOT NULL, pencatat TEXT,
  PRIMARY KEY(ujian_id, nis));
CREATE TABLE IF NOT EXISTS ujian_skor(
  item_id TEXT NOT NULL REFERENCES ujian_item(id) ON DELETE CASCADE, nis TEXT NOT NULL REFERENCES santri(nis) ON DELETE CASCADE,
  detail TEXT NOT NULL, total REAL NOT NULL, penilai TEXT, waktu TEXT NOT NULL, PRIMARY KEY(item_id, nis));
CREATE TABLE IF NOT EXISTS ujian_verif(
  item_id TEXT PRIMARY KEY REFERENCES ujian_item(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('Menunggu','Disetujui','Ditolak')), alasan TEXT, verifikator TEXT, waktu TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifikasi(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, judul TEXT NOT NULL, isi TEXT NOT NULL,
  dibaca INTEGER NOT NULL DEFAULT 0, waktu TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifikasi(username, dibaca);
CREATE TABLE IF NOT EXISTS mapel_kitab(kelas TEXT NOT NULL, mapel TEXT NOT NULL, kitab TEXT, kkm REAL DEFAULT 65, urut INTEGER DEFAULT 99, PRIMARY KEY(kelas, mapel));
CREATE TABLE IF NOT EXISTS raport_kelas(kelas TEXT PRIMARY KEY, fasl TEXT, wali_fasl TEXT, mudir TEXT, tempat TEXT, tanggal TEXT);
CREATE TABLE IF NOT EXISTS raport_sikap(
  nis TEXT NOT NULL REFERENCES santri(nis) ON DELETE CASCADE, semester TEXT NOT NULL, tahun TEXT NOT NULL,
  akhlak REAL, istiqamah REAL, ubudiyah REAL, sakit INTEGER, izin INTEGER, alfa INTEGER, wasiat TEXT, naik TEXT, PRIMARY KEY(nis, semester, tahun));
CREATE TABLE IF NOT EXISTS absensi(
  id INTEGER PRIMARY KEY AUTOINCREMENT, nis TEXT NOT NULL REFERENCES santri(nis) ON DELETE CASCADE, tanggal TEXT, mapel TEXT,
  status TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_absensi_nis ON absensi(nis, status);
CREATE TABLE IF NOT EXISTS ujian_ruang(
  id TEXT PRIMARY KEY, ujian_id TEXT NOT NULL REFERENCES ujian(id) ON DELETE CASCADE, nama TEXT NOT NULL,
  kapasitas INTEGER NOT NULL CHECK(kapasitas BETWEEN 1 AND 60), kolom INTEGER NOT NULL CHECK(kolom BETWEEN 1 AND 10), kelas TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ujian_kursi(   -- satu santri hanya boleh satu kursi per ujian (dijaga database)
  ujian_id TEXT NOT NULL, ruang_id TEXT NOT NULL REFERENCES ujian_ruang(id) ON DELETE CASCADE, no INTEGER NOT NULL,
  nis TEXT NOT NULL REFERENCES santri(nis) ON DELETE CASCADE, PRIMARY KEY(ujian_id, ruang_id, no), UNIQUE(ujian_id, nis));
CREATE TABLE IF NOT EXISTS wa_antrian(   -- kunci UNIQUE: pesan yang sama tidak pernah masuk antrian dua kali
  id INTEGER PRIMARY KEY AUTOINCREMENT, kunci TEXT UNIQUE, nomor TEXT NOT NULL, pesan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Menunggu' CHECK(status IN ('Menunggu','Terkirim','Gagal')), percobaan INTEGER NOT NULL DEFAULT 0, catatan TEXT, waktu TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_wa_status ON wa_antrian(status);
CREATE TABLE IF NOT EXISTS pengampu(   -- guru mana mengampu mapel apa di kelas mana
  username TEXT NOT NULL REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE, kelas TEXT NOT NULL, mapel TEXT NOT NULL, PRIMARY KEY(username, kelas, mapel));
