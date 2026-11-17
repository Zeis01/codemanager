// Testy funkcji wersji 1.5 (node test/run-tests-5.js)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test5-'));
let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);
const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };

// ---------- konflikty ----------
const conflicts = require('../src/main/mods/conflicts');
t('konflikty: wspólne pliki, zwycięzca, pliki opisowe pomijane', () => {
  const r = conflicts.analyze([{ name: 'A', files: ['tex/a.dds', 'tex/b.dds', 'readme.txt'] }, { name: 'B', files: ['tex/B.DDS', 'readme.txt', 'x.lua'] }, { name: 'C', files: ['tex/b.dds'] }], { winner: 'last' });
  assert.strictEqual(r.files, 1);
  assert.deepStrictEqual(r.groups[0].mods, ['A', 'B', 'C']);
  assert.strictEqual(r.groups[0].winner, 'C');
  assert.strictEqual(r.byMod.A.loses, 1); assert.strictEqual(r.byMod.C.wins, 1);
});
t('konflikty: Wiedźmin 3 – wygrywa mod ładowany pierwszy, tylko content/', () => {
  const d = path.join(root, 'w3', 'Mods');
  w(path.join(d, 'modB', 'content', 'scripts', 'game', 'player.ws')); w(path.join(d, 'modA', 'content', 'scripts', 'game', 'player.ws')); w(path.join(d, 'modA', 'readme.txt')); w(path.join(d, 'modB', 'readme.txt'));
  const mods = ['modB', 'modA'].map(n => ({ name: n.slice(3), file: path.join(d, n), enabled: true, version: '-' }));
  const r = conflicts.forGame({ id: 'witcher3', checker: 'witcher3' }, mods, []);
  assert(r.supported); assert.strictEqual(r.total, 1);
  assert.strictEqual(r.parts[0].groups[0].winner, 'A');
});
t('konflikty: mody z archiwów (rejestr) – wygrywa instalowany później', () => {
  const r = conflicts.forGame({ id: 'cyberpunk2077', checker: 'cyberpunk' }, [], [{ name: 'Nowy', files: ['archive/pc/mod/x.archive'], installedAt: 2 }, { name: 'Stary', files: ['archive/pc/mod/x.archive', 'r6/a.reds'], installedAt: 1 }]);
  assert.strictEqual(r.parts[0].groups[0].winner, 'Nowy');
  assert(!conflicts.forGame({ id: 'x', checker: 'files' }, [], []).supported);
});
t('instalacja z archiwum zapisuje pełną listę plików', async () => {
  const AdmZip = require('adm-zip'); const z = new AdmZip(); z.addFile('mods/Cool/lua/x.lua', Buffer.from('a')); z.addFile('mods/Cool/mod.txt', Buffer.from('{}'));
  const zf = path.join(root, 'pd2.zip'); z.writeZip(zf);
  const game = path.join(root, 'pd2'); fs.mkdirSync(path.join(game, 'mods'), { recursive: true });
  const { installArchive } = require('../src/main/online/archive');
  const out = await installArchive(zf, { game: { id: 'payday2', checker: 'payday2' }, target: path.join(game, 'mods'), gameRoot: game });
  assert(out.files.includes('mods/Cool/lua/x.lua'), JSON.stringify(out.files));
});

// ---------- kolejność ładowania ----------
const lo = require('../src/main/mods/loadorder');
t('kolejność: sortowanie topologiczne jest stabilne i wykrywa pętle', () => {
  const items = [{ k: 'c', a: ['a'] }, { k: 'b', a: [] }, { k: 'a', a: [] }];
  assert.deepStrictEqual(lo.topoSort(items, i => i.k, i => i.a).items.map(i => i.k), ['b', 'a', 'c']);
  const cyc = lo.topoSort([{ k: 'x', a: ['y'] }, { k: 'y', a: ['x'] }], i => i.k, i => i.a);
  assert.strictEqual(cyc.items.length, 2); assert.strictEqual(cyc.cycles.length, 1);
});
t('kolejność Bethesdy: mastery wyżej, plugin po swoich masterach, pliki gry zablokowane', () => {
  const items = [{ key: 'skyrim.esm', base: true, locked: true, master: true, after: [] }, { key: 'patch.esp', after: ['lib.esm', 'mod.esp'] }, { key: 'mod.esp', after: [] }, { key: 'lib.esm', master: true, after: [] }];
  const r = lo.bethesdaSort(items).items.map(i => i.key);
  assert.deepStrictEqual(r, ['skyrim.esm', 'lib.esm', 'mod.esp', 'patch.esp']);
});
t('kolejność RimWorld: Harmony, Core, DLC, potem loadAfter/loadBefore', () => {
  const it = (key, o = {}) => ({ key, active: true, after: [], before: [], ...o });
  const r = lo.rimSort([it('ui.mod', { after: ['lib.mod'] }), it('ludeon.rimworld.ideology'), it('lib.mod'), it('ludeon.rimworld'), it('brrainz.harmony'), it('early.mod', { before: ['lib.mod'] }), it('off.mod', { active: false })]).items.map(i => i.key);
  assert.deepStrictEqual(r.slice(0, 3), ['brrainz.harmony', 'ludeon.rimworld', 'ludeon.rimworld.ideology']);
  assert(r.indexOf('early.mod') < r.indexOf('lib.mod') && r.indexOf('lib.mod') < r.indexOf('ui.mod'));
  assert.strictEqual(r[r.length - 1], 'off.mod');
});

// ---------- migawki ----------
const { Snapshots } = require('../src/main/mods/snapshots');
t('migawki: zapis, przywracanie (z kopią bieżącego stanu), limit', async () => {
  const game = path.join(root, 'snapgame'); const mods = path.join(game, 'Mods');
  w(path.join(mods, 'a.dll'), 'v1'); const extra = w(path.join(root, 'cfg', 'plugins.txt'), '*a.esp');
  const s = new Snapshots(path.join(root, 'snaps'));
  const g = { id: 'testgame', checker: 'melonloader' };
  const ctx = { root: game, modsDir: mods, extra: [extra] };
  const m1 = await s.create(g, ctx, { label: 'start' });
  fs.writeFileSync(path.join(mods, 'a.dll'), 'v2'); w(path.join(mods, 'b.dll')); fs.writeFileSync(extra, '');
  await s.restore(g, ctx, m1.id);
  assert.strictEqual(fs.readFileSync(path.join(mods, 'a.dll'), 'utf8'), 'v1');
  assert(!fs.existsSync(path.join(mods, 'b.dll')));
  assert.strictEqual(fs.readFileSync(extra, 'utf8'), '*a.esp');
  const list = s.list('testgame'); assert.strictEqual(list.length, 2); assert(list.some(x => x.reason === 'przed przywróceniem'));
  for (let i = 0; i < 4; i++) await s.create(g, ctx, { keep: 3 });
  assert.strictEqual(s.list('testgame').length, 3);
  await assert.rejects(s.create(g, ctx, { maxBytes: 1 }), /za dużo/);
});

// ---------- udostępnianie ----------
const share = require('../src/main/mods/share');
t('udostępnianie: kod CM1 w obie strony i plan importu', () => {
  const jar = w(path.join(root, 'mc', 'mods', 'sodium.jar'), 'jar');
  const p = share.build({ id: 'minecraft', checker: 'minecraft' }, 'Mój', [{ name: 'Sodium', id: 'sodium', version: '0.5', file: jar, enabled: true, toggleable: true }, { name: 'Iris', id: 'iris', version: '1.7', enabled: false }], { mcVersion: '1.21.1', loader: 'fabric' });
  assert.strictEqual(p.mods[0].h.length, 40);
  const code = share.encode(p); assert(code.startsWith('CM1:'));
  const back = share.decode(code); assert.strictEqual(back.name, 'Mój'); assert.strictEqual(back.mc.version, '1.21.1');
  assert.throws(() => share.decode('CM1:zepsute!!'), /uszkodzony/); assert.throws(() => share.decode('abc'), /CM1/);
  const plan = share.plan(back, [{ name: 'Sodium', id: 'sodium', enabled: false, toggleable: true, file: jar }, { name: 'Extra', id: 'extra', enabled: true, toggleable: true, file: 'x/extra.jar' }]);
  assert.strictEqual(plan.toggle.length, 1); assert.strictEqual(plan.toggle[0].want, true);
  assert.strictEqual(plan.download.length, 0); assert.strictEqual(plan.extra[0].name, 'Extra');
});

// ---------- duplikaty ----------
const dupes = require('../src/main/mods/dupes');
t('duplikaty: ten sam mod w dwóch wersjach i identyczne pliki', () => {
  assert.strictEqual(dupes.baseName('sodium-fabric-0.5.8+mc1.20.1.jar'), 'sodium');
  assert.strictEqual(dupes.baseName('sodium-fabric-mc1.20.1-0.5.3.jar.disabled'), 'sodium');
  const a = w(path.join(root, 'd', 'sodium-fabric-0.5.8+mc1.20.1.jar'), 'A'); const b = w(path.join(root, 'd', 'sodium-fabric-mc1.20.1-0.5.3.jar'), 'B');
  const c = w(path.join(root, 'd', 'lib.jar'), 'SAME'); const d = w(path.join(root, 'd', 'library-copy.jar'), 'SAME');
  const g = dupes.find([{ name: 'S1', file: a, version: '0.5.8' }, { name: 'S2', file: b, version: '0.5.3' }, { name: 'L', file: c }, { name: 'L2', file: d }]);
  assert(g.find(x => /różnych wersjach/.test(x.reason)).keep === a);
  assert(g.find(x => /Identyczne/.test(x.reason)));
});

// ---------- notatki i kosz ----------
const { Notes, Trash } = require('../src/main/mods/store');
t('notatki i tagi', () => {
  const n = new Notes(path.join(root, 'notes.json'));
  n.set('mc', { id: 'Sodium', file: 'x/sodium.jar' }, { tags: ['tylko klient', 'tylko klient', 'moje'], note: 'szybki' });
  assert.deepStrictEqual(new Notes(path.join(root, 'notes.json')).forGame('mc').sodium.tags, ['tylko klient', 'moje']);
  assert(n.allTags('mc').includes('moje'));
  n.set('mc', { id: 'sodium' }, { tags: [], note: '' }); assert(!n.forGame('mc').sodium);
});
t('kosz: przeniesienie, przywrócenie, czyszczenie po 30 dniach', () => {
  const tr = new Trash(path.join(root, 'trash'));
  const f = w(path.join(root, 'tm', 'mod.jar'), 'jar'); const dir = path.join(root, 'tm', 'folder'); w(path.join(dir, 'a.txt'));
  const m = tr.put(f, { gameId: 'mc' }); tr.put(dir, { gameId: 'pz' });
  assert(!fs.existsSync(f)); assert.strictEqual(tr.list('mc').length, 1);
  w(f, 'nowy');
  const r = tr.restore(m.id); assert(/przywrócony/.test(r.restoredTo)); assert.strictEqual(fs.readFileSync(r.restoredTo, 'utf8'), 'jar');
  assert.strictEqual(tr.purge(Date.now() + 31 * 86400000), 1); assert.strictEqual(tr.list().length, 0);
});

// ---------- bisekcja ----------
const bisect = require('../src/main/mods/bisect');
t('bisekcja: znajduje winowajcę w log2(n) rundach i przywraca stan', () => {
  const mods = Array.from({ length: 10 }, (_, i) => ({ name: 'M' + i, id: 'm' + i, enabled: i !== 9, toggleable: true }));
  let s = bisect.start(mods, { keepOn: ['m0'] });
  assert.strictEqual(s.suspects.length, 8);
  let rounds = 0;
  while (!s.done) {
    const want = bisect.desired(s);
    const problem = want.get('m5') === true; // winowajca: m5
    s = bisect.answer(s, problem); rounds++;
  }
  assert.strictEqual(s.culprit, 'm5'); assert(rounds <= 3);
  const want = bisect.desired(s); assert.strictEqual(want.get('m9'), false); assert.strictEqual(want.get('m5'), true);
  const ch = bisect.changes(mods.map(m => ({ ...m, enabled: false })), want); assert.strictEqual(ch.length, 9);
  assert.throws(() => bisect.start([{ name: 'a', enabled: true, toggleable: true }]), /co najmniej 2/);
});

// ---------- synchronizacja ----------
const sync = require('../src/main/servers/sync');
t('synchronizacja: porównanie modów serwera z graczem, paczka ZIP, PZ', () => {
  const S = new Map([['a', { id: 'a', name: 'A', version: '1', env: '*', file: w(path.join(root, 'srv', 'a.jar')) }], ['b', { id: 'b', name: 'B', version: '2', env: '*' }], ['s', { id: 's', name: 'S', version: '1', env: 'server' }]]);
  const C = new Map([['b', { id: 'b', version: '1', file: 'c/b.jar' }], ['x', { id: 'x', version: '1', env: '*' }]]);
  const r = sync.compareMaps(S, C, { needed: s => s.env !== 'server', onlyClientRisky: c => c.env === '*' });
  assert.deepStrictEqual(r.missing.map(x => x.id), ['a']); assert.strictEqual(r.mismatch[0].clientVersion, '1'); assert.strictEqual(r.extra[0].id, 'x');
  const zip = sync.makePack(r.missing, path.join(root, 'pack.zip'));
  const names = new (require('adm-zip'))(zip).getEntries().map(e => e.entryName); assert(names.includes('mods/a.jar') && names.includes('CZYTAJ-MNIE.txt'));
  const ini = w(path.join(root, 'pz.ini'), 'Mods=ModA;ModB\nWorkshopItems=111;222\n');
  const p = sync.comparePZ(ini, ['moda']); assert.deepStrictEqual(p.missing.map(m => m.id), ['ModB']); assert.strictEqual(p.workshop.length, 2);
});

// ---------- monitor ----------
const mon = require('../src/main/servers/monitor');
t('monitor: gracze, czat, Chunky z logów', () => {
  assert.deepStrictEqual(mon.parseLine('minecraft', '[12:00:01] [Server thread/INFO]: Steve joined the game'), [{ kind: 'join', name: 'Steve' }]);
  assert.strictEqual(mon.parseLine('minecraft', '[12:00:01] [Server thread/INFO]: <Alex> cześć')[0].text, 'cześć');
  assert.strictEqual(mon.parseLine('minecraft', '[Server thread/INFO]: There are 2 of a max of 20 players online: Steve, Alex')[0].names.length, 2);
  assert.strictEqual(mon.parseLine('rust', '1.2.3.4:5/76561198000000000/Gracz Jeden joined [windows/76561198000000000]')[0].name, 'Gracz Jeden');
  const ch = mon.parseLine('minecraft', '[Server thread/INFO]: [Chunky] Task running for minecraft:overworld. Processed: 1,234 chunks (12.50%), ETA: 0:10:00, Rate: 99.0 cps')[0];
  assert.strictEqual(ch.kind, 'chunky'); assert.strictEqual(ch.pct, 12.5); assert.strictEqual(ch.chunks, 1234);
  const events = []; const m = new mon.Monitor({ mgr: { procs: new Map() }, emit: (c, d) => events.push([c, d]) });
  m.onLine('s1', 'minecraft', ': Steve joined the game'); m.onLine('s1', 'minecraft', ': Alex joined the game'); m.onLine('s1', 'minecraft', ': Steve left the game');
  assert.deepStrictEqual(m.players('s1').players, ['Alex']); assert(events.some(e => e[0] === 'server:players'));
  m.onLine('v', 'valheim', 'Connections 3 ZDOS:1234'); assert.strictEqual(m.count('v'), 3);
});
t('monitor: suma CPU/RAM procesu z potomkami i parsowanie danych z Windows', () => {
  const tot = mon.treeTotals([{ pid: 1, ppid: 0, cpuMs: 100, rss: 10 }, { pid: 2, ppid: 1, cpuMs: 50, rss: 5 }, { pid: 3, ppid: 2, cpuMs: 1, rss: 1 }, { pid: 4, ppid: 9, cpuMs: 999, rss: 999 }], 1);
  assert.deepStrictEqual(tot, { cpuMs: 151, rss: 16, count: 3 });
  const csv = '"ProcessId","ParentProcessId","KernelModeTime","UserModeTime","WorkingSetSize"\r\n"100","4","20000000","30000000","1048576"\r\n';
  assert.deepStrictEqual(mon.parseWinCsv(csv)[0], { pid: 100, ppid: 4, cpuMs: 5000, rss: 1048576 });
});
t('monitor: próbkowanie zapisuje historię (Linux /proc)', async () => {
  if (process.platform !== 'linux') return;
  const events = []; const m = new mon.Monitor({ mgr: { procs: new Map([['me', { pid: process.pid }]]) }, emit: (c, d) => events.push(d) });
  await m.sample(); await new Promise(r => setTimeout(r, 120)); await m.sample();
  const h = m.history('me'); assert.strictEqual(h.length, 2); assert(h[1].mem > 1e6); assert(h[1].cpu != null);
});

// ---------- formularz konfiguracji ----------
const cf = require('../src/main/servers/configform');
t('formularz: server.properties, JSON, TOML, Palworld – zapis zachowuje resztę pliku', () => {
  const props = cf.applyText('properties', '#komentarz\nmotd=Stary\npvp=true\n', { motd: 'Nowy serwer', pvp: false, 'view-distance': '10' });
  assert.strictEqual(props, '#komentarz\nmotd=Nowy serwer\npvp=false\nview-distance=10\n');
  const json = JSON.parse(cf.applyText('json', '{"Settings":{"MaxSlots":8,"Other":1}}', { 'Settings.MaxSlots': 16, 'Settings.ServerName': 'X' }));
  assert.deepStrictEqual(json.Settings, { MaxSlots: 16, Other: 1, ServerName: 'X' });
  const toml = cf.applyText('toml', '[General]\nName = "Stary" # nazwa\nPort = 30814\n[Misc]\nX = 1\n', { 'General.Name': 'Nowy', 'General.MaxPlayers': 10 });
  assert(/Name = "Nowy" # nazwa/.test(toml) && /\[General\][\s\S]*MaxPlayers = 10[\s\S]*\[Misc\]/.test(toml), toml);
  const pal = cf.applyText('palworld', '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(Difficulty=None,ServerName="A,B",ExpRate=1.000000)\n', { ServerName: 'Mój', ExpRate: '2', bEnableFriendlyFire: true });
  const vals = cf.readValues('palworld', pal); assert.strictEqual(vals.ServerName, 'Mój'); assert.strictEqual(vals.ExpRate, '2'); assert.strictEqual(vals.bEnableFriendlyFire, 'True'); assert.strictEqual(vals.Difficulty, 'None');
});
t('formularz: odczyt i zapis z walidacją liczb', () => {
  const s = { type: 'minecraft', path: path.join(root, 'mcsrv'), settings: {} };
  w(path.join(s.path, 'server.properties'), 'motd=Hej\nmax-players=20\ndifficulty=easy\n');
  const f = cf.read(s); const fld = f.groups[0].fields.find(x => x.k === 'max-players'); assert.strictEqual(fld.value, '20');
  assert.throws(() => cf.write(s, { 'max-players': 'dużo' }), /liczba/);
  assert.throws(() => cf.write(s, { 'view-distance': 99 }), /maksimum/);
  cf.write(s, { 'max-players': 30, pvp: false, nieznane: 1 });
  const t2 = fs.readFileSync(path.join(s.path, 'server.properties'), 'utf8'); assert(/max-players=30/.test(t2) && /pvp=false/.test(t2) && !/nieznane/.test(t2));
  assert(fs.existsSync(path.join(s.path, 'server.properties.bak')));
  assert.strictEqual(cf.read({ type: 'valheim' }), null);
});

// ---------- powiadomienia ----------
const { Notifier, WEBHOOK } = require('../src/main/notify');
t('powiadomienia: Discord (z ponowieniem po 429) i systemowe według ustawień', async () => {
  const url = 'https://discord.com/api/webhooks/123/abc-DEF';
  assert(WEBHOOK.test(url) && !WEBHOOK.test('https://evil.com/api/webhooks/1/a'));
  const calls = []; let n = 0; const sys = [];
  const settings = { discord: { url, events: { join: true } }, notifications: { events: { crash: true, backup: false } } };
  const no = new Notifier({ getSettings: () => settings, system: (a, b) => sys.push(a), fetchImpl: async (u, o) => { calls.push(JSON.parse(o.body)); n++; return n === 1 ? { status: 429, ok: false, json: async () => ({ retry_after: 0.01 }) } : { status: 204, ok: true }; } });
  no.event('crash', { name: 'S', port: 1 }, { code: 1 });
  no.event('backup', { name: 'S' }, { size: 1048576 });
  no.event('join', { name: 'S', discord: { disabled: true } }, { player: 'Steve' });
  await new Promise(r => setTimeout(r, 3000));
  assert.deepStrictEqual(sys, ['Serwer padł']);
  assert.strictEqual(calls.length, 3); // crash (429 + ponowienie) i backup; join wyłączony dla serwera
  assert(/padł|wyłączył/.test(calls[0].embeds[0].description) || /wyłączył/.test(calls[0].embeds[0].description));
  await assert.rejects(no.test('https://x.pl'), /webhooka/);
});

// ---------- harmonogram: rotacja i zadania ----------
const { selectKeep, dueTasks } = require('../src/main/servers/scheduler');
t('rotacja kopii: N ostatnich oraz dzienne/tygodniowe/miesięczne', () => {
  const now = new Date(2026, 10, 17, 12).getTime(); const H = 3600000;
  const files = Array.from({ length: 60 }, (_, i) => ({ path: 'f' + i, time: now - i * 12 * H })); // co 12 godzin, 30 dni
  assert.strictEqual(selectKeep(files, { mode: 'count', keep: 5 }).size, 5);
  const k = selectKeep(files, { mode: 'gfs', daily: 7, weekly: 4, monthly: 2 });
  assert(k.has('f0')); assert(k.size >= 7 && k.size <= 13, String(k.size));
  assert(!k.has('f1')); // ten sam dzień co f0
});
t('zadania: o godzinie (raz na minutę), co X minut, dni tygodnia', () => {
  const at = new Date(2026, 10, 17, 4, 0, 10).getTime(); // wtorek
  const tasks = [{ id: 'a', at: '4:00, 16:00', kind: 'say' }, { id: 'b', every: 30, kind: 'command' }, { id: 'c', at: '04:00', days: [0], kind: 'backup' }, { id: 'd', at: '04:00', enabled: false }];
  assert.deepStrictEqual(dueTasks(tasks, at, {}).map(x => x.id), ['a', 'b']);
  assert.deepStrictEqual(dueTasks(tasks, at + 20000, { a: at, b: at }).map(x => x.id), []);
  assert.deepStrictEqual(dueTasks(tasks, at + 30 * 60000, { a: at, b: at }).map(x => x.id), ['b']);
});

// ---------- porty i UPnP ----------
const ports = require('../src/main/servers/ports');
t('porty serwerów i opis routera UPnP', () => {
  assert.deepStrictEqual(ports.portsFor({ type: 'valheim', port: 2456 }).map(p => p.port), [2456, 2457, 2458]);
  assert.strictEqual(ports.portsFor({ type: 'minecraft', port: 25565 })[0].proto, 'TCP');
  const xml = '<root><URLBase>http://192.168.1.1:5000/</URLBase><device><friendlyName>Router X</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:Layer3:1</serviceType><controlURL>/l3</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>';
  const d = ports.parseDescription(xml, 'http://192.168.1.1:5000/desc.xml');
  assert.strictEqual(d.controlURL, 'http://192.168.1.1:5000/ctl/IPConn'); assert.strictEqual(d.name, 'Router X');
  assert(/<NewExternalPort>25565<\/NewExternalPort>/.test(ports.soapBody(d.serviceType, 'AddPortMapping', { NewExternalPort: 25565 })));
});
t('UPnP: polecenia SOAP do routera (lokalny serwer testowy)', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    seen.push(req.headers.soapaction);
    if (/GetExternalIPAddress/.test(req.headers.soapaction)) return res.end('<s:Envelope><s:Body><u:R><NewExternalIPAddress>83.1.2.3</NewExternalIPAddress></u:R></s:Body></s:Envelope>');
    if (/AddPortMapping/.test(req.headers.soapaction) && /<NewExternalPort>1<\/NewExternalPort>/.test(b)) { res.statusCode = 500; return res.end('<errorCode>718</errorCode><errorDescription>ConflictInMappingEntry</errorDescription>'); }
    res.end('<ok/>');
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const u = new ports.Upnp(); u.gw = { controlURL: `http://127.0.0.1:${srv.address().port}/ctl`, serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1', host: '127.0.0.1' };
  try {
    assert.strictEqual(await u.externalIp(), '83.1.2.3');
    const r = await u.add({ port: 25565, proto: 'TCP', client: '192.168.1.5' }); assert.strictEqual(r.client, '192.168.1.5');
    await assert.rejects(u.add({ port: 1, proto: 'TCP', client: '192.168.1.5' }), /ConflictInMappingEntry/);
    assert(seen.every(s => /WANIPConnection:1#/.test(s)));
  } finally { srv.close(); }
  const ext = await ports.checkExternal(25565, async () => ({ ok: true, json: async () => ({ ip: '1.1.1.1', port: 25565, reachable: true }) }));
  assert.strictEqual(ext.reachable, true);
});

// ---------- szablony ----------
const templates = require('../src/main/servers/templates');
t('szablony: kroki (frameworki i mody z Modrinth) wykonywane po instalacji', async () => {
  const done = [];
  const fake = { servers: { log: () => {}, installFramework: async (id, fw) => done.push('fw:' + fw) }, modrinth: { install: async (slug, ctx) => { done.push(`${slug}@${ctx.loader}/${ctx.mcVersion}/${path.basename(ctx.modsDir)}`); return [{}]; } } };
  await templates.runSteps(templates.byId('cs2-css'), { id: 's', path: '/x' }, fake);
  await templates.runSteps(templates.byId('mc-paper-basic'), { id: 's', path: '/x', variant: 'paper', version: '1.21.1' }, fake);
  assert.deepStrictEqual(done.slice(0, 2), ['fw:metamod2', 'fw:counterstrikesharp']);
  assert(done.includes('luckperms@paper/1.21.1/plugins'));
  for (const tpl of templates.TEMPLATES) assert(require('../src/main/servers/defs2').TYPES[tpl.type], tpl.id);
});

// ---------- uruchamianie i czas gry ----------
const launch = require('../src/main/games/launch');
t('uruchamianie: Steam z parametrami, exe, loader SKSE', () => {
  const g = { id: 'testg', exe: ['bin/game.exe'], appIds: [123] };
  const dir = path.join(root, 'lg'); w(path.join(dir, 'bin', 'game.exe'));
  assert.deepStrictEqual(launch.splitArgs('-a "b c" -d'), ['-a', 'b c', '-d']);
  assert.strictEqual(launch.plan(g, { path: dir, source: 'Steam', appid: 123 }, { args: '-windowed' }).url, 'steam://run/123//-windowed/');
  const ex = launch.plan(g, { path: dir, source: 'Steam' }, { method: 'exe', args: '-x' }); assert.strictEqual(path.basename(ex.cmd), 'game.exe'); assert.deepStrictEqual(ex.args, ['-x']);
  const sk = path.join(root, 'sse'); w(path.join(sk, 'SkyrimSE.exe')); w(path.join(sk, 'skse64_loader.exe'));
  assert.strictEqual(launch.plan({ id: 'skyrimse', exe: ['SkyrimSE.exe'], appIds: [489830] }, { path: sk, source: 'Steam' }, {}).label, 'skse64_loader.exe');
  assert.throws(() => launch.plan({ id: 'x', exe: ['nie.exe'] }, { path: dir, source: 'Ręcznie' }, {}), /Nie znaleziono pliku gry/);
});
t('czas gry: sesje i suma na podstawie listy procesów', () => {
  assert.deepStrictEqual(launch.parseTasklist('"System","4","Services","0","1 K"\r\n"Game.exe","123","Console","1","100 K"'), ['system', 'game.exe']);
  const games = [{ id: 'g1', exe: ['bin/Game.exe'] }, { id: 'g2', exe: ['Other.exe'] }];
  const p = new launch.PlayTime(path.join(root, 'pt.json'), { games, getDetected: () => ({ games: { g1: { found: true }, g2: { found: true } } }), interval: 30000 });
  const t0 = Date.now();
  p.update(['game.exe'], t0); p.update(['game.exe'], t0 + 30000); p.update([], t0 + 60000);
  const d = p.all().g1; assert.strictEqual(d.total, 30000); assert.strictEqual(d.sessions, 1); assert(!d.current);
  assert.strictEqual(p.recent()[0].id, 'g1');
});

// ---------- zapisy gier ----------
const saves = require('../src/main/games/saves');
t('zapisy gier: Minecraft (saves instancji) i chmura Steam jako zapas', () => {
  const inst = path.join(root, 'inst'); fs.mkdirSync(path.join(inst, 'saves', 'Świat'), { recursive: true });
  assert.deepStrictEqual(saves.paths({ id: 'minecraft' }, { profileRoot: inst }), [path.join(inst, 'saves')]);
  const steam = path.join(root, 'steamroot'); fs.mkdirSync(path.join(steam, 'userdata', '42', '999', 'remote'), { recursive: true });
  assert.deepStrictEqual(saves.paths({ id: 'nieznana' }, { steamRoots: [steam], appid: 999 }), [path.join(steam, 'userdata', '42', '999', 'remote')]);
});

// ---------- raport, analizator, instalatory, wykrywanie ----------
t('raport do wysłania: mody, problemy, system, anonimizacja ścieżek', () => {
  const report = require('../src/main/report');
  const txt = report.build({ appVersion: '1.5.0', target: { kind: 'game', name: 'Minecraft', path: path.join(os.homedir(), 'gry', 'mc') }, report: { meta: { Loader: 'fabric' }, issues: [{ level: 'error', title: 'Brak Fabric API', fix: 'Zainstaluj' }], counts: { error: 1, warn: 0 }, mods: [{ name: 'Sodium|X', version: '0.5', enabled: true, source: 'mods' }] }, analysis: { findings: [{ level: 'error', title: 'Awaria', why: 'bo', fix: 'tak' }] }, logTail: 'linia1\nlinia2' });
  assert(/CodeManager 1\.5\.0/.test(txt) && /\[BŁĄD\] Brak Fabric API/.test(txt) && /Sodium\/X/.test(txt) && /linia2/.test(txt));
  assert(!txt.includes(os.homedir()) && txt.includes('%USERPROFILE%'));
});
t('analizator: linki do wklejek zamieniane na surowy tekst', async () => {
  const a = require('../src/main/analyzer');
  assert.strictEqual(a.rawUrl('https://mclo.gs/AbC12'), 'https://api.mclo.gs/1/raw/AbC12');
  assert.strictEqual(a.rawUrl('https://pastebin.com/xYz'), 'https://pastebin.com/raw/xYz');
  assert.strictEqual(a.rawUrl('https://gist.github.com/user/abc123'), 'https://gist.githubusercontent.com/user/abc123/raw');
  assert.throws(() => a.rawUrl('ftp://x'), /http/);
  const r = await a.fetchLog('https://mclo.gs/AbC12', async u => ({ ok: true, headers: { get: () => 'text/plain' }, text: async () => 'Exception in thread ' + u }));
  assert(r.text.includes('api.mclo.gs'));
  await assert.rejects(a.fetchLog('https://example.com/x', async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => '<html><body>' })), /raw/);
});
t('SKSE/F4SE: wybór archiwum do wersji gry', () => {
  const { pickSeArchive, SE } = require('../src/main/installers');
  const html = '<a href="beta/skse64_2_02_06.7z">Current</a> <a href="beta/skse64_2_02_06_gog.7z">GOG</a> <a href="beta/skse64_2_00_20.7z">SE 1.5.97</a>';
  assert.strictEqual(pickSeArchive(html, SE.skse, '1.6.1170.0', false), 'skse64_2_02_06.7z');
  assert.strictEqual(pickSeArchive(html, SE.skse, '1.6.1179.0', true), 'skse64_2_02_06_gog.7z');
  assert.strictEqual(pickSeArchive(html, SE.skse, '1.5.97.0', false), 'skse64_2_00_20.7z');
  assert.strictEqual(require('../src/main/installers').status('skse', path.join(root, 'sse')).installed, true);
});
t('wykrywanie: wartości rejestru i gry z GOG / Xbox / EA', () => {
  const d = require('../src/main/detect');
  assert.deepStrictEqual(d.parseRegValues('HKEY_LOCAL_MACHINE\\X\r\n    path    REG_SZ    C:\\GOG Games\\Witcher 3\r\n    Install Dir    REG_SZ    D:\\EA\\Game\r\n', 'path'), ['C:\\GOG Games\\Witcher 3']);
  const xbox = path.join(root, 'XboxGames', 'Game', 'Content'); w(path.join(xbox, 'sub', 'Game.exe'));
  const m = d.matchCandidate({ exe: ['Game.exe'] }, [{ path: xbox, source: 'Xbox / Game Pass' }]);
  assert.strictEqual(m.path, path.join(xbox, 'sub')); assert.strictEqual(m.source, 'Xbox / Game Pass');
});
t('tłumaczenie: słownik angielski bez polskich znaków i ze zgodnymi wzorcami', () => {
  const ctx = { window: {} }; require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/js/i18n-en.js'), 'utf8'), ctx);
  const d = ctx.window.I18N_EN;
  assert(Object.keys(d.exact).length > 800);
  const bad = Object.entries(d.exact).filter(([, v]) => /[ąćęłńśźż]/.test(v)); assert.deepStrictEqual(bad, []);
  for (const [pl, en] of d.patterns) assert.strictEqual(pl.split('{}').length, en.split('{}').length, pl);
  assert.strictEqual(d.exact['Ustawienia'], 'Settings');
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 4).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
