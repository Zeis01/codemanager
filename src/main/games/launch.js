// Uruchamianie gier z programu oraz licznik czasu gry
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const U = require('../util');

// gry, dla których zamiast exe gry lepiej użyć loadera skryptów
const LOADER_EXE = { skyrimse: 'skse64_loader.exe', fallout4: 'f4se_loader.exe' };

function findExe(game, root) {
  for (const e of game.exe || []) { const p = path.join(root, ...e.split('/')); if (U.isFile(p) && !/\.sh$/.test(p) === (process.platform === 'win32')) return p; }
  for (const e of game.exe || []) { const p = path.join(root, ...e.split('/')); if (U.isFile(p)) return p; }
  return null;
}
function splitArgs(s) { const out = []; String(s || '').replace(/"([^"]*)"|(\S+)/g, (_, a, b) => { out.push(a !== undefined ? a : b); return ''; }); return out; }

function prismExe() {
  return U.firstExisting([path.join(U.localAppData(), 'Programs', 'PrismLauncher', 'prismlauncher.exe'), 'C:\\Program Files\\PrismLauncher\\prismlauncher.exe', '/usr/bin/prismlauncher', path.join(U.home(), '.local', 'bin', 'prismlauncher')]);
}
function mcLauncherExe() {
  return U.firstExisting(['C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe', path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Minecraft Launcher', 'MinecraftLauncher.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Minecraft Launcher', 'MinecraftLauncher.exe')]);
}

/**
 * Plan uruchomienia: { kind: 'steam', url } | { kind: 'exe', cmd, args, cwd }
 * opts: { args, method: 'auto'|'steam'|'exe', useLoader, profile }
 */
function plan(game, info, opts = {}) {
  const args = splitArgs(opts.args);
  if (game.id === 'minecraft') {
    const p = opts.profile || {};
    if (/prism/i.test(p.launcher || '')) { const exe = prismExe(); if (exe) return { kind: 'exe', cmd: exe, args: ['-l', path.basename(path.dirname(p.root)), ...args], cwd: path.dirname(exe), label: 'Prism Launcher' }; }
    const exe = mcLauncherExe(); if (exe) return { kind: 'exe', cmd: exe, args, cwd: path.dirname(exe), label: 'Minecraft Launcher' };
    throw new Error('Nie znaleziono launchera Minecrafta – uruchom grę w swoim launcherze.');
  }
  const method = opts.method || 'auto';
  const loader = LOADER_EXE[game.id] && opts.useLoader !== false ? path.join(info.path, LOADER_EXE[game.id]) : null;
  if (loader && U.isFile(loader) && method !== 'steam') return { kind: 'exe', cmd: loader, args, cwd: info.path, label: path.basename(loader) };
  const appid = info.appid || (game.appIds || [])[0];
  if ((method === 'steam' || (method === 'auto' && info.source === 'Steam')) && appid) {
    return { kind: 'steam', url: `steam://run/${appid}//${args.map(a => encodeURIComponent(a)).join('%20')}/`, label: 'Steam' };
  }
  const exe = findExe(game, info.path);
  if (!exe) throw new Error('Nie znaleziono pliku gry (.exe) w folderze – sprawdź lokalizację gry.');
  return { kind: 'exe', cmd: exe, args, cwd: path.dirname(exe), label: path.basename(exe) };
}

function run(p, openExternal) {
  if (p.kind === 'steam') return openExternal(p.url);
  const child = spawn(p.cmd, p.args, { cwd: p.cwd, detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  return true;
}

// ---------- licznik czasu gry ----------
function parseTasklist(text) { return String(text).split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map(s => s.toLowerCase()); }
function processNames() {
  if (process.platform === 'win32') return new Promise(res => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => res(e ? [] : parseTasklist(out))));
  const names = [];
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try { const c = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0')[0]; if (c) names.push(path.basename(c.replace(/\\/g, '/')).toLowerCase()); } catch { /* */ }
    }
  } catch { /* */ }
  return Promise.resolve(names);
}
function exeNames(game) {
  const s = new Set((game.exe || []).map(e => path.basename(e).toLowerCase()).filter(n => !/\.sh$/.test(n)));
  if (LOADER_EXE[game.id]) s.add(LOADER_EXE[game.id]);
  return s;
}

class PlayTime {
  constructor(file, { emit, games, getDetected, interval = 30000 }) {
    this.file = file; this.emit = emit; this.games = games; this.getDetected = getDetected; this.interval = interval;
    this.data = U.readJSON(file, {}); this.timer = null; this.lastTick = null;
    for (const v of Object.values(this.data)) delete v.current; // sesje sprzed zamknięcia programu są zakończone
  }
  save() { U.writeJSON(this.file, this.data); }
  // names: nazwy procesów z bieżącej chwili
  update(names, now = Date.now()) {
    const set = new Set(names);
    const det = this.getDetected() || { games: {} };
    const dt = this.lastTick ? Math.min(now - this.lastTick, this.interval * 3) : 0;
    this.lastTick = now;
    let changed = false;
    for (const g of this.games) {
      if (g.id === 'minecraft' || !(det.games[g.id] && det.games[g.id].found)) continue;
      const running = [...exeNames(g)].some(n => set.has(n));
      const d = this.data[g.id] = this.data[g.id] || { total: 0, sessions: 0, last: null };
      if (running) {
        if (!d.current) { d.current = now; d.sessions++; changed = true; this.emit && this.emit('games:playing', { id: g.id, playing: true }); }
        else if (dt) d.total += dt;
        d.last = now; changed = true;
      } else if (d.current) { delete d.current; changed = true; this.emit && this.emit('games:playing', { id: g.id, playing: false }); }
    }
    if (changed) this.save();
    return this.data;
  }
  async tick() { this.update(await processNames()); }
  start() { if (!this.timer) { this.timer = setInterval(() => this.tick().catch(() => {}), this.interval); this.tick().catch(() => {}); } }
  stop() { clearInterval(this.timer); this.timer = null; }
  all() { return this.data; }
  recent(n = 5) { return Object.entries(this.data).filter(([, v]) => v.last).sort((a, b) => b[1].last - a[1].last).slice(0, n).map(([id, v]) => ({ id, ...v, playing: !!v.current })); }
}

module.exports = { plan, run, PlayTime, parseTasklist, splitArgs, findExe, LOADER_EXE, exeNames };
