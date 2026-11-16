// Wspólne elementy raportów zgodności
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');

class Report {
  constructor(title) {
    this.title = title; this.mods = []; this.issues = []; this.meta = {}; this.info = [];
  }
  addMod(m) {
    const mod = { key: m.key || m.file || m.name, enabled: true, toggleable: false, source: 'Folder gry', ...m };
    this.mods.push(mod); return mod;
  }
  issue(level, title, { mod, detail, fix, files, action } = {}) { this.issues.push({ level, title, mod: mod || null, detail: detail || null, fix: fix || null, files: files || null, action: action || null }); }
  error(t, o) { this.issue('error', t, o); }
  warn(t, o) { this.issue('warn', t, o); }
  note(t, o) { this.issue('info', t, o); }
  ok(t, o) { this.issue('ok', t, o); }
  finish() {
    // status modów na podstawie problemów
    for (const m of this.mods) {
      const own = this.issues.filter(i => i.mod && (i.mod === m.key || i.mod === m.name));
      m.status = own.some(i => i.level === 'error') ? 'error' : own.some(i => i.level === 'warn') ? 'warn' : m.enabled ? 'ok' : 'disabled';
    }
    const order = { error: 0, warn: 1, info: 2, ok: 3 };
    this.issues.sort((a, b) => order[a.level] - order[b.level]);
    const counts = { error: 0, warn: 0, info: 0, ok: 0 };
    this.issues.forEach(i => counts[i.level]++);
    return { title: this.title, mods: this.mods, issues: this.issues, meta: this.meta, counts, checkedAt: Date.now() };
  }
}

// Przełączanie modów: plik/folder z sufiksem ".disabled"
function toggleByRename(file) {
  if (!U.exists(file)) throw new Error('Plik nie istnieje: ' + file);
  const target = file.endsWith('.disabled') ? file.slice(0, -'.disabled'.length) : file + '.disabled';
  if (U.exists(target)) throw new Error('Plik docelowy już istnieje: ' + target);
  fs.renameSync(file, target);
  return target;
}

function stripDisabled(name) { return name.replace(/\.disabled$/i, ''); }

// Zbiera pliki o danych rozszerzeniach razem z wersjami ".disabled"
function collect(dir, exts) {
  const out = [];
  for (const d of U.listDir(dir)) {
    if (!d.isFile()) continue;
    const base = stripDisabled(d.name).toLowerCase();
    if (exts.some(e => base.endsWith(e))) out.push({ file: path.join(dir, d.name), name: d.name, enabled: !/\.disabled$/i.test(d.name) });
  }
  return out;
}

function sizeOf(p) { try { return fs.statSync(p).size; } catch { return 0; } }

module.exports = { Report, toggleByRename, stripDisabled, collect, sizeOf };
