// WhatsApp ke wali lewat antrian. Isi pesan "nilai terbit" tidak memuat angka nilai. Gateway belum diverifikasi: uji dengan nomor sendiri.
const nowStr = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16), sleep = ms => new Promise(r => setTimeout(r, ms));
const nomor = x => { let d = String(x || '').replace(/\D/g, ''); if (!d) return ''; if (d.startsWith('0')) d = '62' + d.slice(1); else if (d.startsWith('8')) d = '62' + d; return /^62\d{8,13}$/.test(d) ? d : ''; };
const aktif = cfg => !!(cfg.wa.url && cfg.wa.token);
async function kirim(cfg, no, pesan) {
  if (!aktif(cfg)) return { ok: false, msg: 'Gateway WhatsApp belum diatur.' };
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(cfg.wa.url, { method: 'POST', signal: ctl.signal, headers: { Authorization: cfg.wa.authPrefix + cfg.wa.token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ [cfg.wa.fieldNomor]: no, [cfg.wa.fieldPesan]: pesan }) });
    const isi = await r.text(); return { ok: r.ok && (!cfg.wa.okTeks || isi.includes(cfg.wa.okTeks)), msg: 'HTTP ' + r.status + ' ' + isi.slice(0, 100) };
  } catch (e) { return { ok: false, msg: String(e.message || e).slice(0, 100) }; } finally { clearTimeout(t); }
}
const antri = (db, kunci, no, pesan) => db.prepare('INSERT OR IGNORE INTO wa_antrian(kunci,nomor,pesan,waktu) VALUES(?,?,?,?)').run(kunci, no, pesan, nowStr()).changes > 0;
const state = { berjalan: false, pekerjaAktif: false };
async function proses(db, cfg) {   // maksimal 20 pesan per putaran; gagal dicoba ulang sampai 3 kali
  const n = { terkirim: 0, gagal: 0 }; if (!aktif(cfg) || state.berjalan) return n; state.berjalan = true;
  try {
    for (const r of db.prepare("SELECT * FROM wa_antrian WHERE status='Menunggu' OR (status='Gagal' AND percobaan<3) ORDER BY id LIMIT 20").all()) {
      const h = await kirim(cfg, r.nomor, r.pesan);
      db.prepare('UPDATE wa_antrian SET status=?, percobaan=percobaan+1, catatan=?, waktu=? WHERE id=?').run(h.ok ? 'Terkirim' : 'Gagal', h.msg, nowStr(), r.id); h.ok ? n.terkirim++ : n.gagal++;
      if (cfg.wa.jeda) await sleep(cfg.wa.jeda);
    }
  } finally { state.berjalan = false; } return n;
}
function cekTerbit(db, idU, kelas, cfg) {   // semua item nilai (selain koreksian kitab) satu kelas disetujui -> wali diberi tahu sekali
  const t = db.prepare("SELECT i.id, v.status FROM ujian_item i LEFT JOIN ujian_verif v ON v.item_id=i.id WHERE i.ujian_id=? AND i.kelas=? AND i.jenis<>'Kitab'").all(idU, kelas);
  if (!t.length || t.some(x => x.status !== 'Disetujui')) return 0;
  const u = db.prepare('SELECT nama FROM ujian WHERE id=?').get(idU) || {}; let n = 0;
  db.prepare("SELECT nis,nama,no_hp FROM santri WHERE kelas=? AND status<>'Nonaktif'").all(kelas).forEach(s => {
    const no = nomor(s.no_hp); if (no && antri(db, 'terbit|' + idU + '|' + s.nis, no, `Assalamu’alaikum. Nilai ${u.nama} atas nama ${s.nama} sudah terbit. Silakan buka portal wali${cfg.portalUrl ? ': ' + cfg.portalUrl : '.'} Terima kasih. — SIPP NU Darussalam`)) n++;
  }); return n;
}
function pengingat(db, idU, kelas) {
  const u = db.prepare('SELECT nama,tgl_mulai FROM ujian WHERE id=?').get(idU), h = { antri: 0, sudah: 0, tanpaNomor: 0 }; if (!u) return null;
  db.prepare("SELECT nis,nama,no_hp FROM santri WHERE kelas=? AND status<>'Nonaktif'").all(kelas).forEach(s => {
    const no = nomor(s.no_hp); if (!no) { h.tanpaNomor++; return; }
    antri(db, 'ingat|' + idU + '|' + s.nis, no, `Assalamu’alaikum. Pengingat: ${u.nama} dimulai ${u.tgl_mulai || 'segera'}. Mohon ${s.nama} hadir tepat waktu dan membawa kartu santri. — SIPP NU Darussalam`) ? h.antri++ : h.sudah++;
  }); return h;
}
function status(db, cfg) {
  const hitung = { Menunggu: 0, Terkirim: 0, Gagal: 0 }; db.prepare('SELECT status, COUNT(*) n FROM wa_antrian GROUP BY status').all().forEach(r => hitung[r.status] = r.n);
  return { aktif: aktif(cfg), jadwal: state.pekerjaAktif, hitung, terakhir: db.prepare('SELECT nomor,status,catatan,waktu FROM wa_antrian ORDER BY id DESC LIMIT 10').all().map(r => ({ ...r, nomor: r.nomor.replace(/\d(?=\d{3})/g, '•') })) };
}
module.exports = { nomor, aktif, kirim, antri, proses, cekTerbit, pengingat, status, state };
