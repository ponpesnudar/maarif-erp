// Katalog izin dan role bawaan. Disinkronkan tiap server dibuka; perubahan role oleh admin tidak ditimpa.
const KATALOG = [   // kode, modul, sumber, aksi, keterangan, sensitif
  ['ujian.akses', 'Ujian', 'Akses', 'Buka', 'Membuka modul ujian, mencatat hadir, menilai item sendiri, melihat raport', 0],
  ['ujian.kelola', 'Ujian', 'Pengelolaan', 'Kelola', 'Membuat ujian, item, ruang, kursi; dispensasi hadir; PIN wali; WhatsApp', 0],
  ['ujian.verifikasi', 'Ujian', 'Verifikasi', 'Setujui', 'Menyetujui atau menolak nilai, melihat antrean dan dashboard', 1],
  ['administrator.user.lihat', 'Administrator', 'Pengguna', 'Lihat', 'Melihat daftar pengguna', 0],
  ['administrator.user.kelola', 'Administrator', 'Pengguna', 'Kelola', 'Menambah, mengubah, menonaktifkan pengguna dan mengatur peran mereka', 1],
  ['administrator.user.reset', 'Administrator', 'Pengguna', 'Reset sandi', 'Mengatur ulang sandi pengguna', 1],
  ['administrator.role.lihat', 'Administrator', 'Role', 'Lihat', 'Melihat role dan izinnya', 0],
  ['administrator.role.kelola', 'Administrator', 'Role', 'Kelola', 'Membuat, mengubah, menghapus role dan izinnya', 1],
  ['administrator.audit.lihat', 'Administrator', 'Jejak audit', 'Lihat', 'Melihat jejak audit', 1],
  ['administrator.kesehatan.lihat', 'Administrator', 'Kesehatan sistem', 'Lihat', 'Melihat kesehatan sistem', 0],
  ['administrator.cadangan', 'Administrator', 'Cadangan', 'Kelola', 'Membuat dan melihat cadangan data', 1],
  ['madrasah.nilai.harian', 'Madrasah', 'Nilai harian', 'Input', 'Mengisi nilai harian untuk kelas dan mapel yang diampu', 0],
  ['madrasah.nilai.semua', 'Madrasah', 'Nilai harian', 'Semua kelas', 'Mengisi nilai harian untuk semua kelas dan mapel', 1],
  ['madrasah.pengampu.kelola', 'Madrasah', 'Pengampu', 'Kelola', 'Mengatur guru pengampu mapel di tiap kelas', 0],
  ['madrasah.raport.kelola', 'Madrasah', 'Data raport', 'Kelola', 'Mengatur daftar kitab per kelas, data kelas, sikap, absensi, dan wasiat raport', 0],
  ['kesantrian.lihat', 'Kesantrian', 'Data santri', 'Lihat', 'Melihat data santri, termasuk nomor HP wali (data pribadi)', 1],
  ['kesantrian.kelola', 'Kesantrian', 'Data santri', 'Kelola', 'Menambah dan mengubah data santri, memindahkan kelas, menonaktifkan santri', 1]
];
const GURU = ['ujian.akses', 'madrasah.nilai.harian'];
const BAWAAN = [   // kode, nama, keterangan, izin bawaan ('*' = semua)
  ['Admin', 'Administrator Sistem', 'Seluruh izin. Tidak bisa diubah.', ['*']],
  ['Panitia Ujian', 'Panitia Ujian', 'Mengelola ujian dan memverifikasi nilai', ['ujian.akses', 'ujian.kelola', 'ujian.verifikasi', 'madrasah.raport.kelola', 'kesantrian.lihat', 'kesantrian.kelola']],
  ['Pengasuh', 'Pengasuh', 'Memantau dan memverifikasi nilai ujian', ['ujian.akses', 'ujian.verifikasi', 'kesantrian.lihat']],
  ['Kepala Pondok', 'Kepala Pondok', 'Memantau dan memverifikasi nilai ujian', ['ujian.akses', 'ujian.verifikasi', 'kesantrian.lihat']],
  ['Majlis Maarif', 'Majlis Ma\u2019arif', 'Memantau dan memverifikasi nilai ujian', ['ujian.akses', 'ujian.verifikasi']],
  ['Guru Putra', 'Guru Putra', 'Menilai ujian yang menjadi tanggung jawabnya', GURU], ['Guru Putri', 'Guru Putri', 'Menilai ujian yang menjadi tanggung jawabnya', GURU],
  ['Guru Mukim', 'Guru Mukim', 'Menilai ujian yang menjadi tanggung jawabnya', GURU], ['Wali Kelas', 'Wali Kelas', 'Menilai ujian, mengisi data raport kelasnya', [...GURU, 'madrasah.raport.kelola', 'kesantrian.lihat']]
];
function seed(db) {
  db.transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO permission(kode,modul,sumber,aksi,label,sensitif) VALUES(?,?,?,?,?,?)'), upd = db.prepare('UPDATE permission SET modul=?,sumber=?,aksi=?,label=?,sensitif=? WHERE kode=?'), izinBaru = new Set();
    KATALOG.forEach(k => { if (ins.run(...k).changes) izinBaru.add(k[0]); else upd.run(k[1], k[2], k[3], k[4], k[5], k[0]); });   // izin baru otomatis masuk ke role bawaan sesuai bawaannya
    const semua = KATALOG.map(k => k[0]), baru = db.prepare('INSERT OR IGNORE INTO role(kode,nama,keterangan,bawaan) VALUES(?,?,?,1)'), rp = db.prepare('INSERT OR IGNORE INTO role_permission(role_kode,permission_kode) VALUES(?,?)');
    BAWAAN.forEach(([kode, nama, ket, izin]) => { const baruDibuat = baru.run(kode, nama, ket).changes > 0; if (kode === 'Admin') semua.forEach(i => rp.run(kode, i)); else izin.forEach(i => { if (baruDibuat || izinBaru.has(i)) rp.run(kode, i); }); });
  })();
}
module.exports = { seed, KATALOG };
