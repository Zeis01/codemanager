// Gry Unity: BepInEx (+ Thunderstore), MelonLoader, RedLoader
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const { peVersion, fileContains } = require('../parsers/binary');
const { Report, sizeOf } = require('./common');

// ---------- Profile menedżerów Thunderstore ----------
function thunderstoreProfiles(game, gamePath) {
  const out = [];
  if (gamePath) out.push({ id: 'game', name: 'Folder gry', root: gamePath });
  const ad = U.appData();
  for (const r2 of game.r2 || []) {
    for (const [mgr, base] of [['r2modman', path.join(ad, 'r2modmanPlus-local', r2, 'profiles')], ['Thunderstore App', path.join(ad, 'Thunderstore Mod Manager', 'DataFolder', r2, 'profiles')]]) {
      for (const d of U.listDirs(base)) out.push({ id: mgr + ':' + path.basename(d), name: `${mgr}: ${path.basename(d)}`, root: d });
    }
  }
  if (game.thunderstore) {
    for (const d of U.listDirs(path.join(ad, 'com.kesomannen.gale', game.thunderstore, 'profiles'))) out.push({ id: 'gale:' + path.basename(d), name: `Gale: ${path.basename(d)}`, root: d });
  }
  return out;
}

function bepinexInfo(root) {
  const core5 = path.join(root, 'BepInEx', 'core', 'BepInEx.dll');
  const core6 = path.join(root, 'BepInEx', 'core', 'BepInEx.Core.dll');
  const info = { installed: false, version: null, major: null, doorstop: U.exists(path.join(root, 'winhttp.dll')) || U.exists(path.join(root, 'version.dll')), doorstopCfg: U.exists(path.join(root, 'doorstop_config.ini')) };
  if (U.exists(core5)) { info.installed = true; info.major = 5; const v = peVersion(core5); info.version = v && v.file; }
  else if (U.exists(core6)) { info.installed = true; info.major = 6; const v = peVersion(core6); info.version = v && v.file; }
  return info;
}

function readPackages(pluginsDir) {
  const pkgs = []; const loose = [];
  for (const d of U.listDir(pluginsDir)) {
    const full = path.join(pluginsDir, d.name);
    if (d.isDirectory()) {
      const man = U.readJSON(path.join(full, 'manifest.json'));
      const dlls = U.walk(full, { filter: r => /\.dll(\.old)?$/i.test(r), maxDepth: 4 });
      const enabled = dlls.length === 0 || dlls.some(x => /\.dll$/i.test(x));
      const parts = d.name.split('-');
      const fullName = man ? (parts.length >= 2 ? `${parts[0]}-${man.name}` : man.name) : d.name;
      pkgs.push({ folder: full, dirName: d.name, fullName, name: man ? man.name : d.name, version: man ? man.version_number : null, deps: man ? man.dependencies || [] : [], manifest: !!man, dlls, enabled, website: man && man.website_url });
    } else if (/\.dll(\.old)?$/i.test(d.name)) {
      loose.push({ file: full, name: d.name, enabled: /\.dll$/i.test(d.name) });
    }
  }
  return { pkgs, loose };
}

const BEPINEX_PACKS = /^(bepinex-bepinexpack|denikson-bepinexpack|bbepis-bepinexpack|bepinex-bepinex)/i;

function checkBepInEx(ctx) {
  const rep = new Report(ctx.title || 'BepInEx');
  const root = ctx.root;
  const bep = bepinexInfo(root);
  rep.meta = { 'Profil': ctx.profileName || root, 'BepInEx': bep.installed ? `v${bep.version || bep.major}` : 'brak' };
  if (!bep.installed) {
    rep.error('BepInEx nie jest zainstalowany w tym profilu', { fix: 'Zainstaluj BepInEx 5 (przycisk w zakładce Modloader).', action: { type: 'thunderstore', full: 'BepInEx-BepInExPack', label: 'Zainstaluj BepInEx' } });
  } else {
    if (bep.major === 6 && ctx.expectMajor === 5) rep.error('Zainstalowano BepInEx 6, a mody tej gry wymagają BepInEx 5', { fix: 'Zainstaluj BepInEx 5.4.x.' });
    if (ctx.profileName === 'Folder gry' && !bep.doorstop) rep.error('Brak winhttp.dll (Doorstop) – BepInEx nie uruchomi się', { fix: 'Przeinstaluj BepInEx.' });
    if (ctx.profileName === 'Folder gry' && !bep.doorstopCfg) rep.warn('Brak doorstop_config.ini');
  }
  if (U.isDir(path.join(root, 'MelonLoader'))) rep.warn('W tym samym folderze jest MelonLoader – dwa loadery naraz często powodują awarię gry.');
  const pluginsDir = path.join(root, 'BepInEx', 'plugins');
  const { pkgs, loose } = readPackages(pluginsDir);
  const byName = new Map(pkgs.map(p => [p.fullName.toLowerCase(), p]));
  const byShort = new Map(pkgs.map(p => [p.name.toLowerCase(), p]));
  for (const p of pkgs) {
    rep.addMod({ key: p.folder, file: p.folder, name: p.fullName, version: p.version || '?', enabled: p.enabled, toggleable: true, toggle: 'dllold', source: p.manifest ? 'Thunderstore' : 'Folder', url: p.website });
  }
  for (const l of loose) rep.addMod({ key: l.file, file: l.file, name: l.name.replace(/\.dll(\.old)?$/i, ''), version: '?', enabled: l.enabled, toggleable: true, toggle: 'dllold', source: 'Luźny plik DLL', size: sizeOf(l.file) });
  // zależności
  for (const p of pkgs) {
    if (!p.enabled) continue;
    if (!p.dlls.length && p.manifest) rep.note(`${p.fullName} nie zawiera plików DLL (pakiet zasobów lub konfiguracji)`, { mod: p.folder });
    for (const dep of p.deps) {
      const m = String(dep).match(/^(.+)-(\d+\.\d+\.\d+)$/);
      const depName = m ? m[1] : dep; const depVer = m ? m[2] : null;
      if (BEPINEX_PACKS.test(depName)) { if (!bep.installed) rep.error(`${p.fullName} wymaga BepInEx`, { mod: p.folder, action: { type: 'thunderstore', full: depName.replace(/-\d+\.\d+\.\d+$/, ''), label: 'Zainstaluj BepInEx' } }); continue; }
      const found = byName.get(depName.toLowerCase()) || byShort.get(depName.split('-').slice(1).join('-').toLowerCase());
      if (!found) rep.error(`${p.fullName} wymaga ${depName}${depVer ? ' ≥ ' + depVer : ''}`, { mod: p.folder, fix: 'Zainstaluj brakującą paczkę z Thunderstore.', action: { type: 'thunderstore', full: depName, label: `Zainstaluj ${depName}` } });
      else if (!found.enabled) rep.error(`${p.fullName} wymaga ${depName}, ale jest wyłączony`, { mod: p.folder, fix: 'Włącz zależność.' });
      else if (depVer && found.version && U.cmpVer(found.version, depVer) < 0) rep.warn(`${p.fullName} wymaga ${depName} ≥ ${depVer} (masz ${found.version})`, { mod: p.folder, fix: 'Zaktualizuj zależność.', action: { type: 'thunderstore', full: depName, label: `Zaktualizuj ${depName}` } });
    }
  }
  // duplikaty DLL
  const dllMap = new Map();
  for (const p of pkgs.filter(x => x.enabled)) for (const d of p.dlls.filter(x => /\.dll$/i.test(x))) { const b = path.basename(d).toLowerCase(); dllMap.set(b, [...(dllMap.get(b) || []), p.fullName]); }
  for (const l of loose.filter(x => x.enabled)) { const b = l.name.toLowerCase(); dllMap.set(b, [...(dllMap.get(b) || []), l.name]); }
  for (const [dll, owners] of dllMap) if (owners.length > 1) rep.warn(`Plik ${dll} występuje ${owners.length}×`, { files: owners, detail: 'Ta sama biblioteka w kilku paczkach – może dojść do wczytania złej wersji lub podwójnego pluginu.', mod: null });
  // log BepInEx
  const log = U.readText(path.join(root, 'BepInEx', 'LogOutput.log'), '') || U.readText(path.join(root, 'BepInEx', 'LogOutput.txt'), '');
  if (log) {
    const lines = log.split(/\r?\n/);
    const errs = lines.filter(l => /\[(Error|Fatal)\s*:/.test(l) || /Could not load \[|Skipping \[|missing dependencies|incompatible with/i.test(l)).slice(0, 20);
    errs.forEach(l => rep.warn('LogOutput: ' + l.slice(0, 240)));
    if (errs.length) rep.meta['Log'] = 'ostatnie uruchomienie zawiera błędy';
  }
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(`Wszystkie zależności spełnione (${pkgs.length + loose.length} modów)`);
  return rep.finish();
}

async function thunderstoreOnline(ctx) {
  const { pkgs } = readPackages(path.join(ctx.root, 'BepInEx', 'plugins'));
  const out = [];
  for (const p of pkgs.filter(x => x.manifest)) {
    const [ns, ...rest] = p.fullName.split('-'); const name = rest.join('-');
    if (!ns || !name) continue;
    try {
      const r = await fetch(`https://thunderstore.io/api/experimental/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/`, { headers: { 'User-Agent': 'CodeManager/1.0' } });
      if (!r.ok) { out.push({ level: 'info', mod: p.folder, title: `${p.fullName}: nie znaleziono na Thunderstore` }); continue; }
      const j = await r.json();
      if (j.is_deprecated) out.push({ level: 'warn', mod: p.folder, title: `${p.fullName}: paczka oznaczona jako przestarzała (deprecated)` });
      if (j.latest && p.version && U.cmpVer(j.latest.version_number, p.version) > 0) out.push({ level: 'info', mod: p.folder, title: `${p.fullName}: dostępna aktualizacja ${p.version} → ${j.latest.version_number}`, url: j.package_url });
    } catch (e) { out.push({ level: 'info', title: 'Thunderstore niedostępny: ' + e.message }); break; }
  }
  if (!out.length) out.push({ level: 'ok', title: 'Wszystkie paczki są aktualne' });
  return out;
}

// ---------- MelonLoader ----------
function melonInfo(root) {
  const cands = ['MelonLoader/net6/MelonLoader.dll', 'MelonLoader/net35/MelonLoader.dll', 'MelonLoader/MelonLoader.dll'].map(p => path.join(root, p));
  const f = U.firstExisting(cands);
  const v = f ? peVersion(f) : null;
  return { installed: !!f, version: v ? v.file.replace(/\.0$/, '') : null, proxy: ['version.dll', 'winmm.dll', 'dobby.dll'].some(x => U.exists(path.join(root, x))) };
}

function checkMelonLoader(ctx) {
  const rep = new Report(ctx.title || 'MelonLoader');
  const root = ctx.root;
  const ml = melonInfo(root);
  const il2cpp = U.exists(path.join(root, 'GameAssembly.dll'));
  rep.meta = { 'MelonLoader': ml.installed ? (ml.version || 'zainstalowany') : 'brak', 'Backend gry': il2cpp ? 'IL2CPP (gałąź główna)' : 'Mono (gałąź alternate)' };
  if (!ml.installed) rep.error('MelonLoader nie jest zainstalowany', { fix: 'Zainstaluj MelonLoader (zakładka Modloader).', action: { type: 'loader', id: 'melonloader', label: 'Zainstaluj MelonLoader' } });
  else if (!ml.proxy) rep.error('Brak pliku version.dll – MelonLoader się nie uruchomi', { fix: 'Przeinstaluj MelonLoader.' });
  if (ml.version && U.cmpVer(ml.version, '0.6') < 0) rep.warn(`Stara wersja MelonLoadera (${ml.version})`, { fix: 'Zainstaluj MelonLoader 0.7+.' });
  if (U.isDir(path.join(root, 'BepInEx'))) rep.warn('W folderze gry jest też BepInEx – dwa loadery naraz mogą się gryźć.');
  for (const [sub, label] of [['Mods', 'Mod'], ['Plugins', 'Plugin']]) {
    const dir = path.join(root, sub);
    for (const d of U.listDir(dir)) {
      if (!d.isFile() || !/\.dll(\.disabled)?$/i.test(d.name)) continue;
      const file = path.join(dir, d.name);
      const enabled = !/\.disabled$/i.test(d.name);
      const name = d.name.replace(/\.dll(\.disabled)?$/i, '');
      rep.addMod({ key: file, file, name, version: (peVersion(file) || {}).file || '?', enabled, toggleable: true, source: label, size: sizeOf(file) });
      if (!enabled) continue;
      const s = fileContains(file, ['Il2CppInterop', 'UnhollowerBaseLib', 'Il2CppScheduleOne', 'Il2Cppmscorlib', 'Assembly-CSharp', 'MelonLoader', 'BepInEx', 'ScheduleOne']);
      const modIl2 = s.Il2CppInterop || s.UnhollowerBaseLib || s.Il2CppScheduleOne || s.Il2Cppmscorlib;
      const modMono = !modIl2 && (s['Assembly-CSharp'] || s.ScheduleOne);
      if (s.BepInEx && !s.MelonLoader) rep.error(`${name} to plugin BepInEx, nie mod MelonLoader`, { mod: file, fix: 'Usuń go z folderu Mods.' });
      if (s.UnhollowerBaseLib && ml.version && U.cmpVer(ml.version, '0.6') >= 0) rep.error(`${name} jest zbudowany dla MelonLoader 0.5 (Unhollower)`, { mod: file, fix: 'Pobierz wersję zgodną z MelonLoader 0.6+.' });
      if (il2cpp && modMono) rep.error(`${name} jest dla wersji Mono, a gra działa na IL2CPP`, { mod: file, fix: 'Pobierz wersję IL2CPP moda lub przełącz grę na gałąź "alternate" w Steam.' });
      if (!il2cpp && modIl2) rep.error(`${name} jest dla wersji IL2CPP, a gra działa na Mono`, { mod: file, fix: 'Pobierz wersję Mono moda lub wróć na główną gałąź gry.' });
      if (!modIl2 && !modMono && !s.MelonLoader) rep.note(`${name}: nie rozpoznano typu – może to być biblioteka`, { mod: file });
    }
  }
  const log = U.readText(path.join(root, 'MelonLoader', 'Latest.log'), '');
  if (log) {
    const errs = log.split(/\r?\n/).filter(l => /\[ERROR\]|Failed to load|Incompatible|is missing the following dependencies/i.test(l)).slice(0, 20);
    errs.forEach(l => rep.warn('Latest.log: ' + l.slice(0, 240)));
  }
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Mody pasują do backendu gry');
  return rep.finish();
}

// ---------- RedLoader (Sons of the Forest) ----------
function checkRedLoader(ctx) {
  const rep = new Report(ctx.title || 'RedLoader');
  const root = ctx.root;
  const installed = U.isDir(path.join(root, '_RedLoader'));
  const core = U.firstExisting([path.join(root, '_RedLoader', 'net6', 'RedLoader.dll'), path.join(root, '_RedLoader', 'RedLoader.dll')]);
  const ver = core ? (peVersion(core) || {}).file : null;
  rep.meta = { 'RedLoader': installed ? (ver || 'zainstalowany') : 'brak' };
  if (!installed) rep.error('RedLoader nie jest zainstalowany', { fix: 'Zainstaluj RedLoader (zakładka Modloader).', action: { type: 'loader', id: 'redloader', label: 'Zainstaluj RedLoader' } });
  if (U.isDir(path.join(root, 'MelonLoader'))) rep.warn('Wykryto MelonLoader (stary SonsModLoader) – RedLoader go zastępuje; usuń stary loader.');
  const modsDir = path.join(root, 'Mods');
  const mods = new Map();
  for (const d of U.listDir(modsDir)) {
    if (d.isFile() && /\.dll(\.disabled)?$/i.test(d.name)) {
      const id = d.name.replace(/\.dll(\.disabled)?$/i, '');
      const manPath = U.firstExisting([path.join(modsDir, id, 'manifest.json'), path.join(modsDir, id + '.json')]);
      const man = manPath ? U.readJSON(manPath) : null;
      mods.set(id.toLowerCase(), { id: (man && man.id) || id, file: path.join(modsDir, d.name), enabled: !/\.disabled$/i.test(d.name), man });
    }
  }
  for (const m of mods.values()) {
    const man = m.man || {};
    rep.addMod({ key: m.file, file: m.file, name: man.name || m.id, version: man.version || '?', enabled: m.enabled, toggleable: true, source: man.type || 'Mod' });
    if (!m.man) rep.warn(`${m.id}: brak manifest.json`, { mod: m.file, detail: 'RedLoader oczekuje manifestu w Mods/<Mod>/manifest.json.' });
    if (!m.enabled) continue;
    for (const dep of man.dependencies || []) {
      const d = mods.get(String(dep).toLowerCase()) || [...mods.values()].find(x => x.man && String(x.man.id).toLowerCase() === String(dep).toLowerCase());
      if (!d) rep.error(`${man.name || m.id} wymaga moda "${dep}"`, { mod: m.file, fix: 'Zainstaluj zależność.' });
      else if (!d.enabled) rep.error(`${man.name || m.id} wymaga "${dep}", który jest wyłączony`, { mod: m.file });
    }
    if (man.platform && /server/i.test(man.platform) && !/client|universal/i.test(man.platform)) rep.warn(`${man.name || m.id} jest modem tylko dla serwera dedykowanego`, { mod: m.file });
  }
  const log = U.readText(path.join(root, '_RedLoader', 'Latest.log'), '');
  if (log) log.split(/\r?\n/).filter(l => /\[ERROR\]|Failed to load/i.test(l)).slice(0, 15).forEach(l => rep.warn('Latest.log: ' + l.slice(0, 240)));
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Nie wykryto problemów');
  return rep.finish();
}

module.exports = { thunderstoreProfiles, checkBepInEx, thunderstoreOnline, checkMelonLoader, checkRedLoader, bepinexInfo, melonInfo };
