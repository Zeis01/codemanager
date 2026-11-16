// Testy updatera GitHub (z udawanym API GitHub)
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const { Updater, cleanNotes } = require('../src/main/updater');

const payload = Buffer.from('NOWA WERSJA PROGRAMU');
const sha = crypto.createHash('sha256').update(payload).digest('hex');
const release = (tag, extra = {}) => ({ tag_name: tag, name: 'CodeManager ' + tag, body: '## Zmiany\n- **Nowość**: updater\n- poprawki `RCON`', published_at: '2026-11-20T10:00:00Z', html_url: 'https://github.com/x/y/releases/tag/' + tag, prerelease: false, draft: false,
  assets: [
    { name: `CodeManager-Setup-${tag.slice(1)}.exe`, size: 10, browser_download_url: 'https://dl/setup.exe' },
    { name: `CodeManager-Portable-${tag.slice(1)}.exe`, size: payload.length, browser_download_url: 'https://dl/portable.exe', digest: 'sha256:' + sha },
    { name: `CodeManager-${tag.slice(1)}-win-x64.zip`, size: payload.length, browser_download_url: 'https://dl/app.zip', digest: 'sha256:' + 'ab'.repeat(32) },
  ], ...extra });

let calls = [];
global.fetch = async (url) => {
  calls.push(url);
  if (url.endsWith('/releases/latest')) return { ok: true, status: 200, json: async () => release('v1.3.0') };
  if (url.includes('/releases?')) return { ok: true, status: 200, json: async () => [release('v1.4.0-beta.1', { prerelease: true }), release('v1.3.0')] };
  if (url.startsWith('https://dl/')) return { ok: true, status: 200, headers: { get: () => String(payload.length) }, body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: payload })) }; } } };
  return { ok: false, status: 404 };
};

const settings = { updateRepo: 'jan/CodeManager' };
const app = { getVersion: () => '1.2.0', isPackaged: true, quit() {} };
const events = [];
const mk = () => new Updater({ app, getSettings: () => settings, emit: (c, d) => events.push(d), defaultRepo: '', getToken: () => null });

let passed = 0, failed = 0;
const tests = [
  ['repozytorium: normalizacja adresu', async () => { settings.updateRepo = 'https://github.com/jan/CodeManager.git'; assert.strictEqual(mk().repo(), 'jan/CodeManager'); settings.updateRepo = 'TWOJ-LOGIN/CodeManager'; assert.strictEqual(mk().repo(), null); settings.updateRepo = 'jan/CodeManager'; }],
  ['brak konfiguracji → komunikat', async () => { settings.updateRepo = ''; const u = mk(); await assert.rejects(() => u.check(false), /repozytorium/i); settings.updateRepo = 'jan/CodeManager'; }],
  ['wykrywa nowszą wersję (portable)', async () => {
    process.env.PORTABLE_EXECUTABLE_FILE = 'C:\\CodeManager.exe';
    const u = mk(); const s = await u.check(false);
    assert.strictEqual(s.state, 'available'); assert.strictEqual(s.latest, '1.3.0'); assert.strictEqual(s.mode, 'portable');
    assert(/Portable/.test(s.asset.name)); assert(!/##|\*\*/.test(s.notes));
  }],
  ['pobiera i weryfikuje SHA-256', async () => { const u = mk(); await u.check(false); const s = await u.download(); assert.strictEqual(s.state, 'downloaded'); assert.strictEqual(fs.readFileSync(u.downloaded, 'utf8'), payload.toString()); }],
  ['odrzuca plik z błędną sumą (zip)', async () => { delete process.env.PORTABLE_EXECUTABLE_FILE; const plat = process.platform; Object.defineProperty(process, 'platform', { value: 'win32' }); process.resourcesPath = process.resourcesPath || '/nonexistent'; const u = mk(); await u.check(false); assert(/win-x64\.zip/.test(u.asset.name)); try { await assert.rejects(() => u.download(), /sumę kontrolną/); } finally { Object.defineProperty(process, 'platform', { value: plat }); } }],
  ['kanał beta wybiera wersję testową', async () => { settings.updateChannel = 'beta'; const s = await mk().check(false); assert.strictEqual(s.latest, '1.4.0-beta.1'); assert(s.prerelease); delete settings.updateChannel; }],
  ['pominięta wersja nie jest zgłaszana w tle', async () => { settings.skipVersion = '1.3.0'; const s = await mk().check(true); assert.strictEqual(s.state, 'none'); delete settings.skipVersion; }],
  ['aktualna wersja → brak aktualizacji', async () => { app.getVersion = () => '1.3.0'; const s = await mk().check(false); assert.strictEqual(s.state, 'none'); app.getVersion = () => '1.2.0'; }],
  ['czyszczenie opisu wydania', async () => { assert.strictEqual(cleanNotes('# Tytuł\n**pogrubione** [link](http://x)'), 'Tytuł\npogrubione link'); }],
];
(async () => {
  for (const [n, f] of tests) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 3).join('\n    ')); } }
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
