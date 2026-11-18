// Testy wersji 1.7.0: nowe gry (VPK, Farming Simulator, BeamNG, GTA SA/IV, Hollow Knight, Assetto Corsa, ATS) i serwery (Unturned, L4D2, RedM)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test8-'));
process.env.HOME = root; process.env.USERPROFILE = root; process.env.LOCALAPPDATA = path.join(root, 'AppData', 'Local'); process.env.APPDATA = path.join(root, 'AppData', 'Roaming');
let passed = 0, failed = 0; const queue = [];
const t = (n, f) => queue.push([n, f]);
const w = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const zip = (p, files) => { const z = new AdmZip(); for (const [n, c] of Object.entries(files)) z.addFile(n, Buffer.from(c)); fs.mkdirSync(path.dirname(p), { recursive: true }); z.writeZip(p); return p; };
const compat = () => require('../src/main/compat');
const { byId, GAMES } = require('../src/main/games');
const info = p => ({ found: true, path: p, workshop: [] });

// minimalny VPK v1 (dane w tym samym pliku)
function vpk(file, entries) {
  const groups = {};
  for (const [name, data] of Object.entries(entries)) { const ext = path.extname(name).slice(1) || ' '; const dir = path.dirname(name) === '.' ? ' ' : path.dirname(name); const base = path.basename(name, path.extname(name)); ((groups[ext] = groups[ext] || {})[dir] = groups[ext][dir] || []).push([base, Buffer.from(data)]); }
  const parts = []; const blobs = []; let off = 0;
  const z = s => Buffer.from(s + '\0', 'latin1');
  for (const [ext, dirs] of Object.entries(groups)) {
    parts.push(z(ext));
    for (const [dir, files] of Object.entries(dirs)) {
      parts.push(z(dir));
      for (const [base, data] of files) { const m = Buffer.alloc(18); m.writeUInt32LE(0, 0); m.writeUInt16LE(0, 4); m.writeUInt16LE(0x7fff, 6); m.writeUInt32LE(off, 8); m.writeUInt32LE(data.length, 12); m.writeUInt16LE(0xffff, 16); parts.push(z(base), m); blobs.push(data); off += data.length; }
      parts.push(z(''));
    }
    parts.push(z(''));
  }
  parts.push(z(''));
  const tree = Buffer.concat(parts); const h = Buffer.alloc(12); h.writeUInt32LE(0x55aa1234, 0); h.writeUInt32LE(1, 4); h.writeUInt32LE(tree.length, 8);
  w(file, Buffer.concat([h, tree, ...blobs])); return file;
}

t('definicje: 26 nowych gier z unikalnymi ID i domenami Nexus', () => {
  const ids = ['subnautica', 'subnauticabz', 'unturned', 'theforest', 'phasmophobia', 'amongus', 'hollowknight', 'raft', 'workersresources', 'prisonarchitect', 'assettocorsa', 'beamng', 'ats', 'fs17', 'fs19', 'fs22', 'fs25', 'wreckfest', 'mygarage', 'cms2018', 'cms2021', 'stormworks', 'farcry3', 'farcry4', 'farcry5', 'farcry6', 'dyinglight', 'dyinglight2', 'gtasa', 'gta4', 'l4d', 'l4d2'];
  for (const id of ids) { const g = byId(id); assert(g, id); assert(g.appIds.length && g.exe.length && g.desc, id); }
  assert.strictEqual(new Set(GAMES.map(g => g.id)).size, GAMES.length);
  const nx = require('../src/main/online/nexus'); assert.strictEqual(nx.DOMAINS.fs22, 'farmingsimulator22'); assert.strictEqual(nx.DOMAINS.gta4, 'gta4'); assert.strictEqual(nx.DOMAINS.skyrimse, 'skyrimspecialedition');
});

t('VPK: spis plików, addoninfo i konflikty dodatków w L4D2', () => {
  const g = path.join(root, 'l4d2'); const ad = path.join(g, 'left4dead2', 'addons');
  vpk(path.join(ad, 'tank.vpk'), { 'addoninfo.txt': '"AddonInfo"\n{\n addontitle "Nowy Tank"\n addonversion "2.1"\n}', 'models/infected/hulk.mdl': 'A', 'scripts/vscripts/director.nut': 'x' });
  vpk(path.join(ad, 'workshop', '123456.vpk'), { 'models/infected/hulk.mdl': 'B', 'scripts/vscripts/director.nut': 'y' });
  w(path.join(ad, 'zly.vpk'), 'nie vpk');
  w(path.join(g, 'left4dead2', 'addonlist.txt'), '"AddonList"\n{\n\t"workshop\\123456.vpk"\t\t"1"\n\t"zly.vpk"\t\t"0"\n}\n');
  const G4 = require('../src/main/compat/games4');
  const v = G4.readVpk(path.join(ad, 'tank.vpk')); assert.deepStrictEqual(v.files.sort(), ['addoninfo.txt', 'models/infected/hulk.mdl', 'scripts/vscripts/director.nut']);
  assert.strictEqual(G4.addonInfo(G4.vpkRead(path.join(ad, 'tank.vpk'), v, 'addoninfo.txt').toString()).addontitle, 'Nowy Tank');
  const r = compat().check('l4d2', info(g));
  const tank = r.mods.find(m => m.name === 'Nowy Tank'); assert.strictEqual(tank.version, '2.1');
  assert.strictEqual(r.mods.find(m => /zly/.test(m.file)).enabled, false, 'wyłączony w addonlist');
  assert(r.issues.some(i => /Konflikt: .*Nowy Tank/.test(i.title) && i.level === 'warn'));
  assert(!r.issues.some(i => /zly/.test(i.title)), 'wyłączony dodatek nie jest sprawdzany');
  // przełączanie przez addonlist.txt
  compat().toggle(r.mods.find(m => /123456/.test(m.file)), { gameId: 'l4d2', gamePath: g });
  assert(/"workshop\\123456\.vpk"\s+"0"/.test(fs.readFileSync(path.join(g, 'left4dead2', 'addonlist.txt'), 'utf8')));
  compat().toggle(tank, { gameId: 'l4d2', gamePath: g });
  assert(/"tank\.vpk"\s+"0"/.test(fs.readFileSync(path.join(g, 'left4dead2', 'addonlist.txt'), 'utf8')));
  assert.strictEqual(compat().modsTarget('l4d2', null, info(g)), ad);
});

t('Farming Simulator: descVersion innej części, zależności, złe nazwy, duplikaty', () => {
  const dir = path.join(root, 'Documents', 'My Games', 'FarmingSimulator2022', 'mods');
  const desc = (v, deps = '') => `<?xml version="1.0"?><modDesc descVersion="${v}"><author>Ja</author><version>1.0.0.0</version><title><en>Traktor</en></title>${deps}</modDesc>`;
  zip(path.join(dir, 'FS22_Traktor.zip'), { 'modDesc.xml': desc(72, '<dependencies><dependency>FS22_Brak</dependency></dependencies>') });
  zip(path.join(dir, 'FS22_Stary.zip'), { 'modDesc.xml': desc(45) });
  zip(path.join(dir, 'FS22_Traktor (1).zip'), { 'modDesc.xml': desc(72) });
  zip(path.join(dir, 'Paczka.zip'), { 'FS22_A/modDesc.xml': desc(72) });
  w(path.join(dir, 'FS22_Mod.rar'));
  const docs = require('../src/main/util').documentsCandidates; require('../src/main/util').documentsCandidates = () => [path.join(root, 'Documents')];
  try {
    const r = compat().check('fs22', info(path.join(root, 'fsgame')));
    const tit = r.issues.map(i => i.title).join('\n');
    assert(/FS22_Traktor wymaga moda FS22_Brak/.test(tit));
    assert(/FS22_Stary: mod do Farming Simulator 19 \(descVersion 45\)/.test(tit));
    assert(/FS22_Traktor \(1\): nieprawidłowa nazwa/.test(tit));
    assert(/Paczka: brak modDesc\.xml/.test(tit));
    assert(/FS22_Mod\.rar: gra czyta tylko pliki \.zip/.test(tit));
    assert(/Prawdopodobny duplikat: FS22_Traktor/.test(tit));
    assert.strictEqual(r.mods.find(m => m.id === 'FS22_Traktor').name, 'Traktor');
    assert.strictEqual(compat().modsTarget('fs22', null, info('x')), dir);
  } finally { require('../src/main/util').documentsCandidates = docs; }
});

t('BeamNG: db.json, konflikty pojazdów, zła struktura, przełączanie', () => {
  const dir = path.join(process.env.LOCALAPPDATA, 'BeamNG', 'BeamNG.drive', 'current', 'mods');
  zip(path.join(dir, 'car_a.zip'), { 'vehicles/supra/supra.jbeam': '{}', 'vehicles/supra/info.json': '{}' });
  zip(path.join(dir, 'car_b.zip'), { 'vehicles/supra/supra.jbeam': '{}' });
  zip(path.join(dir, 'zle.zip'), { 'Folder/vehicles/x/x.jbeam': '{}' });
  zip(path.join(dir, 'repo', 'mapa.zip'), { 'levels/wyspa/info.json': '{}' });
  w(path.join(dir, 'db.json'), JSON.stringify({ header: { version: 1.1 }, mods: { car_b: { active: false, filename: '/mods/car_b.zip' }, mapa: { active: true, filename: '/mods/repo/mapa.zip', modData: { title: 'Wyspa', version_string: '1.2' } } } }));
  const r = compat().check('beamng', info(path.join(root, 'bng')));
  assert.strictEqual(r.mods.find(m => /car_b/.test(m.file)).enabled, false);
  assert.strictEqual(r.mods.find(m => /mapa/.test(m.file)).name, 'Wyspa');
  assert(r.issues.some(i => /zle: nietypowa struktura/.test(i.title)));
  assert(!r.issues.some(i => /Konflikt/.test(i.title)), 'car_b wyłączony – brak konfliktu');
  compat().toggle(r.mods.find(m => /car_b/.test(m.file)), {});
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'))).mods.car_b.active, true);
  const r2 = compat().check('beamng', info(path.join(root, 'bng')));
  assert(r2.issues.some(i => /Konflikt: .*vehicles\/supra/.test(i.title)));
});

t('GTA San Andreas: wersja exe, brak ASI Loadera i CLEO, mody modloadera', () => {
  const g = path.join(root, 'gtasa');
  w(path.join(g, 'gta_sa.exe'), Buffer.alloc(5189632));
  w(path.join(g, 'scripts', 'mod.asi')); w(path.join(g, 'mod.asi')); w(path.join(g, 'cleo', 'skrypt.cs')); fs.mkdirSync(path.join(g, 'modloader', 'Auto'), { recursive: true }); fs.mkdirSync(path.join(g, 'modloader', '.Wyl'), { recursive: true });
  const r = compat().check('gtasa', info(g)); const tit = r.issues.map(i => i.title).join('\n');
  assert.strictEqual(r.meta['Wersja gry'], '1.0 US (Compact)');
  assert(/brak ASI Loadera/.test(tit)); assert(/CLEO nie jest zainstalowane/.test(tit)); assert(/brak modloader\.asi/.test(tit)); assert(/mod\.asi jest w kilku folderach/.test(tit));
  assert.strictEqual(r.mods.find(m => m.name === 'Wyl').enabled, false);
  const g2 = path.join(root, 'gtasa-new'); w(path.join(g2, 'gta-sa.exe'), 'x'); w(path.join(g2, 'dinput8.dll'));
  assert(compat().check('gtasa', info(g2)).issues.some(i => /nie obsługuje CLEO/.test(i.title)));
});

t('GTA IV i Hollow Knight: loadery, ScriptHookDotNet, Modding API, duplikaty', () => {
  const g = path.join(root, 'gta4', 'GTAIV'); w(path.join(g, 'GTAIV.exe'), 'MZ'); w(path.join(g, 'plugins', 'x.asi')); w(path.join(g, 'scripts', 'Trainer.net.dll'));
  const r = compat().check('gta4', info(path.join(root, 'gta4'))); const tit = r.issues.map(i => i.title).join('\n');
  assert(/brak ASI Loadera/.test(tit)); assert(/ScriptHookDotNet/.test(tit)); assert(/FusionFix/.test(tit));
  assert.strictEqual(compat().modsTarget('gta4', null, info(path.join(root, 'gta4'))), g);
  const hk = path.join(root, 'hk'); const m = path.join(hk, 'hollow_knight_Data', 'Managed');
  w(path.join(m, 'Assembly-CSharp.dll'), 'zwykły');
  w(path.join(m, 'Mods', 'Satchel', 'Satchel.dll')); w(path.join(m, 'Mods', 'Benchwarp', 'Benchwarp.dll')); w(path.join(m, 'Mods', 'Benchwarp', 'Satchel.dll')); fs.mkdirSync(path.join(m, 'Mods', 'Pusty'));
  w(path.join(m, 'Mods', 'Disabled', 'Stary', 'Stary.dll'));
  const h = compat().check('hollowknight', info(hk)); const ht = h.issues.map(i => i.title).join('\n');
  assert(/brakuje Modding API/.test(ht)); assert(/satchel\.dll jest w kilku modach/.test(ht)); assert(/Pusty: w folderze moda nie ma pliku \.dll/.test(ht));
  assert.strictEqual(h.mods.find(x => x.name === 'Stary').enabled, false);
  w(path.join(m, 'Assembly-CSharp.dll'), 'xx Modding.ModHooks xx');
  assert.strictEqual(compat().check('hollowknight', info(hk)).meta['Modding API'], 'zainstalowane');
});

t('Assetto Corsa i ATS: mody aut/torów, oryginalne pomijane, folder ATS', () => {
  const g = path.join(root, 'ac');
  w(path.join(g, 'content', 'cars', 'ks_ferrari_488', 'data.acd')); w(path.join(g, 'content', 'cars', 'abarth500', 'data.acd'));
  w(path.join(g, 'content', 'cars', 'mod_bmw', 'body.kn5')); w(path.join(g, 'content', 'cars', 'mod_bmw', 'ui', 'ui_car.json'), '{"name":"BMW M4","version":"1.1"}'); fs.mkdirSync(path.join(g, 'content', 'cars', 'mod_bmw', 'data'));
  w(path.join(g, 'content', 'cars', 'mod_zly', 'ui', 'ui_car.json'), '{"name":"Zły"}');
  w(path.join(g, 'content', 'tracks', 'nordschleife', 'track.kn5'));
  const r = compat().check('assettocorsa', info(g)); const tit = r.issues.map(i => i.title).join('\n');
  assert.deepStrictEqual(r.mods.map(m => m.name).sort(), ['BMW M4', 'Zły', 'nordschleife']);
  assert(/BMW M4: dane auta są rozpakowane/.test(tit)); assert(/Zły: brak data\.acd i folderu data/.test(tit)); assert(/Zły: brak modelu \.kn5/.test(tit)); assert(/nordschleife: brak data\/surfaces\.ini/.test(tit));
  const docs = require('../src/main/util').documentsCandidates; require('../src/main/util').documentsCandidates = () => [path.join(root, 'Documents')];
  try {
    zip(path.join(root, 'Documents', 'American Truck Simulator', 'mod', 'truck.scs'), { 'manifest.sii': 'SiiNunit\n{\nmod_package : .package_name\n{\n display_name: "Peterbilt"\n package_version: "2.0"\n compatible_versions[]: "1.53.*"\n}\n}\n' });
    const a = compat().check('ats', { ...info(path.join(root, 'atsgame')), workshop: [] }, null, { gameVersion: '1.54.1' });
    assert.strictEqual(a.title, 'American Truck Simulator'); assert.strictEqual(a.mods[0].name, 'Peterbilt');
    assert(a.issues.some(i => /oznaczony dla 1\.53/.test(i.title)));
    assert(compat().modsTarget('ats', null, info('x')).endsWith(path.join('American Truck Simulator', 'mod')));
  } finally { require('../src/main/util').documentsCandidates = docs; }
});

t('lista modów z wykluczeniami (Dying Light) i rozszerzeniami (Raft)', () => {
  const g = path.join(root, 'dl'); w(path.join(g, 'DW', 'Data0.pak')); w(path.join(g, 'DW', 'Data1.pak')); w(path.join(g, 'DW', 'Data2.pak'));
  assert.deepStrictEqual(compat().check('dyinglight', info(g)).mods.map(m => m.name), ['Data2']);
  const rf = path.join(root, 'raft'); w(path.join(rf, 'mods', 'Mod.rmod')); w(path.join(rf, 'mods', 'readme.txt'));
  assert.deepStrictEqual(compat().check('raft', info(rf)).mods.map(m => m.name), ['Mod.rmod']);
});

t('Warsztat: pobrany dodatek L4D2 trafia do addons/workshop', () => {
  const ws = require('../src/main/online/workshop'); const item = path.join(root, 'ws-item'); w(path.join(item, 'x.vpk'), 'v');
  const out = ws.installItem(byId('l4d2'), item, '777', path.join(root, 'l4d2t', 'addons'));
  assert.strictEqual(out[0], path.join(root, 'l4d2t', 'addons', 'workshop', '777.vpk'));
});

t('serwery: Unturned (Commands.dat, Warsztat, sprawdzanie), L4D2, RedM', async () => {
  require('../src/main/servers/defs2');
  const { TYPES, FRAMEWORKS, srcGame } = require('../src/main/servers/defs');
  const D = require('../src/main/servers/defs3');
  for (const k of ['unturned', 'l4d2', 'redm']) assert(TYPES[k] && TYPES[k].start && TYPES[k].install, k);
  const p = path.join(root, 'srv-unt'); const s = { type: 'unturned', path: p, port: 27020, settings: { serverid: 'Moj Serwer', hostname: 'Test', map: 'Washington', maxplayers: '12', password: '' } };
  const st = TYPES.unturned.start(s);
  assert.deepStrictEqual(st.args.slice(-1), ['+InternetServer/Moj_Serwer']);
  const cmds = fs.readFileSync(path.join(p, 'Servers', 'Moj_Serwer', 'Server', 'Commands.dat'), 'utf8');
  assert(/^Port 27020$/m.test(cmds) && /^Map Washington$/m.test(cmds) && !/^Password/m.test(cmds));
  assert.strictEqual(D.setCommand('Name A\nPort 1\n', 'Port', 2), 'Name A\nPort 2\n');
  await TYPES.unturned.workshopAdd(s, 'https://steamcommunity.com/sharedfiles/filedetails/?id=1234567', () => {});
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(p, 'Servers', 'Moj_Serwer', 'WorkshopDownloadConfig.json'))).File_IDs, [1234567]);
  w(path.join(p, 'Servers', 'Moj_Serwer', 'Rocket', 'Plugins', 'Kits.dll'), 'MZ');
  const rep = require('../src/main/servers/check').check(s); const tit = rep.issues.map(i => i.title).join('\n');
  assert(/Kits\.dll leży w Rocket\/Plugins, ale ten framework nie jest zainstalowany/.test(tit)); assert(/Brak tokenu GSLT/.test(tit));
  assert(rep.mods.some(m => m.name === 'Warsztat #1234567'));
  w(path.join(p, 'Modules', 'Rocket.Unturned', 'Rocket.Unturned.dll')); assert(FRAMEWORKS.rocketmod.status(s));
  const l = { type: 'l4d2', path: path.join(root, 'srv-l4d2'), port: 27015, settings: { map: 'c2m1_highway', gamemode: 'versus', rconpassword: 'abc' } };
  assert.strictEqual(srcGame(l), 'left4dead2'); assert(TYPES.l4d2.start(l).args.includes('left4dead2')); assert(TYPES.l4d2.start(l).args.includes('versus'));
  assert(/mp_gamemode "versus"/.test(D.l4d2Cfg({ settings: { hostname: 'x', rconpassword: 'abc', gamemode: 'versus' } })));
  assert(!FRAMEWORKS.sourcemod.status(l)); w(path.join(l.path, 'left4dead2', 'addons', 'sourcemod', 'x')); assert(FRAMEWORKS.sourcemod.status(l));
  const cfg = D.redmCfg({ port: 30120, settings: { hostname: 'R', license: 'K', gamebuild: '1491' } });
  assert(/set gamename rdr3/.test(cfg) && /sessionmanager-rdr3/.test(cfg) && /sv_enforceGameBuild 1491/.test(cfg));
  assert.deepStrictEqual(TYPES.redm.start({ path: '/x', settings: {} }).args.slice(0, 3), ['+set', 'gamename', 'rdr3']);
  // RedM: zasób FiveM i brak rdr3_warning
  const rp = path.join(root, 'srv-redm'); w(path.join(rp, 'server-data', 'server.cfg'), 'sv_licenseKey "abc"\nensure a\nensure b\n');
  w(path.join(rp, 'server-data', 'resources', 'a', 'fxmanifest.lua'), "fx_version 'cerulean'\ngame 'rdr3'\n");
  w(path.join(rp, 'server-data', 'resources', 'b', 'fxmanifest.lua'), "fx_version 'cerulean'\ngame 'gta5'\n");
  const rr = require('../src/main/servers/check').check({ type: 'redm', path: rp, settings: {} }); const rt = rr.issues.map(i => i.title).join('\n');
  assert(/a: brak rdr3_warning/.test(rt)); assert(/b jest zasobem FiveM/.test(rt)); assert.strictEqual(rr.title, 'RedM – zasoby');
  const ports = require('../src/main/servers/ports');
  assert.deepStrictEqual(ports.portsFor({ type: 'unturned', port: 27015 }).map(x => x.port), [27015, 27016]);
  const mon = require('../src/main/servers/monitor');
  assert.deepStrictEqual(mon.parseLine('l4d2', 'L 01/01/2026 - 10:00:00: "Gracz<2><STEAM_1:0:1><>" connected, address "1.2.3.4"').map(e => e.kind), ['join']);
});

(async () => {
  for (const [n, f] of queue) { try { await f(); passed++; console.log('  ✔ ' + n); } catch (e) { failed++; console.log('  ✖ ' + n + '\n    ' + String(e.stack).split('\n').slice(0, 4).join('\n    ')); } }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} OK, ${failed} błędów`);
  process.exit(failed ? 1 : 0);
})();
