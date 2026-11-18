// Podpowiedzi edytora dla Pythona: składowe modułów odczytywane z Pythona zainstalowanego na komputerze
// (jak w VS Code), z pamięcią podręczną. Bez Pythona edytor korzysta z wbudowanej bazy.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'pyintrospect.py'), 'utf8');

class PyIntel {
  constructor({ cacheFile, getSetting, runImpl } = {}) {
    this.cacheFile = cacheFile; this.getSetting = getSetting || (() => null); this.run = runImpl || U.run;
    this.py = undefined; // undefined = nie sprawdzano, null = brak
    this.cache = (cacheFile && U.readJSON(cacheFile, null)) || { version: null, modules: null, members: {} };
    this.pending = new Map();
  }
  async find() {
    if (this.py !== undefined) return this.py;
    const custom = this.getSetting('pythonPath');
    const cands = [custom ? [custom, []] : null, ...(U.isWin ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]])].filter(Boolean);
    for (const [cmd, pre] of cands) {
      const r = await this.run(cmd, [...pre, '-c', 'import sys;print("CMPY%d.%d" % sys.version_info[:2])'], { timeout: 8000, cwd: os.tmpdir() });
      const m = r.ok && r.stdout.match(/CMPY(\d+\.\d+)/);
      if (m) { this.py = { cmd, pre, version: m[1] }; break; }
    }
    if (this.py === undefined) this.py = null;
    if (this.py && this.cache.version !== this.py.version) this.cache = { version: this.py.version, modules: null, members: {} };
    return this.py;
  }
  save() { if (!this.cacheFile) return; clearTimeout(this.t); this.t = setTimeout(() => { try { fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache)); } catch { /* */ } }, 1500); }
  async exec(args) {
    const py = await this.find(); if (!py) return null;
    const r = await this.run(py.cmd, [...py.pre, '-c', SCRIPT, ...args], { timeout: 15000, cwd: os.tmpdir(), env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } });
    if (!r.ok && !r.stdout) return null;
    try { return JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { return null; }
  }
  async status() { const py = await this.find(); return py ? { found: true, version: py.version, cmd: py.cmd } : { found: false }; }
  async modules() {
    if (this.cache.modules) return this.cache.modules;
    const r = await this.exec(['modules']); if (!r || !r.modules) return null;
    this.cache.modules = r.modules; this.save(); return r.modules;
  }
  // składowe kilku ścieżek naraz (np. "os.path", "requests.Session")
  async members(paths) {
    const want = [...new Set((paths || []).filter(p => /^[A-Za-z_][\w.]*$/.test(p) && p.length < 120))].slice(0, 12);
    const out = {}; const missing = [];
    for (const p of want) { if (this.cache.members[p]) out[p] = this.cache.members[p]; else missing.push(p); }
    if (missing.length) {
      const key = missing.join(' ');
      if (!this.pending.has(key)) this.pending.set(key, this.exec(['members', ...missing]).finally(() => this.pending.delete(key)));
      const r = await this.pending.get(key);
      for (const p of missing) {
        const v = r && r.members && r.members[p];
        if (Array.isArray(v)) { this.cache.members[p] = v; out[p] = v; } else out[p] = null;
      }
      this.save();
    }
    return out;
  }
  clear() { this.cache = { version: this.py ? this.py.version : null, modules: null, members: {} }; this.py = undefined; this.save(); }
}

module.exports = { PyIntel, SCRIPT };
