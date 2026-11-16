// Aktualizacje z GitHub Releases (publiczne repozytorium Zeis01/codemanager)
// - instalacja przez instalator (NSIS): electron-updater (pobieranie w tle, instalacja przy zamknięciu / od razu)
// - wersja portable i .zip: własny mechanizm – pobranie z GitHub, weryfikacja SHA-256, podmiana plików skryptem po zamknięciu
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const U = require('./util');
const N = require('./net');

class Updater {
  constructor({ app, getSettings, emit, repo }) {
    Object.assign(this, { app, getSettings, emit, fixedRepo: repo });
    this.state = { state: 'idle', current: app.getVersion() };
    this.timer = null;
    this.au = null;
  }

  repo() { return this.fixedRepo; }
  mode() {
    if (!this.app.isPackaged) return 'dev';
    if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
    const dir = path.dirname(process.execPath);
    if (process.platform === 'win32' && U.listFiles(dir).some(f => /^Uninstall .*\.exe$/i.test(path.basename(f))) && U.exists(path.join(process.resourcesPath, 'app-update.yml'))) return 'installer';
    return 'zip';
  }
  set(patch) { this.state = { ...this.state, ...patch, current: this.app.getVersion(), mode: this.mode(), repo: this.repo() }; this.emit('update:status', this.state); return this.state; }
  status() { return this.set({}); }

  schedule() {
    clearInterval(this.timer);
    const s = this.getSettings();
    if (s.autoUpdate === false) return;
    setTimeout(() => this.check(true).catch(() => {}), 15000);
    this.timer = setInterval(() => this.check(true).catch(() => {}), 6 * 3600 * 1000);
  }

  // ---------- electron-updater (instalator) ----------
  autoUpdater() {
    if (this.au) return this.au;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('download-progress', p => this.set({ state: 'downloading', progress: Math.round(p.percent), speed: p.bytesPerSecond }));
    autoUpdater.on('update-downloaded', () => this.set({ state: 'downloaded', progress: 100 }));
    autoUpdater.on('error', e => this.set({ state: 'error', error: friendly(e) }));
    this.au = autoUpdater;
    return autoUpdater;
  }
  feed() {
    const [owner, repo] = this.repo().split('/');
    return { provider: 'github', owner, repo };
  }

  // ---------- sprawdzanie ----------
  async latestRelease() {
    const r = await fetch(`https://api.github.com/repos/${this.repo()}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CodeManager-Updater' } });
    if (r.status === 404) throw new Error('Nie opublikowano jeszcze żadnego wydania.');
    if (r.status === 403) throw new Error('GitHub ograniczył liczbę zapytań – spróbuj za godzinę.');
    if (!r.ok) throw new Error('GitHub: HTTP ' + r.status);
    return r.json();
  }

  async check(silent = false) {
    this.set({ state: 'checking', error: null });
    try {
      const rel = await this.latestRelease();
      const version = String(rel.tag_name || '').replace(/^v/i, '');
      const s = this.getSettings();
      const newer = U.cmpVer(version, this.app.getVersion()) > 0;
      if (!newer) return this.set({ state: 'none', latest: version, checkedAt: Date.now() });
      if (silent && s.skipVersion === version) return this.set({ state: 'none', latest: version, skipped: true, checkedAt: Date.now() });
      const asset = this.pickAsset(rel);
      this.release = rel; this.asset = asset;
      if (this.mode() === 'installer') {
        const au = this.autoUpdater();
        au.allowPrerelease = false;
        au.setFeedURL(this.feed());
        await au.checkForUpdates();
      }
      return this.set({ state: 'available', latest: version, name: rel.name || rel.tag_name, notes: cleanNotes(rel.body), published: rel.published_at, url: rel.html_url, asset: asset ? { name: asset.name, size: asset.size } : null, prerelease: !!rel.prerelease, checkedAt: Date.now() });
    } catch (e) { this.set({ state: 'error', error: friendly(e) }); if (!silent) throw e; return this.state; }
  }

  pickAsset(rel) {
    const assets = rel.assets || [];
    const m = this.mode();
    const by = re => assets.find(a => re.test(a.name));
    if (m === 'portable') return by(/portable.*\.exe$/i) || by(/win.*x64.*\.zip$/i);
    if (m === 'zip' || m === 'dev') return process.platform === 'win32' ? (by(/win.*x64.*\.zip$/i) || by(/\.zip$/i)) : (by(/\.AppImage$/i) || by(/linux.*\.(zip|tar\.gz)$/i));
    return by(/setup.*\.exe$/i) || by(/\.exe$/i);
  }

  // ---------- pobieranie ----------
  async download() {
    if (this.state.state !== 'available') await this.check(false);
    if (this.state.state !== 'available') throw new Error('Brak dostępnej aktualizacji.');
    if (this.mode() === 'installer') { this.set({ state: 'downloading', progress: 0 }); await this.autoUpdater().downloadUpdate(); return this.state; }
    if (!this.asset) throw new Error('Wydanie nie zawiera pliku dla tej wersji programu (portable/zip). Pobierz je ręcznie ze strony wydania.');
    const dest = path.join(os.tmpdir(), 'codemanager-update', this.asset.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    this.set({ state: 'downloading', progress: 0 });
    await downloadWithHeaders(this.asset.browser_download_url, dest, {}, p => this.set({ state: 'downloading', progress: p.pct }));
    // weryfikacja: GitHub podaje skrót SHA-256 zasobu w polu "digest"
    if (this.asset.digest && /^sha256:/i.test(this.asset.digest)) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
      if (h !== this.asset.digest.slice(7).toLowerCase()) { fs.rmSync(dest, { force: true }); throw new Error('Pobrany plik ma nieprawidłową sumę kontrolną – aktualizacja przerwana.'); }
    } else if (fs.statSync(dest).size !== this.asset.size) { fs.rmSync(dest, { force: true }); throw new Error('Pobrany plik jest niekompletny.'); }
    this.downloaded = dest;
    return this.set({ state: 'downloaded', progress: 100 });
  }

  // ---------- instalacja ----------
  install() {
    const m = this.mode();
    if (m === 'installer') { setImmediate(() => this.autoUpdater().quitAndInstall(false, true)); return true; }
    if (!this.downloaded) throw new Error('Najpierw pobierz aktualizację.');
    if (process.platform !== 'win32') { require('electron').shell.showItemInFolder(this.downloaded); return 'manual'; }
    const pid = process.pid;
    const script = path.join(os.tmpdir(), 'codemanager-update', 'apply-update.cmd');
    let body;
    if (m === 'portable') {
      const target = process.env.PORTABLE_EXECUTABLE_FILE;
      body = `@echo off\r\nchcp 65001 >nul\r\n:wait\r\ntasklist /FI "PID eq ${pid}" | find "${pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)\r\ncopy /Y "${this.downloaded}" "${target}" >nul\r\nstart "" "${target}"\r\ndel "%~f0"\r\n`;
    } else {
      const dir = path.dirname(process.execPath);
      const ex = path.join(os.tmpdir(), 'codemanager-update', 'extracted');
      fs.rmSync(ex, { recursive: true, force: true });
      N.extractZip(this.downloaded, ex, {});
      const top = U.listDir(ex);
      const src = top.length === 1 && top[0].isDirectory() ? path.join(ex, top[0].name) : ex;
      if (!U.exists(path.join(src, path.basename(process.execPath)))) throw new Error('Archiwum aktualizacji nie zawiera pliku ' + path.basename(process.execPath));
      body = `@echo off\r\nchcp 65001 >nul\r\n:wait\r\ntasklist /FI "PID eq ${pid}" | find "${pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)\r\nrobocopy "${src}" "${dir}" /E /NFL /NDL /NJH /NJS /R:5 /W:1 >nul\r\nstart "" "${process.execPath}"\r\nrmdir /S /Q "${ex}"\r\ndel "%~f0"\r\n`;
    }
    fs.writeFileSync(script, body, 'utf8');
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    setTimeout(() => this.app.quit(), 300);
    return true;
  }
}

function cleanNotes(md) {
  if (!md) return '';
  return String(md).replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim().slice(0, 4000);
}
function friendly(e) {
  const m = String(e && e.message || e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(m)) return 'Brak połączenia z GitHub – sprawdź internet.';
  if (/latest\.yml/i.test(m)) return 'Wydanie na GitHub nie zawiera pliku latest.yml (zbuduj je przez npm run release lub workflow GitHub Actions).';
  return m.split('\n')[0];
}
async function downloadWithHeaders(url, dest, headers, onProgress) {
  const r = await fetch(url, { headers: { 'User-Agent': 'CodeManager-Updater', ...headers }, redirect: 'follow' });
  if (!r.ok) throw new Error('Pobieranie aktualizacji: HTTP ' + r.status);
  const total = +r.headers.get('content-length') || 0;
  const out = fs.createWriteStream(dest + '.part');
  const reader = r.body.getReader(); let done = 0, last = 0;
  for (;;) {
    const { done: end, value } = await reader.read(); if (end) break;
    done += value.length;
    if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
    if (Date.now() - last > 200) { last = Date.now(); onProgress({ pct: total ? Math.round(done / total * 100) : null }); }
  }
  await new Promise((res, rej) => out.end(e => (e ? rej(e) : res())));
  fs.renameSync(dest + '.part', dest);
}

module.exports = { Updater, cleanNotes, friendly };
