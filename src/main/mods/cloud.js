// Kopie w chmurze: zapisy gier, lista modów (kod profilu) i opcjonalnie folder modów
// trafiają do folderu OneDrive / Google Drive / Dropbox / iCloud, który synchronizuje ich klient.
// Dzięki temu nie trzeba logowania w CodeManager – wystarczy zainstalowany program chmury.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');

function detectProviders({ env = process.env, custom } = {}) {
  const out = [];
  const add = (id, name, p) => { if (p && U.isDir(p) && !out.some(o => path.resolve(o.path) === path.resolve(p))) out.push({ id, name, path: p }); };
  add('onedrive', 'OneDrive', env.OneDriveConsumer || env.OneDrive);
  if (env.OneDriveCommercial && env.OneDriveCommercial !== env.OneDrive) add('onedrive-work', 'OneDrive (praca/szkoła)', env.OneDriveCommercial);
  for (const base of [env.APPDATA, env.LOCALAPPDATA].filter(Boolean)) {
    const info = U.readJSON(path.join(base, 'Dropbox', 'info.json'), null);
    if (info) { if (info.personal) add('dropbox', 'Dropbox', info.personal.path); if (info.business) add('dropbox-work', 'Dropbox (firma)', info.business.path); }
  }
  add('dropbox', 'Dropbox', path.join(U.home(), 'Dropbox'));
  // Google Drive dla komputerów: dysk wirtualny (np. G:\Mój dysk) albo stary folder Backup and Sync
  if (U.isWin) for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') for (const n of ['My Drive', 'Mój dysk']) add('gdrive', 'Google Drive', `${l}:\\${n}`);
  add('gdrive', 'Google Drive', path.join(U.home(), 'Google Drive'));
  add('gdrive', 'Google Drive', path.join(U.home(), 'My Drive'));
  add('icloud', 'iCloud Drive', path.join(U.home(), 'iCloudDrive'));
  add('icloud', 'iCloud Drive', path.join(U.home(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
  if (custom) add('custom', 'Własny folder', custom);
  return out;
}

const stamp = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}-${String(t.getMinutes()).padStart(2, '0')}-${String(t.getSeconds()).padStart(2, '0')}`;
const machine = () => U.safeName(os.hostname() || 'komputer').replace(/\s+/g, '_');

class CloudBackup {
  constructor({ runTar }) { this.runTar = runTar; }
  root(provider) { return path.join(provider.path, 'CodeManager'); }
  gameDir(provider, gameId, host = machine()) { return path.join(this.root(provider), host, gameId); }
  // parts: { saves: [katalogi], mods: [katalogi], profileCode: 'CM1:…', note }
  async backup(provider, gameId, parts, { label = '', keep = 10 } = {}) {
    const dir = path.join(this.gameDir(provider, gameId), stamp() + (label ? '_' + U.safeName(label).replace(/\s+/g, '_').slice(0, 40) : ''));
    fs.mkdirSync(dir, { recursive: true });
    const manifest = { version: 1, gameId, host: machine(), created: Date.now(), label, items: [] };
    try {
      for (const [kind, dirs] of [['saves', parts.saves || []], ['mods', parts.mods || []]]) {
        dirs.forEach((src, i) => {
          if (!U.isDir(src)) return;
          manifest.items.push({ kind, src, file: `${kind}-${i}.tar.gz` });
        });
      }
      for (const it of manifest.items) await this.runTar(['-czf', path.join(dir, it.file), '-C', it.src, '.']);
      if (parts.profileCode) { fs.writeFileSync(path.join(dir, 'profil-modow.txt'), parts.profileCode + '\n'); manifest.items.push({ kind: 'profile', file: 'profil-modow.txt' }); }
      manifest.size = manifest.items.reduce((a, it) => a + (U.exists(path.join(dir, it.file)) ? fs.statSync(path.join(dir, it.file)).size : 0), 0);
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
    this.prune(provider, gameId, keep);
    return { dir, ...manifest };
  }
  // kopie tej gry ze wszystkich komputerów
  list(provider, gameId) {
    const out = [];
    for (const host of U.listDirs(this.root(provider))) {
      for (const d of U.listDirs(path.join(host, gameId))) {
        const m = U.readJSON(path.join(d, 'manifest.json'), null);
        if (m) out.push({ ...m, dir: d, id: path.basename(d), host: path.basename(host), own: path.basename(host) === machine() });
      }
    }
    return out.sort((a, b) => b.created - a.created);
  }
  prune(provider, gameId, keep) {
    const mine = this.list(provider, gameId).filter(b => b.own && !/_(ręczna|reczna|manual)/i.test(b.id));
    for (const b of mine.slice(Math.max(1, keep))) fs.rmSync(b.dir, { recursive: true, force: true });
  }
  // przywraca zapisy (i mody, jeśli są) do podanych folderów; przed nadpisaniem robi kopię lokalną
  async restore(backup, { saves = [], mods = [], safety } = {}) {
    const m = backup.items || U.readJSON(path.join(backup.dir, 'manifest.json'), { items: [] }).items;
    const targets = { saves, mods }; const done = [];
    for (const it of m) {
      if (!targets[it.kind]) continue;
      const idx = +it.file.match(/-(\d+)\.tar\.gz$/)[1];
      const dest = targets[it.kind][idx] || targets[it.kind][0];
      if (!dest) continue;
      if (safety && U.isDir(dest)) await safety(dest);
      fs.mkdirSync(dest, { recursive: true });
      await this.runTar(['-xzf', path.join(backup.dir, it.file), '-C', dest]);
      done.push({ kind: it.kind, dest });
    }
    const code = U.exists(path.join(backup.dir, 'profil-modow.txt')) ? U.readText(path.join(backup.dir, 'profil-modow.txt'), '').trim() : null;
    return { restored: done, profileCode: code };
  }
}

module.exports = { detectProviders, CloudBackup, machine, stamp };
