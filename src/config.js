// Pengaturan dibaca dari data/config.json dan bisa ditimpa variabel lingkungan. Dibaca ulang tiap dipakai, jadi tidak perlu restart.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
function config() {
  let c = {}; try { c = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE || path.join(ROOT, 'data', 'config.json'), 'utf8')); } catch (e) { /* belum ada: pakai bawaan */ }
  const e = process.env, w = c.wa || {}, b = c.backup || {};
  return {
    portalUrl: e.PORTAL_URL || c.portalUrl || '',
    wa: { url: e.WA_URL || w.url || '', token: e.WA_TOKEN || w.token || '', fieldNomor: e.WA_FIELD_NOMOR || w.fieldNomor || 'target', fieldPesan: e.WA_FIELD_PESAN || w.fieldPesan || 'message',
      authPrefix: e.WA_AUTH_PREFIX || w.authPrefix || '', okTeks: e.WA_OK_TEKS || w.okTeks || '', jeda: Number(e.WA_JEDA ?? w.jeda ?? 1500) },
    backup: { folder: path.resolve(ROOT, e.BACKUP_DIR || b.folder || 'data/backup'), simpan: Number(b.simpan) || 14, jam: Number(b.jam ?? 2) }
  };
}
module.exports = { config, ROOT };
