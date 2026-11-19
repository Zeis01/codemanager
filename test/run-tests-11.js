// Testy wersji 1.9.0 (node test/run-tests-11.js)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test11-'));
let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);
const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const wait = ms => new Promise(r => setTimeout(r, ms));

t('tunel: adresy z bore i playit, uruchamianie, porty UDP, zatrzymanie', async () => {
  const T = require('../src/main/servers/tunnel');
  assert.deepStrictEqual(T.parseBore('2026-11-19T10:00:00Z  INFO bore_cli::client: listening at bore.pub:41234'), { host: 'bore.pub', port: 41234, address: 'bore.pub:41234' });
  assert.strictEqual(T.parseBore('connected to server'), null);
  assert.deepStrictEqual(T.parsePlayit('\x1b[32mabc-def.gl.joinmc.link\x1b[0m => 127.0.0.1:25565 (minecraft-java)'), { address: 'abc-def.gl.joinmc.link', local: 25565 });
  assert.deepStrictEqual(T.parsePlayit('visit https://playit.gg/claim/ab12cd to setup'), { claimUrl: 'https://playit.gg/claim/ab12cd' });
  assert.strictEqual(T.parsePlayitList('\x1b8a1b2c3d4-0000-1111-2222-333344445555 udp 1 147.185.221.1:12345 cm-s1-2456\n')[0].address, '147.185.221.1:12345');
  const events = []; const procs = [];
  const fake = (bin, args) => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.args = args; p.kill = () => { p.killed = true; p.emit('exit', 0); }; procs.push(p); return p; };
  fake.fake = true;
  const tm = new T.TunnelManager({ userData: root, net: {}, emit: (ch, d) => events.push([ch, d]) });
  const s = { id: 's1', name: 'MC', type: 'minecraft', port: 25565 };
  tm.start(s, 'bore', [{ port: 25565, proto: 'TCP', label: 'Gra' }, { port: 25575, proto: 'TCP', label: 'RCON' }], { spawnImpl: fake });
  assert.strictEqual(procs.length, 2); assert.deepStrictEqual(procs[0].args, ['local', '25565', '--to', 'bore.pub']);
  procs[0].stdout.emit('data', 'INFO listening at bore.pub:40001\n');
  assert.strictEqual(tm.address('s1'), 'bore.pub:40001');
  const st = tm.status().active.s1; assert.strictEqual(st.status, 'online'); assert.strictEqual(st.addresses[0].label, 'Gra');
  assert(events.some(([ch, d]) => ch === 'tunnel:status' && d.addresses && d.addresses.length === 1));
  // zamknięcie procesu bez zatrzymania = błąd
  procs[0].emit('exit', 1); procs[1].emit('exit', 1);
  assert.strictEqual(tm.status().active.s1.status, 'error');
  tm.stop('s1'); assert.strictEqual(tm.status().active.s1, undefined);
  assert.throws(() => tm.start({ id: 's2' }, 'bore', [{ port: 2456, proto: 'UDP' }], { spawnImpl: fake }), /tylko TCP/);
  tm.start({ id: 's3' }, 'bore', [{ port: 27015, proto: 'TCP' }, { port: 27015, proto: 'UDP' }], { spawnImpl: fake });
  assert(tm.status().active.s3 && tm.active.get('s3').warnings.some(x => /UDP/.test(x)));
  tm.stopAll(); assert.deepStrictEqual(tm.status().active, {});
});

t('hot reload: polecenia dla FiveM, MTA, Minecraft, SourceMod, Oxide i opóźnienie zmian', async () => {
  const { commandFor, HotReloader } = require('../src/main/servers/hotreload');
  const fx = { type: 'fivem', path: path.join(root, 'fx') };
  assert.deepStrictEqual(commandFor(fx, path.join(fx.path, 'resources', '[moje]', 'sklep', 'client', 'main.lua')), { cmd: 'ensure sklep', label: 'zasób sklep' });
  assert.deepStrictEqual(commandFor(fx, path.join(fx.path, 'resources', 'hud', 'fxmanifest.lua')).cmd, 'ensure hud');
  assert.strictEqual(commandFor(fx, path.join(fx.path, 'server.cfg')), null);
  assert.strictEqual(commandFor(fx, path.join(root, 'inny', 'resources', 'x', 'a.lua')), null, 'plik spoza serwera');
  assert.strictEqual(commandFor({ type: 'mta', path: fx.path }, path.join(fx.path, 'mods', 'deathmatch', 'resources', 'race', 'race.lua')).cmd, 'restart race');
  const mc = { type: 'minecraft', path: path.join(root, 'mc') };
  assert.strictEqual(commandFor(mc, path.join(mc.path, 'world', 'datapacks', 'pak', 'data', 'x.mcfunction')).cmd, 'reload');
  assert.strictEqual(commandFor(mc, path.join(mc.path, 'plugins', 'EssentialsX-2.21.0.jar')).cmd, 'plugman reload EssentialsX');
  assert(commandFor(mc, path.join(mc.path, 'plugins', 'Essentials', 'config.yml')).note);
  assert.strictEqual(commandFor({ type: 'cs2', path: fx.path }, path.join(fx.path, 'game', 'csgo', 'addons', 'sourcemod', 'plugins', 'admin.smx')).cmd, 'sm plugins reload admin');
  assert(commandFor({ type: 'rust', path: fx.path }, path.join(fx.path, 'oxide', 'plugins', 'Kits.cs')).note);
  assert.strictEqual(commandFor({ type: 'rust', path: fx.path }, path.join(fx.path, 'oxide', 'config', 'Kits.json')).cmd, 'oxide.reload Kits');
  // przeładowanie raz mimo kilku zapisów, tylko działające serwery z włączoną opcją
  const sent = []; const notes = [];
  const servers = [{ id: 'a', name: 'FX', ...fx }, { id: 'b', name: 'FX2', ...fx, hotReload: false }];
  const hr = new HotReloader({ servers: () => servers, getServer: id => servers.find(s => s.id === id), isRunning: () => true, send: (id, cmd) => sent.push([id, cmd]), emit: (ch, d) => notes.push(d), enabled: s => s.hotReload !== false, debounce: 30 });
  const f = path.join(fx.path, 'resources', 'sklep', 'server.lua');
  hr.changed(f); hr.changed(f); hr.changed(f);
  await wait(80);
  assert.deepStrictEqual(sent, [['a', 'ensure sklep']]); assert.strictEqual(notes[0].server, 'FX');
  hr.changed(f); await wait(80); assert.strictEqual(sent.length, 1, 'ten sam zasób nie częściej niż co 1,5 s');
});

t('debugger Lua: punkt zatrzymania, zmienne, krok do funkcji, wyrażenia, koniec programu', async () => {
  const { DebugManager } = require('../src/main/editor/debugger');
  const dir = path.join(root, 'lua'); const main = w(path.join(dir, 'main.lua'), 'local util = require("util")\nlocal function add(a, b)\n  local s = a + b\n  return s\nend\nlocal t = { name = "Ala", list = {1, 2, 3} }\nlocal x = add(2, 3)\nprint("wynik", x, util.hello())\n');
  w(path.join(dir, 'util.lua'), 'local M = {}\nfunction M.hello() return "cześć" end\nreturn M\n');
  const ev = []; let resolveStop; let stopP = new Promise(r => { resolveStop = r; });
  const dm = new DebugManager({ emit: (ch, e) => { ev.push(e); if (e.type === 'stopped') { resolveStop(e); stopP = new Promise(r => { resolveStop = r; }); } } });
  await dm.setBreakpoints(main, [7]);
  await dm.start({ program: main });
  let st = await Promise.race([stopP, wait(8000).then(() => null)]); assert(st, 'zatrzymanie w punkcie');
  assert.strictEqual(st.reason, 'breakpoint'); assert.strictEqual(st.frames[0].line, 7); assert.strictEqual(path.resolve(st.frames[0].file), path.resolve(main));
  const scopes = await dm.scopes(st.frames[0].id); const locals = await dm.variables(scopes[0].ref);
  const tv = locals.find(v => v.name === 't'); assert(tv && tv.ref > 0);
  const kids = await dm.variables(tv.ref); assert.strictEqual(kids.find(k => k.name === 'name').value, '"Ala"');
  assert.strictEqual((await dm.evaluate('t.name .. "!"', st.frames[0].id)).result, '"Ala!"');
  await dm.cmd('stepIn');
  st = await Promise.race([stopP, wait(8000).then(() => null)]);
  assert.strictEqual(st.frames[0].name, 'add'); assert.strictEqual(st.frames[0].line, 3);
  assert.deepStrictEqual((await dm.variables((await dm.scopes(st.frames[0].id))[0].ref)).map(v => `${v.name}=${v.value}`), ['a=2', 'b=3']);
  await dm.cmd('continue');
  for (let i = 0; i < 80 && !ev.some(e => e.type === 'terminated'); i++) await wait(100);
  assert(ev.some(e => e.type === 'output' && /wynik\t5\tcześć/.test(e.output)), JSON.stringify(ev.filter(e => e.type === 'output')));
  assert(ev.some(e => e.type === 'terminated')); assert.strictEqual(dm.status().running, false);
});

t('debugger Python (debugpy, jeśli zainstalowany)', async () => {
  const { DebugManager } = require('../src/main/editor/debugger');
  const { PyIntel } = require('../src/main/editor/python');
  const U = require('../src/main/util');
  const dm0 = new DebugManager({ pyIntel: new PyIntel({}), run: U.run });
  const ps = await dm0.pythonStatus(); if (!ps.debugpy) { console.log('    (pominięto – brak debugpy)'); return; }
  const prog = w(path.join(root, 'py', 'prog.py'), 'def add(a, b):\n    s = a + b\n    return s\n\nx = add(2, 3)\nprint("wynik", x)\n');
  const ev = []; let resolveStop; const stopP = new Promise(r => { resolveStop = r; });
  const dm = new DebugManager({ pyIntel: new PyIntel({}), run: U.run, emit: (ch, e) => { ev.push(e); if (e.type === 'stopped') resolveStop(e); } });
  await dm.setBreakpoints(prog, [2]);
  await dm.start({ program: prog });
  const st = await Promise.race([stopP, wait(20000).then(() => null)]); assert(st, 'zatrzymanie');
  assert.strictEqual(st.frames[0].name, 'add'); assert.strictEqual(st.frames[0].line, 2);
  const vars = await dm.variables((await dm.scopes(st.frames[0].id))[0].ref);
  assert.deepStrictEqual(vars.filter(v => ['a', 'b'].includes(v.name)).map(v => v.value), ['2', '3']);
  assert.strictEqual((await dm.evaluate('a * 10', st.frames[0].id)).result, '20');
  await dm.cmd('continue');
  for (let i = 0; i < 100 && !ev.some(e => e.type === 'terminated'); i++) await wait(100);
  await wait(300);
  assert(/wynik 5/.test(ev.filter(e => e.type === 'output').map(e => e.output).join('')), JSON.stringify(ev.map(e => e.type + (e.output ? ':' + e.output : ''))));
});

t('asystent: narzędzia w granicach projektu, zmiany tylko po zatwierdzeniu', async () => {
  const { ToolBox } = require('../src/main/editor/assistant');
  const proj = path.join(root, 'proj'); w(path.join(proj, 'resources', 'sklep', 'server.lua'), 'local cena = 10\nprint(cena)\nprint(cena)\n'); w(path.join(proj, 'node_modules', 'x.js'), 'ukryte');
  let asked = null; let answer = true;
  const box = new ToolBox({ root: proj, approve: async r => { asked = r; return answer; }, problems: { [path.join(proj, 'resources', 'sklep', 'server.lua')]: [{ line: 2, severity: 'błąd', message: 'undefined global' }] }, servers: { list: () => [{ id: 's', name: 'Serwer FX', typeName: 'FiveM', status: 'running' }], getLog: () => ['a', 'SCRIPT ERROR: @sklep/server.lua:2'] } });
  assert(!/node_modules/.test(await box.run('list_files', {})));
  assert(/2\| print\(cena\)/.test(await box.run('read_file', { path: 'resources/sklep/server.lua' })));
  await assert.rejects(box.run('read_file', { path: '../../etc/passwd' }), /poza folderem/);
  assert(/server\.lua:1: local cena = 10/.test(await box.run('search', { query: 'CENA = 10' })));
  await assert.rejects(box.run('edit_file', { path: 'resources/sklep/server.lua', old_text: 'print(cena)', new_text: 'x' }), /2 razy/);
  answer = false;
  assert(/odrzucił/.test(await box.run('edit_file', { path: 'resources/sklep/server.lua', old_text: 'local cena = 10', new_text: 'local cena = 20' })));
  assert(fs.readFileSync(path.join(proj, 'resources', 'sklep', 'server.lua'), 'utf8').startsWith('local cena = 10'));
  assert.strictEqual(asked.rel, 'resources/sklep/server.lua'); assert(asked.after.startsWith('local cena = 20'));
  answer = true;
  assert(/Zapisano/.test(await box.run('edit_file', { path: 'resources/sklep/server.lua', old_text: 'local cena = 10', new_text: 'local cena = 20' })));
  assert(fs.readFileSync(path.join(proj, 'resources', 'sklep', 'server.lua'), 'utf8').startsWith('local cena = 20'));
  assert(/Zapisano/.test(await box.run('write_file', { path: 'nowy/plik.lua', content: 'print(1)' })));
  assert(/undefined global/.test(await box.run('get_problems', {})));
  assert(/Serwer FX/.test(await box.run('server_log', {}))); assert(/SCRIPT ERROR/.test(await box.run('server_log', { server: 'serwer fx' })));
});

// udawany serwer API: kolejne odpowiedzi z listy, zapis zapytań
function fakeFetch(responses) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); const r = responses.shift(); return { ok: true, status: 200, text: async () => JSON.stringify(r) }; };
  f.calls = calls; return f;
}
t('asystent: tryb agenta – pętla narzędzi Claude (Anthropic), ChatGPT (OpenAI) i Gemini', async () => {
  const { Assistant } = require('../src/main/editor/assistant');
  const proj = path.join(root, 'proj2'); const file = w(path.join(proj, 'main.lua'), 'print("czesc")\n');
  const providers = { anthropic: { id: 'anthropic', kind: 'anthropic', name: 'Claude', base: 'https://a', model: 'claude-x', needsKey: true }, openai: { id: 'openai', kind: 'openai', name: 'ChatGPT', base: 'https://o', model: 'gpt-x', needsKey: true }, gemini: { id: 'gemini', kind: 'gemini', name: 'Gemini', base: 'https://g', model: 'gem', needsKey: true } };
  const mk = fetchImpl => { const steps = []; const a = new Assistant({ getProvider: id => ({ c: providers[id], key: 'k' }), fetchImpl, emit: (ch, d) => steps.push(d), approve: async () => true, onWrite: () => {} }); a.steps = steps; return a; };
  // Claude: read_file → edit_file → odpowiedź
  let f = fakeFetch([
    { content: [{ type: 'text', text: 'Sprawdzę plik.' }, { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'main.lua' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'tool_use', id: 't2', name: 'edit_file', input: { path: 'main.lua', old_text: 'print("czesc")', new_text: 'print("cześć")' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'Poprawiłem polskie znaki.' }], stop_reason: 'end_turn' },
  ]);
  let a = mk(f);
  let r = await a.send('s1', { provider: 'anthropic', mode: 'agent', text: 'popraw', context: { root: proj, file, rel: 'main.lua' }, autoApply: true });
  assert.strictEqual(r.text, 'Poprawiłem polskie znaki.'); assert.deepStrictEqual(r.written, ['main.lua']);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'print("cześć")\n');
  assert.strictEqual(f.calls.length, 3); assert(f.calls[0].body.tools.some(x => x.name === 'edit_file'));
  assert.strictEqual(f.calls[1].body.messages.at(-1).content[0].type, 'tool_result'); assert(/print\("czesc"\)/.test(f.calls[1].body.messages.at(-1).content[0].content));
  assert(/Folder projektu/.test(f.calls[0].body.messages[0].content));
  assert(a.steps.some(s => s.kind === 'tool' && s.name === 'read_file'));
  // OpenAI: wywołanie funkcji z argumentami w JSON
  f = fakeFetch([
    { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"query":"cześć"}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'Napis jest w main.lua w wierszu 1.' } }] },
  ]);
  a = mk(f);
  r = await a.send('s2', { provider: 'openai', mode: 'agent', text: 'gdzie jest napis?', context: { root: proj } });
  assert.strictEqual(r.text, 'Napis jest w main.lua w wierszu 1.');
  const last = f.calls[1].body.messages.at(-1); assert.strictEqual(last.role, 'tool'); assert.strictEqual(last.tool_call_id, 'c1'); assert(/main\.lua:1/.test(last.content));
  assert.strictEqual(f.calls[0].body.messages[0].role, 'system'); assert.strictEqual(f.calls[0].body.tools[0].type, 'function');
  // Gemini: functionCall / functionResponse
  f = fakeFetch([
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'list_files', args: {} } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'Projekt ma jeden plik.' }] } }] },
  ]);
  a = mk(f);
  r = await a.send('s3', { provider: 'gemini', mode: 'agent', text: 'co jest w projekcie?', context: { root: proj } });
  assert.strictEqual(r.text, 'Projekt ma jeden plik.');
  assert(/main\.lua/.test(f.calls[1].body.contents.at(-1).parts[0].functionResponse.response.result));
  // czat bez narzędzi i z pamięcią rozmowy
  f = fakeFetch([{ content: [{ type: 'text', text: 'Pierwsza.' }] }, { content: [{ type: 'text', text: 'Druga.' }] }]);
  a = mk(f);
  await a.send('c', { provider: 'anthropic', mode: 'chat', text: 'A', context: { content: 'print(1)', language: 'lua', file: 'x.lua' } });
  r = await a.send('c', { provider: 'anthropic', mode: 'chat', text: 'B', context: {} });
  assert.strictEqual(r.text, 'Druga.'); assert(!f.calls[0].body.tools); assert.strictEqual(f.calls[1].body.messages.length, 3);
  assert(/Treść pliku/.test(f.calls[0].body.messages[0].content));
  // brak klucza
  const nokey = new Assistant({ getProvider: () => ({ c: providers.openai, key: null }) });
  await assert.rejects(nokey.send('x', { provider: 'openai', text: 'a' }), /Brak klucza/);
});

t('asystent: agenci CLI (Claude Code – zdarzenia stream-json, wznawianie rozmowy)', async () => {
  const { Assistant, parseClaudeLine, CLI } = require('../src/main/editor/assistant');
  assert.deepStrictEqual(parseClaudeLine('{"type":"system","subtype":"init","session_id":"abc"}'), { session: 'abc' });
  const r = parseClaudeLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Robię' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/p/a.lua' } }] } }));
  assert.strictEqual(r.text, 'Robię\n'); assert.deepStrictEqual(r.tools, [{ name: 'Edit', summary: '/p/a.lua' }]);
  assert.deepStrictEqual(CLI['claude-code'].args({ allowEdits: true, resume: 'abc' }).slice(-4), ['--permission-mode', 'acceptEdits', '--resume', 'abc']);
  assert(CLI.codex.args({ allowEdits: false }).includes('read-only'));
  // udawany proces agenta (gdy claude jest w PATH)
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  if (process.platform === 'win32') return; // na Windowsie bez udawania programu w PATH
  fs.writeFileSync(script, '#!/bin/sh\ncat > /dev/null\necho \'{"type":"system","session_id":"s-1"}\'\necho \'{"type":"assistant","message":{"content":[{"type":"text","text":"Gotowe!"}]}}\'\necho \'{"type":"result","session_id":"s-1","is_error":false}\'\n'); fs.chmodSync(script, 0o755);
  const oldPath = process.env.PATH; process.env.PATH = bin + path.delimiter + oldPath;
  try {
    const a = new Assistant({ getProvider: () => ({}), emit: () => {} });
    const out = await a.send('cli', { provider: 'claude-code', text: 'zrób', context: { root } });
    assert.strictEqual(out.text, 'Gotowe!'); assert.strictEqual(a.sessions.get('cli').claudeSession, 's-1');
  } finally { process.env.PATH = oldPath; }
});

t('klucze AI: rozpoznawanie wielu kluczy z .env i po początku klucza', () => {
  const ai = require('../src/main/ai');
  // fałszywe klucze składane w trakcie testu (żeby skanery sekretów nie brały ich za prawdziwe)
  const rnd = (n, abc = 'abcdefghijklmnopqrstuvwxyz0123456789') => Array.from({ length: n }, (_, i) => abc[(i * 7 + 3) % abc.length]).join('');
  const K = { anthropic: ['sk', 'ant', 'api03', rnd(26)].join('-'), openai: ['sk', 'proj', rnd(23)].join('-'), mistral: rnd(32), gemini: 'AI' + 'za' + rnd(35), groq: 'gs' + 'k_' + rnd(30), openrouter: ['sk', 'or', 'v1', rnd(28)].join('-'), xai: 'xa' + 'i-' + rnd(24), deepseek: 'sk-' + rnd(32, '0123456789abcdef') };
  const text = ['# moje klucze', `${'ANTHROPIC'}_API_KEY=${K.anthropic}`, `export ${'OPENAI'}_API_KEY="${K.openai}"`, `$env:${'MISTRAL'}_API_KEY = "${K.mistral}"`, `${K.gemini}, ${K.groq}`, K.openrouter, K.xai, K.deepseek, 'INNY_TOKEN=zzz', 'nieznany-klucz-bardzo-dlugi-' + rnd(20)].join('\n');
  const r = ai.detectKeys(text);
  const by = Object.fromEntries(r.found.map(f => [f.provider, f]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['anthropic', 'deepseek', 'gemini', 'groq', 'mistral', 'openai', 'openrouter', 'xai']);
  for (const [p, k] of Object.entries(K)) assert.strictEqual(by[p].key, k, p);
  assert.strictEqual(by.openai.source, 'OPENAI_API_KEY'); assert.strictEqual(by.gemini.source, 'prefiks');
  assert.strictEqual(r.unknown.length, 2);
  assert.strictEqual(ai.guessProvider(K.anthropic), 'anthropic'); assert.strictEqual(ai.guessProvider('krotki'), null);
  assert.strictEqual(ai.ENV_FOR.gemini, 'GEMINI_API_KEY'); assert.strictEqual(ai.ENV_FOR.anthropic, 'ANTHROPIC_API_KEY');
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 5).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
