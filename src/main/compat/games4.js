// Checkery dodane w 1.7.0: Left 4 Dead 1/2 (VPK), Farming Simulator 17–25, BeamNG.drive,
// GTA San Andreas, GTA IV, Hollow Knight, Assetto Corsa
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const U = require('../util');
const { peVersion, fileContains } = require('../parsers/binary');
const { parseVDF } = require('../parsers/text');
const { Report, sizeOf } = require('./common');

const clean = (rep, msg) => { if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(msg); };
const docs = () => (U.documentsCandidates().length ? U.documentsCandidates() : [U.documents()]);
const disabled = n => /\.disabled$/i.test(n);
const strip = n => n.replace(/\.disabled$/i, '');

// =============== VPK (Source) ===============
const vpkMemo = new Map();
// spis plików archiwum VPK v1/v2 bez wczytywania całego pliku
function readVpk(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const key = file + ':' + st.size + ':' + st.mtimeMs;
  if (vpkMemo.has(key)) return vpkMemo.get(key);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(28); fs.readSync(fd, head, 0, 28, 0);
    if (head.readUInt32LE(0) !== 0x55aa1234) throw new Error('to nie jest archiwum VPK');
    const ver = head.readUInt32LE(4); const treeSize = head.readUInt32LE(8);
    const hdr = ver === 2 ? 28 : ver === 1 ? 12 : 0;
    if (!hdr) throw new Error('nieobsługiwana wersja VPK ' + ver);
    if (treeSize > 64 * 1024 * 1024 || hdr + treeSize > st.size) throw new Error('uszkodzony nagłówek');
    const tree = Buffer.alloc(treeSize); fs.readSync(fd, tree, 0, treeSize, hdr);
    let o = 0;
    const str = () => { const e = tree.indexOf(0, o); if (e < 0) throw new Error('uszkodzony spis plików'); const s = tree.toString('latin1', o, e); o = e + 1; return s; };
    const files = new Map();
    for (;;) {
      const ext = str(); if (!ext) break;
      for (;;) {
        const dir = str(); if (!dir) break;
        for (;;) {
          const name = str(); if (!name) break;
          const preload = tree.readUInt16LE(o + 4); const arch = tree.readUInt16LE(o + 6); const off = tree.readUInt32LE(o + 8); const len = tree.readUInt32LE(o + 12);
          o += 18; const pre = tree.subarray(o, o + preload); o += preload;
          const full = ((dir.trim() ? dir.trim() + '/' : '') + name + (ext.trim() ? '.' + ext : '')).toLowerCase();
          files.set(full, { arch, off, len, pre });
        }
      }
    }
    const res = { files: [...files.keys()], entry: files, dataStart: hdr + treeSize };
    vpkMemo.set(key, res); return res;
  } catch (e) { const r = { error: e.message, files: [] }; vpkMemo.set(key, r); return r; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ } }
}
function vpkRead(file, vpk, name) {
  const e = vpk && vpk.entry && vpk.entry.get(name); if (!e) return null;
  if (e.arch !== 0x7fff) return e.pre.length ? Buffer.from(e.pre) : null; // dane w osobnym pliku _NNN.vpk
  if (e.len > 4 * 1024 * 1024) return null;
  const buf = Buffer.alloc(e.len); const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, e.len, vpk.dataStart + e.off); } finally { fs.closeSync(fd); }
  return Buffer.concat([e.pre, buf]);
}
// addoninfo.txt: KeyValues z tytułem i wersją dodatku
function addonInfo(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/^\s*"?(addon\w+)"?\s+"([^"]*)"/gim)) out[m[1].toLowerCase()] = m[2];
  return out;
}
const VPK_IGNORE = /^(addoninfo\.txt|addonimage\.(jpg|vtf)|addonimage|missions\/.*\.txt)$/i;

function checkVpk(ctx) {
  const g = ctx.game; const gdir = g.sourceDir; // left4dead2 / left4dead
  const rep = new Report(g.name);
  const addons = path.join(ctx.gamePath, gdir, 'addons');
  const listFile = path.join(ctx.gamePath, gdir, 'addonlist.txt');
  let list = {};
  try { const v = parseVDF(U.readText(listFile, '')); list = Object.fromEntries(Object.entries(v.AddonList || v.addonlist || {}).map(([k, x]) => [k.replace(/\\/g, '/').toLowerCase(), String(x) === '1'])); } catch { list = {}; }
  const items = [];
  for (const [dir, src] of [[addons, 'addons'], [path.join(addons, 'workshop'), 'Warsztat']]) {
    for (const f of U.listFiles(dir)) {
      const b = path.basename(f);
      if (!/\.vpk(\.disabled)?$/i.test(b)) continue;
      const rel = (src === 'Warsztat' ? 'workshop/' : '') + strip(b).toLowerCase();
      const enabled = !disabled(b) && (list[rel] !== undefined ? list[rel] : true);
      items.push({ file: f, rel, src, enabled, byList: list[rel] !== undefined && !disabled(b) });
    }
  }
  rep.meta = { 'Dodatki': items.length, 'Włączone': items.filter(i => i.enabled).length, 'Folder': addons };
  const owners = new Map();
  for (const it of items) {
    const v = readVpk(it.file);
    const info = v && !v.error ? addonInfo((vpkRead(it.file, v, 'addoninfo.txt') || '').toString('latin1')) : {};
    const name = info.addontitle || strip(path.basename(it.file)).replace(/\.vpk$/i, '');
    rep.addMod({ key: it.file, file: it.file, name, version: info.addonversion || '-', enabled: it.enabled, toggleable: g.id === 'l4d2' ? true : !it.byList, toggle: g.id === 'l4d2' ? 'addonlist' : undefined, id: it.rel, source: it.src === 'Warsztat' ? 'Warsztat #' + path.basename(it.file, '.vpk') : 'addons', size: sizeOf(it.file), author: info.addonauthor });
    if (!it.enabled) continue;
    if (!v || v.error) { rep.error(`${name}: ${v ? v.error : 'nie można odczytać'}`, { mod: it.file, fix: 'Pobierz dodatek ponownie.' }); continue; }
    if (/_dir\.vpk$/i.test(it.file) || /_\d{3}\.vpk$/i.test(it.file)) rep.warn(`${name}: archiwum wieloczęściowe – gra wczytuje z addons tylko pojedyncze pliki .vpk`, { mod: it.file });
    if (!v.files.includes('addoninfo.txt')) rep.note(`${name}: brak addoninfo.txt`, { mod: it.file, detail: 'Dodatek zadziała, ale w menu Dodatki będzie bez nazwy i opisu.' });
    for (const f of v.files) { if (VPK_IGNORE.test(f)) continue; if (!owners.has(f)) owners.set(f, []); owners.get(f).push({ key: it.file, name }); }
  }
  // konflikty: ten sam plik w kilku dodatkach
  const pairs = new Map();
  for (const [f, who] of owners) {
    if (who.length < 2) continue;
    const k = who.map(w => w.key).sort().join('|');
    if (!pairs.has(k)) pairs.set(k, { who, files: [] });
    pairs.get(k).files.push(f);
  }
  for (const { who, files } of pairs.values()) {
    const scripts = files.filter(f => /^scripts\/|\.nut$|^cfg\//.test(f));
    const lvl = scripts.length ? 'warn' : 'note';
    rep[lvl](`Konflikt: ${who.map(w => w.name).join(' i ')} zmieniają te same pliki (${files.length})`, { mod: who[0].key, files: files.slice(0, 30), detail: scripts.length ? 'Nakładają się skrypty – zwykle działa tylko jeden z dodatków.' : 'Nakładają się modele/tekstury/dźwięki – w grze widać wersję z jednego dodatku.', fix: 'Wyłącz jeden z dodatków, jeśli w grze coś wygląda lub działa źle.' });
  }
  if (g.id === 'l4d2' && items.some(i => i.src === 'Warsztat') && !U.exists(listFile)) rep.note('Brak addonlist.txt – gra utworzy go przy następnym uruchomieniu.');
  clean(rep, 'Dodatki nie kolidują ze sobą');
  return rep.finish();
}
// włączanie/wyłączanie dodatku w addonlist.txt (L4D2)
function addonlistToggle(gamePath, gdir, rel, enable) {
  const f = path.join(gamePath, gdir, 'addonlist.txt');
  let t = U.readText(f, '"AddonList"\n{\n}\n');
  const norm = x => x.replace(/[\\/]+/g, '/').toLowerCase();
  let hit = false;
  t = t.split(/\r?\n/).map(l => { const m = l.match(/^(\s*"([^"]+)"\s*")([01])(".*)$/); if (m && norm(m[2]) === norm(rel)) { hit = true; return m[1] + (enable ? 1 : 0) + m[4]; } return l; }).join('\n');
  if (!hit) t = t.replace(/}\s*$/, `\t"${rel.replace(/\//g, '\\')}"\t\t"${enable ? 1 : 0}"\n}\n`);
  fs.writeFileSync(f, t);
}

// =============== Farming Simulator ===============
const FS = { 2017: [30, 39], 2019: [40, 59], 2022: [60, 89], 2025: [90, 199] };
function fsReadDesc(p) {
  try {
    if (U.isDir(p)) return U.readText(path.join(p, 'modDesc.xml'), null);
    const z = new AdmZip(p); const e = z.getEntries().find(x => /^moddesc\.xml$/i.test(x.entryName));
    return e ? e.getData().toString('utf8') : null;
  } catch { return undefined; }
}
const tag = (x, t) => { const m = String(x).match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].trim() : null; };
const cdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
function fsModsDir(year) { for (const d of docs()) { const p = path.join(d, 'My Games', `FarmingSimulator${year}`, 'mods'); if (U.isDir(p)) return p; } return path.join(docs()[0], 'My Games', `FarmingSimulator${year}`, 'mods'); }
function checkFarmSim(ctx) {
  const g = ctx.game; const year = g.fsYear;
  const rep = new Report(g.name);
  const dir = fsModsDir(year); const range = FS[year];
  rep.meta = { 'Folder modów': dir };
  const mods = [];
  for (const e of U.listDir(dir)) {
    const full = path.join(dir, e.name);
    const base = strip(e.name);
    if (e.isFile() && !/\.zip$/i.test(base)) { if (/\.(rar|7z)$/i.test(base)) rep.error(`${e.name}: gra czyta tylko pliki .zip`, { mod: full, fix: 'Rozpakuj archiwum – w środku powinien być plik .zip moda.' }); continue; }
    const name = base.replace(/\.zip$/i, '');
    const desc = fsReadDesc(full);
    const ver = desc ? (desc.match(/<modDesc[^>]*descVersion="(\d+)"/i) || [])[1] : null;
    const title = desc ? cdata(tag(tag(desc, 'title') || '', 'en') || tag(desc, 'title') || '').replace(/<[^>]+>/g, '') : '';
    const deps = desc ? [...(tag(desc, 'dependencies') || '').matchAll(/<dependency>([^<]+)<\/dependency>/gi)].map(m => m[1].trim()) : [];
    const mp = desc ? /<multiplayer[^>]*supported="true"/i.test(desc) : null;
    mods.push({ full, name, desc, ver: ver ? +ver : null, deps, enabled: !disabled(e.name) });
    rep.addMod({ key: full, file: full, id: name, name: title || name, version: desc ? (tag(desc, 'version') || '-') : '-', enabled: !disabled(e.name), toggleable: true, source: e.isDirectory() ? 'Folder (rozpakowany)' : 'mods', size: e.isFile() ? sizeOf(full) : undefined, author: desc ? cdata(tag(desc, 'author')) : undefined, mp });
  }
  const names = new Set(mods.filter(m => m.enabled).map(m => m.name.toLowerCase()));
  for (const m of mods) {
    if (!m.enabled) continue;
    if (m.desc === undefined) { rep.error(`${m.name}: uszkodzone archiwum`, { mod: m.full, fix: 'Pobierz mod ponownie.' }); continue; }
    if (!m.desc) { rep.error(`${m.name}: brak modDesc.xml w głównym folderze archiwum`, { mod: m.full, fix: 'To prawdopodobnie paczka kilku modów albo archiwum z dodatkowym folderem – rozpakuj je i wrzuć do mods właściwe pliki .zip.' }); continue; }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(m.name)) rep.error(`${m.name}: nieprawidłowa nazwa pliku`, { mod: m.full, detail: 'Gra pomija mody, których nazwa zawiera spacje, myślniki, nawiasy lub zaczyna się cyfrą (np. „Mod (1).zip” po ponownym pobraniu).', fix: 'Zmień nazwę na taką jak oryginał, np. FS22_NazwaModa.zip.' });
    if (m.ver != null && range && (m.ver < range[0] || m.ver > range[1])) {
      const other = Object.entries(FS).find(([, r]) => m.ver >= r[0] && m.ver <= r[1]);
      rep.error(`${m.name}: mod do ${other ? 'Farming Simulator ' + String(other[0]).slice(2) : 'innej wersji gry'} (descVersion ${m.ver})`, { mod: m.full, fix: 'Usuń go albo pobierz wersję dla tej części gry.' });
    }
    const pre = /^FS(\d\d)_/i.exec(m.name); if (pre && pre[1] !== String(year).slice(2) && range) rep.warn(`${m.name}: nazwa sugeruje mod do FS${pre[1]}`, { mod: m.full });
    for (const d of m.deps) if (!names.has(d.toLowerCase())) rep.error(`${m.name} wymaga moda ${d}`, { mod: m.full, fix: `Pobierz ${d} (zwykle z ModHub) i wrzuć do folderu mods.` });
  }
  const dup = new Map(); for (const m of mods.filter(x => x.enabled)) { const k = m.name.replace(/\s*\(\d+\)$/, '').replace(/_?v?\d+(\.\d+)+$/i, '').toLowerCase(); dup.set(k, [...(dup.get(k) || []), m]); }
  for (const [, l] of dup) if (l.length > 1) rep.warn(`Prawdopodobny duplikat: ${l.map(x => x.name).join(', ')}`, { mod: l[0].full, files: l.map(x => x.full), fix: 'Zostaw jedną (najnowszą) wersję.' });
  const log = (() => { for (const d of docs()) { const t = U.readText(path.join(d, 'My Games', `FarmingSimulator${year}`, 'log.txt'), ''); if (t) return t; } return ''; })();
  [...log.matchAll(/^.*(?:Error:|Warning: \(?Mod).*$/gm)].slice(-10).forEach(x => rep.note('log.txt: ' + x[0].trim().slice(0, 220)));
  clean(rep, 'Mody pasują do tej części gry');
  return rep.finish();
}

// =============== BeamNG.drive ===============
function beamUserDirs() {
  const la = U.localAppData();
  const out = [path.join(la, 'BeamNG', 'BeamNG.drive', 'current'), path.join(la, 'BeamNG.drive', 'current')];
  for (const base of [path.join(la, 'BeamNG', 'BeamNG.drive'), path.join(la, 'BeamNG.drive')]) {
    const vers = U.listDirs(base).filter(d => /^\d+\.\d+/.test(path.basename(d))).sort((a, b) => U.cmpVer(path.basename(b), path.basename(a)));
    out.push(...vers);
  }
  return out.filter(d => U.isDir(path.join(d, 'mods')));
}
function beamModsDir() { const d = beamUserDirs()[0]; return d ? path.join(d, 'mods') : path.join(U.localAppData(), 'BeamNG', 'BeamNG.drive', 'current', 'mods'); }
function beamDb(dir) { const j = U.readJSON(path.join(dir, 'db.json'), null); return j && j.mods ? j : { mods: {} }; }
function checkBeamNG(ctx) {
  const rep = new Report('BeamNG.drive');
  const dir = beamModsDir(); const db = beamDb(dir);
  rep.meta = { 'Folder modów': dir };
  const byFile = new Map(Object.entries(db.mods).map(([k, m]) => [String(m.filename || '').replace(/^\/mods\//i, '').toLowerCase(), { key: k, ...m }]));
  const owners = new Map();
  const files = [...U.listFiles(dir), ...U.listFiles(path.join(dir, 'repo')).map(f => f)];
  for (const f of files) {
    const b = path.basename(f); if (!/\.zip(\.disabled)?$/i.test(b)) continue;
    const rel = (path.dirname(f) !== dir ? 'repo/' : '') + strip(b).toLowerCase();
    const d = byFile.get(rel);
    const enabled = !disabled(b) && (d ? d.active !== false : true);
    let entries = null; try { entries = new AdmZip(f).getEntries().map(e => e.entryName.replace(/\\/g, '/').toLowerCase()); } catch { entries = null; }
    const info = d && d.modData ? d.modData : {};
    const name = info.title || strip(b).replace(/\.zip$/i, '');
    rep.addMod({ key: f, file: f, id: d ? d.key : strip(b).replace(/\.zip$/i, '').toLowerCase(), name, version: info.version_string || '-', enabled, toggleable: true, toggle: 'beamng', source: rel.startsWith('repo/') ? 'Repozytorium BeamNG' : 'mods', size: sizeOf(f) });
    if (!enabled) continue;
    if (!entries) { rep.error(`${name}: uszkodzone archiwum`, { mod: f, fix: 'Pobierz mod ponownie.' }); continue; }
    if (!entries.some(e => /^(vehicles|levels|art|lua|ui|scripts|mods|settings|gameplay|core)\//.test(e))) rep.warn(`${name}: nietypowa struktura archiwum`, { mod: f, detail: 'W głównym folderze archiwum nie ma vehicles/, levels/ ani innych folderów gry – prawdopodobnie mod jest spakowany w dodatkowy folder.', fix: 'Rozpakuj i spakuj ponownie tak, by vehicles/ lub levels/ były w głównym folderze.' });
    const tops = new Set(entries.map(e => (e.match(/^(vehicles|levels)\/([^/]+)\//) || []).slice(1).join('/')).filter(Boolean));
    for (const t of tops) { if (!owners.has(t)) owners.set(t, []); owners.get(t).push({ key: f, name }); }
  }
  const OFFICIAL = /^vehicles\/(common|etk800|etkc|pickup|van|vivace|covet|pessima|hopper|moonhawk|barstow|burnside|bluebuck|legran|fullsize|midsize|sunburst|scintilla|bolide|wendover|sbr|etki|bx|lansdale|bastion|roamer|miramar|autobello|wigeon|md_series|us_semi|citybus|racetruck|semi|dryvan|tanker|flatbed)$/;
  for (const [t, who] of owners) {
    if (who.length > 1) rep.warn(`Konflikt: ${who.map(w => w.name).join(' i ')} zawierają ${t}`, { mod: who[0].key, detail: 'Dwa mody z tym samym folderem pojazdu/mapy nadpisują się nawzajem.', fix: 'Zostaw jedną wersję.' });
    else if (OFFICIAL.test(t)) rep.note(`${who[0].name} nadpisuje oficjalny pojazd (${t.split('/')[1]})`, { mod: who[0].key, detail: 'Takie mody często psują się po aktualizacji gry.' });
  }
  if (U.isDir(path.join(dir, 'unpacked'))) for (const d of U.listDirs(path.join(dir, 'unpacked'))) rep.addMod({ key: d, file: d, name: path.basename(d), version: '-', enabled: true, source: 'unpacked' });
  clean(rep, 'Mody nie kolidują ze sobą');
  return rep.finish();
}
function beamToggle(modKey, file, enable) {
  const dir = beamModsDir(); const f = path.join(dir, 'db.json');
  const db = U.readJSON(f, null);
  if (db && db.mods && db.mods[modKey]) { db.mods[modKey].active = enable; fs.writeFileSync(f, JSON.stringify(db, null, 2)); return file; }
  // brak wpisu w db.json – przełączenie przez zmianę nazwy pliku
  const t = disabled(file) ? file.slice(0, -9) : file + '.disabled';
  if (disabled(file) === enable) fs.renameSync(file, t);
  return t;
}

// =============== GTA San Andreas ===============
const SA_EXE = { 14383616: '1.0 US (Hoodlum)', 5189632: '1.0 US (Compact)', 15806464: '1.01 US', 14405632: '1.0 EU', 15011840: '1.01 EU' };
function asiFiles(dirs) { return dirs.flatMap(d => U.listFiles(d).filter(f => /\.asi(\.disabled)?$/i.test(f))); }
function checkGTASA(ctx) {
  const rep = new Report('GTA San Andreas');
  const g = ctx.gamePath;
  const exe = U.firstExisting(['gta_sa.exe', 'gta-sa.exe', 'gta_sa_compact.exe', 'gtasa.exe'].map(x => path.join(g, x)));
  const size = exe ? sizeOf(exe) : 0;
  const ver = path.basename(exe || '').toLowerCase() === 'gta-sa.exe' ? 'Steam/Rockstar 3.0 (nowa)' : SA_EXE[size] || (exe ? `nieznana (${size} B)` : 'brak pliku gry');
  const asiLoader = ['vorbisHooked.dll', 'dinput8.dll', 'winmm.dll', 'version.dll'].some(f => U.exists(path.join(g, f))) || (U.exists(path.join(g, 'vorbisFile.dll')) && sizeOf(path.join(g, 'vorbisFile.dll')) < 60000 && U.exists(path.join(g, 'vorbisHooked.dll')));
  const cleo = U.exists(path.join(g, 'cleo.asi')) || U.exists(path.join(g, 'CLEO.asi'));
  const ml = U.exists(path.join(g, 'modloader.asi'));
  const sp = U.exists(path.join(g, 'SilentPatchSA.asi')) || U.exists(path.join(g, 'scripts', 'SilentPatchSA.asi'));
  rep.meta = { 'Wersja gry': ver, 'ASI Loader': asiLoader ? 'tak' : 'brak', 'CLEO': cleo ? 'tak' : 'brak', 'Mod Loader': ml ? 'tak' : 'brak', 'SilentPatch': sp ? 'tak' : 'brak' };
  const v10 = /^1\.0 US/.test(ver);
  const asis = asiFiles([g, path.join(g, 'scripts'), path.join(g, 'plugins')]);
  const cleoScripts = U.listFiles(path.join(g, 'cleo')).filter(f => /\.(cs|csa|csi|cm)(\.disabled)?$/i.test(f));
  for (const f of asis) rep.addMod({ key: f, file: f, name: strip(path.basename(f)), version: '-', enabled: !disabled(f), toggleable: true, source: path.relative(g, path.dirname(f)) || 'folder gry', size: sizeOf(f) });
  for (const f of cleoScripts) rep.addMod({ key: f, file: f, name: strip(path.basename(f)), version: '-', enabled: !disabled(f), toggleable: true, source: 'cleo', size: sizeOf(f) });
  for (const d of U.listDirs(path.join(g, 'modloader'))) { const b = path.basename(d); rep.addMod({ key: d, file: d, name: b.replace(/^\./, ''), version: '-', enabled: !b.startsWith('.'), toggleable: true, toggle: 'dotfolder', source: 'modloader' }); }
  if (/3\.0/.test(ver)) rep.error('Nowa wersja gry (Steam/Rockstar) nie obsługuje CLEO ani większości modów ASI', { fix: 'Zrób downgrade do 1.0 US (np. narzędziem „GTA SA Downgrader”) w osobnej kopii gry.' });
  else if (exe && !v10 && asis.length) rep.warn(`Wersja ${ver} – większość modów wymaga 1.0 US`, { fix: 'Zrób downgrade pliku gry do 1.0 US.' });
  if (asis.length && !asiLoader) rep.error('Masz mody .asi, ale brak ASI Loadera', { fix: 'Zainstaluj Silent\'s ASI Loader (vorbisFile.dll + vorbisHooked.dll) albo Ultimate ASI Loader (dinput8.dll).' });
  if (cleoScripts.length && !cleo) rep.error('Masz skrypty w folderze cleo, ale CLEO nie jest zainstalowane', { fix: 'Zainstaluj CLEO 4/5 (cleo.asi).' });
  if (U.listDirs(path.join(g, 'modloader')).length && !ml) rep.error('Folder modloader istnieje, ale brak modloader.asi', { fix: 'Zainstaluj Mod Loader (modloader.asi) albo przenieś mody na miejsce.' });
  if (!sp && asis.length) rep.note('Brak SilentPatch – zalecana poprawka błędów gry, wymagana przez część modów.');
  const dupe = new Map(); for (const f of asis.filter(x => !disabled(x))) { const k = path.basename(f).toLowerCase(); dupe.set(k, [...(dupe.get(k) || []), f]); }
  for (const [k, l] of dupe) if (l.length > 1) rep.error(`${k} jest w kilku folderach`, { files: l, fix: 'Zostaw jedną kopię – podwójne wczytanie zwykle wywala grę.' });
  const log = U.readText(path.join(g, 'cleo.log'), '') || U.readText(path.join(g, 'modloader', 'modloader.log'), '');
  [...log.matchAll(/^.*(?:error|failed|exception).*$/gim)].slice(-8).forEach(m => rep.warn('Log: ' + m[0].trim().slice(0, 200)));
  clean(rep, 'Mody i biblioteki są na swoim miejscu');
  return rep.finish();
}

// =============== GTA IV ===============
function checkGTA4(ctx) {
  const rep = new Report('GTA IV');
  const g = ctx.gamePath;
  const exe = U.firstExisting([path.join(g, 'GTAIV.exe'), path.join(g, 'GTAIV', 'GTAIV.exe')]);
  const root = exe ? path.dirname(exe) : g;
  const pv = exe ? peVersion(exe) : null; const ver = pv ? pv.file || pv.product : null;
  const ce = ver && /^1\.2\./.test(ver);
  const loader = ['dinput8.dll', 'xlive.dll', 'winmm.dll', 'version.dll'].find(f => U.exists(path.join(root, f)));
  const ff = asiFiles([root, path.join(root, 'plugins')]).some(f => /fusionfix/i.test(f));
  const shDN = U.exists(path.join(root, 'ScriptHookDotNet.asi')) || U.exists(path.join(root, 'ScriptHookDotNet.dll'));
  const sh = U.exists(path.join(root, 'ScriptHook.dll')) || U.exists(path.join(root, 'ScriptHookIV.asi'));
  rep.meta = { 'Wersja gry': ver ? `${ver}${ce ? ' (Complete Edition)' : ''}` : 'nieznana', 'ASI Loader': loader || 'brak', 'FusionFix': ff ? 'tak' : 'brak', 'ScriptHook': sh ? 'tak' : 'brak', 'ScriptHookDotNet': shDN ? 'tak' : 'brak' };
  const asis = asiFiles([root, path.join(root, 'plugins')]);
  for (const f of asis) rep.addMod({ key: f, file: f, name: strip(path.basename(f)), version: '-', enabled: !disabled(f), toggleable: true, source: path.relative(root, path.dirname(f)) || 'folder gry', size: sizeOf(f) });
  const scripts = U.listFiles(path.join(root, 'scripts')).filter(f => /\.(net\.dll|cs|vb|lua)(\.disabled)?$/i.test(f) || /\.dll(\.disabled)?$/i.test(f));
  for (const f of scripts) rep.addMod({ key: f, file: f, name: strip(path.basename(f)), version: '-', enabled: !disabled(f), toggleable: true, source: 'scripts', size: sizeOf(f) });
  for (const d of U.listDirs(path.join(root, 'update'))) rep.addMod({ key: d, file: d, name: 'update/' + path.basename(d), version: '-', enabled: true, source: 'update (zamienniki plików)' });
  if (asis.length && !loader) rep.error('Masz mody .asi, ale brak ASI Loadera', { fix: 'Zainstaluj Ultimate ASI Loader jako dinput8.dll (Complete Edition) albo xlive.dll (1.0.7/1.0.8).' });
  if (scripts.some(f => /\.net\.dll|\.cs$|\.vb$/i.test(f)) && !shDN) rep.error('Skrypty .NET w folderze scripts wymagają ScriptHookDotNet', { fix: 'Zainstaluj ScriptHookDotNet (dla Complete Edition: wersja z ScriptHookIV / FusionFix).' });
  if (!ff) rep.note('Brak FusionFix – zalecana poprawka grafiki i błędów, wymagana przez część nowszych modów.');
  if (ce && U.exists(path.join(root, 'xlive.dll'))) rep.warn('xlive.dll w Complete Edition', { detail: 'Complete Edition nie używa Games for Windows Live – ten plik pochodzi ze starej wersji.', fix: 'Użyj Ultimate ASI Loadera jako dinput8.dll.' });
  if (U.isDir(path.join(root, 'pc')) && !U.isDir(path.join(root, 'update')) && ce) rep.note('Complete Edition: podmienione pliki wrzucaj do folderu update zamiast nadpisywać oryginały w pc/.');
  clean(rep, 'Mody i biblioteki są na swoim miejscu');
  return rep.finish();
}

// =============== Hollow Knight ===============
function hkManaged(g) { return U.firstExisting([path.join(g, 'hollow_knight_Data', 'Managed'), path.join(g, 'Hollow Knight_Data', 'Managed'), path.join(g, 'hollow_knight.app', 'Contents', 'Resources', 'Data', 'Managed')]) || path.join(g, 'hollow_knight_Data', 'Managed'); }
function checkHollowKnight(ctx) {
  const rep = new Report('Hollow Knight');
  const managed = hkManaged(ctx.gamePath); const mods = path.join(managed, 'Mods');
  const asm = path.join(managed, 'Assembly-CSharp.dll');
  const api = U.exists(asm) && !!fileContains(asm, ['ModHooks'])['ModHooks'];
  rep.meta = { 'Modding API': api ? 'zainstalowane' : 'brak', 'Folder modów': mods };
  const items = [];
  for (const [dir, en] of [[mods, true], [path.join(mods, 'Disabled'), false]]) {
    for (const d of U.listDirs(dir)) { if (path.basename(d) === 'Disabled') continue; items.push({ d, en }); }
    for (const f of U.listFiles(dir, ['.dll'])) items.push({ d: f, en, loose: true });
  }
  const dlls = new Map();
  for (const it of items) {
    const name = path.basename(it.d).replace(/\.dll$/i, '');
    const files = it.loose ? [it.d] : U.listFiles(it.d, ['.dll']);
    const pv = files[0] ? peVersion(files[0]) : null;
    rep.addMod({ key: it.d, file: it.d, name, version: pv ? (pv.file || pv.product || '-') : '-', enabled: it.en, toggleable: false, source: it.en ? 'Mods' : 'Mods/Disabled (Lumafly)' });
    if (!it.en) continue;
    if (!files.length) rep.error(`${name}: w folderze moda nie ma pliku .dll`, { mod: it.d, fix: 'Rozpakuj mod tak, by .dll leżał w Mods/<NazwaModa>/.' });
    if (it.loose) rep.warn(`${name}.dll leży bezpośrednio w Mods`, { mod: it.d, detail: 'Nowe Modding API wczytuje mody z podfolderów.', fix: `Przenieś do Mods/${name}/${name}.dll.` });
    for (const f of files) { const k = path.basename(f).toLowerCase(); dlls.set(k, [...(dlls.get(k) || []), { f, name, key: it.d }]); }
  }
  for (const [k, l] of dlls) if (l.length > 1) rep.error(`${k} jest w kilku modach (${l.map(x => x.name).join(', ')})`, { mod: l[0].key, files: l.map(x => x.f), fix: 'Usuń starszą kopię – dwie wersje tej samej biblioteki powodują błędy ładowania.' });
  if (items.some(i => i.en) && !api) rep.error('Mody są zainstalowane, ale brakuje Modding API', { fix: 'Zainstaluj Modding API (najprościej przez Lumafly lub Scarab).' });
  const log = U.readText(path.join(U.home(), 'AppData', 'LocalLow', 'Team Cherry', 'Hollow Knight', 'ModLog.txt'), '');
  [...log.matchAll(/^\[(?:ERROR)\].*$/gm)].slice(-10).forEach(m => rep.warn('ModLog: ' + m[0].slice(0, 220)));
  const missDeps = [...log.matchAll(/Could not load file or assembly '([^',]+)/g)].map(m => m[1]);
  for (const d of [...new Set(missDeps)].slice(0, 6)) rep.error(`Brak zależności ${d}`, { fix: `Zainstaluj mod/bibliotekę ${d} (np. Satchel, Vasi, SFCore) – Lumafly doinstaluje ją automatycznie.` });
  clean(rep, 'Mody i Modding API są w porządku');
  return rep.finish();
}

// =============== Assetto Corsa ===============
const AC_CARS = new Set('abarth500 abarth500_s1 alfa_romeo_giulietta_qv alfa_romeo_giulietta_qv_le bmw_1m bmw_1m_s3 bmw_m3_e30 bmw_m3_e30_drift bmw_m3_e30_dtm bmw_m3_e30_gra bmw_m3_e30_s1 bmw_m3_e92 bmw_m3_e92_drift bmw_m3_e92_s1 bmw_m3_gt2 bmw_z4 bmw_z4_drift bmw_z4_gt3 bmw_z4_s1 ferrari_312t ferrari_458 ferrari_458_gt2 ferrari_458_s3 ferrari_599xxevo ferrari_f40 ferrari_f40_s3 ferrari_laferrari ktm_xbow_r lotus_2_eleven lotus_2_eleven_gt4 lotus_49 lotus_98t lotus_elise_sc lotus_elise_sc_s1 lotus_elise_sc_s2 lotus_evora_gtc lotus_evora_gte lotus_evora_gte_carbon lotus_evora_gx lotus_evora_s lotus_evora_s_s2 lotus_exige_240 lotus_exige_240_s3 lotus_exige_s lotus_exige_s_roadster lotus_exige_scura lotus_exige_v6_cup lotus_exos_125 lotus_exos_125_s1 mclaren_mp412c mclaren_mp412c_gt3 mercedes_sls mercedes_sls_gt3 p4-5_2011 pagani_huayra pagani_zonda_r ruf_yellowbird shelby_cobra_427sc tatuusfa1'.split(' '));
const AC_TRACKS = new Set('drift imola magione monza monza66 mugello silverstone silverstone-international spa trento-bondone'.split(' '));
function checkAssetto(ctx) {
  const rep = new Report('Assetto Corsa');
  const g = ctx.gamePath;
  const csp = U.exists(path.join(g, 'dwrite.dll')) && U.isDir(path.join(g, 'extension'));
  const cm = U.exists(path.join(g, 'Content Manager.exe')) || U.exists(path.join(g, 'AssettoCorsa_original.exe'));
  rep.meta = { 'Custom Shaders Patch': csp ? 'tak' : 'brak', 'Content Manager': cm ? 'tak' : 'nie wykryto' };
  let carMods = 0, trackMods = 0;
  for (const d of U.listDirs(path.join(g, 'content', 'cars'))) {
    const id = path.basename(d); if (id.startsWith('ks_') || AC_CARS.has(id)) continue;
    carMods++;
    const ui = U.readJSON(path.join(d, 'ui', 'ui_car.json'), null) || (() => { try { return JSON.parse(U.readText(path.join(d, 'ui', 'ui_car.json'), '').replace(/[\r\n\t]+/g, ' ')); } catch { return null; } })();
    const name = (ui && ui.name) || id;
    rep.addMod({ key: d, file: d, id, name, version: (ui && ui.version) || '-', enabled: true, source: 'content/cars', author: ui && ui.author });
    const acd = U.exists(path.join(d, 'data.acd')); const data = U.isDir(path.join(d, 'data'));
    if (!acd && !data) rep.error(`${name}: brak data.acd i folderu data`, { mod: d, fix: 'Mod jest niekompletny – zainstaluj go ponownie (najlepiej przeciągając archiwum na Content Manager).' });
    else if (!acd) rep.note(`${name}: dane auta są rozpakowane (brak data.acd)`, { mod: d, detail: 'W trybie pojedynczego gracza działa, ale serwery online sprawdzające sumy kontrolne mogą odrzucić auto.' });
    if (!U.listFiles(d, ['.kn5']).length) rep.error(`${name}: brak modelu .kn5`, { mod: d });
    if (!ui) rep.warn(`${name}: brak lub błędny ui/ui_car.json`, { mod: d, detail: 'Auto może nie pojawić się na liście w grze.' });
    if (!csp && U.exists(path.join(d, 'extension', 'ext_config.ini'))) rep.warn(`${name} ma konfigurację dla Custom Shaders Patch`, { mod: d, fix: 'Zainstaluj CSP przez Content Manager, aby światła i efekty działały.' });
  }
  for (const d of U.listDirs(path.join(g, 'content', 'tracks'))) {
    const id = path.basename(d); if (id.startsWith('ks_') || AC_TRACKS.has(id)) continue;
    trackMods++;
    const layouts = U.listDirs(d).filter(x => U.exists(path.join(x, 'data', 'surfaces.ini')) || U.exists(path.join(x, 'map.png')));
    const ui = U.readJSON(path.join(d, 'ui', 'ui_track.json'), null) || (layouts[0] ? U.readJSON(path.join(d, 'ui', path.basename(layouts[0]), 'ui_track.json'), null) : null);
    const name = (ui && ui.name) || id;
    rep.addMod({ key: d, file: d, id, name, version: (ui && ui.version) || '-', enabled: true, source: 'content/tracks', author: ui && ui.author });
    if (!U.listFiles(d, ['.kn5']).length && !U.walk(d, { maxDepth: 2, maxFiles: 500, filter: f => /\.kn5$/i.test(f) }).length) rep.error(`${name}: brak plików .kn5 toru`, { mod: d, fix: 'Mod jest niekompletny – zainstaluj ponownie.' });
    if (!U.exists(path.join(d, 'data', 'surfaces.ini')) && !layouts.length) rep.warn(`${name}: brak data/surfaces.ini`, { mod: d, detail: 'Tor może się nie wczytać albo auta będą przez niego przelatywać.' });
    if (U.exists(path.join(d, 'extension', 'ext_config.ini')) && !csp) rep.note(`${name}: konfiguracja świateł/efektów dla CSP nie zadziała bez Custom Shaders Patch`, { mod: d });
  }
  rep.meta['Auta z modów'] = carMods; rep.meta['Tory z modów'] = trackMods;
  if (!cm && (carMods || trackMods)) rep.note('Content Manager ułatwia instalację modów i jest wymagany przez Custom Shaders Patch.');
  clean(rep, 'Mody aut i torów są kompletne');
  return rep.finish();
}

module.exports = { readVpk, vpkRead, addonInfo, checkVpk, addonlistToggle, fsReadDesc, fsModsDir, checkFarmSim, FS, beamModsDir, checkBeamNG, beamToggle, checkGTASA, checkGTA4, checkHollowKnight, hkManaged, checkAssetto, SA_EXE };
