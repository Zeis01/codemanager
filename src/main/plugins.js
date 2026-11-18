// System wtyczek CodeManagera: folder wtyczek z plikiem plugin.json.
// Wtyczka może dodać gry (deklaratywnie w plugin.json albo z własnym sprawdzaniem w main.js), typy serwerów,
// reguły analizatora błędów i polecenia w Narzędziach. Wtyczki są domyślnie wyłączone – uruchamiają własny kod.
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const loaded = new Map(); // nazwa → { manifest, commands, checkers, error }
const checkers = new Map(); // id checkera → funkcja(ctx)
const targets = new Map(); // id checkera → funkcja(ctx) zwracająca folder modów

function list(dir, enabledMap = {}) {
  return U.listDirs(dir).map(d => {
    const m = U.readJSON(path.join(d, 'plugin.json'), null);
    const id = path.basename(d);
    if (!m) return { id, dir: d, error: 'Brak lub błędny plugin.json', enabled: false };
    const st = loaded.get(id);
    return { id, dir: d, name: m.name || id, version: m.version || '', description: m.description || '', author: m.author || '', enabled: !!enabledMap[id], loaded: !!st && !st.error, error: st && st.error, games: (m.games || []).map(g => g.name || g.id), commands: st ? st.commands.map(c => ({ id: c.id, title: c.title })) : [] };
  });
}
// gry zadeklarowane w plugin.json – czysto dane, bezpieczne do wczytania także w wątku roboczym
function declaredGames(dir, enabledMap = {}) {
  const out = [];
  for (const d of U.listDirs(dir)) {
    const id = path.basename(d); if (!enabledMap[id]) continue;
    const m = U.readJSON(path.join(d, 'plugin.json'), null); if (!m || !Array.isArray(m.games)) continue;
    for (const g of m.games) {
      if (!g || !/^[a-z0-9_-]{2,32}$/.test(g.id || '') || !g.name) continue;
      out.push({ compat: g.check ? 'basic' : 'none', short: (g.short || g.name.slice(0, 4)).slice(0, 6), color: g.color || '#7a7f87', appIds: (g.appIds || []).filter(n => Number.isInteger(n)), exe: (g.exe || []).map(String), desc: g.desc || `Dodane przez wtyczkę ${m.name || id}.`, ...g, checker: g.check ? 'plugin:' + g.id : 'files', manual: g.manual || { dirs: g.modsDir ? [g.modsDir] : [], kind: 'any' }, plugin: id });
    }
  }
  return out;
}
function registerDeclared(GAMES, dir, enabledMap) { for (const g of declaredGames(dir, enabledMap)) if (!GAMES.some(x => x.id === g.id)) GAMES.push(g); }

// uruchomienie kodu wtyczek (tylko w procesie głównym)
function loadAll({ dir, enabledMap = {}, GAMES, TYPES, analyzer, log = () => {}, emit = () => {}, settingsFor, Report }) {
  fs.mkdirSync(dir, { recursive: true });
  registerDeclared(GAMES, dir, enabledMap);
  for (const d of U.listDirs(dir)) {
    const id = path.basename(d); if (!enabledMap[id]) continue;
    const m = U.readJSON(path.join(d, 'plugin.json'), null);
    const st = { manifest: m, commands: [], error: null };
    loaded.set(id, st);
    if (!m) { st.error = 'Brak plugin.json'; continue; }
    if (!m.main) continue;
    const main = path.resolve(d, m.main);
    if (!main.startsWith(path.resolve(d) + path.sep)) { st.error = 'Plik main musi leżeć w folderze wtyczki.'; continue; }
    const api = {
      id, dir: d, log: msg => log(`[${m.name || id}] ${msg}`), notify: (msg, type) => emit('plugin:toast', { msg: String(msg), type: type || 'info', plugin: m.name || id }),
      util: U, Report,
      settings: { get: k => (settingsFor(id) || {})[k], set: (k, v) => { const s = settingsFor(id, true); s[k] = v; } },
      registerChecker(gameId, fn, { modsTarget } = {}) { if (typeof fn !== 'function') throw new Error('registerChecker: podaj funkcję'); checkers.set('plugin:' + gameId, fn); if (modsTarget) targets.set('plugin:' + gameId, modsTarget); const g = GAMES.find(x => x.id === gameId); if (g) { g.checker = 'plugin:' + gameId; g.compat = 'basic'; } },
      registerGame(def, fn) { if (!def || !/^[a-z0-9_-]{2,32}$/.test(def.id || '') || !def.name) throw new Error('registerGame: wymagane id (małe litery) i name'); if (!GAMES.some(x => x.id === def.id)) GAMES.push({ compat: fn ? 'basic' : 'none', short: def.name.slice(0, 4), color: '#7a7f87', appIds: [], exe: [], desc: `Dodane przez wtyczkę ${m.name || id}.`, manual: { dirs: [], kind: 'any' }, ...def, checker: fn ? 'plugin:' + def.id : 'files', plugin: id }); if (fn) checkers.set('plugin:' + def.id, fn); },
      registerServerType(typeId, def) { if (!/^[a-z0-9_-]{2,32}$/.test(typeId)) throw new Error('registerServerType: złe id'); if (TYPES[typeId]) throw new Error('Typ serwera już istnieje: ' + typeId); if (typeof def.start !== 'function') throw new Error('registerServerType: wymagana funkcja start(server)'); TYPES[typeId] = { color: '#7a7f87', port: 27015, ...def, plugin: id }; },
      addAnalyzerRule(rule) { if (!analyzer || !analyzer.addRule) return; analyzer.addRule(rule.id || id + '-' + Math.random().toString(36).slice(2, 6), rule.re, rule.level || 'warn', typeof rule.result === 'function' ? rule.result : () => ({ title: rule.title, why: rule.why, fix: rule.fix })); },
      addCommand(cmd) { if (!cmd || !cmd.id || typeof cmd.run !== 'function') throw new Error('addCommand: wymagane id i run()'); st.commands.push({ id: cmd.id, title: cmd.title || cmd.id, run: cmd.run }); },
    };
    try {
      delete require.cache[require.resolve(main)];
      const mod = require(main);
      const activate = typeof mod === 'function' ? mod : mod.activate;
      if (typeof activate === 'function') activate(api);
      log(`Wczytano wtyczkę ${m.name || id}${m.version ? ' ' + m.version : ''}`);
    } catch (e) { st.error = e.message; log(`✖ Wtyczka ${id}: ${e.message}`); }
  }
}
function checker(id) { return checkers.get(id) || null; }
function modsTarget(id) { return targets.get(id) || null; }
async function runCommand(pluginId, cmdId, ctx) {
  const st = loaded.get(pluginId); if (!st) throw new Error('Wtyczka nie jest wczytana.');
  const c = st.commands.find(x => x.id === cmdId); if (!c) throw new Error('Nie ma takiego polecenia.');
  return c.run(ctx || {});
}
function allCommands() { const out = []; for (const [pid, st] of loaded) for (const c of st.commands) out.push({ plugin: pid, pluginName: (st.manifest && st.manifest.name) || pid, id: c.id, title: c.title }); return out; }

// przykładowa wtyczka do nauki
function createExample(dir) {
  const d = path.join(dir, 'przyklad');
  if (U.exists(d)) return d;
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'plugin.json'), JSON.stringify({
    name: 'Przykładowa wtyczka', version: '1.0.0', author: 'Ty', description: 'Dodaje grę Terraria (vanilla) z prostym sprawdzaniem, regułę analizatora i polecenie w Narzędziach.',
    main: 'main.js',
    games: [{ id: 'terraria-vanilla', name: 'Terraria (bez tModLoadera)', short: 'TER', color: '#3fa34d', appIds: [105600], exe: ['Terraria.exe'], check: true }],
  }, null, 2));
  fs.writeFileSync(path.join(d, 'main.js'), `// Przykładowa wtyczka CodeManagera – zobacz README.md w tym folderze
module.exports = function activate(api) {
  // własne sprawdzanie gry zadeklarowanej w plugin.json
  api.registerChecker('terraria-vanilla', ctx => {
    const rep = new api.Report('Terraria');
    const fs = require('fs'), path = require('path');
    const packs = path.join(ctx.gamePath, 'Content');
    rep.meta = { 'Folder gry': ctx.gamePath };
    if (!fs.existsSync(packs)) rep.warn('Brak folderu Content – sprawdź instalację gry.');
    else rep.ok('Pliki gry wyglądają poprawnie.');
    return rep.finish();
  }, { modsTarget: ctx => ctx.gamePath });

  // reguła analizatora błędów
  api.addAnalyzerRule({ re: /System\\.OutOfMemoryException/, level: 'error', title: 'Brak pamięci (.NET)', why: 'Gra zużyła całą dostępną pamięć.', fix: 'Zamknij inne programy albo zmniejsz liczbę modów.' });

  // polecenie w Narzędziach
  api.addCommand({ id: 'hello', title: 'Przywitaj się', run: () => { api.notify('Cześć z przykładowej wtyczki!'); return 'OK'; } });
};
`);
  fs.writeFileSync(path.join(d, 'README.md'), `# Wtyczki CodeManagera

Każda wtyczka to folder w \`plugins\` z plikiem \`plugin.json\`:

- \`name\`, \`version\`, \`author\`, \`description\` – opis,
- \`games\` – gry dodawane bez kodu: \`id\`, \`name\`, \`appIds\` (Steam), \`exe\`, \`modsDir\` (folder modów względem gry), \`check: true\` gdy sprawdzanie dodaje main.js,
- \`main\` – plik JavaScript uruchamiany w CodeManagerze.

main.js eksportuje funkcję \`activate(api)\`:

| Funkcja | Opis |
|---|---|
| \`api.registerChecker(gameId, ctx => raport, { modsTarget })\` | sprawdzanie zgodności gry; \`ctx.gamePath\`, \`ctx.settings\`; raport przez \`new api.Report(tytuł)\` (\`addMod\`, \`error\`, \`warn\`, \`note\`, \`ok\`, \`finish()\`) |
| \`api.registerGame(def, checkFn?)\` | gra dodana z kodu (wykrywanie po \`appIds\`/\`exe\`) |
| \`api.registerServerType(id, { name, port, start(server) → { cmd, args, cwd }, stopCmd, install?, configs? })\` | nowy typ serwera |
| \`api.addAnalyzerRule({ re, level, title, why, fix })\` | reguła analizatora błędów |
| \`api.addCommand({ id, title, run(ctx) })\` | polecenie w Narzędziach |
| \`api.notify(tekst)\`, \`api.log(tekst)\`, \`api.settings.get/set\`, \`api.util\` | pomocnicze |

Wtyczki uruchamiają kod na Twoim komputerze – włączaj tylko te, którym ufasz. Po zmianach uruchom CodeManager ponownie.
`);
  return d;
}

module.exports = { list, declaredGames, registerDeclared, loadAll, checker, modsTarget, runCommand, allCommands, createExample, _reset: () => { loaded.clear(); checkers.clear(); targets.clear(); } };
