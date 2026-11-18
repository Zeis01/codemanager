// Typy serwerów dodane w 1.7.0: Unturned (RocketMod / OpenMod), Left 4 Dead 2 (SourceMod), RedM (FXServer dla RDR2)
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const N = require('../net');
const { TYPES, FRAMEWORKS, steamcmdUpdate, fivemCfg, writeIfMissing } = require('./defs');

const exe = (win, nix) => (U.isWin ? win : nix);
const rnd = () => Math.random().toString(36).slice(2, 12);

// ---------------- Unturned ----------------
const UNT_APP = 1110390;
const untId = s => U.safeName(s.settings.serverid || 'CodeManager').replace(/\s+/g, '_');
const untDir = s => path.join(s.path, 'Servers', untId(s));
// Commands.dat: jedna komenda na linię („Port 27015”)
function setCommand(text, key, val) {
  const re = new RegExp(`^${key}\\b.*$`, 'mi');
  if (val === '' || val == null) return text.replace(re, '').replace(/\n{2,}/g, '\n');
  return re.test(text) ? text.replace(re, `${key} ${val}`) : `${text.replace(/\s*$/, '')}\n${key} ${val}`.replace(/^\n/, '');
}
function untWriteCommands(s) {
  const f = path.join(untDir(s), 'Server', 'Commands.dat');
  let t = U.readText(f, '');
  const set = (k, v) => { t = setCommand(t, k, v); };
  set('Name', s.settings.hostname); set('Port', s.port); set('MaxPlayers', s.settings.maxplayers); set('Map', s.settings.map);
  set('Perspective', s.settings.perspective || 'Both'); set('Mode', s.settings.mode || 'Normal');
  set('Password', s.settings.password || ''); set('GSLT', s.settings.gslt || ''); set('Owner', s.settings.owner || '');
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t.trim() + '\n');
}
function untWorkshop(s) { const f = path.join(untDir(s), 'WorkshopDownloadConfig.json'); let j = {}; try { j = JSON.parse(U.readText(f, '{}')); } catch { j = {}; } return { f, j: { File_IDs: [], Ignore_Children_File_IDs: [], Query_Cache_Max_Age_Seconds: 600, Max_Query_Retries: 2, Use_Cached_Downloads: true, Should_Monitor_Updates: true, Shutdown_Update_Detected_Timer: 600, Shutdown_Update_Detected_Message: 'Aktualizacja modów z Warsztatu – restart za {0} s.', ...j } }; }

TYPES.unturned = {
  name: 'Unturned', color: '#6ea64f', port: 27015, steamApp: UNT_APP,
  fields: [
    { id: 'serverid', label: 'Identyfikator serwera (folder w Servers/)', def: 'CodeManager' }, { id: 'hostname', label: 'Nazwa serwera', def: 'Serwer Unturned (CodeManager)' },
    { id: 'map', label: 'Mapa', def: 'PEI' }, { id: 'maxplayers', label: 'Maks. graczy', def: '24' },
    { id: 'mode', label: 'Trudność (Easy / Normal / Hard)', def: 'Normal' }, { id: 'perspective', label: 'Widok (First / Third / Both / Vehicle)', def: 'Both' },
    { id: 'password', label: 'Hasło (opcjonalnie)', def: '' }, { id: 'gslt', label: 'Token GSLT (dla serwera internetowego)', def: '' },
    { id: 'owner', label: 'Właściciel – SteamID64 (opcjonalnie)', def: '' }, { id: 'lan', label: 'Tylko LAN (1/0)', def: '0' },
  ],
  validate: s => (/^(easy|normal|hard)$/i.test(s.settings.mode || 'Normal') ? null : 'Trudność musi być Easy, Normal albo Hard.'),
  install: async (s, ctx) => { await steamcmdUpdate(s, ctx, UNT_APP); untWriteCommands(s); const w = untWorkshop(s); fs.writeFileSync(w.f, JSON.stringify(w.j, null, 2)); if (!s.settings.gslt && s.settings.lan !== '1') ctx.log('⚠ Bez tokenu GSLT serwer nie pojawi się na liście serwerów internetowych. Token wygenerujesz na steamcommunity.com/dev/managegameservers (App ID 304930).'); },
  update: (s, ctx) => steamcmdUpdate(s, ctx, UNT_APP),
  start: s => { untWriteCommands(s); return { cmd: path.join(s.path, exe('Unturned.exe', 'Unturned_Headless.x86_64')), cwd: s.path, args: ['-batchmode', '-nographics', `+${s.settings.lan === '1' ? 'LanServer' : 'InternetServer'}/${untId(s)}`] }; },
  stopCmd: 'shutdown',
  configs: s => [`Servers/${untId(s)}/Server/Commands.dat`, `Servers/${untId(s)}/Config.json`, `Servers/${untId(s)}/WorkshopDownloadConfig.json`, `Servers/${untId(s)}/Rocket/Permissions.config.xml`, `Servers/${untId(s)}/Rocket/Rocket.config.xml`, `Servers/${untId(s)}/OpenMod/openmod.yaml`],
  contentLabel: s => (U.isDir(path.join(untDir(s), 'OpenMod')) ? 'Pluginy (OpenMod)' : 'Pluginy (RocketMod)'),
  contentDir: s => (U.isDir(path.join(untDir(s), 'OpenMod')) ? path.join(untDir(s), 'OpenMod', 'plugins') : path.join(untDir(s), 'Rocket', 'Plugins')),
  contentExt: ['.dll'],
  frameworks: ['rocketmod', 'openmod'],
  // mody z Warsztatu Unturned pobiera sam serwer przy starcie – wystarczy dopisać ID
  workshopAdd: async (s, itemId, log) => { const w = untWorkshop(s); const id = Number(String(itemId).replace(/\D/g, '')); if (!id) throw new Error('Podaj numer przedmiotu Warsztatu.'); if (!w.j.File_IDs.includes(id)) w.j.File_IDs.push(id); fs.mkdirSync(path.dirname(w.f), { recursive: true }); fs.writeFileSync(w.f, JSON.stringify(w.j, null, 2)); log(`✔ Dodano ${id} do WorkshopDownloadConfig.json – serwer pobierze go przy następnym starcie.`); return String(id); },
  rcon: null, rconHint: 'Unturned nie ma RCON w standardzie – polecenia wpisuj w konsoli CodeManager.',
  worlds: s => [`Servers/${untId(s)}/Level`, `Servers/${untId(s)}/Players`],
  say: m => `say ${m}`, saveCmd: 'save',
};
FRAMEWORKS.rocketmod = {
  name: 'RocketMod (wbudowany)', desc: 'Klasyczny framework pluginów Unturned dołączony do serwera (Extras/Rocket.Unturned).',
  status: s => U.isDir(path.join(s.path, 'Modules', 'Rocket.Unturned')),
  install: async (s, ctx) => {
    const src = path.join(s.path, 'Extras', 'Rocket.Unturned');
    if (!U.isDir(src)) throw new Error('Nie znaleziono Extras/Rocket.Unturned – najpierw zaktualizuj pliki serwera.');
    U.copyRecursive(src, path.join(s.path, 'Modules', 'Rocket.Unturned'));
    fs.mkdirSync(path.join(untDir(s), 'Rocket', 'Plugins'), { recursive: true });
    ctx.log('RocketMod włączony. Pluginy (.dll) wrzucaj do Servers/' + untId(s) + '/Rocket/Plugins.');
  },
};
FRAMEWORKS.openmod = {
  name: 'OpenMod', desc: 'Nowoczesny framework pluginów Unturned (NuGet, zgodny z pluginami RocketMod przez most).',
  status: s => U.isDir(path.join(s.path, 'Modules', 'OpenMod.Unturned')),
  install: async (s, ctx) => {
    const rel = await N.githubLatest('openmod/openmod', /^OpenMod\.Unturned\.Module.*\.zip$/i);
    ctx.log(`Pobieranie ${rel.name} (${rel.tag})…`);
    const z = await N.download(rel.url, N.tempFile(rel.name), ctx.progress);
    N.extractZip(z, path.join(s.path, 'Modules'));
    fs.mkdirSync(path.join(untDir(s), 'OpenMod', 'plugins'), { recursive: true });
    ctx.log('OpenMod zainstalowany. Pluginy dodasz poleceniem „openmod install <pakiet>” w konsoli albo wrzucając .dll do OpenMod/plugins.');
  },
};

// ---------------- Left 4 Dead 2 ----------------
const L4D2_APP = 222860;
function l4d2Cfg(s) {
  return `// Konfiguracja wygenerowana przez CodeManager
hostname "${s.settings.hostname}"
rcon_password "${s.settings.rconpassword}"
sv_lan 0
sv_region 3
sv_allow_lobby_connect_only 0
sv_gametypes "coop,realism,survival,versus,scavenge"
mp_gamemode "${s.settings.gamemode || 'coop'}"
z_difficulty "${s.settings.difficulty || 'Normal'}"
sv_steamgroup "${s.settings.steamgroup || ''}"
sv_steamgroup_exclusive 0
sv_consistency 0
sv_pure 0
`;
}
TYPES.l4d2 = {
  name: 'Left 4 Dead 2', color: '#b5432c', port: 27015, steamApp: L4D2_APP,
  fields: [
    { id: 'hostname', label: 'Nazwa serwera', def: 'Serwer L4D2 (CodeManager)' }, { id: 'map', label: 'Mapa startowa', def: 'c1m1_hotel' },
    { id: 'gamemode', label: 'Tryb (coop / versus / survival / realism / scavenge)', def: 'coop' }, { id: 'difficulty', label: 'Trudność (Easy / Normal / Hard / Impossible)', def: 'Normal' },
    { id: 'steamgroup', label: 'ID grupy Steam (opcjonalnie)', def: '' }, { id: 'rconpassword', label: 'Hasło RCON', def: rnd() },
  ],
  install: async (s, ctx) => { await steamcmdUpdate(s, ctx, L4D2_APP); writeIfMissing(path.join(s.path, 'left4dead2', 'cfg', 'server.cfg'), l4d2Cfg(s)); },
  update: (s, ctx) => steamcmdUpdate(s, ctx, L4D2_APP),
  start: s => ({ cmd: path.join(s.path, exe('srcds.exe', 'srcds_run')), cwd: s.path, args: ['-console', '-game', 'left4dead2', '-port', String(s.port), '+map', s.settings.map || 'c1m1_hotel', '+mp_gamemode', s.settings.gamemode || 'coop', '+exec', 'server.cfg'] }),
  stopCmd: 'quit',
  configs: ['left4dead2/cfg/server.cfg', 'left4dead2/host.txt', 'left4dead2/motd.txt', 'left4dead2/addons/sourcemod/configs/admins_simple.ini', 'left4dead2/addons/sourcemod/configs/core.cfg'],
  contentLabel: () => 'Pluginy (SourceMod)', contentDir: s => path.join(s.path, 'left4dead2', 'addons', 'sourcemod', 'plugins'), contentExt: ['.smx'],
  frameworks: ['metamod112', 'sourcemod'],
  rcon: s => ({ protocol: 'source', port: +s.port, password: s.settings.rconpassword }),
  say: m => `say ${m}`,
};

// ---------------- RedM ----------------
function redmCfg(s) {
  return fivemCfg(s)
    .replace('ensure sessionmanager\n', 'ensure sessionmanager-rdr3\n')
    .replace(/^sets sv_projectDesc .*$/m, 'sets sv_projectDesc "Serwer RedM zarządzany przez CodeManager"')
    .replace('set onesync on\n', `set onesync on\nset gamename rdr3\nset sv_enforceGameBuild ${s.settings.gamebuild || '1491'}\n`);
}
TYPES.redm = {
  name: 'RedM (RDR2)', color: '#b8202c', port: 30120,
  fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer RedM (CodeManager)' }, { id: 'license', label: 'Klucz licencji (portal.cfx.re)', def: '' }, { id: 'maxclients', label: 'Maks. graczy', def: '32' }, { id: 'gamebuild', label: 'Wersja gry (sv_enforceGameBuild)', def: '1491' }],
  install: async (s, ctx) => {
    writeIfMissing(path.join(s.path, 'server-data', 'server.cfg'), redmCfg(s));
    await TYPES.fivem.install(s, ctx);
    const f = path.join(s.path, 'server-data', 'server.cfg');
    if (!/gamename\s+rdr3/.test(U.readText(f, ''))) fs.writeFileSync(f, redmCfg(s));
    ctx.log('Serwer RedM używa tych samych plików FXServer co FiveM. Zasoby muszą mieć w fxmanifest.lua linię game \'rdr3\' i rdr3_warning.');
  },
  update: (s, ctx) => TYPES.fivem.update(s, ctx),
  start: s => ({ cmd: path.join(s.path, 'server', exe('FXServer.exe', 'run.sh')), args: ['+set', 'gamename', 'rdr3', '+exec', 'server.cfg'], cwd: path.join(s.path, 'server-data') }),
  stopCmd: 'quit',
  configs: ['server-data/server.cfg'],
  contentLabel: () => 'Zasoby (resources)', contentDir: s => path.join(s.path, 'server-data', 'resources'),
};
for (const k of ['rcon', 'rconHint', 'worlds', 'say']) if (TYPES.fivem[k]) TYPES.redm[k] = TYPES.fivem[k];

module.exports = { setCommand, untWriteCommands, untWorkshop, untDir, redmCfg, l4d2Cfg };
