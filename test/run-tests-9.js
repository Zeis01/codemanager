// Testy wersji 1.7.1 i 1.7.1.5: podpowiedzi w edytorze (Python, Lua, profile gier Lua) (node test/run-tests-9.js)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);

// skrypty przeglądarkowe w piaskownicy z udawanym Monaco
const calls = {};
const win = { App: { state: { settings: {} } }, cm: { call: async (ch, ...a) => { calls[ch] = (calls[ch] || 0) + 1; if (ch === 'py:status') return { found: false }; throw new Error('brak'); } } };
const store = {};
const sandbox = { window: win, App: win.App, console, Response, DecompressionStream, localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = String(v); } },
  fetch: async url => { const f = path.join(__dirname, '..', 'src', 'renderer', url); return fs.existsSync(f) ? new Response(fs.readFileSync(f)) : new Response('', { status: 404 }); } };
vm.createContext(sandbox);
for (const f of ['editor-pydb.js', 'editor-complete.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', f), 'utf8'), sandbox);
const EC = win.EditorComplete;
const kinds = { Module: 1, Class: 2, Function: 3, Method: 4, Variable: 5, Constant: 6, Field: 7, Keyword: 8, Property: 9 };
EC._setMonaco({ languages: { CompletionItemKind: kinds }, Range: class { constructor(...a) { this.a = a; } } });
const model = (text, file) => { const lines = text.split('\n'); return { uri: file ? { scheme: 'file', fsPath: file, path: file } : { scheme: 'inmemory', path: '' }, getValueInRange: r => lines.slice(r.startLineNumber - 1, r.endLineNumber).map((l, i, a) => i === a.length - 1 ? l.slice(0, r.endColumn - 1) : l).join('\n'), getValue: () => text, getLineContent: n => lines[n - 1], getWordUntilPosition: p => { const l = lines[p.lineNumber - 1].slice(0, p.column - 1); const m = l.match(/\w*$/); return { startColumn: p.column - m[0].length, endColumn: p.column, word: m[0] }; } }; };
const at = (text, line, file) => { const m = model(text, file); const l = text.split('\n')[line - 1]; return [m, { lineNumber: line, column: l.length + 1 }]; };
const labels = r => [...r.suggestions.map(s => s.label)];
const J = x => JSON.parse(JSON.stringify(x));

const PY = `import time
import os.path
import json as js
from collections import OrderedDict as OD
from os import path as p

class Baza:
    def ping(self): pass

class Gracz(Baza):
    LIMIT = 10
    def __init__(self, nazwa):
        self.nazwa = nazwa
        self.lista = []

    def dodaj(self, ile=1):
        """Dodaje punkty."""
        self.`;

t('Python: analiza importów, klas i przypisań', () => {
  const c = EC.pyParse(PY + '\n\ntekst = "x"\nf = open("a.txt")\ng = Gracz("A")\nd: dict = {}');
  assert.deepStrictEqual(J(c.imports), { time: 'time', os: 'os', js: 'json', OD: 'collections.OrderedDict', p: 'os.path' });
  assert.deepStrictEqual(J(c.classes.Gracz.methods.map(m => m.n)), ['__init__', 'dodaj']);
  assert.strictEqual(c.classes.Gracz.methods[1].s, '(ile=1)'); assert.strictEqual(c.classes.Gracz.methods[1].d, 'Dodaje punkty.');
  assert.deepStrictEqual(J(Object.keys(c.classes.Gracz.attrs).sort()), ['LIMIT', 'lista', 'nazwa']);
  assert.deepStrictEqual(J(c.classes.Gracz.bases), ['Baza']);
  assert.deepStrictEqual(J(EC.resolveChain(['js'], c)), { path: 'json' });
  assert.deepStrictEqual(J(EC.resolveChain(['p'], c)), { path: 'os.path' });
  assert.deepStrictEqual(J(EC.resolveChain(['os', 'path'], c)), { path: 'os.path' });
  assert.deepStrictEqual(J(EC.resolveChain(['tekst'], c)), { path: '@str' });
  assert.deepStrictEqual(J(EC.resolveChain(['f'], c)), { path: 'io.TextIOWrapper' });
  assert.deepStrictEqual(J(EC.resolveChain(['d'], c)), { path: '@dict' });
  assert.strictEqual(EC.resolveChain(['g'], c).local.name, 'Gracz');
  assert.strictEqual(EC.resolveChain(['nieznane'], c), null);
});

t('Python: podpowiedzi po kropce, w importach i zwykłe (wbudowana baza)', async () => {
  let r = await EC._pyComplete(...at('import time\ntime.', 2));
  assert(labels(r).includes('sleep') && labels(r).includes('perf_counter') && labels(r).includes('altzone'));
  const sleep = r.suggestions.find(s => s.label === 'sleep'); assert.strictEqual(sleep.kind, kinds.Function);
  assert.strictEqual(r.suggestions.find(s => s.label === 'altzone').kind, kinds.Variable);
  r = await EC._pyComplete(...at(PY, 18));
  assert.deepStrictEqual(J(labels(r).sort()), ['LIMIT', '__init__', 'dodaj', 'lista', 'nazwa', 'ping']);
  r = await EC._pyComplete(...at('import os.path\nos.path.', 2)); assert(labels(r).includes('join') && labels(r).includes('exists'));
  r = await EC._pyComplete(...at('x = "abc"\nx.', 2)); assert(labels(r).includes('upper') && labels(r).includes('split'));
  r = await EC._pyComplete(...at('"abc".st', 1)); assert(labels(r).includes('startswith'));
  r = await EC._pyComplete(...at('import js', 1)); assert(labels(r).includes('json') && labels(r).includes('os'));
  r = await EC._pyComplete(...at('from json import ', 1)); assert(labels(r).includes('dumps') && labels(r).includes('JSONDecoder'));
  r = await EC._pyComplete(...at('import random as rnd\ndef pomoc(a, b): pass\nwy', 3));
  const L = labels(r); assert(L.includes('rnd') && L.includes('pomoc') && L.includes('while') && L.includes('print') && L.includes('len'));
  r = await EC._pyComplete(...at('# time.', 1)); assert.strictEqual(r.suggestions.length, 0, 'w komentarzu bez podpowiedzi');
  r = await EC._pyComplete(...at('cos.', 1)); assert.strictEqual(r.suggestions.length, 0);
  win.App.state.settings.editorSuggest = false; r = await EC._pyComplete(...at('import time\ntime.', 2)); assert.strictEqual(r.suggestions.length, 0); delete win.App.state.settings.editorSuggest;
});

t('Lua: biblioteka standardowa, tabele i metody z pliku', async () => {
  const L = `local M = {}
function M.start(gracz, czas) end
function M:stop() end
M.wersja = "1.0"
local cfg = { port = 1, go = function(a) end }
local s = "abc"
`;
  const c = EC.luaParse(L);
  assert.deepStrictEqual(J([...c.tables.M.keys()].sort()), ['start', 'stop', 'wersja']);
  assert.deepStrictEqual(J([...c.tables.cfg.keys()].sort()), ['go', 'port']);
  let r = await EC._luaComplete(...at(L + 'M.', 7)); assert.deepStrictEqual(J(labels(r).sort()), ['start', 'stop', 'wersja']);
  r = await EC._luaComplete(...at(L + 'M:', 7)); assert.deepStrictEqual(J(labels(r).sort()), ['start', 'stop']);
  r = await EC._luaComplete(...at(L + 'string.', 7)); assert(labels(r).includes('format') && labels(r).includes('gsub'));
  r = await EC._luaComplete(...at(L + 's:', 7)); assert(labels(r).includes('upper'));
  r = await EC._luaComplete(...at(L + 'pri', 7)); assert(labels(r).includes('print') && labels(r).includes('M') && labels(r).includes('local') && labels(r).includes('table'));
  r = await EC._luaComplete(...at(L + '-- string.', 7)); assert.strictEqual(r.suggestions.length, 0);
});

// wykrywanie gry w procesie głównym – w teście: brak plików-znaczników
win.cm.call = async (ch, ...a) => { if (ch === 'py:status') return { found: false }; if (ch === 'luaapi:detect') return require('../src/main/editor/luaapi').detect(a[0]); if (ch === 'luaapi:local') return require('../src/main/editor/luaapi').localDefs(a[0], process.env.CM_TD || null); if (ch === 'luaapi:load') return require('../src/main/editor/luaapi').load(a[0]); throw new Error('brak'); };

t('profile Lua: wykrywanie gry po plikach, treści i ręcznym wyborze', async () => {
  const os = require('os'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-lua-'));
  try {
    fs.mkdirSync(path.join(dir, 'res', 'client'), { recursive: true }); fs.writeFileSync(path.join(dir, 'res', 'fxmanifest.lua'), "fx_version 'cerulean'\ngame 'gta5'");
    fs.mkdirSync(path.join(dir, 'rdr'), { recursive: true }); fs.writeFileSync(path.join(dir, 'rdr', 'fxmanifest.lua'), "fx_version 'cerulean'\ngame 'rdr3'\nrdr3_warning 'I acknowledge…'");
    fs.mkdirSync(path.join(dir, 'mta'), { recursive: true }); fs.writeFileSync(path.join(dir, 'mta', 'meta.xml'), '<meta><script src="s.lua"/></meta>');
    const D = require('../src/main/editor/luaapi');
    assert.strictEqual(D.detect(path.join(dir, 'res', 'client', 'main.lua')).id, 'fivem');
    assert.strictEqual(D.detect(path.join(dir, 'rdr', 'c.lua')).id, 'redm');
    assert.strictEqual(D.detect(path.join(dir, 'mta', 's.lua')).id, 'mta');
    assert.strictEqual(D.detect('/srv/beammp/Resources/Server/MyPlugin/main.lua').id, 'beammp');
    assert.strictEqual(D.detect('C:/Steam/steamapps/common/GarrysMod/garrysmod/addons/x/lua/autorun/a.lua').id, 'gmod');
    assert.strictEqual(D.detect(path.join(dir, 'nic.lua')).id, null);
    assert.strictEqual((await EC.profileFor(model('hook.Add("Think", "x", function() end)', path.join(dir, 'a.lua')))).id, 'gmod');
    assert.strictEqual((await EC.profileFor(model('MP.RegisterEvent("onInit", "f")', path.join(dir, 'b.lua')))).id, 'beammp');
    EC.setOverride(dir, 'factorio');
    assert.strictEqual((await EC.profileFor(model('hook.Add()', path.join(dir, 'c.lua')))).id, 'factorio');
    EC.setOverride(dir, null);
    win.App.state.settings.luaApi = 'mta'; assert.strictEqual((await EC.profileFor(model('', path.join(dir, 'd.lua')))).id, 'mta'); delete win.App.state.settings.luaApi;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

t('profile Lua: FiveM, BeamMP, Garry\'s Mod, Factorio, MTA – funkcje, typy i zdarzenia z dokumentacji', async () => {
  const S = (text, file) => EC._luaComplete(...at(text, text.split('\n').length, file));
  // FiveM: natywne funkcje przy pisaniu, Citizen., zdarzenia w tekście
  let r = await S('Citizen.CreateThread(function()\n  local ped = PlayerPedId()\n  GetEntityCoo', '/x/res/client.lua');
  assert(labels(r).includes('GetEntityCoords'), 'natywna funkcja FiveM');
  const ge = r.suggestions.find(s => s.label === 'GetEntityCoords'); assert(/entity/.test(ge.detail));
  r = await S('RegisterNetEvent("x")\nCitizen.'); assert(labels(r).includes('Wait') && labels(r).includes('CreateThread'));
  r = await S('RegisterNetEvent("x")\nAddEventHandler("playerCo'); assert(labels(r).includes('playerConnecting'));
  r = await S('RegisterNetEvent("x")\njson.'); assert(labels(r).includes('encode'));
  // BeamMP
  r = await S('MP.RegisterEvent("onInit", "f")\nMP.'); assert(labels(r).includes('SendChatMessage') && labels(r).includes('TriggerClientEvent') && labels(r).includes('GetPlayers'));
  r = await S('MP.RegisterEvent("onInit", "f")\nMP.RegisterEvent("onPla'); assert(labels(r).includes('onPlayerJoin') || labels(r).includes('onPlayerJoining'));
  r = await S('MP.RegisterEvent("x","y")\nFS.'); assert(labels(r).includes('CreateDirectory'));
  // Garry's Mod: biblioteki, typ zwracany, parametry hooków
  r = await S('hook.Add("Think","a",function() end)\ntimer.'); assert(labels(r).includes('Simple') && labels(r).includes('Create'));
  r = await S('hook.Add("Think","a",function() end)\nlocal p = LocalPlayer()\np:'); assert(labels(r).includes('Nick') && labels(r).includes('GetPos'), 'Player dziedziczy po Entity');
  r = await S('hook.Add("PlayerSpawn", "x", function(kto)\n  kto:'); assert(labels(r).includes('SetHealth') || labels(r).includes('Give'), 'typ parametru z hooka');
  r = await S('hook.Add("'); assert(labels(r).includes('PlayerSpawn') && labels(r).includes('Think'));
  r = await S('hook.Add("Think","a",function() end)\nfor _, ply in ipairs(player.GetAll()) do\n  ply:'); assert(labels(r).includes('Nick'), 'element tablicy z player.GetAll()');
  // Factorio: obiekty globalne, łańcuchy typów, defines
  r = await S('script.on_event(defines.events.on_tick, f)\ngame.'); assert(labels(r).includes('print') && labels(r).includes('players'));
  r = await S('script.on_event(x)\ngame.players[1].'); assert(labels(r).includes('print') && labels(r).includes('character'), 'element LuaCustomTable');
  r = await S('script.on_event(x)\ndefines.events.'); assert(labels(r).includes('on_player_joined_game'));
  // MTA
  r = await S('addEventHandler("onPlayerJoin", root, function() end)\noutputCh'); assert(labels(r).includes('outputChatBox'));
  r = await S('addEventHandler("onPlayerJo'); assert(labels(r).includes('onPlayerJoin'));
  // Project Zomboid, DST, Stormworks
  r = await S('Events.OnGameStart.Add(f)\nEvents.'); assert(labels(r).includes('OnGameStart') && labels(r).includes('EveryOneMinute'));
  r = await S('Events.OnGameStart.Add(f)\nlocal pl = getPlayer()\npl:'); assert(labels(r).length > 50, 'metody IsoPlayer');
  r = await S('AddPrefabPostInit("wilson", f)\nTheNet:'); assert(labels(r).length > 5);
  r = await S('function onTick(t) end\nserver.'); assert(labels(r).includes('announce') || labels(r).includes('getPlayers'));
  // czysta Lua nadal działa
  r = await S('local t = {}\ntable.'); assert(labels(r).includes('insert'));
});

t('profile Lua: Teardown – definicje czytane z plików gry', async () => {
  const os = require('os'); const g = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-td-'));
  try {
    fs.mkdirSync(path.join(g, 'data'));
    fs.writeFileSync(path.join(g, 'data', 'script_defs.lua'), '---@meta\n--- Get player transform\n---@return table transform Player transform\nfunction GetPlayerTransform() end\n---@param handle number Body handle\n---@return table\nfunction GetBodyTransform(handle) end\n');
    const db = require('../src/main/editor/luaapi').localDefs('teardown', g);
    assert(db.globals.GetPlayerTransform && db.globals.GetBodyTransform[1].includes('handle: number'));
    process.env.CM_TD = g;
    const r = await EC._luaComplete(...at('function tick(dt)\n  GetPlayerTr', 2));
    assert(labels(r).includes('GetPlayerTransform'));
    assert.strictEqual(require('../src/main/editor/luaapi').localDefs('teardown', path.join(g, 'brak')), null);
  } finally { delete process.env.CM_TD; fs.rmSync(g, { recursive: true, force: true }); }
});

t('wersja 1.7.1.5: zapis 1.7.1-5 porównywany jako czwarta liczba', () => {
  const U = require('../src/main/util');
  assert.strictEqual(U.cmpVer('1.7.1-5', '1.7.1'), 1); assert.strictEqual(U.cmpVer('v1.7.1.5', '1.7.1-5'), 0); assert.strictEqual(U.cmpVer('1.7.2', '1.7.1-5'), 1);
  assert.strictEqual(U.cmpVer('1.8.0-beta', '1.8.0'), -1); assert.strictEqual(U.dispVer('1.7.1-5'), '1.7.1.5'); assert.strictEqual(U.dispVer('1.7.1'), '1.7.1');
});

t('Python na komputerze: składowe z interpretera, pamięć podręczna, brak Pythona', async () => {
  const { PyIntel } = require('../src/main/editor/python');
  const runs = [];
  const fake = async (cmd, args) => { runs.push([cmd, args[0]]); if (cmd === 'python3' || cmd === 'py') { if (args.includes('-c') && /CMPY/.test(args[args.indexOf('-c') + 1])) return { ok: true, stdout: 'CMPY3.12\n' }; return { ok: true, stdout: JSON.stringify({ version: '3.12', members: { requests: [{ n: 'get', k: 'function', s: '(url, params=None, **kwargs)' }] } }) }; } return { ok: false, stdout: '' }; };
  const p = new PyIntel({ runImpl: fake });
  const st = await p.status(); assert.strictEqual(st.found, true); assert.strictEqual(st.version, '3.12');
  const r = await p.members(['requests', 'zła ścieżka!']);
  assert.strictEqual(r.requests[0].n, 'get'); assert(!('zła ścieżka!' in r));
  const n = runs.length; await p.members(['requests']); assert.strictEqual(runs.length, n, 'drugie zapytanie z pamięci');
  const none = new PyIntel({ runImpl: async () => ({ ok: false, stdout: '' }) });
  assert.deepStrictEqual(await none.status(), { found: false }); assert.strictEqual(await none.modules(), null);
  // prawdziwy Python (jeśli jest): skrypt działa i zwraca składowe
  const real = new PyIntel();
  if ((await real.status()).found) { const m = await real.members(['time', 'os.path']); assert(m.time.some(x => x.n === 'sleep' && x.k === 'function')); assert(m['os.path'].some(x => x.n === 'join')); }
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 4).join('\n    ')); } }
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
