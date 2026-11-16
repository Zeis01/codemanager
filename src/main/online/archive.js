// Inteligentna instalacja archiwów modów (Nexus, pliki lokalne) + rejestr instalacji
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const U = require('../util');
const N = require('../net');

const MARKERS = {
  stardew: ['manifest.json'], rimworld: ['About/About.xml'], projectzomboid: ['mod.info', '42/mod.info'], peopleplayground: ['mod.json'], transportfever2: ['mod.lua'],
  dst: ['modinfo.lua'], sevendays: ['ModInfo.xml'], garrysmod: ['addon.json'], sotf: ['manifest.json'],
};
const FILE_MODS = { minecraft: ['.jar'], ets2: ['.scs'], terraria: ['.tmod'], factorio: ['.zip'], garrysmod: ['.gma'] };
const ROOT_DIRS = { gta5: ['scripts', 'mods', 'plugins'], schedule1: ['Mods', 'Plugins', 'UserLibs'], sotf: ['Mods', '_RedLoader'] };

async function extract(archive, dest, log) {
  fs.mkdirSync(dest, { recursive: true });
  const low = archive.toLowerCase();
  if (low.endsWith('.zip')) { new AdmZip(archive).extractAllTo(dest, true); return; }
  if (/\.(7z|rar)$/.test(low)) {
    try { await N.extract7z(archive, dest, log); } catch (e) {
      if (low.endsWith('.rar')) throw new Error('Archiwa RAR nie są obsługiwane przez wbudowany 7-Zip. Rozpakuj ręcznie i dodaj folder przyciskiem „Dodaj mody”.');
      throw e;
    }
    return;
  }
  throw new Error('Nieobsługiwany format archiwum: ' + path.extname(archive));
}

function findMarked(dir, markers, depth = 0, out = []) {
  if (depth > 4) return out;
  if (markers.some(m => U.exists(path.join(dir, m)))) { out.push(dir); return out; }
  for (const d of U.listDirs(dir)) findMarked(d, markers, depth + 1, out);
  return out;
}
function onlyChild(dir) { const items = U.listDir(dir); return items.length === 1 && items[0].isDirectory() ? path.join(dir, items[0].name) : null; }

/**
 * game: definicja gry; target: folder modów; gameRoot: folder gry
 * Zwraca listę ścieżek, które zostały utworzone/nadpisane.
 */
async function installArchive(archive, { game, target, gameRoot, log }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-mod-'));
  try {
    await extract(archive, tmp, log);
    let root = tmp; while (onlyChild(root) && !hasMarker(root, game) && !hasRootDirs(root, game) && !U.isDir(path.join(root, 'Data')) && !U.isDir(path.join(root, 'BepInEx'))) root = onlyChild(root);
    const out = [];
    const copy = (src, dst) => { U.copyRecursive(src, dst); out.push(dst); };
    const id = game.id;
    // Bethesda: Data
    if (game.checker === 'bethesda') {
      const dataSrc = U.isDir(path.join(root, 'Data')) ? path.join(root, 'Data') : root;
      if (U.isDir(path.join(root, 'Data')) || U.listFiles(root).some(f => /\.(esp|esm|esl|ba2|bsa)$/i.test(f)) || U.listDirs(root).some(d => /^(meshes|textures|scripts|skse|f4se|interface|sound|seq|materials)$/i.test(path.basename(d)))) {
        for (const e of U.listDir(dataSrc)) copy(path.join(dataSrc, e.name), path.join(gameRoot, 'Data', e.name));
        // pliki obok Data (np. loader SKSE) trafiają do folderu gry
        if (dataSrc !== root) for (const e of U.listDir(root)) if (e.name !== 'Data') copy(path.join(root, e.name), path.join(gameRoot, e.name));
        return out;
      }
      for (const e of U.listDir(root)) copy(path.join(root, e.name), path.join(gameRoot, e.name));
      return out;
    }
    // BepInEx
    if (game.checker === 'bepinex') {
      if (U.isDir(path.join(root, 'BepInEx'))) { copy(path.join(root, 'BepInEx'), path.join(gameRoot, 'BepInEx')); return out; }
      const name = path.basename(archive).replace(/\.(zip|7z|rar)$/i, '').replace(/-\d+-[\d-]+$/, '');
      copy(root, path.join(target, name)); return out;
    }
    // foldery z plikiem-znacznikiem
    if (MARKERS[id]) {
      const found = findMarked(root, MARKERS[id]);
      if (found.length) {
        for (const f of found) copy(f, path.join(target, f === tmp ? path.basename(archive).replace(/\.\w+$/, '') : path.basename(f)));
        // RedLoader: dll obok folderu
        if (id === 'sotf') for (const f of U.walk(root, { filter: r => /\.dll$/i.test(r), maxDepth: 2 })) copy(path.join(root, f), path.join(target, path.basename(f)));
        return out;
      }
    }
    // gry, w których mod to pojedynczy plik
    if (FILE_MODS[id]) {
      const files = U.walk(root, { filter: r => FILE_MODS[id].some(e => r.toLowerCase().endsWith(e)) });
      if (files.length) { for (const f of files) copy(path.join(root, f), path.join(target, path.basename(f))); return out; }
    }
    // mody kopiowane do folderu gry
    if (ROOT_DIRS[id] && hasRootDirs(root, game)) { for (const e of U.listDir(root)) copy(path.join(root, e.name), path.join(gameRoot, e.name)); return out; }
    if (id === 'gta5' || id === 'schedule1') { for (const e of U.listDir(root)) copy(path.join(root, e.name), path.join(target, e.name)); return out; }
    // domyślnie: folder
    const base = root === tmp ? path.basename(archive).replace(/\.(zip|7z|rar)$/i, '') : path.basename(root);
    copy(root, path.join(target, base));
    return out;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function hasMarker(dir, game) { return (MARKERS[game.id] || []).some(m => U.exists(path.join(dir, m))); }
function hasRootDirs(dir, game) { return (ROOT_DIRS[game.id] || []).some(d => U.isDir(path.join(dir, d))) || U.listFiles(dir).some(f => /\.asi$/i.test(f)); }

// ---------- rejestr instalacji z Nexus ----------
class Registry {
  constructor(file) { this.file = file; this.items = U.readJSON(file, []); }
  save() { U.writeJSON(this.file, this.items); }
  add(e) { this.items = this.items.filter(x => !(x.gameId === e.gameId && x.modId === e.modId)); this.items.push({ ...e, installedAt: Date.now() }); this.save(); }
  forGame(id) { return this.items.filter(x => x.gameId === id); }
}

module.exports = { installArchive, extract, Registry };
