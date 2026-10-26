const express = require('express'), path = require('path');
const M = require('./metrics'), { buka } = require('./db'), A = require('./auth'), { H, BELUM, PUBLIK } = require('./api'), WA = require('./wa'), BK = require('./backup'), { config } = require('./config');
const os = require('os');
const lokal = req => { const a = (req.socket && req.socket.remoteAddress) || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };   // hanya dari komputer server sendiri
function alamatLAN(port) {
  const out = []; Object.entries(os.networkInterfaces()).forEach(([nama, daftar]) => (daftar || []).forEach(i => { if (i.family === 'IPv4' && !i.internal) out.push({ nama, ip: i.address, url: `http://${i.address}:${port}` }); }));
  return out;
}
function buatApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' }); next(); });
  app.post('/api/rpc', async (req, res) => {
    res.set('Cache-Control', 'no-store'); const t0 = process.hrtime.bigint(); res.on('finish', () => M.catat(String((req.body || {}).fn), Number(process.hrtime.bigint() - t0) / 1e6, res.statusCode));
    const { fn, args } = req.body || {}, a = Array.isArray(args) ? args : [];
    if (!Object.prototype.hasOwnProperty.call(H, fn)) return res.status(BELUM.includes(fn) ? 501 : 404).json({ error: BELUM.includes(fn) ? 'Fitur ini belum dipindahkan ke sistem baru.' : 'Fungsi tidak dikenal.' });
    try {
      const s = PUBLIK.has(fn) ? null : A.ambilSesi(db, a[0]);
      if (s && s.terbatas && fn !== 'ujGantiSandi') throw new A.Galat('Anda harus mengganti sandi dulu (tab Akun).');
      const r = await H[fn]({ db, s }, ...(PUBLIK.has(fn) ? a : a.slice(1)));
      res.json({ result: r === undefined ? null : r });
    } catch (e) {
      if (e instanceof A.Galat) return res.status(400).json({ error: e.message });
      console.error('[galat]', fn, e); res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
  app.get('/api/alamat', (req, res) => { if (!lokal(req)) return res.status(403).json({ error: 'Hanya bisa dibuka dari komputer server.' }); res.json({ port: req.socket.localPort, urls: alamatLAN(req.socket.localPort) }); });
  app.get('/alamat', (req, res) => lokal(req) ? res.sendFile(path.join(__dirname, '..', 'public', 'alamat.html')) : res.status(403).send('Halaman ini hanya bisa dibuka dari komputer server (http://localhost:3000/alamat).'));
  const hal = n => (req, res) => res.sendFile(path.join(__dirname, '..', 'public', n + '.html'));
  app.get('/', hal('index')); app.get('/ujian', hal('ujian')); app.get('/administrator', hal('administrator')); app.get('/madrasah', hal('madrasah')); app.get('/kesantrian', hal('kesantrian'));
  return app;
}
function mulaiPekerja(db) {   // kirim WhatsApp tiap menit, cadangan sekali sehari setelah jam yang ditentukan
  WA.state.pekerjaAktif = true;
  const a = setInterval(() => WA.proses(db, config()).catch(e => console.error('[wa]', e.message)), 60e3);
  const b = setInterval(() => { const k = config().backup; if (BK.perluBackup(new Date(), k.folder, k.jam)) BK.cadangkan(db, k.folder, k.simpan).then(n => console.log('[backup] dibuat', n)).catch(e => console.error('[backup]', e.message)); }, 60e3);
  a.unref(); b.unref();
}
if (require.main === module) {
  const db = buka(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maarif.db')), port = Number(process.env.PORT) || 3000;
  mulaiPekerja(db); buatApp(db).listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })}] Ma'arif ERP berjalan di http://localhost:${port}`);
    const a = alamatLAN(port); console.log(a.length ? 'Alamat untuk ponsel dan komputer lain di jaringan yang sama:\n' + a.map(x => `  ${x.url}   (${x.nama})`).join('\n') + `\nBuka http://localhost:${port}/alamat di komputer ini untuk melihat QR-nya.` : 'Tidak ada jaringan terdeteksi. Sambungkan komputer ke WiFi atau kabel LAN.');
  });
}
module.exports = { buatApp, mulaiPekerja, lokal, alamatLAN };
