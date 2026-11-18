// Historia uruchomień gier: lista modów przy każdym starcie i wynik sesji (crash / krótka / udana).
// Po crashu wskazuje, co zmieniło się od ostatniego udanego uruchomienia i które mody są podejrzane.
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');

const SHORT_MS = 45000;
const MAX = 30;

class LaunchHistory {
  constructor(file, { mods, crashDirs, now = () => Date.now() } = {}) {
    this.file = file; this.modsOf = mods; this.crashDirs = crashDirs || (() => []); this.now = now;
    this.data = (file && U.readJSON(file, null)) || {};
    this.open = {};
  }
  save() { if (this.file) U.writeJSON(this.file, this.data); }
  list(gameId) { return (this.data[gameId] || []).slice().reverse(); }
  async start(gameId) {
    let mods = [];
    try { mods = ((await this.modsOf(gameId)) || []).map(m => ({ key: String(m.key || m.file || m.name).toLowerCase(), name: m.name, version: m.version || '', enabled: m.enabled !== false, size: m.size || 0 })); } catch { mods = []; }
    this.open[gameId] = { start: this.now(), mods };
  }
  end(gameId, { code = null } = {}) {
    const o = this.open[gameId]; if (!o) return null;
    delete this.open[gameId];
    const end = this.now(); const duration = end - o.start;
    const crashFiles = this.findCrashFiles(gameId, o.start);
    const status = crashFiles.length || (code != null && code !== 0) ? 'crash' : duration < SHORT_MS ? 'short' : 'ok';
    const s = { start: o.start, end, duration, status, crashFiles, mods: o.mods };
    const arr = this.data[gameId] = this.data[gameId] || [];
    arr.push(s); while (arr.length > MAX) arr.shift();
    this.save();
    return s;
  }
  async onPlaying({ id, playing }) { if (playing) await this.start(id); else this.end(id); }
  mark(gameId, start, status) { const s = (this.data[gameId] || []).find(x => x.start === start); if (!s) return null; s.status = status; s.manual = true; this.save(); return s; }
  findCrashFiles(gameId, since) {
    const out = [];
    for (const d of this.crashDirs(gameId) || []) {
      const dir = typeof d === 'string' ? d : d.dir; const re = typeof d === 'string' ? /crash|\.dmp$|hs_err/i : d.re;
      for (const f of U.listFiles(dir)) { try { if (re.test(path.basename(f)) && fs.statSync(f).mtimeMs >= since - 10000) out.push(f); } catch { /* */ } }
    }
    return out;
  }
  // porównanie ostatniej złej sesji z ostatnią udaną
  analyze(gameId, currentMods) {
    const arr = this.data[gameId] || [];
    const bad = [...arr].reverse().find(s => s.status === 'crash' || s.status === 'short');
    const good = bad ? [...arr].reverse().find(s => s.status === 'ok' && s.start < bad.start) : null;
    const now = currentMods ? currentMods.map(m => ({ key: String(m.key || m.file || m.name).toLowerCase(), name: m.name, version: m.version || '', enabled: m.enabled !== false, size: m.size || 0 })) : null;
    const target = bad ? bad.mods : now;
    if (!target) return { sessions: arr.length, bad: null, good: null, changes: [], suspects: [] };
    const base = good ? good.mods : null;
    const changes = [];
    if (base) {
      const A = new Map(base.map(m => [m.key, m])); const B = new Map(target.map(m => [m.key, m]));
      for (const [k, m] of B) {
        const o = A.get(k);
        if (!o) { if (m.enabled) changes.push({ type: 'added', name: m.name, key: k, version: m.version }); continue; }
        if (m.enabled && !o.enabled) changes.push({ type: 'enabled', name: m.name, key: k });
        else if (m.enabled && (o.version !== m.version || (o.size && m.size && o.size !== m.size))) changes.push({ type: 'updated', name: m.name, key: k, from: o.version, to: m.version });
      }
      for (const [k, o] of A) { const m = B.get(k); if ((!m || !m.enabled) && o.enabled) changes.push({ type: 'removed', name: o.name, key: k }); }
    }
    // treść logów awarii: nazwy modów wymienione w crash logu
    let text = '';
    for (const f of (bad && bad.crashFiles) || []) { if (!/\.dmp$/i.test(f)) { try { text += fs.readFileSync(f, 'utf8').slice(0, 300000).toLowerCase() + '\n'; } catch { /* */ } } }
    const scores = new Map();
    const bump = (m, n, why) => { const k = m.key; const e = scores.get(k) || { name: m.name, key: k, score: 0, reasons: [] }; e.score += n; if (!e.reasons.includes(why)) e.reasons.push(why); scores.set(k, e); };
    for (const c of changes) { if (c.type === 'added') bump(c, 5, 'dodany od ostatniego udanego uruchomienia'); if (c.type === 'updated') bump(c, 4, `zaktualizowany${c.from || c.to ? ` (${c.from || '?'} → ${c.to || '?'})` : ''}`); if (c.type === 'enabled') bump(c, 4, 'włączony od ostatniego udanego uruchomienia'); }
    if (text) for (const m of target.filter(x => x.enabled)) { const names = [m.name, path.basename(m.key).replace(/\.(jar|dll|esp|esm|esl|zip|pak|disabled)$/g, '')].filter(n => n && n.length >= 4); if (names.some(n => text.includes(n.toLowerCase()))) bump(m, 8, 'wymieniony w logu awarii'); }
    const suspects = [...scores.values()].sort((a, b) => b.score - a.score);
    return { sessions: arr.length, bad: bad ? { start: bad.start, status: bad.status, duration: bad.duration, crashFiles: bad.crashFiles } : null, good: good ? { start: good.start, duration: good.duration } : null, changes, suspects };
  }
}

// gdzie gry zapisują raporty awarii
function crashDirsFor(game, gamePath) {
  const out = [];
  const docs = U.documentsCandidates().length ? U.documentsCandidates() : [U.documents()];
  const la = U.localAppData();
  if (gamePath) { out.push({ dir: gamePath, re: /crash|\.dmp$|hs_err/i }); for (const sub of ['logs', 'crash-reports', 'CrashDumps', 'BepInEx', 'MelonLoader', 'red4ext/logs']) out.push({ dir: path.join(gamePath, sub), re: /crash|\.dmp$|error/i }); }
  if ((game.exe || []).length) out.push({ dir: path.join(la, 'CrashDumps'), re: new RegExp('^(' + (game.exe || []).map(e => path.basename(e).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ').*\\.dmp$', 'i') });
  const MY = { skyrimse: 'Skyrim Special Edition', fallout4: 'Fallout4' };
  if (MY[game.id]) for (const d of docs) for (const se of ['SKSE', 'F4SE']) out.push({ dir: path.join(d, 'My Games', MY[game.id], se), re: /crash/i });
  return out;
}

module.exports = { LaunchHistory, crashDirsFor, SHORT_MS };
