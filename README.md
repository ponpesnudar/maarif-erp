# Ma'arif ERP — sistem baru (database sungguhan)

Modul ujian Ma'arif dipindah dari Google Sheets + Apps Script ke aplikasi web dengan database. Untuk uji di laptop memakai SQLite (satu file, tanpa instal server database). Skemanya SQL standar sehingga bisa dipindah ke PostgreSQL.

## Menjalankan di laptop
1. Pasang **Node.js LTS** (versi 20 atau lebih baru) dari nodejs.org.
2. Ekstrak zip, buka terminal (PowerShell) di folder ini, lalu:
   ```
   npm install
   npm run setup -- --demo
   npm start
   ```
   `setup` mencetak **sandi admin acak sekali saja**, catat. Opsi `--demo` mengisi 10 santri, akun `demo_guru` dan `demo_panitia` (sandi `demo12345`), PIN wali demo `123456`.
3. Buka http://localhost:3000 (Portal). Alamat untuk ponsel dicetak otomatis saat server menyala; di komputer server buka http://localhost:3000/alamat untuk melihat QR-nya. Modul: `/ujian`, `/madrasah`, `/kesantrian`, `/administrator`.
4. Uji otomatis kapan saja: `npm test` (166 pemeriksaan terhadap database dan server sungguhan).

## Memindahkan data dari Maarif Online lama
Di Google Sheets: File > Download > Microsoft Excel (.xlsx). Lalu:
```
npm run import -- C:\lokasi\maarif.xlsx
```
Yang dipindah: Santri, User_Accounts, Madrasah_Nilai. Semua akun hasil impor **wajib mengganti sandi** saat login pertama. Sandi yang sudah ter-hash di Apps Script tidak bisa dipindah, jadi dibuat acak lalu gunakan Reset sandi.

## Yang perlu diketahui
- Data ada di `data/maarif.db`. Cadangan: hentikan server lalu salin file itu.
- Dibuka dari HP lewat alamat laptop (`http://IP-laptop:3000`) bisa untuk uji. **Kamera QR tidak jalan lewat HTTP biasa** (browser mewajibkan HTTPS), gunakan ketik NIS atau scanner USB sampai sistem dipasang dengan HTTPS.
- Jangan dibuka ke internet tanpa HTTPS dan reverse proxy.
- Bila `npm install` pernah gagal dengan pesan node-gyp: berkas `.npmrc` di folder ini sudah mengatur agar tidak mengompilasi, karena database membawa biner siap pakai.
- Paket `xlsx` hanya dipakai skrip impor, tidak dijalankan oleh server.

## Komputer yang menyala terus (server)
- `deploy/start-server.bat` menjalankan server dan menyalakannya lagi otomatis bila berhenti (jadwalkan di Task Scheduler, At startup). Log di `data/server.log`.
- `deploy/maarif.service` untuk Linux (systemd).
- Pengaturan WhatsApp, alamat portal, dan cadangan: salin `data/config.example.json` menjadi `data/config.json`.
- Cadangan otomatis tiap hari setelah jam 02.00 WIB (14 terakhir). Manual: `npm run backup`. Pulihkan: hentikan server, `npm run restore -- <berkas cadangan>`.
- Admin lupa sandi: `npm run reset-sandi -- admin`.
- Panduan lengkap (pemasangan, uji per peran, jaringan, HTTPS, pemecahan masalah) ada di dokumen Panduan Lengkap.

## Modul Administrator
Pengguna (tambah, ubah, nonaktifkan, reset sandi), Role dan Izin (izin per modul, bisa diatur admin, berlaku seketika), Jejak Audit (filter dan halaman), Kesehatan Sistem (metrik nyata, pemeriksaan otomatis, cadangan). Belum: penomoran dokumen, format cetakan, parameter lampiran, rute persetujuan (menyusul bersama modul Sekretariat dan Dokumen).

## Modul Kesantrian
Daftar santri (cari, filter kelas dan status), tambah dan ubah, pindah kelas massal, panel kualitas data (tanpa nomor HP, HP tidak valid, nama ganda, tanpa wali, tanpa PIN), ekspor CSV. Santri tidak dihapus, hanya dinonaktifkan. Nomor HP wali yang diubah langsung dipakai WhatsApp.

## Modul Madrasah
Nilai harian oleh guru pengampu (tiap perubahan tercatat), penugasan pengampu, data raport (kitab dan KKM per kelas, data kelas, sikap, absensi, wasiat, naik kelas).

## Status pemindahan modul
Sudah di sistem baru dan teruji: Portal modul, Administrator, Madrasah, Kesantrian, login dan akun (hash scrypt, pembatasan percobaan, wajib ganti sandi, jejak audit), hak akses berbasis izin di server, master ujian dan item, daftar hadir dengan syarat kitab dan dispensasi, penilaian (tulis, lisan, praktek, kitab), impor hasil scan LJK (CSV), ajukan dan verifikasi, notifikasi dalam aplikasi, dashboard monitoring, denah dan tempat duduk (cetak daftar hadir, denah, label meja), kartu santri ber-QR dengan ruang dan kursi, raport format Arab, portal wali, PIN wali, cek kesiapan, WhatsApp ke wali lewat antrian, cadangan otomatis, impor dari spreadsheet lama.

Belum dipindah: semua modul Maarif Online lama di luar ujian (absensi guru, BK, satpam, kepanitiaan, sekretariat, slip gaji) dan modul penggajian baru.
