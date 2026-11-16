// CodeManager – proces główny Electron
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
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
const userData = app.getPath('userData');
const configFile = path.join(userData, 'config.json');
let config = U.readJSON(configFile, null) || { games: {}, settings: {} };
config.games = config.games || {}; config.settings = config.settings || {};
let detected = config.lastDetect || null;

function saveConfig() { config.lastDetect = detected; U.writeJSON(configFile, config); }
function emit(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

const servers = new ServerManager({ userData, getSettings: () => config.settings, emit });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680, frame: false, backgroundColor: '#0a120d', show: false,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => emit('win:state', { maximized: true }));
  win.on('unmaximize', () => emit('win:state', { maximized: false }));
}

// jedna instancja – linki nxm:// trafiają do działającego okna
const gotLock = process.env.CM_SCREENSHOT_DIR ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => { const u = argv.find(a => /^nxm:\/\//i.test(a)); if (u) handleNxm(u); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('open-url', (e, u) => { e.preventDefault(); if (/^nxm:/i.test(u)) handleNxm(u); });
app.whenReady().then(() => { createWindow(); const u = process.argv.find(a => /^nxm:\/\//i.test(a)); if (u) setTimeout(() => handleNxm(u), 3000); });
app.on('window-all-closed', () => { servers.stopAll(); rcon.closeAll(); app.quit(); });

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
handle('games:detect', async () => { detected = await detect.detectAll(config); saveConfig(); return detected; });
handle('games:detected', async () => { if (!detected) detected = await detect.detectAll(config); return detected; });
handle('games:setPath', async (id, p) => {
  if (!U.isDir(p)) throw new Error('Folder nie istnieje');
  config.games[id] = { ...(config.games[id] || {}), path: p, manual: true }; saveConfig();
  detected = await detect.detectAll(config); saveConfig();
  return detected.games[id];
});
handle('games:resetPath', async id => { if (config.games[id]) { delete config.games[id].manual; delete config.games[id].path; } detected = await detect.detectAll(config); saveConfig(); return detected.games[id]; });
handle('games:settings', (id, s) => { config.games[id] = { ...(config.games[id] || {}), settings: { ...((config.games[id] || {}).settings || {}), ...s } }; saveConfig(); return config.games[id].settings; });
handle('mc:addInstance', async (p, name) => {
  if (!U.isDir(p)) throw new Error('Folder nie istnieje');
  const g = config.games.minecraft = config.games.minecraft || {};
  g.manualInstances = g.manualInstances || [];
  if (!g.manualInstances.find(i => i.path === p)) g.manualInstances.push({ id: 'manual-' + Date.now().toString(36), name: name || ('Ręcznie: ' + path.basename(p)), path: p, launcher: 'Ręcznie' });
  detected = await detect.detectAll(config); saveConfig(); return detected.games.minecraft;
});
handle('mc:setInstance', async (instId, patch) => {
  const g = config.games.minecraft = config.games.minecraft || {};
  g.instanceOverrides = g.instanceOverrides || {};
  g.instanceOverrides[instId] = { ...(g.instanceOverrides[instId] || {}), ...patch };
  detected = await detect.detectAll(config); saveConfig(); return detected.games.minecraft;
});
handle('mc:removeInstance', async instId => {
  const g = config.games.minecraft || {};
  g.manualInstances = (g.manualInstances || []).filter(i => i.id !== instId);
  detected = await detect.detectAll(config); saveConfig(); return detected.games.minecraft;
});

function infoFor(id) { if (!detected || !detected.games[id]) throw new Error('Najpierw uruchom wykrywanie gier'); return detected.games[id]; }
handle('mods:profiles', id => compat.profiles(id, infoFor(id)));
handle('mods:check', (id, profileId) => {
  const info = infoFor(id);
  const prof = compat.profiles(id, info).find(p => p.id === profileId);
  return compat.check(id, info, prof, (config.games[id] || {}).settings || {});
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
handle('mods:remove', async p => { await shell.trashItem(p); return true; });

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
  if (detected) { detected = await detect.detectAll(config); saveConfig(); }
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
handle('servers:check', id => servers.check(id));
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
handle('fs:search', (root, q) => {
  const ql = q.toLowerCase();
  return U.walk(root, { maxFiles: 30000, filter: r => !/(^|\/)(node_modules|\.git|steamapps|Cache|cache)\//.test(r) }).filter(r => r.toLowerCase().includes(ql)).slice(0, 200).map(r => ({ rel: r, path: path.join(root, r) }));
});
handle('fs:grep', (root, q) => {
  const out = []; const ql = q.toLowerCase();
  for (const r of U.walk(root, { maxFiles: 8000, filter: f => /\.(lua|json|cfg|ini|txt|cs|sp|inc|xml|yml|yaml|toml|js|ts|properties|sqf|cpp|hpp|c|h|sii|gi|mcfunction|conf|md)$/i.test(f) })) {
    const full = path.join(root, r); let t; try { if (fs.statSync(full).size > 2e6) continue; t = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const lines = t.split(/\r?\n/);
    lines.forEach((l, i) => { if (out.length < 500 && l.toLowerCase().includes(ql)) out.push({ rel: r, path: full, line: i + 1, text: l.trim().slice(0, 200) }); });
    if (out.length >= 500) break;
  }
  return out;
});

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
  const res = await modrinth.install(projectId, { modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log: jobLog(jobId), progress: jobProg(jobId), backupRoot }, { versionId });
  return res;
});

// ---------- aktualizacja jednym przyciskiem ----------
handle('updates:run', async (jobId, target) => {
  const log = jobLog(jobId), progress = jobProg(jobId);
  if (target.serverId) {
    const ctx = serverCtx(target.serverId);
    if (ctx.modsDir) return { kind: 'modrinth', ...(await modrinth.updateAll({ modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, progress, backupRoot })) };
    if (ctx.s.type === 'valheim') return { kind: 'thunderstore', ...(await thunder.updateAll({ root: ctx.root, log, progress, backupRoot })) };
    throw new Error('Automatyczna aktualizacja nie jest dostępna dla tego serwera.');
  }
  const g = gameDef(target.gameId); const ctx = profileCtx(target.gameId, target.profileId);
  if (g.checker === 'minecraft') return { kind: 'modrinth', ...(await modrinth.updateAll({ modsDir: ctx.modsDir, mcVersion: ctx.mcVersion, loader: ctx.loader, log, progress, backupRoot })) };
  if (g.checker === 'bepinex') return { kind: 'thunderstore', ...(await thunder.updateAll({ root: ctx.root, log, progress, backupRoot })) };
  if (g.checker === 'factorio') { const gi = U.readJSON(path.join(ctx.info.path, 'data', 'base', 'info.json'), {}); return { kind: 'list', items: await G2.factorioUpdates(ctx.info.path, gi.version, { download: true, log, progress }) }; }
  if (nexus.DOMAINS[g.id]) return { kind: 'list', items: await nexusUpdates(g.id, ctx, log) };
  throw new Error('Ta gra nie ma serwisu z aktualizacjami modów.');
});
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
  nexusReg.add({ gameId: g, domain, modId: +modId, fileId: +fileId, version: (dl.file && dl.file.version) || (info && info.version), name: (info && info.name) || dl.name, paths });
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
async function nexusUpdates(gameId, ctx, log) {
  const domain = nexus.DOMAINS[gameId];
  const out = [];
  const entries = nexusReg.forGame(gameId).map(e => ({ modId: e.modId, version: e.version, name: e.name, src: 'CodeManager' }));
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
  for (const f of files) out.push(...await installArchive(f, { game: gameDef(gameId), target: ctx.modsDir, gameRoot: ctx.info.path }));
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
  detected = await detect.detectAll(config); saveConfig();
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
handle('fix:run', async (jobId, action, target) => {
  const log = jobLog(jobId), progress = jobProg(jobId);
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
  const pkgIndex = modsDir ? analyzer.buildPackageIndex(modsDir) : [];
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
handle('profiles:apply', (gameId, scope, id, mods) => {
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
const pkg = require('../../package.json');
const pub = [].concat((pkg.build && pkg.build.publish) || [])[0] || {};
function ghToken() {
  const enc = config.settings.ghTokenEnc; if (!enc) return null;
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : Buffer.from(enc, 'base64').toString('utf8'); } catch { return null; }
}
const updater = new Updater({ app, getSettings: () => config.settings, emit, defaultRepo: pub.owner && pub.repo ? `${pub.owner}/${pub.repo}` : (pkg.repository ? String(pkg.repository.url || pkg.repository).replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '') : ''), getToken: ghToken });
app.whenReady().then(() => { if (!process.env.CM_SCREENSHOT_DIR) updater.schedule(); });
handle('update:status', () => updater.status());
handle('update:check', () => updater.check(false));
handle('update:download', () => updater.download());
handle('update:install', () => updater.install());
handle('update:skip', v => { config.settings.skipVersion = v; saveConfig(); return updater.set({ state: 'none', skipped: true }); });
handle('update:configure', o => {
  if (o.repo !== undefined) config.settings.updateRepo = o.repo.trim();
  if (o.channel) config.settings.updateChannel = o.channel;
  if (o.auto !== undefined) config.settings.autoUpdate = !!o.auto;
  if (o.token !== undefined) { if (o.token) config.settings.ghTokenEnc = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(o.token) : Buffer.from(o.token, 'utf8')).toString('base64'); else delete config.settings.ghTokenEnc; }
  delete config.settings.skipVersion;
  saveConfig(); updater.schedule();
  return { ...updater.status(), hasToken: !!config.settings.ghTokenEnc, channel: config.settings.updateChannel || 'stable', auto: config.settings.autoUpdate !== false, repoSetting: config.settings.updateRepo || '', defaultRepo: updater.defaultRepo || updater.bakedRepo() };
});
handle('update:config', () => ({ ...updater.status(), hasToken: !!config.settings.ghTokenEnc, channel: config.settings.updateChannel || 'stable', auto: config.settings.autoUpdate !== false, repoSetting: config.settings.updateRepo || '', defaultRepo: updater.defaultRepo || updater.bakedRepo() }));
