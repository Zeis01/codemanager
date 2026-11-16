// Definicje typów serwerów: instalacja plików, uruchamianie, frameworki pluginów, pliki konfiguracyjne
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const N = require('../net');
const I = require('../installers');
const { requiredJava } = require('../compat/minecraft');

const exe = (win, nix) => (U.isWin ? win : nix);

// ---------------- SteamCMD ----------------
function steamcmdPath(userData) {
  return path.join(userData, 'steamcmd', exe('steamcmd.exe', 'steamcmd.sh'));
}
async function ensureSteamCmd(ctx) {
  const p = steamcmdPath(ctx.userData);
  if (U.exists(p)) return p;
  const dir = path.dirname(p);
  ctx.log('Pobieranie SteamCMD…');
  if (U.isWin) {
    const z = await N.download('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip', N.tempFile('steamcmd.zip'), ctx.progress);
    N.extractZip(z, dir);
  } else {
    const t = await N.download(`https://steamcdn-a.akamaihd.net/client/installer/steamcmd_${U.isMac ? 'osx' : 'linux'}.tar.gz`, N.tempFile('steamcmd.tar.gz'), ctx.progress);
    await N.extractTar(t, dir);
  }
  return p;
}
async function steamcmdUpdate(server, ctx, appId, { login, beta } = {}) {
  const bin = await ensureSteamCmd(ctx);
  const args = ['+force_install_dir', server.path, '+login', ...(login ? [login] : ['anonymous']), '+app_update', String(appId)];
  if (beta) args.push('-beta', beta);
  args.push('validate', '+quit');
  ctx.log(`> steamcmd ${args.join(' ').replace(server.path, '"' + server.path + '"')}`);
  await ctx.spawnLogged(bin, args, path.dirname(bin), line => {
    const m = line.match(/progress:\s*([\d.]+)/i);
    if (m) ctx.progress({ pct: Math.round(+m[1]) });
  }, { interactive: !!login });
  // SteamCMD zwraca czasem kod 7 przy pierwszej aktualizacji samego siebie – sprawdzamy wynik po plikach
}
async function steamcmdWorkshop(server, ctx, gameAppId, itemId, login) {
  const bin = await ensureSteamCmd(ctx);
  const args = ['+force_install_dir', server.path, '+login', login || 'anonymous', '+workshop_download_item', String(gameAppId), String(itemId), 'validate', '+quit'];
  await ctx.spawnLogged(bin, args, path.dirname(bin), null, { interactive: !!login });
  return path.join(server.path, 'steamapps', 'workshop', 'content', String(gameAppId), String(itemId));
}

// ---------------- Minecraft ----------------
async function mcManifest() { return N.getJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'); }
async function mcVersions() {
  const m = await mcManifest();
  return m.versions.filter(v => v.type === 'release').map(v => v.id);
}
async function mcInstall(server, ctx) {
  const mc = server.version; const dir = server.path; const v = server.variant;
  fs.mkdirSync(dir, { recursive: true });
  const need = requiredJava(mc);
  const { java } = await N.pickJava(need, ctx.settings.javaPath);
  if (!java) ctx.log(`⚠ Nie znaleziono Javy ${need}+. Zainstaluj ją (np. Eclipse Temurin z adoptium.net) i ustaw w Ustawieniach.`);
  const javaBin = java ? java.path : 'java';
  server.java = javaBin;
  if (v === 'vanilla') {
    const m = await mcManifest(); const e = m.versions.find(x => x.id === mc); if (!e) throw new Error('Nie ma takiej wersji: ' + mc);
    const vj = await N.getJSON(e.url);
    await N.download(vj.downloads.server.url, path.join(dir, 'server.jar'), ctx.progress);
    server.jar = 'server.jar';
  } else if (v === 'paper') {
    let url = null;
    try {
      const j = await N.getJSON(`https://fill.papermc.io/v3/projects/paper/versions/${mc}/builds/latest`);
      url = j.downloads && (j.downloads['server:default'] || Object.values(j.downloads)[0]).url;
    } catch { /* starsze API */ }
    if (!url) {
      const b = await N.getJSON(`https://api.papermc.io/v2/projects/paper/versions/${mc}/builds`);
      const last = b.builds[b.builds.length - 1];
      url = `https://api.papermc.io/v2/projects/paper/versions/${mc}/builds/${last.build}/downloads/${last.downloads.application.name}`;
    }
    await N.download(url, path.join(dir, 'server.jar'), ctx.progress);
    server.jar = 'server.jar';
  } else if (v === 'purpur') {
    await N.download(`https://api.purpurmc.org/v2/purpur/${mc}/latest/download`, path.join(dir, 'server.jar'), ctx.progress);
    server.jar = 'server.jar';
  } else if (v === 'fabric') {
    const f = await I.fabricLatest();
    await N.download(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${f.loader}/${f.installer.version}/server/jar`, path.join(dir, 'fabric-server-launch.jar'), ctx.progress);
    server.jar = 'fabric-server-launch.jar'; server.loaderVersion = f.loader;
  } else {
    const r = await I.install(v, { root: dir, mcVersion: mc, java: javaBin, side: 'server', userData: ctx.userData }, ctx.log, ctx.progress);
    server.loaderVersion = r.version;
    if (v === 'quilt') server.jar = 'quilt-server-launch.jar';
  }
  if (server.eula) fs.writeFileSync(path.join(dir, 'eula.txt'), `# Zaakceptowano w CodeManager ${new Date().toISOString()}\neula=true\n`);
  const props = path.join(dir, 'server.properties');
  if (!U.exists(props)) fs.writeFileSync(props, `server-port=${server.port || 25565}\nmotd=${server.name} (CodeManager)\nmax-players=20\nonline-mode=true\n`);
  fs.mkdirSync(path.join(dir, ['paper', 'purpur'].includes(v) ? 'plugins' : 'mods'), { recursive: true });
}
function mcStart(server) {
  const dir = server.path; const ram = server.ram || 4096;
  const java = server.java || 'java';
  const mem = [`-Xms${Math.min(ram, 1024)}M`, `-Xmx${ram}M`];
  // Nowy Forge/NeoForge: plik argumentów
  const argsName = U.isWin ? 'win_args.txt' : 'unix_args.txt';
  const libs = path.join(dir, 'libraries', 'net');
  const argFile = U.walk(libs, { maxDepth: 6, filter: f => f.endsWith('/' + argsName) })[0];
  if (argFile && ['forge', 'neoforge'].includes(server.variant)) {
    const extra = U.exists(path.join(dir, 'user_jvm_args.txt')) ? ['@user_jvm_args.txt'] : [];
    return { cmd: java, args: [...mem, ...extra, '@' + path.join('libraries', 'net', argFile).split(path.sep).join('/'), 'nogui'], cwd: dir };
  }
  let jar = server.jar && U.exists(path.join(dir, server.jar)) ? server.jar : null;
  if (!jar) jar = U.listFiles(dir, ['.jar']).map(f => path.basename(f)).find(f => /(server|forge|launch)/i.test(f) && !/installer/i.test(f));
  if (!jar) throw new Error('Nie znaleziono pliku .jar serwera');
  return { cmd: java, args: [...mem, '-jar', jar, 'nogui'], cwd: dir };
}

// ---------------- pomocnicze ----------------
function writeIfMissing(file, content) { if (!U.exists(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); } }

// ---------------- Definicje ----------------
const TYPES = {
  minecraft: {
    name: 'Minecraft', color: '#62b246', port: 25565,
    variants: [
      { id: 'paper', name: 'Paper (pluginy)' }, { id: 'purpur', name: 'Purpur (pluginy)' }, { id: 'vanilla', name: 'Vanilla' },
      { id: 'fabric', name: 'Fabric (mody)' }, { id: 'quilt', name: 'Quilt (mody)' }, { id: 'forge', name: 'Forge (mody)' }, { id: 'neoforge', name: 'NeoForge (mody)' },
    ],
    needsVersion: true, needsEula: true, versions: mcVersions,
    install: mcInstall, start: mcStart, stopCmd: 'stop',
    configs: ['server.properties', 'eula.txt', 'ops.json', 'whitelist.json', 'banned-players.json', 'bukkit.yml', 'spigot.yml', 'purpur.yml', 'config/paper-global.yml', 'config/paper-world-defaults.yml', 'user_jvm_args.txt'],
    contentLabel: s => ['paper', 'purpur', 'vanilla'].includes(s.variant) ? 'Pluginy' : 'Mody',
    contentDir: s => path.join(s.path, ['paper', 'purpur', 'vanilla'].includes(s.variant) ? 'plugins' : 'mods'),
  },
  rust: {
    name: 'Rust', color: '#cd412b', port: 28015, steamApp: 258550,
    fields: [
      { id: 'hostname', label: 'Nazwa serwera', def: 'Serwer Rust (CodeManager)' }, { id: 'worldsize', label: 'Rozmiar mapy', def: '3500' },
      { id: 'seed', label: 'Seed', def: String(Math.floor(Math.random() * 99999)) }, { id: 'maxplayers', label: 'Maks. graczy', def: '50' },
      { id: 'rconpassword', label: 'Hasło RCON', def: Math.random().toString(36).slice(2, 12) },
    ],
    install: (s, ctx) => steamcmdUpdate(s, ctx, 258550),
    update: (s, ctx) => steamcmdUpdate(s, ctx, 258550),
    start: s => ({
      cmd: path.join(s.path, exe('RustDedicated.exe', 'RustDedicated')), cwd: s.path,
      args: ['-batchmode', '-nographics', '+server.port', String(s.port), '+server.level', 'Procedural Map', '+server.seed', s.settings.seed, '+server.worldsize', s.settings.worldsize,
        '+server.maxplayers', s.settings.maxplayers, '+server.hostname', s.settings.hostname, '+server.identity', 'codemanager', '+rcon.port', String(+s.port + 1), '+rcon.password', s.settings.rconpassword, '+rcon.web', '1', '-logfile', 'logs/server.log'],
    }),
    stopCmd: 'quit',
    configs: ['server/codemanager/cfg/server.cfg', 'server/codemanager/cfg/users.cfg', 'oxide/config', 'carbon/configs'],
    contentLabel: () => 'Pluginy', contentDir: s => U.isDir(path.join(s.path, 'carbon')) ? path.join(s.path, 'carbon', 'plugins') : path.join(s.path, 'oxide', 'plugins'),
    contentExt: ['.cs'],
    frameworks: ['oxide', 'carbon'],
  },
  cs2: {
    name: 'Counter-Strike 2', color: '#de9b35', port: 27015, steamApp: 730,
    fields: [{ id: 'map', label: 'Mapa startowa', def: 'de_dust2' }, { id: 'maxplayers', label: 'Maks. graczy', def: '10' }, { id: 'gslt', label: 'Token GSLT (opcjonalnie)', def: '' }, { id: 'gamemode', label: 'Tryb (0=casual, 1=competitive)', def: '1' }],
    install: (s, ctx) => steamcmdUpdate(s, ctx, 730), update: (s, ctx) => steamcmdUpdate(s, ctx, 730),
    start: s => ({
      cmd: path.join(s.path, 'game', 'bin', exe('win64', 'linuxsteamrt64'), exe('cs2.exe', 'cs2')), cwd: s.path,
      args: ['-dedicated', '-console', '-usercon', '-port', String(s.port), '+game_type', '0', '+game_mode', s.settings.gamemode || '1', '-maxplayers', s.settings.maxplayers || '10', '+map', s.settings.map || 'de_dust2', ...(s.settings.gslt ? ['+sv_setsteamaccount', s.settings.gslt] : [])],
    }),
    stopCmd: 'quit',
    configs: ['game/csgo/cfg/server.cfg', 'game/csgo/cfg/gamemode_competitive.cfg', 'game/csgo/cfg/gamemode_casual.cfg', 'game/csgo/gameinfo.gi', 'game/csgo/addons/counterstrikesharp/configs/core.json', 'game/csgo/addons/counterstrikesharp/configs/admins.json'],
    contentLabel: () => 'Pluginy', contentDir: s => path.join(s.path, 'game', 'csgo', 'addons', 'counterstrikesharp', 'plugins'),
    frameworks: ['metamod2', 'counterstrikesharp'],
  },
  dayz: {
    name: 'DayZ', color: '#8a9a5b', port: 2302, steamApp: 223350, needsLogin: true,
    fields: [{ id: 'steamuser', label: 'Login Steam (konto z DayZ)', def: '' }, { id: 'hostname', label: 'Nazwa serwera', def: 'Serwer DayZ (CodeManager)' }, { id: 'mods', label: 'Mody (np. @CF;@VPPAdminTools)', def: '' }, { id: 'servermods', label: 'Mody serwerowe (-serverMod)', def: '' }],
    install: async (s, ctx) => {
      if (!s.settings.steamuser) throw new Error('Serwer DayZ wymaga zalogowania kontem Steam, które posiada grę. Podaj login.');
      ctx.log('Jeśli SteamCMD poprosi o hasło lub kod Steam Guard, wpisz go w polu poleceń konsoli poniżej.');
      await steamcmdUpdate(s, ctx, 223350, { login: s.settings.steamuser });
      const cfg = path.join(s.path, 'serverDZ.cfg');
      if (U.exists(cfg)) { let t = U.readText(cfg); t = t.replace(/hostname\s*=\s*"[^"]*"/, `hostname = "${s.settings.hostname}"`); fs.writeFileSync(cfg, t); }
    },
    update: (s, ctx) => steamcmdUpdate(s, ctx, 223350, { login: s.settings.steamuser }),
    start: s => ({
      cmd: path.join(s.path, exe('DayZServer_x64.exe', 'DayZServer')), cwd: s.path,
      args: ['-config=serverDZ.cfg', `-port=${s.port}`, '-profiles=profiles', '-dologs', '-adminlog', '-netlog', '-freezecheck', ...(s.settings.mods ? [`-mod=${s.settings.mods}`] : []), ...(s.settings.servermods ? [`-serverMod=${s.settings.servermods}`] : [])],
    }),
    stopCmd: null,
    configs: ['serverDZ.cfg', 'mpmissions', 'profiles'],
    contentLabel: () => 'Mody (@)', contentDir: s => s.path,
    workshopApp: 221100,
  },
  valheim: {
    name: 'Valheim', color: '#4a8fb8', port: 2456, steamApp: 896660,
    fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer Valheim' }, { id: 'world', label: 'Nazwa świata', def: 'Dedicated' }, { id: 'password', label: 'Hasło (min. 5 znaków)', def: Math.random().toString(36).slice(2, 9) }, { id: 'public', label: 'Publiczny (1/0)', def: '1' }, { id: 'crossplay', label: 'Crossplay (1/0)', def: '0' }],
    validate: s => {
      if ((s.settings.password || '').length < 5) return 'Hasło musi mieć co najmniej 5 znaków.';
      if (s.settings.hostname && s.settings.password && s.settings.hostname.includes(s.settings.password)) return 'Hasło nie może być częścią nazwy serwera.';
      return null;
    },
    install: (s, ctx) => steamcmdUpdate(s, ctx, 896660), update: (s, ctx) => steamcmdUpdate(s, ctx, 896660),
    start: s => ({
      cmd: path.join(s.path, exe('valheim_server.exe', 'valheim_server.x86_64')), cwd: s.path, env: { SteamAppId: '892970' },
      args: ['-nographics', '-batchmode', '-name', s.settings.hostname, '-port', String(s.port), '-world', s.settings.world, '-password', s.settings.password, '-public', s.settings.public || '1', '-savedir', path.join(s.path, 'save'), ...(s.settings.crossplay === '1' ? ['-crossplay'] : [])],
    }),
    stopCmd: null,
    configs: ['BepInEx/config', 'save/adminlist.txt', 'save/bannedlist.txt', 'save/permittedlist.txt'],
    contentLabel: () => 'Mody (BepInEx)', contentDir: s => path.join(s.path, 'BepInEx', 'plugins'),
    frameworks: ['bepinex-valheim'],
  },
  projectzomboid: {
    name: 'Project Zomboid', color: '#b33a3a', port: 16261, steamApp: 380870,
    fields: [{ id: 'servername', label: 'Nazwa konfiguracji', def: 'servertest' }, { id: 'adminpassword', label: 'Hasło admina', def: Math.random().toString(36).slice(2, 10) }, { id: 'beta', label: 'Gałąź (puste = stabilna, np. unstable)', def: '' }],
    install: (s, ctx) => steamcmdUpdate(s, ctx, 380870, { beta: s.settings.beta || undefined }),
    update: (s, ctx) => steamcmdUpdate(s, ctx, 380870, { beta: s.settings.beta || undefined }),
    start: s => U.isWin
      ? { cmd: 'cmd.exe', args: ['/c', 'StartServer64.bat', '-servername', s.settings.servername, '-adminpassword', s.settings.adminpassword, `-cachedir=${path.join(s.path, 'Zomboid')}`, '-port', String(s.port)], cwd: s.path }
      : { cmd: path.join(s.path, 'start-server.sh'), args: ['-servername', s.settings.servername, '-adminpassword', s.settings.adminpassword, `-cachedir=${path.join(s.path, 'Zomboid')}`, '-port', String(s.port)], cwd: s.path },
    stopCmd: 'quit',
    configs: s => [`Zomboid/Server/${s.settings.servername}.ini`, `Zomboid/Server/${s.settings.servername}_SandboxVars.lua`, `Zomboid/Server/${s.settings.servername}_spawnregions.lua`],
    contentLabel: () => 'Mody (Warsztat)', contentDir: s => path.join(s.path, 'Zomboid', 'Server'),
  },
  tf2: {
    name: 'Team Fortress 2', color: '#b8383b', port: 27015, steamApp: 232250,
    fields: [{ id: 'map', label: 'Mapa', def: 'ctf_2fort' }, { id: 'maxplayers', label: 'Maks. graczy', def: '24' }, { id: 'gslt', label: 'Token GSLT (opcjonalnie)', def: '' }],
    install: (s, ctx) => steamcmdUpdate(s, ctx, 232250), update: (s, ctx) => steamcmdUpdate(s, ctx, 232250),
    start: s => ({
      cmd: path.join(s.path, exe('srcds.exe', 'srcds_run')), cwd: s.path,
      args: ['-console', '-game', 'tf', '-port', String(s.port), '+maxplayers', s.settings.maxplayers, '+map', s.settings.map, ...(s.settings.gslt ? ['+sv_setsteamaccount', s.settings.gslt] : [])],
    }),
    stopCmd: 'quit',
    configs: ['tf/cfg/server.cfg', 'tf/cfg/mapcycle.txt', 'tf/addons/sourcemod/configs/admins_simple.ini', 'tf/addons/sourcemod/configs/databases.cfg', 'tf/addons/sourcemod/configs/core.cfg'],
    contentLabel: () => 'Pluginy (SourceMod)', contentDir: s => path.join(s.path, 'tf', 'addons', 'sourcemod', 'plugins'), contentExt: ['.smx'],
    frameworks: ['metamod112', 'sourcemod'],
  },
  armareforger: {
    name: 'Arma Reforger', color: '#a3a852', port: 2001, steamApp: 1874900,
    fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer Arma Reforger' }, { id: 'scenario', label: 'Scenariusz', def: '{ECC61978EDCC2B5A}Missions/23_Campaign.conf' }, { id: 'maxplayers', label: 'Maks. graczy', def: '64' }, { id: 'adminpassword', label: 'Hasło admina', def: Math.random().toString(36).slice(2, 10) }],
    install: async (s, ctx) => {
      await steamcmdUpdate(s, ctx, 1874900);
      writeIfMissing(path.join(s.path, 'config.json'), JSON.stringify({
        bindAddress: '', bindPort: +s.port, publicAddress: '', publicPort: +s.port,
        a2s: { address: '0.0.0.0', port: 17777 },
        game: {
          name: s.settings.hostname, password: '', passwordAdmin: s.settings.adminpassword, admins: [], scenarioId: s.settings.scenario, maxPlayers: +s.settings.maxplayers,
          visible: true, crossPlatform: true, supportedPlatforms: ['PLATFORM_PC', 'PLATFORM_XBL', 'PLATFORM_PSN'],
          gameProperties: { serverMaxViewDistance: 2500, networkViewDistance: 1500, disableThirdPerson: false, fastValidation: true, battlEye: true },
          mods: [],
        },
        operating: { lobbyPlayerSynchronise: true },
      }, null, 2));
    },
    update: (s, ctx) => steamcmdUpdate(s, ctx, 1874900),
    start: s => ({ cmd: path.join(s.path, exe('ArmaReforgerServer.exe', 'ArmaReforgerServer')), cwd: s.path, args: ['-config', path.join(s.path, 'config.json'), '-profile', path.join(s.path, 'profile'), '-maxFPS', '60', '-logStats', '60000'] }),
    stopCmd: null,
    configs: ['config.json'],
    contentLabel: () => 'Mody (config.json)', contentDir: s => path.join(s.path, 'profile', 'addons'),
  },
  terraria: {
    name: 'Terraria (TShock)', color: '#3fa34d', port: 7777,
    fields: [{ id: 'world', label: 'Nazwa świata', def: 'CodeManager' }, { id: 'size', label: 'Rozmiar (1=mały, 2=średni, 3=duży)', def: '2' }, { id: 'maxplayers', label: 'Maks. graczy', def: '8' }],
    install: async (s, ctx) => {
      const rel = await N.githubLatest('Pryaxis/TShock', U.isWin ? /win-x64.*\.zip$/i : /linux-x64.*\.zip$/i);
      ctx.log(`Pobieranie ${rel.name}…`);
      const z = await N.download(rel.url, N.tempFile(rel.name), ctx.progress);
      const top = N.zipTopFolder(z);
      N.extractZip(z, s.path, { strip: top ? 1 : 0 });
      for (const t of U.listFiles(s.path, ['.tar'])) { await N.extractTar(t, s.path).catch(() => {}); }
      fs.mkdirSync(path.join(s.path, 'worlds'), { recursive: true });
      s.version = rel.tag;
    },
    start: s => ({
      cmd: U.firstExisting([path.join(s.path, 'TShock.Server.exe'), path.join(s.path, 'TShock.Server'), path.join(s.path, 'TerrariaServer.exe')]) || path.join(s.path, exe('TShock.Server.exe', 'TShock.Server')), cwd: s.path,
      args: ['-port', String(s.port), '-maxplayers', s.settings.maxplayers, '-world', path.join(s.path, 'worlds', s.settings.world + '.wld'), '-autocreate', s.settings.size || '2', '-worldname', s.settings.world],
    }),
    stopCmd: 'exit',
    configs: ['tshock/config.json', 'tshock/sscconfig.json', 'tshock/motd.txt'],
    contentLabel: () => 'Pluginy', contentDir: s => path.join(s.path, 'ServerPlugins'), contentExt: ['.dll'],
  },
  fivem: {
    name: 'FiveM', color: '#f40552', port: 30120,
    fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer FiveM (CodeManager)' }, { id: 'license', label: 'Klucz licencji (portal.cfx.re)', def: '' }, { id: 'maxclients', label: 'Maks. graczy', def: '48' }],
    install: async (s, ctx) => {
      const plat = U.isWin ? 'win32' : 'linux';
      const info = await N.getJSON(`https://changelogs-live.fivem.net/api/changelog/versions/${plat}/server`);
      const url = info.recommended_download || info.latest_download;
      ctx.log(`Pobieranie artefaktów FXServer (build ${info.recommended || info.latest})…`);
      const file = await N.download(url, N.tempFile(U.isWin ? 'server.7z' : 'fx.tar.xz'), ctx.progress);
      if (U.isWin) await N.extract7z(file, path.join(s.path, 'server')); else await N.extractTar(file, path.join(s.path, 'server'));
      ctx.log('Pobieranie cfx-server-data…');
      const z = await N.download('https://github.com/citizenfx/cfx-server-data/archive/refs/heads/master.zip', N.tempFile('cfx-server-data.zip'), ctx.progress);
      N.extractZip(z, path.join(s.path, 'server-data'), { strip: 1 });
      writeIfMissing(path.join(s.path, 'server-data', 'server.cfg'), fivemCfg(s));
      s.version = String(info.recommended || info.latest);
    },
    update: async (s, ctx) => { const keep = s.path; await TYPES.fivem.install({ ...s, path: keep }, ctx); },
    start: s => ({ cmd: path.join(s.path, 'server', exe('FXServer.exe', 'run.sh')), args: ['+exec', 'server.cfg'], cwd: path.join(s.path, 'server-data') }),
    stopCmd: 'quit',
    configs: ['server-data/server.cfg'],
    contentLabel: () => 'Zasoby (resources)', contentDir: s => path.join(s.path, 'server-data', 'resources'),
  },
  mta: {
    name: 'MTA: San Andreas', color: '#c8641e', port: 22003,
    fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer MTA (CodeManager)' }, { id: 'maxplayers', label: 'Maks. graczy', def: '32' }],
    install: async (s, ctx) => {
      if (U.isWin) {
        let src = null;
        for (const v of ['1.6', '1.5']) { const p = await U.regQuery(`HKLM\\SOFTWARE\\WOW6432Node\\Multi Theft Auto: San Andreas All\\${v}`, 'Last Install Location'); if (p && U.isDir(path.join(p, 'server'))) { src = path.join(p, 'server'); break; } }
        if (!src) src = U.firstExisting(['C:\\Program Files (x86)\\MTA San Andreas 1.6\\server', 'C:\\Program Files (x86)\\MTA San Andreas 1.5\\server']);
        if (!src) throw new Error('Na Windows serwer MTA jest częścią instalacji gry. Zainstaluj MTA:SA z multitheftauto.com (z opcją "Dedicated server"), a potem spróbuj ponownie – lub użyj "Importuj istniejący".');
        ctx.log('Kopiowanie plików serwera z ' + src);
        U.copyRecursive(src, s.path);
      } else {
        const t = await N.download('https://linux.multitheftauto.com/dl/multitheftauto_linux_x64.tar.gz', N.tempFile('mta.tar.gz'), ctx.progress);
        await N.extractTar(t, s.path);
        const inner = U.listDirs(s.path).find(d => /multitheftauto_linux/.test(d));
        if (inner) { U.copyRecursive(inner, s.path); fs.rmSync(inner, { recursive: true, force: true }); }
        const bc = await N.download('https://linux.multitheftauto.com/dl/baseconfig.tar.gz', N.tempFile('baseconfig.tar.gz'));
        await N.extractTar(bc, path.join(s.path, 'mods', 'deathmatch'));
      }
      const resDir = path.join(s.path, 'mods', 'deathmatch', 'resources');
      if (!U.listDirs(resDir).length) {
        ctx.log('Pobieranie domyślnych zasobów MTA…');
        const z = await N.download('https://mirror-cdn.multitheftauto.com/mtasa/resources/mtasa-resources-latest.zip', N.tempFile('mta-res.zip'), ctx.progress);
        N.extractZip(z, resDir);
      }
      const conf = path.join(s.path, 'mods', 'deathmatch', 'mtaserver.conf');
      if (U.exists(conf)) { let t = U.readText(conf); t = t.replace(/<servername>[^<]*<\/servername>/, `<servername>${s.settings.hostname}</servername>`).replace(/<serverport>\d+<\/serverport>/, `<serverport>${s.port}</serverport>`).replace(/<maxplayers>\d+<\/maxplayers>/, `<maxplayers>${s.settings.maxplayers}</maxplayers>`); fs.writeFileSync(conf, t); }
    },
    start: s => ({ cmd: U.firstExisting([path.join(s.path, 'MTA Server64.exe'), path.join(s.path, 'MTA Server.exe'), path.join(s.path, 'mta-server64'), path.join(s.path, 'mta-server')]) || path.join(s.path, exe('MTA Server.exe', 'mta-server64')), args: ['-n', '-t', '-u'], cwd: s.path }),
    stopCmd: 'shutdown',
    configs: ['mods/deathmatch/mtaserver.conf', 'mods/deathmatch/acl.xml'],
    contentLabel: () => 'Zasoby (resources)', contentDir: s => path.join(s.path, 'mods', 'deathmatch', 'resources'),
  },
  beammp: {
    name: 'BeamMP (BeamNG)', color: '#f7931e', port: 30814,
    fields: [{ id: 'hostname', label: 'Nazwa serwera', def: 'Serwer BeamMP (CodeManager)' }, { id: 'authkey', label: 'AuthKey (keymaster.beammp.com)', def: '' }, { id: 'map', label: 'Mapa', def: '/levels/gridmap_v2/info.json' }, { id: 'maxplayers', label: 'Maks. graczy', def: '8' }],
    install: async (s, ctx) => {
      const rel = await N.githubLatest('BeamMP/BeamMP-Server', U.isWin ? /^BeamMP-Server\.exe$/i : /ubuntu.*x86_64$|linux.*x86_64$/i);
      const target = path.join(s.path, U.isWin ? 'BeamMP-Server.exe' : 'BeamMP-Server');
      await N.download(rel.url, target, ctx.progress);
      if (!U.isWin) fs.chmodSync(target, 0o755);
      fs.mkdirSync(path.join(s.path, 'Resources', 'Client'), { recursive: true });
      fs.mkdirSync(path.join(s.path, 'Resources', 'Server'), { recursive: true });
      writeIfMissing(path.join(s.path, 'ServerConfig.toml'), `[General]\nName = "${s.settings.hostname}"\nPort = ${s.port}\nAuthKey = "${s.settings.authkey}"\nMaxPlayers = ${s.settings.maxplayers}\nMaxCars = 1\nMap = "${s.settings.map}"\nDescription = "Serwer zarządzany przez CodeManager"\nPrivate = true\nDebug = false\nLogChat = true\nResourceFolder = "Resources"\n\n[Misc]\nImScaredOfUpdates = false\nSendErrorsShowMessage = true\nSendErrors = true\n`);
      s.version = rel.tag;
    },
    update: (s, ctx) => TYPES.beammp.install(s, ctx),
    start: s => ({ cmd: path.join(s.path, exe('BeamMP-Server.exe', 'BeamMP-Server')), args: [], cwd: s.path }),
    stopCmd: 'exit',
    configs: ['ServerConfig.toml'],
    contentLabel: () => 'Mody i pluginy', contentDir: s => path.join(s.path, 'Resources'),
  },
};

function fivemCfg(s) {
  return `# Konfiguracja wygenerowana przez CodeManager
endpoint_add_tcp "0.0.0.0:${s.port}"
endpoint_add_udp "0.0.0.0:${s.port}"

ensure mapmanager
ensure chat
ensure spawnmanager
ensure sessionmanager
ensure basic-gamemode
ensure hardcap
ensure rconlog

sv_scriptHookAllowed 0
sets tags "default"
sets locale "pl-PL"
sv_hostname "${s.settings.hostname}"
sets sv_projectName "${s.settings.hostname}"
sets sv_projectDesc "Serwer zarządzany przez CodeManager"
sv_maxclients ${s.settings.maxclients || 48}
set onesync on
set steam_webApiKey ""
sv_licenseKey "${s.settings.license || 'WKLEJ_TUTAJ_KLUCZ'}"

add_ace group.admin command allow
add_ace group.admin command.quit deny
`;
}

// ---------------- Frameworki pluginów ----------------
function patchGameinfo(serverPath, log) {
  const gi = path.join(serverPath, 'game', 'csgo', 'gameinfo.gi');
  const t = U.readText(gi);
  if (!t) { log('Nie znaleziono gameinfo.gi'); return; }
  if (/csgo\/addons\/metamod/i.test(t)) { log('gameinfo.gi zawiera już wpis Metamod.'); return; }
  const out = t.replace(/(\n(\s*)Game_LowViolence\s+csgo_lv[^\n]*\n)/i, `$1$2Game\tcsgo/addons/metamod\n`);
  if (out === t) { log('⚠ Nie udało się automatycznie dopisać Metamod do gameinfo.gi – dodaj linię "Game csgo/addons/metamod" ręcznie w sekcji SearchPaths.'); return; }
  fs.copyFileSync(gi, gi + '.bak');
  fs.writeFileSync(gi, out);
  log('Dopisano Metamod do gameinfo.gi (kopia: gameinfo.gi.bak). Uwaga: każda aktualizacja CS2 nadpisuje ten plik – CodeManager ostrzeże Cię przy sprawdzaniu.');
}

async function alliedDrop(base, kind) {
  const plat = U.isWin ? 'windows' : 'linux';
  const name = (await N.getText(`${base}/${kind}-latest-${plat}`)).trim();
  return `${base}/${name}`;
}

const FRAMEWORKS = {
  oxide: {
    name: 'Oxide (uMod)', desc: 'Najpopularniejszy framework pluginów Rust.',
    status: s => U.exists(path.join(s.path, 'RustDedicated_Data', 'Managed', 'Oxide.Rust.dll')),
    install: async (s, ctx) => {
      if (U.isDir(path.join(s.path, 'carbon'))) throw new Error('Zainstalowano Carbon – Oxide i Carbon nie mogą działać razem.');
      const rel = await N.githubLatest('OxideMod/Oxide.Rust', U.isWin ? /^Oxide\.Rust\.zip$/i : /^Oxide\.Rust-linux\.zip$/i);
      ctx.log(`Pobieranie ${rel.name} (${rel.tag})…`);
      const z = await N.download(rel.url, N.tempFile(rel.name), ctx.progress);
      N.extractZip(z, s.path, { backupDir: path.join(ctx.userData, 'backups', 'oxide-' + Date.now()) });
      fs.mkdirSync(path.join(s.path, 'oxide', 'plugins'), { recursive: true });
      ctx.log('Oxide zainstalowany. Uwaga: po każdej aktualizacji Rusta trzeba ponownie zainstalować Oxide.');
    },
  },
  carbon: {
    name: 'Carbon', desc: 'Nowoczesny, szybszy framework Rust zgodny z pluginami Oxide.',
    status: s => U.isDir(path.join(s.path, 'carbon', 'managed')),
    install: async (s, ctx) => {
      if (U.exists(path.join(s.path, 'RustDedicated_Data', 'Managed', 'Oxide.Rust.dll'))) throw new Error('Zainstalowano Oxide – najpierw go usuń (zweryfikuj pliki serwera przez Aktualizuj).');
      const asset = U.isWin ? 'Carbon.Windows.Release.zip' : 'Carbon.Linux.Release.tar.gz';
      const f = await N.download(`https://github.com/CarbonCommunity/Carbon/releases/download/production_build/${asset}`, N.tempFile(asset), ctx.progress);
      if (U.isWin) N.extractZip(f, s.path); else await N.extractTar(f, s.path);
      fs.mkdirSync(path.join(s.path, 'carbon', 'plugins'), { recursive: true });
      ctx.log('Carbon zainstalowany. Na Linuksie uruchamiaj serwer przez carbon/tools/environment.sh.');
    },
  },
  metamod2: {
    name: 'Metamod:Source 2.0', desc: 'Wymagany przez CounterStrikeSharp. Automatycznie dopisuje wpis do gameinfo.gi.',
    status: s => U.exists(path.join(s.path, 'game', 'csgo', 'addons', 'metamod.vdf')) || U.isDir(path.join(s.path, 'game', 'csgo', 'addons', 'metamod')),
    install: async (s, ctx) => {
      const url = await alliedDrop('https://mms.alliedmods.net/mmsdrop/2.0', 'mmsource');
      ctx.log('Pobieranie ' + path.basename(url));
      const f = await N.download(url, N.tempFile(path.basename(url)), ctx.progress);
      const dest = path.join(s.path, 'game', 'csgo');
      if (/\.zip$/.test(url)) N.extractZip(f, dest); else await N.extractTar(f, dest);
      patchGameinfo(s.path, ctx.log);
    },
  },
  counterstrikesharp: {
    name: 'CounterStrikeSharp', desc: 'Framework pluginów C# dla CS2 (z runtime .NET).',
    status: s => U.exists(path.join(s.path, 'game', 'csgo', 'addons', 'counterstrikesharp', 'api', 'CounterStrikeSharp.API.dll')),
    install: async (s, ctx) => {
      const rel = await N.githubLatest('roflmuffin/CounterStrikeSharp', U.isWin ? /with-runtime.*windows.*\.zip$/i : /with-runtime.*linux.*\.zip$/i);
      ctx.log(`Pobieranie ${rel.name}…`);
      const f = await N.download(rel.url, N.tempFile(rel.name), ctx.progress);
      N.extractZip(f, path.join(s.path, 'game', 'csgo'));
      ctx.log('Pamiętaj: CounterStrikeSharp wymaga Metamod:Source 2.0.');
    },
  },
  metamod112: {
    name: 'Metamod:Source 1.12', desc: 'Wymagany przez SourceMod.',
    status: s => U.isDir(path.join(s.path, 'tf', 'addons', 'metamod')),
    install: async (s, ctx) => {
      const url = await alliedDrop('https://mms.alliedmods.net/mmsdrop/1.12', 'mmsource');
      const f = await N.download(url, N.tempFile(path.basename(url)), ctx.progress);
      if (/\.zip$/.test(url)) N.extractZip(f, path.join(s.path, 'tf')); else await N.extractTar(f, path.join(s.path, 'tf'));
    },
  },
  sourcemod: {
    name: 'SourceMod 1.12', desc: 'Framework pluginów dla gier Source (TF2).',
    status: s => U.isDir(path.join(s.path, 'tf', 'addons', 'sourcemod')),
    install: async (s, ctx) => {
      const url = await alliedDrop('https://sm.alliedmods.net/smdrop/1.12', 'sourcemod');
      const f = await N.download(url, N.tempFile(path.basename(url)), ctx.progress);
      if (/\.zip$/.test(url)) N.extractZip(f, path.join(s.path, 'tf')); else await N.extractTar(f, path.join(s.path, 'tf'));
      ctx.log('Pamiętaj: SourceMod wymaga Metamod:Source 1.12.');
    },
  },
  'bepinex-valheim': {
    name: 'BepInExPack Valheim', desc: 'BepInEx przygotowany dla Valheim (z Thunderstore).',
    status: s => U.exists(path.join(s.path, 'BepInEx', 'core', 'BepInEx.dll')),
    install: async (s, ctx) => {
      const j = await N.getJSON('https://thunderstore.io/api/experimental/package/denikson/BepInExPack_Valheim/');
      const f = await N.download(j.latest.download_url, N.tempFile('BepInExPack_Valheim.zip'), ctx.progress);
      N.extractZip(f, s.path, { subdir: 'BepInExPack_Valheim' });
      fs.mkdirSync(path.join(s.path, 'BepInEx', 'plugins'), { recursive: true });
      ctx.log(`BepInExPack_Valheim ${j.latest.version_number} zainstalowany.`);
    },
  },
};

function configFiles(server) {
  const t = TYPES[server.type];
  const list = typeof t.configs === 'function' ? t.configs(server) : (t.configs || []);
  const out = [];
  for (const rel of list) {
    const full = path.join(server.path, rel);
    if (U.isDir(full)) for (const f of U.walk(full, { maxFiles: 200, maxDepth: 3 }).filter(f => /\.(json|cfg|ini|txt|yml|yaml|toml|xml|lua|properties|conf|gi)$/i.test(f))) out.push({ rel: rel + '/' + f, path: path.join(full, f), exists: true });
    else out.push({ rel, path: full, exists: U.exists(full) });
  }
  return out;
}

module.exports = { TYPES, FRAMEWORKS, configFiles, ensureSteamCmd, steamcmdUpdate, steamcmdWorkshop, mcVersions, patchGameinfo };
