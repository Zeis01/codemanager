// Wykrywanie modów leżących w podfolderach i w folderach wskazanych przez użytkownika
// (np. ~mods/Kategoria/Mod/Mod_P.pak, Mods/Paczka/plugin.dll). Uzupełnia raport checkera
// o pliki, których checker nie pokazał.
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');

// rozszerzenia plików modów (bez .disabled)
const MOD_EXT = /\.(pak|ucas|utoc|vpk|gma|esp|esm|esl|ba2|bsa|asi|jar|dll|scs|tmod|package|big|rpf|oiv|ytd|yft|ydr|ymap|bnk|xnb|lua|cs|zip|7z|rar|mod|ini|json)$/i;
// pliki, które same z siebie nie są modem, a tylko częścią moda w folderze (pokazywane tylko luzem w folderze głównym)
const WEAK_EXT = /\.(lua|cs|ini|json|xnb|bnk)$/i;
const PAK_GROUP = /\.(pak|ucas|utoc|sig)$/i;
// gry, w których folder docelowy to folder gry (pliki gry wymieszane z modami) – tam bez głębokiego skanu
const NO_DEEP = new Set(['bethesda', 'gta5', 'cyberpunk', 'xray', 'gtasa', 'gta4', 'assetto', 'minecraft']);
const SKIP_DIRS = /^(\.git|__MACOSX|node_modules|cache|logs?|temp|tmp|config|configs|saves?|screenshots|crash-reports)$/i;

const norm = p => path.resolve(p).toLowerCase();
const strip = n => n.replace(/\.disabled$/i, '');

function covered(mods) {
  const files = new Set(); const dirs = [];
  for (const m of mods) {
    for (const f of [m.file, ...(m.files || [])].filter(Boolean)) {
      files.add(norm(strip(f))); files.add(norm(f));
      try { if (fs.statSync(f).isDirectory()) dirs.push(norm(f) + path.sep); } catch { /* grupa .pak – plik bazowy nie istnieje */ }
    }
  }
  return p => { const n = norm(p); return files.has(n) || files.has(norm(strip(p))) || dirs.some(d => n.startsWith(d)); };
}

// skanuje folder (rekurencyjnie) i zwraca znalezione mody
function scanDir(dir, { deep = true, maxDepth = 6, maxFiles = 6000, isCovered = () => false, label } = {}) {
  const out = []; let seen = 0;
  const groups = new Map();
  const walk = (d, depth) => {
    if (seen > maxFiles) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (++seen > maxFiles) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (deep && depth < maxDepth && !e.name.startsWith('.') && !SKIP_DIRS.test(e.name) && !isCovered(full)) walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      const name = strip(e.name);
      if (!MOD_EXT.test(name) || isCovered(full)) continue;
      if (WEAK_EXT.test(name) && depth > 0) continue;
      if (/\.(json|ini)$/i.test(name) && !/manifest|mod|info/i.test(name)) continue;
      const rel = path.relative(dir, d);
      if (PAK_GROUP.test(name)) {
        const base = path.join(d, name.replace(PAK_GROUP, ''));
        if (!groups.has(base)) groups.set(base, { base, rel, files: [] });
        groups.get(base).files.push(full);
        continue;
      }
      let size = 0; try { size = fs.statSync(full).size; } catch { /* */ }
      out.push({ key: full, file: full, name: name.replace(/\.[^.]+$/, ''), version: path.extname(name).slice(1), enabled: !/\.disabled$/i.test(e.name), toggleable: true, size, source: rel ? `${label || 'Folder'}: ${rel.split(path.sep).join(' / ')}` : (label || 'Folder modów'), found: 'folder' });
    }
  };
  walk(dir, 0);
  for (const g of groups.values()) {
    if (!g.files.some(f => /\.pak(\.disabled)?$/i.test(f))) continue;
    const size = g.files.reduce((a, f) => { try { return a + fs.statSync(f).size; } catch { return a; } }, 0);
    out.push({ key: g.base, file: g.base, files: g.files, name: path.basename(g.base).replace(/_P$/, ''), version: g.files.map(f => path.extname(strip(f)).slice(1)).join('+'), enabled: g.files.every(f => !/\.disabled$/i.test(f)), toggleable: true, toggle: 'group', size, source: g.rel ? `${label || 'Folder'}: ${g.rel.split(path.sep).join(' / ')}` : (label || 'Folder modów'), found: 'folder' });
  }
  return out;
}

// uzupełnia gotowy raport (rep.finish()) o mody z podfolderów i folderów użytkownika
function augment(rep, { checker, target, gamePath, settings = {} }) {
  if (!rep || !Array.isArray(rep.mods)) return rep;
  const dirs = [];
  const add = (d, label, deep) => { if (d && U.isDir(d) && !dirs.some(x => norm(x.d) === norm(d))) dirs.push({ d, label, deep }); };
  const deepOn = settings.deepScan !== false;
  if (settings.modsDir) add(settings.modsDir, 'Twój folder modów', deepOn);
  for (const d of settings.extraModDirs || []) add(d, path.basename(d), deepOn);
  // domyślny folder gry skanujemy głęboko tylko tam, gdzie nie jest to folder z plikami gry
  if (deepOn && target && !NO_DEEP.has(checker) && !(gamePath && norm(target) === norm(gamePath))) add(target, 'Podfolder', true);
  if (!dirs.length) return rep;
  const isCovered = covered(rep.mods);
  let added = 0;
  for (const { d, label, deep } of dirs) {
    // w domyślnym folderze checker zna już pliki z poziomu głównego – szukamy tylko głębiej
    const found = scanDir(d, { deep, isCovered, label }).filter(m => label !== 'Podfolder' || path.dirname(m.file) !== path.resolve(d));
    for (const m of found) { m.status = m.enabled ? 'ok' : 'disabled'; rep.mods.push(m); added++; }
  }
  if (added) {
    rep.meta = { ...(rep.meta || {}), 'Mody z podfolderów i własnych folderów': String(added) };
    rep.issues = rep.issues || [];
    rep.issues.push({ level: 'info', title: `Znaleziono ${added} ${added === 1 ? 'mod' : added < 5 ? 'mody' : 'modów'} w podfolderach lub Twoich folderach modów`, mod: null, detail: dirs.map(x => x.d).join('\n'), fix: 'Ich zgodność nie jest sprawdzana szczegółowo – są pokazane, żeby było widać, co leży w folderach, i żeby dało się je włączać i wyłączać.', files: null, action: null });
    if (rep.counts) rep.counts.info = (rep.counts.info || 0) + 1;
  }
  return rep;
}

module.exports = { augment, scanDir, MOD_EXT };
