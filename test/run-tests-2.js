// Testy funkcji wersji 1.1 (node test/run-tests-2.js)
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const AdmZip = require('adm-zip');
const assert = require('assert');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test2-'));
let passed = 0, failed = 0; const queue = [];
function t(name, fn) { queue.push([name, fn]); }
const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const zip = (p, files) => { const z = new AdmZip(); for (const [n, c] of Object.entries(files)) z.addFile(n, Buffer.from(c)); fs.mkdirSync(path.dirname(p), { recursive: true }); z.writeZip(p); return p; };
const has = (rep, level, re) => rep.issues.some(i => i.level === level && re.test(i.title));
const U = require('../src/main/util');

// ---------- analizator ----------
const A = require('../src/main/analyzer');
t('analizator: brakujący mod Fabric', () => {
  const r = A.analyzeText(`[main/ERROR]: Incompatible mods found!\n - Mod 'Iris' (iris) 1.7.0 requires any version of mod 'Sodium' (sodium), which is missing!\n`);
  assert(r.findings.some(f => /Sodium/.test(f.title) && f.action && f.action.type === 'modrinth-dep' && f.action.modId === 'sodium'), JSON.stringify(r.findings.map(f => f.title)));
});
t('analizator: za stara Java', () => { const r = A.analyzeText('java.lang.UnsupportedClassVersionError: x has been compiled by a more recent version of the Java Runtime (class file version 65.0)'); assert(r.findings[0].title.includes('Java 21')); });
t('analizator: brak pamięci', () => { const r = A.analyzeText('Exception in thread "main" java.lang.OutOfMemoryError: Java heap space'); assert(r.findings.some(f => /pamięci/.test(f.title))); });
t('analizator: port zajęty', () => { const r = A.analyzeText('[Server thread/WARN]: **** FAILED TO BIND TO PORT!\njava.net.BindException: Address already in use'); assert(r.findings.some(f => /Port/.test(f.title))); });
t('analizator: BepInEx brakująca zależność', () => { const r = A.analyzeText('[Error  :   BepInEx] Could not load [MoreCompany 1.9.1] because it has missing dependencies: com.sigurd.csync\n'); assert(r.findings.some(f => /MoreCompany/.test(f.title))); });
t('analizator: mod klienta na serwerze', () => { const r = A.analyzeText('Attempted to load class net/minecraft/client/gui/screen/Screen for invalid dist DEDICATED_SERVER'); assert(r.findings.some(f => /klienta/.test(f.title))); });
t('analizator: podejrzany mod i ślad stosu', () => {
  const mods = path.join(root, 'mc', 'mods');
  zip(path.join(mods, 'bad.jar'), { 'fabric.mod.json': '{"id":"bad","name":"Zły Mod"}', 'com/evil/badmod/core/Thing.class': 'x' });
  const idx = A.buildPackageIndex(mods);
  const r = A.analyzeText('---- Minecraft Crash Report ----\nDescription: Ticking entity\njava.lang.NullPointerException\n\tat com.evil.badmod.core.Thing.tick(Thing.java:10)\n\tat com.evil.badmod.core.Thing.run(Thing.java:20)\n\tat net.minecraft.world.World.tick(World.java:1)\n', { pkgIndex: idx });
  assert(r.findings.some(f => f.rule === 'stack' && f.mod === 'Zły Mod'));
});
t('analizator: SMAPI', () => { const r = A.analyzeText('[SMAPI] Skipped mods\n[SMAPI]    - Better Crafting because it needs mods which aren\'t installed (leclair.spacecore).'); assert(r.findings.some(f => /Better Crafting/.test(f.title))); });
t('analizator: streszczenie raportu', () => {
  const s = A.summarizeReport({ issues: [{ level: 'error', title: 'X wymaga moda "y"', action: { type: 'modrinth-dep' } }, { level: 'warn', title: 'z' }] });
  assert.strictEqual(s.tone, 'error'); assert(s.steps[0].includes('brakujące')); assert.strictEqual(s.fixable, 1);
});

// ---------- profile ----------
const { Profiles } = require('../src/main/profiles');
t('profile modów: zapis i plan', () => {
  const P = new Profiles(path.join(root, 'prof.json'));
  const mods = [{ key: 'a.jar', file: '/m/a.jar', enabled: true, toggleable: true }, { key: 'b.jar.disabled', file: '/m/b.jar.disabled', enabled: false, toggleable: true }, { key: 'c', file: '/m/c.jar', enabled: true, toggleable: false }];
  const p = P.create('minecraft', 'x', 'Test', mods);
  assert.deepStrictEqual(p.enabled, ['a.jar']);
  const now = [{ key: 'a.jar.disabled', file: '/m/a.jar.disabled', enabled: false, toggleable: true }, { key: 'b.jar', file: '/m/b.jar', enabled: true, toggleable: true }];
  const plan = P.plan('minecraft', 'x', p.id, now);
  assert.strictEqual(plan.changes.length, 2);
});

// ---------- RCON ----------
const { SourceRcon, packet } = require('../src/main/rcon');
t('RCON: uwierzytelnienie i polecenie (serwer testowy)', () => new Promise((resolve, reject) => {
  const srv = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const size = buf.readInt32LE(0); if (buf.length < size + 4) break;
        const id = buf.readInt32LE(4), type = buf.readInt32LE(8), body = buf.toString('utf8', 12, 4 + size - 2);
        buf = buf.subarray(4 + size);
        if (type === 3) sock.write(packet(body === 'tajne' ? id : -1, 2, ''));
        if (type === 2) sock.write(packet(id, 0, body === 'list' ? 'There are 2 of a max of 20 players online: Ala, Ola' : '?'));
      }
    });
  }).listen(0, async () => {
    try {
      const c = new SourceRcon({ host: '127.0.0.1', port: srv.address().port, password: 'tajne' });
      await c.connect();
      const r = await c.exec('list');
      assert(/Ala, Ola/.test(r));
      c.close();
      const bad = new SourceRcon({ host: '127.0.0.1', port: srv.address().port, password: 'zle' });
      await assert.rejects(() => bad.connect(), /hasło/);
      srv.close(); resolve();
    } catch (e) { srv.close(); reject(e); }
  });
}));

// ---------- nowe gry ----------
const G2 = require('../src/main/compat/games2');
t('RimWorld: wersja, zależności, kolejność', () => {
  const gp = path.join(root, 'rim');
  w(path.join(gp, 'Version.txt'), '1.5.4104 rev435');
  w(path.join(gp, 'Data', 'Core', 'About', 'About.xml'), '<ModMetaData><packageId>ludeon.rimworld</packageId><name>Core</name></ModMetaData>');
  w(path.join(gp, 'Mods', 'A', 'About', 'About.xml'), '<ModMetaData><packageId>a.mod</packageId><name>Mod A</name><supportedVersions><li>1.4</li></supportedVersions><modDependencies><li><packageId>brrainz.harmony</packageId><displayName>Harmony</displayName></li></modDependencies></ModMetaData>');
  w(path.join(gp, 'Mods', 'H', 'About', 'About.xml'), '<ModMetaData><packageId>brrainz.harmony</packageId><name>Harmony</name><supportedVersions><li>1.5</li></supportedVersions></ModMetaData>');
  const home = U.home; U.home = () => path.join(root, 'home');
  w(path.join(root, 'home', 'AppData', 'LocalLow', 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Config', 'ModsConfig.xml'), '<ModsConfigData><version>1.5</version><activeMods><li>ludeon.rimworld</li><li>a.mod</li><li>brrainz.harmony</li></activeMods></ModsConfigData>');
  const r = G2.checkRimWorld({ gamePath: gp, workshop: [], settings: {} });
  assert(has(r, 'error', /nie wspiera RimWorld 1\.5/)); assert(has(r, 'error', /przed swoją zależnością/)); assert(has(r, 'warn', /Harmony powinien/));
  G2.rimToggle('a.mod', false);
  assert(!/a\.mod/.test(fs.readFileSync(path.join(root, 'home', 'AppData', 'LocalLow', 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Config', 'ModsConfig.xml'), 'utf8')));
  U.home = home;
});
t('Stardew: SMAPI, zależności, pakiety zawartości', () => {
  const gp = path.join(root, 'sdv');
  w(path.join(gp, 'Mods', 'CP', 'manifest.json'), JSON.stringify({ Name: 'Content Patcher', UniqueID: 'Pathoschild.ContentPatcher', Version: '2.0.0', EntryDll: 'ContentPatcher.dll' }));
  w(path.join(gp, 'Mods', 'CP', 'ContentPatcher.dll'), 'x');
  w(path.join(gp, 'Mods', 'Pack', 'manifest.json'), JSON.stringify({ Name: 'Ładne domy', UniqueID: 'x.houses', Version: '1.0.0', ContentPackFor: { UniqueID: 'Pathoschild.ContentPatcher', MinimumVersion: '2.1.0' } }));
  w(path.join(gp, 'Mods', 'Need', 'manifest.json'), JSON.stringify({ Name: 'Wymagający', UniqueID: 'x.need', Version: '1.0.0', EntryDll: 'Need.dll', Dependencies: [{ UniqueID: 'spacechase0.SpaceCore' }] }));
  w(path.join(gp, 'Mods', '.Off', 'manifest.json'), JSON.stringify({ Name: 'Wyłączony', UniqueID: 'x.off', Version: '1' }));
  const r = G2.checkStardew({ gamePath: gp, settings: {} });
  assert(has(r, 'error', /SMAPI nie jest/)); assert(has(r, 'error', /Content Patcher ≥ 2\.1\.0/)); assert(has(r, 'error', /wymaga moda spacechase0/)); assert(has(r, 'error', /brak pliku Need\.dll/));
  assert.strictEqual(r.mods.find(m => m.id === 'x.off').enabled, false);
});
t('Factorio: wersja i zależności', () => {
  const gp = path.join(root, 'fac'); w(path.join(gp, 'data', 'base', 'info.json'), JSON.stringify({ version: '2.0.15' }));
  w(path.join(gp, 'config-path.cfg'), 'use-system-read-write-data-directories=false');
  const md = path.join(gp, 'mods');
  zip(path.join(md, 'old_1.0.0.zip'), { 'old_1.0.0/info.json': JSON.stringify({ name: 'old', version: '1.0.0', factorio_version: '1.1', dependencies: ['base >= 1.1'] }) });
  zip(path.join(md, 'needy_1.0.0.zip'), { 'needy_1.0.0/info.json': JSON.stringify({ name: 'needy', version: '1.0.0', factorio_version: '2.0', dependencies: ['base >= 2.0', 'flib >= 0.15', '! old', '? optional-thing'] }) });
  w(path.join(md, 'mod-list.json'), JSON.stringify({ mods: [{ name: 'base', enabled: true }, { name: 'old', enabled: true }, { name: 'needy', enabled: true }] }));
  const r = G2.checkFactorio({ gamePath: gp, settings: {} });
  assert(has(r, 'error', /jest dla Factorio 1\.1/)); assert(has(r, 'error', /wymaga moda flib/)); assert(has(r, 'error', /niezgodny z old/));
  G2.factorioToggle(gp, 'old', false);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(md, 'mod-list.json'))).mods.find(m => m.name === 'old').enabled, false);
});
t('Skyrim: mastery i SKSE', () => {
  const gp = path.join(root, 'sse');
  const plugin = (masters, flags = 0) => { const subs = Buffer.concat(masters.map(m => { const s = Buffer.from(m + '\0', 'latin1'); const h = Buffer.alloc(6); h.write('MAST', 0, 'latin1'); h.writeUInt16LE(s.length, 4); return Buffer.concat([h, s, Buffer.from([0x44, 0x41, 0x54, 0x41, 8, 0]), Buffer.alloc(8)]); })); const h = Buffer.alloc(24); h.write('TES4', 0, 'latin1'); h.writeUInt32LE(subs.length, 4); h.writeUInt32LE(flags, 8); return Buffer.concat([h, subs]); };
  w(path.join(gp, 'Data', 'Skyrim.esm'), plugin([], 1)); w(path.join(gp, 'Data', 'Update.esm'), plugin(['Skyrim.esm'], 1));
  w(path.join(gp, 'Data', 'Mod.esp'), plugin(['Skyrim.esm', 'Missing.esm']));
  w(path.join(gp, 'Data', 'Patch.esp'), plugin(['Skyrim.esm', 'Late.esp']));
  w(path.join(gp, 'Data', 'Late.esp'), plugin(['Skyrim.esm']));
  w(path.join(gp, 'skse64_1_6_640.dll'), 'x');
  const exe = Buffer.alloc(200); Buffer.from([0xbd, 0x04, 0xef, 0xfe]).copy(exe, 100); exe.writeUInt32LE(0x00010000, 104); exe.writeUInt32LE((1 << 16) | 6, 108); exe.writeUInt32LE((1170 << 16) | 0, 112);
  w(path.join(gp, 'SkyrimSE.exe'), exe);
  const la = U.localAppData; U.localAppData = () => path.join(root, 'lad');
  w(path.join(root, 'lad', 'Skyrim Special Edition', 'plugins.txt'), '# test\n*Mod.esp\n*Patch.esp\n*Late.esp\n');
  const r = G2.checkBethesda({ game: { id: 'skyrimse', name: 'Skyrim SE' }, gamePath: gp, settings: {} });
  assert(has(r, 'error', /SKSE64 jest dla wersji 1\.6\.640/), r.issues.map(i => i.title).join(' | '));
  assert(has(r, 'error', /wymaga pliku Missing\.esm/)); assert(has(r, 'error', /Patch\.esp jest ładowany przed swoim masterem Late\.esp/));
  G2.pluginsTxtToggle('skyrimse', 'Mod.esp', false);
  assert(/^Mod\.esp$/m.test(fs.readFileSync(path.join(root, 'lad', 'Skyrim Special Edition', 'plugins.txt'), 'utf8')));
  U.localAppData = la;
});
t('7 Days to Die: struktura i EAC', () => {
  const gp = path.join(root, '7d');
  w(path.join(gp, 'Mods', 'Good', 'ModInfo.xml'), '<xml><Name value="Good"/><Version value="1.0"/></xml>'); w(path.join(gp, 'Mods', 'Good', 'x.dll'), 'x');
  w(path.join(gp, 'Mods', 'Deep', 'Deep', 'ModInfo.xml'), '<xml><Name value="Deep"/></xml>');
  const ad = U.appData; U.appData = () => path.join(root, 'ad');
  const r = G2.checkSevenDays({ gamePath: gp, settings: {} });
  U.appData = ad;
  assert(has(r, 'error', /o jeden folder za głęboko/)); assert(has(r, 'warn', /EasyAntiCheat/));
});

// ---------- serwisy (offline) ----------
const MR = require('../src/main/online/modrinth');
t('Modrinth: odczyt .mrpack', () => {
  const f = zip(path.join(root, 'pack.mrpack'), { 'modrinth.index.json': JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1.0', name: 'Moja paczka', files: [{ path: 'mods/a.jar', hashes: { sha1: 'x' }, downloads: ['https://cdn.modrinth.com/a.jar'], env: { client: 'required', server: 'unsupported' } }], dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.5' } }), 'overrides/config/a.toml': 'x=1' });
  const p = MR.readMrpack(f);
  assert.strictEqual(p.loader, 'fabric'); assert.strictEqual(p.mcVersion, '1.21.1'); assert.strictEqual(p.files.length, 1);
  assert.deepStrictEqual(MR.loadersFor('quilt'), ['quilt', 'fabric']);
});
const TS = require('../src/main/online/thunderstore');
t('Thunderstore: instalacja wg układu r2modman', () => {
  const gr = path.join(root, 'lc');
  const z1 = zip(path.join(root, 'p1.zip'), { 'manifest.json': '{"name":"Lib","version_number":"1.0.0","dependencies":[]}', 'plugins/Lib.dll': 'x', 'config/lib.cfg': 'a=1' });
  TS.installZip(z1, gr, 'Autor', 'Lib');
  assert(fs.existsSync(path.join(gr, 'BepInEx', 'plugins', 'Autor-Lib', 'Lib.dll'))); assert(fs.existsSync(path.join(gr, 'BepInEx', 'config', 'lib.cfg')));
  const z2 = zip(path.join(root, 'p2.zip'), { 'BepInExPack/winhttp.dll': 'x', 'BepInExPack/BepInEx/core/BepInEx.dll': 'x', 'manifest.json': '{}' });
  TS.installZip(z2, gr, 'BepInEx', 'BepInExPack');
  assert(fs.existsSync(path.join(gr, 'winhttp.dll'))); assert(fs.existsSync(path.join(gr, 'BepInEx', 'core', 'BepInEx.dll')));
  assert.deepStrictEqual(TS.parseInput('https://thunderstore.io/c/lethal-company/p/notnotnotswipez/MoreCompany/'), { ns: 'notnotnotswipez', name: 'MoreCompany', version: null });
  assert.deepStrictEqual(TS.splitFull('BepInEx-BepInExPack-5.4.2100'), { ns: 'BepInEx', name: 'BepInExPack', version: '5.4.2100' });
});
t('r2modman: odczyt .r2z', () => {
  const f = zip(path.join(root, 'p.r2z'), { 'export.r2x': 'profileName: Moja\nmods:\n  - name: BepInEx-BepInExPack\n    version:\n      major: 5\n      minor: 4\n      patch: 2100\n    enabled: true\n  - name: Autor-Mod\n    version: { major: 1, minor: 2, patch: 3 }\n    enabled: false\n', 'BepInEx/config/x.cfg': 'a' });
  const p = TS.readR2z(f);
  assert.strictEqual(p.name, 'Moja'); assert.strictEqual(p.mods[1].version, '1.2.3'); assert.strictEqual(p.mods[1].enabled, false);
});
const NX = require('../src/main/online/nexus');
t('Nexus: link nxm://', () => { const p = NX.parseNxm('nxm://skyrimspecialedition/mods/266/files/12345?key=abc&expires=999&user_id=1'); assert.deepStrictEqual([p.domain, p.modId, p.fileId, p.key, p.expires], ['skyrimspecialedition', 266, 12345, 'abc', '999']); });
const { installArchive } = require('../src/main/online/archive');
t('instalacja archiwum: Stardew (manifest) i Skyrim (Data)', async () => {
  const games = require('../src/main/games');
  const a1 = zip(path.join(root, 'sd.zip'), { 'Wrapper/CoolMod/manifest.json': '{"UniqueID":"a"}', 'Wrapper/CoolMod/CoolMod.dll': 'x' });
  const t1 = path.join(root, 'sdvi', 'Mods');
  await installArchive(a1, { game: games.byId('stardew'), target: t1, gameRoot: path.join(root, 'sdvi') });
  assert(fs.existsSync(path.join(t1, 'CoolMod', 'manifest.json')));
  const a2 = zip(path.join(root, 'sk.zip'), { 'Data/Mod.esp': 'x', 'Data/meshes/a.nif': 'x' });
  const gr = path.join(root, 'skyi');
  await installArchive(a2, { game: games.byId('skyrimse'), target: path.join(gr, 'Data'), gameRoot: gr });
  assert(fs.existsSync(path.join(gr, 'Data', 'Mod.esp'))); assert(fs.existsSync(path.join(gr, 'Data', 'meshes', 'a.nif')));
});

// ---------- serwery ----------
t('defs2: komendy startowe nowych typów', () => {
  const { TYPES } = require('../src/main/servers/defs2');
  for (const id of ['palworld', 'ark', 'satisfactory', 'enshrouded', 'spaceengineers', 'mcproxy']) {
    const tp = TYPES[id];
    const s = { path: '/srv/' + id, port: tp.port, variant: tp.variants ? tp.variants[0].id : null, settings: Object.fromEntries((tp.fields || []).map(f => [f.id, f.def])) };
    const st = tp.start(s); assert(st.cmd && Array.isArray(st.args), id);
  }
  const ark = TYPES.ark.start({ path: '/a', port: 7777, variant: 'asa', settings: { map: 'TheIsland_WP', hostname: 'X', adminpassword: 'p', maxplayers: '10', rconport: '27020', mods: '123,456' } });
  assert(ark.args[0].startsWith('TheIsland_WP?listen')); assert(ark.args.includes('-mods=123,456'));
  assert.strictEqual(TYPES.rust.rcon({ port: 28015, settings: { rconpassword: 'x' } }).protocol, 'webrcon');
});
t('kopia zapasowa świata i przywracanie (tar)', async () => {
  const { Scheduler } = require('../src/main/servers/scheduler');
  const sp = path.join(root, 'srvmc');
  w(path.join(sp, 'server.properties'), 'level-name=world\n'); w(path.join(sp, 'world', 'level.dat'), 'ORYGINAL');
  const logs = [];
  const mgr = { servers: [{ id: 's1', type: 'minecraft', name: 'Test MC', path: sp, settings: {}, schedule: { keep: 2 } }], procs: new Map(), get(id) { return this.servers[0]; }, log: (i, l) => logs.push(l), save() {}, command() {} };
  const sch = new Scheduler(mgr, path.join(root, 'ud')); sch.stop();
  const b = await sch.backup('s1');
  assert(fs.existsSync(b.file));
  fs.writeFileSync(path.join(sp, 'world', 'level.dat'), 'ZEPSUTY');
  await sch.restore('s1', b.file);
  assert.strictEqual(fs.readFileSync(path.join(sp, 'world', 'level.dat'), 'utf8'), 'ORYGINAL');
  await sch.backup('s1'); await sch.backup('s1');
  assert(sch.list('s1').length <= 2);
  const next = sch.nextRestart({ schedule: { restart: { enabled: true, mode: 'daily', time: '05:00' } } }, new Date('2026-11-16T04:00:00'));
  assert.strictEqual(new Date(next).getHours(), 5);
});
t('serwery: Satisfactory SML, Palworld, proxy', () => {
  const SC = require('../src/main/servers/check');
  const sp = path.join(root, 'sat');
  w(path.join(sp, 'FactoryGame', 'Mods', 'Ficsit', 'Ficsit.uplugin'), JSON.stringify({ FriendlyName: 'Ficsit Tools', SemVersion: '1.0.0', GameVersion: '>=400000', Plugins: [{ Name: 'SML', SemVersion: '^3.8.0' }, { Name: 'MAM', SemVersion: '^1.0.0' }] }));
  w(path.join(sp, 'Engine', 'Binaries', 'Linux', 'FactoryServer-Linux-Shipping.version'), JSON.stringify({ Changelist: 365306 }));
  const r = SC.check({ type: 'satisfactory', path: sp, settings: {} });
  assert(has(r, 'error', /SML/)); assert(has(r, 'error', /wymaga nowszej wersji gry/)); assert(has(r, 'error', /wymaga moda MAM/));
  const pp = path.join(root, 'velo');
  zip(path.join(pp, 'plugins', 'bukkitonly.jar'), { 'plugin.yml': 'name: EssentialsX\nversion: 2\nmain: com.earth2me.essentials.Essentials\n' });
  zip(path.join(pp, 'plugins', 'lp.jar'), { 'velocity-plugin.json': JSON.stringify({ id: 'luckperms', name: 'LuckPerms', version: '5', dependencies: [{ id: 'nope', optional: false }] }) });
  const r2 = SC.check({ type: 'mcproxy', variant: 'velocity', path: pp, settings: {} });
  assert(has(r2, 'error', /EssentialsX to plugin dla serwera Paper/)); assert(has(r2, 'error', /wymaga pluginu nope/));
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ✔ ' + name); }
    catch (e) { failed++; console.log('  ✖ ' + name + '\n    ' + String(e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
