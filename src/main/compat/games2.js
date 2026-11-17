// Checkery: RimWorld, Stardew Valley (SMAPI), Factorio, Skyrim SE / Fallout 4, 7 Days to Die
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const U = require('../util');
const { peVersion } = require('../parsers/binary');
const { Report, sizeOf } = require('./common');

const clean = (rep, msg) => { if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(msg); };
const lowLow = () => path.join(U.home(), 'AppData', 'LocalLow');

// ---------- mini XML ----------
function xmlTag(xml, tag) { const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')); return m ? m[1].trim() : null; }
function xmlList(xml, tag) { const inner = xmlTag(xml, tag); return inner ? [...inner.matchAll(/<li>\s*([\s\S]*?)\s*<\/li>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean) : []; }
function xmlDeps(xml) {
  const inner = xmlTag(xml, 'modDependencies'); if (!inner) return [];
  return [...inner.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map(m => ({ id: (xmlTag(m[1], 'packageId') || '').toLowerCase(), name: xmlTag(m[1], 'displayName') || xmlTag(m[1], 'packageId') })).filter(d => d.id);
}
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

// =============== RimWorld ===============
function rimConfigPath() { return path.join(lowLow(), 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Config', 'ModsConfig.xml'); }
function rimReadMods(gamePath, workshop) {
  const mods = [];
  const scan = (dir, source) => {
    for (const d of U.listDirs(dir)) {
      const about = U.firstExisting([path.join(d, 'About', 'About.xml'), path.join(d, 'About', 'about.xml')]);
      if (!about) { if (source !== 'DLC') mods.push({ dir: d, source, broken: true, name: path.basename(d) }); continue; }
      const x = U.readText(about, '');
      const id = (xmlTag(x, 'packageId') || '').toLowerCase();
      mods.push({ dir: d, source, id, name: decode(xmlTag(x, 'name')) || path.basename(d), versions: xmlList(x, 'supportedVersions'), deps: xmlDeps(x), after: [...xmlList(x, 'loadAfter'), ...xmlList(x, 'forceLoadAfter')].map(s => s.toLowerCase()), before: [...xmlList(x, 'loadBefore'), ...xmlList(x, 'forceLoadBefore')].map(s => s.toLowerCase()), incompat: xmlList(x, 'incompatibleWith').map(s => s.toLowerCase()) });
    }
  };
  scan(path.join(gamePath, 'Data'), 'DLC');
  scan(path.join(gamePath, 'Mods'), 'Lokalny');
  for (const w of workshop) scan(w, 'Warsztat');
  return mods;
}
function rimActive() {
  const t = U.readText(rimConfigPath());
  if (!t) return null;
  return { version: (xmlTag(t, 'version') || '').trim(), active: xmlList(t, 'activeMods').map(s => s.toLowerCase()), raw: t };
}
function checkRimWorld(ctx) {
  const rep = new Report('RimWorld');
  const vt = U.readText(path.join(ctx.gamePath, 'Version.txt'), '') || '';
  const gv = ctx.settings.gameVersion || (vt.match(/(\d+\.\d+)/) || [])[1] || null;
  const mods = rimReadMods(ctx.gamePath, ctx.workshop);
  const cfg = rimActive();
  const active = cfg ? cfg.active : null;
  rep.meta = { 'Wersja gry': gv || 'nieznana', 'Mody': mods.filter(m => m.source !== 'DLC').length, 'Aktywne': active ? active.length : 'nieznane' };
  const byId = new Map(); mods.forEach(m => { if (m.id) byId.set(m.id, [...(byId.get(m.id) || []), m]); });
  const isOn = id => !active || active.includes(id) || active.includes(id + '_steam');
  const pos = id => active ? Math.max(active.indexOf(id), active.indexOf(id + '_steam')) : -1;
  for (const m of mods) {
    if (m.source === 'DLC') continue;
    const on = m.id ? isOn(m.id) : false;
    rep.addMod({ key: m.dir, file: m.dir, id: m.id, name: m.name, version: m.versions.join(', ') || '-', enabled: on, source: m.source, toggleable: !!(m.id && cfg), toggle: 'rimworld' });
    if (m.broken) { rep.error(`${m.name}: brak About/About.xml`, { mod: m.dir, fix: 'Folder nie jest prawidłowym modem RimWorld – mógł zostać źle rozpakowany.' }); continue; }
    if (!on) continue;
    if (gv && m.versions.length && !m.versions.includes(gv)) rep.error(`${m.name} nie wspiera RimWorld ${gv}`, { mod: m.dir, detail: 'Obsługiwane: ' + m.versions.join(', '), fix: 'Poszukaj aktualnej wersji moda lub zamiennika.' });
    for (const d of m.deps) {
      const dep = byId.get(d.id);
      if (!dep) rep.error(`${m.name} wymaga moda „${d.name}”`, { mod: m.dir, fix: 'Zasubskrybuj zależność w Warsztacie Steam.' });
      else if (!isOn(d.id)) rep.error(`${m.name} wymaga „${d.name}”, który nie jest włączony`, { mod: m.dir, fix: 'Włącz zależność i ustaw ją wyżej na liście.', action: { type: 'enable-key', toggle: 'rimworld', id: d.id, label: `Włącz ${d.name}` } });
      else if (active && pos(d.id) > pos(m.id)) rep.error(`${m.name} jest ładowany przed swoją zależnością „${d.name}”`, { mod: m.dir, fix: 'Przesuń zależność wyżej (lub użyj automatycznego sortowania w grze).' });
    }
    if (active) {
      for (const a of m.after) if (isOn(a) && pos(a) > pos(m.id)) rep.warn(`${m.name} powinien być ładowany po „${(byId.get(a) || [{ name: a }])[0].name}”`, { mod: m.dir });
      for (const b of m.before) if (isOn(b) && pos(b) >= 0 && pos(b) < pos(m.id)) rep.warn(`${m.name} powinien być ładowany przed „${(byId.get(b) || [{ name: b }])[0].name}”`, { mod: m.dir });
    }
    for (const i of m.incompat) if (byId.has(i) && isOn(i)) rep.error(`${m.name} jest niezgodny z „${byId.get(i)[0].name}”`, { mod: m.dir, fix: 'Wyłącz jeden z nich.' });
  }
  if (active) {
    const h = pos('brrainz.harmony'), core = pos('ludeon.rimworld');
    if (h > core && core >= 0) rep.warn('Harmony powinien być na samej górze listy (przed Core)', { fix: 'Przesuń Harmony na początek listy modów.' });
    for (const a of active) if (!a.startsWith('ludeon.') && !byId.has(a.replace(/_steam$/, ''))) rep.error(`Włączony mod „${a}” nie jest zainstalowany`, { fix: 'Zasubskrybuj go ponownie lub usuń z listy w grze.' });
  }
  for (const [id, l] of byId) if (l.length > 1 && !id.startsWith('ludeon.')) rep.warn(`Mod ${l[0].name} jest zainstalowany ${l.length}× (np. lokalnie i z Warsztatu)`, { files: l.map(x => x.dir) });
  clean(rep, 'Lista modów RimWorld wygląda poprawnie');
  return rep.finish();
}
function rimToggle(id, enable) {
  const f = rimConfigPath(); const t = U.readText(f);
  if (!t) throw new Error('Nie znaleziono ModsConfig.xml – uruchom grę raz.');
  const list = xmlList(t, 'activeMods');
  const lower = list.map(s => s.toLowerCase());
  let out = list;
  if (enable && !lower.includes(id)) out = [...list, id];
  if (!enable) out = list.filter(s => s.toLowerCase() !== id && s.toLowerCase() !== id + '_steam');
  const block = `<activeMods>\n${out.map(s => `    <li>${s}</li>`).join('\n')}\n  </activeMods>`;
  fs.copyFileSync(f, f + '.bak');
  fs.writeFileSync(f, t.replace(/<activeMods>[\s\S]*?<\/activeMods>/i, block));
}

// =============== Stardew Valley (SMAPI) ===============
function readManifests(dir, depth = 0, out = []) {
  if (depth > 3) return out;
  for (const d of U.listDirs(dir)) {
    const man = path.join(d, 'manifest.json');
    if (U.exists(man)) out.push({ dir: d, man: U.readJSON(man), disabled: path.basename(d).startsWith('.') || dir.split(path.sep).some(p => p.startsWith('.') && p.length > 1) });
    else readManifests(d, depth + 1, out);
  }
  return out;
}
function checkStardew(ctx) {
  const rep = new Report('Stardew Valley');
  const smapiDll = U.firstExisting([path.join(ctx.gamePath, 'StardewModdingAPI.dll'), path.join(ctx.gamePath, 'StardewModdingAPI.exe')]);
  const smapi = smapiDll ? ((peVersion(smapiDll) || {}).file || '').split('.').slice(0, 3).join('.') : null;
  const gameDll = U.firstExisting([path.join(ctx.gamePath, 'Stardew Valley.dll'), path.join(ctx.gamePath, 'Stardew Valley.exe')]);
  const gv = ctx.settings.gameVersion || (gameDll ? ((peVersion(gameDll) || {}).file || '').split('.').slice(0, 3).join('.') : null);
  rep.meta = { 'Wersja gry': gv || 'nieznana', 'SMAPI': smapi || 'brak' };
  if (!smapiDll) rep.error('SMAPI nie jest zainstalowany', { fix: 'Pobierz instalator SMAPI ze smapi.io – bez niego mody nie działają.', action: { type: 'open', url: 'https://smapi.io', label: 'Otwórz smapi.io' } });
  const list = readManifests(path.join(ctx.gamePath, 'Mods'));
  const byId = new Map(); list.forEach(x => { if (x.man && x.man.UniqueID) { const k = x.man.UniqueID.toLowerCase(); byId.set(k, [...(byId.get(k) || []), x]); } });
  const ver = v => String(v || '0').replace(/^(\d+)$/, '$1.0.0');
  for (const x of list) {
    const m = x.man || {};
    const nexus = (m.UpdateKeys || []).map(k => String(k).match(/^Nexus:(\d+)/i)).find(Boolean);
    rep.addMod({ key: x.dir, file: x.dir, id: m.UniqueID, name: m.Name || path.basename(x.dir), version: m.Version || '-', enabled: !x.disabled, toggleable: true, toggle: 'dotfolder', source: m.ContentPackFor ? 'Pakiet zawartości' : 'Mod SMAPI', author: m.Author, nexusId: nexus ? +nexus[1] : null });
    if (x.disabled) continue;
    if (!x.man) { rep.error(`${path.basename(x.dir)}: uszkodzony manifest.json`, { mod: x.dir }); continue; }
    if (!m.UniqueID) { rep.error(`${m.Name}: brak UniqueID w manifeście`, { mod: x.dir }); continue; }
    if (smapi && m.MinimumApiVersion && U.cmpVer(ver(m.MinimumApiVersion), smapi) > 0) rep.error(`${m.Name} wymaga SMAPI ${m.MinimumApiVersion} (masz ${smapi})`, { mod: x.dir, fix: 'Zaktualizuj SMAPI (smapi.io).' });
    if (gv && m.MinimumGameVersion && U.cmpVer(ver(m.MinimumGameVersion), gv) > 0) rep.error(`${m.Name} wymaga gry w wersji ${m.MinimumGameVersion}`, { mod: x.dir });
    if (m.EntryDll && !U.exists(path.join(x.dir, m.EntryDll))) rep.error(`${m.Name}: brak pliku ${m.EntryDll}`, { mod: x.dir, fix: 'Mod jest niekompletny – zainstaluj go ponownie.' });
    const req = [...(m.Dependencies || [])];
    if (m.ContentPackFor) req.push({ UniqueID: m.ContentPackFor.UniqueID, MinimumVersion: m.ContentPackFor.MinimumVersion, IsRequired: true, cp: true });
    for (const d of req) {
      if (!d || !d.UniqueID) continue;
      const found = (byId.get(d.UniqueID.toLowerCase()) || []).filter(f => !f.disabled);
      if (!found.length) { if (d.IsRequired !== false) rep.error(`${m.Name} ${d.cp ? 'jest pakietem dla' : 'wymaga'} moda ${d.UniqueID}`, { mod: x.dir, fix: 'Zainstaluj brakujący mod (np. z Nexus Mods).' }); else rep.note(`${m.Name} może korzystać z ${d.UniqueID} (opcjonalnie)`, { mod: x.dir }); }
      else if (d.MinimumVersion && U.cmpVer(found[0].man.Version, ver(d.MinimumVersion)) < 0) rep.error(`${m.Name} wymaga ${found[0].man.Name} ≥ ${d.MinimumVersion} (masz ${found[0].man.Version})`, { mod: x.dir });
    }
  }
  for (const [id, l] of byId) { const on = l.filter(x => !x.disabled); if (on.length > 1) rep.error(`Mod ${on[0].man.Name} jest zainstalowany ${on.length}×`, { files: on.map(x => x.dir), fix: 'SMAPI nie uruchomi żadnej kopii – usuń duplikat.' }); }
  clean(rep, 'Mody SMAPI są zgodne');
  return rep.finish();
}

// =============== Factorio ===============
function factorioUserDir(gamePath) {
  const portable = path.join(gamePath, 'mods');
  if (U.isDir(portable) && U.exists(path.join(gamePath, 'config-path.cfg')) && /use-system-read-write-data-directories=false/.test(U.readText(path.join(gamePath, 'config-path.cfg'), ''))) return gamePath;
  return U.isWin ? path.join(U.appData(), 'Factorio') : U.isMac ? path.join(U.home(), 'Library', 'Application Support', 'factorio') : path.join(U.home(), '.factorio');
}
function factorioReadMods(modsDir) {
  const out = [];
  for (const e of U.listDir(modsDir)) {
    const full = path.join(modsDir, e.name);
    let info = null;
    try {
      if (e.isFile() && /\.zip$/i.test(e.name)) { const z = new AdmZip(full); const ent = z.getEntries().find(x => /^[^/]+\/info\.json$/.test(x.entryName)); if (ent) info = JSON.parse(ent.getData().toString('utf8')); }
      else if (e.isDirectory()) info = U.readJSON(path.join(full, 'info.json'));
    } catch { info = null; }
    if (e.name === 'mod-list.json' || e.name === 'mod-settings.dat') continue;
    if (info || /\.zip$/i.test(e.name) || e.isDirectory()) out.push({ file: full, info });
  }
  return out;
}
const BUILTIN = new Set(['base', 'core', 'space-age', 'quality', 'elevated-rails']);
function parseFDep(s) {
  const m = String(s).trim().match(/^(\(\?\)|\?|!|~)?\s*([^<>=]+?)\s*(?:(<=|>=|<|>|=)\s*([\d.]+))?$/);
  if (!m) return null;
  return { kind: m[1] === '!' ? 'incompat' : (m[1] === '?' || m[1] === '(?)') ? 'optional' : 'required', name: m[2].trim(), op: m[3], ver: m[4] };
}
function verOk(have, op, need) { if (!op) return true; const c = U.cmpVer(have, need); return { '>=': c >= 0, '>': c > 0, '<=': c <= 0, '<': c < 0, '=': c === 0 }[op]; }
function checkFactorio(ctx) {
  const rep = new Report('Factorio');
  const gi = U.readJSON(path.join(ctx.gamePath, 'data', 'base', 'info.json'));
  const gv = ctx.settings.gameVersion || (gi && gi.version) || null;
  const gMinor = gv ? gv.split('.').slice(0, 2).join('.') : null;
  const ud = factorioUserDir(ctx.gamePath);
  const modsDir = path.join(ud, 'mods');
  const ml = U.readJSON(path.join(modsDir, 'mod-list.json'), { mods: [] });
  const enabled = new Map((ml.mods || []).map(m => [m.name, m.enabled !== false]));
  rep.meta = { 'Wersja gry': gv || 'nieznana', 'Folder modów': modsDir };
  const mods = factorioReadMods(modsDir);
  const byName = new Map(); mods.forEach(m => { if (m.info) byName.set(m.info.name, [...(byName.get(m.info.name) || []), m]); });
  const isOn = n => BUILTIN.has(n) ? (n === 'base' || n === 'core' || enabled.get(n) !== false) : enabled.get(n) === true;
  const versionOf = n => { if (n === 'base' || n === 'core') return gv; const l = byName.get(n); return l ? l.map(x => x.info.version).sort(U.cmpVer).pop() : null; };
  for (const m of mods) {
    const i = m.info;
    if (!i) { rep.addMod({ key: m.file, file: m.file, name: path.basename(m.file), version: '-', enabled: false }); rep.error(`${path.basename(m.file)}: brak lub uszkodzony info.json`, { mod: m.file }); continue; }
    const on = isOn(i.name) && versionOf(i.name) === i.version;
    rep.addMod({ key: m.file, file: m.file, id: i.name, name: i.title || i.name, version: i.version, enabled: on, toggleable: true, toggle: 'factorio', size: U.isFile(m.file) ? sizeOf(m.file) : undefined });
    if (!on) continue;
    if (gMinor && i.factorio_version && i.factorio_version !== gMinor) rep.error(`${i.title || i.name} jest dla Factorio ${i.factorio_version} (masz ${gMinor})`, { mod: m.file, fix: 'Zaktualizuj mod przez menu Mody w grze lub przyciskiem „Aktualizuj wszystko”.' });
    for (const ds of i.dependencies || ['base']) {
      const d = parseFDep(ds); if (!d) continue;
      if (d.kind === 'optional') { if (byName.has(d.name) && isOn(d.name) && !verOk(versionOf(d.name), d.op, d.ver)) rep.warn(`${i.name}: opcjonalna zależność ${d.name} ma złą wersję (wymagane ${d.op} ${d.ver})`, { mod: m.file }); continue; }
      const present = BUILTIN.has(d.name) ? (d.name === 'base' || d.name === 'core' || U.isDir(path.join(ctx.gamePath, 'data', d.name))) : byName.has(d.name);
      if (d.kind === 'incompat') { if (present && isOn(d.name)) rep.error(`${i.title || i.name} jest niezgodny z ${d.name}`, { mod: m.file, fix: 'Wyłącz jeden z modów.' }); continue; }
      if (!present) rep.error(`${i.title || i.name} wymaga moda ${d.name}${d.op ? ` ${d.op} ${d.ver}` : ''}`, { mod: m.file, fix: BUILTIN.has(d.name) ? `To dodatek ${d.name} – wymaga zakupu DLC.` : 'Pobierz zależność w menu Mody w grze.' });
      else if (!isOn(d.name)) rep.error(`${i.title || i.name} wymaga ${d.name}, który jest wyłączony`, { mod: m.file, action: BUILTIN.has(d.name) ? null : { type: 'enable-key', toggle: 'factorio', id: d.name, label: `Włącz ${d.name}` } });
      else if (!verOk(versionOf(d.name), d.op, d.ver)) rep.error(`${i.title || i.name} wymaga ${d.name} ${d.op} ${d.ver} (masz ${versionOf(d.name)})`, { mod: m.file });
    }
  }
  for (const [n, l] of byName) if (l.length > 1) rep.note(`Mod ${n} ma ${l.length} wersje w folderze – Factorio użyje najnowszej`, { files: l.map(x => path.basename(x.file)) });
  clean(rep, 'Mody Factorio są zgodne');
  return rep.finish();
}
function factorioToggle(gamePath, name, enable) {
  const f = path.join(factorioUserDir(gamePath), 'mods', 'mod-list.json');
  const j = U.readJSON(f, { mods: [{ name: 'base', enabled: true }] });
  const e = j.mods.find(m => m.name === name);
  if (e) e.enabled = enable; else j.mods.push({ name, enabled: enable });
  U.writeJSON(f, j);
}
async function factorioUpdates(gamePath, gv, { download, log, progress } = {}) {
  const ud = factorioUserDir(gamePath);
  const pd = U.readJSON(path.join(ud, 'player-data.json'), {});
  const mods = factorioReadMods(path.join(ud, 'mods')).filter(m => m.info);
  const minor = gv ? gv.split('.').slice(0, 2).join('.') : null;
  const out = [];
  for (const m of mods) {
    try {
      const r = await fetch(`https://mods.factorio.com/api/mods/${encodeURIComponent(m.info.name)}`, { headers: { 'User-Agent': 'CodeManager/1.1' } });
      if (!r.ok) { out.push({ level: 'info', title: `${m.info.name}: brak w portalu modów` }); continue; }
      const j = await r.json();
      const rel = (j.releases || []).filter(x => !minor || x.info_json.factorio_version === minor).sort((a, b) => U.cmpVer(a.version, b.version)).pop();
      if (rel && U.cmpVer(rel.version, m.info.version) > 0) {
        if (download && pd['service-username'] && pd['service-token']) {
          log && log(`Aktualizacja ${m.info.name} → ${rel.version}`);
          const dest = path.join(ud, 'mods', rel.file_name);
          await require('../net').download(`https://mods.factorio.com${rel.download_url}?username=${encodeURIComponent(pd['service-username'])}&token=${encodeURIComponent(pd['service-token'])}`, dest, progress);
          if (U.isFile(m.file) && m.file !== dest) fs.rmSync(m.file);
          out.push({ level: 'ok', title: `${m.info.name}: zaktualizowano do ${rel.version}` });
        } else out.push({ level: 'info', title: `${m.info.name}: dostępna wersja ${rel.version} (masz ${m.info.version})`, url: `https://mods.factorio.com/mod/${m.info.name}` });
      }
    } catch (e) { out.push({ level: 'info', title: 'Portal modów Factorio niedostępny: ' + e.message }); break; }
  }
  if (download && !(pd['service-username'] && pd['service-token'])) out.unshift({ level: 'warn', title: 'Aby pobierać aktualizacje, zaloguj się w grze do konta Factorio (dane logowania zapisuje player-data.json).' });
  if (!out.length) out.push({ level: 'ok', title: 'Wszystkie mody są aktualne' });
  return out;
}

// =============== Skyrim SE / Fallout 4 ===============
const BETHESDA = {
  skyrimse: { exe: 'SkyrimSE.exe', local: 'Skyrim Special Edition', se: 'skse64', base: ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'], addr: 'Data/SKSE/Plugins', addrRe: /^versionlib-|^version-/i },
  fallout4: { exe: 'Fallout4.exe', local: 'Fallout4', se: 'f4se', base: ['fallout4.esm', 'dlcrobot.esm', 'dlcworkshop01.esm', 'dlccoast.esm', 'dlcworkshop02.esm', 'dlcworkshop03.esm', 'dlcnukaworld.esm', 'dlcultrahighresolution.esm'], addr: 'Data/F4SE/Plugins', addrRe: /^version-/i },
};
function readPluginHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(24); fs.readSync(fd, head, 0, 24, 0);
    if (head.toString('latin1', 0, 4) !== 'TES4') return { error: 'Nieprawidłowy nagłówek pliku' };
    const size = head.readUInt32LE(4); const flags = head.readUInt32LE(8);
    const data = Buffer.alloc(Math.min(size, 1024 * 1024)); fs.readSync(fd, data, 0, data.length, 24);
    const masters = []; let o = 0; let author = null, desc = null;
    while (o + 6 <= data.length) {
      const t = data.toString('latin1', o, o + 4); const sz = data.readUInt16LE(o + 4);
      const val = data.subarray(o + 6, o + 6 + sz);
      if (t === 'MAST') masters.push(val.toString('latin1').replace(/\0+$/, ''));
      if (t === 'CNAM') author = val.toString('latin1').replace(/\0+$/, '');
      if (t === 'SNAM') desc = val.toString('latin1').replace(/\0+$/, '');
      o += 6 + sz;
    }
    return { masters, master: !!(flags & 0x1), light: !!(flags & 0x200), author, desc };
  } finally { fs.closeSync(fd); }
}
function pluginsTxt(gameId) { return path.join(U.localAppData(), BETHESDA[gameId].local, 'plugins.txt'); }
function readLoadOrder(gameId) {
  const t = U.readText(pluginsTxt(gameId));
  if (t == null) return null;
  return t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => ({ name: l.replace(/^\*/, ''), active: l.startsWith('*') }));
}
function checkBethesda(ctx) {
  const id = ctx.game.id; const B = BETHESDA[id];
  const rep = new Report(ctx.game.name);
  const exe = path.join(ctx.gamePath, B.exe);
  const gv = U.exists(exe) ? (peVersion(exe) || {}).file : null;
  const seDll = U.listFiles(ctx.gamePath).map(f => path.basename(f)).find(f => new RegExp(`^${B.se}_(\\d+)_(\\d+)_(\\d+)\\.dll$`, 'i').test(f));
  const seVer = seDll ? seDll.match(/_(\d+)_(\d+)_(\d+)\.dll$/i).slice(1).join('.') : null;
  rep.meta = { 'Wersja gry': gv || 'nieznana', [B.se.toUpperCase()]: seVer ? `dla ${seVer}` : 'brak' };
  if (gv && seVer && !gv.startsWith(seVer + '.')) rep.error(`${B.se.toUpperCase()} jest dla wersji ${seVer}, a gra to ${gv}`, { fix: `Pobierz ${B.se.toUpperCase()} dla Twojej wersji gry. Do tego czasu mody wymagające ${B.se.toUpperCase()} nie zadziałają.`, action: { type: 'loader', id: id === 'skyrimse' ? 'skse' : 'f4se', label: `Zainstaluj właściwy ${B.se.toUpperCase()}` } });
  const sePlugins = U.listFiles(path.join(ctx.gamePath, ...B.addr.split('/')), ['.dll']);
  const seLoader = id === 'skyrimse' ? 'skse' : 'f4se';
  if (sePlugins.length && !seVer) rep.error(`Masz wtyczki ${B.se.toUpperCase()}, ale nie zainstalowano ${B.se.toUpperCase()}`, { fix: `Zainstaluj ${B.se.toUpperCase()} i uruchamiaj grę przez ${B.se}_loader.exe.`, action: { type: 'loader', id: seLoader, label: `Zainstaluj ${B.se.toUpperCase()}` } });
  if (sePlugins.length && !U.listFiles(path.join(ctx.gamePath, ...B.addr.split('/'))).some(f => B.addrRe.test(path.basename(f)))) rep.warn('Brak Address Library – wiele wtyczek DLL bez niej się nie uruchomi', { fix: 'Zainstaluj „Address Library for SKSE/F4SE Plugins” z Nexus Mods (wersja „All in one”).' });
  const dataDir = path.join(ctx.gamePath, 'Data');
  const files = U.listFiles(dataDir).filter(f => /\.(esp|esm|esl)$/i.test(f));
  const lo = readLoadOrder(id);
  const present = new Map(files.map(f => [path.basename(f).toLowerCase(), f]));
  const order = []; // kolejność ładowania: bazowe + plugins.txt
  B.base.forEach(b => { if (present.has(b)) order.push({ name: b, active: true, base: true }); });
  if (lo) lo.forEach(e => { if (!B.base.includes(e.name.toLowerCase())) order.push({ name: e.name.toLowerCase(), active: e.active, display: e.name }); });
  files.forEach(f => { const n = path.basename(f).toLowerCase(); if (/^cc\w+\.es[lm]$/.test(n) && !order.find(o => o.name === n)) order.splice(B.base.length, 0, { name: n, active: true, base: true }); });
  const idx = n => order.findIndex(o => o.name === n);
  rep.meta['Pluginy'] = files.length;
  let full = 0, light = 0;
  for (const f of files) {
    const n = path.basename(f).toLowerCase();
    const o = order.find(x => x.name === n);
    const active = o ? o.active : false;
    const h = readPluginHeader(f);
    rep.addMod({ key: f, file: f, id: n, name: path.basename(f), version: h.light ? 'ESL' : h.master ? 'ESM' : 'ESP', enabled: active, toggleable: !(o && o.base) && !!lo, toggle: 'plugins-txt', source: o && o.base ? 'Gra / Creation Club' : 'Mod', author: h.author });
    if (h.error) { rep.error(`${path.basename(f)}: ${h.error}`, { mod: f }); continue; }
    if (!active) continue;
    if (h.light || /\.esl$/i.test(n)) light++; else full++;
    for (const m of h.masters) {
      const ml = m.toLowerCase();
      if (!present.has(ml)) rep.error(`${path.basename(f)} wymaga pliku ${m}, którego nie masz`, { mod: f, fix: `Zainstaluj mod zawierający ${m} – bez niego gra wyłączy się przy starcie.` });
      else if (idx(ml) >= 0 && !order[idx(ml)].active) rep.error(`${path.basename(f)} wymaga ${m}, który jest wyłączony`, { mod: f, action: { type: 'enable-key', toggle: 'plugins-txt', id: ml, label: `Włącz ${m}` } });
      else if (idx(ml) > idx(n)) rep.error(`${path.basename(f)} jest ładowany przed swoim masterem ${m}`, { mod: f, fix: 'Zmień kolejność (np. narzędziem LOOT) – master musi być wyżej.' });
    }
  }
  if (lo) for (const e of lo) if (e.active && !present.has(e.name.toLowerCase())) rep.warn(`plugins.txt zawiera ${e.name}, którego nie ma w Data`, { fix: 'Usuń wpis lub zainstaluj mod ponownie.' });
  if (!lo) rep.note('Nie znaleziono plugins.txt – uruchom grę lub launcher raz, aby powstał.');
  if (full > 254) rep.error(`Za dużo pełnych pluginów (${full}/254)`, { fix: 'Połącz pluginy (ESL-ify, Merge Plugins) lub wyłącz część modów.' });
  if (light > 4096) rep.error(`Za dużo pluginów ESL (${light}/4096)`);
  rep.meta['Aktywne pełne / ESL'] = `${full} / ${light}`;
  clean(rep, 'Mastery i kolejność ładowania są poprawne');
  return rep.finish();
}
function pluginsTxtToggle(gameId, name, enable) {
  const f = pluginsTxt(gameId);
  const t = U.readText(f, '');
  const lines = t.split(/\r?\n/);
  let found = false;
  const out = lines.map(l => { const n = l.trim().replace(/^\*/, ''); if (n.toLowerCase() === name.toLowerCase()) { found = true; return (enable ? '*' : '') + n; } return l; });
  if (!found && enable) out.push('*' + name);
  fs.copyFileSync(f, f + '.bak');
  fs.writeFileSync(f, out.join('\r\n'));
}

// =============== 7 Days to Die ===============
function checkSevenDays(ctx) {
  const rep = new Report('7 Days to Die');
  const dirs = [{ dir: path.join(ctx.gamePath, 'Mods'), source: 'Folder gry' }, { dir: path.join(U.appData(), '7DaysToDie', 'Mods'), source: 'AppData' }];
  const names = new Map();
  let dll = 0;
  for (const { dir, source } of dirs) for (const d of U.listDirs(dir)) {
    const info = U.readText(path.join(d, 'ModInfo.xml'));
    const nested = !info && U.listDirs(d).find(x => U.exists(path.join(x, 'ModInfo.xml')));
    const name = info ? ((info.match(/<Name\s+value="([^"]+)"/i) || [])[1] || path.basename(d)) : path.basename(d);
    const disp = info ? ((info.match(/<DisplayName\s+value="([^"]+)"/i) || [])[1] || name) : name;
    const ver = info ? ((info.match(/<Version\s+value="([^"]+)"/i) || [])[1] || '-') : '-';
    rep.addMod({ key: d, file: d, name: disp, id: name, version: ver, enabled: !path.basename(d).startsWith('_'), source });
    if (nested) { rep.error(`${path.basename(d)}: ModInfo.xml jest o jeden folder za głęboko`, { mod: d, fix: `Przenieś zawartość folderu ${path.basename(nested)} bezpośrednio do Mods/${path.basename(d)}.` }); continue; }
    if (!info) { rep.error(`${path.basename(d)}: brak ModInfo.xml`, { mod: d, fix: 'To nie jest prawidłowy mod 7DTD albo został źle rozpakowany.' }); continue; }
    if (!/<Version\s+value/i.test(info) && /<ModInfo>/i.test(info)) rep.warn(`${disp}: stary format ModInfo (sprzed wersji 1.0)`, { mod: d, detail: 'Mod może być przeznaczony dla starszej wersji gry (Alpha).' });
    names.set(name.toLowerCase(), [...(names.get(name.toLowerCase()) || []), d]);
    if (U.walk(d, { filter: r => /\.dll$/i.test(r), maxDepth: 2 }).length) { dll++; rep.note(`${disp} zawiera kod (DLL)`, { mod: d }); }
  }
  if (dll) rep.warn(`${dll} mod(ów) zawiera kod DLL – wymagają uruchomienia gry bez EasyAntiCheat`, { fix: 'Uruchom grę przez launcher 7DTD z odznaczoną opcją „Use EAC”.' });
  for (const [n, l] of names) if (l.length > 1) rep.error(`Mod ${n} jest zainstalowany ${l.length}×`, { files: l });
  clean(rep, 'Struktura modów jest poprawna');
  return rep.finish();
}

module.exports = { checkRimWorld, rimToggle, checkStardew, checkFactorio, factorioToggle, factorioUpdates, checkBethesda, pluginsTxtToggle, checkSevenDays, readPluginHeader, parseFDep, BETHESDA, readManifests, factorioUserDir, pluginsTxt, readLoadOrder, rimReadMods, rimActive, rimConfigPath, xmlList };
