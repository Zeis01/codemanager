// Menedżer serwerów: zapis listy, instalacja, procesy, konsola
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const U = require('../util');
const { configFiles, steamcmdWorkshop } = require('./defs');
const { TYPES, FRAMEWORKS } = require('./defs2');
const { SourceRcon } = require('../rcon');
const checker = require('./check');

class ServerManager {
  constructor({ userData, getSettings, emit }) {
    this.userData = userData; this.getSettings = getSettings; this.emit = emit;
    this.file = path.join(userData, 'servers.json');
    this.servers = U.readJSON(this.file, []);
    this.procs = new Map(); this.logs = new Map(); this.status = new Map(); this.stdinTarget = new Map();
    this.stopRequested = new Set(); this.crashes = new Map(); this.rconConns = new Map();
    this.onLine = null; this.onEvent = null;
  }
  save() { U.writeJSON(this.file, this.servers); }
  get(id) { const s = this.servers.find(x => x.id === id); if (!s) throw new Error('Nie znaleziono serwera'); return s; }
  list() {
    return this.servers.map(s => ({ ...s, status: this.status.get(s.id) || 'stopped', typeName: (TYPES[s.type] || {}).name, color: (TYPES[s.type] || {}).color, exists: U.isDir(s.path) }));
  }
  types() {
    return Object.entries(TYPES).map(([id, t]) => ({ id, name: t.name, color: t.color, port: t.port, variants: t.variants || null, needsVersion: !!t.needsVersion, needsEula: !!t.needsEula, fields: t.fields || [], needsLogin: !!t.needsLogin, rcon: !!t.rcon, worlds: !!t.worlds, rconHint: t.rconHint || null, steamApp: t.steamApp || null, frameworks: (t.frameworks || []).map(f => ({ id: f, name: FRAMEWORKS[f].name, desc: FRAMEWORKS[f].desc })) }));
  }
  async versions(type) { const t = TYPES[type]; return t.versions ? t.versions() : []; }

  log(id, line) {
    const arr = this.logs.get(id) || []; this.logs.set(id, arr);
    for (const l of String(line).split(/\r?\n/)) {
      if (!l.trim()) continue;
      const clean = l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      arr.push(clean); if (arr.length > 3000) arr.shift();
      this.emit('server:log', { id, line: clean });
      if (this.onLine) { try { this.onLine(id, clean); } catch { /* */ } }
    }
  }
  setStatus(id, st) { this.status.set(id, st); this.emit('server:status', { id, status: st }); }
  getLog(id) { return this.logs.get(id) || []; }

  ctx(server, jobProgress) {
    const self = this;
    return {
      userData: this.userData, settings: this.getSettings(),
      log: l => self.log(server.id, l),
      progress: p => { self.emit('server:progress', { id: server.id, ...p }); if (jobProgress) jobProgress(p); },
      spawnLogged: (cmd, args, cwd, onLine, { interactive } = {}) => new Promise((res, rej) => {
        const p = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        if (interactive) self.stdinTarget.set(server.id, p);
        const h = d => { const s = String(d); self.log(server.id, s); if (onLine) s.split(/\r?\n/).forEach(onLine); };
        p.stdout.on('data', h); p.stderr.on('data', h);
        p.on('error', rej);
        // SteamCMD zwraca 7 po samoaktualizacji – traktujemy to jako sukces
        p.on('close', code => { self.stdinTarget.delete(server.id); if (code === 0 || code === 7) res(code); else rej(new Error(`Proces zakończył się kodem ${code}`)); });
      }),
    };
  }

  async create(data) {
    const t = TYPES[data.type]; if (!t) throw new Error('Nieznany typ serwera');
    const settings = {};
    for (const f of t.fields || []) settings[f.id] = data.settings && data.settings[f.id] != null ? String(data.settings[f.id]) : f.def;
    const base = data.basePath || this.getSettings().serversPath || path.join(U.home(), 'CodeManager-Servers');
    const server = {
      id: 's' + Date.now().toString(36), type: data.type, name: data.name || t.name, variant: data.variant || null, version: data.version || null,
      port: +data.port || t.port, ram: +data.ram || 4096, path: data.path || path.join(base, U.safeName(data.name || t.name)), settings, eula: !!data.eula, createdAt: Date.now(),
    };
    if (t.validate) { const err = t.validate(server); if (err) throw new Error(err); }
    if (t.needsEula && !server.eula) throw new Error('Aby zainstalować serwer Minecraft, musisz zaakceptować EULA Mojang.');
    if (U.isDir(server.path) && fs.readdirSync(server.path).length && !data.allowExisting) throw new Error('Folder docelowy nie jest pusty: ' + server.path);
    fs.mkdirSync(server.path, { recursive: true });
    this.servers.push(server); this.save();
    if (!data.importOnly) this.install(server.id).then(() => (data.afterInstall ? data.afterInstall(server) : null)).catch(() => {});
    return server;
  }
  importExisting(data) { return this.create({ ...data, allowExisting: true, importOnly: true }); }

  async install(id) {
    const s = this.get(id); const t = TYPES[s.type];
    this.setStatus(id, 'installing');
    this.log(id, `=== Instalacja: ${t.name} → ${s.path} ===`);
    try {
      await t.install(s, this.ctx(s));
      s.installedAt = Date.now(); this.save();
      this.log(id, '✔ Instalacja zakończona.');
      this.setStatus(id, 'stopped');
    } catch (e) {
      this.log(id, '✖ Błąd instalacji: ' + e.message);
      this.setStatus(id, 'error');
      throw e;
    }
  }
  async update(id) {
    const s = this.get(id); const t = TYPES[s.type];
    if (this.procs.has(id)) throw new Error('Zatrzymaj serwer przed aktualizacją.');
    if (!t.update) throw new Error('Ten serwer aktualizuje się przez ponowną instalację (np. nowa wersja Minecraft = nowy serwer).');
    this.setStatus(id, 'installing'); this.log(id, '=== Aktualizacja ===');
    try { await t.update(s, this.ctx(s)); this.save(); this.log(id, '✔ Zaktualizowano.'); this.setStatus(id, 'stopped'); }
    catch (e) { this.log(id, '✖ ' + e.message); this.setStatus(id, 'error'); throw e; }
  }
  update2(id, patch) {
    const s = this.get(id);
    Object.assign(s, patch, { settings: { ...s.settings, ...(patch.settings || {}) } });
    this.save(); return s;
  }
  remove(id, deleteFiles) {
    const s = this.get(id);
    if (this.procs.has(id)) throw new Error('Najpierw zatrzymaj serwer.');
    this.servers = this.servers.filter(x => x.id !== id); this.save();
    return { path: s.path, deleteFiles };
  }

  start(id) {
    const s = this.get(id); const t = TYPES[s.type];
    if (this.procs.has(id)) throw new Error('Serwer już działa');
    let st = t.start(s);
    if (!U.exists(st.cmd) && path.isAbsolute(st.cmd)) throw new Error('Nie znaleziono pliku serwera: ' + st.cmd + ' – zainstaluj serwer lub wybierz Aktualizuj.');
    if (s.docker && s.docker.enabled) { st = require('./docker').buildRun(s, st, require('./ports').portsFor(s)); this.log(id, `Docker: obraz ${require('./docker').imageFor(s)}${s.docker.memory ? `, RAM ${s.docker.memory} MB` : ''}${s.docker.cpus ? `, CPU ${s.docker.cpus}` : ''}`); }
    this.log(id, `=== Start: ${path.basename(st.cmd)} ${st.args.join(' ')} ===`);
    const p = spawn(st.cmd, st.args, { cwd: st.cwd, env: { ...process.env, ...(st.env || {}) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.procs.set(id, p); this.setStatus(id, 'running');
    s.lastStart = Date.now(); this.save();
    if (this.onEvent) this.onEvent('start', s, {});
    p.stdout.on('data', d => this.log(id, String(d)));
    p.stderr.on('data', d => this.log(id, String(d)));
    p.on('error', e => { this.log(id, '✖ ' + e.message); });
    this.stopRequested.delete(id);
    p.on('close', code => {
      this.procs.delete(id); this.log(id, `=== Serwer zatrzymany (kod ${code}) ===`); this.setStatus(id, 'stopped');
      const rc = this.rconConns.get(id); if (rc) { rc.close(); this.rconConns.delete(id); }
      const wanted = this.stopRequested.has(id); this.stopRequested.delete(id);
      const sc = (this.servers.find(x => x.id === id) || {}).schedule || {};
      if (this.onEvent) { const srv = this.servers.find(x => x.id === id); if (srv) this.onEvent(wanted ? 'stop' : 'crash', srv, { code, restart: !wanted && !!(sc.autoRestart && sc.autoRestart.enabled) }); }
      if (!wanted && sc.autoRestart && sc.autoRestart.enabled) {
        const hist = (this.crashes.get(id) || []).filter(t => Date.now() - t < 3600000); hist.push(Date.now()); this.crashes.set(id, hist);
        if (hist.length > (+sc.autoRestart.maxPerHour || 3)) { this.log(id, '✖ Serwer wyłącza się zbyt często – automatyczny restart wstrzymany. Sprawdź log w Analizatorze.'); return; }
        this.log(id, '⚠ Serwer niespodziewanie się wyłączył – automatyczny restart za 10 s…');
        setTimeout(() => { try { if (!this.procs.has(id)) this.start(id); } catch (e) { this.log(id, '✖ ' + e.message); } }, 10000);
      }
      if (this.onExit) this.onExit(id, code, wanted);
    });
    return true;
  }
  stop(id) {
    const p = this.procs.get(id); if (!p) return false;
    const s = this.get(id); const t = TYPES[s.type];
    this.stopRequested.add(id);
    this.setStatus(id, 'stopping');
    const cmd = t.stopCmdFor ? t.stopCmdFor(s) : t.stopCmd;
    let graceful = !!cmd;
    if (cmd) { try { p.stdin.write(cmd + '\n'); } catch { /* */ } }
    else if (t.rconStop && t.rcon && t.rcon(s)) { graceful = true; this.rconExec(id, t.rconStop).catch(() => this.kill(id)); }
    const killTimer = setTimeout(() => this.kill(id), graceful ? 45000 : 100);
    p.once('close', () => clearTimeout(killTimer));
    return true;
  }
  restart(id) {
    return new Promise((res, rej) => {
      const p = this.procs.get(id);
      if (!p) { try { this.start(id); res(true); } catch (e) { rej(e); } return; }
      p.once('close', () => setTimeout(() => { try { this.start(id); res(true); } catch (e) { rej(e); } }, 3000));
      this.stop(id);
    });
  }
  rconInfo(id) { const s = this.get(id); const t = TYPES[s.type]; const r = t.rcon ? t.rcon(s) : null; return r ? { host: '127.0.0.1', ...r } : null; }
  async rconExec(id, cmd) {
    const info = this.rconInfo(id);
    if (!info || info.protocol !== 'source') throw new Error('RCON niedostępny dla tego serwera');
    let c = this.rconConns.get(id);
    if (!c || !c.connected) { c = new SourceRcon(info); await c.connect(); this.rconConns.set(id, c); c.onClose = () => this.rconConns.delete(id); }
    return c.exec(cmd);
  }
  kill(id) {
    this.stopRequested.add(id);
    const p = this.procs.get(id); if (!p) return false;
    const s = this.servers.find(x => x.id === id);
    if (s && s.docker && s.docker.enabled) spawn('docker', ['kill', require('./docker').containerName(s)], { windowsHide: true }).on('error', () => {});
    if (U.isWin) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); else p.kill('SIGKILL');
    return true;
  }
  command(id, cmd) {
    const p = this.stdinTarget.get(id) || this.procs.get(id);
    if (!p) throw new Error('Serwer nie działa');
    this.log(id, '> ' + (this.stdinTarget.has(id) ? '••••••' : cmd));
    p.stdin.write(cmd + '\n');
    return true;
  }

  configs(id) { return configFiles(this.get(id)); }
  contentDir(id) { const s = this.get(id); const t = TYPES[s.type]; return { dir: t.contentDir ? t.contentDir(s) : s.path, label: t.contentLabel ? t.contentLabel(s) : 'Pliki' }; }
  frameworks(id) {
    const s = this.get(id); const t = TYPES[s.type];
    return (t.frameworks || []).map(f => ({ id: f, name: FRAMEWORKS[f].name, desc: FRAMEWORKS[f].desc, installed: !!FRAMEWORKS[f].status(s) }));
  }
  async installFramework(id, fw) {
    const s = this.get(id);
    if (this.procs.has(id)) throw new Error('Zatrzymaj serwer przed instalacją.');
    this.log(id, `=== Instalacja: ${FRAMEWORKS[fw].name} ===`);
    try { await FRAMEWORKS[fw].install(s, this.ctx(s)); this.log(id, '✔ Gotowe.'); }
    catch (e) { this.log(id, '✖ ' + e.message); throw e; }
  }
  async workshopAdd(id, itemId) {
    const s = this.get(id); const t = TYPES[s.type];
    if (t.workshopAdd) { this.log(id, `=== Warsztat: ${itemId} ===`); const r = await t.workshopAdd(s, itemId, m => this.log(id, m)); this.save(); return r; }
    if (!t.workshopApp) throw new Error('Ten serwer nie obsługuje pobierania z Warsztatu');
    this.log(id, `=== Pobieranie przedmiotu Warsztatu ${itemId} ===`);
    const dir = await steamcmdWorkshop(s, this.ctx(s), t.workshopApp, itemId, s.settings.steamuser);
    const meta = U.readText(path.join(dir, 'meta.cpp'), '');
    const name = '@' + U.safeName(((meta.match(/name\s*=\s*"([^"]+)"/) || [])[1] || itemId)).replace(/\s+/g, '');
    const target = path.join(s.path, name);
    U.copyRecursive(dir, target);
    fs.mkdirSync(path.join(s.path, 'keys'), { recursive: true });
    for (const k of ['keys', 'Keys', 'key']) for (const f of U.listFiles(path.join(target, k), ['.bikey'])) fs.copyFileSync(f, path.join(s.path, 'keys', path.basename(f)));
    const mods = (s.settings.mods || '').split(';').filter(Boolean);
    if (!mods.includes(name)) { mods.push(name); s.settings.mods = mods.join(';'); this.save(); }
    this.log(id, `✔ Dodano ${name} (klucze skopiowane do keys/, dopisano do -mod).`);
    return name;
  }
  check(id) { return checker.check(this.get(id)); }
  online(id) { return checker.online(this.get(id)); }
  stopAll() { for (const id of this.procs.keys()) this.kill(id); }
}

module.exports = { ServerManager };
