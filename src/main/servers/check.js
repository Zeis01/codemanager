// Sprawdzanie zgodności pluginów / modów / zasobów na serwerach
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const TOML = require('@iarna/toml');
const U = require('../util');
const { Report, collect, sizeOf } = require('../compat/common');
const mc = require('../compat/minecraft');
const unity = require('../compat/unity');
const { parseLua, parseVDF, parseIni } = require('../parsers/text');
const { parseSMX, peVersion, fileContains } = require('../parsers/binary');
const { pzCollectMods, pzWorkshopDirs, pzList } = require('../compat/games');
const { FRAMEWORKS } = require('./defs2');

const clean = (rep, msg) => { if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(msg); };
const lastLog = (dir, re) => { const f = U.listFiles(dir).filter(x => !re || re.test(path.basename(x))).map(x => ({ x, t: fs.statSync(x).mtimeMs })).sort((a, b) => b.t - a.t)[0]; return f ? U.readText(f.x, '') : ''; };

// ---------------- Rust ----------------
function checkRust(s) {
  const rep = new Report('Rust – pluginy');
  const oxide = FRAMEWORKS.oxide.status(s); const carbon = FRAMEWORKS.carbon.status(s);
  rep.meta = { 'Framework': oxide && carbon ? 'Oxide + Carbon (!)' : oxide ? 'Oxide' : carbon ? 'Carbon' : 'brak' };
  if (oxide && carbon) rep.error('Zainstalowano jednocześnie Oxide i Carbon', { fix: 'Zostaw tylko jeden framework (zweryfikuj pliki serwera przez Aktualizuj i zainstaluj wybrany).' });
  if (!oxide && !carbon) rep.warn('Brak frameworka pluginów (Oxide/Carbon)', { fix: 'Zainstaluj Oxide lub Carbon w zakładce Frameworki.', action: { type: 'framework', id: 'oxide', label: 'Zainstaluj Oxide' } });
  if (oxide) {
    const managed = path.join(s.path, 'RustDedicated_Data', 'Managed');
    const oxDll = path.join(managed, 'Oxide.Rust.dll'); const asm = path.join(managed, 'Assembly-CSharp.dll');
    if (U.exists(oxDll) && U.exists(asm) && fs.statSync(asm).mtimeMs > fs.statSync(oxDll).mtimeMs + 60000) rep.error('Rust został zaktualizowany po instalacji Oxide', { fix: 'Zainstaluj Oxide ponownie – stara wersja nie załaduje pluginów.' });
  }
  const dir = carbon ? path.join(s.path, 'carbon', 'plugins') : path.join(s.path, 'oxide', 'plugins');
  const files = collect(dir, ['.cs']);
  const plugins = files.map(f => {
    const t = U.readText(f.file, '');
    const info = t.match(/\[Info\s*\(\s*"([^"]+)"\s*,\s*"([^"]*)"\s*,\s*"([^"]+)"/);
    const cls = t.match(/class\s+(\w+)\s*:\s*(?:Rust|Covalence|Carbon)Plugin/);
    const requires = [...t.matchAll(/^\s*\/\/\s*Requires:\s*(\w+)/gim)].map(m => m[1]);
    const refs = [];
    for (const m of t.matchAll(/\[PluginReference(?:\s*\(\s*"(\w+)"\s*\))?\]\s*(?:private|public|protected)?\s*(?:readonly\s+)?Plugin\s+([\w\s,]+);/g)) {
      if (m[1]) refs.push(m[1]); else m[2].split(',').forEach(x => refs.push(x.trim()));
    }
    return { ...f, title: info ? info[1] : null, author: info ? info[2] : null, version: info ? info[3] : '?', cls: cls ? cls[1] : null, requires, refs, carbonOnly: /\bCarbon\.(Core|Base)\b/.test(t) && !/RustPlugin/.test(t) };
  });
  const names = new Set(plugins.filter(p => p.enabled).map(p => path.basename(p.name, '.cs').replace(/\.cs$/i, '').toLowerCase()));
  for (const p of plugins) {
    const base = p.name.replace(/\.cs(\.disabled)?$/i, '');
    rep.addMod({ key: p.file, file: p.file, name: p.title || base, version: p.version, enabled: p.enabled, toggleable: true, author: p.author });
    if (!p.enabled) continue;
    if (!p.cls) rep.error(`${base}.cs nie wygląda na plugin Oxide (brak klasy RustPlugin/CovalencePlugin)`, { mod: p.file });
    else if (p.cls !== base) rep.error(`Nazwa klasy (${p.cls}) różni się od nazwy pliku (${base}.cs)`, { mod: p.file, fix: `Zmień nazwę pliku na ${p.cls}.cs – inaczej Oxide go nie skompiluje.` });
    if (!p.title) rep.warn(`${base}: brak atrybutu [Info]`, { mod: p.file });
    if (p.carbonOnly && oxide) rep.error(`${base} korzysta z API Carbona – nie zadziała na Oxide`, { mod: p.file });
    for (const r of p.requires) if (!names.has(r.toLowerCase())) rep.error(`${base} wymaga pluginu ${r} (// Requires)`, { mod: p.file, fix: `Dodaj ${r}.cs do folderu pluginów.` });
    for (const r of p.refs) if (!names.has(r.toLowerCase())) rep.note(`${base} może korzystać z ${r} (opcjonalnie, [PluginReference])`, { mod: p.file });
  }
  const log = lastLog(path.join(s.path, carbon ? 'carbon/logs' : 'oxide/logs'));
  const errs = [...log.matchAll(/(Error while compiling[^\n]*|[\w]+ - Failed to compile[^\n]*|Failed to initialize plugin[^\n]*|Unable to load[^\n]*)/gi)].slice(-15);
  errs.forEach(m => rep.warn('Log: ' + m[1].slice(0, 220)));
  clean(rep, 'Pluginy wyglądają poprawnie');
  return rep.finish();
}

// ---------------- CS2 ----------------
function checkCS2(s) {
  const rep = new Report('CS2 – pluginy');
  const csgo = path.join(s.path, 'game', 'csgo');
  const mm = FRAMEWORKS.metamod2.status(s); const css = FRAMEWORKS.counterstrikesharp.status(s);
  const gi = U.readText(path.join(csgo, 'gameinfo.gi'), '');
  const cssApi = path.join(csgo, 'addons', 'counterstrikesharp', 'api', 'CounterStrikeSharp.API.dll');
  const cssVer = U.exists(cssApi) ? (peVersion(cssApi) || {}).file : null;
  rep.meta = { 'Metamod': mm ? 'tak' : 'brak', 'CounterStrikeSharp': css ? (cssVer || 'tak') : 'brak' };
  if (mm && !/csgo\/addons\/metamod/i.test(gi)) rep.error('gameinfo.gi nie zawiera wpisu Metamod (zwykle po aktualizacji CS2)', { fix: 'Kliknij "Zainstaluj" przy Metamod:Source 2.0 – wpis zostanie dopisany ponownie.', action: { type: 'patch-gameinfo', label: 'Napraw gameinfo.gi' } });
  if (css && !mm) rep.error('CounterStrikeSharp wymaga Metamod:Source 2.0', { fix: 'Zainstaluj Metamod w zakładce Frameworki.', action: { type: 'framework', id: 'metamod2', label: 'Zainstaluj Metamod' } });
  if (!css) rep.note('CounterStrikeSharp nie jest zainstalowany – brak pluginów C# do sprawdzenia.');
  const pdir = path.join(csgo, 'addons', 'counterstrikesharp', 'plugins');
  for (const d of U.listDir(pdir)) {
    const full = path.join(pdir, d.name);
    if (d.isDirectory()) {
      const disabled = d.name === 'disabled';
      if (disabled) { U.listDirs(full).forEach(x => rep.addMod({ key: x, file: x, name: path.basename(x), version: '-', enabled: false })); continue; }
      const dll = path.join(full, d.name + '.dll');
      const v = U.exists(dll) ? (peVersion(dll) || {}).file : null;
      rep.addMod({ key: full, file: full, name: d.name, version: v || '-', enabled: true });
      if (!U.exists(dll)) rep.error(`${d.name}: brak ${d.name}.dll w folderze pluginu`, { mod: full, fix: 'Nazwa folderu musi być identyczna z nazwą pliku DLL pluginu.' });
      else {
        const c = fileContains(dll, ['CounterStrikeSharp.API', 'BasePlugin']);
        if (!c['CounterStrikeSharp.API']) rep.warn(`${d.name}.dll nie odwołuje się do CounterStrikeSharp.API`, { mod: full });
      }
    } else if (/\.dll$/i.test(d.name)) {
      rep.addMod({ key: full, file: full, name: d.name, version: '-', enabled: true });
      rep.error(`${d.name} leży luzem w folderze plugins`, { mod: full, fix: `Przenieś do plugins/${d.name.replace(/\.dll$/i, '')}/${d.name}.` });
    }
  }
  const log = lastLog(path.join(csgo, 'addons', 'counterstrikesharp', 'logs'));
  [...log.matchAll(/(Failed to load plugin[^\n]*|Unable to load[^\n]*|Exception[^\n]*)/g)].slice(-10).forEach(m => rep.warn('Log CSS: ' + m[1].slice(0, 220)));
  clean(rep, 'Konfiguracja pluginów CS2 wygląda poprawnie');
  return rep.finish();
}

async function cs2Online(s) {
  const out = [];
  const api = path.join(s.path, 'game', 'csgo', 'addons', 'counterstrikesharp', 'api', 'CounterStrikeSharp.API.dll');
  const v = U.exists(api) ? (peVersion(api) || {}).file : null;
  try {
    const rel = await (await fetch('https://api.github.com/repos/roflmuffin/CounterStrikeSharp/releases/latest', { headers: { 'User-Agent': 'CodeManager' } })).json();
    const latest = (rel.tag_name || '').replace(/^v/, '');
    const mine = v ? v.split('.').pop() === '0' ? v.split('.')[2] : v.split('.').pop() : null;
    out.push({ level: 'info', title: `Najnowszy CounterStrikeSharp: ${rel.tag_name}${v ? ` (zainstalowany ${v})` : ''}`, url: rel.html_url });
    if (mine && latest && +latest > +mine) out.push({ level: 'warn', title: 'Dostępna nowsza wersja CounterStrikeSharp – po aktualizacjach CS2 stare wersje często przestają działać.' });
  } catch (e) { out.push({ level: 'info', title: 'GitHub niedostępny: ' + e.message }); }
  return out;
}

// ---------------- TF2 / SourceMod ----------------
const SM_BUNDLED = new Set(['core', 'sdktools', 'sdkhooks', 'clientprefs', 'dbi', 'bintools', 'geoip', 'regex', 'topmenus', 'tf2', 'tf2items', 'cstrike', 'dhooks', 'socket', 'updater']);
function checkSourceMod(s) {
  const rep = new Report('TF2 – SourceMod');
  const tf = path.join(s.path, 'tf');
  const sm = FRAMEWORKS.sourcemod.status(s); const mm = FRAMEWORKS.metamod112.status(s);
  rep.meta = { 'Metamod': mm ? 'tak' : 'brak', 'SourceMod': sm ? 'tak' : 'brak' };
  if (sm && !mm) rep.error('SourceMod wymaga Metamod:Source', { fix: 'Zainstaluj Metamod:Source 1.12.', action: { type: 'framework', id: 'metamod112', label: 'Zainstaluj Metamod' } });
  if (!sm) { rep.warn('SourceMod nie jest zainstalowany', { fix: 'Zainstaluj go w zakładce Frameworki.' }); return rep.finish(); }
  const extDir = path.join(tf, 'addons', 'sourcemod', 'extensions');
  const exts = new Set(U.listFiles(extDir).map(f => path.basename(f).toLowerCase().split('.ext')[0]));
  const pdir = path.join(tf, 'addons', 'sourcemod', 'plugins');
  const plugins = [];
  for (const [dir, enabled] of [[pdir, true], [path.join(pdir, 'disabled'), false]]) {
    for (const f of U.listFiles(dir, ['.smx'])) {
      let info; try { info = parseSMX(f); } catch (e) { info = { error: e.message }; }
      plugins.push({ file: f, name: path.basename(f, '.smx'), enabled, info });
    }
  }
  const libsProvided = new Set();
  for (const p of plugins) {
    rep.addMod({ key: p.file, file: p.file, name: p.name, version: '-', enabled: p.enabled, source: p.enabled ? 'plugins/' : 'plugins/disabled/' });
    if (!p.enabled) continue;
    if (p.info.error) { rep.error(`${p.name}.smx: ${p.info.error}`, { mod: p.file }); continue; }
    if (p.info.version < 0x0101) rep.warn(`${p.name}.smx skompilowano bardzo starym kompilatorem`, { mod: p.file });
    for (const e of p.info.extensions) {
      const ename = e.toLowerCase();
      if (ename === 'core') continue;
      if (!exts.has(ename) && !SM_BUNDLED.has(ename)) rep.error(`${p.name} wymaga rozszerzenia "${e}"`, { mod: p.file, fix: `Zainstaluj ${e}.ext w addons/sourcemod/extensions.` });
    }
    if (p.info.libraries.length) rep.note(`${p.name} korzysta z bibliotek pluginów: ${p.info.libraries.join(', ')}`, { mod: p.file });
  }
  const log = lastLog(path.join(tf, 'addons', 'sourcemod', 'logs'), /^errors_/);
  [...log.matchAll(/(\[SM\][^\n]*(?:failed|Unable to load|error)[^\n]*)/gi)].slice(-12).forEach(m => rep.warn('Log błędów: ' + m[1].slice(0, 220)));
  clean(rep, 'Pluginy SourceMod wyglądają poprawnie');
  return rep.finish();
}

// ---------------- DayZ ----------------
function checkDayZ(s) {
  const rep = new Report('DayZ – mody');
  const mods = String(s.settings.mods || '').split(';').map(x => x.trim()).filter(Boolean);
  const smods = String(s.settings.servermods || '').split(';').map(x => x.trim()).filter(Boolean);
  const keysDir = path.join(s.path, 'keys');
  const keys = new Set(U.listFiles(keysDir, ['.bikey']).map(f => path.basename(f).toLowerCase()));
  const cfg = U.readText(path.join(s.path, 'serverDZ.cfg'), '');
  const template = (cfg.match(/template\s*=\s*"([^"]+)"/) || [])[1];
  rep.meta = { 'Mody klienckie': mods.length, 'Mody serwerowe': smods.length, 'Misja': template || '?' };
  if (!cfg) rep.error('Brak serverDZ.cfg');
  if (template && !U.isDir(path.join(s.path, 'mpmissions', template))) rep.error(`Folder misji mpmissions/${template} nie istnieje`, { fix: 'Popraw template w serverDZ.cfg lub skopiuj misję.' });
  if (/passwordAdmin\s*=\s*""/.test(cfg)) rep.warn('Hasło admina (passwordAdmin) jest puste');
  const atFolders = U.listDirs(s.path).filter(d => path.basename(d).startsWith('@'));
  for (const d of atFolders) {
    const name = path.basename(d);
    const meta = U.readText(path.join(d, 'meta.cpp'), '');
    const enabled = mods.includes(name) || smods.includes(name);
    rep.addMod({ key: d, file: d, name: (meta.match(/name\s*=\s*"([^"]+)"/) || [])[1] || name, version: (meta.match(/publishedid\s*=\s*(\d+)/) || [])[1] ? '#' + meta.match(/publishedid\s*=\s*(\d+)/)[1] : '-', enabled, source: smods.includes(name) ? 'serverMod' : 'mod' });
    if (!enabled) { rep.note(`${name} jest w folderze serwera, ale nie ma go w parametrach -mod`, { mod: d }); continue; }
    if (!U.isDir(path.join(d, 'addons')) && !U.isDir(path.join(d, 'Addons'))) rep.error(`${name}: brak folderu addons`, { mod: d });
    const modKeys = [...U.listFiles(path.join(d, 'keys'), ['.bikey']), ...U.listFiles(path.join(d, 'Keys'), ['.bikey']), ...U.listFiles(path.join(d, 'key'), ['.bikey'])];
    if (!smods.includes(name)) {
      if (!modKeys.length) rep.warn(`${name}: mod nie zawiera klucza .bikey`, { mod: d });
      for (const k of modKeys) if (!keys.has(path.basename(k).toLowerCase())) rep.error(`${name}: klucz ${path.basename(k)} nie jest skopiowany do folderu keys`, { mod: d, fix: 'Skopiuj klucz do keys/ – inaczej gracze zostaną wyrzuceni z serwera.', action: { type: 'copy', from: k, to: path.join(keysDir, path.basename(k)), label: 'Skopiuj klucz' } });
    }
    if (/\s/.test(name)) rep.error(`${name}: spacje w nazwie folderu psują parametr -mod`, { mod: d, fix: 'Zmień nazwę folderu na bez spacji.' });
  }
  for (const m of [...mods, ...smods]) if (!U.isDir(path.join(s.path, m))) rep.error(`Mod ${m} z parametrów nie istnieje w folderze serwera`);
  clean(rep, 'Mody i klucze są w porządku');
  return rep.finish();
}

// ---------------- Arma Reforger ----------------
function checkArma(s) {
  const rep = new Report('Arma Reforger – konfiguracja i mody');
  const cfgPath = path.join(s.path, 'config.json');
  const raw = U.readText(cfgPath);
  if (!raw) { rep.error('Brak config.json'); return rep.finish(); }
  let cfg; try { cfg = JSON.parse(raw); } catch (e) { rep.error('config.json zawiera błąd składni JSON', { detail: e.message, fix: 'Otwórz plik w edytorze – błąd zostanie podświetlony.' }); return rep.finish(); }
  const g = cfg.game || {};
  rep.meta = { 'Scenariusz': g.scenarioId || '?', 'Mody': (g.mods || []).length };
  if (!g.scenarioId) rep.error('Brak game.scenarioId');
  else if (!/^\{[0-9A-F]{16}\}.+\.conf$/i.test(g.scenarioId)) rep.warn('scenarioId ma nietypowy format (oczekiwano {GUID}ścieżka.conf)');
  if (!g.name) rep.warn('Brak nazwy serwera (game.name)');
  if (cfg.bindPort == null && cfg.publicPort == null) rep.warn('Brak portu (bindPort/publicPort)');
  const addonsDir = path.join(s.path, 'profile', 'addons');
  const downloaded = new Map(U.listDirs(addonsDir).map(d => { const m = path.basename(d).match(/_([0-9A-F]{16})$/i); return [m ? m[1].toUpperCase() : path.basename(d), d]; }));
  const seen = new Set();
  for (const m of g.mods || []) {
    const id = String(m.modId || '').toUpperCase();
    rep.addMod({ key: id || JSON.stringify(m), name: m.name || id, version: m.version || 'najnowsza', enabled: true, source: downloaded.has(id) ? 'Pobrany' : 'Pobierze się przy starcie' });
    if (!/^[0-9A-F]{16}$/.test(id)) rep.error(`Nieprawidłowe modId "${m.modId}"`, { mod: id, fix: 'modId to 16 znaków szesnastkowych z adresu moda w Warsztacie Reforger.' });
    if (seen.has(id)) rep.error(`Mod ${m.name || id} występuje dwukrotnie`, { mod: id }); seen.add(id);
    if (m.version) rep.note(`${m.name || id}: przypięta wersja ${m.version} – gracze muszą mieć dokładnie tę wersję`, { mod: id });
  }
  const log = lastLog(path.join(s.path, 'profile', 'logs')) || '';
  [...log.matchAll(/(Dependency[^\n]*not found[^\n]*|Addon[^\n]*failed[^\n]*|\bERROR\b[^\n]*)/gi)].slice(-10).forEach(m => rep.warn('Log: ' + m[1].slice(0, 200)));
  clean(rep, 'config.json jest poprawny');
  return rep.finish();
}

// ---------------- Project Zomboid (serwer) ----------------
function checkPZServer(s) {
  const rep = new Report('Project Zomboid – mody serwera');
  const ini = path.join(s.path, 'Zomboid', 'Server', `${s.settings.servername || 'servertest'}.ini`);
  const t = U.readText(ini);
  if (!t) { rep.note('Plik konfiguracyjny jeszcze nie istnieje – uruchom serwer raz.', { detail: ini }); return rep.finish(); }
  const kv = parseIni(t).__root;
  const modIds = pzList(kv.Mods); const items = pzList(kv.WorkshopItems);
  rep.meta = { 'Mods=': modIds.length, 'WorkshopItems=': items.length, 'Map=': kv.Map || '?' };
  const ws = [path.join(s.path, 'steamapps', 'workshop', 'content', '108600'), path.join(s.path, 'Zomboid', 'workshop', 'content', '108600')].filter(U.isDir);
  const mods = pzCollectMods(pzWorkshopDirs(ws));
  const byId = new Map(mods.map(m => [m.id.toLowerCase(), m]));
  for (const id of modIds) {
    const m = byId.get(id.toLowerCase());
    rep.addMod({ key: id, name: m ? (m.info.name || id) : id, version: m && m.workshopId ? '#' + m.workshopId : '-', enabled: true, source: m ? 'Pobrany' : 'Nie pobrany' });
    if (!m) { if (ws.length) rep.warn(`Mod ${id} nie został jeszcze pobrany`, { mod: id, detail: 'Serwer pobiera mody przy starcie – jeśli błąd się powtarza, brakuje ID w WorkshopItems.' }); continue; }
    if (!items.includes(m.workshopId)) rep.error(`Mod ${id} (Warsztat ${m.workshopId}) nie jest wpisany w WorkshopItems`, { mod: id, fix: `Dopisz ${m.workshopId} do WorkshopItems=.` });
    for (const r of pzList(m.info.require)) {
      if (!modIds.some(x => x.toLowerCase() === r.toLowerCase())) rep.error(`${id} wymaga moda ${r}, którego brak w Mods=`, { mod: id });
      else if (modIds.findIndex(x => x.toLowerCase() === r.toLowerCase()) > modIds.indexOf(id)) rep.warn(`${id} jest przed swoją zależnością ${r} na liście Mods=`, { mod: id });
    }
  }
  for (const it of items) if (!mods.some(m => m.workshopId === it) && ws.length) rep.note(`WorkshopItems zawiera ${it}, ale żaden mod z tego przedmiotu nie jest w Mods=`);
  clean(rep, 'Lista modów serwera jest spójna');
  return rep.finish();
}

// ---------------- FiveM ----------------
function fivemResources(root) {
  const out = [];
  const walk = (dir, depth) => {
    for (const d of U.listDirs(dir)) {
      const b = path.basename(d);
      if (b.startsWith('[') && b.endsWith(']') && depth < 4) { walk(d, depth + 1); continue; }
      const fx = path.join(d, 'fxmanifest.lua'); const old = path.join(d, '__resource.lua');
      if (U.exists(fx) || U.exists(old)) out.push({ name: b, dir: d, manifest: U.exists(fx) ? fx : old, legacy: !U.exists(fx) });
    }
  };
  walk(root, 0);
  return out;
}
function checkFiveM(s) {
  const rep = new Report('FiveM – zasoby');
  const data = path.join(s.path, 'server-data');
  const cfg = U.readText(path.join(data, 'server.cfg'), '');
  const ensured = [...cfg.matchAll(/^\s*(?:ensure|start)\s+([^\s#]+)/gm)].map(m => m[1]);
  const res = fivemResources(path.join(data, 'resources'));
  const byName = new Map(); res.forEach(r => byName.set(r.name, [...(byName.get(r.name) || []), r]));
  rep.meta = { 'Zasoby': res.length, 'Uruchamiane (ensure)': ensured.length };
  const lic = (cfg.match(/^\s*sv_licenseKey\s+"?([^"\s]*)"?/m) || [])[1];
  if (!lic || /^(WKLEJ|changeme)/i.test(lic)) rep.error('Brak klucza licencji (sv_licenseKey)', { fix: 'Wygeneruj klucz na portal.cfx.re i wklej go do server.cfg.' });
  for (const r of res) {
    const enabled = ensured.includes(r.name);
    let p = { calls: [], assigns: {} }; try { p = parseLua(U.readText(r.manifest, '')); } catch { /* */ }
    const call = n => p.calls.filter(c => c.name === n).map(c => c.args[0]);
    const fx = call('fx_version')[0]; const game = call('game')[0] || (call('games')[0] || [])[0];
    const deps = [].concat(...call('dependency').map(x => [].concat(x)), ...call('dependencies').map(x => [].concat(x))).filter(x => typeof x === 'string');
    rep.addMod({ key: r.dir, file: r.dir, name: r.name, version: String(call('version')[0] || '-'), enabled, source: path.relative(path.join(data, 'resources'), path.dirname(r.dir)) || 'resources' });
    if (!enabled) continue;
    if (r.legacy) rep.warn(`${r.name} używa przestarzałego __resource.lua`, { mod: r.dir, fix: 'Przepisz manifest na fxmanifest.lua.' });
    else if (!fx) rep.error(`${r.name}: brak fx_version w fxmanifest.lua`, { mod: r.dir });
    else if (!['adamant', 'bodacious', 'cerulean'].includes(fx)) rep.warn(`${r.name}: nieznane fx_version "${fx}"`, { mod: r.dir });
    if (game && !['gta5', 'common', 'rdr3'].includes(game)) rep.warn(`${r.name}: nietypowa gra "${game}"`, { mod: r.dir });
    if (game === 'rdr3') rep.error(`${r.name} jest zasobem RedM (rdr3), nie FiveM`, { mod: r.dir });
    for (const d of deps) {
      const dn = d.replace(/^\/.*$/, '');
      if (!dn) continue; // zależności typu /server:1234
      if (!byName.has(dn)) rep.error(`${r.name} wymaga zasobu "${dn}"`, { mod: r.dir, fix: 'Dodaj brakujący zasób do folderu resources.' });
    }
  }
  for (const e of ensured) if (!byName.has(e)) rep.error(`server.cfg uruchamia "${e}", którego nie ma w resources`);
  for (const [n, l] of byName) if (l.length > 1) rep.error(`Zasób "${n}" istnieje ${l.length}×`, { files: l.map(x => x.dir), fix: 'Nazwy zasobów muszą być unikalne – usuń duplikat.' });
  clean(rep, 'Zasoby i zależności są poprawne');
  return rep.finish();
}

// ---------------- MTA ----------------
function checkMTA(s) {
  const rep = new Report('MTA – zasoby');
  const dm = path.join(s.path, 'mods', 'deathmatch');
  const conf = U.readText(path.join(dm, 'mtaserver.conf'), '');
  const startup = [...conf.matchAll(/<resource\s+src="([^"]+)"[^>]*startup="1"/g)].map(m => m[1]);
  const exeP = U.firstExisting([path.join(s.path, 'MTA Server64.exe'), path.join(s.path, 'MTA Server.exe')]);
  const serverVer = exeP ? (peVersion(exeP) || {}).file : null;
  rep.meta = { 'Wersja serwera': serverVer || '?', 'Zasoby startowe': startup.length };
  const res = new Map();
  const walk = (dir, depth) => {
    for (const e of U.listDir(dir)) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (/^\[.*\]$/.test(e.name) && depth < 4) walk(full, depth + 1); else if (U.exists(path.join(full, 'meta.xml'))) res.set(e.name, { dir: full, meta: U.readText(path.join(full, 'meta.xml'), '') }); }
      else if (/\.zip$/i.test(e.name)) { try { const z = new AdmZip(full); const m = z.getEntry('meta.xml'); res.set(e.name.replace(/\.zip$/i, ''), { dir: full, meta: m ? m.getData().toString('utf8') : '' }); } catch { res.set(e.name, { dir: full, broken: true }); } }
    }
  };
  walk(path.join(dm, 'resources'), 0);
  for (const [name, r] of res) {
    const enabled = startup.includes(name);
    rep.addMod({ key: r.dir, file: r.dir, name, version: (r.meta && (r.meta.match(/version="([^"]+)"/) || [])[1]) || '-', enabled });
    if (r.broken) { rep.error(`${name}: uszkodzone archiwum`, { mod: r.dir }); continue; }
    if (!enabled) continue;
    if (!/<meta[\s>]/i.test(r.meta)) rep.error(`${name}: nieprawidłowy meta.xml`, { mod: r.dir });
    for (const m of r.meta.matchAll(/<include\s+resource="([^"]+)"/g)) if (!res.has(m[1])) rep.error(`${name} wymaga zasobu "${m[1]}"`, { mod: r.dir });
    const minv = (r.meta.match(/<min_mta_version[^>]*server="([^"]+)"/) || [])[1];
    if (minv && serverVer && U.cmpVer(serverVer.replace(/\.0$/, ''), minv.replace(/-.*$/, '')) < 0) rep.error(`${name} wymaga serwera MTA ${minv}`, { mod: r.dir, fix: 'Zaktualizuj serwer MTA.' });
  }
  for (const st of startup) if (!res.has(st)) rep.error(`mtaserver.conf uruchamia "${st}", którego nie ma`);
  clean(rep, 'Zasoby MTA są spójne');
  return rep.finish();
}

// ---------------- TShock ----------------
function checkTShock(s) {
  const rep = new Report('TShock – pluginy');
  const api = U.firstExisting([path.join(s.path, 'ServerPlugins', 'TShockAPI.dll'), path.join(s.path, 'TShock.Server.dll')]);
  const tsv = api ? (peVersion(api) || {}).file : null;
  rep.meta = { 'TShock': tsv || s.version || '?' };
  for (const f of collect(path.join(s.path, 'ServerPlugins'), ['.dll'])) {
    const n = f.name.replace(/\.dll(\.disabled)?$/i, '');
    if (/^(TShockAPI|OTAPI|TerrariaServer)/i.test(n)) continue;
    rep.addMod({ key: f.file, file: f.file, name: n, version: (peVersion(f.file) || {}).file || '-', enabled: f.enabled, toggleable: true });
    if (!f.enabled) continue;
    const c = fileContains(f.file, ['TerrariaApi.Server', 'TShockAPI', 'OTAPI']);
    if (!c['TerrariaApi.Server'] && !c.TShockAPI) rep.warn(`${n}.dll nie odwołuje się do TerrariaServerAPI – może być biblioteką lub nie pluginem`, { mod: f.file });
  }
  const log = lastLog(path.join(s.path, 'tshock', 'logs'));
  [...log.matchAll(/(Outdated plugin[^\n]*|Plugin [^\n]* is outdated[^\n]*|failed to load[^\n]*|ApiVersion[^\n]*)/gi)].slice(-12).forEach(m => rep.error('Log: ' + m[1].slice(0, 220)));
  clean(rep, 'Brak problemów z pluginami');
  return rep.finish();
}

// ---------------- BeamMP ----------------
const BEAMNG_MAPS = ['gridmap_v2', 'automation_test_track', 'east_coast_usa', 'hirochi_raceway', 'italy', 'jungle_rock_island', 'industrial', 'small_island', 'smallgrid', 'utah', 'west_coast_usa', 'driver_training', 'derby', 'johnson_valley', 'cliff', 'east_coast_usa_v2', 'garage_v2', 'island'];
function checkBeamMP(s) {
  const rep = new Report('BeamMP – mody i pluginy');
  const raw = U.readText(path.join(s.path, 'ServerConfig.toml'));
  let cfg = {};
  if (!raw) rep.note('ServerConfig.toml jeszcze nie istnieje – powstanie przy pierwszym starcie.');
  else { try { cfg = TOML.parse(raw); } catch (e) { rep.error('ServerConfig.toml zawiera błąd składni', { detail: e.message }); } }
  const g = cfg.General || {};
  rep.meta = { 'Mapa': g.Map || '?', 'Maks. graczy': g.MaxPlayers || '?' };
  if (raw && !g.AuthKey) rep.error('Brak AuthKey', { fix: 'Wygeneruj klucz na keymaster.beammp.com i wpisz w ServerConfig.toml.' });
  const resDir = path.join(s.path, g.ResourceFolder || 'Resources');
  const clientMods = collect(path.join(resDir, 'Client'), ['.zip']);
  const levelsInMods = new Set();
  for (const z of clientMods) {
    rep.addMod({ key: z.file, file: z.file, name: z.name.replace(/\.zip(\.disabled)?$/i, ''), version: '-', enabled: z.enabled, toggleable: true, source: 'Client (mod)', size: sizeOf(z.file) });
    if (!z.enabled) continue;
    try {
      const zip = new AdmZip(z.file);
      const names = zip.getEntries().map(e => e.entryName.replace(/\\/g, '/'));
      names.filter(n => /^levels\/[^/]+\/info\.json$/i.test(n)).forEach(n => levelsInMods.add(n.split('/')[1].toLowerCase()));
      if (!names.some(n => /^(vehicles|levels|art|lua|ui|scripts|settings|gameplay|mods)\//i.test(n))) rep.warn(`${z.name}: nietypowa struktura moda (brak vehicles/, levels/ itp.)`, { mod: z.file, detail: 'Mod mógł zostać spakowany z dodatkowym folderem nadrzędnym.' });
    } catch { rep.error(`${z.name}: uszkodzone archiwum ZIP`, { mod: z.file }); }
  }
  for (const d of U.listDirs(path.join(resDir, 'Server'))) {
    const luas = U.listFiles(d, ['.lua']);
    rep.addMod({ key: d, file: d, name: path.basename(d), version: '-', enabled: true, source: 'Server (plugin Lua)' });
    if (!luas.length) rep.error(`${path.basename(d)}: plugin bez plików .lua w głównym folderze`, { mod: d });
  }
  const mapName = ((g.Map || '').match(/levels\/([^/]+)\//i) || [])[1];
  if (mapName && !BEAMNG_MAPS.includes(mapName.toLowerCase()) && !levelsInMods.has(mapName.toLowerCase())) rep.error(`Mapa "${mapName}" nie jest mapą podstawową ani nie znaleziono jej w modach Client`, { fix: 'Dodaj mod mapy do Resources/Client lub popraw Map w ServerConfig.toml.' });
  clean(rep, 'Konfiguracja BeamMP jest poprawna');
  return rep.finish();
}


// ---------------- Proxy Minecraft ----------------
function checkProxy(s) {
  const { readJar } = require('../parsers/minecraft');
  const rep = new Report(s.variant === 'velocity' ? 'Velocity – pluginy' : 'BungeeCord – pluginy');
  const want = s.variant === 'velocity' ? 'velocity' : 'bungee';
  const files = collect(path.join(s.path, 'plugins'), ['.jar']);
  const parsed = files.map(f => ({ ...f, d: readJar(f.file) }));
  const names = new Set(parsed.filter(p => p.enabled && p.d.plugin).map(p => String(p.d.plugin.name).toLowerCase()));
  rep.meta = { 'Proxy': s.variant, 'Pluginy': files.length };
  for (const p of parsed) {
    const pl = p.d.plugin;
    rep.addMod({ key: p.file, file: p.file, name: pl ? pl.name : p.name, version: pl ? pl.version : '?', enabled: p.enabled, toggleable: true, loader: pl ? pl.type : '?' });
    if (!p.enabled) continue;
    if (!pl) { rep.warn(`${p.name}: nie rozpoznano pluginu`, { mod: p.file }); continue; }
    const type = pl.type === 'bukkit' && s.variant === 'bungeecord' && !/org\.bukkit/.test(pl.main || '') ? 'bungee' : pl.type;
    if (type !== want) rep.error(`${pl.name} to plugin dla ${type === 'bukkit' || type === 'paper' ? 'serwera Paper/Spigot' : type}, nie dla ${s.variant}`, { mod: p.file, fix: s.variant === 'velocity' ? 'Pobierz wersję pluginu dla Velocity (zwykle ma osobny plik).' : 'Pobierz wersję dla BungeeCord.' });
    for (const d of pl.depend || []) if (!names.has(String(d).toLowerCase())) rep.error(`${pl.name} wymaga pluginu ${d}`, { mod: p.file });
  }
  const sec = U.readText(path.join(s.path, 'forwarding.secret'), null);
  if (s.variant === 'velocity' && sec !== null && sec.trim().length < 8) rep.warn('forwarding.secret jest pusty lub za krótki');
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Pluginy proxy są zgodne');
  return rep.finish();
}

// ---------------- Satisfactory (SML) ----------------
function checkSatisfactory(s) {
  const rep = new Report('Satisfactory – mody');
  const verFile = U.firstExisting([path.join(s.path, 'Engine', 'Binaries', 'Win64', 'FactoryServer-Win64-Shipping-Cmd.version'), path.join(s.path, 'Engine', 'Binaries', 'Linux', 'FactoryServer-Linux-Shipping.version')]);
  const build = verFile ? (U.readJSON(verFile, {}) || {}).Changelist : null;
  const modsDir = path.join(s.path, 'FactoryGame', 'Mods');
  const mods = U.listDirs(modsDir).map(d => ({ dir: d, name: path.basename(d), up: U.readJSON(path.join(d, path.basename(d) + '.uplugin')) })).filter(m => m.up);
  const by = new Map(mods.map(m => [m.name.toLowerCase(), m]));
  rep.meta = { 'Build gry': build || '?', 'Mody': mods.length, 'SML': by.has('sml') ? by.get('sml').up.SemVersion || by.get('sml').up.VersionName : 'brak' };
  if (mods.length && !by.has('sml')) rep.error('Mody wymagają Satisfactory Mod Loadera (SML), którego nie ma', { fix: 'Zainstaluj mody przez Satisfactory Mod Manager (ficsit.app) – doda SML automatycznie.' });
  for (const m of mods) {
    const up = m.up;
    rep.addMod({ key: m.dir, file: m.dir, name: up.FriendlyName || m.name, version: up.SemVersion || up.VersionName || '-', enabled: true });
    const gvReq = up.GameVersion && String(up.GameVersion).match(/>=?\s*(\d+)/);
    if (build && gvReq && +build < +gvReq[1]) rep.error(`${up.FriendlyName || m.name} wymaga nowszej wersji gry (build ${gvReq[1]}, serwer ${build})`, { mod: m.dir, fix: 'Zaktualizuj serwer (przycisk Aktualizuj).' });
    for (const d of up.Plugins || []) {
      if (!d.Name || d.bOptional || /^(SML)$/i.test(d.Name) && by.has('sml') && !d.SemVersion) continue;
      const dep = by.get(String(d.Name).toLowerCase());
      if (!dep) { if (!/^(SML|Satisfactory|FactoryGame)$/i.test(d.Name) || d.Name === 'SML') rep.error(`${up.FriendlyName || m.name} wymaga moda ${d.Name}${d.SemVersion ? ' ' + d.SemVersion : ''}`, { mod: m.dir }); continue; }
      const have = dep.up.SemVersion || dep.up.VersionName;
      const need = d.SemVersion ? String(d.SemVersion).replace(/^[\^~>=]+/, '') : null;
      if (need && have && U.cmpVer(have, need) < 0) rep.error(`${up.FriendlyName || m.name} wymaga ${d.Name} ${d.SemVersion} (masz ${have})`, { mod: m.dir });
    }
  }
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(mods.length ? 'Mody są zgodne' : 'Serwer bez modów');
  return rep.finish();
}

// ---------------- Palworld ----------------
function checkPalworld(s) {
  const rep = new Report('Palworld – mody i konfiguracja');
  const { palCfgPath } = require('./defs2');
  const cfg = U.readText(palCfgPath(s), '');
  rep.meta = { 'Konfiguracja': cfg ? 'PalWorldSettings.ini' : 'brak' };
  if (!cfg) rep.warn('Brak PalWorldSettings.ini – zostanie utworzony przy instalacji/aktualizacji');
  else {
    if (!/RCONEnabled=True/i.test(cfg)) rep.warn('RCON jest wyłączony – zdalna konsola i bezpieczne zatrzymywanie nie zadziałają', { fix: 'Ustaw RCONEnabled=True w PalWorldSettings.ini.' });
    if (/AdminPassword=""/.test(cfg)) rep.warn('Hasło admina jest puste');
    if (!/OptionSettings=\(/.test(cfg)) rep.error('PalWorldSettings.ini nie zawiera sekcji OptionSettings – gra zignoruje ustawienia');
  }
  const paks = collect(path.join(s.path, 'Pal', 'Content', 'Paks', '~mods'), ['.pak']);
  paks.forEach(p => rep.addMod({ key: p.file, file: p.file, name: p.name.replace(/\.pak(\.disabled)?$/i, ''), version: 'pak', enabled: p.enabled, toggleable: true, source: '~mods' }));
  const ue = path.join(s.path, 'Pal', 'Binaries', U.isWin ? 'Win64' : 'Linux', 'ue4ss');
  const mtxt = U.readText(path.join(ue, 'Mods', 'mods.txt'), null);
  if (mtxt !== null) {
    for (const line of mtxt.split(/\r?\n/)) {
      const m = line.match(/^\s*([^;:\s][^:]*?)\s*:\s*([01])/); if (!m) continue;
      const dir = path.join(ue, 'Mods', m[1]);
      rep.addMod({ key: dir, file: dir, name: m[1], version: 'UE4SS', enabled: m[2] === '1', source: 'UE4SS' });
      if (m[2] === '1' && !U.isDir(dir) && !/Keybinds|BPModLoader|BPML_GenericFunctions|ConsoleEnablerMod|ConsoleCommandsMod|CheatManagerEnablerMod|SplitScreenMod|LineTraceMod|jsbLuaProfilerMod|shared/i.test(m[1])) rep.error(`mods.txt włącza „${m[1]}”, ale folderu moda nie ma`, { mod: dir });
    }
  } else if (U.listDirs(path.join(ue, 'Mods')).length) rep.warn('Folder UE4SS Mods istnieje, ale brak mods.txt');
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Konfiguracja wygląda poprawnie');
  return rep.finish();
}

// ---------------- ARK ----------------
function checkArk(s) {
  const rep = new Report('ARK – mody');
  const ids = String(s.settings.mods || '').split(',').map(x => x.trim()).filter(Boolean);
  rep.meta = { 'Wydanie': s.variant === 'ase' ? 'Survival Evolved' : 'Survival Ascended', 'Mody': ids.length };
  const seen = new Set();
  for (const id of ids) {
    const dl = s.variant === 'ase' ? U.isDir(path.join(s.path, 'ShooterGame', 'Content', 'Mods', id)) : null;
    rep.addMod({ key: id, name: id, version: '-', enabled: true, source: dl === null ? 'CurseForge (pobierze serwer)' : dl ? 'Pobrany' : 'Nie pobrany' });
    if (!/^\d+$/.test(id)) rep.error(`Nieprawidłowe ID moda „${id}”`, { mod: id, fix: 'ID moda to liczba z adresu strony moda (CurseForge dla ASA, Warsztat dla ASE).' });
    if (seen.has(id)) rep.error(`Mod ${id} jest na liście dwukrotnie`, { mod: id }); seen.add(id);
    if (dl === false) rep.warn(`Mod ${id} nie jest pobrany na serwer`, { mod: id, detail: 'Serwer ASE nie pobiera modów sam – użyj SteamCMD (workshop_download_item 346110) lub dodaj -automanagedmods.' });
  }
  const gus = U.readText(path.join(s.path, 'ShooterGame', 'Saved', 'Config', U.isWin ? 'WindowsServer' : 'LinuxServer', 'GameUserSettings.ini'), '');
  if (/ActiveMods=/.test(gus) && ids.length) rep.note('GameUserSettings.ini zawiera też ActiveMods – parametr startowy ma pierwszeństwo.');
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Lista modów jest poprawna');
  return rep.finish();
}

// ---------------- Enshrouded ----------------
function checkEnshrouded(s) {
  const rep = new Report('Enshrouded – konfiguracja');
  const raw = U.readText(path.join(s.path, 'enshrouded_server.json'));
  if (!raw) { rep.warn('Brak enshrouded_server.json – powstanie przy pierwszym uruchomieniu'); return rep.finish(); }
  let j; try { j = JSON.parse(raw); } catch (e) { rep.error('enshrouded_server.json zawiera błąd składni', { detail: e.message }); return rep.finish(); }
  rep.meta = { 'Nazwa': j.name || '?', 'Sloty': j.slotCount };
  if (+j.slotCount > 16) rep.error('Maksymalna liczba slotów to 16');
  if (j.userGroups && j.userGroups.some(g => !g.password)) rep.warn('Któraś grupa użytkowników nie ma hasła – każdy może dołączyć z jej uprawnieniami');
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Konfiguracja jest poprawna');
  return rep.finish();
}

// ---------------- Space Engineers ----------------
function checkSpaceEngineers(s) {
  const rep = new Report('Space Engineers – mody');
  const cfg = U.readText(path.join(s.path, 'Instance', 'SpaceEngineers-Dedicated.cfg'), '');
  if (!cfg) { rep.note('Brak konfiguracji – uruchom serwer, aby otworzyć konfigurator i utworzyć świat.'); return rep.finish(); }
  const items = [...cfg.matchAll(/<ModItem[^>]*FriendlyName="([^"]*)"[^>]*>[\s\S]*?<PublishedFileId>(\d+)<\/PublishedFileId>[\s\S]*?<\/ModItem>/g)].map(m => ({ name: m[1], id: m[2] }));
  const content = path.join(s.path, 'Instance', 'content', '244850');
  rep.meta = { 'Mody w konfiguracji': items.length };
  const seen = new Set();
  for (const it of items) {
    const dl = U.isDir(path.join(content, it.id));
    rep.addMod({ key: it.id, name: it.name || it.id, version: '#' + it.id, enabled: true, source: dl ? 'Pobrany' : 'Pobierze się przy starcie' });
    if (seen.has(it.id)) rep.error(`Mod ${it.name || it.id} występuje dwukrotnie`, { mod: it.id }); seen.add(it.id);
  }
  if (/<LoadWorld\s*\/>|<LoadWorld><\/LoadWorld>/.test(cfg) && !/<PremadeCheckpointPath>[^<]+</.test(cfg)) rep.warn('Konfiguracja nie wskazuje świata do wczytania', { fix: 'Otwórz konfigurator (uruchom serwer po usunięciu -console) i wybierz lub utwórz świat.' });
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Konfiguracja modów jest poprawna');
  return rep.finish();
}

// ---------------- dyspozytor ----------------
function check(server) {
  switch (server.type) {
    case 'minecraft': {
      if (['paper', 'purpur'].includes(server.variant)) return mc.checkPlugins({ pluginsDir: path.join(server.path, 'plugins'), mcVersion: server.version, loader: server.variant, title: server.name });
      if (server.variant === 'vanilla') { const r = new Report(server.name); r.note('Serwer vanilla nie obsługuje modów ani pluginów.'); return r.finish(); }
      return mc.checkMods({ modsDir: path.join(server.path, 'mods'), mcVersion: server.version, loader: server.variant, loaderVersion: server.loaderVersion, side: 'server', title: server.name });
    }
    case 'rust': return checkRust(server);
    case 'cs2': return checkCS2(server);
    case 'tf2': return checkSourceMod(server);
    case 'dayz': return checkDayZ(server);
    case 'armareforger': return checkArma(server);
    case 'projectzomboid': return checkPZServer(server);
    case 'fivem': return checkFiveM(server);
    case 'mta': return checkMTA(server);
    case 'terraria': return checkTShock(server);
    case 'beammp': return checkBeamMP(server);
    case 'valheim': return unity.checkBepInEx({ root: server.path, title: 'Valheim – mody BepInEx', profileName: 'Folder gry', expectMajor: 5 });
    case 'mcproxy': return checkProxy(server);
    case 'satisfactory': return checkSatisfactory(server);
    case 'palworld': return checkPalworld(server);
    case 'ark': return checkArk(server);
    case 'enshrouded': return checkEnshrouded(server);
    case 'spaceengineers': return checkSpaceEngineers(server);
  }
  const r = new Report(server.name); r.note('Brak sprawdzania dla tego typu serwera.'); return r.finish();
}

async function online(server) {
  if (server.type === 'cs2') return cs2Online(server);
  if (server.type === 'valheim') return unity.thunderstoreOnline({ root: server.path });
  if (server.type === 'minecraft' && !['paper', 'purpur', 'vanilla'].includes(server.variant)) return mc.modrinthCheck({ modsDir: path.join(server.path, 'mods'), mcVersion: server.version, loader: server.variant });
  return [{ level: 'info', title: 'Sprawdzanie online nie jest dostępne dla tego serwera.' }];
}

module.exports = { check, online };
