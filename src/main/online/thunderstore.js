// Thunderstore: instalacja paczek (układ r2modman), zależności, aktualizacje, import profili r2modman
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const YAML = require('yaml');
const U = require('../util');
const N = require('../net');

const UA = { 'User-Agent': 'CodeManager/1.1' };
async function info(ns, name) {
  const r = await fetch(`https://thunderstore.io/api/experimental/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/`, { headers: UA });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Thunderstore: HTTP ' + r.status);
  return r.json();
}
function splitFull(full) {
  // "Autor-Nazwa" lub "Autor-Nazwa-1.2.3"
  const m = String(full).trim().match(/^([^-]+)-(.+?)(?:-(\d+\.\d+\.\d+))?$/);
  if (!m) throw new Error('Nieprawidłowa nazwa paczki: ' + full + ' (oczekiwano Autor-Nazwa)');
  return { ns: m[1], name: m[2], version: m[3] || null };
}
function parseInput(s) {
  // akceptuje też adres strony thunderstore.io/c/<gra>/p/<autor>/<nazwa>/
  const m = String(s).match(/thunderstore\.io\/(?:c\/[^/]+\/)?(?:p|package)\/([^/]+)\/([^/?#]+)/i);
  if (m) return { ns: m[1], name: m[2], version: null };
  return splitFull(s);
}

const isPack = name => /^BepInExPack/i.test(name);

// Instalacja wg reguł r2modman
function installZip(zipFile, root, ns, name) {
  const zip = new AdmZip(zipFile);
  const entries = zip.getEntries().map(e => e.entryName.replace(/\\/g, '/'));
  const folder = `${ns}-${name}`;
  const bep = path.join(root, 'BepInEx');
  if (isPack(name)) {
    const top = entries.find(e => /^BepInExPack[^/]*\//i.test(e));
    const sub = top ? top.split('/')[0] : null;
    N.extractZip(zipFile, root, sub ? { subdir: sub } : {});
    return { target: root, pack: true };
  }
  const has = p => entries.some(e => e.toLowerCase().startsWith(p));
  if (has('bepinex/')) {
    N.extractZip(zipFile, root, {});
    return { target: path.join(bep, 'plugins', folder) };
  }
  const pluginsDir = path.join(bep, 'plugins', folder);
  fs.mkdirSync(pluginsDir, { recursive: true });
  if (has('plugins/') || has('patchers/') || has('config/') || has('core/')) {
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      const n = e.entryName.replace(/\\/g, '/'); const low = n.toLowerCase();
      let dest;
      if (low.startsWith('plugins/')) dest = path.join(pluginsDir, n.slice(8));
      else if (low.startsWith('patchers/')) dest = path.join(bep, 'patchers', folder, n.slice(9));
      else if (low.startsWith('config/')) dest = path.join(bep, 'config', n.slice(7));
      else if (low.startsWith('core/')) dest = path.join(bep, 'core', n.slice(5));
      else dest = path.join(pluginsDir, n);
      if (n.includes('..')) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.getData());
    }
  } else N.extractZip(zipFile, pluginsDir, {});
  return { target: pluginsDir };
}

function installedPackages(root) {
  const dir = path.join(root, 'BepInEx', 'plugins');
  const out = new Map();
  for (const d of U.listDirs(dir)) {
    const man = U.readJSON(path.join(d, 'manifest.json'));
    if (!man) continue;
    const parts = path.basename(d).split('-');
    const full = parts.length >= 2 ? `${parts[0]}-${man.name}` : man.name;
    out.set(full.toLowerCase(), { dir: d, version: man.version_number, full });
  }
  return out;
}
function bepinexInstalled(root) { return U.exists(path.join(root, 'BepInEx', 'core', 'BepInEx.dll')) || U.exists(path.join(root, 'BepInEx', 'core', 'BepInEx.Core.dll')); }

/**
 * Instalacja paczki z zależnościami. ctx: { root, log, progress, backupRoot }
 */
async function install(input, ctx, _seen = new Set()) {
  const { ns, name, version } = typeof input === 'string' ? parseInput(input) : input;
  const key = `${ns}-${name}`.toLowerCase();
  if (_seen.has(key)) return [];
  _seen.add(key);
  if (isPack(name) && bepinexInstalled(ctx.root) && !ctx.forcePack) { ctx.log && ctx.log('✔ BepInEx już zainstalowany'); return []; }
  const inst = installedPackages(ctx.root);
  const j = await info(ns, name);
  if (!j) throw new Error(`Nie znaleziono paczki ${ns}-${name} na Thunderstore`);
  const ver = version || j.latest.version_number;
  const cur = inst.get(key);
  const done = [];
  if (cur && cur.version === ver) ctx.log && ctx.log(`✔ ${ns}-${name} ${ver} już zainstalowany`);
  else {
    ctx.log && ctx.log(`Pobieranie ${ns}-${name} ${ver}…`);
    const tmp = await N.download(`https://thunderstore.io/package/download/${ns}/${name}/${ver}/`, N.tempFile(`${ns}-${name}-${ver}.zip`), ctx.progress);
    if (cur) moveToBackup(cur.dir, ctx);
    installZip(tmp, ctx.root, ns, name);
    fs.rmSync(tmp, { force: true });
    done.push({ name: `${ns}-${name}`, version: ver, updatedFrom: cur ? cur.version : null });
  }
  // zależności z manifestu wersji
  const deps = version ? ((j.versions || []).find(v => v.version_number === ver) || j.latest).dependencies : j.latest.dependencies;
  for (const d of deps || []) {
    const p = splitFull(d);
    const have = inst.get(`${p.ns}-${p.name}`.toLowerCase());
    if (have && (!p.version || U.cmpVer(have.version, p.version) >= 0)) continue;
    try { done.push(...await install({ ns: p.ns, name: p.name, version: null }, ctx, _seen)); } catch (e) { ctx.log && ctx.log('⚠ ' + e.message); }
  }
  return done;
}

function moveToBackup(dir, ctx) {
  const b = path.join(ctx.backupRoot || path.join(ctx.root, 'BepInEx', '.codemanager-old'), new Date().toISOString().replace(/[:.]/g, '-'), path.basename(dir));
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.renameSync(dir, b);
}

async function updateAll(ctx) {
  const inst = installedPackages(ctx.root);
  const res = { updated: [], upToDate: 0, unknown: [], available: [] };
  for (const p of inst.values()) {
    const { ns, name } = splitFull(p.full);
    try {
      const j = await info(ns, name);
      if (!j) { res.unknown.push(p.full); continue; }
      if (U.cmpVer(j.latest.version_number, p.version) > 0) { if (ctx.dryRun) res.available.push({ name: p.full, from: p.version, to: j.latest.version_number }); else res.updated.push(...await install({ ns, name, version: j.latest.version_number }, ctx)); }
      else res.upToDate++;
    } catch (e) { ctx.log && ctx.log('✖ ' + p.full + ': ' + e.message); }
  }
  return res;
}

// ---------- import profilu r2modman ----------
async function fetchProfileCode(code) {
  const r = await fetch(`https://thunderstore.io/api/experimental/legacyprofile/get/${encodeURIComponent(code.trim())}/`, { headers: UA });
  if (!r.ok) throw new Error('Nie znaleziono profilu o tym kodzie (kody r2modman wygasają po pewnym czasie).');
  const text = (await r.text()).trim();
  const b64 = text.replace(/^#r2modman\s*/, '');
  const tmp = N.tempFile('profile.r2z');
  fs.writeFileSync(tmp, Buffer.from(b64, 'base64'));
  return tmp;
}
function readR2z(file) {
  const zip = new AdmZip(file);
  const e = zip.getEntry('export.r2x');
  if (!e) throw new Error('Plik nie zawiera export.r2x – to nie jest eksport r2modman.');
  const y = YAML.parse(e.getData().toString('utf8')) || {};
  const mods = (y.mods || []).map(m => ({ full: m.name, version: m.version ? `${m.version.major}.${m.version.minor}.${m.version.patch}` : null, enabled: m.enabled !== false }));
  return { zip, name: y.profileName || 'Profil', mods };
}
async function importR2(source, ctx) {
  const file = /\.r2z$/i.test(source) || U.exists(source) ? source : await fetchProfileCode(source);
  const prof = readR2z(file);
  ctx.log && ctx.log(`Profil „${prof.name}”: ${prof.mods.length} paczek`);
  // najpierw BepInExPack
  prof.mods.sort((a, b) => (isPack(b.full.split('-').slice(1).join('-')) ? 1 : 0) - (isPack(a.full.split('-').slice(1).join('-')) ? 1 : 0));
  const done = [];
  let i = 0;
  for (const m of prof.mods) {
    i++;
    const { ns, name } = splitFull(m.full);
    ctx.progress && ctx.progress({ pct: Math.round(i / prof.mods.length * 95) });
    try {
      done.push(...await install({ ns, name, version: m.version }, { ...ctx, forcePack: isPack(name) && !bepinexInstalled(ctx.root) }, new Set()));
      if (!m.enabled && !isPack(name)) {
        const dir = path.join(ctx.root, 'BepInEx', 'plugins', `${ns}-${name}`);
        for (const f of U.walk(dir, { filter: r => /\.dll$/i.test(r) })) fs.renameSync(path.join(dir, f), path.join(dir, f) + '.old');
      }
    } catch (e) { ctx.log && ctx.log(`✖ ${m.full}: ${e.message}`); }
  }
  // pliki konfiguracyjne z eksportu
  let cfg = 0;
  for (const e of prof.zip.getEntries()) {
    const n = e.entryName.replace(/\\/g, '/');
    if (e.isDirectory || n === 'export.r2x' || n.includes('..')) continue;
    const dest = path.join(ctx.root, n);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, e.getData()); cfg++;
  }
  ctx.log && ctx.log(`Skopiowano ${cfg} plików konfiguracyjnych.`);
  return { name: prof.name, installed: done.length, total: prof.mods.length };
}

module.exports = { info, install, updateAll, importR2, readR2z, installZip, installedPackages, parseInput, splitFull };
