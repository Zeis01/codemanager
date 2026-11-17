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

class Scheduler {
  constructor(mgr, userData) {
    this.mgr = mgr; this.userData = userData; this.busy = new Set(); this.warned = new Map();
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
      return { file, size };
    } catch (e) { log('✖ Kopia nie powiodła się: ' + e.message); throw e; }
    finally {
      if (running) for (const c of t.postBackup || []) { try { this.mgr.command(id, c); } catch { /* */ } }
      this.busy.delete(id);
    }
  }
  prune(s) {
    const keep = (s.schedule && +s.schedule.keep) || 10;
    const all = this.list(s.id);
    for (const b of all.slice(keep)) { try { fs.rmSync(b.path); fs.rmSync(b.path + '.map.json', { force: true }); } catch { /* */ } }
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
  async tick() {
    const now = Date.now();
    for (const s of this.mgr.servers) {
      const sc = s.schedule || {};
      const running = this.mgr.procs.has(s.id);
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

module.exports = { Scheduler, runTar, tarBin };
