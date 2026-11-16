// Checkery: Cyberpunk 2077, Wiedźmin 3, PAYDAY 2, My Summer Car, Teardown, S.T.A.L.K.E.R. (X-Ray)
// oraz lista modów dla gier bez sprawdzania zgodności (instalacja ręczna)
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const { peVersion, fileContains } = require('../parsers/binary');
const { Report, collect, sizeOf } = require('./common');

const clean = (rep, msg) => { if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(msg); };
const lastFile = (dir, re) => U.listFiles(dir).filter(f => !re || re.test(path.basename(f))).map(f => ({ f, t: fs.statSync(f).mtimeMs })).sort((a, b) => b.t - a.t).map(x => x.f)[0];
const lenient = t => { try { return JSON.parse(t); } catch { try { return JSON.parse(t.replace(/\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); } catch { return null; } } };
const logLines = (file, re, max = 15) => (file ? U.readText(file, '') : '').split(/\r?\n/).filter(l => re.test(l)).slice(-max);

// =============== Gry bez sprawdzania zgodności ===============
function resolveDir(d, ctx) {
  if (d === 'workshop') return ctx.workshop || [];
  let p = d.replace('%LOCALAPPDATA%', U.localAppData()).replace('%LOCALLOW%', path.join(U.home(), 'AppData', 'LocalLow')).replace('%DOCUMENTS%', U.documents());
  return [path.isAbsolute(p) ? p : path.join(ctx.gamePath, p)];
}
function manualDirs(game, ctx) { return (game.manual.dirs || []).flatMap(d => resolveDir(d, ctx)); }

function checkFiles(ctx) {
  const g = ctx.game; const m = g.manual || { dirs: [], kind: 'registry' };
  const rep = new Report(g.name);
  rep.meta = { 'Sprawdzanie zgodności': 'niedostępne dla tej gry', 'Instalacja': g.nexus ? 'z Nexus Mods lub ręcznie' : 'ręcznie / Warsztat Steam' };
  const dirs = manualDirs(g, ctx);
  if (dirs.length) rep.meta['Folder modów'] = dirs.filter(d => !(ctx.workshop || []).includes(d)).join(', ') || 'Warsztat Steam';
  for (const dir of dirs) {
    const isWs = (ctx.workshop || []).includes(dir);
    if (m.kind === 'pak') {
      // grupy plików: nazwa.pak + .ucas + .utoc + .sig
      const groups = new Map();
      for (const f of collect(dir, ['.pak', '.ucas', '.utoc', '.sig'])) {
        const base = f.name.replace(/\.disabled$/i, '').replace(/\.(pak|ucas|utoc|sig)$/i, '');
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base).push(f);
      }
      for (const [base, files] of groups) {
        const enabled = files.every(f => f.enabled);
        rep.addMod({ key: path.join(dir, base), file: path.join(dir, base), name: base.replace(/_P$/, ''), version: files.map(f => path.extname(f.name.replace(/\.disabled$/i, '')).slice(1)).join('+'), enabled, toggleable: true, toggle: 'group', files: files.map(f => f.file), size: files.reduce((a, f) => a + sizeOf(f.file), 0), source: '~mods' });
      }
    } else if (m.kind === 'folders' || m.kind === 'any') {
      for (const e of U.listDir(dir)) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        rep.addMod({ key: full, file: full, name: isWs ? `Warsztat #${e.name}` : e.name.replace(/\.disabled$/i, ''), version: '-', enabled: !/\.disabled$/i.test(e.name), toggleable: !m.readOnly && !isWs && e.isFile(), source: isWs ? 'Warsztat Steam' : 'Folder modów', size: e.isFile() ? sizeOf(full) : undefined });
      }
    }
  }
  for (const r of ctx.nexusInstalls || []) {
    if (rep.mods.some(x => (r.paths || []).includes(x.file))) continue;
    rep.addMod({ key: 'nexus-' + r.modId, name: r.name, version: r.version || '-', enabled: true, source: 'Nexus Mods (CodeManager)', files: r.paths });
  }
  rep.note('Dla tej gry CodeManager nie sprawdza zgodności modów – możesz je instalować, włączać i wyłączać ręcznie.', { detail: g.nexus ? 'Mody z Nexus Mods zainstalujesz w zakładce „Pobierz mody”.' : null });
  return rep.finish();
}

// =============== Cyberpunk 2077 ===============
function checkCyberpunk(ctx) {
  const rep = new Report('Cyberpunk 2077');
  const g = ctx.gamePath;
  const exe = path.join(g, 'bin', 'x64', 'Cyberpunk2077.exe');
  const gv = U.exists(exe) ? (peVersion(exe) || {}).product : null;
  const FW = {
    cet: { name: 'Cyber Engine Tweaks', ok: U.exists(path.join(g, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks.asi')) },
    red4ext: { name: 'RED4ext', ok: U.exists(path.join(g, 'red4ext', 'RED4ext.dll')) && U.exists(path.join(g, 'bin', 'x64', 'winmm.dll')) },
    redscript: { name: 'redscript', ok: U.exists(path.join(g, 'engine', 'config', 'base', 'scripts.ini')) || U.exists(path.join(g, 'engine', 'tools', 'scc.exe')) },
    tweakxl: { name: 'TweakXL', ok: U.isDir(path.join(g, 'red4ext', 'plugins', 'TweakXL')) },
    archivexl: { name: 'ArchiveXL', ok: U.isDir(path.join(g, 'red4ext', 'plugins', 'ArchiveXL')) },
    codeware: { name: 'Codeware', ok: U.isDir(path.join(g, 'red4ext', 'plugins', 'Codeware')) },
    redmod: { name: 'REDmod (darmowe DLC)', ok: U.exists(path.join(g, 'tools', 'redmod', 'bin', 'redMod.exe')) },
  };
  rep.meta = { 'Wersja gry': gv || 'nieznana', 'Frameworki': Object.values(FW).filter(f => f.ok).map(f => f.name).join(', ') || 'brak' };
  const need = new Map(); // framework -> [mody]
  const req = (fw, who) => { if (!need.has(fw)) need.set(fw, new Set()); need.get(fw).add(who); };
  // .archive i .xl
  const archDir = path.join(g, 'archive', 'pc', 'mod');
  for (const f of collect(archDir, ['.archive', '.xl'])) {
    const n = f.name.replace(/\.disabled$/i, '');
    if (/\.xl$/i.test(n)) { req('archivexl', n); continue; }
    rep.addMod({ key: f.file, file: f.file, name: n.replace(/\.archive$/i, ''), version: 'archive', enabled: f.enabled, toggleable: true, source: 'archive/pc/mod', size: sizeOf(f.file) });
  }
  // CET
  for (const d of U.listDirs(path.join(g, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods'))) {
    rep.addMod({ key: d, file: d, name: path.basename(d), version: 'CET', enabled: U.exists(path.join(d, 'init.lua')), source: 'Cyber Engine Tweaks' });
    req('cet', path.basename(d));
    if (!U.exists(path.join(d, 'init.lua'))) rep.warn(`${path.basename(d)}: brak init.lua – mod CET się nie uruchomi`, { mod: d });
  }
  // RED4ext
  for (const d of U.listDirs(path.join(g, 'red4ext', 'plugins'))) {
    const n = path.basename(d);
    rep.addMod({ key: d, file: d, name: n, version: (peVersion(U.listFiles(d, ['.dll'])[0] || '') || {}).file || 'RED4ext', enabled: true, source: 'RED4ext' });
    req('red4ext', n);
  }
  // redscript
  const reds = U.walk(path.join(g, 'r6', 'scripts'), { filter: r => /\.reds$/i.test(r), maxFiles: 5000 });
  const redsMods = new Map();
  for (const r of reds) { const top = r.split('/')[0]; redsMods.set(top, [...(redsMods.get(top) || []), r]); }
  for (const [top, files] of redsMods) {
    const full = path.join(g, 'r6', 'scripts', top);
    rep.addMod({ key: full, file: full, name: top.replace(/\.reds$/i, ''), version: 'redscript', enabled: true, source: 'r6/scripts' });
    req('redscript', top);
    for (const f of files.slice(0, 50)) { const t = U.readText(path.join(g, 'r6', 'scripts', f), ''); if (/import\s+Codeware|Codeware\./.test(t)) { req('codeware', top); break; } }
  }
  // TweakXL
  const tweaks = U.walk(path.join(g, 'r6', 'tweaks'), { filter: r => /\.(ya?ml|tweak)$/i.test(r), maxFiles: 5000 });
  const tweakMods = new Set(tweaks.map(r => r.split('/')[0]));
  for (const t of tweakMods) { rep.addMod({ key: path.join(g, 'r6', 'tweaks', t), file: path.join(g, 'r6', 'tweaks', t), name: t, version: 'TweakXL', enabled: true, source: 'r6/tweaks' }); req('tweakxl', t); }
  // REDmod
  for (const d of U.listDirs(path.join(g, 'mods'))) {
    const info = U.readJSON(path.join(d, 'info.json'));
    rep.addMod({ key: d, file: d, name: (info && info.name) || path.basename(d), version: (info && info.version) || '-', enabled: true, source: 'REDmod' });
    req('redmod', (info && info.name) || path.basename(d));
    if (!info) rep.error(`${path.basename(d)}: brak info.json – REDmod go nie wczyta`, { mod: d });
  }
  // zależności frameworków między sobą
  if (need.has('tweakxl') || need.has('archivexl') || need.has('codeware')) req('red4ext', 'TweakXL/ArchiveXL/Codeware');
  if (need.has('codeware')) req('redscript', 'Codeware');
  for (const [fw, who] of need) {
    if (FW[fw].ok) continue;
    const list = [...who];
    rep.error(`Brakuje ${FW[fw].name}, którego wymagają: ${list.slice(0, 5).join(', ')}${list.length > 5 ? ` i ${list.length - 5} innych` : ''}`, { fix: fw === 'redmod' ? 'Zainstaluj darmowe DLC „REDmod” w Steam / GOG / Epic.' : `Zainstaluj ${FW[fw].name} (Nexus Mods) w wersji zgodnej z Twoją wersją gry.`, files: list.length > 5 ? list : null });
  }
  // logi frameworków
  const logs = [
    ['RED4ext', lastFile(path.join(g, 'red4ext', 'logs'))],
    ['CET', path.join(g, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'cyber_engine_tweaks.log')],
    ['redscript', lastFile(path.join(g, 'r6', 'logs'), /redscript/i)],
  ];
  for (const [n, f] of logs) for (const l of logLines(f, /\[(error|critical)\]|ERROR|failed to|not compatible|unsupported game version|incompatible/i, 8)) rep.warn(`Log ${n}: ${l.trim().slice(0, 220)}`);
  if (logs.some(([, f]) => /not compatible|unsupported game version/i.test(f ? U.readText(f, '') : ''))) rep.error('Framework nie obsługuje Twojej wersji gry (zwykle po aktualizacji Cyberpunka)', { fix: 'Zaktualizuj RED4ext, CET, redscript i zależne mody do wersji dla aktualnej gry.' });
  clean(rep, 'Wszystkie wymagane frameworki są zainstalowane');
  return rep.finish();
}

// =============== Wiedźmin 3 ===============
function w3SettingsPath() { return path.join(U.documents(), 'The Witcher 3', 'mods.settings'); }
function w3Settings() {
  const t = U.readText(w3SettingsPath(), '');
  const out = {}; let cur = null;
  for (const l of t.split(/\r?\n/)) {
    const s = l.match(/^\[(.+)\]$/); if (s) { cur = out[s[1]] = {}; continue; }
    const kv = l.match(/^(\w+)\s*=\s*(.*)$/); if (kv && cur) cur[kv[1]] = kv[2].trim();
  }
  return out;
}
function checkWitcher3(ctx) {
  const rep = new Report('Wiedźmin 3');
  const g = ctx.gamePath;
  const exe = U.firstExisting([path.join(g, 'bin', 'x64', 'witcher3.exe'), path.join(g, 'bin', 'x64_dx12', 'witcher3.exe')]);
  const gv = exe ? (peVersion(exe) || {}).product : null;
  const nextgen = gv ? +gv.split('.')[0] >= 4 : U.isDir(path.join(g, 'bin', 'x64_dx12'));
  rep.meta = { 'Wersja gry': gv ? `${gv} (${nextgen ? 'next-gen' : 'klasyczna'})` : (nextgen ? 'next-gen' : 'nieznana') };
  const settings = w3Settings();
  const modsDir = path.join(g, 'Mods');
  const mods = U.listDirs(modsDir);
  const owners = new Map();
  const merged = mods.find(d => /^mod0000_MergedFiles$/i.test(path.basename(d)));
  const mergedScripts = new Set(merged ? U.walk(path.join(merged, 'content', 'scripts'), { filter: r => /\.ws$/i.test(r) }).map(r => r.toLowerCase()) : []);
  for (const d of mods) {
    const n = path.basename(d);
    const st = settings[n] || {};
    const enabled = st.Enabled !== '0' && !n.startsWith('~');
    rep.addMod({ key: d, file: d, id: n, name: n.replace(/^mod/i, ''), version: st.Priority ? `priorytet ${st.Priority}` : '-', enabled, toggleable: true, toggle: 'w3settings', source: 'Mods' });
    if (!enabled) continue;
    if (!/^mod/i.test(n) && !n.startsWith('~')) rep.warn(`Folder „${n}” nie zaczyna się od „mod” – gra go zignoruje`, { mod: d, fix: `Zmień nazwę na mod${n}.` });
    if (!U.isDir(path.join(d, 'content')) && !U.isDir(path.join(d, 'Content'))) rep.error(`${n}: brak folderu content – mod jest źle rozpakowany`, { mod: d, fix: 'Mod powinien mieć strukturę Mods/modNazwa/content/…' });
    if (n === path.basename(merged || '')) continue;
    for (const r of U.walk(path.join(d, 'content', 'scripts'), { filter: f => /\.ws$/i.test(f), maxFiles: 3000 })) {
      const k = r.toLowerCase(); owners.set(k, [...(owners.get(k) || []), n]);
    }
  }
  const conflicts = [...owners].filter(([k, o]) => o.length > 1 && !mergedScripts.has(k));
  if (conflicts.length) {
    const pairs = new Map(); for (const [f, o] of conflicts) { const key = o.join(' ↔ '); pairs.set(key, [...(pairs.get(key) || []), f]); }
    for (const [pair, files] of pairs) rep.error(`Konflikt skryptów: ${pair}`, { files: files.slice(0, 20), detail: `${files.length} wspólnych plików .ws – zadziała tylko jeden mod, drugi może psuć grę.`, fix: 'Połącz skrypty programem Script Merger (Nexus Mods) albo ustaw priorytety w mods.settings.' });
  }
  if (merged) rep.note('Wykryto mod0000_MergedFiles (Script Merger) – połączone pliki nie są zgłaszane jako konflikty.');
  for (const d of U.listDirs(path.join(g, 'dlc'))) { const n = path.basename(d); if (/^dlc\d+$|^bob$|^ep1$/i.test(n)) continue; if (!U.isDir(path.join(d, 'content'))) rep.warn(`dlc/${n}: brak folderu content`, { detail: 'Niektóre mody wymagają części w folderze dlc – mogła zostać źle rozpakowana.' }); }
  const bundles = new Map();
  for (const d of mods) for (const f of U.listFiles(path.join(d, 'content'), ['.bundle'])) { const b = path.basename(f).toLowerCase(); bundles.set(b, [...(bundles.get(b) || []), path.basename(d)]); }
  if (mods.length > 1) rep.note('Konflikty plików .bundle (tekstury, modele) nie są wykrywane – w razie problemów użyj trybu „bundle” w Script Merger.');
  clean(rep, 'Brak konfliktów skryptów');
  return rep.finish();
}
function w3Toggle(name, enable) {
  const f = w3SettingsPath();
  let t = U.readText(f, '');
  const sec = new RegExp(`\\[${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\r?\\n([^\\[]*)`);
  if (sec.test(t)) t = t.replace(sec, (m, body) => `[${name}]\r\n` + (/Enabled=/.test(body) ? body.replace(/Enabled=\d/, `Enabled=${enable ? 1 : 0}`) : `Enabled=${enable ? 1 : 0}\r\n` + body));
  else t += `${t && !t.endsWith('\n') ? '\r\n' : ''}[${name}]\r\nEnabled=${enable ? 1 : 0}\r\nPriority=\r\n\r\n`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (U.exists(f)) fs.copyFileSync(f, f + '.bak');
  fs.writeFileSync(f, t);
}

// =============== PAYDAY 2 (SuperBLT / BeardLib) ===============
function checkPayday2(ctx) {
  const rep = new Report('PAYDAY 2');
  const g = ctx.gamePath;
  const blt = ['WSOCK32.dll', 'IPHLPAPI.dll'].find(f => U.exists(path.join(g, f)));
  const modsDir = path.join(g, 'mods');
  const beard = U.isDir(path.join(modsDir, 'BeardLib'));
  const bltData = lenient(U.readText(path.join(modsDir, 'saves', 'blt_data.txt'), '') || '') || {};
  const disabled = new Set(Object.entries((bltData.mods) || {}).filter(([, v]) => v && v.enabled === false).map(([k]) => k.toLowerCase()));
  rep.meta = { 'SuperBLT': blt ? `tak (${blt})` : 'brak', 'BeardLib': beard ? 'tak' : 'brak' };
  const names = new Map();
  let needBeard = [];
  for (const d of U.listDirs(modsDir)) {
    const n = path.basename(d);
    if (['base', 'logs', 'saves', 'downloads'].includes(n.toLowerCase())) continue;
    const raw = U.readText(path.join(d, 'mod.txt'));
    const xml = U.exists(path.join(d, 'main.xml')) || U.exists(path.join(d, 'supermod.xml'));
    const info = raw ? lenient(raw) : null;
    const enabled = !disabled.has(n.toLowerCase());
    rep.addMod({ key: d, file: d, name: (info && info.name) || n, version: (info && String(info.version || '')) || (xml ? 'BeardLib' : '-'), enabled, source: 'mods/' });
    if (!enabled) continue;
    if (raw && !info) rep.error(`${n}: mod.txt zawiera błąd składni JSON`, { mod: d, fix: 'Otwórz plik w edytorze – błąd zostanie podświetlony. Często winny jest brakujący przecinek.' });
    if (!raw && !xml) rep.error(`${n}: brak mod.txt i main.xml – folder nie jest modem lub jest o poziom za głęboko`, { mod: d });
    if (xml && n.toLowerCase() !== 'beardlib') needBeard.push(n);
    if (info && info.blt_version !== undefined && +info.blt_version < 2 && blt === 'IPHLPAPI.dll') rep.warn(`${info.name}: mod dla starego BLT (blt_version ${info.blt_version})`, { mod: d });
    const key = String((info && info.name) || n).toLowerCase(); names.set(key, [...(names.get(key) || []), n]);
  }
  for (const d of U.listDirs(path.join(g, 'assets', 'mod_overrides'))) rep.addMod({ key: d, file: d, name: path.basename(d), version: 'override', enabled: true, source: 'assets/mod_overrides' });
  if (!blt && rep.mods.some(m => m.source === 'mods/')) rep.error('Brak SuperBLT – mody z folderu mods nie zostaną wczytane', { fix: 'Pobierz SuperBLT (superblt.znix.xyz) i umieść WSOCK32.dll w folderze gry.', action: { type: 'open', url: 'https://superblt.znix.xyz/', label: 'Otwórz stronę SuperBLT' } });
  if (needBeard.length && !beard) rep.error(`Brak BeardLib, którego wymagają: ${needBeard.slice(0, 5).join(', ')}`, { fix: 'Zainstaluj BeardLib (modworkshop.net) do folderu mods.' });
  if (U.isDir(path.join(g, 'assets', 'mod_overrides')) && !beard && !blt) rep.note('Folder mod_overrides działa bez dodatków, ale wiele modów wymaga BeardLib.');
  for (const [n, l] of names) if (l.length > 1) rep.error(`Mod „${n}” jest zainstalowany ${l.length}×`, { files: l });
  for (const l of logLines(lastFile(path.join(modsDir, 'logs')), /\[LUA\].*(error|attempt to)|Error loading|mod.txt/i, 10)) rep.warn('Log BLT: ' + l.trim().slice(0, 220));
  clean(rep, 'Mody PAYDAY 2 wyglądają poprawnie');
  return rep.finish();
}

// =============== My Summer Car (MSCLoader) ===============
function checkMySummerCar(ctx) {
  const rep = new Report('My Summer Car');
  const g = ctx.gamePath;
  const loader = path.join(g, 'mysummercar_Data', 'Managed', 'MSCLoader.dll');
  const lv = U.exists(loader) ? (peVersion(loader) || {}).file : null;
  rep.meta = { 'MSCLoader': U.exists(loader) ? (lv || 'zainstalowany') : 'brak' };
  const modsDir = path.join(g, 'Mods');
  const refs = new Set(U.listFiles(path.join(modsDir, 'References'), ['.dll']).map(f => path.basename(f).toLowerCase()));
  const files = collect(modsDir, ['.dll']);
  if (files.length && !U.exists(loader)) rep.error('MSCLoader nie jest zainstalowany', { fix: 'Pobierz instalator MSCLoader (GitHub: piotrulos/MSCModLoader) i wskaż folder gry.', action: { type: 'open', url: 'https://github.com/piotrulos/MSCModLoader/releases', label: 'Pobierz MSCLoader' } });
  for (const f of files) {
    const n = f.name.replace(/\.dll(\.disabled)?$/i, '');
    rep.addMod({ key: f.file, file: f.file, name: n, version: (peVersion(f.file) || {}).file || '-', enabled: f.enabled, toggleable: true, source: 'Mods', size: sizeOf(f.file) });
    if (!f.enabled) continue;
    const c = fileContains(f.file, ['MSCLoader', 'BepInEx', 'MelonLoader']);
    if (c.BepInEx && !c.MSCLoader) rep.error(`${n} to plugin BepInEx, nie mod MSCLoader`, { mod: f.file });
    else if (!c.MSCLoader) rep.warn(`${n}.dll nie jest modem MSCLoader – to prawdopodobnie biblioteka`, { mod: f.file, fix: 'Biblioteki (References) przenieś do Mods/References.' });
    if (refs.has(f.name.toLowerCase())) rep.error(`${n}.dll jest jednocześnie w Mods i Mods/References`, { mod: f.file, fix: 'Usuń kopię z folderu Mods.' });
  }
  for (const l of logLines(U.firstExisting([path.join(g, 'mysummercar_Data', 'output_log.txt'), path.join(U.home(), 'AppData', 'LocalLow', 'Amistech', 'My Summer Car', 'output_log.txt'), path.join(U.home(), 'AppData', 'LocalLow', 'Amistech', 'My Summer Car', 'Player.log')]), /MSCLoader.*(error|failed)|Mod .* (failed|crashed)|Exception/i, 10)) rep.warn('Log: ' + l.trim().slice(0, 220));
  clean(rep, 'Mody MSCLoader są we właściwych miejscach');
  return rep.finish();
}

// =============== Teardown ===============
function checkTeardown(ctx) {
  const rep = new Report('Teardown');
  const local = path.join(U.documents(), 'Teardown', 'mods');
  const sources = [{ dir: local, source: 'Lokalny' }, ...(ctx.workshop || []).map(w => ({ dir: w, source: 'Warsztat' }))];
  rep.meta = { 'Folder modów': local };
  const names = new Map();
  for (const { dir, source } of sources) for (const d of U.listDirs(dir)) {
    const t = U.readText(path.join(d, 'info.txt'));
    const info = {}; (t || '').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([\w ]+?)\s*=\s*(.*)$/); if (m) info[m[1].toLowerCase()] = m[2].trim(); });
    const name = info.name || path.basename(d);
    rep.addMod({ key: d, file: d, name, version: info.version || '-', enabled: true, source: source === 'Warsztat' ? `Warsztat #${path.basename(d)}` : source, author: info.author });
    if (!t) { rep.error(`${path.basename(d)}: brak info.txt`, { mod: d, fix: 'Mod jest niekompletny albo rozpakowany o poziom za głęboko.' }); continue; }
    if (!U.exists(path.join(d, 'main.lua')) && !U.exists(path.join(d, 'main.xml')) && !U.walk(d, { maxDepth: 1, filter: r => /\.(xml|lua)$/i.test(r) }).length) rep.warn(`${name}: brak main.lua / main.xml`, { mod: d, detail: 'Mod może nie mieć nic do uruchomienia.' });
    const k = name.toLowerCase(); names.set(k, [...(names.get(k) || []), `${source}: ${path.basename(d)}`]);
  }
  for (const [n, l] of names) if (l.length > 1) rep.warn(`Mod „${n}” jest zainstalowany ${l.length}× (lokalnie i z Warsztatu)`, { files: l });
  clean(rep, 'Mody wyglądają poprawnie');
  return rep.finish();
}

// =============== S.T.A.L.K.E.R. (X-Ray) ===============
function checkXray(ctx) {
  const rep = new Report(ctx.game.name);
  const g = ctx.gamePath;
  const ltx = path.join(g, 'fsgame.ltx');
  const t = U.readText(ltx, '');
  const line = (t.match(/^\s*\$game_data\$\s*=\s*([^\r\n]+)/m) || [])[1];
  const gamedata = path.join(g, 'gamedata');
  const hasData = U.isDir(gamedata) && U.listDir(gamedata).length > 0;
  rep.meta = { 'gamedata': hasData ? 'zawiera mody' : 'brak / pusty', 'fsgame.ltx': t ? 'znaleziony' : 'brak' };
  if (!t) rep.warn('Brak pliku fsgame.ltx w folderze gry – sprawdź lokalizację gry');
  else if (line && ctx.game.id === 'stalkersoc' && /^\s*false\s*\|/i.test(line) && hasData) {
    rep.error('Gra nie wczyta modów z folderu gamedata (fsgame.ltx: $game_data$ = false)', { fix: 'Zmień w fsgame.ltx pierwszy parametr $game_data$ z false na true.', action: { type: 'patch-fsgame', file: ltx, label: 'Popraw fsgame.ltx' } });
  }
  for (const d of U.listDir(gamedata)) {
    const full = path.join(gamedata, d.name);
    rep.addMod({ key: full, file: full, name: `gamedata/${d.name}`, version: '-', enabled: true, source: 'gamedata', size: d.isFile() ? sizeOf(full) : undefined });
  }
  for (const f of U.listFiles(g).filter(x => /\.(db\w*|xdb\w*)$/i.test(x) && !/^(gamedata\.db[0-9a-z]?|resources\.db\w*)$/i.test(path.basename(x)))) rep.note(`Dodatkowe archiwum: ${path.basename(f)}`);
  rep.note('Mody S.T.A.L.K.E.R. nadpisują pliki w gamedata – przy kilku modach naraz nowszy nadpisuje starszy. Sprawdź wymagania modów (wersja łatki 1.0006 / 1.5.10 / 1.6.02).');
  clean(rep, hasData ? 'Ustawienia pozwalają wczytać mody' : 'Brak zainstalowanych modów');
  return rep.finish();
}
function patchFsgame(file) {
  const t = U.readText(file);
  fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(file, t.replace(/^(\s*\$game_data\$\s*=\s*)false(\s*\|)/m, '$1true$2'));
}

module.exports = { checkFiles, checkCyberpunk, checkWitcher3, w3Toggle, checkPayday2, checkMySummerCar, checkTeardown, checkXray, patchFsgame, manualDirs };
