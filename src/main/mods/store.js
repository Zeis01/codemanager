// Notatki i tagi przy modach oraz kosz programu (usunięte mody przez 30 dni)
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');

const normKey = m => String(m.id || path.basename(m.file || m.key || m.name || '')).replace(/\.(disabled|old)$/i, '').replace(/^\.+/, '').toLowerCase();
const TAGS = ['wymagane na serwerze', 'tylko klient', 'testowy', 'ulubiony', 'do usunięcia'];

class Notes {
  constructor(file) { this.file = file; this.data = U.readJSON(file, {}); }
  save() { U.writeJSON(this.file, this.data); }
  forGame(gameId) { return this.data[gameId] || {}; }
  set(gameId, mod, { tags, note }) {
    const k = typeof mod === 'string' ? mod : normKey(mod);
    const g = this.data[gameId] = this.data[gameId] || {};
    const clean = { tags: [...new Set((tags || []).map(t => String(t).trim()).filter(Boolean))].slice(0, 12), note: String(note || '').slice(0, 4000) };
    const lock = !!(g[k] && g[k].lock);
    if (!clean.tags.length && !clean.note && !lock) delete g[k]; else g[k] = { ...clean, ...(lock ? { lock: true } : {}), updatedAt: Date.now() };
    this.save(); return g[k] || null;
  }
  // blokada wersji: mod pomijany przy „Aktualizuj wszystko”
  setLock(gameId, mod, lock) {
    const k = typeof mod === 'string' ? mod : normKey(mod);
    const g = this.data[gameId] = this.data[gameId] || {};
    const cur = g[k] || { tags: [], note: '' };
    if (lock) g[k] = { ...cur, lock: true, updatedAt: Date.now() };
    else { delete cur.lock; if (!(cur.tags || []).length && !cur.note) delete g[k]; else g[k] = cur; }
    this.save(); return !!lock;
  }
  locked(gameId) { return Object.entries(this.forGame(gameId)).filter(([, v]) => v.lock).map(([k]) => k); }
  withTag(gameId, tag) { return Object.entries(this.forGame(gameId)).filter(([, v]) => (v.tags || []).includes(tag)).map(([k]) => k); }
  allTags(gameId) { const s = new Set(TAGS); for (const v of Object.values(this.forGame(gameId))) (v.tags || []).forEach(t => s.add(t)); return [...s]; }
}

function move(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(src, dst); } catch (e) {
    if (e.code !== 'EXDEV' && e.code !== 'EPERM') throw e;
    U.copyRecursive(src, dst); fs.rmSync(src, { recursive: true, force: true });
  }
}

class Trash {
  constructor(dir, days = 30) { this.dir = dir; this.days = days; }
  list(gameId) {
    return U.listDirs(this.dir).map(d => U.readJSON(path.join(d, 'kosz.json'))).filter(Boolean)
      .filter(m => !gameId || m.gameId === gameId).sort((a, b) => b.deletedAt - a.deletedAt)
      .map(m => ({ ...m, expiresAt: m.deletedAt + this.days * 86400000 }));
  }
  put(p, { gameId = null, label = null } = {}) {
    if (!U.exists(p)) throw new Error('Plik nie istnieje: ' + p);
    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const isDir = U.isDir(p);
    let size = 0; try { size = isDir ? U.walk(p).reduce((a, r) => a + fs.statSync(path.join(p, r)).size, 0) : fs.statSync(p).size; } catch { /* */ }
    const box = path.join(this.dir, id);
    move(p, path.join(box, 'pliki', path.basename(p)));
    const meta = { id, original: p, name: label || path.basename(p), gameId, isDir, size, deletedAt: Date.now() };
    U.writeJSON(path.join(box, 'kosz.json'), meta);
    return meta;
  }
  restore(id) {
    const box = path.join(this.dir, id); const m = U.readJSON(path.join(box, 'kosz.json'));
    if (!m) throw new Error('Nie ma takiego elementu w koszu');
    let target = m.original;
    if (U.exists(target) || U.exists(target + '.disabled')) { const ext = path.extname(target); target = target.slice(0, target.length - ext.length) + ' (przywrócony)' + ext; }
    move(path.join(box, 'pliki', path.basename(m.original)), target);
    fs.rmSync(box, { recursive: true, force: true });
    return { ...m, restoredTo: target };
  }
  remove(id) { fs.rmSync(path.join(this.dir, id), { recursive: true, force: true }); }
  empty(gameId) { for (const m of this.list(gameId)) this.remove(m.id); }
  purge(now = Date.now()) {
    let n = 0; for (const m of this.list()) if (now - m.deletedAt > this.days * 86400000) { this.remove(m.id); n++; }
    return n;
  }
}

module.exports = { Notes, Trash, normKey, TAGS };
