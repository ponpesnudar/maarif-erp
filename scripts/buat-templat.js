// npm run templat  -> templat/templat_impor.xlsx (judul kolom dan satu contoh baris untuk tiap sheet)
const XLSX = require('xlsx'), path = require('path'), fs = require('fs');
const S = {
  Santri: [{ NIS: '1001', Nama: 'Contoh Santri', Kelas: 'Kelas 1', Jenis_Kelamin: 'L', Kamar: 'A1', Tahun_Masuk: 2024, Status: 'Aktif', Wali: 'Nama Wali', No_HP: '081200000000' }],
  User_Accounts: [{ Username: 'ustadz1', Password: 'sandi-awal', Nama_Lengkap: 'Ustadz Contoh', Role: 'Guru Putra, Wali Kelas' }],
  Madrasah_Nilai: [{ NIS: '1001', Semester: 'Ganjil', Tahun: '2026/2027', Mapel: 'Fiqih', Nilai_Harian: 80, Nilai_Ujian: '', Nilai_Akhlak: '' }],
  Madrasah_Absen: [{ NIS: '1001', Tanggal: '2026-10-01', Mapel: 'Fiqih', Status: 'Sakit' }],
  Mapel_Kitab: [{ Kelas: 'Kelas 1', Mapel: 'Fiqih', Kitab: 'متن تقريب', KKM: 65, Urut: 1 }],
  Raport_Kelas: [{ Kelas: 'Kelas 1', Fasl: 'الأول للبنين (أ)', Wali_Fasl: 'Ustadz Contoh', Mudir: 'Nama Mudir', Tempat: 'Karangdadap', Tanggal: '1 Januari 2027' }],
  Raport_Sikap: [{ NIS: '1001', Semester: 'Ganjil', Tahun: '2026/2027', Akhlak: 70, Istiqamah: 70, Ubudiyah: 70, Sakit: '', Izin: '', Alfa: '', Wasiat: 'Tetap semangat belajar.', Naik: '' }]
};
const wb = XLSX.utils.book_new(); Object.entries(S).forEach(([n, r]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r), n));
const out = path.join(__dirname, '..', 'templat', 'templat_impor.xlsx'); fs.mkdirSync(path.dirname(out), { recursive: true }); XLSX.writeFile(wb, out); console.log('Dibuat:', out);
