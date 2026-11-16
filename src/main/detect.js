// Wykrywanie gier: Steam (biblioteki + appmanifest), Epic, Rockstar, launchery Minecraft, skan dysków
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');
const { parseVDF, vget } = require('./parsers/text');
const { GAMES } = require('./games');

let steamCache = null;

async function steamRoots(override) {
  const c = [];
  if (override) c.push(override);
  if (U.isWin) {
    const a = await U.regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
    const b = await U.regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
    const d = await U.regQuery('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath');
    [a, b, d].forEach(x => x && c.push(path.normalize(x)));
    c.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  } else if (U.isMac) {
    c.push(path.join(U.home(), 'Library', 'Application Support', 'Steam'));
  } else {
    c.push(path.join(U.home(), '.steam', 'steam'), path.join(U.home(), '.local', 'share', 'Steam'),
      path.join(U.home(), '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'));
  }
  const seen = new Set(); const out = [];
  for (const p of c) {
    if (!U.isDir(path.join(p, 'steamapps'))) continue;
    let real = p; try { real = fs.realpathSync(p); } catch { /* */ }
    const k = real.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(real);
  }
  return out;
}

async function windowsDrives() {
  if (!U.isWin) return [];
  const out = [];
  for (let i = 67; i <= 90; i++) { const d = String.fromCharCode(i) + ':\\'; if (U.exists(d)) out.push(d); }
  return out;
}

async function steamLibraries(override) {
  const roots = await steamRoots(override);
  const libs = new Set();
  for (const r of roots) {
    libs.add(r);
    for (const f of [path.join(r, 'steamapps', 'libraryfolders.vdf'), path.join(r, 'config', 'libraryfolders.vdf')]) {
      const t = U.readText(f); if (!t) continue;
      const v = parseVDF(t); const lf = vget(v, 'libraryfolders') || vget(v, 'LibraryFolders') || {};
      for (const [k, val] of Object.entries(lf)) {
        if (!/^\d+$/.test(k)) continue;
        const p = typeof val === 'string' ? val : vget(val, 'path');
        if (p && U.isDir(path.join(p, 'steamapps'))) libs.add(path.normalize(p));
      }
    }
  }
  // awaryjnie: typowe foldery bibliotek na wszystkich dyskach
  for (const d of await windowsDrives()) {
    for (const n of ['SteamLibrary', 'Steam', 'Games\\Steam', 'Games\\SteamLibrary', 'Program Files (x86)\\Steam', 'Program Files\\Steam']) {
      const p = path.join(d, n); if (U.isDir(path.join(p, 'steamapps'))) libs.add(p);
    }
  }
  const uniq = []; const seen = new Set();
  for (const l of libs) { let real = l; try { real = fs.realpathSync(l); } catch { /* */ } if (!seen.has(real.toLowerCase())) { seen.add(real.toLowerCase()); uniq.push(real); } }
  return { roots, libraries: uniq };
}

async function steamApps(override, force = false) {
  if (steamCache && !force) return steamCache;
  const { roots, libraries } = await steamLibraries(override);
  const apps = {};
  for (const lib of libraries) {
    const sa = path.join(lib, 'steamapps');
    for (const f of U.listFiles(sa, ['.acf'])) {
      const m = path.basename(f).match(/^appmanifest_(\d+)\.acf$/i); if (!m) continue;
      const v = parseVDF(U.readText(f, ''));
      const st = vget(v, 'AppState') || {};
      const installdir = vget(st, 'installdir'); if (!installdir) continue;
      const full = path.join(sa, 'common', installdir);
      apps[m[1]] = { appid: +m[1], name: vget(st, 'name'), installdir, path: full, library: lib, buildid: vget(st, 'buildid'), installed: U.isDir(full) };
    }
  }
  steamCache = { roots, libraries, apps };
  return steamCache;
}

function workshopDir(steam, appid) {
  // workshop znajduje się w bibliotece, w której zainstalowano grę; sprawdzamy wszystkie
  const out = [];
  for (const lib of steam.libraries) { const p = path.join(lib, 'steamapps', 'workshop', 'content', String(appid)); if (U.isDir(p)) out.push(p); }
  return out;
}
function userdataDirs(steam, appid) {
  const out = [];
  for (const r of steam.roots) for (const u of U.listDirs(path.join(r, 'userdata'))) { const p = path.join(u, String(appid)); if (U.isDir(p)) out.push(p); }
  return out;
}

// ---------- Epic Games ----------
function epicManifests() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  return U.listFiles(dir, ['.item']).map(f => U.readJSON(f)).filter(Boolean);
}

// ---------- Minecraft: instancje z launcherów ----------
function mcVersionFromId(id) {
  if (!id) return {};
  let m;
  if ((m = id.match(/^fabric-loader-([\d.]+)-(.+)$/))) return { mcVersion: m[2], loader: 'fabric', loaderVersion: m[1] };
  if ((m = id.match(/^quilt-loader-([\d.]+)-(.+)$/))) return { mcVersion: m[2], loader: 'quilt', loaderVersion: m[1] };
  if ((m = id.match(/^(\d[\d.]*)-forge-?([\d.]+)/i))) return { mcVersion: m[1], loader: 'forge', loaderVersion: m[2] };
  if ((m = id.match(/^neoforge-(\d+)\.(\d+)\.(\d+)/i))) return { mcVersion: `1.${m[1]}${m[2] !== '0' ? '.' + m[2] : ''}`, loader: 'neoforge', loaderVersion: id.replace(/^neoforge-/, '') };
  if ((m = id.match(/^(\d+\.\d+(\.\d+)?)$/))) return { mcVersion: m[1], loader: 'vanilla' };
  return {};
}

function minecraftInstances() {
  const inst = [];
  const add = (o) => { if (o.path && U.isDir(o.path) && !inst.find(i => i.path.toLowerCase() === o.path.toLowerCase())) inst.push(o); };
  // .minecraft
  const dotmc = U.isWin ? path.join(U.appData(), '.minecraft') : U.isMac ? path.join(U.home(), 'Library', 'Application Support', 'minecraft') : path.join(U.home(), '.minecraft');
  if (U.isDir(dotmc)) {
    const lp = U.readJSON(path.join(dotmc, 'launcher_profiles.json'), {});
    let best = null;
    for (const p of Object.values(lp.profiles || {})) {
      if (!p.lastVersionId || p.type === 'latest-snapshot') continue;
      const gd = p.gameDir && U.isDir(p.gameDir) ? p.gameDir : null;
      if (gd && path.resolve(gd) !== path.resolve(dotmc)) {
        add({ id: 'mc-' + Buffer.from(gd).toString('base64url').slice(0, 16), name: `Launcher: ${p.name || p.lastVersionId}`, path: gd, launcher: 'Minecraft Launcher', ...mcVersionFromId(p.lastVersionId) });
      } else if (!best || (p.lastUsed || '') > (best.lastUsed || '')) best = p;
    }
    add({ id: 'mc-default', name: '.minecraft (domyślny)', path: dotmc, launcher: 'Minecraft Launcher', ...mcVersionFromId(best && best.lastVersionId) });
  }
  // Prism / MultiMC / PolyMC
  const prismRoots = [path.join(U.appData(), 'PrismLauncher', 'instances'), path.join(U.appData(), 'PolyMC', 'instances'),
    path.join(U.home(), '.local', 'share', 'PrismLauncher', 'instances'), path.join(U.home(), 'Library', 'Application Support', 'PrismLauncher', 'instances')];
  for (const r of prismRoots) {
    for (const d of U.listDirs(r)) {
      const pack = U.readJSON(path.join(d, 'mmc-pack.json')); if (!pack) continue;
      const cfg = U.readText(path.join(d, 'instance.cfg'), '');
      const name = (cfg.match(/^name=(.*)$/m) || [])[1] || path.basename(d);
      const comp = id => (pack.components || []).find(c => c.uid === id);
      const mc = comp('net.minecraft');
      let loader = 'vanilla', lv;
      for (const [uid, l] of [['net.fabricmc.fabric-loader', 'fabric'], ['org.quiltmc.quilt-loader', 'quilt'], ['net.neoforged', 'neoforge'], ['net.minecraftforge', 'forge']]) { const c = comp(uid); if (c) { loader = l; lv = c.version; break; } }
      const gd = U.firstExisting([path.join(d, '.minecraft'), path.join(d, 'minecraft')]) || path.join(d, '.minecraft');
      add({ id: 'prism-' + path.basename(d), name: `Prism: ${name}`, path: gd, launcher: 'Prism Launcher', mcVersion: mc && mc.version, loader, loaderVersion: lv });
    }
  }
  // CurseForge
  const cfRoots = [path.join(U.home(), 'curseforge', 'minecraft', 'Instances'), path.join(U.documents(), 'Curse', 'Minecraft', 'Instances')];
  for (const r of cfRoots) {
    for (const d of U.listDirs(r)) {
      const j = U.readJSON(path.join(d, 'minecraftinstance.json')); if (!j) continue;
      const bml = (j.baseModLoader && j.baseModLoader.name) || '';
      let loader = 'vanilla', lv;
      let m;
      if ((m = bml.match(/^(forge|neoforge|fabric|quilt)-(.+)$/i))) { loader = m[1].toLowerCase(); lv = m[2].replace(/-[\d.]+$/, ''); }
      add({ id: 'cf-' + path.basename(d), name: `CurseForge: ${j.name || path.basename(d)}`, path: d, launcher: 'CurseForge', mcVersion: j.gameVersion, loader, loaderVersion: lv });
    }
  }
  // Modrinth App
  for (const r of [path.join(U.appData(), 'ModrinthApp', 'profiles'), path.join(U.appData(), 'com.modrinth.theseus', 'profiles')]) {
    for (const d of U.listDirs(r)) {
      const j = U.readJSON(path.join(d, 'profile.json'), {});
      const meta = j.metadata || j;
      add({ id: 'mr-' + path.basename(d), name: `Modrinth: ${meta.name || path.basename(d)}`, path: d, launcher: 'Modrinth App', mcVersion: meta.game_version, loader: meta.loader || undefined });
    }
  }
  // ATLauncher / GDLauncher
  for (const r of [path.join(U.appData(), 'ATLauncher', 'instances'), path.join(U.appData(), 'gdlauncher_next', 'instances')]) {
    for (const d of U.listDirs(r)) {
      const j = U.readJSON(path.join(d, 'instance.json'), {});
      const mcv = j.id || (j.launcher && j.launcher.minecraftVersion) || (j.loader && j.loader.mcVersion);
      add({ id: 'at-' + path.basename(d), name: `Instancja: ${(j.launcher && j.launcher.name) || j.name || path.basename(d)}`, path: d, launcher: 'ATLauncher/GDLauncher', mcVersion: typeof mcv === 'string' ? mcv : undefined });
    }
  }
  return inst;
}

// ---------- Główne wykrywanie ----------
function hasExe(dir, exes) { return (exes || []).some(e => U.exists(path.join(dir, e))); }

async function scanCommonFolders(game) {
  // szukanie poza Steamem: popularne katalogi na wszystkich dyskach
  const out = [];
  const names = [game.name, game.name.replace(/[^\w\s]/g, ''), game.name.replace(/\s+/g, '')];
  for (const d of await windowsDrives()) {
    for (const base of ['Games', 'Gry', 'Program Files', 'Program Files (x86)', 'Program Files\\Rockstar Games', 'Program Files\\Epic Games', 'Epic Games', 'Rockstar Games', 'GOG Games', '']) {
      for (const n of names) {
        const p = path.join(d, base, n);
        if (U.isDir(p) && hasExe(p, game.exe)) out.push(p);
      }
    }
  }
  return out;
}

async function detectAll(config) {
  const steam = await steamApps(config.settings && config.settings.steamPath, true);
  const epic = U.isWin ? epicManifests() : [];
  const results = {};
  for (const g of GAMES) {
    const saved = (config.games || {})[g.id] || {};
    if (g.id === 'minecraft') {
      const auto = minecraftInstances();
      const manual = (saved.manualInstances || []).filter(i => U.isDir(i.path));
      const overrides = saved.instanceOverrides || {};
      const all = [...auto, ...manual].map(i => ({ ...i, ...(overrides[i.id] || {}) }));
      results[g.id] = { found: all.length > 0, source: all.length ? 'Launchery' : null, instances: all, path: all[0] && all[0].path };
      continue;
    }
    if (saved.manual && saved.path && U.isDir(saved.path)) {
      results[g.id] = { found: true, path: saved.path, source: 'Ręcznie', appid: g.appIds[0] };
    } else {
      let found = null;
      for (const id of g.appIds) {
        const a = steam.apps[id];
        if (a && a.installed) { found = { found: true, path: a.path, source: 'Steam', appid: id, buildid: a.buildid, steamName: a.name }; break; }
      }
      if (!found && g.epic) {
        const e = epic.find(m => g.epic.test(m.DisplayName || '') && U.isDir(m.InstallLocation));
        if (e) found = { found: true, path: e.InstallLocation, source: 'Epic Games' };
      }
      if (!found && g.id === 'gta5' && U.isWin) {
        for (const k of ['HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Grand Theft Auto V', 'HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\GTAV Enhanced']) {
          const p = await U.regQuery(k, 'InstallFolder');
          if (p && U.isDir(p)) { found = { found: true, path: p, source: 'Rockstar Launcher' }; break; }
        }
      }
      if (!found && g.extraPaths) { const p = g.extraPaths.find(x => U.isDir(x) && hasExe(x, g.exe)); if (p) found = { found: true, path: p, source: 'Instalacja samodzielna' }; }
      if (!found) {
        const scan = await scanCommonFolders(g);
        if (scan.length) found = { found: true, path: scan[0], source: 'Skan dysku' };
      }
      results[g.id] = found || { found: false };
    }
    const r = results[g.id];
    r.workshop = g.workshop ? workshopDir(steam, g.workshop) : [];
    if (g.id === 'transportfever2') r.userdata = userdataDirs(steam, 1066780);
    if (g.id === 'terraria') {
      // tModLoader jest osobną aplikacją – preferuj ją
      const tml = steam.apps[1281930];
      if (tml && tml.installed && !saved.manual) { r.path = tml.path; r.appid = 1281930; r.found = true; r.source = 'Steam'; }
    }
    if (r.found && r.path && g.exe && !hasExe(r.path, g.exe)) r.warning = 'W folderze nie znaleziono pliku wykonywalnego gry – sprawdź lokalizację.';
  }
  return { games: results, steam: { roots: steam.roots, libraries: steam.libraries } };
}

module.exports = { detectAll, steamApps, workshopDir, minecraftInstances, mcVersionFromId, userdataDirs };
