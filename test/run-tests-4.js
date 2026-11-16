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

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 3).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
