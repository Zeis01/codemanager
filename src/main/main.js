// CodeManager – proces główny Electron
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage, Tray, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const U = require('./util');
const { GAMES, UNSUPPORTED, byId } = require('./games');
const detect = require('./detect');
const compat = require('./compat');
const installers = require('./installers');
const N = require('./net');
const { ServerManager } = require('./servers/manager');

let win = null;
// Tryb przenośny: jeśli obok programu jest folder CodeManager-data, wszystkie dane trafiają tam zamiast do AppData
const defaultUserData = app.getPath('userData');
const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
const PORTABLE_DIR = process.env.CM_PORTABLE_DIR || path.join(exeDir, 'CodeManager-data');
const portableActive = (app.isPackaged || !!process.env.CM_PORTABLE_DIR) && U.isDir(PORTABLE_DIR);
if (portableActive) app.setPath('userData', PORTABLE_DIR);
const userData = app.getPath('userData');
const configFile = path.join(userData, 'config.json');
let config = U.readJSON(configFile, null) || { games: {}, settings: {} };
config.games = config.games || {}; config.settings = config.settings || {};
let detected = config.lastDetect || null;

function saveConfig() { config.lastDetect = detected; U.writeJSON(configFile, config); }
function emit(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

const servers = new ServerManager({ userData, getSettings: () => config.settings, emit });

// Wątki robocze: sprawdzanie modów, wykrywanie gier i wyszukiwanie nie blokują okna
const { Pool } = require('./worker/pool');
const pool = new Pool({ size: Math.min(3, Math.max(1, require('os').cpus().length - 1)) });
const work = (op, args, fallback) => pool.run(op, args, fallback);
const detectCfg = () => ({ settings: config.settings, games: config.games });
const runDetect = () => work('detect', { config: detectCfg() }, () => detect.detectAll(config));
function checkGame(id, info, prof, settings) { return work('check', { gameId: id, info, profile: prof, settings }, () => compat.check(id, info, prof, settings)); }

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680, frame: false, backgroundColor: '#0a120d', show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('close', e => {
    if (!app.isQuitting && config.settings.tray && tray) {
      e.preventDefault(); win.hide();
      if (!config.settings.trayHintShown) { config.settings.trayHintShown = true; saveConfig(); systemNotify('CodeManager działa w tle', 'Serwery dalej działają. Program otworzysz ikoną w zasobniku systemowym.'); }
    }
  });
  win.on('maximize', () => emit('win:state', { maximized: true }));
  win.on('unmaximize', () => emit('win:state', { maximized: false }));
}

// jedna instancja – linki nxm:// trafiają do działającego okna
const gotLock = process.env.CM_SCREENSHOT_DIR ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => { const u = argv.find(a => /^nxm:\/\//i.test(a)); if (u) handleNxm(u); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('open-url', (e, u) => { e.preventDefault(); if (/^nxm:/i.test(u)) handleNxm(u); });
app.whenReady().then(() => { createWindow(); const u = process.argv.find(a => /^nxm:\/\//i.test(a)); if (u) setTimeout(() => handleNxm(u), 3000); });
app.on('window-all-closed', () => { if (config.settings.tray && tray && !app.isQuitting) return; servers.stopAll(); rcon.closeAll(); app.quit(); });
app.on('before-quit', () => { app.isQuitting = true; try { pool.close(); } catch { /* */ } servers.stopAll(); try { rcon.closeAll(); } catch { /* */ } });

// ---------- bezpieczne opakowanie handlerów ----------
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { console.error(ch, err); return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });
}

// Okno
handle('win:minimize', () => win.minimize());
handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
handle('win:close', () => win.close());
handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, userData, electron: process.versions.electron }));

// Ustawienia
handle('config:get', () => ({ settings: config.settings, games: config.games }));
handle('settings:set', s => { config.settings = { ...config.settings, ...s }; saveConfig(); return config.settings; });

// Gry
handle('games:defs', () => ({ games: GAMES.map(g => ({ ...g, epic: undefined })), unsupported: UNSUPPORTED }));
handle('games:detect', async () => { detected = await runDetect(); saveConfig(); return detected; });
handle('games:detected', async () => { if (!detected) detected = await runDetect(); return detected; });
handle('games:setPath', async (id, p) => {
  if (!U.isDir(p)) throw new Error('Folder nie istnieje');
  config.games[id] = { ...(config.games[id] || {}), path: p, manual: true }; saveConfig();
  detected = await runDetect(); saveConfig();
  return detected.games[id];
});
handle('games:resetPath', async id => { if (config.games[id]) { delete config.games[id].manual; delete config.games[id].path; } detected = await runDetect(); saveConfig(); return detected.games[id]; });
handle('games:settings', (id, s) => { config.games[id] = { ...(config.games[id] || {}), settings: { ...((config.games[id] || {}).settings || {}), ...s } }; saveConfig(); return config.games[id].settings; });
handle('mc:addInstance', async (p, name) => {
  if (!U.isDir(p)) throw new Error('Folder nie istnieje');
  const g = config.games.minecraft = config.games.minecraft || {};
  g.manualInstances = g.manualInstances || [];
  if (!g.manualInstances.find(i => i.path === p)) g.manualInstances.push({ id: 'manual-' + Date.now().toString(36), name: name || ('Ręcznie: ' + path.basename(p)), path: p, launcher: 'Ręcznie' });
  detected = await runDetect(); saveConfig(); return detected.games.minecraft;
});
handle('mc:setInstance', async (instId, patch) => {
  const g = config.games.minecraft = config.games.minecraft || {};
  g.instanceOverrides = g.instanceOverrides || {};
  g.instanceOverrides[instId] = { ...(g.instanceOverrides[instId] || {}), ...patch };
  detected = await runDetect(); saveConfig(); return detected.games.minecraft;
});
handle('mc:removeInstance', async instId => {
  const g = config.games.minecraft || {};
  g.manualInstances = (g.manualInstances || []).filter(i => i.id !== instId);
  detected = await runDetect(); saveConfig(); return detected.games.minecraft;
});

function infoFor(id) { if (!detected || !detected.games[id]) throw new Error('Najpierw uruchom wykrywanie gier'); return detected.games[id]; }
handle('mods:profiles', id => compat.profiles(id, infoFor(id)));
handle('mods:check', (id, profileId) => {
  const info = infoFor(id);
  const prof = compat.profiles(id, info).find(p => p.id === profileId);
  return checkGame(id, info, prof, { ...((config.games[id] || {}).settings || {}), __nexus: nexusRegFor(id) });
});
handle('mods:online', (id, profileId) => {
  const info = infoFor(id);
  const prof = compat.profiles(id, info).find(p => p.id === profileId);
  return compat.online(id, info, prof, (config.games[id] || {}).settings || {});
});
handle('mods:toggle', (mod, gameId) => compat.toggle(mod, { gameId, gamePath: gameId && detected && detected.games[gameId] ? detected.games[gameId].path : null }));
handle('mods:target', (id, profileId) => { const info = infoFor(id); const prof = compat.profiles(id, info).find(p => p.id === profileId); return compat.modsTarget(id, prof, info); });
handle('mods:add', (targetDir, files) => {
  fs.mkdirSync(targetDir, { recursive: true });
  const done = [];
  for (const f of files) {
    const dest = path.join(targetDir, path.basename(f));
    if (U.isDir(f)) U.copyRecursive(f, dest); else fs.copyFileSync(f, dest);
    done.push(dest);
  }
  return done;
});
handle('mods:remove', async (p, gameId, label) => { if (config.settings.programTrash === false) { await shell.trashItem(p); return { system: true }; } return trash.put(p, { gameId: gameId || null, label }); });

// Instalatory
handle('loaders:list', () => installers.LOADERS);
handle('loaders:status', (id, root) => installers.status(id, root));
handle('loaders:install', async (jobId, id, opts) => {
  const log = l => emit('job:log', { jobId, line: l });
  const progress = p => emit('job:progress', { jobId, ...p });
  let java = opts.java;
  if (['fabric', 'quilt', 'forge', 'neoforge'].includes(id) && !java) {
    const need = require('./compat/minecraft').requiredJava(opts.mcVersion) || 17;
    const pick = await N.pickJava(need, config.settings.javaPath);
    if (!pick.java) throw new Error(`Instalator wymaga Javy ${need}+. Zainstaluj ją (adoptium.net) lub wskaż w Ustawieniach.`);
    java = pick.java.path; log(`Java: ${pick.java.raw} (${java})`);
  }
  const r = await installers.install(id, { ...opts, java, userData }, log, progress);
  if (detected) { detected = await runDetect(); saveConfig(); }
  return r;
});
handle('java:list', () => N.findJavas(config.settings.javaPath));
handle('mc:versions', async () => require('./servers/defs').mcVersions());

// Serwery
handle('servers:list', () => servers.list());
handle('servers:types', () => servers.types());
handle('servers:versions', t => servers.versions(t));
handle('servers:create', d => servers.create(d));
handle('servers:import', d => servers.importExisting(d));
handle('servers:install', id => servers.install(id));
handle('servers:update', id => servers.update(id));
handle('servers:patch', (id, p) => servers.update2(id, p));
handle('servers:remove', async (id, del) => { const r = servers.remove(id, del); if (del && U.isDir(r.path)) await shell.trashItem(r.path); return true; });
handle('servers:start', id => servers.start(id));
handle('servers:stop', id => servers.stop(id));
handle('servers:kill', id => servers.kill(id));
handle('servers:command', (id, c) => servers.command(id, c));
handle('servers:log', id => servers.getLog(id));
handle('servers:configs', id => servers.configs(id));
handle('servers:content', id => servers.contentDir(id));
handle('servers:frameworks', id => servers.frameworks(id));
handle('servers:installFramework', (id, fw) => servers.installFramework(id, fw));
handle('servers:check', id => work('serverCheck', { server: servers.get(id) }, () => servers.check(id)));
handle('servers:online', id => servers.online(id));
handle('servers:workshop', (id, item) => servers.workshopAdd(id, item));
handle('servers:toggle', mod => compat.toggle(mod));

// System plików (edytor)
handle('fs:readDir', dir => U.listDir(dir).map(d => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() }))
  .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' })));
handle('fs:readFile', p => {
  const st = fs.statSync(p);
  if (st.size > 15 * 1024 * 1024) throw new Error('Plik jest za duży do edycji (>15 MB)');
  const buf = fs.readFileSync(p);
  const sample = buf.subarray(0, 8000);
  if (sample.includes(0)) throw new Error('To jest plik binarny – nie można go edytować jako tekst.');
  let t = buf.toString('utf8'); const bom = t.charCodeAt(0) === 0xfeff; if (bom) t = t.slice(1);
  return { content: t, bom, eol: t.includes('\r\n') ? 'CRLF' : 'LF', size: st.size, mtime: st.mtimeMs };
});
handle('fs:writeFile', (p, content, bom) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, (bom ? '﻿' : '') + content, 'utf8'); return fs.statSync(p).mtimeMs; });
handle('fs:mkdir', p => { fs.mkdirSync(p, { recursive: true }); return true; });
handle('fs:rename', (a, b) => { fs.renameSync(a, b); return b; });
handle('fs:trash', async p => { await shell.trashItem(p); return true; });
handle('fs:exists', p => U.exists(p));
handle('fs:search', (root, q) => work('search', { root, q }));
handle('fs:grep', (root, q) => work('grep', { root, q }));

// Okna dialogowe / powłoka
handle('dialog:folder', async (title, def) => { const r = await dialog.showOpenDialog(win, { title: title || 'Wybierz folder', defaultPath: def, properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
handle('dialog:files', async (title, filters) => { const r = await dialog.showOpenDialog(win, { title: title || 'Wybierz pliki', properties: ['openFile', 'multiSelections'], filters }); return r.canceled ? [] : r.filePaths; });
handle('dialog:saveAs', async (def) => { const r = await dialog.showSaveDialog(win, { defaultPath: def }); return r.canceled ? null : r.filePath; });
handle('shell:open', p => shell.openPath(p));
handle('shell:show', p => shell.showItemInFolder(p));
handle('shell:external', u => { if (/^(https?|steam):\/\//i.test(u)) return shell.openExternal(u); throw new Error('Niedozwolony adres'); });

// Tryb zrzutów ekranu (do testów): CM_SCREENSHOT_DIR=folder
if (process.env.CM_SCREENSHOT_DIR) {
  app.whenReady().then(() => setTimeout(async () => {
    const out = process.env.CM_SCREENSHOT_DIR; fs.mkdirSync(out, { recursive: true });
    win.webContents.on('console-message', (_e, level, message, line, source) => { if (level >= 2) console.log(`[renderer] ${message} (${path.basename(source || '')}:${line})`); });
    const steps = JSON.parse(process.env.CM_STEPS || '[]');
    for (const [name, js, wait] of steps) {
      try { await win.webContents.executeJavaScript(js); } catch (e) { console.error(name, e.message); }
      await new Promise(r => setTimeout(r, wait || 1500));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    }
    app.quit();
  }, 2500));
}

// =====================================================================
// Wersja 1.1: API serwisów, analizator, profile, harmonogram, RCON, importy
// =====================================================================
const modrinth = require('./online/modrinth');
const thunder = require('./online/thunderstore');
const nexus = require('./online/nexus');
const { installArchive, Registry } = require('./online/archive');
const analyzer = require('./analyzer');
const { Profiles } = require('./profiles');
const { RconManager } = require('./rcon');
const { Scheduler } = require('./servers/scheduler');
const { TYPES: STYPES } = require('./servers/defs2');
const G2 = require('./compat/games2');

const rcon = new RconManager();
const profiles = new Profiles(path.join(userData, 'mod-profiles.json'));
const nexusReg = new Registry(path.join(userData, 'nexus-installs.json'));
const scheduler = new Scheduler(servers, userData);
const backupRoot = path.join(userData, 'backups', 'mod-updates');

// klucz Nexus przechowywany zaszyfrowany (safeStorage)
function loadNexusKey() {
  const enc = config.settings.nexusKeyEnc;
  if (!enc) return null;
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : Buffer.from(enc, 'base64').toString('utf8'); } catch { return null; }
}
function saveNexusKey(k) {
  if (!k) { delete config.settings.nexusKeyEnc; delete config.settings.nexusUser; saveConfig(); nexus.setKey(null); return; }
  config.settings.nexusKeyEnc = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.from(k, 'utf8')).toString('base64');
  saveConfig(); nexus.setKey(k);
}
app.whenReady().then(() => nexus.setKey(loadNexusKey()));

const jobLog = jobId => l => emit('job:log', { jobId, line: l });
const jobProg = jobId => p => emit('job:progress', { jobId, ...p });
const gameDef = id => byId(id);
function profileCtx(gameId, profileId) {
  const info = infoFor(gameId);
  const prof = compat.profiles(gameId, info).find(p => p.id === profileId) || compat.profiles(gameId, info)[0];
  const gs = (config.games[gameId] || {}).settings || {};
  return { info, prof, root: prof ? prof.root : info.path, modsDir: compat.modsTarget(gameId, prof, info), mcVersion: gs.mcVersion || (prof && prof.mcVersion), loader: gs.loader || (prof && prof.loader) };
}
function serverCtx(serverId) {
  const s = servers.get(serverId);
  const plugin = s.type === 'minecraft' && ['paper', 'purpur'].includes(s.variant);
  if (s.type === 'minecraft') return { s, modsDir: path.join(s.path, plugin ? 'plugins' : 'mods'), mcVersion: s.version, loader: s.variant, type: plugin ? 'plugin' : 'mod' };
  if (s.type === 'mcproxy') return { s, modsDir: path.join(s.path, 'plugins'), loader: s.variant, type: 'plugin' };
  return { s, root: s.path };
}

// ---------- Modrinth ----------
handle('modrinth:search', (q, opts) => modrinth.search(q, opts));
handle('modrinth:versions', (id, opts) => modrinth.versions(id, opts));
handle('modrinth:install', async (jobId, target, projectId, versionId) => {
  const ctx = target.serverId ? serverCtx(target.serverId) : profileCtx(target.gameId, target.profileId);
  if (target.gameId) await autoSnapshot(target.gameId, target.profileId, 'przed instalacją moda');
  const res = await modrinth.install(projectId, { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log: jobLog(jobId), progress: jobProg(jobId), backupRoot }, { versionId });
  return res;
});

// ---------- aktualizacja jednym przyciskiem ----------
async function lockedFiles(gameId, profileId) {
  const keys = new Set(notes.locked(gameId)); if (!keys.size) return [];
  try { return (await gameReport(gameId, profileId)).mods.filter(m => m.file && keys.has(normKey(m))).map(m => m.file); } catch { return []; }
}
async function updRun(jobId, target) {
  const log = jobLog(jobId), progress = jobProg(jobId);
  if (target.gameId && !target.__noSnap) await autoSnapshot(target.gameId, target.profileId, 'przed aktualizacją modów');
  const skipFiles = target.gameId ? await lockedFiles(target.gameId, target.profileId) : [];
  if (skipFiles.length) log(`Pomijam zablokowane mody: ${skipFiles.map(f => path.basename(f)).join(', ')}`);
  if (target.serverId) {
    const ctx = serverCtx(target.serverId);
    if (ctx.modsDir) return { kind: 'modrinth', ...(await modrinth.updateAll({ modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, progress, backupRoot })) };
    if (ctx.s.type === 'valheim') return { kind: 'thunderstore', ...(await thunder.updateAll({ root: ctx.root, log, progress, backupRoot })) };
    throw new Error('Automatyczna aktualizacja nie jest dostępna dla tego serwera.');
  }
  const g = gameDef(target.gameId); const ctx = profileCtx(target.gameId, target.profileId);
  if (g.checker === 'minecraft') return { kind: 'modrinth', ...(await modrinth.updateAll({ modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, progress, backupRoot, skipFiles })) };
  if (g.checker === 'bepinex') return { kind: 'thunderstore', ...(await thunder.updateAll({ root: ctx.root, log, progress, backupRoot, skipFiles })) };
  if (g.checker === 'factorio') { const gi = U.readJSON(path.join(ctx.info.path, 'data', 'base', 'info.json'), {}); return { kind: 'list', items: await G2.factorioUpdates(ctx.info.path, gi.version, { download: true, log, progress }) }; }
  if (nexus.DOMAINS[g.id]) return { kind: 'list', items: await nexusUpdates(g.id, ctx, log, skipFiles) };
  throw new Error('Ta gra nie ma serwisu z aktualizacjami modów.');
}
handle('updates:run', updRun);
handle('updates:available', id => { const g = gameDef(id); return { modrinth: g.checker === 'minecraft', thunderstore: g.checker === 'bepinex', factorio: g.checker === 'factorio', nexus: !!nexus.DOMAINS[id] }; });

// ---------- Thunderstore ----------
handle('thunderstore:install', (jobId, target, input) => {
  const root = target.serverId ? servers.get(target.serverId).path : profileCtx(target.gameId, target.profileId).root;
  return thunder.install(input, { root, log: jobLog(jobId), progress: jobProg(jobId), backupRoot });
});
handle('thunderstore:info', input => { const p = thunder.parseInput(input); return thunder.info(p.ns, p.name); });

// ---------- Nexus Mods ----------
handle('nexus:setKey', async key => {
  if (!key) { saveNexusKey(null); return null; }
  nexus.setKey(key.trim());
  const u = await nexus.validate();
  saveNexusKey(key.trim());
  config.settings.nexusUser = { name: u.name, premium: !!u.is_premium, supporter: !!u.is_supporter, avatar: u.profile_url }; saveConfig();
  return config.settings.nexusUser;
});
handle('nexus:status', () => ({ connected: !!loadNexusKey(), user: config.settings.nexusUser || null, limits: nexus.limits(), nxmRegistered: app.isDefaultProtocolClient('nxm') }));
handle('nexus:registerNxm', () => { const ok = process.defaultApp ? app.setAsDefaultProtocolClient('nxm', process.execPath, [path.resolve(process.argv[1])]) : app.setAsDefaultProtocolClient('nxm'); return ok; });
handle('nexus:domain', id => nexus.DOMAINS[id] || null);
handle('nexus:search', (gameId, text) => nexus.search(nexus.DOMAINS[gameId], text));
handle('nexus:files', async (gameId, modId) => { const f = await nexus.files(nexus.DOMAINS[gameId], modId); return f.filter(x => x.category_name !== 'ARCHIVED').sort((a, b) => b.uploaded_timestamp - a.uploaded_timestamp); });
handle('nexus:install', async (jobId, gameId, profileId, modId, fileId) => {
  const user = config.settings.nexusUser || {};
  const domain = nexus.DOMAINS[gameId];
  if (!user.premium) return { needsBrowser: true, url: `https://www.nexusmods.com/${domain}/mods/${modId}?tab=files&file_id=${fileId}&nmm=1` };
  await autoSnapshot(gameId, profileId, 'przed instalacją moda');
  return nexusInstall({ domain, gameId, profileId, modId, fileId }, jobLog(jobId), jobProg(jobId));
});
async function nexusInstall({ domain, gameId, profileId, modId, fileId, nxm }, log, progress) {
  const g = Object.keys(nexus.DOMAINS).find(k => nexus.DOMAINS[k] === domain) || gameId;
  if (!g) throw new Error('CodeManager nie obsługuje gry ' + domain);
  const ctx = profileCtx(g, profileId);
  log(`Pobieranie z Nexus Mods (mod ${modId}, plik ${fileId})…`);
  const dl = await nexus.downloadArchive(domain, modId, fileId, nxm, progress);
  log(`Instalacja ${dl.name}…`);
  const paths = await installArchive(dl.archive, { game: gameDef(g), target: ctx.modsDir, gameRoot: ctx.info.path, log });
  fs.rmSync(dl.archive, { force: true });
  const info = await nexus.modInfo(domain, modId).catch(() => null);
  nexusReg.add({ gameId: g, domain, modId: +modId, fileId: +fileId, version: (dl.file && dl.file.version) || (info && info.version), name: (info && info.name) || dl.name, paths, files: paths.files || [] });
  log(`✔ Zainstalowano ${(info && info.name) || dl.name} (${paths.length} elementów)`);
  return { name: (info && info.name) || dl.name, paths };
}
async function handleNxm(url) {
  const jobId = 'nxm' + Date.now();
  emit('nxm:start', { jobId, url });
  try {
    const p = nexus.parseNxm(url);
    const r = await nexusInstall({ ...p, nxm: p }, jobLog(jobId), jobProg(jobId));
    emit('nxm:done', { jobId, ok: true, name: r.name });
  } catch (e) { emit('job:log', { jobId, line: '✖ ' + e.message }); emit('nxm:done', { jobId, ok: false, error: e.message }); }
}
async function nexusUpdates(gameId, ctx, log, skipFiles = []) {
  const domain = nexus.DOMAINS[gameId];
  const out = [];
  const skip = new Set(skipFiles.map(f => path.resolve(f).toLowerCase()));
  const entries = nexusReg.forGame(gameId).filter(e => !e.local && !(e.paths || []).some(p => skip.has(path.resolve(p).toLowerCase()))).map(e => ({ modId: e.modId, version: e.version, name: e.name, src: 'CodeManager' }));
  if (gameId === 'stardew') {
    for (const x of G2.readManifests(path.join(ctx.info.path, 'Mods'))) {
      const k = ((x.man || {}).UpdateKeys || []).map(u => String(u).match(/^Nexus:(\d+)/i)).find(Boolean);
      if (k && !entries.find(e => e.modId === +k[1])) entries.push({ modId: +k[1], version: x.man.Version, name: x.man.Name, src: 'manifest' });
    }
  }
  if (!entries.length) return [{ level: 'info', title: 'Brak modów powiązanych z Nexus Mods. Mody instalowane przez CodeManager (lub z UpdateKeys w SMAPI) będą tu sprawdzane.' }];
  for (const e of entries) {
    try {
      const m = await nexus.modInfo(domain, e.modId);
      if (!m) continue;
      if (m.version && e.version && U.cmpVer(String(m.version).replace(/^v/i, ''), String(e.version).replace(/^v/i, '')) > 0) out.push({ level: 'info', title: `${e.name}: dostępna wersja ${m.version} (masz ${e.version})`, url: `https://www.nexusmods.com/${domain}/mods/${e.modId}?tab=files`, nexus: { modId: e.modId } });
    } catch (err) { log && log('✖ ' + err.message); if (/klucz|limit/i.test(err.message)) { out.push({ level: 'warn', title: err.message }); break; } }
  }
  if (!out.length) out.push({ level: 'ok', title: `Wszystkie mody z Nexus (${entries.length}) są aktualne` });
  return out;
}
handle('nexus:updates', gameId => nexusUpdates(gameId, profileCtx(gameId)));
handle('nexus:installLocal', async (gameId, profileId, files) => {
  const ctx = profileCtx(gameId, profileId); const out = [];
  await autoSnapshot(gameId, profileId, 'przed instalacją moda');
  for (const f of files) {
    const paths = await installArchive(f, { game: gameDef(gameId), target: ctx.modsDir, gameRoot: ctx.info.path });
    out.push(...paths);
    // lokalne archiwa też trafiają do rejestru – potrzebne do wykrywania konfliktów plików
    nexusReg.add({ gameId, modId: 'local:' + path.basename(f).toLowerCase(), local: true, name: path.basename(f).replace(/\.(zip|7z|rar)$/i, ''), paths, files: paths.files || [] });
  }
  return out;
});

// ---------- importy ----------
handle('import:mrpack', async (jobId, file, targetDir, opts = {}) => {
  const pack = modrinth.readMrpack(file);
  const dir = targetDir || path.join(config.settings.instancesPath || path.join(U.home(), 'CodeManager-Instances'), U.safeName(pack.name));
  const r = await modrinth.importMrpack(file, dir, { side: 'client', log: jobLog(jobId), progress: jobProg(jobId) });
  const g = config.games.minecraft = config.games.minecraft || {};
  g.manualInstances = (g.manualInstances || []).filter(i => i.path !== dir);
  const inst = { id: 'manual-' + Date.now().toString(36), name: `Paczka: ${pack.name}`, path: dir, launcher: 'Ręcznie', mcVersion: r.mcVersion, loader: r.loader, loaderVersion: r.loaderVersion };
  g.manualInstances.push(inst);
  detected = await runDetect(); saveConfig();
  if (opts.installLoader && r.loader !== 'vanilla') {
    jobLog(jobId)(`Instalacja loadera ${r.loader} ${r.mcVersion}…`);
    const need = require('./compat/minecraft').requiredJava(r.mcVersion);
    const pick = await N.pickJava(need, config.settings.javaPath);
    if (pick.java) await installers.install(r.loader, { root: dir, mcVersion: r.mcVersion, java: pick.java.path, userData }, jobLog(jobId), jobProg(jobId)).catch(e => jobLog(jobId)('⚠ ' + e.message));
    else jobLog(jobId)(`⚠ Brak Javy ${need}+ – loader zainstaluj później w zakładce Modloader.`);
  }
  return { ...r, dir, instanceId: inst.id };
});
handle('import:mrpackInfo', file => { const p = modrinth.readMrpack(file); return { name: p.name, version: p.version, mcVersion: p.mcVersion, loader: p.loader, loaderVersion: p.loaderVersion, files: p.files.length }; });
handle('import:mrpackServer', async (jobId, serverId, file) => {
  const s = servers.get(serverId);
  return modrinth.importMrpack(file, s.path, { side: 'server', log: jobLog(jobId), progress: jobProg(jobId) });
});
handle('import:r2', async (jobId, target, source) => {
  const root = target.serverId ? servers.get(target.serverId).path : profileCtx(target.gameId, target.profileId).root;
  return thunder.importR2(source, { root, log: jobLog(jobId), progress: jobProg(jobId), backupRoot });
});

// ---------- naprawy jednym kliknięciem ----------
function nexusRegFor(id) { try { return nexusReg.forGame(id); } catch { return []; } }
handle('fix:run', async (jobId, action, target) => {
  const log = jobLog(jobId), progress = jobProg(jobId);
  if (target && target.gameId && action.type !== 'open') await autoSnapshot(target.gameId, target.profileId, 'przed naprawą');
  switch (action.type) {
    case 'modrinth-dep': {
      const ctx = target.serverId ? serverCtx(target.serverId) : profileCtx(target.gameId, target.profileId);
      log(`Szukam „${action.modId}” na Modrinth…`);
      const id = await modrinth.findByModId(action.modId, { mcVersion: ctx.mcVersion, loader: ctx.loader, type: ctx.type === 'plugin' || action.plugin ? 'plugin' : 'mod' });
      if (!id) throw new Error(`Nie znaleziono „${action.modId}” na Modrinth – poszukaj go ręcznie (np. na CurseForge).`);
      return modrinth.install(id, { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, progress, backupRoot });
    }
    case 'modrinth-replace': {
      const ctx = target.serverId ? serverCtx(target.serverId) : profileCtx(target.gameId, target.profileId);
      return modrinth.replaceFile(action.file, { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, progress, backupRoot });
    }
    case 'thunderstore': {
      const root = target.serverId ? servers.get(target.serverId).path : profileCtx(target.gameId, target.profileId).root;
      return thunder.install(action.full, { root, log, progress, backupRoot, forcePack: /BepInExPack/i.test(action.full) });
    }
    case 'disable': for (const f of action.files) { if (U.exists(f)) fs.renameSync(f, f + '.disabled'); log('Wyłączono ' + path.basename(f)); } return true;
    case 'copy': fs.mkdirSync(path.dirname(action.to), { recursive: true }); fs.copyFileSync(action.from, action.to); log('Skopiowano ' + path.basename(action.to)); return true;
    case 'enable-key': {
      const info = infoFor(target.gameId);
      if (action.toggle === 'rimworld') G2.rimToggle(action.id, true);
      if (action.toggle === 'factorio') G2.factorioToggle(info.path, action.id, true);
      if (action.toggle === 'plugins-txt') G2.pluginsTxtToggle(target.gameId, action.id, true);
      log('Włączono ' + action.id); return true;
    }
    case 'loader': return installers.install(action.id, { root: profileCtx(target.gameId, target.profileId).root, userData }, log, progress);
    case 'framework': return servers.installFramework(target.serverId, action.id);
    case 'patch-gameinfo': require('./servers/defs').patchGameinfo(servers.get(target.serverId).path, log); return true;
    case 'open': await shell.openExternal(action.url); return true;
    case 'patch-fsgame': require('./compat/games3').patchFsgame(action.file); log('Poprawiono fsgame.ltx (kopia: fsgame.ltx.bak)'); return true;
  }
  throw new Error('Nieznana naprawa: ' + action.type);
});

// ---------- analizator ----------
function docsList() { return U.documentsCandidates(); }
handle('analyzer:candidates', (gameId, profileId) => {
  const ctx = profileCtx(gameId, profileId);
  return analyzer.logCandidates({ gameId, root: gameId === 'minecraft' ? ctx.root : ctx.info.path, docs: docsList(), appData: U.appData(), localLow: path.join(U.home(), 'AppData', 'LocalLow') });
});
handle('analyzer:serverCandidates', id => {
  const s = servers.get(id); const c = [{ label: 'Konsola (bieżąca sesja)', path: 'console:' + id, mtime: Date.now() }];
  const add = (label, f) => { if (U.isFile(f)) c.push({ label, path: f, mtime: fs.statSync(f).mtimeMs, size: fs.statSync(f).size }); };
  const newest = (dir, re) => U.listFiles(dir).filter(f => !re || re.test(path.basename(f))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  add('Log serwera', path.join(s.path, 'logs', 'latest.log'));
  newest(path.join(s.path, 'crash-reports'), /\.txt$/).slice(0, 2).forEach(f => add('Raport awarii', f));
  add('Log serwera', path.join(s.path, 'logs', 'server.log'));
  newest(path.join(s.path, 'oxide', 'logs')).slice(0, 2).forEach(f => add('Log Oxide', f));
  newest(path.join(s.path, 'carbon', 'logs')).slice(0, 2).forEach(f => add('Log Carbon', f));
  newest(path.join(s.path, 'tf', 'addons', 'sourcemod', 'logs'), /^errors_/).slice(0, 2).forEach(f => add('Błędy SourceMod', f));
  newest(path.join(s.path, 'game', 'csgo', 'addons', 'counterstrikesharp', 'logs')).slice(0, 2).forEach(f => add('Log CounterStrikeSharp', f));
  newest(path.join(s.path, 'profiles'), /\.(RPT|ADM|log)$/i).slice(0, 2).forEach(f => add('Log DayZ', f));
  newest(path.join(s.path, 'profile', 'logs')).slice(0, 1).forEach(d => add('Log Reforger', d));
  add('Log BepInEx', path.join(s.path, 'BepInEx', 'LogOutput.log'));
  newest(path.join(s.path, 'tshock', 'logs')).slice(0, 1).forEach(f => add('Log TShock', f));
  add('Konsola PZ', path.join(s.path, 'Zomboid', 'server-console.txt'));
  add('Log FiveM', path.join(s.path, 'server-data', 'server.log'));
  add('Log MTA', path.join(s.path, 'mods', 'deathmatch', 'logs', 'server.log'));
  add('Log BeamMP', path.join(s.path, 'Server.log'));
  return c;
});
handle('analyzer:analyze', async (file, ctx = {}) => {
  let text;
  if (String(file).startsWith('console:')) text = servers.getLog(file.slice(8)).join('\n');
  else text = analyzer.readTail(file);
  let modsDir = null;
  if (ctx.gameId === 'minecraft') modsDir = profileCtx('minecraft', ctx.profileId).modsDir;
  if (ctx.serverId) { const s = servers.get(ctx.serverId); if (s.type === 'minecraft') modsDir = path.join(s.path, ['paper', 'purpur'].includes(s.variant) ? 'plugins' : 'mods'); }
  const pkgIndex = modsDir ? await work('pkgIndex', { modsDir }, () => analyzer.buildPackageIndex(modsDir)) : [];
  const r = analyzer.analyzeText(text, { pkgIndex });
  return { ...r, headline: analyzer.headline(r.findings), file, size: text.length };
});
handle('analyzer:text', text => { const r = analyzer.analyzeText(text); return { ...r, headline: analyzer.headline(r.findings) }; });
handle('analyzer:summary', rep => analyzer.summarizeReport(rep));

// ---------- profile modów ----------
handle('profiles:list', (gameId, scope) => profiles.list(gameId, scope));
handle('profiles:create', (gameId, scope, name, mods) => profiles.create(gameId, scope, name, mods));
handle('profiles:update', (gameId, scope, id, mods) => profiles.update(gameId, scope, id, mods));
handle('profiles:rename', (gameId, scope, id, name) => profiles.rename(gameId, scope, id, name));
handle('profiles:remove', (gameId, scope, id) => profiles.remove(gameId, scope, id));
handle('profiles:apply', async (gameId, scope, id, mods) => {
  if (!gameId.startsWith('srv:')) await autoSnapshot(gameId, scope === 'game' ? null : scope, 'przed zmianą profilu');
  // kolekcja z tagu: zestaw liczony od nowa z bieżących tagów
  const tp = profiles.list(gameId, scope).profiles.find(x => x.id === id);
  if (tp && tp.tag) { const keys = new Set(notes.withTag(gameId, tp.tag)); profiles.update(gameId, scope, id, mods.map(m => ({ ...m, enabled: m.toggleable && keys.has(normKey(m)) }))); }
  const plan = profiles.plan(gameId, scope, id, mods);
  const ctx = { gameId, gamePath: gameId.startsWith('srv:') ? null : (detected && detected.games[gameId] ? detected.games[gameId].path : null) };
  let n = 0; const errors = [];
  for (const m of plan.changes) { try { compat.toggle(m, ctx); n++; } catch (e) { errors.push(`${m.name}: ${e.message}`); } }
  profiles.setActive(gameId, scope, id);
  return { changed: n, missing: plan.missing, errors, name: plan.profile.name };
});

// ---------- RCON ----------
handle('rcon:connect', (id, opts) => rcon.connect(id, opts));
handle('rcon:exec', (id, cmd) => rcon.exec(id, cmd));
handle('rcon:disconnect', id => rcon.disconnect(id));
handle('rcon:saved', () => config.rconConnections || []);
handle('rcon:save', c => { config.rconConnections = (config.rconConnections || []).filter(x => x.id !== c.id); config.rconConnections.push(c); saveConfig(); return config.rconConnections; });
handle('rcon:remove', id => { config.rconConnections = (config.rconConnections || []).filter(x => x.id !== id); saveConfig(); return config.rconConnections; });
handle('servers:rconInfo', id => { const i = servers.rconInfo(id); const t = STYPES[servers.get(id).type]; return { info: i, hint: t.rconHint || null }; });

// ---------- kopie zapasowe / harmonogram ----------
handle('backup:list', id => scheduler.list(id));
handle('backup:run', id => scheduler.backup(id));
handle('backup:restore', (id, file) => scheduler.restore(id, file));
handle('backup:delete', async file => { await shell.trashItem(file); fs.rmSync(file + '.map.json', { force: true }); return true; });
handle('backup:dir', id => scheduler.dir(servers.get(id)));
handle('backup:worlds', id => require('./servers/defs2').worldPaths(servers.get(id)));
handle('schedule:next', id => scheduler.nextRestart(servers.get(id)));

// =====================================================================
// Aktualizacje z GitHub
// =====================================================================
const { Updater } = require('./updater');
const UPDATE_REPO = 'Zeis01/codemanager';
const updater = new Updater({ app, getSettings: () => config.settings, emit, repo: UPDATE_REPO });
app.whenReady().then(() => { if (!process.env.CM_SCREENSHOT_DIR) updater.schedule(); });
const updateConfig = () => ({ ...updater.status(), auto: config.settings.autoUpdate !== false });
handle('update:status', () => updater.status());
handle('update:check', () => updater.check(false));
handle('update:download', () => updater.download());
handle('update:install', () => updater.install());
handle('update:skip', v => { config.settings.skipVersion = v; saveConfig(); return updater.set({ state: 'none', skipped: true }); });
handle('update:configure', o => {
  if (o.auto !== undefined) config.settings.autoUpdate = !!o.auto;
  delete config.settings.skipVersion;
  saveConfig(); updater.schedule();
  return updateConfig();
});
handle('update:config', updateConfig);

// =====================================================================
// Motywy
// =====================================================================
const { ThemeStore } = require('./themes');
const themeStore = new ThemeStore(userData, emit);
handle('themes:list', () => ({ dir: themeStore.dir, files: themeStore.list(), selected: config.settings.theme || 'builtin:classic' }));
handle('themes:select', id => { config.settings.theme = id; saveConfig(); return id; });
handle('themes:import', src => themeStore.import(src));
handle('themes:save', (name, theme) => themeStore.save(name, theme));
handle('themes:folder', () => shell.openPath(themeStore.dir));

// =====================================================================
// Ikony gier
// =====================================================================
const { Icons } = require('./icons');
let steamRootsCache = [];
const icons = new Icons({ app, userData, getSteamRoots: () => steamRootsCache });
handle('icons:all', async () => {
  try { steamRootsCache = await work('steamRoots', { steamPath: config.settings.steamPath }); } catch { steamRootsCache = []; }
  const online = config.settings.onlineIcons !== false;
  const games = {};
  for (const g of GAMES) {
    try { games[g.id] = await icons.forGame(g, detected && detected.games[g.id], { online }); } catch { games[g.id] = {}; }
  }
  const servers = {};
  for (const t of Object.keys(STYPES)) { try { servers[t] = await icons.forServerType(t, games, { online }); } catch { servers[t] = {}; } }
  return { games, servers };
});

// =====================================================================
// Wersja 1.5: konflikty, kolejność, migawki, udostępnianie, kosz, notatki,
// bisekcja, synchronizacja, monitor, powiadomienia, porty, szablony, gry
// =====================================================================
const conflicts = require('./mods/conflicts');
const loadorder = require('./mods/loadorder');
const { Snapshots } = require('./mods/snapshots');
const share = require('./mods/share');
const dupes = require('./mods/dupes');
const { Notes, Trash, normKey } = require('./mods/store');
const bisect = require('./mods/bisect');
const sync = require('./servers/sync');
const { Monitor, ACTIONS: PLAYER_ACTIONS, ACTION_LABELS, isChat } = require('./servers/monitor');
const configform = require('./servers/configform');
const { Notifier } = require('./notify');
const ports = require('./servers/ports');
const templates = require('./servers/templates');
const launch = require('./games/launch');
const saves = require('./games/saves');
const reportTxt = require('./report');

const dirSize = paths => work('dirSize', { paths });
const snapshots = new Snapshots(path.join(userData, 'snapshots'), { sizeFn: dirSize });
const saveBackups = new Snapshots(path.join(userData, 'backups', 'saves'), { sizeFn: dirSize });
const notes = new Notes(path.join(userData, 'mod-notes.json'));
const trash = new Trash(path.join(userData, 'trash'), 30);
const bisects = new bisect.BisectStore(path.join(userData, 'bisect.json'));
const upnp = new ports.Upnp();
app.whenReady().then(() => { try { trash.purge(); } catch { /* */ } });

// ---------- powiadomienia systemowe i Discord ----------
function systemNotify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'), silent: false });
  n.on('click', () => { if (win) { win.show(); win.focus(); } });
  n.show();
}
const notifier = new Notifier({ getSettings: () => config.settings, system: systemNotify });
handle('notify:test', url => notifier.test(url));
handle('notify:testSystem', () => { systemNotify('CodeManager', 'Powiadomienia systemowe działają.'); return true; });

// ---------- monitor serwerów (CPU, RAM, gracze, Chunky) ----------
const monitor = new Monitor({ mgr: servers, emit });
monitor.start();
servers.onLine = (id, line) => {
  const s = servers.servers.find(x => x.id === id); if (!s) return;
  for (const e of monitor.onLine(id, s.type, line)) {
    if (e.kind === 'join' || e.kind === 'leave') notifier.event(e.kind, { ...s, typeName: (STYPES[s.type] || {}).name }, { player: e.name, count: monitor.count(id) });
  }
};
servers.onEvent = (kind, s, data) => {
  if (kind !== 'start') monitor.reset(s.id);
  notifier.event(kind, { ...s, typeName: (STYPES[s.type] || {}).name }, data);
  updateTray();
};
scheduler.onBackup = (s, r) => notifier.event(r.error ? 'backup-failed' : 'backup', { ...s, typeName: (STYPES[s.type] || {}).name }, r.error ? { error: r.error } : { size: r.size });
handle('servers:stats', id => ({ history: monitor.history(id), ...monitor.players(id) }));
handle('servers:players', id => ({ ...monitor.players(id), actions: Object.keys(PLAYER_ACTIONS[servers.get(id).type] || {}).filter(k => k !== 'list'), labels: ACTION_LABELS, chatSupported: !!require('./servers/monitor').PATTERNS[servers.get(id).type] }));
handle('servers:playerAction', (id, action, name) => {
  const s = servers.get(id); const a = (PLAYER_ACTIONS[s.type] || {})[action];
  if (!a) throw new Error('Ta akcja nie jest dostępna dla tego serwera.');
  const cmd = typeof a === 'function' ? a(String(name).trim()) : a;
  if (!String(name || '').trim() && action !== 'list') throw new Error('Podaj nazwę gracza.');
  servers.command(id, cmd);
  if (action === 'kick' || action === 'ban') setTimeout(() => { const st = monitor.st(id); if (st.players.delete(String(name).trim())) emit('server:players', { id, players: [...st.players], count: monitor.count(id) }); }, 1500);
  return cmd;
});
handle('servers:refreshPlayers', id => { const s = servers.get(id); const a = (PLAYER_ACTIONS[s.type] || {}).list; if (a && servers.procs.has(id)) servers.command(id, a); return true; });
handle('servers:isChat', (type, line) => isChat(type, line));

// ---------- Chunky: pre-generowanie mapy ----------
handle('chunky:status', id => {
  const s = servers.get(id);
  const dir = path.join(s.path, ['paper', 'purpur'].includes(s.variant) ? 'plugins' : 'mods');
  const installed = U.listFiles(dir).some(f => /chunky/i.test(path.basename(f)) && /\.jar$/i.test(f));
  return { supported: s.type === 'minecraft' && s.variant !== 'vanilla', installed, running: servers.procs.has(id), progress: monitor.players(id).chunky };
});
handle('chunky:install', async (jobId, id) => {
  const s = servers.get(id); const ctx = serverCtx(id);
  return modrinth.install('chunky', { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log: jobLog(jobId), progress: jobProg(jobId), backupRoot });
});
handle('chunky:start', (id, { world, radius, shape, center }) => {
  const r = Math.round(+radius); if (!(r >= 100 && r <= 100000)) throw new Error('Promień musi być od 100 do 100 000 bloków.');
  const w = String(world || 'world').replace(/[^\w:.-]/g, '');
  const cmds = [`chunky world ${w}`, `chunky shape ${shape === 'circle' ? 'circle' : 'square'}`, `chunky center ${center && center.trim() ? center.trim().replace(/[^\d\s-]/g, '') : '0 0'}`, `chunky radius ${r}`, 'chunky start', 'chunky confirm'];
  for (const c of cmds) servers.command(id, c);
  return true;
});
handle('chunky:control', (id, action) => { if (!['pause', 'continue', 'cancel'].includes(action)) throw new Error('Nieznana akcja'); servers.command(id, `chunky ${action}`); if (action === 'cancel') setTimeout(() => servers.command(id, 'chunky confirm'), 300); return true; });

// ---------- formularz konfiguracji ----------
handle('servers:configForm', id => configform.read(servers.get(id)));
handle('servers:configFormSave', (id, values) => configform.write(servers.get(id), values));

// ---------- porty ----------
handle('ports:list', id => ({ ports: portsFor(id), local: ports.localIps() }));
function portsFor(id) { return ports.portsFor(servers.get(id)); }
handle('ports:check', async id => {
  const list = portsFor(id); const out = [];
  for (const p of list) {
    if (p.proto !== 'TCP') { out.push({ ...p, result: 'unknown' }); continue; }
    try { const r = await ports.checkExternal(p.port); out.push({ ...p, result: r.reachable ? 'open' : 'closed', ip: r.ip }); } catch (e) { out.push({ ...p, result: 'error', error: e.message }); }
  }
  return { results: out, running: servers.procs.has(id) };
});
handle('ports:upnpInfo', async () => { const g = await upnp.discover(); let ip = null; try { ip = await upnp.externalIp(); } catch { /* */ } let mappings = []; try { mappings = await upnp.list(); } catch { /* */ } return { router: g.name, host: g.host, externalIp: ip, mappings, local: ports.localIpFor(g.host) }; });
handle('ports:upnpOpen', async id => { const s = servers.get(id); const out = []; for (const p of portsFor(id)) { try { out.push({ ...(await upnp.add({ port: p.port, proto: p.proto, desc: `CodeManager ${s.name}`.slice(0, 60) })), ok: true }); } catch (e) { out.push({ ...p, ok: false, error: e.message }); } } return out; });
handle('ports:upnpClose', async id => { const out = []; for (const p of portsFor(id)) { try { await upnp.remove(p); out.push({ ...p, ok: true }); } catch (e) { out.push({ ...p, ok: false, error: e.message }); } } return out; });

// ---------- szablony serwerów ----------
handle('servers:templates', () => templates.TEMPLATES.map(t => ({ ...t, typeName: (STYPES[t.type] || {}).name })));
handle('servers:createFromTemplate', (tplId, data) => {
  const t = templates.byId(tplId); if (!t) throw new Error('Nie ma takiego szablonu');
  return servers.create({ ...data, type: t.type, variant: t.variant || data.variant, ram: data.ram || t.ram, afterInstall: srv => templates.runSteps(t, srv, { servers, modrinth, backupRoot }) });
});

// ---------- synchronizacja klient–serwer ----------
async function syncCompare(serverId, target) {
  const s = servers.get(serverId);
  if (s.type === 'minecraft') {
    const ctx = profileCtx('minecraft', target.profileId);
    return { kind: 'minecraft', server: s.name, client: ctx.prof && ctx.prof.name, clientDir: ctx.modsDir, inner: 'mods', ...(await work('syncMinecraft', { serverDir: path.join(s.path, 'mods'), clientDir: ctx.modsDir })) };
  }
  if (s.type === 'valheim') {
    const g = GAMES.find(x => x.id === 'valheim'); const det = detected && detected.games.valheim;
    const root = target.path || (det && det.found ? det.path : null);
    if (!root) throw new Error('Nie wykryto Valheima na tym komputerze – wskaż folder gry.');
    return { kind: 'valheim', server: s.name, client: g ? g.name : 'Valheim', clientDir: path.join(root, 'BepInEx', 'plugins'), inner: 'BepInEx/plugins', ...(await work('syncThunder', { serverRoot: s.path, clientRoot: root })) };
  }
  if (s.type === 'projectzomboid') {
    const info = detected && detected.games.projectzomboid;
    const G = require('./compat/games');
    const zhome = path.join(U.home(), 'Zomboid');
    const mods = G.pzCollectMods([...G.pzWorkshopDirs((info && info.workshop) || []), { dir: path.join(zhome, 'mods'), source: 'Lokalne' }]);
    return { kind: 'projectzomboid', server: s.name, client: 'Project Zomboid', clientDir: path.join(zhome, 'mods'), inner: 'mods', ...sync.comparePZ(path.join(s.path, 'Zomboid', 'Server', `${s.settings.servername || 'servertest'}.ini`), mods.map(m => m.id)) };
  }
  throw new Error('Synchronizacja jest dostępna dla serwerów Minecraft (mody), Valheim i Project Zomboid.');
}
handle('sync:compare', (serverId, target) => syncCompare(serverId, target || {}));
handle('sync:install', async (serverId, target) => {
  const r = await syncCompare(serverId, target || {});
  if (r.kind === 'projectzomboid') throw new Error('Mody Project Zomboid pobierze Steam przy dołączaniu do serwera.');
  const items = [...r.missing, ...r.mismatch];
  if (!items.length) return { installed: [] };
  return { installed: sync.installInto(items, r.clientDir, path.join(userData, 'backups', 'sync', new Date().toISOString().replace(/[:.]/g, '-'))) };
});
handle('sync:pack', async (serverId, target) => {
  const r = await syncCompare(serverId, target || {});
  const items = r.kind === 'projectzomboid' ? [] : [...r.missing, ...r.mismatch];
  if (!items.length) throw new Error('Gracz ma już wszystkie mody z serwera.');
  const out = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), `${U.safeName(r.server)}-mody.zip`), filters: [{ name: 'ZIP', extensions: ['zip'] }] });
  if (out.canceled) return null;
  return sync.makePack(items, out.filePath, { inner: r.inner });
});

// ---------- konflikty, kolejność ładowania, duplikaty ----------
function localRegistry(gameId) { return nexusReg.forGame(gameId); }
handle('mods:conflicts', async (gameId, profileId) => {
  const ctx = profileCtx(gameId, profileId);
  const rep = await gameReport(gameId, profileId);
  return work('conflicts', { game: gameDef(gameId), mods: rep.mods, registry: localRegistry(gameId) });
});
handle('loadorder:get', gameId => { const g = gameDef(gameId); if (!loadorder.supported(g)) return null; return loadorder.get(g, infoFor(gameId)); });
handle('loadorder:sort', (gameId, items) => loadorder.autoSort(gameDef(gameId), items));
handle('loadorder:check', (gameId, items) => loadorder.problems(gameDef(gameId), items));
handle('loadorder:save', async (gameId, items) => { const g = gameDef(gameId); await autoSnapshot(gameId, null, 'przed zmianą kolejności'); return loadorder.save(g, items); });
handle('mods:dupes', async (gameId, profileId) => { const rep = await gameReport(gameId, profileId); return work('dupes', { mods: rep.mods }); });
function gameReport(gameId, profileId) { const ctx = profileCtx(gameId, profileId); return checkGame(gameId, ctx.info, ctx.prof, { ...((config.games[gameId] || {}).settings || {}), __nexus: nexusRegFor(gameId) }); }

// ---------- migawki ----------
const snapKeep = () => Math.max(2, +config.settings.snapshotKeep || 10);
function snapCtx(gameId, profileId) { const ctx = profileCtx(gameId, profileId); const g = gameDef(gameId); const extra = []; if (g.checker === 'bethesda') extra.push(require('./compat/games2').pluginsTxt(gameId)); if (g.checker === 'rimworld') extra.push(require('./compat/games2').rimConfigPath()); if (g.checker === 'witcher3') extra.push(path.join(U.documents(), 'The Witcher 3', 'mods.settings')); return { root: ctx.root || ctx.info.path, modsDir: ctx.modsDir, extra }; }
async function autoSnapshot(gameId, profileId, reason) {
  if (config.settings.autoSnapshot === false || !gameId) return null;
  try { return await snapshots.create(gameDef(gameId), snapCtx(gameId, profileId), { reason, keep: snapKeep(), maxBytes: (+config.settings.autoSnapshotMaxGB || 1) * 1024 ** 3 }); } catch (e) { console.error('migawka', e.message); return null; }
}
handle('snapshots:list', gameId => snapshots.list(gameId));
handle('snapshots:create', (gameId, profileId, label) => snapshots.create(gameDef(gameId), snapCtx(gameId, profileId), { label, reason: 'ręczna', keep: snapKeep() }));
handle('snapshots:restore', (gameId, profileId, id) => snapshots.restore(gameDef(gameId), snapCtx(gameId, profileId), id, { keep: snapKeep() }));
handle('snapshots:delete', (gameId, id) => { snapshots.remove(snapshots.find(gameId, id)); return true; });

// ---------- udostępnianie profili ----------
function shareExtra(gameId, ctx) {
  const g = gameDef(gameId); const extra = { mcVersion: ctx.mcVersion, loader: ctx.loader, nexus: nexusReg.forGame(gameId) };
  if (g.checker === 'bepinex') { extra.thunder = new Map(); for (const p of thunder.installedPackages(ctx.root).values()) extra.thunder.set(path.resolve(p.dir).toLowerCase(), `${p.full}-${p.version}`); }
  return extra;
}
handle('share:export', async (gameId, profileId, name) => {
  const ctx = profileCtx(gameId, profileId); const rep = await gameReport(gameId, profileId);
  const prof = share.build(gameDef(gameId), name || (ctx.prof && ctx.prof.name) || gameDef(gameId).name, rep.mods, shareExtra(gameId, ctx));
  return { code: share.encode(prof), profile: prof };
});
handle('share:saveFile', async (code, name) => { const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), `${U.safeName(name || 'profil')}.cmprofile`), filters: [{ name: 'Profil CodeManager', extensions: ['cmprofile'] }] }); if (r.canceled) return null; fs.writeFileSync(r.filePath, code); return r.filePath; });
handle('share:readFile', f => U.readText(f, '').trim());
handle('share:preview', async (gameId, profileId, input) => {
  const prof = share.decode(input);
  if (prof.game !== gameId) throw new Error(`Ten profil jest dla gry „${(gameDef(prof.game) || {}).name || prof.game}”.`);
  const p = share.plan(prof, (await gameReport(gameId, profileId)).mods);
  return { name: prof.name, mc: prof.mc, total: prof.mods.length, toggle: p.toggle.map(t => ({ name: t.mod.name, want: t.want })), download: p.download.map(d => ({ name: d.n, version: d.v, source: d.h ? 'Modrinth' : d.ts ? 'Thunderstore' : d.nx ? 'Nexus Mods' : null })), extra: p.extra.map(m => m.name), same: p.same.length };
});
handle('share:import', async (jobId, gameId, profileId, input, { disableExtra } = {}) => {
  const log = jobLog(jobId), progress = jobProg(jobId);
  const prof = share.decode(input); const g = gameDef(gameId); const ctx = profileCtx(gameId, profileId);
  await autoSnapshot(gameId, profileId, 'przed importem profilu');
  const p = share.plan(prof, (await gameReport(gameId, profileId)).mods);
  const tctx = { gameId, gamePath: ctx.info.path };
  let toggled = 0;
  for (const t of p.toggle) { try { compat.toggle(t.mod, tctx); toggled++; log(`${t.want ? 'Włączono' : 'Wyłączono'} ${t.mod.name}`); } catch (e) { log('⚠ ' + t.mod.name + ': ' + e.message); } }
  if (disableExtra) for (const m of p.extra) { try { compat.toggle(m, tctx); toggled++; log('Wyłączono ' + m.name + ' (nie ma go w profilu)'); } catch (e) { log('⚠ ' + e.message); } }
  const installed = []; const manual = [];
  for (const d of p.download) {
    try {
      if (d.h && g.checker === 'minecraft') {
        const v = await fetch(`https://api.modrinth.com/v2/version_file/${d.h}?algorithm=sha1`, { headers: { 'User-Agent': 'CodeManager' } }).then(r => (r.ok ? r.json() : null));
        if (v) { await modrinth.install(v.project_id, { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, progress, backupRoot }, { versionId: v.id }); installed.push(d.n); continue; }
      }
      if (d.ts && g.checker === 'bepinex') { await thunder.install(d.ts, { root: ctx.root, log, progress, backupRoot }); installed.push(d.n); continue; }
      if (d.nx && nexus.DOMAINS[gameId] && (config.settings.nexusUser || {}).premium) {
        const files = await nexus.files(nexus.DOMAINS[gameId], d.nx); const f = files.filter(x => x.category_name === 'MAIN').sort((a, b) => b.uploaded_timestamp - a.uploaded_timestamp)[0];
        if (f) { await nexusInstall({ domain: nexus.DOMAINS[gameId], gameId, profileId, modId: d.nx, fileId: f.file_id }, log, progress); installed.push(d.n); continue; }
      }
      manual.push({ name: d.n, version: d.v || null, url: d.nx && nexus.DOMAINS[gameId] ? `https://www.nexusmods.com/${nexus.DOMAINS[gameId]}/mods/${d.nx}` : null });
      log(`⚠ ${d.n}: trzeba pobrać ręcznie`);
    } catch (e) { manual.push({ name: d.n, version: d.v || null }); log(`✖ ${d.n}: ${e.message}`); }
  }
  return { name: prof.name, toggled, installed, manual };
});

// ---------- notatki i tagi ----------
handle('notes:get', gameId => ({ notes: notes.forGame(gameId), tags: notes.allTags(gameId) }));
handle('notes:set', (gameId, mod, data) => notes.set(gameId, mod, data));
handle('notes:lock', (gameId, mod, lock) => notes.setLock(gameId, mod, lock));

// ---------- automatyczne kolekcje z tagów ----------
handle('profiles:fromTag', async (gameId, scope, tag, name) => {
  const mods = (await gameReport(gameId, scope === 'game' ? null : scope)).mods;
  const keys = new Set(notes.withTag(gameId, tag));
  const p = profiles.create(gameId, scope, name || `Tag: ${tag}`, mods.map(m => ({ ...m, enabled: m.toggleable && keys.has(normKey(m)) })));
  p.tag = tag; profiles.save();
  return p;
});

// ---------- kosz ----------
handle('trash:list', gameId => trash.list(gameId || null));
handle('trash:restore', id => trash.restore(id));
handle('trash:delete', id => { trash.remove(id); return true; });
handle('trash:empty', gameId => { trash.empty(gameId || null); return true; });

// ---------- bisekcja ----------
const bkey = (g, p) => `${g}:${p || 'game'}`;
async function bisectApply(gameId, profileId, want) {
  const mods = (await gameReport(gameId, profileId)).mods; const ctx = { gameId, gamePath: infoFor(gameId).path };
  let n = 0; const errors = [];
  for (const m of bisect.changes(mods, want)) { try { compat.toggle(m, ctx); n++; } catch (e) { errors.push(`${m.name}: ${e.message}`); } }
  return { changed: n, errors };
}
const bisectView = s => (s ? { ...s, roundsLeft: bisect.roundsLeft(s), on: s.test.on.map(k => s.names[k] || k), off: s.test.off.map(k => s.names[k] || k), suspectsNames: s.suspects.map(k => s.names[k] || k), culpritName: s.culprit ? (s.names[s.culprit] || s.culprit) : null } : null);
handle('bisect:get', (gameId, profileId) => bisectView(bisects.get(bkey(gameId, profileId))));
handle('bisect:start', async (gameId, profileId, keepOn) => {
  await autoSnapshot(gameId, profileId, 'przed szukaniem winowajcy');
  const s = bisect.start((await gameReport(gameId, profileId)).mods, { keepOn });
  bisects.set(bkey(gameId, profileId), s);
  const r = await bisectApply(gameId, profileId, bisect.desired(s));
  return { ...bisectView(s), applied: r };
});
handle('bisect:answer', async (gameId, profileId, problem) => {
  const s = bisect.answer(bisects.get(bkey(gameId, profileId)), !!problem);
  bisects.set(bkey(gameId, profileId), s);
  const r = await bisectApply(gameId, profileId, bisect.desired(s));
  return { ...bisectView(s), applied: r };
});
handle('bisect:finish', async (gameId, profileId, { keepCulpritOff } = {}) => {
  const s = bisects.get(bkey(gameId, profileId)); if (!s) return null;
  const want = new Map(s.original.map(m => [m.key, m.enabled]));
  if (keepCulpritOff && s.culprit) want.set(s.culprit, false);
  const r = await bisectApply(gameId, profileId, want);
  bisects.set(bkey(gameId, profileId), null);
  return r;
});

// ---------- raport do wysłania ----------
handle('report:build', async ({ target, analysis, file }) => {
  let rep = null; let t = null; let logTail = null;
  if (target && target.gameId) {
    const ctx = profileCtx(target.gameId, target.profileId); const g = gameDef(target.gameId);
    try { rep = await gameReport(target.gameId, target.profileId); } catch { rep = null; }
    t = { kind: 'game', name: g.name, detail: ctx.prof && ctx.prof.name !== 'Folder gry' ? `${ctx.prof.name}${ctx.mcVersion ? ` (${ctx.mcVersion} ${ctx.loader || ''})` : ''}` : null, path: ctx.root };
  } else if (target && target.serverId) {
    const s = servers.get(target.serverId); t = { kind: 'server', name: s.name, detail: `${(STYPES[s.type] || {}).name}${s.variant ? ' ' + s.variant : ''}${s.version ? ' ' + s.version : ''}`, path: s.path };
    try { rep = await work('serverCheck', { server: servers.get(target.serverId) }); } catch { rep = null; }
  }
  if (file) { try { logTail = String(file).startsWith('console:') ? servers.getLog(file.slice(8)).slice(-80).join('\n') : analyzer.readTail(file, 64 * 1024); } catch { /* */ } }
  return reportTxt.build({ appVersion: app.getVersion(), electron: process.versions.electron, target: t, report: rep, analysis, file: file && !String(file).startsWith('console:') ? file : null, logTail });
});
handle('report:save', async text => { const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('desktop'), `raport-codemanager-${new Date().toISOString().slice(0, 10)}.md`), filters: [{ name: 'Tekst', extensions: ['md', 'txt'] }] }); if (r.canceled) return null; fs.writeFileSync(r.filePath, text, 'utf8'); return r.filePath; });

// ---------- analizator: logi z linków ----------
handle('analyzer:url', async (url, ctx = {}) => {
  const { text, url: raw } = await analyzer.fetchLog(url);
  let pkgIndex = [];
  if (ctx.gameId === 'minecraft') { const md = profileCtx('minecraft', ctx.profileId).modsDir; pkgIndex = await work('pkgIndex', { modsDir: md }, () => analyzer.buildPackageIndex(md)); }
  const r = analyzer.analyzeText(text, { pkgIndex });
  const tmp = path.join(userData, 'logs-online'); fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, 'log-' + Date.now() + '.txt'); fs.writeFileSync(file, text);
  for (const f of U.listFiles(tmp).sort().slice(0, -10)) fs.rmSync(f, { force: true });
  return { ...r, headline: analyzer.headline(r.findings), file, url: raw, size: text.length };
});

// ---------- uruchamianie gier i czas gry ----------
const playtime = new launch.PlayTime(path.join(userData, 'playtime.json'), { emit, games: GAMES, getDetected: () => detected });
app.whenReady().then(() => { if (!process.env.CM_SCREENSHOT_DIR && config.settings.trackPlaytime !== false) playtime.start(); });
handle('games:launch', async (gameId, profileId) => {
  const g = gameDef(gameId); const info = infoFor(gameId); const gs = (config.games[gameId] || {}).settings || {};
  const prof = compat.profiles(gameId, info).find(p => p.id === profileId) || compat.profiles(gameId, info)[0];
  if (gs.launchProfile && g.id !== 'minecraft') {
    const scope = profileId || 'game';
    const list = profiles.list(gameId, scope);
    if (list.profiles.find(p => p.id === gs.launchProfile) && list.active !== gs.launchProfile) {
      const plan = profiles.plan(gameId, scope, gs.launchProfile, (await gameReport(gameId, profileId)).mods);
      for (const m of plan.changes) { try { compat.toggle(m, { gameId, gamePath: info.path }); } catch { /* */ } }
      profiles.setActive(gameId, scope, gs.launchProfile);
    }
  }
  const p = launch.plan(g, info, { args: gs.launchArgs, method: gs.launchMethod || 'auto', useLoader: gs.useLoader !== false, profile: prof });
  await launch.run(p, u => shell.openExternal(u));
  return { label: p.label };
});
handle('playtime:all', () => ({ all: playtime.all(), recent: playtime.recent(6) }));

// ---------- zapisy gier ----------
function saveCtx(gameId, profileId) { const info = infoFor(gameId); const ctx = gameId === 'minecraft' ? profileCtx(gameId, profileId) : null; return { gamePath: info.path, profileRoot: ctx && ctx.root, steamRoots: steamRootsCache, appid: info.appid, userdata: info.userdata }; }
async function savePaths(gameId, profileId) { if (!steamRootsCache.length) { try { steamRootsCache = (await detect.steamApps(config.settings.steamPath)).roots || []; } catch { /* */ } } return saves.paths(gameDef(gameId), saveCtx(gameId, profileId)); }
const saveKey = (g, p) => (g === 'minecraft' && p ? `${g}_${p}` : g);
handle('saves:info', async (gameId, profileId) => ({ paths: await savePaths(gameId, profileId), backups: saveBackups.list(saveKey(gameId, profileId)) }));
handle('saves:backup', async (gameId, profileId, label) => {
  const dirs = await savePaths(gameId, profileId); if (!dirs.length) throw new Error('Nie znaleziono folderu zapisów tej gry.');
  return saveBackups.create({ id: saveKey(gameId, profileId), checker: 'saves' }, {}, { label, reason: 'zapis gry', keep: Math.max(3, +config.settings.saveKeep || 20), targets: { dirs, files: [] } });
});
handle('saves:restore', (gameId, profileId, id) => saveBackups.restore({ id: saveKey(gameId, profileId), checker: 'saves' }, {}, id, { keep: Math.max(3, +config.settings.saveKeep || 20) }));
handle('saves:delete', (gameId, profileId, id) => { saveBackups.remove(saveBackups.find(saveKey(gameId, profileId), id)); return true; });

// ---------- sprawdzanie aktualizacji wszystkich modów naraz ----------
function updateTargets() {
  const out = [];
  if (detected) for (const g of GAMES) {
    const info = detected.games[g.id]; if (!info || !info.found) continue;
    const svc = g.checker === 'minecraft' ? 'Modrinth' : g.checker === 'bepinex' ? 'Thunderstore' : g.checker === 'factorio' ? 'Portal Factorio' : nexus.DOMAINS[g.id] && loadNexusKey() ? 'Nexus Mods' : null;
    if (!svc) continue;
    for (const p of compat.profiles(g.id, info)) out.push({ key: `g:${g.id}:${p.id}`, gameId: g.id, profileId: p.id, name: g.name + (p.name && p.name !== 'Folder gry' ? ` – ${p.name}` : ''), service: svc });
  }
  for (const s of servers.servers) {
    if ((s.type === 'minecraft' && s.variant !== 'vanilla') || s.type === 'mcproxy') out.push({ key: `s:${s.id}`, serverId: s.id, name: `Serwer: ${s.name}`, service: 'Modrinth' });
    if (s.type === 'valheim') out.push({ key: `s:${s.id}`, serverId: s.id, name: `Serwer: ${s.name}`, service: 'Thunderstore' });
  }
  return out;
}
async function checkUpdatesFor(t, log) {
  if (t.serverId) {
    const ctx = serverCtx(t.serverId);
    if (ctx.modsDir) return modrinth.updateAll({ modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, dryRun: true });
    return thunder.updateAll({ root: ctx.root, log, dryRun: true });
  }
  const g = gameDef(t.gameId); const ctx = profileCtx(t.gameId, t.profileId);
  const skipFiles = await lockedFiles(t.gameId, t.profileId);
  if (g.checker === 'minecraft') return modrinth.updateAll({ modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, dryRun: true, skipFiles });
  if (g.checker === 'bepinex') return thunder.updateAll({ root: ctx.root, log, dryRun: true, skipFiles });
  if (g.checker === 'factorio') { const gi = U.readJSON(path.join(ctx.info.path, 'data', 'base', 'info.json'), {}); const items = await G2.factorioUpdates(ctx.info.path, gi.version, { download: false, log }); return { available: items.filter(i => i.level === 'info' && /dostępna|nowsza|→/i.test(i.title)).map(i => ({ name: i.title })), upToDate: 0, unknown: [] }; }
  const items = await nexusUpdates(t.gameId, ctx, log, skipFiles); return { available: items.filter(i => i.nexus).map(i => ({ name: i.title, url: i.url })), upToDate: 0, unknown: [], manual: true };
}
handle('updates:targets', () => updateTargets());
handle('updates:checkAll', async jobId => {
  const log = jobLog(jobId); const out = [];
  const list = updateTargets();
  for (let i = 0; i < list.length; i++) {
    const t = list[i]; emit('job:progress', { jobId, pct: Math.round((i / list.length) * 100) });
    log(`Sprawdzam: ${t.name} (${t.service})…`);
    try { const r = await checkUpdatesFor(t, log); out.push({ ...t, available: r.available || [], upToDate: r.upToDate || 0, unknown: (r.unknown || []).length, locked: (r.locked || []).length, manual: !!r.manual }); }
    catch (e) { out.push({ ...t, error: e.message, available: [] }); log('✖ ' + e.message); }
  }
  emit('job:progress', { jobId, pct: 100 });
  return out;
});
handle('updates:applyAll', async (jobId, keys) => {
  const log = jobLog(jobId); const progress = jobProg(jobId); const res = [];
  const list = updateTargets().filter(t => keys.includes(t.key));
  for (const t of list) {
    log(`=== ${t.name} ===`);
    if (t.gameId) await autoSnapshot(t.gameId, t.profileId, 'przed aktualizacją modów');
    try {
      const r = t.serverId ? await updRun(jobId, { serverId: t.serverId }) : await updRun(jobId, { gameId: t.gameId, profileId: t.profileId, __noSnap: true });
      res.push({ key: t.key, name: t.name, updated: (r.updated || []).length, kind: r.kind });
    } catch (e) { log('✖ ' + e.message); res.push({ key: t.key, name: t.name, error: e.message }); }
    progress({ pct: Math.round((res.length / list.length) * 100) });
  }
  return res;
});

// ---------- walidacja TOML / YAML w edytorze ----------
handle('fs:validate', (lang, text) => {
  if (lang === 'toml') { try { require('@iarna/toml').parse(text); return []; } catch (e) { return [{ line: (e.line || 0) + 1, col: (e.col || 0) + 1, msg: String(e.message).split('\n')[0].replace(/ at row \d+, col \d+, pos \d+:?/, '') }]; } }
  if (lang === 'yaml') { const YAML = require('yaml'); const out = []; for (const d of YAML.parseAllDocuments(text)) for (const e of [...d.errors, ...d.warnings]) { const lp = e.linePos && e.linePos[0]; out.push({ line: lp ? lp.line : 1, col: lp ? lp.col : 1, msg: String(e.message).split('\n')[0], warn: d.warnings.includes(e) }); } return out; }
  if (lang === 'json') { try { JSON.parse(text); return []; } catch (e) { return []; } }
  return [];
});
handle('fs:parse', (lang, text) => {
  if (lang === 'toml') return require('@iarna/toml').parse(text);
  if (lang === 'yaml') return require('yaml').parse(text);
  if (lang === 'json') return JSON.parse(text.replace(/^﻿/, ''));
  if (lang === 'ltx') return parseLtx(text);
  if (lang === 'ini' || lang === 'properties') return require('./parsers/text').parseIni(text);
  throw new Error('Podgląd struktury działa dla JSON, TOML, YAML i INI.');
});

// STALKER .ltx: sekcje z dziedziczeniem [nazwa]:rodzic1, rodzic2, komentarze ; i #include
function parseLtx(text) {
  const out = {}; const includes = []; let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, '').trim(); if (!l) continue;
    let m;
    if ((m = l.match(/^#include\s+"([^"]+)"/i))) { includes.push(m[1]); continue; }
    if ((m = l.match(/^\[([^\]]+)\]\s*(?::\s*(.+))?$/))) { cur = out[m[1].trim()] = {}; if (m[2]) cur['(dziedziczy)'] = m[2].split(',').map(x => x.trim()).filter(Boolean); continue; }
    const i = l.indexOf('='); const k = (i < 0 ? l : l.slice(0, i)).trim(); const v = i < 0 ? '' : l.slice(i + 1).trim();
    (cur || (out['(bez sekcji)'] = out['(bez sekcji)'] || {}))[k] = v;
  }
  return includes.length ? { '#include': includes, ...out } : out;
}

// ---------- zasobnik systemowy ----------
let tray = null;
function trayMenu() {
  const list = servers.list();
  const items = [{ label: 'Pokaż CodeManager', click: () => { if (win) { win.show(); win.focus(); } } }, { type: 'separator' }];
  if (list.length) {
    items.push({ label: 'Serwery', enabled: false });
    for (const s of list) {
      const on = s.status === 'running';
      items.push({ label: `${on ? '● ' : '○ '}${s.name}`, submenu: [
        on ? { label: 'Zatrzymaj', click: () => { try { servers.stop(s.id); } catch { /* */ } } } : { label: 'Uruchom', enabled: s.status !== 'installing', click: () => { try { servers.start(s.id); } catch (e) { systemNotify(s.name, e.message); } } },
        on ? { label: 'Restart', click: () => servers.restart(s.id).catch(() => {}) } : { label: 'Kopia zapasowa', click: () => scheduler.backup(s.id).catch(() => {}) },
        { label: 'Otwórz w programie', click: () => { if (win) { win.show(); win.focus(); emit('nav:go', { view: 'servers', params: { id: s.id } }); } } },
      ] });
    }
    items.push({ type: 'separator' });
  }
  items.push({ label: 'Zakończ CodeManager', click: () => { app.isQuitting = true; app.quit(); } });
  return Menu.buildFromTemplate(items);
}
function updateTray() {
  if (!tray) return;
  const n = servers.list().filter(s => s.status === 'running').length;
  tray.setToolTip(n ? `CodeManager – działa serwerów: ${n}` : 'CodeManager');
  tray.setContextMenu(trayMenu());
}
function setupTray() {
  if (config.settings.tray && !tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png')) : icon);
    tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
    tray.on('click', () => { if (win && process.platform === 'win32') { win.show(); win.focus(); } });
    updateTray();
  } else if (!config.settings.tray && tray) { tray.destroy(); tray = null; }
}
app.whenReady().then(() => { if (!process.env.CM_SCREENSHOT_DIR) setupTray(); });
handle('tray:apply', () => { setupTray(); return !!tray; });

// ---------- aktualizacje programu → powiadomienie ----------
let notifiedVersion = null;
setInterval(() => { try { const st = updater.status(); if (st.state === 'available' && st.latest && st.latest !== notifiedVersion) { notifiedVersion = st.latest; notifier.event('update', null, { version: st.latest }); } } catch { /* */ } }, 60000);

// ---------- tryb przenośny ----------
const CACHE_DIRS = new Set(['cache', 'code cache', 'gpucache', 'dawncache', 'dawngraphitecache', 'dawnwebgpucache', 'blob_storage', 'crashpad', 'network', 'shared dictionary', 'session storage', 'service worker', 'webstorage', 'logs-online']);
function copyData(src, dst, onFile) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of U.listDir(src)) {
    if (CACHE_DIRS.has(e.name.toLowerCase()) || /^singleton/i.test(e.name) || e.name === 'lockfile') continue;
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    try { if (e.isDirectory()) copyData(a, b, onFile); else { fs.copyFileSync(a, b); onFile && onFile(e.name); } } catch { /* zablokowany plik */ }
  }
}
handle('portable:status', () => {
  const mode = updater.mode();
  let writable = false; try { fs.accessSync(exeDir, fs.constants.W_OK); writable = true; } catch { /* */ }
  return { active: portableActive, dir: PORTABLE_DIR, defaultDir: defaultUserData, mode, available: portableActive || ((mode === 'portable' || mode === 'zip') && writable), writable };
});
handle('portable:enable', async jobId => {
  if (portableActive) return true;
  const log = jobLog(jobId); let n = 0;
  log(`Kopiowanie danych z ${userData} do ${PORTABLE_DIR}…`);
  saveConfig();
  copyData(userData, PORTABLE_DIR, () => { if (++n % 50 === 0) log(`Skopiowano ${n} plików…`); });
  log(`✔ Skopiowano ${n} plików. Program uruchomi się ponownie.`);
  setTimeout(() => { app.relaunch(); app.isQuitting = true; app.exit(0); }, 1500);
  return true;
});
handle('portable:disable', async jobId => {
  if (!portableActive) return true;
  const log = jobLog(jobId); let n = 0;
  saveConfig();
  copyData(PORTABLE_DIR, defaultUserData, () => n++);
  const old = PORTABLE_DIR + '-wylaczony-' + Date.now().toString(36);
  log(`✔ Skopiowano ${n} plików do ${defaultUserData}. Folder obok programu zostanie przemianowany na ${path.basename(old)}.`);
  setTimeout(() => { try { fs.renameSync(PORTABLE_DIR, old); } catch { /* */ } app.relaunch(); app.isQuitting = true; app.exit(0); }, 1500);
  return true;
});

// =====================================================================
// Wersja 1.6: ostrzeżenia przed instalacją, polecane mody, paczki zasobów
// i shadery, alarmy zasobów, podgląd mapy Minecraft
// =====================================================================
const precheck = require('./mods/precheck');
const recommend = require('./mods/recommend');
const mcpacks = require('./mods/mcpacks');

// ---------- ostrzeżenie przed instalacją ----------
handle('precheck:modrinth', async (target, projectId) => {
  if (config.settings.warnBeforeInstall === false) return { warnings: [] };
  const ctx = target.serverId ? serverCtx(target.serverId) : profileCtx(target.gameId, target.profileId);
  if (!ctx.modsDir) return { warnings: [] };
  return precheck.modrinth(projectId, { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader }, modrinth);
});
handle('precheck:archives', async (gameId, files) => {
  if (config.settings.warnBeforeInstall === false) return [];
  const out = [];
  for (const f of files) { const entries = await precheck.listArchive(f); for (const o of precheck.overlaps(entries, nexusReg.forGame(gameId))) out.push({ archive: path.basename(f), ...o }); }
  return out;
});
handle('precheck:nexus', async (gameId, modId, fileId) => {
  if (config.settings.warnBeforeInstall === false) return [];
  const f = (await nexus.files(nexus.DOMAINS[gameId], modId)).find(x => +x.file_id === +fileId);
  if (!f || !f.content_preview_link) return [];
  const r = await fetch(f.content_preview_link, { headers: { 'User-Agent': 'CodeManager' } }).catch(() => null);
  if (!r || !r.ok) return [];
  const entries = precheck.flattenPreview(await r.json());
  return precheck.overlaps(entries, nexusReg.forGame(gameId).filter(e => e.modId !== +modId));
});

// ---------- polecane mody ----------
handle('recommend:list', async target => {
  const ctx = target.serverId ? serverCtx(target.serverId) : profileCtx(target.gameId, target.profileId);
  if (!ctx.modsDir) return [];
  const installed = new Set();
  for (const f of U.listFiles(ctx.modsDir).filter(x => /\.jar(\.disabled)?$/i.test(x))) {
    installed.add(path.basename(f).toLowerCase().replace(/\.disabled$/, '').replace(/\.jar$/, ''));
  }
  try { const rep = target.serverId ? await work('serverCheck', { server: servers.get(target.serverId) }) : await gameReport(target.gameId, target.profileId); for (const m of rep.mods) { if (m.id) installed.add(String(m.id).toLowerCase()); } } catch { /* */ }
  try { const idx = await modrinth.installedIndex(ctx.modsDir); const ids = [...idx.projects.keys()]; for (const p of await modrinth.projectsInfo(ids)) installed.add(p.slug.toLowerCase()); } catch { /* bez sieci – wystarczą identyfikatory modów */ }
  const loader = (ctx.loader || '').toLowerCase();
  const cands = recommend.candidates(installed, loader).slice(0, 10);
  if (!cands.length) return [];
  let infos = [];
  try { infos = await modrinth.projectsInfo(cands.map(c => c.slug)); } catch { return []; }
  const out = [];
  for (const c of cands) {
    const p = infos.find(x => x.slug === c.slug); if (!p) continue;
    if (ctx.mcVersion && !(p.game_versions || []).includes(ctx.mcVersion)) continue;
    const ls = loader === 'quilt' ? ['quilt', 'fabric'] : loader === 'purpur' ? ['purpur', 'paper', 'spigot', 'bukkit'] : loader === 'paper' ? ['paper', 'spigot', 'bukkit'] : [loader];
    if (loader && !(p.loaders || []).some(l => ls.includes(l))) continue;
    out.push({ id: p.id, slug: p.slug, title: p.title, description: p.description, icon: p.icon_url, downloads: p.downloads, why: c.why, url: `https://modrinth.com/${p.project_type}/${p.slug}` });
  }
  return out.slice(0, 6);
});

// ---------- paczki zasobów i shadery (Minecraft) ----------
const mcRoot = profileId => profileCtx('minecraft', profileId).root;
handle('mcpacks:list', profileId => mcpacks.list(mcRoot(profileId)));
handle('mcpacks:toggle', (profileId, name, on) => mcpacks.togglePack(mcRoot(profileId), name, on));
handle('mcpacks:move', (profileId, name, dir) => mcpacks.movePack(mcRoot(profileId), name, dir));
handle('mcpacks:shader', (profileId, name) => mcpacks.setShader(mcRoot(profileId), name));
handle('mcpacks:add', (profileId, kind, files) => {
  const dir = path.join(mcRoot(profileId), kind === 'shader' ? 'shaderpacks' : 'resourcepacks'); fs.mkdirSync(dir, { recursive: true });
  for (const f of files) { const d = path.join(dir, path.basename(f)); if (U.isDir(f)) U.copyRecursive(f, d); else fs.copyFileSync(f, d); }
  return dir;
});
handle('mcpacks:install', async (jobId, profileId, kind, projectId) => {
  const ctx = profileCtx('minecraft', profileId);
  const dir = path.join(ctx.root, kind === 'shader' ? 'shaderpacks' : 'resourcepacks');
  return modrinth.install(projectId, { modsDir: dir, mcVersion: kind === 'shader' ? null : ctx.mcVersion, loader: null, log: jobLog(jobId), progress: jobProg(jobId), backupRoot });
});
handle('mcpacks:remove', async (profileId, p) => trash.put(p, { gameId: 'minecraft' }));

// ---------- alarmy zasobów serwera ----------
monitor.onAlarm = (id, a) => { const s = servers.servers.find(x => x.id === id); if (s) { servers.log(id, `⚠ Alarm: ${a.kind === 'cpu' ? `procesor ${Math.round(a.value)}%` : `pamięć ${(a.value / 1048576).toFixed(0)} MB`} od ${a.minutes} min (limit ${a.limit}${a.kind === 'cpu' ? '%' : ' MB'})`); notifier.event('alarm', { ...s, typeName: (STYPES[s.type] || {}).name }, a); } };

// ---------- podgląd mapy Minecraft (BlueMap / squaremap / dynmap) ----------
function webmapInfo(s) {
  const plugin = ['paper', 'purpur'].includes(s.variant);
  const dir = path.join(s.path, plugin ? 'plugins' : 'mods');
  const jars = U.listFiles(dir).map(f => path.basename(f).toLowerCase()).filter(f => f.endsWith('.jar'));
  const cfg = (...p) => path.join(s.path, ...p);
  const num = (t, re, d) => { const m = t && t.match(re); return m ? +m[1] : d; };
  if (jars.some(j => j.startsWith('bluemap'))) {
    const base = plugin ? cfg('plugins', 'BlueMap') : cfg('config', 'bluemap');
    const core = path.join(base, 'core.conf');
    const coreT = U.readText(core);
    return { kind: 'bluemap', name: 'BlueMap', port: num(U.readText(path.join(base, 'webserver.conf')), /^\s*port\s*:\s*(\d+)/m, 8100), configured: !!coreT, accepted: !!(coreT && /accept-download\s*:\s*true/.test(coreT)), core };
  }
  if (jars.some(j => j.startsWith('squaremap'))) {
    const t = U.readText(plugin ? cfg('plugins', 'squaremap', 'config.yml') : cfg('config', 'squaremap', 'config.yml'));
    return { kind: 'squaremap', name: 'squaremap', port: num(t, /internal-webserver:[\s\S]*?port:\s*(\d+)/, 8080), configured: true, accepted: true };
  }
  if (jars.some(j => j.startsWith('dynmap'))) {
    const t = U.readText(plugin ? cfg('plugins', 'dynmap', 'configuration.txt') : cfg('dynmap', 'configuration.txt'));
    return { kind: 'dynmap', name: 'Dynmap', port: num(t, /^webserver-port:\s*(\d+)/m, 8123), configured: true, accepted: true };
  }
  return null;
}
handle('webmap:status', id => { const s = servers.get(id); return { supported: s.type === 'minecraft' && s.variant !== 'vanilla', running: servers.procs.has(id), map: webmapInfo(s), variant: s.variant }; });
handle('webmap:install', async (jobId, id, which) => {
  const ctx = serverCtx(id);
  if (!['bluemap', 'squaremap'].includes(which)) throw new Error('Nieznana mapa');
  return modrinth.install(which, { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log: jobLog(jobId), progress: jobProg(jobId), backupRoot });
});
handle('webmap:accept', id => {
  const m = webmapInfo(servers.get(id));
  if (!m || m.kind !== 'bluemap' || !m.core || !U.exists(m.core)) throw new Error('Plik core.conf BlueMap jeszcze nie istnieje – uruchom serwer raz.');
  const t = U.readText(m.core, '');
  fs.writeFileSync(m.core, /accept-download\s*:/.test(t) ? t.replace(/accept-download\s*:\s*\w+/, 'accept-download: true') : t + '\naccept-download: true\n');
  return true;
});
