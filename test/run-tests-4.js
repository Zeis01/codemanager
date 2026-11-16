// Testy motywów i ikon (node test/run-tests-4.js)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test4-'));
let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);

// Themes (kod interfejsu) uruchamiany w piaskownicy
const ctx = { window: {}, document: { documentElement: { style: { setProperty() {}, removeProperty() {} }, dataset: {} } }, localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js/themes.js'), 'utf8'), ctx);
const Themes = ctx.window.Themes;

t('motyw domyślny to Klasyczny (szare tło, zielony akcent)', () => { const c = Themes.BUILTIN.classic.colors; assert.strictEqual(Themes.BUILTIN.classic.name, 'Klasyczny'); assert(/^#2[0-9a-f]{5}$/i.test(c.bg1)); assert.strictEqual(c.accent, '#4cb877'); });
t('wszystkie motywy wbudowane mają komplet kolorów', () => { const keys = Object.keys(Themes.BUILTIN.classic.colors); for (const [k, th] of Object.entries(Themes.BUILTIN)) for (const key of keys) assert(Themes.validColor(th.colors[key]), `${k}.${key}`); });
t('plik motywu: dziedziczenie i częściowe kolory', () => { const r = Themes.resolve({ name: 'Czerwony', extends: 'graphite', colors: { accent: '#e2574c' } }); assert.strictEqual(r.colors.accent, '#e2574c'); assert.strictEqual(r.colors.bg1, Themes.BUILTIN.graphite.colors.bg1); assert.strictEqual(r.warnings.length, 0); });
t('plik motywu: nieprawidłowe wartości są pomijane z ostrzeżeniem', () => { const r = Themes.resolve({ colors: { accent: 'czerwony', foo: '#fff', bg1: 'rgb(10, 20, 30)' }, extends: 'nieznany' }); assert.strictEqual(r.colors.accent, Themes.BUILTIN.classic.colors.accent); assert.strictEqual(r.colors.bg1, 'rgb(10, 20, 30)'); assert.strictEqual(r.warnings.length, 3); });
t('jasny motyw bez extends bazuje na „Jasnym”', () => { const r = Themes.resolve({ type: 'light', colors: {} }); assert.strictEqual(r.colors.bg1, Themes.BUILTIN.light.colors.bg1); });

const { ThemeStore } = require('../src/main/themes');
t('folder motywów: przykład, komentarze, błędne pliki', () => {
  const s = new ThemeStore(root, () => {});
  fs.writeFileSync(path.join(s.dir, 'red.theme.json'), '{\n  // mój motyw\n  "name": "Red", "colors": { "accent": "#ff0000", },\n}');
  fs.writeFileSync(path.join(s.dir, 'zly.theme.json'), '{ to nie json');
  const l = s.list();
  assert(l.find(x => x.file === 'czerwony.theme.json').theme);
  assert.strictEqual(l.find(x => x.file === 'red.theme.json').theme.colors.accent, '#ff0000');
  assert(l.find(x => x.file === 'zly.theme.json').error);
  assert(fs.existsSync(path.join(s.dir, 'README.txt')));
  const saved = s.save('Mój motyw', { name: 'x', colors: {} });
  assert(/moj-motyw|m.j-motyw/.test(saved.id) || /\.theme\.json$/.test(saved.id));
});

const { Icons } = require('../src/main/icons');
t('ikony: pamięć podręczna biblioteki Steam (stary i nowy układ)', async () => {
  const steam = path.join(root, 'Steam'); const lc = path.join(steam, 'appcache', 'librarycache');
  fs.mkdirSync(path.join(lc, '1966720', 'abc'), { recursive: true });
  fs.writeFileSync(path.join(lc, '1966720', 'a'.repeat(40) + '.jpg'), 'x'); fs.writeFileSync(path.join(lc, '1966720', 'header.jpg'), 'x'); fs.writeFileSync(path.join(lc, '1966720', 'abc', 'library_600x900.jpg'), 'x');
  fs.writeFileSync(path.join(lc, '4000_icon.jpg'), 'x'); fs.writeFileSync(path.join(lc, '4000_header.jpg'), 'x');
  const ic = new Icons({ app: { getFileIcon: async () => null }, userData: root, getSteamRoots: () => [steam] });
  const a = ic.steamLocal(1966720); assert(/a{40}\.jpg$/.test(a.icon)); assert(/header\.jpg$/.test(a.header)); assert(/library_600x900/.test(a.cover));
  const b = ic.steamLocal(4000); assert(/4000_icon\.jpg$/.test(b.icon));
  const r = await ic.forGame({ id: 'lethalcompany', appIds: [1966720] }, { found: true, appid: 1966720, path: root }, { online: false });
  assert(r.icon.startsWith('file://')); assert(r.header.startsWith('file://'));
  const none = await ic.forGame({ id: 'x', appIds: [99999999] }, null, { online: false }); assert(!none.icon);
});
t('ikony: serwer bierze ikonę gry', async () => {
  const ic = new Icons({ app: { getFileIcon: async () => null }, userData: root, getSteamRoots: () => [] });
  assert.deepStrictEqual(await ic.forServerType('minecraft', { minecraft: { icon: 'file:///mc.png' } }, { online: false }), { icon: 'file:///mc.png' });
  assert.deepStrictEqual(await ic.forServerType('nieznany', {}, { online: false }), {});
});

// ---------- nowe gry ----------
const G3 = require('../src/main/compat/games3');
const compat = require('../src/main/compat');
const games = require('../src/main/games');
const U = require('../src/main/util');
const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const has = (rep, level, re) => rep.issues.some(i => i.level === level && re.test(i.title));
t('lista gier: każda ma poziom zgodności, wszystkie z listy użytkownika są obecne', () => {
  for (const g of games.GAMES) assert(['full', 'basic', 'none'].includes(g.compat), g.id);
  for (const id of ['mysummercar', 'mywintercar', 'teardown', 'stalkersoc', 'stalkercs', 'stalkercop', 'stalker2', 'metro2033redux', 'metrolastlightredux', 'metroexodus', 'payday2', 'payday3', 'skyrimse', 'fallout4', 'cyberpunk2077', 'witcher3', 'sevendays', 'brickrigs', 'readyornot', 'citiesskylines']) assert(games.byId(id), id);
  assert.strictEqual(games.UNSUPPORTED.length, 0);
});
t('Cyberpunk: brakujące frameworki', () => {
  const gp = path.join(root, 'cp');
  w(path.join(gp, 'r6', 'scripts', 'MyMod', 'main.reds'), 'import Codeware.*\nfunc x() {}');
  w(path.join(gp, 'r6', 'tweaks', 'MyTweak', 'a.yaml'), 'x: 1');
  w(path.join(gp, 'archive', 'pc', 'mod', 'cool.archive'), 'x'); w(path.join(gp, 'archive', 'pc', 'mod', 'cool.archive.xl'), 'x');
  w(path.join(gp, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks', 'mods', 'Menu', 'init.lua'), '');
  const r = G3.checkCyberpunk({ gamePath: gp, settings: {} });
  for (const n of ['redscript', 'TweakXL', 'ArchiveXL', 'Codeware', 'RED4ext', 'Cyber Engine Tweaks']) assert(has(r, 'error', new RegExp('Brakuje ' + n)), n);
  w(path.join(gp, 'engine', 'config', 'base', 'scripts.ini'), ''); w(path.join(gp, 'red4ext', 'RED4ext.dll'), 'x'); w(path.join(gp, 'bin', 'x64', 'winmm.dll'), 'x');
  for (const p of ['TweakXL', 'ArchiveXL', 'Codeware']) w(path.join(gp, 'red4ext', 'plugins', p, p + '.dll'), 'x');
  w(path.join(gp, 'bin', 'x64', 'plugins', 'cyber_engine_tweaks.asi'), 'x');
  const r2 = G3.checkCyberpunk({ gamePath: gp, settings: {} });
  assert(!r2.issues.some(i => i.level === 'error'), r2.issues.map(i => i.title).join(' | '));
});
t('Wiedźmin 3: konflikt skryptów i mods.settings', () => {
  const gp = path.join(root, 'w3');
  w(path.join(gp, 'Mods', 'modA', 'content', 'scripts', 'game', 'player', 'r4Player.ws'), 'a');
  w(path.join(gp, 'Mods', 'modB', 'content', 'scripts', 'game', 'player', 'r4Player.ws'), 'b');
  w(path.join(gp, 'Mods', 'Bad', 'x.txt'), '');
  const docs = U.documents; U.documents = () => path.join(root, 'docs');
  const r = G3.checkWitcher3({ gamePath: gp, settings: {} });
  assert(has(r, 'error', /Konflikt skryptów: modA ↔ modB/)); assert(has(r, 'warn', /nie zaczyna się od „mod”/));
  G3.w3Toggle('modB', false);
  assert(/\[modB\]\r?\nEnabled=0/.test(fs.readFileSync(path.join(root, 'docs', 'The Witcher 3', 'mods.settings'), 'utf8')));
  const r2 = G3.checkWitcher3({ gamePath: gp, settings: {} });
  assert(!has(r2, 'error', /Konflikt/));
  w(path.join(gp, 'Mods', 'mod0000_MergedFiles', 'content', 'scripts', 'game', 'player', 'r4Player.ws'), 'm');
  G3.w3Toggle('modB', true);
  assert(!has(G3.checkWitcher3({ gamePath: gp, settings: {} }), 'error', /Konflikt/));
  U.documents = docs;
});
t('PAYDAY 2: SuperBLT, BeardLib, mod.txt', () => {
  const gp = path.join(root, 'pd2');
  w(path.join(gp, 'mods', 'Good', 'mod.txt'), '{ "name": "Good", "version": "1.0", "blt_version": 2, }');
  w(path.join(gp, 'mods', 'Broken', 'mod.txt'), '{ "name": "Broken" "version": 1 }');
  w(path.join(gp, 'mods', 'XmlMod', 'main.xml'), '<mod/>');
  const r = G3.checkPayday2({ gamePath: gp, settings: {} });
  assert(has(r, 'error', /Brak SuperBLT/)); assert(has(r, 'error', /Brak BeardLib/)); assert(has(r, 'error', /Broken: mod\.txt zawiera błąd/));
});
t('My Summer Car: MSCLoader i biblioteki', () => {
  const gp = path.join(root, 'msc');
  w(path.join(gp, 'Mods', 'Good.dll'), 'MSCLoader'); w(path.join(gp, 'Mods', 'Lib.dll'), 'Newtonsoft'); w(path.join(gp, 'Mods', 'Bep.dll'), 'BepInEx');
  const r = G3.checkMySummerCar({ gamePath: gp, settings: {} });
  assert(has(r, 'error', /MSCLoader nie jest/)); assert(has(r, 'warn', /Lib\.dll nie jest modem/)); assert(has(r, 'error', /Bep to plugin BepInEx/));
});
t('Teardown i S.T.A.L.K.E.R.', () => {
  const docs = U.documents; U.documents = () => path.join(root, 'docs2');
  w(path.join(root, 'docs2', 'Teardown', 'mods', 'Car', 'info.txt'), 'name = Super Car\nauthor = Ja'); w(path.join(root, 'docs2', 'Teardown', 'mods', 'Car', 'main.lua'), '');
  w(path.join(root, 'docs2', 'Teardown', 'mods', 'Empty', 'x.png'), '');
  const r = G3.checkTeardown({ workshop: [], settings: {} });
  assert(has(r, 'error', /Empty: brak info\.txt/)); assert(r.mods.find(m => m.name === 'Super Car'));
  U.documents = docs;
  const gp = path.join(root, 'soc');
  w(path.join(gp, 'fsgame.ltx'), '$app_data_root$ = true| false| $fs_root$| _appdata_\\\n$game_data$ = false| true| $fs_root$| gamedata\\\n');
  w(path.join(gp, 'gamedata', 'config', 'system.ltx'), '');
  const r2 = G3.checkXray({ game: { id: 'stalkersoc', name: 'SoC' }, gamePath: gp, settings: {} });
  assert(has(r2, 'error', /nie wczyta modów/));
  G3.patchFsgame(path.join(gp, 'fsgame.ltx'));
  assert(!has(G3.checkXray({ game: { id: 'stalkersoc', name: 'SoC' }, gamePath: gp, settings: {} }), 'error', /nie wczyta/));
});
t('instalacja ręczna: paczki .pak razem z .ucas/.utoc i przełączanie', () => {
  const gp = path.join(root, 'ron'); const md = path.join(gp, 'ReadyOrNot', 'Content', 'Paks', '~mods');
  w(path.join(md, 'Guns_P.pak'), 'x'); w(path.join(md, 'Guns_P.ucas'), 'x'); w(path.join(md, 'Guns_P.utoc'), 'x'); w(path.join(md, 'Map.pak'), 'x');
  const g = games.byId('readyornot');
  const r = G3.checkFiles({ game: g, gamePath: gp, workshop: [], settings: {} });
  assert.strictEqual(r.mods.length, 2); assert(!r.issues.some(i => i.level === 'error' || i.level === 'warn'));
  const guns = r.mods.find(m => m.name === 'Guns');
  compat.toggle(guns, {});
  assert(fs.existsSync(path.join(md, 'Guns_P.ucas.disabled')) && fs.existsSync(path.join(md, 'Guns_P.pak.disabled')));
  const r2 = G3.checkFiles({ game: g, gamePath: gp, workshop: [], settings: {} });
  const g2 = r2.mods.find(m => m.name === 'Guns'); assert.strictEqual(g2.enabled, false);
  compat.toggle(g2, {}); assert(fs.existsSync(path.join(md, 'Guns_P.utoc')));
  assert.strictEqual(compat.modsTarget('readyornot', null, { path: gp }), md);
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 3).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
