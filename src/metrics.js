// Statistik permintaan di memori (5.000 terakhir) untuk halaman Kesehatan Sistem.
const buf = [], mulai = Date.now();
const catat = (fn, ms, status) => { buf.push({ t: Date.now(), fn, ms, status }); if (buf.length > 5000) buf.shift(); };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0; };
function ringkasan(jam = 24) {
  const r = buf.filter(x => x.t >= Date.now() - jam * 36e5), per = {};
  r.forEach(x => (per[x.fn] = per[x.fn] || []).push(x.ms));
  return { jumlah: r.length, p95: Math.round(p95(r.map(x => x.ms))), rata: r.length ? Math.round(r.reduce((a, x) => a + x.ms, 0) / r.length) : 0, galat5xx: r.filter(x => x.status >= 500).length,
    galat4xx: r.filter(x => x.status >= 400 && x.status < 500).length, uptimeDetik: Math.round((Date.now() - mulai) / 1000),
    terlambat: Object.entries(per).map(([fn, a]) => ({ fn, p95: Math.round(p95(a)), n: a.length })).sort((a, b) => b.p95 - a.p95).slice(0, 5) };
}
module.exports = { catat, ringkasan };
