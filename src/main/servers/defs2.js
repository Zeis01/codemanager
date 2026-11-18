// Rozszerzenie typów serwerów: Palworld, ARK, Satisfactory, Enshrouded, Space Engineers, proxy Velocity/BungeeCord
// + metadane dla wszystkich typów: RCON, ścieżki światów (kopie zapasowe), polecenia ogłoszeń i zapisu
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const N = require('../net');
const { TYPES, FRAMEWORKS, steamcmdUpdate } = require('./defs');
const { parseIni } = require('../parsers/text');

const exe = (win, nix) => (U.isWin ? win : nix);
const rnd = () => Math.random().toString(36).slice(2, 12);
const writeIfMissing = (f, c) => { if (!U.exists(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } };
const setIniLine = (text, key, val) => { const re = new RegExp(`^${key}=.*$`, 'm'); return re.test(text) ? text.replace(re, `${key}=${val}`) : text + `\n${key}=${val}`; };

// ---------------- Palworld ----------------
function palCfgPath(s) { return path.join(s.path, 'Pal', 'Saved', 'Config', U.isWin ? 'WindowsServer' : 'LinuxServer', 'PalWorldSettings.ini'); }
function palWriteSettings(s) {
  const f = palCfgPath(s);
  let t = U.readText(f);
  if (!t || !/OptionSettings=\(/.test(t)) t = U.readText(path.join(s.path, 'DefaultPalWorldSettings.ini'), '[/Script/Pal.PalGameWorldSettings]\nOptionSettings=()');
  const set = (k, v) => { const re = new RegExp(`(${k}=)("[^"]*"|[^,)]*)`); t = re.test(t) ? t.replace(re, `$1${v}`) : t.replace(/OptionSettings=\(/, `OptionSettings=(${k}=${v},`); };
  set('ServerName', `"${s.settings.hostname}"`); set('ServerPlayerMaxNum', s.settings.maxplayers); set('AdminPassword', `"${s.settings.adminpassword}"`);
  set('ServerPassword', `"${s.settings.password || ''}"`); set('PublicPort', s.port); set('RCONEnabled', 'True'); set('RCONPort', s.settings.rconport);
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t);
}
TYPES.palworld = {
  name: 'Palworld', color: '#3ab7e8', port: 8211, steamApp: 2394010,
  fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer Palworld (CodeManager)' }, { id: 'maxplayers', label: 'Maks. graczy', def: '32' }, { id: 'password', label: 'Hasło serwera (opcjonalnie)', def: '' }, { id: 'adminpassword', label: 'Hasło admina / RCON', def: rnd() }, { id: 'rconport', label: 'Port RCON', def: '25575' }],
  install: async (s, ctx) => { await steamcmdUpdate(s, ctx, 2394010); palWriteSettings(s); ctx.log('Zapisano PalWorldSettings.ini (RCON włączony).'); },
  update: (s, ctx) => steamcmdUpdate(s, ctx, 2394010),
  start: s => ({ cmd: path.join(s.path, exe('PalServer.exe', 'PalServer.sh')), cwd: s.path, args: [`-port=${s.port}`, `-players=${s.settings.maxplayers}`, '-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS'] }),
  stopCmd: null, rconStop: 'Shutdown 5 Serwer_zostaje_wylaczony',
  configs: s => [path.relative(s.path, palCfgPath(s)).split(path.sep).join('/'), 'Pal/Binaries/Win64/ue4ss/Mods/mods.txt'],
  contentLabel: () => 'Mody (UE4SS / pak)', contentDir: s => path.join(s.path, 'Pal', 'Content', 'Paks', '~mods'),
  rcon: s => ({ protocol: 'source', port: +s.settings.rconport || 25575, password: s.settings.adminpassword }),
  worlds: () => ['Pal/Saved/SaveGames'], sayRcon: m => `Broadcast ${m.replace(/\s+/g, '_')}`, saveRcon: 'Save',
};

// ---------------- ARK ----------------
TYPES.ark = {
  name: 'ARK', color: '#6aa84f', port: 7777,
  variants: [{ id: 'asa', name: 'ARK: Survival Ascended' }, { id: 'ase', name: 'ARK: Survival Evolved' }],
  fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer ARK (CodeManager)' }, { id: 'map', label: 'Mapa', def: 'TheIsland_WP' }, { id: 'maxplayers', label: 'Maks. graczy', def: '70' }, { id: 'adminpassword', label: 'Hasło admina / RCON', def: rnd() }, { id: 'password', label: 'Hasło serwera (opcjonalnie)', def: '' }, { id: 'rconport', label: 'Port RCON', def: '27020' }, { id: 'mods', label: 'Mody (ID po przecinku)', def: '' }],
  appFor: s => (s.variant === 'ase' ? 376030 : 2430930),
  install: async (s, ctx) => { if (s.variant !== 'ase' && !U.isWin) ctx.log('⚠ Serwer ARK: Survival Ascended jest dostępny tylko dla Windows (na Linuksie wymaga Wine/Proton).'); if (s.variant === 'ase' && s.settings.map === 'TheIsland_WP') s.settings.map = 'TheIsland'; await steamcmdUpdate(s, ctx, TYPES.ark.appFor(s)); },
  update: (s, ctx) => steamcmdUpdate(s, ctx, TYPES.ark.appFor(s)),
  start: s => {
    const q = [`${s.settings.map}?listen`, `SessionName=${s.settings.hostname}`, `ServerAdminPassword=${s.settings.adminpassword}`, `MaxPlayers=${s.settings.maxplayers}`, 'RCONEnabled=True', `RCONPort=${s.settings.rconport}`, ...(s.settings.password ? [`ServerPassword=${s.settings.password}`] : [])];
    if (s.variant === 'ase') return { cmd: path.join(s.path, 'ShooterGame', 'Binaries', exe('Win64', 'Linux'), exe('ShooterGameServer.exe', 'ShooterGameServer')), cwd: s.path, args: [q.concat([`Port=${s.port}`, 'QueryPort=27015', ...(s.settings.mods ? [`GameModIds=${s.settings.mods}`] : [])]).join('?'), '-server', '-log', '-NoBattlEye'] };
    return { cmd: path.join(s.path, 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe'), cwd: s.path, args: [q.join('?'), `-port=${s.port}`, `-WinLiveMaxPlayers=${s.settings.maxplayers}`, '-log', ...(s.settings.mods ? [`-mods=${s.settings.mods}`] : [])] };
  },
  stopCmd: null, rconStop: 'DoExit', saveRcon: 'SaveWorld', sayRcon: m => `ServerChat ${m}`,
  configs: ['ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini', 'ShooterGame/Saved/Config/WindowsServer/Game.ini', 'ShooterGame/Saved/Config/LinuxServer/GameUserSettings.ini'],
  contentLabel: () => 'Mody', contentDir: s => path.join(s.path, 'ShooterGame', s.variant === 'ase' ? 'Content/Mods' : 'Binaries/Win64/ShooterGame/Mods'),
  rcon: s => ({ protocol: 'source', port: +s.settings.rconport || 27020, password: s.settings.adminpassword }),
  worlds: () => ['ShooterGame/Saved/SavedArks', 'ShooterGame/Saved/SavedArksLocal'],
};

// ---------------- Satisfactory ----------------
function satisfactorySaves() { return U.isWin ? path.join(U.localAppData(), 'FactoryGame', 'Saved', 'SaveGames') : path.join(U.home(), '.config', 'Epic', 'FactoryGame', 'Saved', 'SaveGames'); }
TYPES.satisfactory = {
  name: 'Satisfactory', color: '#f2a51a', port: 7777, steamApp: 1690800,
  fields: [{ id: 'note', label: 'Uwaga', def: 'Nazwę i hasło ustawisz przy pierwszym połączeniu z gry (Menedżer serwerów)' }],
  install: (s, ctx) => steamcmdUpdate(s, ctx, 1690800), update: (s, ctx) => steamcmdUpdate(s, ctx, 1690800),
  start: s => ({ cmd: path.join(s.path, exe('FactoryServer.exe', 'FactoryServer.sh')), cwd: s.path, args: ['-log', '-unattended', `-Port=${s.port}`] }),
  stopCmd: null,
  configs: ['FactoryGame/Saved/Config/WindowsServer/Game.ini', 'FactoryGame/Saved/Config/WindowsServer/Engine.ini', 'FactoryGame/Saved/Config/LinuxServer/Game.ini'],
  contentLabel: () => 'Mody (SML)', contentDir: s => path.join(s.path, 'FactoryGame', 'Mods'),
  worlds: () => [satisfactorySaves()],
};

// ---------------- Enshrouded ----------------
TYPES.enshrouded = {
  name: 'Enshrouded', color: '#4fb3a9', port: 15637, steamApp: 2278520,
  fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer Enshrouded (CodeManager)' }, { id: 'password', label: 'Hasło graczy', def: rnd().slice(0, 8) }, { id: 'slots', label: 'Sloty (max 16)', def: '16' }],
  install: async (s, ctx) => {
    if (!U.isWin) ctx.log('⚠ Serwer Enshrouded jest tylko dla Windows – na Linuksie potrzebny jest Wine/Proton.');
    await steamcmdUpdate(s, ctx, 2278520);
    const f = path.join(s.path, 'enshrouded_server.json');
    const j = U.readJSON(f, null) || { name: '', saveDirectory: './savegame', logDirectory: './logs', ip: '0.0.0.0', queryPort: s.port, slotCount: 16, userGroups: [] };
    j.name = s.settings.hostname; j.queryPort = +s.port; j.slotCount = Math.min(16, +s.settings.slots || 16);
    if (Array.isArray(j.userGroups) && j.userGroups.length) j.userGroups.forEach(g => { if (g.name === 'Default' || g.name === 'Friend') g.password = s.settings.password; });
    else j.userGroups = [{ name: 'Default', password: s.settings.password, canKickBan: false, canAccessInventories: true, canEditBase: true, canExtendBase: true, reservedSlots: 0 }];
    U.writeJSON(f, j);
  },
  update: (s, ctx) => steamcmdUpdate(s, ctx, 2278520),
  start: s => ({ cmd: path.join(s.path, 'enshrouded_server.exe'), cwd: s.path, args: [] }),
  stopCmd: null, configs: ['enshrouded_server.json'],
  contentLabel: () => 'Zapisy', contentDir: s => path.join(s.path, 'savegame'),
  worlds: () => ['savegame'],
};

// ---------------- Space Engineers ----------------
TYPES.spaceengineers = {
  name: 'Space Engineers', color: '#7f8c9a', port: 27016, steamApp: 298740,
  fields: [{ id: 'note', label: 'Uwaga', def: 'Pierwsze uruchomienie otworzy konfigurator SE – utwórz świat i zapisz' }],
  install: async (s, ctx) => { if (!U.isWin) ctx.log('⚠ Serwer Space Engineers jest tylko dla Windows.'); await steamcmdUpdate(s, ctx, 298740); fs.mkdirSync(path.join(s.path, 'Instance'), { recursive: true }); },
  update: (s, ctx) => steamcmdUpdate(s, ctx, 298740),
  start: s => {
    const inst = path.join(s.path, 'Instance');
    const hasCfg = U.exists(path.join(inst, 'SpaceEngineers-Dedicated.cfg'));
    return { cmd: path.join(s.path, 'DedicatedServer64', 'SpaceEngineersDedicated.exe'), cwd: path.join(s.path, 'DedicatedServer64'), args: [...(hasCfg ? ['-console'] : []), '-path', inst, '-ignorelastsession'] };
  },
  stopCmd: null, configs: ['Instance/SpaceEngineers-Dedicated.cfg'],
  contentLabel: () => 'Mody (Warsztat)', contentDir: s => path.join(s.path, 'Instance', 'content', '244850'),
  worlds: () => ['Instance/Saves'],
};

// ---------------- Proxy Minecraft ----------------
async function velocityJar(dest, ctx) {
  let url = null;
  try {
    const p = await N.getJSON('https://fill.papermc.io/v3/projects/velocity');
    const vers = Object.values(p.versions || {}).flat();
    const v = vers[0];
    const b = await N.getJSON(`https://fill.papermc.io/v3/projects/velocity/versions/${v}/builds/latest`);
    url = (b.downloads['server:default'] || Object.values(b.downloads)[0]).url;
  } catch { /* stare API */ }
  if (!url) {
    const p = await N.getJSON('https://api.papermc.io/v2/projects/velocity');
    const v = p.versions[p.versions.length - 1];
    const b = await N.getJSON(`https://api.papermc.io/v2/projects/velocity/versions/${v}/builds`);
    const last = b.builds[b.builds.length - 1];
    url = `https://api.papermc.io/v2/projects/velocity/versions/${v}/builds/${last.build}/downloads/${last.downloads.application.name}`;
  }
  await N.download(url, dest, ctx.progress);
}
TYPES.mcproxy = {
  name: 'Minecraft Proxy', color: '#3d8fd6', port: 25577,
  variants: [{ id: 'velocity', name: 'Velocity (zalecany)' }, { id: 'bungeecord', name: 'BungeeCord' }],
  fields: [{ id: 'servers', label: 'Serwery (nazwa=adres, po przecinku)', def: 'lobby=127.0.0.1:25565' }, { id: 'ram', label: 'RAM (MB)', def: '512' }],
  install: async (s, ctx) => {
    fs.mkdirSync(path.join(s.path, 'plugins'), { recursive: true });
    const { java } = await N.pickJava(17, ctx.settings.javaPath);
    s.java = java ? java.path : 'java';
    if (s.variant === 'bungeecord') {
      await N.download('https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar', path.join(s.path, 'proxy.jar'), ctx.progress);
      const servers = String(s.settings.servers).split(',').map(x => x.split('=')).filter(x => x[1]);
      writeIfMissing(path.join(s.path, 'config.yml'), `listeners:\n- host: 0.0.0.0:${s.port}\n  motd: '&aSerwer zarządzany przez CodeManager'\n  max_players: 100\n  priorities:\n  - ${(servers[0] || ['lobby'])[0].trim()}\nservers:\n${servers.map(([n, a]) => `  ${n.trim()}:\n    address: ${a.trim()}\n    restricted: false\n    motd: '${n.trim()}'`).join('\n')}\nip_forward: true\nonline_mode: true\n`);
      ctx.log('Pamiętaj: na serwerach Spigot/Paper za proxy ustaw bungeecord: true w spigot.yml i online-mode=false w server.properties.');
    } else {
      await velocityJar(path.join(s.path, 'proxy.jar'), ctx);
      const servers = String(s.settings.servers).split(',').map(x => x.split('=')).filter(x => x[1]);
      const secret = rnd() + rnd();
      writeIfMissing(path.join(s.path, 'forwarding.secret'), secret);
      writeIfMissing(path.join(s.path, 'velocity.toml'), `config-version = "2.7"\nbind = "0.0.0.0:${s.port}"\nmotd = "<green>Serwer zarządzany przez CodeManager"\nshow-max-players = 100\nonline-mode = true\nplayer-info-forwarding-mode = "modern"\nforwarding-secret-file = "forwarding.secret"\n\n[servers]\n${servers.map(([n, a]) => `${n.trim()} = "${a.trim()}"`).join('\n')}\ntry = [${servers.slice(0, 1).map(([n]) => `"${n.trim()}"`).join(', ')}]\n\n[forced-hosts]\n\n[advanced]\n\n[query]\nenabled = false\n`);
      ctx.log(`Sekret przekazywania (forwarding.secret) zapisano w folderze proxy. Na serwerach Paper ustaw w config/paper-global.yml: proxies.velocity.enabled: true, online-mode: true i secret: ${secret}`);
    }
  },
  update: async (s, ctx) => { const keep = U.exists(path.join(s.path, 'proxy.jar')); if (keep) fs.renameSync(path.join(s.path, 'proxy.jar'), path.join(s.path, 'proxy.jar.old')); try { await TYPES.mcproxy.install(s, ctx); } catch (e) { if (keep) fs.renameSync(path.join(s.path, 'proxy.jar.old'), path.join(s.path, 'proxy.jar')); throw e; } },
  start: s => ({ cmd: s.java || 'java', cwd: s.path, args: [`-Xms${s.settings.ram || 512}M`, `-Xmx${s.settings.ram || 512}M`, '-XX:+UseG1GC', '-jar', 'proxy.jar'] }),
  stopCmd: 'end', // Velocity akceptuje też "shutdown"
  configs: s => (s.variant === 'bungeecord' ? ['config.yml'] : ['velocity.toml', 'forwarding.secret']),
  contentLabel: () => 'Pluginy proxy', contentDir: s => path.join(s.path, 'plugins'),
  say: (m, s) => (s.variant === 'bungeecord' ? `alert ${m}` : `broadcast ${m}`),
};
TYPES.mcproxy.stopCmdFor = s => (s.variant === 'velocity' ? 'shutdown' : 'end');

// ---------------- metadane dla istniejących typów ----------------
const mcProps = s => parseIni(U.readText(path.join(s.path, 'server.properties'), '')).__root;
Object.assign(TYPES.minecraft, {
  rcon: s => { const p = mcProps(s); return p['enable-rcon'] === 'true' ? { protocol: 'source', port: +p['rcon.port'] || 25575, password: p['rcon.password'] } : null; },
  rconHint: 'Włącz RCON w server.properties (enable-rcon=true, rcon.password=…) – CodeManager robi to automatycznie dla nowych serwerów.',
  worlds: s => { const lvl = mcProps(s)['level-name'] || 'world'; return [lvl, `${lvl}_nether`, `${lvl}_the_end`]; },
  say: m => `say ${m}`, saveCmd: 'save-all flush', preBackup: ['save-off', 'save-all flush'], postBackup: ['save-on'],
});
// RCON domyślnie włączany dla nowych serwerów Minecraft
const mcInstall = TYPES.minecraft.install;
TYPES.minecraft.install = async (s, ctx) => {
  await mcInstall(s, ctx);
  const f = path.join(s.path, 'server.properties');
  let t = U.readText(f, '');
  if (!/enable-rcon=true/.test(t)) {
    s.settings.rconpassword = s.settings.rconpassword || rnd();
    t = setIniLine(t, 'enable-rcon', 'true'); t = setIniLine(t, 'rcon.port', String(+s.port + 10)); t = setIniLine(t, 'rcon.password', s.settings.rconpassword);
    fs.writeFileSync(f, t); ctx.log(`Włączono RCON na porcie ${+s.port + 10}.`);
  }
};
Object.assign(TYPES.rust, { rcon: s => ({ protocol: 'webrcon', port: +s.port + 1, password: s.settings.rconpassword }), worlds: () => ['server/codemanager'], say: m => `say ${m}`, saveCmd: 'server.save' });
TYPES.cs2.fields.push({ id: 'rconpassword', label: 'Hasło RCON', def: rnd() });
TYPES.tf2.fields.push({ id: 'rconpassword', label: 'Hasło RCON', def: rnd() });
for (const k of ['cs2', 'tf2']) {
  const orig = TYPES[k].start;
  TYPES[k].start = s => { const st = orig(s); if (s.settings.rconpassword) st.args.push('+rcon_password', s.settings.rconpassword); return st; };
  Object.assign(TYPES[k], { rcon: s => (s.settings.rconpassword ? { protocol: 'source', port: +s.port, password: s.settings.rconpassword } : null), say: m => `say ${m}` });
}
Object.assign(TYPES.valheim, { worlds: () => ['save/worlds_local', 'save/worlds'] });
Object.assign(TYPES.projectzomboid, {
  rcon: s => { const ini = parseIni(U.readText(path.join(s.path, 'Zomboid', 'Server', `${s.settings.servername}.ini`), '')).__root; return ini.RCONPassword ? { protocol: 'source', port: +ini.RCONPort || 27015, password: ini.RCONPassword } : null; },
  rconHint: 'Ustaw RCONPassword w pliku .ini serwera (zakładka Konfiguracja) i zrestartuj serwer.',
  worlds: s => ['Zomboid/Saves/Multiplayer', 'Zomboid/Server', 'Zomboid/db'], say: m => `servermsg "${m}"`, saveCmd: 'save',
});
Object.assign(TYPES.terraria, { worlds: () => ['worlds', 'tshock/tshock.sqlite'], say: m => `say ${m}`, saveCmd: 'save' });
Object.assign(TYPES.dayz, { worlds: s => ['mpmissions', 'profiles'] });
Object.assign(TYPES.armareforger, { worlds: () => ['profile/.save', 'profile/profile'] });
Object.assign(TYPES.fivem, {
  rcon: s => { const m = (U.readText(path.join(s.path, 'server-data', 'server.cfg'), '') || '').match(/^\s*rcon_password\s+"?([^"\s]+)"?/m); return m ? { protocol: 'quake', port: +s.port, password: m[1] } : null; },
  rconHint: 'Dodaj do server.cfg linię: rcon_password "TwojeHaslo" (zakładka Konfiguracja).', worlds: () => ['server-data/resources'], say: m => `say ${m}`,
});
Object.assign(TYPES.mta, { worlds: () => ['mods/deathmatch/internal.db', 'mods/deathmatch/registry.db', 'mods/deathmatch/acl.xml'], say: m => `say ${m}` });
Object.assign(TYPES.beammp, { worlds: () => ['Resources/Server'] });

require('./defs3');

function worldPaths(s) {
  const t = TYPES[s.type];
  const list = t.worlds ? t.worlds(s) : [];
  return list.map(p => (path.isAbsolute(p) ? p : path.join(s.path, p))).filter(U.exists);
}

module.exports = { TYPES, FRAMEWORKS, worldPaths, palCfgPath };
