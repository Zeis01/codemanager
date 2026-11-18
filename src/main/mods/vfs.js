// Wirtualny folder modów (jak Vortex / MO2): mody leżą w magazynie CodeManagera,
// a do folderu gry trafiają jako dowiązania (hardlink → symlink → kopia).
// Wyłączenie moda usuwa tylko dowiązania; nadpisane pliki gry są odkładane i przywracane.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('../util');

const ROOTS = { root: '__root', mods: '__mods' }; // pliki względem folderu gry / folderu modów

class Vfs {
  constructor(base) { this.base = base; }
  dir(gameId) { return path.join(this.base, gameId); }
  stateFile(gameId) { return path.join(this.dir(gameId), 'vfs.json'); }
  load(gameId) { return U.readJSON(this.stateFile(gameId), null) || { enabled: false, mods: [], deployed: {} }; }
  save(gameId, st) { fs.mkdirSync(this.dir(gameId), { recursive: true }); fs.writeFileSync(this.stateFile(gameId), JSON.stringify(st, null, 1)); }
  enabled(gameId) { return !!this.load(gameId).enabled; }
  setEnabled(gameId, on) { const st = this.load(gameId); st.enabled = !!on; this.save(gameId, st); return st.enabled; }
  modDir(gameId, id) { return path.join(this.dir(gameId), 'mods', id); }
  newId(name) { return (U.safeName(name).replace(/\s+/g, '_').slice(0, 40) || 'mod') + '-' + crypto.randomBytes(3).toString('hex'); }

  // pliki moda: [{ rel, kind: 'root'|'mods', src }]
  files(gameId, id) {
    const out = [];
    for (const [kind, sub] of Object.entries(ROOTS)) {
      const d = path.join(this.modDir(gameId, id), sub);
      for (const rel of U.walk(d, { maxFiles: 200000, maxDepth: 30 })) out.push({ rel, kind, src: path.join(d, rel) });
    }
    return out;
  }
  // dodaje mod z gotowej instalacji w folderze tymczasowym (installArchive z gameRoot/target w magazynie)
  async addFromInstaller(gameId, name, installer, meta = {}) {
    const st = this.load(gameId);
    const id = this.newId(name);
    const md = this.modDir(gameId, id);
    fs.mkdirSync(path.join(md, ROOTS.root), { recursive: true }); fs.mkdirSync(path.join(md, ROOTS.mods), { recursive: true });
    try { await installer({ gameRoot: path.join(md, ROOTS.root), target: path.join(md, ROOTS.mods) }); } catch (e) { fs.rmSync(md, { recursive: true, force: true }); throw e; }
    st.mods.push({ id, name, enabled: true, added: Date.now(), ...meta });
    this.save(gameId, st);
    return id;
  }
  // przenosi istniejący plik/folder moda do magazynu
  adopt(gameId, absPath, { gameRoot, modsDir, name } = {}) {
    const p = path.resolve(absPath);
    const under = (base) => base && (p === path.resolve(base) || p.startsWith(path.resolve(base) + path.sep));
    let kind, rel;
    if (under(modsDir) && path.resolve(modsDir) !== p) { kind = 'mods'; rel = path.relative(modsDir, p); } else if (under(gameRoot)) { kind = 'root'; rel = path.relative(gameRoot, p); } else throw new Error('Ten plik nie leży w folderze gry ani w folderze modów.');
    const st = this.load(gameId);
    const id = this.newId(name || path.basename(p).replace(/\.disabled$/i, ''));
    const dest = path.join(this.modDir(gameId, id), ROOTS[kind], rel.replace(/\.disabled$/i, ''));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.renameSync(p, dest); } catch { U.copyRecursive(p, dest); fs.rmSync(p, { recursive: true, force: true }); }
    st.mods.push({ id, name: name || path.basename(dest), enabled: !/\.disabled$/i.test(p), added: Date.now(), adopted: true });
    this.save(gameId, st);
    return id;
  }
  list(gameId) {
    const st = this.load(gameId);
    const map = this.plan(gameId, st);
    return st.mods.map((m, i) => {
      const files = this.files(gameId, m.id);
      const lost = files.filter(f => { const w = map.get(f.kind + ':' + f.rel.toLowerCase()); return m.enabled && w && w.id !== m.id; });
      const wins = files.filter(f => { const w = map.get(f.kind + ':' + f.rel.toLowerCase()); return m.enabled && w && w.id === m.id && w.over.length; });
      return { ...m, order: i, files: files.length, size: files.reduce((a, f) => a + (fs.statSync(f.src).size || 0), 0), overwrittenBy: [...new Set(lost.map(f => map.get(f.kind + ':' + f.rel.toLowerCase()).name))], overwrites: [...new Set(wins.flatMap(f => map.get(f.kind + ':' + f.rel.toLowerCase()).over))] };
    });
  }
  // docelowy układ: klucz → mod, który wygrywa (późniejszy na liście ma wyższy priorytet)
  plan(gameId, st = this.load(gameId)) {
    const map = new Map();
    for (const m of st.mods) {
      if (!m.enabled) continue;
      for (const f of this.files(gameId, m.id)) {
        const k = f.kind + ':' + f.rel.toLowerCase();
        const prev = map.get(k);
        map.set(k, { id: m.id, name: m.name, src: f.src, rel: f.rel, kind: f.kind, over: prev ? [...prev.over, prev.name] : [] });
      }
    }
    return map;
  }
  setMod(gameId, id, patch) { const st = this.load(gameId); const m = st.mods.find(x => x.id === id); if (!m) throw new Error('Nie ma takiego moda w magazynie.'); Object.assign(m, patch); this.save(gameId, st); return m; }
  order(gameId, ids) { const st = this.load(gameId); const pos = new Map(ids.map((id, i) => [id, i])); st.mods.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9)); this.save(gameId, st); }
  remove(gameId, id, ctx) { const st = this.load(gameId); st.mods = st.mods.filter(m => m.id !== id); this.save(gameId, st); const r = ctx ? this.deploy(gameId, ctx) : null; fs.rmSync(this.modDir(gameId, id), { recursive: true, force: true }); return r; }

  // wdrożenie: tworzy brakujące dowiązania, usuwa niepotrzebne, przywraca oryginalne pliki gry
  deploy(gameId, { gameRoot, modsDir }, log = () => {}) {
    const st = this.load(gameId);
    const want = this.plan(gameId, st);
    const destOf = w => path.join(w.kind === 'root' ? gameRoot : modsDir, w.rel);
    const dep = st.deployed || {};
    const backupDir = path.join(this.dir(gameId), 'backup');
    let added = 0, removed = 0, restored = 0; const methods = { hardlink: 0, symlink: 0, copy: 0 };
    const wantByDest = new Map(); for (const w of want.values()) wantByDest.set(path.resolve(destOf(w)).toLowerCase(), w);
    // 1) usuń dowiązania, które nie są już potrzebne albo wskazują inne źródło
    for (const [key, d] of Object.entries(dep)) {
      const w = wantByDest.get(key);
      if (w && w.src === d.src && this.isOurs(d)) continue;
      if (this.isOurs(d)) { try { fs.rmSync(d.dest, { force: true }); removed++; } catch { /* */ } }
      if (d.backup && U.exists(d.backup) && !U.exists(d.dest)) { fs.mkdirSync(path.dirname(d.dest), { recursive: true }); fs.renameSync(d.backup, d.dest); restored++; }
      delete dep[key];
      pruneEmpty(path.dirname(d.dest), [gameRoot, modsDir]);
    }
    // 2) utwórz nowe
    for (const [key, w] of wantByDest) {
      if (dep[key]) continue;
      const dest = destOf(w);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let backup = null;
      if (U.exists(dest)) { backup = path.join(backupDir, w.kind, w.rel); fs.mkdirSync(path.dirname(backup), { recursive: true }); if (U.exists(backup)) fs.rmSync(backup, { force: true }); fs.renameSync(dest, backup); }
      const method = linkFile(w.src, dest);
      methods[method]++; added++;
      const s = fs.statSync(dest);
      dep[key] = { dest, src: w.src, method, ino: s.ino, size: s.size, mtime: s.mtimeMs, backup };
    }
    st.deployed = dep; this.save(gameId, st);
    if (added || removed) log(`Wdrożono: +${added} / −${removed} plików${restored ? `, przywrócono ${restored} oryginalnych` : ''}.`);
    return { added, removed, restored, methods, total: Object.keys(dep).length };
  }
  isOurs(d) {
    try {
      const s = fs.lstatSync(d.dest);
      if (d.method === 'symlink') return s.isSymbolicLink() && path.resolve(fs.readlinkSync(d.dest)) === path.resolve(d.src);
      if (d.method === 'hardlink') return s.ino === fs.statSync(d.src).ino;
      return s.size === d.size && Math.abs(s.mtimeMs - d.mtime) < 2000;
    } catch { return false; }
  }
  undeploy(gameId, roots) { const st = this.load(gameId); const was = st.mods.map(m => m.enabled); st.mods.forEach(m => { m.enabled = false; }); this.save(gameId, st); const r = this.deploy(gameId, roots); const st2 = this.load(gameId); st2.mods.forEach((m, i) => { m.enabled = was[i]; }); this.save(gameId, st2); return r; }
  // pliki w folderze gry zmienione poza CodeManagerem (np. gra nadpisała kopię)
  verify(gameId) { const st = this.load(gameId); return Object.values(st.deployed || {}).filter(d => !this.isOurs(d)).map(d => d.dest); }
}

function linkFile(src, dest) {
  try { fs.linkSync(src, dest); return 'hardlink'; } catch { /* inny dysk albo brak uprawnień */ }
  try { fs.symlinkSync(src, dest, 'file'); return 'symlink'; } catch { /* Windows bez trybu dewelopera */ }
  fs.copyFileSync(src, dest); const t = fs.statSync(src).mtime; fs.utimesSync(dest, t, t); return 'copy';
}
function pruneEmpty(dir, stops) {
  const stop = new Set(stops.filter(Boolean).map(s => path.resolve(s)));
  for (let d = path.resolve(dir); d && !stop.has(d) && d !== path.dirname(d); d = path.dirname(d)) {
    try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
  }
}

module.exports = { Vfs, linkFile };
