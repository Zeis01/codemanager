// Migawki modów gry: zapis stanu folderów z modami przed zmianą i przywracanie jednym kliknięciem
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const U = require('../util');
const { runTar } = require('../servers/scheduler');

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const MAX_BYTES = 6 * 1024 ** 3;

// Foldery i pliki, które opisują stan modów danej gry
function targets(game, { root, modsDir, extra = [] }) {
  const j = (...p) => path.join(root, ...p);
  let dirs;
  switch (game.checker) {
    case 'cyberpunk': dirs = [j('archive', 'pc', 'mod'), j('bin', 'x64', 'plugins'), j('r6', 'scripts'), j('r6', 'tweaks'), j('red4ext'), j('mods')]; break;
    case 'gta5': dirs = [j('scripts'), j('mods')]; break;
    case 'xray': dirs = [j('gamedata')]; break;
    case 'bethesda': dirs = [j('Data', 'SKSE'), j('Data', 'F4SE'), j('Data', 'MCM'), j('Data', 'Scripts')]; break;
    case 'bepinex': dirs = [j('BepInEx', 'plugins'), j('BepInEx', 'config'), j('BepInEx', 'patchers')]; break;
    case 'melonloader': dirs = [j('Mods'), j('Plugins'), j('UserData')]; break;
    default: dirs = [modsDir && path.resolve(modsDir) !== path.resolve(root) ? modsDir : null].filter(Boolean);
  }
  const files = [...extra];
  // Bethesda: same pluginy (bez plików gry) zamiast całego Data
  if (game.checker === 'bethesda') for (const f of U.listFiles(j('Data')).filter(f => /\.(esp|esm|esl)$/i.test(f) && !/^(skyrim|update|dawnguard|hearthfires|dragonborn|fallout4|dlc\w+)\.esm$/i.test(path.basename(f)) && !/^cc\w+\.es[lm]$/i.test(path.basename(f)))) files.push(f);
  return { dirs: [...new Set(dirs)], files: [...new Set(files)] };
}

function sizeOf(p) {
  if (!U.exists(p)) return 0;
  if (U.isFile(p)) return fs.statSync(p).size;
  let s = 0; for (const r of U.walk(p, { maxFiles: 200000 })) { try { s += fs.statSync(path.join(p, r)).size; } catch { /* */ } } return s;
}

class Snapshots {
  constructor(root, { sizeFn } = {}) { this.root = root; this.sizeFn = sizeFn || null; }
  dir(gameId) { return path.join(this.root, U.safeName(gameId)); }
  list(gameId) {
    return U.listFiles(this.dir(gameId)).filter(f => f.endsWith('.json')).map(f => ({ ...U.readJSON(f, {}), meta: f }))
      .filter(m => m.archive && U.exists(m.archive)).sort((a, b) => b.createdAt - a.createdAt);
  }

  async create(game, ctx, { label = '', reason = 'ręczna', keep = 10, targets: custom = null, maxBytes = MAX_BYTES } = {}) {
    const t = custom || targets(game, ctx);
    const all = [...t.dirs, ...t.files];
    const size = this.sizeFn ? await this.sizeFn(all) : all.reduce((a, p) => a + sizeOf(p), 0);
    if (size > maxBytes) throw new Error(`Mody zajmują ${(size / 1024 ** 3).toFixed(1)} GB – to za dużo na migawkę${maxBytes < MAX_BYTES ? ' automatyczną (limit ' + (maxBytes / 1024 ** 3).toFixed(1) + ' GB w Ustawieniach)' : ''}. Użyj zwykłej kopii zapasowej folderu.`);
    const dir = this.dir(game.id); fs.mkdirSync(dir, { recursive: true });
    const ext = U.isWin ? 'zip' : 'tar.gz';
    const base = `${stamp(new Date())}`;
    let archive = path.join(dir, `${base}.${ext}`);
    for (let n = 2; U.exists(archive); n++) archive = path.join(dir, `${base}_${n}.${ext}`);
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-snap-'));
    const map = []; const names = new Set();
    const args = U.isWin ? ['-a', '-c', '-f', archive] : ['-czf', archive];
    try {
      all.forEach((p, i) => {
        const exists = U.exists(p);
        let entry = path.basename(p);
        if (!exists) { map.push({ path: p, entry: null, dir: t.dirs.includes(p) }); return; }
        if (names.has(entry.toLowerCase())) { // ta sama nazwa w dwóch miejscach – kopia do folderu tymczasowego
          entry = `${i}_${entry}`; U.copyRecursive(p, path.join(stage, entry)); args.push('-C', stage, entry);
        } else args.push('-C', path.dirname(p), entry);
        names.add(entry.toLowerCase());
        map.push({ path: p, entry, dir: U.isDir(p) });
      });
      // pusty zestaw – zapisz sam znacznik, żeby archiwum miało zawartość
      const marker = '.codemanager-snapshot'; fs.writeFileSync(path.join(stage, marker), new Date().toISOString()); args.push('-C', stage, marker);
      await runTar(args);
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
    const meta = { id: path.basename(archive).replace(/\.(zip|tar\.gz)$/, ''), gameId: game.id, label, reason, createdAt: Date.now(), archive, size: fs.statSync(archive).size, dataSize: size, map };
    U.writeJSON(archive.replace(/\.(zip|tar\.gz)$/, '.json'), meta);
    this.prune(game.id, keep);
    return meta;
  }

  prune(gameId, keep = 10) {
    for (const m of this.list(gameId).slice(Math.max(1, keep))) this.remove(m);
  }
  remove(m) { fs.rmSync(m.archive, { force: true }); fs.rmSync(m.meta || m.archive.replace(/\.(zip|tar\.gz)$/, '.json'), { force: true }); }
  find(gameId, id) { const m = this.list(gameId).find(x => x.id === id); if (!m) throw new Error('Nie znaleziono migawki'); return m; }

  async restore(game, ctx, id, { keep = 10 } = {}) {
    const m = this.find(game.id, id);
    // zabezpieczenie bieżącego stanu
    await this.create(game, ctx, { reason: 'przed przywróceniem', keep: keep + 1, targets: { dirs: m.map.filter(e => e.dir).map(e => e.path), files: m.map.filter(e => !e.dir).map(e => e.path) } }).catch(() => null);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-snapr-'));
    try {
      await runTar(['-xf', m.archive, '-C', tmp]);
      for (const e of m.map) {
        fs.rmSync(e.path, { recursive: true, force: true });
        if (!e.entry) continue;
        const src = path.join(tmp, e.entry);
        if (U.exists(src)) { fs.mkdirSync(path.dirname(e.path), { recursive: true }); U.copyRecursive(src, e.path); }
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return m;
  }
}

module.exports = { Snapshots, targets };
