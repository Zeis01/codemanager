// Testy parserów i checkerów na sztucznych danych (node test/run-tests.js)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');
const assert = require('assert');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-test-'));
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ✔ ' + name); } catch (e) { failed++; console.log('  ✖ ' + name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n    ')); } }
const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const jar = (p, files) => { const z = new AdmZip(); for (const [n, c] of Object.entries(files)) z.addFile(n, Buffer.from(c)); fs.mkdirSync(path.dirname(p), { recursive: true }); z.writeZip(p); };
const has = (rep, level, re) => rep.issues.some(i => i.level === level && re.test(i.title));

const V = require('../src/main/parsers/versions');
const T = require('../src/main/parsers/text');
const U = require('../src/main/util');

console.log('Wersje');
t('semver zakresy Fabric', () => {
  assert(V.matchSemverRange('>=1.20 <1.21', '1.20.1'));
  assert(!V.matchSemverRange('>=1.20 <1.21', '1.21'));
  assert(V.matchSemverRange('~1.20.1', '1.20.4'));
  assert(!V.matchSemverRange('~1.20.1', '1.21.0'));
  assert(V.matchSemverRange('1.20.x', '1.20.6'));
  assert(V.matchSemverRange(['1.19.4', '1.20.1'], '1.20.1'));
  assert(V.matchSemverRange('*', '9'));
  assert(V.matchSemverRange('1.21.1', '1.21.1'));
  assert(!V.matchSemverRange('1.21.1', '1.21'));
});
t('Maven zakresy Forge', () => {
  assert(V.matchMavenRange('[1.20,1.21)', '1.20.1'));
  assert(!V.matchMavenRange('[1.20,1.21)', '1.21'));
  assert(V.matchMavenRange('[47,)', '47.2.0'));
  assert(!V.matchMavenRange('[47.3,)', '47.2.0'));
  assert(V.matchMavenRange('[1.20.1]', '1.20.1'));
  assert(V.matchMavenRange('(,1.20.1]', '1.19'));
});
t('wildcard ETS2/HOI4', () => { assert(V.wildcardMatch('1.53.*', '1.53.2')); assert(V.wildcardMatch('1.5*', '1.53.2')); assert(!V.wildcardMatch('1.49.*', '1.53.2')); assert(V.wildcardMatch('v1.14.*', 'v1.14.8')); });
t('cmpVer', () => { assert(U.cmpVer('1.20.10', '1.20.9') > 0); assert(U.cmpVer('1.0.0-beta', '1.0.0') < 0); assert(U.cmpVer('2024.5', '2024.05.0') === 0); });

console.log('Parsery tekstowe');
t('VDF libraryfolders', () => {
  const v = T.parseVDF('"libraryfolders"\n{\n "0"\n {\n  "path"  "C:\\\\Program Files (x86)\\\\Steam"\n  "apps" { "228980" "1" }\n }\n "1" { "path" "D:\\\\SteamLibrary" }\n}');
  assert.strictEqual(T.vget(v, 'libraryfolders', '1', 'path'), 'D:\\SteamLibrary');
  assert.strictEqual(T.vget(v, 'LibraryFolders', '0', 'apps', '228980'), '1');
});
t('Lua modinfo DST', () => {
  const r = T.parseLua('name = "Combined Status"\ndescription = [[Opis\nwielowierszowy]]\nversion = "1.9" -- komentarz\napi_version = 10\ndst_compatible = true\nall_clients_require_mod = false\nconfiguration_options = { { name = "a", options = { {description="x", data=1} }, default = 1 } }\nmod_dependencies = { { workshop = "workshop-1378549454" } }');
  assert.strictEqual(r.assigns.name, 'Combined Status'); assert.strictEqual(r.assigns.api_version, 10); assert.strictEqual(r.assigns.dst_compatible, true);
  assert.strictEqual(r.assigns.mod_dependencies[0].workshop, 'workshop-1378549454');
});
t('Lua fxmanifest', () => {
  const r = T.parseLua("fx_version 'cerulean'\ngame 'gta5'\ndependency 'es_extended'\ndependencies { 'oxmysql', '/server:5181' }\nclient_scripts { 'client/*.lua' }\nserver_script 'server.lua'\nlua54 'yes'");
  const c = n => r.calls.filter(x => x.name === n).map(x => x.args[0]);
  assert.strictEqual(c('fx_version')[0], 'cerulean'); assert.deepStrictEqual(c('dependencies')[0], ['oxmysql', '/server:5181']); assert.strictEqual(c('dependency')[0], 'es_extended');
});
t('Lua mod.lua TF2 (function data)', () => {
  const r = T.parseLua('function data()\nreturn {\n info = {\n  minorVersion = 3,\n  severityAdd = "NONE",\n  severityRemove = "CRITICAL",\n  name = _("Mój mod"),\n  authors = { { name = "X", role = "CREATOR" } },\n },\n runFn = function(settings) if true then print(1) end end,\n}\nend');
  assert.strictEqual(r.functions.data.info.minorVersion, 3); assert.strictEqual(r.functions.data.info.name, 'Mój mod'); assert.strictEqual(r.functions.data.info.severityRemove, 'CRITICAL');
});
t('Paradox descriptor', () => {
  const r = T.parseParadox('version="1.2"\ntags={\n\t"Gameplay"\n}\nname="Kaiserreich"\nsupported_version="1.14.*"\ndependencies={ "Core" "Other mod" }\npath="mod/kr"\nremote_file_id="1521695605"');
  assert.strictEqual(r.name, 'Kaiserreich'); assert.deepStrictEqual(r.dependencies, ['Core', 'Other mod']); assert.deepStrictEqual(r.tags, ['Gameplay']);
});
t('SII manifest', () => {
  const r = T.parseSII('SiiNunit\n{\nmod_package : .package_name\n{\n\tpackage_version: "2.1"\n\tdisplay_name: "Mój mod"\n\tcompatible_versions[]: "1.52.*"\n\tcompatible_versions[]: "1.53.*"\n}\n}');
  assert.strictEqual(r[0].props.display_name, 'Mój mod'); assert.deepStrictEqual(r[0].props.compatible_versions, ['1.52.*', '1.53.*']);
});

console.log('Minecraft');
const MC = require('../src/main/compat/minecraft');
const mods = path.join(root, 'mc', 'mods');
jar(path.join(mods, 'sodium.jar'), { 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'sodium', version: '0.5.8', name: 'Sodium', environment: 'client', depends: { minecraft: '>=1.20.4 <1.20.5', fabricloader: '>=0.12' } }) });
jar(path.join(mods, 'lithium.jar'), { 'fabric.mod.json': JSON.stringify({ id: 'lithium', version: '0.12', depends: { minecraft: '1.20.1', 'fabric-api': '*' } }) });
jar(path.join(mods, 'iris.jar'), { 'fabric.mod.json': JSON.stringify({ id: 'iris', version: '1.7', depends: { sodium: '>=0.6' }, breaks: { optifabric: '*' } }) });
jar(path.join(mods, 'jei.jar'), { 'META-INF/mods.toml': 'modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="jei"\nversion="15.2"\ndisplayName="JEI"\n[[dependencies.jei]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20.1,1.20.2)"\nside="BOTH"\n' });
jar(path.join(mods, 'sodium-old.jar'), { 'fabric.mod.json': JSON.stringify({ id: 'sodium', version: '0.5.3', depends: {} }) });
jar(path.join(mods, 'essentials.jar'), { 'plugin.yml': 'name: Essentials\nversion: 2.20\nmain: x.Y\napi-version: 1.20\n' });
jar(path.join(mods, 'disabled.jar.disabled'), { 'fabric.mod.json': JSON.stringify({ id: 'off', version: '1' }) });
t('mody klienta – wykrycie problemów', () => {
  const r = MC.checkMods({ modsDir: mods, mcVersion: '1.20.4', loader: 'fabric', loaderVersion: '0.15.11', side: 'client' });
  assert.strictEqual(r.mods.length, 7);
  assert(has(r, 'error', /Lithium|lithium.*Minecraft 1\.20\.1/i), 'zła wersja MC');
  assert(has(r, 'error', /Fabric API/), 'brak Fabric API');
  assert(has(r, 'error', /iris.*sodium|wymaga sodium/i), 'zła wersja zależności');
  assert(has(r, 'error', /JEI jest dla Forge/), 'zły loader');
  assert(has(r, 'error', /Zduplikowany mod "sodium"/));
  assert(has(r, 'error', /plugin serwera/));
  assert(r.mods.find(m => m.key === 'disabled.jar.disabled').enabled === false);
});
t('mody serwera – mod tylko klienta', () => {
  const r = MC.checkMods({ modsDir: mods, mcVersion: '1.20.4', loader: 'fabric', side: 'server' });
  assert(has(r, 'error', /tylko po stronie klienta/));
});
t('pluginy Paper', () => {
  const pd = path.join(root, 'paper', 'plugins');
  jar(path.join(pd, 'a.jar'), { 'plugin.yml': 'name: A\nversion: 1\nmain: a.A\napi-version: "1.21"\ndepend: [Vault]\nsoftdepend: [PlaceholderAPI]\n' });
  jar(path.join(pd, 'b.jar'), { 'fabric.mod.json': '{"id":"b","version":"1"}' });
  const r = MC.checkPlugins({ pluginsDir: pd, mcVersion: '1.20.4', loader: 'paper' });
  assert(has(r, 'error', /wymaga API 1\.21/)); assert(has(r, 'error', /wymaga pluginu "Vault"/)); assert(has(r, 'error', /to mod/)); assert(has(r, 'info', /PlaceholderAPI/));
});

console.log('BepInEx / MelonLoader');
const UN = require('../src/main/compat/unity');
t('BepInEx – zależności Thunderstore', () => {
  const g = path.join(root, 'lc');
  w(path.join(g, 'BepInEx', 'core', 'BepInEx.dll'), 'x'); w(path.join(g, 'winhttp.dll'), 'x'); w(path.join(g, 'doorstop_config.ini'), '');
  w(path.join(g, 'BepInEx', 'plugins', 'Evaisa-LethalLib', 'manifest.json'), JSON.stringify({ name: 'LethalLib', version_number: '0.14.0', dependencies: ['BepInEx-BepInExPack-5.4.2100'] }));
  w(path.join(g, 'BepInEx', 'plugins', 'Evaisa-LethalLib', 'LethalLib.dll'), 'x');
  w(path.join(g, 'BepInEx', 'plugins', 'Someone-Monsters', 'manifest.json'), JSON.stringify({ name: 'Monsters', version_number: '1.0.0', dependencies: ['Evaisa-LethalLib-0.15.0', 'Evaisa-HookGenPatcher-0.0.5'] }));
  w(path.join(g, 'BepInEx', 'plugins', 'Someone-Monsters', 'Monsters.dll'), 'x');
  w(path.join(g, 'BepInEx', 'plugins', 'Someone-Monsters', 'LethalLib.dll'), 'x');
  const r = UN.checkBepInEx({ root: g, profileName: 'Folder gry', expectMajor: 5 });
  assert(has(r, 'warn', /LethalLib ≥ 0\.15\.0/)); assert(has(r, 'error', /HookGenPatcher/)); assert(has(r, 'warn', /lethallib\.dll występuje/i));
  assert(!has(r, 'error', /BepInEx nie jest/));
});
t('MelonLoader – mod Mono na IL2CPP', () => {
  const g = path.join(root, 's1');
  w(path.join(g, 'GameAssembly.dll'), 'x'); w(path.join(g, 'version.dll'), 'x'); w(path.join(g, 'MelonLoader', 'net6', 'MelonLoader.dll'), 'x');
  w(path.join(g, 'Mods', 'MonoMod.dll'), 'MelonLoader Assembly-CSharp ScheduleOne');
  w(path.join(g, 'Mods', 'GoodMod.dll'), 'MelonLoader Il2CppInterop.Runtime Il2CppScheduleOne');
  w(path.join(g, 'Mods', 'BepMod.dll'), 'BepInEx Assembly-CSharp');
  const r = UN.checkMelonLoader({ root: g });
  assert(has(r, 'error', /MonoMod jest dla wersji Mono/)); assert(!has(r, 'error', /GoodMod/)); assert(has(r, 'error', /BepMod to plugin BepInEx/));
});

console.log('Gry');
const G = require('../src/main/compat/games');
t('Project Zomboid – require i Build 42', () => {
  const ws = path.join(root, 'pzws');
  w(path.join(ws, '111', 'mods', 'ModA', 'mod.info'), 'name=Mod A\nid=ModA\nrequire=\\ModB,ModC\n');
  w(path.join(ws, '222', 'mods', 'ModB', '42', 'mod.info'), 'name=Mod B\nid=ModB\n'); fs.mkdirSync(path.join(ws, '222', 'mods', 'ModB', 'common'), { recursive: true });
  const gp = path.join(root, 'pzgame'); w(path.join(gp, 'projectzomboid.jar'), 'x');
  const r = G.checkProjectZomboid({ gamePath: gp, workshop: [ws], settings: {} });
  assert(has(r, 'error', /Mod A jest tylko dla Build 41/)); assert(has(r, 'error', /wymaga moda "ModC"/)); assert(!has(r, 'error', /"ModB"/));
});
t('DST – modinfo', () => {
  const gp = path.join(root, 'dst');
  w(path.join(gp, 'mods', 'workshop-1', 'modinfo.lua'), 'name="Stary"\napi_version=6\n'); w(path.join(gp, 'mods', 'workshop-1', 'modmain.lua'), '');
  w(path.join(gp, 'mods', 'workshop-2', 'modinfo.lua'), 'name="Dobry"\napi_version=10\ndst_compatible=true\nmod_dependencies={ { workshop="workshop-999" } }'); w(path.join(gp, 'mods', 'workshop-2', 'modmain.lua'), '');
  const r = G.checkDST({ gamePath: gp, workshop: [], settings: {} });
  assert(has(r, 'error', /Stary nie jest oznaczony/)); assert(has(r, 'error', /przestarzałe API/)); assert(has(r, 'error', /wymaga moda workshop-999/));
});
t('Garry\'s Mod – konflikt Lua w GMA', () => {
  const gp = path.join(root, 'gmod');
  const mk = (name, files) => {
    const parts = [Buffer.from('GMAD'), Buffer.from([3]), Buffer.alloc(16), Buffer.from('\0'), Buffer.from(name + '\0'), Buffer.from('{"description":"x"}\0'), Buffer.from('autor\0'), Buffer.alloc(4)];
    files.forEach((f, i) => { const n = Buffer.alloc(4); n.writeUInt32LE(i + 1); const sz = Buffer.alloc(8); sz.writeBigUInt64LE(10n); parts.push(n, Buffer.from(f + '\0'), sz, Buffer.alloc(4)); });
    parts.push(Buffer.alloc(4));
    return Buffer.concat(parts);
  };
  w(path.join(gp, 'garrysmod', 'addons', 'a.gma'), mk('Addon A', ['lua/autorun/shared.lua', 'models/x.mdl']));
  w(path.join(gp, 'garrysmod', 'addons', 'b.gma'), mk('Addon B', ['lua/autorun/shared.lua']));
  const r = G.checkGarrysMod({ gamePath: gp, workshop: [], settings: {} });
  assert.strictEqual(r.mods.length, 2); assert(has(r, 'warn', /Konflikt skryptów Lua: Addon A ↔ Addon B/));
});
t('HOI4 – wersja i zależności', () => {
  const docs = path.join(root, 'docs');
  // podmień ścieżkę dokumentów
  U.documentsCandidates = () => [docs];
  const base = path.join(docs, 'Paradox Interactive', 'Hearts of Iron IV');
  w(path.join(base, 'mod', 'a.mod'), 'name="Mod A"\nsupported_version="1.12.*"\npath="mod/a"\ndependencies={ "Core Mod" }');
  w(path.join(base, 'mod', 'a', 'common', 'ideas', 'x.txt'), '');
  w(path.join(base, 'mod', 'b.mod'), 'name="Mod B"\nsupported_version="1.14.*"\npath="mod/b"');
  w(path.join(base, 'mod', 'b', 'common', 'ideas', 'x.txt'), '');
  w(path.join(base, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/a.mod', 'mod/b.mod'] }));
  const gp = path.join(root, 'hoi4'); w(path.join(gp, 'launcher-settings.json'), JSON.stringify({ rawVersion: 'v1.14.8.0' }));
  const r = G.checkParadox({ game: { name: 'HOI4', paradoxFolder: 'Hearts of Iron IV' }, gamePath: gp, settings: {} });
  assert(has(r, 'warn', /obsługuje 1\.12/)); assert(has(r, 'error', /wymaga "Core Mod"/)); assert(has(r, 'warn', /Konflikt plików: Mod A ↔ Mod B/));
});
t('Transport Fever 2 – nazwa folderu', () => {
  const gp = path.join(root, 'tf2');
  w(path.join(gp, 'mods', 'bez_wersji', 'mod.lua'), 'function data() return { info = { minorVersion = 0, name = "X" } } end');
  w(path.join(gp, 'mods', 'ok_1', 'mod.lua'), 'function data() return { info = { minorVersion = 2, name = "OK" } } end');
  const r = G.checkTransportFever({ gamePath: gp, workshop: [], info: {}, settings: {} });
  assert(has(r, 'error', /musi kończyć się numerem/)); assert(r.mods.find(m => m.name === 'OK').version === '1.2');
});
t('People Playground – brakujący skrypt', () => {
  const gp = path.join(root, 'ppg');
  w(path.join(gp, 'Mods', 'A', 'mod.json'), JSON.stringify({ Name: 'A', GameVersion: '1.20', EntryPoint: 'Mod.Mod', Scripts: ['script.cs'] }));
  w(path.join(gp, 'Mods', 'B', 'mod.json'), JSON.stringify({ Name: 'B', GameVersion: '1.27', EntryPoint: 'Mod.Mod', Scripts: [] }));
  const r = G.checkPeoplePlayground({ gamePath: gp, workshop: [], settings: {} });
  assert(has(r, 'error', /brak pliku skryptu/)); assert(has(r, 'warn', /zbudowany dla wersji 1\.20/));
});

console.log('Formaty binarne');
const B = require('../src/main/parsers/binary');
t('SMX – rozszerzenia', () => {
  // zbuduj minimalny SMX: nagłówek + sekcje .pubvars i .names (bez kompresji)
  const names = Buffer.from('\0__ext_sdkhooks\0__ext_mysuperext\0__pl_mapchooser\0');
  const pub = Buffer.alloc(24); pub.writeUInt32LE(0, 0); pub.writeUInt32LE(1, 4); pub.writeUInt32LE(0, 8); pub.writeUInt32LE(16, 12); pub.writeUInt32LE(0, 16); pub.writeUInt32LE(33, 20);
  const strtab = Buffer.from('.pubvars\0.names\0');
  const hdrLen = 24 + 2 * 12;
  const strOff = hdrLen; const pubOff = strOff + strtab.length; const namesOff = pubOff + pub.length;
  const hdr = Buffer.alloc(hdrLen);
  hdr.writeUInt32LE(0x53504646, 0); hdr.writeUInt16LE(0x0102, 4); hdr.writeUInt8(0, 6); hdr.writeUInt32LE(namesOff + names.length, 7); hdr.writeUInt32LE(namesOff + names.length, 11); hdr.writeUInt8(2, 15); hdr.writeUInt32LE(strOff, 16); hdr.writeUInt32LE(namesOff + names.length, 20);
  hdr.writeUInt32LE(0, 24); hdr.writeUInt32LE(pubOff, 28); hdr.writeUInt32LE(pub.length, 32);
  hdr.writeUInt32LE(9, 36); hdr.writeUInt32LE(namesOff, 40); hdr.writeUInt32LE(names.length, 44);
  const f = w(path.join(root, 'x.smx'), Buffer.concat([hdr, strtab, pub, names]));
  const r = B.parseSMX(f);
  assert.deepStrictEqual(r.extensions, ['sdkhooks', 'mysuperext']); assert.deepStrictEqual(r.libraries, ['mapchooser']);
});
t('PE – wersja pliku', () => {
  const b = Buffer.alloc(200); Buffer.from([0xbd, 0x04, 0xef, 0xfe]).copy(b, 100); b.writeUInt32LE(0x00010000, 104);
  b.writeUInt32LE((1 << 16) | 0, 108); b.writeUInt32LE((3407 << 16) | 0, 112); b.writeUInt32LE((1 << 16) | 0, 116); b.writeUInt32LE((3407 << 16) | 0, 120);
  const f = w(path.join(root, 'GTA5.exe'), b);
  assert.strictEqual(B.peVersion(f).file, '1.0.3407.0');
});
t('TMOD – nagłówek i referencje', () => {
  const s = str => { const b = Buffer.from(str, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); };
  const info = Buffer.concat([s('modReferences'), s('CalamityMod@2.0'), s(''), s('author'), s('Ja'), s('')]);
  const comp = zlib.deflateRawSync(info);
  const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
  const data = Buffer.concat([s('MyMod'), s('1.0'), i32(1), s('Info'), i32(info.length), i32(comp.length), comp]);
  const f = w(path.join(root, 'MyMod.tmod'), Buffer.concat([Buffer.from('TMOD'), s('2024.5.3.0'), Buffer.alloc(20), Buffer.alloc(256), i32(data.length), data]));
  const r = B.parseTMOD(f);
  assert.strictEqual(r.name, 'MyMod'); assert.strictEqual(r.tmlVersion, '2024.5.3.0'); assert.deepStrictEqual(r.modReferences, ['CalamityMod@2.0']);
});

console.log('Serwery');
const SC = require('../src/main/servers/check');
t('FiveM – brakujące zasoby i licencja', () => {
  const sp = path.join(root, 'fivem');
  w(path.join(sp, 'server-data', 'server.cfg'), 'ensure chat\nensure myres\nensure ghost\nsv_licenseKey "WKLEJ_TUTAJ_KLUCZ"\n');
  w(path.join(sp, 'server-data', 'resources', '[system]', 'chat', 'fxmanifest.lua'), "fx_version 'cerulean'\ngame 'gta5'");
  w(path.join(sp, 'server-data', 'resources', 'myres', 'fxmanifest.lua'), "fx_version 'cerulean'\ngame 'gta5'\ndependency 'oxmysql'");
  const r = SC.check({ type: 'fivem', path: sp, settings: {} });
  assert(has(r, 'error', /wymaga zasobu "oxmysql"/)); assert(has(r, 'error', /"ghost"/)); assert(has(r, 'error', /licencji/));
});
t('Rust – nazwa klasy i Requires', () => {
  const sp = path.join(root, 'rust');
  w(path.join(sp, 'RustDedicated_Data', 'Managed', 'Oxide.Rust.dll'), 'x');
  w(path.join(sp, 'oxide', 'plugins', 'Kits.cs'), '// Requires: ImageLibrary\nnamespace Oxide.Plugins {\n[Info("Kits", "k1lly0u", "4.4.0")]\nclass KitsX : RustPlugin { [PluginReference] private Plugin Economics, ServerRewards; } }');
  const r = SC.check({ type: 'rust', path: sp, settings: {} });
  assert(has(r, 'error', /Nazwa klasy \(KitsX\)/)); assert(has(r, 'error', /wymaga pluginu ImageLibrary/)); assert(has(r, 'info', /Economics/));
});
t('DayZ – klucze bikey', () => {
  const sp = path.join(root, 'dayz');
  w(path.join(sp, 'serverDZ.cfg'), 'hostname = "x";\npasswordAdmin = "";\nclass Missions { class DayZ { template="dayzOffline.chernarusplus"; }; };');
  fs.mkdirSync(path.join(sp, 'mpmissions', 'dayzOffline.chernarusplus'), { recursive: true });
  w(path.join(sp, '@CF', 'addons', 'cf.pbo'), 'x'); w(path.join(sp, '@CF', 'keys', 'cf.bikey'), 'x');
  fs.mkdirSync(path.join(sp, 'keys'), { recursive: true });
  const r = SC.check({ type: 'dayz', path: sp, settings: { mods: '@CF;@Missing' } });
  assert(has(r, 'error', /cf\.bikey nie jest skopiowany/)); assert(has(r, 'error', /@Missing/)); assert(has(r, 'warn', /passwordAdmin/));
});
t('Arma Reforger – config.json', () => {
  const sp = path.join(root, 'arma');
  w(path.join(sp, 'config.json'), JSON.stringify({ bindPort: 2001, game: { name: 'x', scenarioId: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf', mods: [{ modId: '591AF5BDA9F7CE8B', name: 'A' }, { modId: 'zle', name: 'B' }, { modId: '591AF5BDA9F7CE8B', name: 'A' }] } }));
  const r = SC.check({ type: 'armareforger', path: sp, settings: {} });
  assert(has(r, 'error', /Nieprawidłowe modId/)); assert(has(r, 'error', /dwukrotnie/));
});
t('BeamMP – mapa i AuthKey', () => {
  const sp = path.join(root, 'beammp');
  w(path.join(sp, 'ServerConfig.toml'), '[General]\nAuthKey = ""\nMap = "/levels/mojamapa/info.json"\nResourceFolder = "Resources"\n');
  jar(path.join(sp, 'Resources', 'Client', 'car.zip'), { 'vehicles/car/car.jbeam': '{}' });
  const r = SC.check({ type: 'beammp', path: sp, settings: {} });
  assert(has(r, 'error', /AuthKey/)); assert(has(r, 'error', /Mapa "mojamapa"/));
});
t('Project Zomboid serwer – WorkshopItems', () => {
  const sp = path.join(root, 'pzsrv');
  w(path.join(sp, 'Zomboid', 'Server', 'servertest.ini'), 'Mods=ModA;ModB\nWorkshopItems=111\nMap=Muldraugh, KY\n');
  w(path.join(sp, 'steamapps', 'workshop', 'content', '108600', '111', 'mods', 'ModA', 'mod.info'), 'id=ModA\nrequire=ModZ');
  w(path.join(sp, 'steamapps', 'workshop', 'content', '108600', '222', 'mods', 'ModB', 'mod.info'), 'id=ModB');
  const r = SC.check({ type: 'projectzomboid', path: sp, settings: { servername: 'servertest' } });
  assert(has(r, 'error', /ModB.*nie jest wpisany w WorkshopItems/)); assert(has(r, 'error', /wymaga moda ModZ/));
});
t('Definicje serwerów – start komendy', () => {
  const { TYPES } = require('../src/main/servers/defs');
  for (const [id, t] of Object.entries(TYPES)) {
    if (id === 'minecraft') continue;
    const s = { path: '/srv/' + id, port: t.port, settings: Object.fromEntries((t.fields || []).map(f => [f.id, f.def])), variant: null };
    const st = t.start(s); assert(st.cmd && Array.isArray(st.args), id);
  }
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} OK, ${failed} błędów`);
process.exit(failed ? 1 : 0);
