// Kopie zapasowe światów i harmonogram restartów serwerów
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const U = require('../util');
const { TYPES, worldPaths } = require('./defs2');

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

// Na Windows zawsze systemowy tar (bsdtar z System32) – tar z Gita/MSYS traktuje „C:” jak adres zdalnego hosta
function tarBin() {
  if (process.platform !== 'win32') return 'tar';
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return U.exists(sys) ? sys : 'tar';
}
function runTar(args, cwd) {
  return new Promise((res, rej) => {
    const p = spawn(tarBin(), args, { cwd, windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => rej(new Error('Nie można uruchomić tar: ' + e.message)));
    p.on('close', c => (c === 0 ? res() : rej(new Error('tar: ' + (err.trim().split('\n').pop() || 'kod ' + c)))));
  });
}

// ---------- rotacja kopii: zwykła (N ostatnich) albo dzienne/tygodniowe/miesięczne ----------
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const weekKey = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4); return `${d.getFullYear()}-W${1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7)}`; };
const monthKey = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}`; };
function selectKeep(files, policy = {}) {
  const list = files.slice().sort((a, b) => b.time - a.time);
  if (!list.length) return new Set();
  if (policy.mode !== 'gfs') return new Set(list.slice(0, Math.max(1, +policy.keep || 10)).map(f => f.path));
  const keep = new Set([list[0].path]);
  const bucket = (fn, n) => { if (!(+n > 0)) return; const seen = []; for (const f of list) { const k = fn(f.time); if (seen.includes(k)) continue; if (seen.length >= +n) break; seen.push(k); keep.add(f.path); } };
  bucket(dayKey, policy.daily); bucket(weekKey, policy.weekly); bucket(monthKey, policy.monthly);
  return keep;
}
function retention(sc = {}) { return sc.retention && sc.retention.mode === 'gfs' ? sc.retention : { mode: 'count', keep: +sc.keep || 10 }; }

// ---------- zadania o godzinie / co X minut ----------
function dueTasks(tasks, now, last = {}) {
  const d = new Date(now); const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const out = [];
  for (const t of tasks || []) {
    if (!t || t.enabled === false) continue;
    if (Array.isArray(t.days) && t.days.length && !t.days.includes(d.getDay())) continue;
    if (t.every) { const every = Math.max(1, +t.every) * 60000; if (!last[t.id] || now - last[t.id] >= every - 5000) out.push(t); continue; }
    const times = String(t.at || '').split(',').map(x => x.trim()).filter(Boolean).map(x => x.replace(/^(\d):/, '0$1:'));
    if (times.includes(hm) && (!last[t.id] || now - last[t.id] > 70000)) out.push(t);
  }
  return out;
}

class Scheduler {
  constructor(mgr, userData) {
    this.mgr = mgr; this.userData = userData; this.busy = new Set(); this.warned = new Map(); this.taskRuns = {}; this.onBackup = null;
    this.timer = setInterval(() => this.tick().catch(e => console.error('scheduler', e)), 20000);
  }
  dir(s) { return s.schedule && s.schedule.backupDir ? s.schedule.backupDir : path.join(this.userData, 'backups', 'servers', s.id); }
  list(id) {
    const s = this.mgr.get(id);
    return U.listFiles(this.dir(s)).filter(f => /\.(zip|tar\.gz)$/i.test(f)).map(f => ({ path: f, name: path.basename(f), size: fs.statSync(f).size, time: fs.statSync(f).mtimeMs })).sort((a, b) => b.time - a.time);
  }

  async backup(id, reason = 'ręczna') {
    const s = this.mgr.get(id); const t = TYPES[s.type];
    if (this.busy.has(id)) throw new Error('Kopia zapasowa jest już w trakcie.');
    const items = worldPaths(s);
    if (!items.length) throw new Error('Nie znaleziono plików świata do skopiowania (serwer mógł jeszcze nie wygenerować świata).');
    this.busy.add(id);
    const running = this.mgr.procs.has(id);
    const log = l => this.mgr.log(id, l);
    try {
      log(`=== Kopia zapasowa (${reason}) ===`);
      if (running) {
        for (const c of t.preBackup || (t.saveCmd ? [t.saveCmd] : [])) { try { this.mgr.command(id, c); } catch { /* */ } }
        if (t.saveRcon) { try { await this.mgr.rconExec(id, t.saveRcon); } catch { /* */ } }
        await new Promise(r => setTimeout(r, 4000));
      }
      const dir = this.dir(s); fs.mkdirSync(dir, { recursive: true });
      const ext = U.isWin ? 'zip' : 'tar.gz';
      let file = path.join(dir, `${U.safeName(s.name)}_${stamp(new Date())}${reason === 'przed przywróceniem' ? '_przed-przywroceniem' : ''}.${ext}`);
      for (let n = 2; U.exists(file); n++) file = file.replace(/(_\d+)?\.(zip|tar\.gz)$/, `_${n}.$2`);
      // każdy element jako -C <rodzic> <nazwa>; dla ścieżek spoza folderu serwera zapis mapy
      const args = U.isWin ? ['-a', '-c', '-f', file] : ['-czf', file];
      const map = {};
      for (const it of items) {
        const inside = !path.relative(s.path, it).startsWith('..');
        if (inside) { args.push('-C', s.path, path.relative(s.path, it).split(path.sep).join('/')); }
        else { args.push('-C', path.dirname(it), path.basename(it)); map[path.basename(it)] = it; }
      }
      await runTar(args);
      if (Object.keys(map).length) U.writeJSON(file + '.map.json', map);
      const size = fs.statSync(file).size;
      log(`✔ Zapisano ${path.basename(file)} (${(size / 1048576).toFixed(1)} MB)`);
      s.lastBackup = Date.now(); this.mgr.save();
      this.prune(s);
      const mirror = await this.mirror(s, file).catch(e => { log('⚠ Nie udało się skopiować do drugiej lokalizacji: ' + e.message); return null; });
      if (this.onBackup) this.onBackup(s, { file, size, reason, mirror });
      return { file, size, mirror };
    } catch (e) { log('✖ Kopia nie powiodła się: ' + e.message); if (this.onBackup && reason !== 'przed przywróceniem') this.onBackup(s, { error: e.message, reason }); throw e; }
    finally {
      if (running) for (const c of t.postBackup || []) { try { this.mgr.command(id, c); } catch { /* */ } }
      this.busy.delete(id);
    }
  }
  prune(s) {
    const all = this.list(s.id);
    const keep = selectKeep(all, retention(s.schedule));
    for (const b of all) if (!keep.has(b.path)) { try { fs.rmSync(b.path); fs.rmSync(b.path + '.map.json', { force: true }); } catch { /* */ } }
  }
  // druga lokalizacja (inny dysk, folder OneDrive/Google Drive/Dropbox)
  mirrorDir(s) { const m = s.schedule && s.schedule.mirrorDir; return m ? path.join(m, U.safeName(s.name) + '_' + s.id) : null; }
  async mirror(s, file) {
    const dir = this.mirrorDir(s); if (!dir) return null;
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(file));
    await fs.promises.copyFile(file, dest);
    if (U.exists(file + '.map.json')) await fs.promises.copyFile(file + '.map.json', dest + '.map.json');
    const all = U.listFiles(dir).filter(f => /\.(zip|tar\.gz)$/i.test(f)).map(f => ({ path: f, time: fs.statSync(f).mtimeMs }));
    const keep = selectKeep(all, retention(s.schedule));
    for (const b of all) if (!keep.has(b.path)) { try { fs.rmSync(b.path); fs.rmSync(b.path + '.map.json', { force: true }); } catch { /* */ } }
    this.mgr.log(s.id, `✔ Kopia skopiowana do ${dir}`);
    return dest;
  }
  async restore(id, file) {
    const s = this.mgr.get(id);
    if (this.mgr.procs.has(id)) throw new Error('Zatrzymaj serwer przed przywracaniem kopii.');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-restore-'));
    try {
      // najpierw zabezpiecz obecny stan
      await this.backup(id, 'przed przywróceniem').catch(() => {});
      await runTar(['-xf', file, '-C', tmp]);
      const map = U.readJSON(file + '.map.json', {});
      for (const e of U.listDir(tmp)) {
        const target = map[e.name] || path.join(s.path, e.name);
        fs.rmSync(target, { recursive: true, force: true });
        U.copyRecursive(path.join(tmp, e.name), target);
      }
      this.mgr.log(id, `✔ Przywrócono kopię ${path.basename(file)}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // ---------- harmonogram ----------
  nextRestart(s, now = new Date()) {
    const r = s.schedule && s.schedule.restart; if (!r || !r.enabled) return null;
    if (r.mode === 'interval') { const base = s.lastStart || Date.now(); return base + (+r.everyHours || 6) * 3600000; }
    const times = String(r.time || '05:00').split(',').map(x => x.trim()).filter(Boolean);
    let best = null;
    for (const tm of times) {
      const [hh, mm] = tm.split(':').map(Number);
      const d = new Date(now); d.setHours(hh || 0, mm || 0, 0, 0);
      if (d.getTime() <= now.getTime() - 60000) d.setDate(d.getDate() + 1);
      if (!best || d < best) best = d;
    }
    return best ? best.getTime() : null;
  }
  async announce(id, text) {
    const s = this.mgr.get(id); const t = TYPES[s.type];
    if (t.say) { try { this.mgr.command(id, t.say(text, s)); return; } catch { /* */ } }
    if (t.sayRcon) { try { await this.mgr.rconExec(id, t.sayRcon(text)); } catch { /* */ } }
  }
  async runTask(s, t) {
    const running = this.mgr.procs.has(s.id);
    this.mgr.log(s.id, `=== Zadanie: ${t.name || t.kind} ===`);
    if (t.kind === 'backup') return this.backup(s.id, 'zadanie');
    if (t.kind === 'restart') { if (running) return this.mgr.restart(s.id); return null; }
    if (t.kind === 'start') { if (!running) return this.mgr.start(s.id); return null; }
    if (t.kind === 'stop') { if (running) return this.mgr.stop(s.id); return null; }
    if (!running) return null;
    if (t.kind === 'say') return this.announce(s.id, t.value || '');
    for (const c of String(t.value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)) { try { this.mgr.command(s.id, c); } catch (e) { this.mgr.log(s.id, '✖ ' + e.message); } }
    return null;
  }
  async tick() {
    const now = Date.now();
    for (const s of this.mgr.servers) {
      const sc = s.schedule || {};
      const running = this.mgr.procs.has(s.id);
      // zadania użytkownika
      const last = this.taskRuns[s.id] = this.taskRuns[s.id] || {};
      for (const t of dueTasks(sc.tasks, now, last)) {
        last[t.id] = now;
        if (!running && !['backup', 'start'].includes(t.kind)) continue;
        this.runTask(s, t).catch(e => this.mgr.log(s.id, '✖ Zadanie: ' + e.message));
      }
      // kopie automatyczne
      if (sc.backup && sc.backup.enabled && (running || sc.backup.whenStopped)) {
        const every = (+sc.backup.everyHours || 6) * 3600000;
        if (!s.lastBackup || now - s.lastBackup >= every) this.backup(s.id, 'automatyczna').catch(() => {});
      }
      // restarty
      if (running && sc.restart && sc.restart.enabled) {
        const at = this.nextRestart(s);
        if (!at) continue;
        const left = at - now;
        const w = this.warned.get(s.id) || {};
        if (left <= 5 * 60000 && left > 4 * 60000 && w.at !== at + ':5') { this.announce(s.id, 'Restart serwera za 5 minut.'); this.warned.set(s.id, { at: at + ':5' }); }
        if (left <= 60000 && left > 30000 && w.at !== at + ':1') { this.announce(s.id, 'Restart serwera za 1 minutę!'); this.warned.set(s.id, { at: at + ':1' }); }
        if (left <= 0 && s.lastScheduledRestart !== at) {
          s.lastScheduledRestart = at; this.mgr.save();
          this.mgr.log(s.id, '=== Zaplanowany restart ===');
          if (sc.restart.backupBefore) await this.backup(s.id, 'przed restartem').catch(() => {});
          this.mgr.restart(s.id).catch(e => this.mgr.log(s.id, '✖ ' + e.message));
        }
      }
    }
  }
  stop() { clearInterval(this.timer); }
}

module.exports = { Scheduler, runTar, tarBin, selectKeep, dueTasks, retention };
