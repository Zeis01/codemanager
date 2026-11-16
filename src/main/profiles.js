// Profile modów: zapamiętany zestaw włączonych modów, przełączany jednym kliknięciem
'use strict';
const path = require('path');
const U = require('./util');

const norm = m => String(m.id || path.basename(m.file || m.key || m.name)).replace(/\.(disabled|old)$/i, '').replace(/^\.+/, '').toLowerCase();

class Profiles {
  constructor(file) { this.file = file; this.data = U.readJSON(file, {}); }
  save() { U.writeJSON(this.file, this.data); }
  scope(gameId, scopeId) { const k = `${gameId}:${scopeId || 'game'}`; if (!this.data[k]) this.data[k] = { active: null, profiles: [] }; return this.data[k]; }
  list(gameId, scopeId) { return this.scope(gameId, scopeId); }
  create(gameId, scopeId, name, mods) {
    const sc = this.scope(gameId, scopeId);
    const p = { id: 'p' + Date.now().toString(36), name, enabled: mods.filter(m => m.toggleable && m.enabled).map(norm), known: mods.filter(m => m.toggleable).map(norm), createdAt: Date.now() };
    sc.profiles.push(p); sc.active = p.id; this.save(); return p;
  }
  update(gameId, scopeId, id, mods) {
    const sc = this.scope(gameId, scopeId); const p = sc.profiles.find(x => x.id === id); if (!p) throw new Error('Nie ma takiego profilu');
    p.enabled = mods.filter(m => m.toggleable && m.enabled).map(norm); p.known = mods.filter(m => m.toggleable).map(norm); p.updatedAt = Date.now(); this.save(); return p;
  }
  rename(gameId, scopeId, id, name) { const p = this.scope(gameId, scopeId).profiles.find(x => x.id === id); if (p) { p.name = name; this.save(); } return p; }
  remove(gameId, scopeId, id) { const sc = this.scope(gameId, scopeId); sc.profiles = sc.profiles.filter(x => x.id !== id); if (sc.active === id) sc.active = null; this.save(); }
  // Zwraca listę zmian do wykonania (toggle) aby dopasować stan do profilu
  plan(gameId, scopeId, id, mods) {
    const p = this.scope(gameId, scopeId).profiles.find(x => x.id === id); if (!p) throw new Error('Nie ma takiego profilu');
    const want = new Set(p.enabled);
    const changes = [];
    const missing = [...want].filter(k => !mods.some(m => norm(m) === k));
    for (const m of mods) {
      if (!m.toggleable) continue;
      const should = want.has(norm(m));
      if (should !== !!m.enabled) changes.push(m);
    }
    return { profile: p, changes, missing };
  }
  setActive(gameId, scopeId, id) { this.scope(gameId, scopeId).active = id; this.save(); }
}

module.exports = { Profiles, norm };
