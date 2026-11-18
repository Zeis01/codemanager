// Testy wersji 1.7.1: podpowiedzi w edytorze (Python, Lua) (node test/run-tests-9.js)
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
const sandbox = { window: win, App: win.App, console };
vm.createContext(sandbox);
for (const f of ['editor-pydb.js', 'editor-complete.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', f), 'utf8'), sandbox);
const EC = win.EditorComplete;
const kinds = { Module: 1, Class: 2, Function: 3, Method: 4, Variable: 5, Constant: 6, Field: 7, Keyword: 8, Property: 9 };
EC._setMonaco({ languages: { CompletionItemKind: kinds }, Range: class { constructor(...a) { this.a = a; } } });
const model = text => { const lines = text.split('\n'); return { getValue: () => text, getLineContent: n => lines[n - 1], getWordUntilPosition: p => { const l = lines[p.lineNumber - 1].slice(0, p.column - 1); const m = l.match(/\w*$/); return { startColumn: p.column - m[0].length, endColumn: p.column, word: m[0] }; } }; };
const at = (text, line) => { const m = model(text); const l = text.split('\n')[line - 1]; return [m, { lineNumber: line, column: l.length + 1 }]; };
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

t('Lua: biblioteka standardowa, tabele i metody z pliku', () => {
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
  let r = EC._luaComplete(...at(L + 'M.', 7)); assert.deepStrictEqual(J(labels(r).sort()), ['start', 'stop', 'wersja']);
  r = EC._luaComplete(...at(L + 'M:', 7)); assert.deepStrictEqual(J(labels(r).sort()), ['start', 'stop']);
  r = EC._luaComplete(...at(L + 'string.', 7)); assert(labels(r).includes('format') && labels(r).includes('gsub'));
  r = EC._luaComplete(...at(L + 's:', 7)); assert(labels(r).includes('upper'));
  r = EC._luaComplete(...at(L + 'pri', 7)); assert(labels(r).includes('print') && labels(r).includes('M') && labels(r).includes('local') && labels(r).includes('table'));
  r = EC._luaComplete(...at(L + '-- string.', 7)); assert.strictEqual(r.suggestions.length, 0);
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
