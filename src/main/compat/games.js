// Checkery gier: Project Zomboid, ETS2, People Playground, Transport Fever 2, HOI4, Garry's Mod, DST, GTA V, tModLoader
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const U = require('../util');
const { parseLua, parseParadox, parseSII, parseIni } = require('../parsers/text');
const { peVersion, parseGMA, parseTMOD } = require('../parsers/binary');
const { wildcardMatch } = require('../parsers/versions');
const { Report, collect, sizeOf } = require('./common');

const okIfClean = (rep, msg) => { if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(msg); };

// =============== Project Zomboid ===============
function pzReadModInfo(file) {
  const t = U.readText(file, '');
  const o = {};
  for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*([^=#]+?)\s*=\s*(.*)$/); if (m) { const k = m[1].toLowerCase(); o[k] = o[k] ? o[k] + ',' + m[2].trim() : m[2].trim(); } }
  return o;
}
const pzList = s => String(s || '').split(/[,;]/).map(x => x.trim().replace(/^\\+/, '')).filter(Boolean);

function pzCollectMods(dirs) {
  // dirs: [{dir, source, workshopId?}] – każdy dir zawiera foldery modów
  const mods = [];
  for (const { dir, source, workshopId } of dirs) {
    for (const md of U.listDirs(dir)) {
      const b42 = U.exists(path.join(md, '42', 'mod.info')) || U.firstExisting(U.listDirs(md).filter(x => /^42(\.\d+)*$/.test(path.basename(x))).map(x => path.join(x, 'mod.info')));
      const b41 = U.exists(path.join(md, 'mod.info'));
      if (!b41 && !b42) continue;
      const infoFile = b41 ? path.join(md, 'mod.info') : (U.exists(path.join(md, '42', 'mod.info')) ? path.join(md, '42', 'mod.info') : b42);
      const info = pzReadModInfo(infoFile);
      mods.push({ dir: md, source, workshopId, b41, b42: !!b42, hasCommon: U.isDir(path.join(md, 'common')), info, id: info.id || path.basename(md) });
    }
  }
  return mods;
}

function pzWorkshopDirs(contentDirs, source = 'Warsztat') {
  const out = [];
  for (const c of contentDirs) for (const item of U.listDirs(c)) out.push({ dir: path.join(item, 'mods'), source, workshopId: path.basename(item) });
  return out;
}

function pzActiveIds(zomboidHome) {
  const t = U.readText(path.join(zomboidHome, 'mods', 'default.txt'), '');
  if (!t) return null;
  return [...t.matchAll(/mod\s*=\s*\\?([^,\r\n]+)/g)].map(m => m[1].trim().replace(/^\\+/, ''));
}

function pzBuild(gamePath, override) {
  if (override) return /^42/.test(override) ? 42 : 41;
  if (U.exists(path.join(gamePath, 'projectzomboid.jar'))) return 42;
  return 41;
}

function checkProjectZomboid(ctx) {
  const rep = new Report('Project Zomboid');
  const zhome = path.join(U.home(), 'Zomboid');
  const build = pzBuild(ctx.gamePath, ctx.settings.gameVersion);
  const mods = pzCollectMods([...pzWorkshopDirs(ctx.workshop), { dir: path.join(zhome, 'mods'), source: 'Lokalne (~/Zomboid/mods)' }, { dir: path.join(zhome, 'Workshop'), source: 'Lokalne (Workshop)' }].concat(U.listDirs(path.join(zhome, 'Workshop')).map(d => ({ dir: path.join(d, 'Contents', 'mods'), source: 'Twój mod' }))));
  const active = pzActiveIds(zhome);
  rep.meta = { 'Build gry': build === 42 ? 'Build 42' : 'Build 41', 'Mody znalezione': mods.length, 'Aktywne (default.txt)': active ? active.length : 'nieznane' };
  const byId = new Map();
  mods.forEach(m => byId.set(m.id.toLowerCase(), [...(byId.get(m.id.toLowerCase()) || []), m]));
  for (const m of mods) {
    const enabled = active ? active.some(a => a.toLowerCase() === m.id.toLowerCase()) : true;
    rep.addMod({ key: m.dir, file: m.dir, name: m.info.name || m.id, id: m.id, version: m.info.modversion || m.info.version || '-', enabled, source: m.source + (m.workshopId ? ` #${m.workshopId}` : ''), toggleable: false });
    if (!enabled) continue;
    if (build === 42 && !m.b42) rep.error(`${m.info.name || m.id} jest tylko dla Build 41`, { mod: m.dir, fix: 'Ten mod nie ma folderu 42/ – nie zadziała w Build 42.' });
    if (build === 41 && !m.b41 && m.b42) rep.error(`${m.info.name || m.id} jest tylko dla Build 42`, { mod: m.dir });
    if (m.b42 && !m.hasCommon) rep.warn(`${m.info.name || m.id}: brak folderu common/ (wymagany w Build 42)`, { mod: m.dir });
    const ver = build === 42 ? '42.0' : '41.78';
    if (m.info.versionmin && U.cmpVer(ver, m.info.versionmin) < 0) rep.warn(`${m.id} wymaga wersji gry ≥ ${m.info.versionmin}`, { mod: m.dir });
    if (m.info.versionmax && U.cmpVer(String(m.info.versionmax).replace(/\.x$/i, '.999'), ver) < 0) rep.warn(`${m.id} działa do wersji ${m.info.versionmax}`, { mod: m.dir });
    for (const r of pzList(m.info.require)) {
      const dep = byId.get(r.toLowerCase());
      if (!dep) rep.error(`${m.info.name || m.id} wymaga moda "${r}"`, { mod: m.dir, fix: 'Subskrybuj zależność w Warsztacie Steam.' });
      else if (active && !active.some(a => a.toLowerCase() === r.toLowerCase())) rep.error(`${m.info.name || m.id} wymaga "${r}" – zależność nie jest włączona`, { mod: m.dir, fix: 'Włącz zależność w menu Mody w grze (powyżej tego moda).' });
      else if (active) {
        const iDep = active.findIndex(a => a.toLowerCase() === r.toLowerCase()); const iMe = active.findIndex(a => a.toLowerCase() === m.id.toLowerCase());
        if (iDep > iMe) rep.warn(`${m.id} jest ładowany przed swoją zależnością ${r}`, { mod: m.dir, fix: 'Zmień kolejność ładowania.' });
      }
    }
    for (const r of pzList(m.info.incompatible)) {
      if (byId.has(r.toLowerCase()) && (!active || active.some(a => a.toLowerCase() === r.toLowerCase()))) rep.error(`${m.id} jest niezgodny z "${r}"`, { mod: m.dir, fix: 'Wyłącz jeden z nich.' });
    }
  }
  for (const [id, list] of byId) if (list.length > 1) rep.warn(`ID "${id}" występuje w ${list.length} miejscach`, { files: list.map(l => l.source + ': ' + l.dir), detail: 'Gra wczyta tylko jedną kopię – może to być stara wersja.' });
  if (active) for (const a of active) if (!byId.has(a.toLowerCase())) rep.error(`Włączony mod "${a}" nie jest zainstalowany`, { fix: 'Zasubskrybuj go ponownie lub wyłącz w menu Mody.' });
  okIfClean(rep, 'Zależności i wersje modów są w porządku');
  return rep.finish();
}

// =============== Euro Truck Simulator 2 ===============
function etsGameVersion(gamePath, override) {
  if (override) return override;
  const exe = U.firstExisting([path.join(gamePath, 'bin', 'win_x64', 'eurotrucks2.exe')]);
  const pv = exe && peVersion(exe);
  if (pv) return pv.product.split('.').slice(0, 3).join('.');
  for (const d of U.documentsCandidates()) {
    const log = U.readText(path.join(d, 'Euro Truck Simulator 2', 'game.log.txt'), '');
    const m = log.match(/ver\.\s*(\d+\.\d+\.\d+)/i); if (m) return m[1];
  }
  return null;
}
function etsReadPackage(p) {
  try {
    if (U.isDir(p)) {
      const vs = U.readText(path.join(p, 'versions.sii'));
      if (vs) { const units = parseSII(vs); return { versions: units.filter(u => u.type === 'package_version_info').map(u => ({ folder: u.props.package_name || u.name.replace(/^\./, ''), compat: u.props.compatible_versions || [] })), manifest: null }; }
      const man = U.readText(path.join(p, 'manifest.sii'));
      return { manifest: man ? (parseSII(man)[0] || {}).props : null };
    }
    const fd = fs.openSync(p, 'r'); const head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
    if (head.toString('latin1') === 'SCS#') return { hashfs: true };
    if (head[0] !== 0x50 || head[1] !== 0x4b) return { broken: true };
    const zip = new AdmZip(p);
    const e = zip.getEntry('manifest.sii');
    return { manifest: e ? (parseSII(e.getData().toString('utf8'))[0] || {}).props : null };
  } catch { return { broken: true }; }
}
function checkETS2(ctx) {
  const rep = new Report('Euro Truck Simulator 2');
  const gv = etsGameVersion(ctx.gamePath, ctx.settings.gameVersion);
  rep.meta = { 'Wersja gry': gv || 'nieznana' };
  if (!gv) rep.warn('Nie udało się ustalić wersji gry', { fix: 'Wpisz wersję gry w ustawieniach (np. 1.53.2).' });
  const items = [];
  for (const d of U.documentsCandidates()) {
    const modDir = path.join(d, 'Euro Truck Simulator 2', 'mod');
    for (const e of U.listDir(modDir)) {
      const full = path.join(modDir, e.name);
      if ((e.isFile() && /\.(scs|zip)(\.disabled)?$/i.test(e.name)) || e.isDirectory()) items.push({ path: full, name: e.name, source: 'Folder mod', enabled: !/\.disabled$/i.test(e.name), toggleable: e.isFile() });
    }
    rep.meta['Folder modów'] = modDir;
  }
  for (const w of ctx.workshop) for (const it of U.listDirs(w)) items.push({ path: it, name: path.basename(it), source: 'Warsztat #' + path.basename(it), enabled: true, toggleable: false });
  for (const it of items) {
    const info = etsReadPackage(it.path);
    const man = info.manifest || {};
    const name = man.display_name || it.name;
    rep.addMod({ key: it.path, file: it.path, name, version: man.package_version || '-', enabled: it.enabled, toggleable: it.toggleable, source: it.source, size: U.isFile(it.path) ? sizeOf(it.path) : undefined });
    if (!it.enabled) continue;
    if (info.broken) { rep.error(`${it.name}: uszkodzone archiwum`, { mod: it.path }); continue; }
    if (info.hashfs) { rep.note(`${it.name}: format HashFS – manifest nieczytelny, pominięto sprawdzanie wersji`, { mod: it.path }); continue; }
    let compat = man.compatible_versions || [];
    if (info.versions) {
      compat = info.versions.flatMap(v => v.compat);
      if (gv && !info.versions.some(v => v.compat.some(c => wildcardMatch(c, gv)))) rep.error(`${name}: brak wariantu dla wersji ${gv}`, { mod: it.path, detail: 'Obsługiwane: ' + compat.join(', '), fix: 'Poczekaj na aktualizację moda w Warsztacie.' });
      continue;
    }
    if (!info.manifest) { rep.note(`${name}: brak manifest.sii (stary format) – nie można sprawdzić wersji`, { mod: it.path }); continue; }
    if (gv && compat.length && !compat.some(c => wildcardMatch(c, gv))) rep.warn(`${name} jest oznaczony dla ${compat.join(', ')} (gra: ${gv})`, { mod: it.path, detail: 'Gra pokaże ostrzeżenie o niezgodności. Mod może działać, ale może też powodować błędy.' });
  }
  okIfClean(rep, 'Wszystkie mody są oznaczone jako zgodne');
  return rep.finish();
}

// =============== People Playground ===============
function checkPeoplePlayground(ctx) {
  const rep = new Report('People Playground');
  const dirs = [{ dir: path.join(ctx.gamePath, 'Mods'), source: 'Folder Mods' }, ...ctx.workshop.map(w => ({ dir: w, source: 'Warsztat' }))];
  const mods = [];
  for (const { dir, source } of dirs) for (const md of U.listDirs(dir)) { const j = U.readJSON(path.join(md, 'mod.json')); if (j) mods.push({ dir: md, j, source }); }
  const declared = mods.map(m => String(m.j.GameVersion || '')).filter(Boolean);
  const gv = ctx.settings.gameVersion || declared.sort((a, b) => U.cmpVer(b, a))[0] || null;
  rep.meta = { 'Wersja gry': gv ? gv + (ctx.settings.gameVersion ? '' : ' (najnowsza zadeklarowana przez mody)') : 'nieznana' };
  for (const m of mods) {
    const j = m.j;
    rep.addMod({ key: m.dir, file: m.dir, name: j.Name || path.basename(m.dir), version: j.ModVersion || '-', enabled: true, source: m.source, author: j.Author });
    if (gv && j.GameVersion && U.cmpVer(String(j.GameVersion), gv) < 0) {
      const major = (v) => String(v).split('.').slice(0, 2).join('.');
      (major(j.GameVersion) !== major(gv) ? rep.warn.bind(rep) : rep.note.bind(rep))(`${j.Name}: zbudowany dla wersji ${j.GameVersion} (gra ${gv})`, { mod: m.dir, detail: 'Starsze mody mogą odwoływać się do usuniętych elementów API.' });
    }
    for (const s of j.Scripts || []) if (!U.exists(path.join(m.dir, s))) rep.error(`${j.Name}: brak pliku skryptu ${s}`, { mod: m.dir });
    if (!j.EntryPoint && (j.Scripts || []).length) rep.error(`${j.Name}: brak EntryPoint w mod.json`, { mod: m.dir });
    if (j.ThumbnailPath && !U.exists(path.join(m.dir, j.ThumbnailPath))) rep.note(`${j.Name}: brak miniatury ${j.ThumbnailPath}`, { mod: m.dir });
  }
  const names = new Map(); mods.forEach(m => { const k = (m.j.Name || '').toLowerCase(); names.set(k, [...(names.get(k) || []), m.dir]); });
  for (const [n, l] of names) if (n && l.length > 1) rep.warn(`Mod "${n}" zainstalowany ${l.length}× (np. lokalnie i z Warsztatu)`, { files: l });
  okIfClean(rep, 'Mody wyglądają na zgodne');
  return rep.finish();
}

// =============== Transport Fever 2 ===============
function checkTransportFever(ctx) {
  const rep = new Report('Transport Fever 2');
  const sources = [{ dir: path.join(ctx.gamePath, 'mods'), source: 'Folder gry' }, ...ctx.workshop.map(w => ({ dir: w, source: 'Warsztat' })), ...(ctx.info.userdata || []).map(u => ({ dir: path.join(u, 'local', 'mods'), source: 'Userdata' }))];
  const mods = [];
  for (const { dir, source } of sources) for (const md of U.listDirs(dir)) {
    const lua = U.readText(path.join(md, 'mod.lua'));
    mods.push({ dir: md, source, lua });
  }
  const fileOwners = new Map();
  for (const m of mods) {
    const base = path.basename(m.dir);
    let info = {};
    if (m.lua) { try { const p = parseLua(m.lua); info = (p.functions.data && p.functions.data.info) || {}; } catch { /* */ } }
    const name = info.name || base;
    rep.addMod({ key: m.dir, file: m.dir, name: typeof name === 'string' ? name : base, version: info.minorVersion != null ? `${(base.match(/_(\d+)$/) || [])[1] || '?'}.${info.minorVersion}` : '-', enabled: true, source: m.source });
    if (!m.lua) { rep.error(`${base}: brak mod.lua`, { mod: m.dir }); continue; }
    if (m.source !== 'Warsztat' && !/_\d+$/.test(base)) rep.error(`${base}: nazwa folderu musi kończyć się numerem wersji (np. moj_mod_1)`, { mod: m.dir });
    if (info.minorVersion == null) rep.warn(`${base}: mod.lua nie zawiera info.minorVersion`, { mod: m.dir });
    if (info.severityRemove === 'CRITICAL') rep.note(`${name}: usunięcie moda z zapisu jest krytyczne (severityRemove = CRITICAL)`, { mod: m.dir });
    for (const req of [].concat(info.requiredMods || info.dependencies || [])) {
      const id = typeof req === 'string' ? req : (req && (req.modId || req.id));
      if (id && !mods.some(o => path.basename(o.dir) === id || path.basename(o.dir).replace(/_\d+$/, '') === String(id).replace(/_\d+$/, ''))) rep.error(`${name} wymaga moda ${id}`, { mod: m.dir });
    }
    for (const f of U.walk(path.join(m.dir, 'res'), { maxFiles: 5000 })) {
      if (/^(textures\/ui|scripts)\//i.test(f) || /(^|\/)strings\.lua$/i.test(f)) continue;
      const k = f.toLowerCase(); fileOwners.set(k, [...(fileOwners.get(k) || []), name]);
    }
  }
  const conflicts = [...fileOwners].filter(([, o]) => new Set(o).size > 1);
  const grouped = new Map();
  for (const [f, owners] of conflicts) { const key = [...new Set(owners)].sort().join(' ↔ '); grouped.set(key, [...(grouped.get(key) || []), f]); }
  for (const [pair, files] of grouped) rep.warn(`Mody nadpisują te same pliki: ${pair}`, { files: files.slice(0, 25), detail: `${files.length} wspólnych plików – wygrywa mod niżej na liście aktywnych.` });
  okIfClean(rep, 'Brak konfliktów plików');
  return rep.finish();
}

// =============== Paradox (HOI4) ===============
function paradoxVersion(gamePath, override) {
  if (override) return override;
  const ls = U.readJSON(path.join(gamePath, 'launcher-settings.json'));
  if (ls) { const m = String(ls.rawVersion || ls.version || '').match(/(\d+\.\d+\.\d+)/); if (m) return m[1]; }
  return null;
}
function checkParadox(ctx) {
  const rep = new Report(ctx.game.name);
  const gv = paradoxVersion(ctx.gamePath, ctx.settings.gameVersion);
  const docs = U.documentsCandidates().map(d => path.join(d, 'Paradox Interactive', ctx.game.paradoxFolder)).find(U.isDir);
  rep.meta = { 'Wersja gry': gv || 'nieznana', 'Folder użytkownika': docs || 'nie znaleziono' };
  if (!docs) { rep.warn('Nie znaleziono folderu Dokumenty/Paradox Interactive', { fix: 'Uruchom grę przynajmniej raz.' }); return rep.finish(); }
  const dlcLoad = U.readJSON(path.join(docs, 'dlc_load.json'), null);
  const enabledList = dlcLoad ? (dlcLoad.enabled_mods || []).map(s => s.replace(/\\/g, '/').toLowerCase()) : null;
  rep.meta['Aktywne mody'] = enabledList ? enabledList.length : 'nieznane (playset w launcherze)';
  const descriptors = [];
  for (const f of U.listFiles(path.join(docs, 'mod'), ['.mod'])) {
    const d = parseParadox(U.readText(f, ''));
    let mpath = d.path || d.archive || '';
    if (mpath && !path.isAbsolute(mpath)) mpath = path.join(docs, mpath);
    descriptors.push({ file: f, rel: 'mod/' + path.basename(f).toLowerCase(), d, mpath });
  }
  const byName = new Map(descriptors.map(x => [String(x.d.name || '').toLowerCase(), x]));
  const owners = new Map();
  for (const x of descriptors) {
    const enabled = enabledList ? enabledList.includes(x.rel) : true;
    rep.addMod({ key: x.file, file: x.file, name: x.d.name || path.basename(x.file), version: x.d.version || '-', enabled, source: x.d.remote_file_id ? 'Warsztat #' + x.d.remote_file_id : 'Lokalny' });
    if (!enabled) continue;
    if (!x.mpath || !U.exists(x.mpath)) { rep.error(`${x.d.name}: folder moda nie istnieje`, { mod: x.file, detail: x.mpath || '(brak path=)', fix: 'Zasubskrybuj ponownie lub popraw ścieżkę w deskryptorze.' }); continue; }
    if (gv && x.d.supported_version && !wildcardMatch(x.d.supported_version, gv)) {
      const sameMajor = String(x.d.supported_version).split('.').slice(0, 2).join('.') === gv.split('.').slice(0, 2).join('.');
      (sameMajor ? rep.note : rep.warn).call(rep, `${x.d.name}: obsługuje ${x.d.supported_version}, gra to ${gv}`, { mod: x.file, detail: 'Mody dla innej wersji głównej często psują zapis lub powodują crash.' });
    }
    const deps = [].concat(x.d.dependencies || []);
    for (const dep of deps) {
      const dd = byName.get(String(dep).toLowerCase());
      if (!dd) rep.error(`${x.d.name} wymaga "${dep}"`, { mod: x.file, fix: 'Zainstaluj i włącz brakujący mod.' });
      else if (enabledList && !enabledList.includes(dd.rel)) rep.error(`${x.d.name} wymaga "${dep}", który nie jest włączony`, { mod: x.file });
    }
    if (x.d.replace_path) rep.note(`${x.d.name} zastępuje całe foldery: ${[].concat(x.d.replace_path).join(', ')}`, { mod: x.file });
    if (U.isDir(x.mpath)) {
      for (const f of U.walk(x.mpath, { maxFiles: 30000 })) {
        if (/^(descriptor\.mod|thumbnail\.(png|jpg)|readme.*|changelog.*|\.git\/.*)$/i.test(f) || /^localisation\//i.test(f)) continue;
        const k = f.toLowerCase(); owners.set(k, [...(owners.get(k) || []), x.d.name]);
      }
    }
  }
  const grouped = new Map();
  for (const [f, o] of owners) { const u = [...new Set(o)]; if (u.length > 1) { const k = u.sort().join(' ↔ '); grouped.set(k, [...(grouped.get(k) || []), f]); } }
  for (const [pair, files] of grouped) {
    const critical = files.some(f => /^(common|history|events|map)\//.test(f));
    (critical ? rep.warn : rep.note).call(rep, `Konflikt plików: ${pair}`, { files: files.slice(0, 30), detail: `${files.length} plików nadpisywanych – wygrywa mod ładowany później. Mody często nie są projektowane do takiego łączenia.` });
  }
  okIfClean(rep, 'Brak problemów z modami');
  return rep.finish();
}

// =============== Garry's Mod ===============
function checkGarrysMod(ctx) {
  const rep = new Report("Garry's Mod");
  const addonsDir = path.join(ctx.gamePath, 'garrysmod', 'addons');
  const addons = [];
  for (const e of U.listDir(addonsDir)) {
    const full = path.join(addonsDir, e.name);
    if (e.isDirectory()) {
      const meta = U.readJSON(path.join(full, 'addon.json')) || {};
      const files = U.walk(full, { maxFiles: 20000 }).filter(f => !/^addon\.(json|txt)$/i.test(f)).map(f => f.toLowerCase());
      addons.push({ path: full, name: meta.title || e.name, files, source: 'Folder addons', enabled: true });
    } else if (/\.gma$/i.test(e.name)) addons.push({ path: full, gma: true, source: 'Folder addons' });
  }
  for (const w of ctx.workshop) for (const it of U.listDirs(w)) for (const f of U.listFiles(it)) {
    if (/\.gma$/i.test(f)) addons.push({ path: f, gma: true, source: 'Warsztat #' + path.basename(it) });
    else if (/\.bin$/i.test(f)) addons.push({ path: f, compressed: true, source: 'Warsztat #' + path.basename(it) });
  }
  rep.meta = { 'Folder addons': addonsDir, 'Addony': addons.length };
  const owners = new Map();
  for (const a of addons) {
    if (a.gma) {
      try { const g = parseGMA(a.path); if (g.error) { rep.addMod({ key: a.path, file: a.path, name: path.basename(a.path), version: '-', source: a.source }); rep.error(g.error, { mod: a.path }); continue; } a.name = g.name; a.files = g.files.map(f => f.name); }
      catch { rep.addMod({ key: a.path, file: a.path, name: path.basename(a.path), version: '-', source: a.source }); rep.error('Uszkodzony plik .gma', { mod: a.path }); continue; }
    }
    if (a.compressed) { rep.addMod({ key: a.path, file: a.path, name: path.basename(path.dirname(a.path)), version: '-', source: a.source }); rep.note('Addon w formacie skompresowanym (.bin) – pominięto analizę plików', { mod: a.path }); continue; }
    rep.addMod({ key: a.path, file: a.path, name: a.name, version: '-', source: a.source, size: a.gma ? sizeOf(a.path) : undefined });
    for (const f of a.files || []) {
      if (!/^(lua|materials|models|sound|maps|gamemodes|resource|particles|scripts)\//.test(f)) continue;
      if (/^lua\/autorun\/?$/.test(f)) continue;
      owners.set(f, [...(owners.get(f) || []), a.name]);
    }
  }
  const grouped = new Map();
  for (const [f, o] of owners) { const u = [...new Set(o)]; if (u.length > 1) { const k = u.sort().join(' ↔ '); grouped.set(k, [...(grouped.get(k) || []), f]); } }
  for (const [pair, files] of grouped) {
    const lua = files.filter(f => f.startsWith('lua/'));
    if (lua.length) rep.warn(`Konflikt skryptów Lua: ${pair}`, { files: lua.slice(0, 25), detail: `${lua.length} wspólnych plików Lua – wczytany zostanie tylko jeden, co zwykle psuje drugi addon.` });
    else rep.note(`Wspólne zasoby: ${pair}`, { files: files.slice(0, 15), detail: `${files.length} plików (modele/tekstury/dźwięki) – jeden addon nadpisze drugi.` });
  }
  okIfClean(rep, 'Brak konfliktów między addonami');
  return rep.finish();
}

// =============== Don't Starve Together ===============
function dstReadModinfo(dir) {
  const t = U.readText(path.join(dir, 'modinfo.lua'));
  if (t == null) return null;
  try { return parseLua(t).assigns; } catch { return { __error: true }; }
}
function checkDST(ctx) {
  const rep = new Report("Don't Starve Together");
  const dirs = [...U.listDirs(path.join(ctx.gamePath, 'mods')).map(d => ({ d, source: path.basename(d).startsWith('workshop-') ? 'Warsztat (stary)' : 'Lokalny' })), ...ctx.workshop.flatMap(w => U.listDirs(w).map(d => ({ d, source: 'Warsztat' })))];
  const mods = dirs.map(x => ({ ...x, info: dstReadModinfo(x.d) })).filter(x => x.info);
  const ids = new Set(mods.map(m => path.basename(m.d).replace(/^workshop-/, '')));
  rep.meta = { 'Mody': mods.length };
  for (const m of mods) {
    const i = m.info;
    const name = typeof i.name === 'string' ? i.name.replace(/\s+/g, ' ').trim() : path.basename(m.d);
    rep.addMod({ key: m.d, file: m.d, name, version: String(i.version || '-'), enabled: true, source: m.source, side: i.client_only_mod ? 'Klient' : i.all_clients_require_mod ? 'Serwer + klienci' : 'Serwer' });
    if (i.__error) { rep.error(`${name}: nie można odczytać modinfo.lua`, { mod: m.d }); continue; }
    if (i.dst_compatible !== true) rep.error(`${name} nie jest oznaczony jako zgodny z DST`, { mod: m.d, detail: 'Brak dst_compatible = true – to prawdopodobnie mod do Don\'t Starve (single player).' });
    if (i.api_version_dst != null ? i.api_version_dst !== 10 : (i.api_version != null && i.api_version !== 10)) rep.error(`${name}: przestarzałe API (api_version ${i.api_version_dst ?? i.api_version}, wymagane 10)`, { mod: m.d });
    if (!U.exists(path.join(m.d, 'modmain.lua')) && !U.exists(path.join(m.d, 'modworldgenmain.lua'))) rep.error(`${name}: brak modmain.lua`, { mod: m.d });
    if (i.client_only_mod && i.all_clients_require_mod) rep.warn(`${name}: sprzeczne flagi client_only_mod i all_clients_require_mod`, { mod: m.d });
    const deps = i.mod_dependencies;
    if (Array.isArray(deps)) for (const dep of deps) {
      const keys = dep && typeof dep === 'object' ? Object.entries(dep) : [];
      const wid = keys.map(([k, v]) => (k === 'workshop' ? String(v) : String(k))).find(Boolean);
      if (wid && !ids.has(wid.replace(/^workshop-/, ''))) rep.error(`${name} wymaga moda ${wid}`, { mod: m.d, fix: 'Zasubskrybuj zależność w Warsztacie.' });
    }
  }
  okIfClean(rep, 'Wszystkie mody są zgodne z DST');
  return rep.finish();
}

// =============== GTA V ===============
function checkGTA5(ctx) {
  const rep = new Report('Grand Theft Auto V');
  const g = ctx.gamePath;
  const enhanced = U.exists(path.join(g, 'GTA5_Enhanced.exe'));
  const exe = enhanced ? path.join(g, 'GTA5_Enhanced.exe') : path.join(g, 'GTA5.exe');
  const gv = U.exists(exe) ? peVersion(exe) : null;
  const shv = path.join(g, 'ScriptHookV.dll');
  const shvV = U.exists(shv) ? peVersion(shv) : null;
  const build = v => v ? +v.file.split('.')[2] : null;
  rep.meta = { 'Wydanie': enhanced ? 'Enhanced' : 'Legacy', 'Wersja gry': gv ? gv.file : 'nieznana', 'ScriptHookV': shvV ? shvV.file : 'brak' };
  rep.note('Mody skryptowe działają tylko w trybie fabularnym. Nie uruchamiaj GTA Online z modami – grozi to banem.');
  const asis = U.listFiles(g, ['.asi', '.asi.disabled']);
  const loader = ['dinput8.dll', 'xinput1_4.dll', 'version.dll'].find(f => U.exists(path.join(g, f)));
  for (const a of asis) rep.addMod({ key: a, file: a, name: path.basename(a).replace(/\.asi(\.disabled)?$/i, ''), version: (peVersion(a) || {}).file || '-', enabled: !/\.disabled$/i.test(a), toggleable: true, source: 'Plugin ASI', size: sizeOf(a) });
  const scriptsDir = path.join(g, 'scripts');
  for (const s of U.listFiles(scriptsDir).filter(f => /\.(dll|cs|vb)(\.disabled)?$/i.test(f))) rep.addMod({ key: s, file: s, name: path.basename(s), version: '-', enabled: !/\.disabled$/i.test(s), toggleable: true, source: 'scripts/ (SHVDN)' });
  if (U.exists(shv)) {
    if (gv && shvV && build(shvV) < build(gv)) rep.error(`ScriptHookV (${build(shvV)}) jest starszy niż gra (${build(gv)})`, { fix: 'Pobierz nowy ScriptHookV ze strony dev-c.com po aktualizacji gry. Do tego czasu skrypty nie zadziałają.' });
    else if (gv && shvV) rep.ok(`ScriptHookV obsługuje build ${build(shvV)}`);
    if (!loader) rep.error('Jest ScriptHookV, ale brak ASI Loadera (dinput8.dll)', { fix: 'Skopiuj dinput8.dll z paczki ScriptHookV.' });
  } else if (asis.some(a => !/openiv/i.test(a))) rep.error('Pluginy .asi wymagają ScriptHookV, którego nie znaleziono', { fix: 'Zainstaluj ScriptHookV (dev-c.com).' });
  if (asis.length && !loader) rep.error('Brak ASI Loadera – pliki .asi nie zostaną wczytane');
  const shvdnAsi = U.exists(path.join(g, 'ScriptHookVDotNet.asi'));
  if (U.isDir(scriptsDir) && U.listFiles(scriptsDir).some(f => /\.(dll|cs|vb)$/i.test(f)) && !shvdnAsi) rep.error('Folder scripts zawiera skrypty .NET, ale brak ScriptHookVDotNet', { fix: 'Zainstaluj ScriptHookVDotNet (v3).' });
  if (shvdnAsi && !U.exists(path.join(g, 'ScriptHookVDotNet3.dll')) && !U.exists(path.join(g, 'ScriptHookVDotNet2.dll'))) rep.error('Niekompletna instalacja ScriptHookVDotNet (brak ScriptHookVDotNet3.dll)');
  if (U.isDir(path.join(g, 'mods')) && !asis.some(a => /openiv/i.test(a))) rep.warn('Folder "mods" istnieje, ale brak OpenIV.asi – mody RPF nie zostaną wczytane', { fix: 'W OpenIV: Narzędzia → Menedżer ASI → zainstaluj OpenIV.asi.' });
  if (enhanced && asis.some(a => /openiv/i.test(a))) rep.warn('OpenIV.asi może nie wspierać wersji Enhanced – sprawdź wersję narzędzia.');
  okIfClean(rep, 'Konfiguracja modów GTA V wygląda poprawnie');
  return rep.finish();
}

// =============== tModLoader ===============
function tmlInstalledVersion(gamePath, override) {
  if (override) return override;
  const dll = path.join(gamePath, 'tModLoader.dll');
  const v = U.exists(dll) ? peVersion(dll) : null;
  return v ? v.file.split('.').slice(0, 3).join('.') : null;
}
function checkTModLoader(ctx) {
  const rep = new Report('tModLoader');
  const tml = tmlInstalledVersion(ctx.gamePath, ctx.settings.gameVersion);
  const docs = U.documentsCandidates().map(d => path.join(d, 'My Games', 'Terraria', 'tModLoader')).find(U.isDir);
  rep.meta = { 'tModLoader': tml || 'nieznany', 'Folder modów': docs ? path.join(docs, 'Mods') : 'nie znaleziono' };
  if (!U.exists(path.join(ctx.gamePath, 'tModLoader.dll'))) rep.warn('W wybranym folderze nie ma tModLoadera', { fix: 'Zainstaluj darmowy tModLoader ze Steama (zakładka Modloader) lub wskaż jego folder.' });
  const enabled = docs ? U.readJSON(path.join(docs, 'Mods', 'enabled.json'), null) : null;
  const items = [];
  if (docs) for (const f of U.listFiles(path.join(docs, 'Mods'), ['.tmod'])) items.push({ file: f, source: 'Lokalny' });
  for (const w of ctx.workshop) for (const it of U.listDirs(w)) {
    // foldery wersji np. 2024.5 – wybierz najnowszy nie nowszy niż tML
    const vers = U.listDirs(it).map(d => path.basename(d)).filter(v => /^\d{4}\.\d+/.test(v)).sort((a, b) => U.cmpVer(b, a));
    const pick = tml ? (vers.find(v => U.cmpVer(v, tml) <= 0) || vers[vers.length - 1]) : vers[0];
    const dir = pick ? path.join(it, pick) : it;
    for (const f of U.listFiles(dir, ['.tmod'])) items.push({ file: f, source: 'Warsztat #' + path.basename(it) });
  }
  const parsed = items.map(it => { try { return { ...it, m: parseTMOD(it.file) }; } catch { return { ...it, m: { error: 'Uszkodzony plik .tmod' } }; } });
  const names = new Map();
  parsed.forEach(p => { if (p.m && p.m.name) names.set(p.m.name, [...(names.get(p.m.name) || []), p]); });
  const isOn = n => enabled ? enabled.includes(n) : true;
  rep.meta['Włączone'] = enabled ? enabled.length : 'nieznane';
  for (const p of parsed) {
    const m = p.m;
    const name = m.displayName || m.name || path.basename(p.file);
    rep.addMod({ key: p.file, file: p.file, name, id: m.name, version: m.version || '-', enabled: m.name ? isOn(m.name) : false, source: p.source, size: sizeOf(p.file) });
    if (m.error) { rep.error(m.error, { mod: p.file }); continue; }
    if (!isOn(m.name)) continue;
    if (tml && m.tmlVersion) {
      const [y1, mo1] = tml.split('.').map(Number); const [y2, mo2] = m.tmlVersion.split('.').map(Number);
      if (U.cmpVer(m.tmlVersion, tml) > 0) rep.error(`${name} wymaga nowszego tModLoadera (${m.tmlVersion}, masz ${tml})`, { mod: p.file, fix: 'Zaktualizuj tModLoader w Steam.' });
      else if (y2 < 2022 || (y1 * 12 + mo1) - (y2 * 12 + mo2) > 12) rep.warn(`${name} zbudowany dla tModLoader ${m.tmlVersion} (masz ${tml})`, { mod: p.file, detail: 'Mod sprzed ponad roku może nie działać z obecną wersją.' });
    }
    for (const ref of m.modReferences || []) {
      const [rn, rv] = ref.split('@');
      const found = names.get(rn);
      if (!found) rep.error(`${name} wymaga moda ${rn}${rv ? ' ' + rv : ''}`, { mod: p.file, fix: 'Zasubskrybuj zależność w Warsztacie.' });
      else if (!isOn(rn)) rep.error(`${name} wymaga ${rn}, który jest wyłączony`, { mod: p.file });
      else if (rv && found.every(f => f.m.version && U.cmpVer(f.m.version, rv) < 0)) rep.warn(`${name} wymaga ${rn} ≥ ${rv}`, { mod: p.file });
    }
  }
  if (enabled) for (const e of enabled) if (!names.has(e)) rep.warn(`Włączony mod "${e}" nie jest zainstalowany`);
  for (const [n, l] of names) if (l.length > 1) rep.note(`Mod ${n} jest zarówno lokalnie, jak i w Warsztacie`, { files: l.map(x => x.source + ': ' + x.file), detail: 'tModLoader użyje wersji lokalnej.' });
  okIfClean(rep, 'Mody są zgodne z zainstalowanym tModLoaderem');
  return rep.finish();
}

module.exports = {
  checkProjectZomboid, checkETS2, checkPeoplePlayground, checkTransportFever, checkParadox, checkGarrysMod, checkDST, checkGTA5, checkTModLoader,
  pzCollectMods, pzWorkshopDirs, pzReadModInfo, pzList, dstReadModinfo, etsGameVersion,
};
