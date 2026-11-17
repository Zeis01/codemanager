// Konflikty plików między modami: które mody nadpisują te same pliki i który z nich wygrywa
'use strict';
const path = require('path');
const U = require('../util');

// pliki opisowe, które każdy mod ma u siebie – nie są konfliktem
const META = /(^|\/)(readme[^/]*|changelog[^/]*|license[^/]*|licence[^/]*|credits[^/]*|manifest\.json|manifest\.sii|icon\.(png|jpg)|about\/[^/]*|info\.json|mod\.info|modinfo\.(lua|xml)|descriptor\.mod|thumbnail\.(png|jpg)|poster\.(png|jpg)|preview\.(png|jpg)|mod_description\.txt|meta\.ini|thumbs\.db|desktop\.ini|\.ds_store|[^/]*\.md)$/i;
const norm = p => String(p).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

/**
 * entries: [{ name, files: [ścieżki względne] }] w kolejności ładowania.
 * winner: 'last' (wygrywa ładowany później), 'first' (wygrywa ładowany wcześniej) lub null (nie da się ustalić).
 */
function analyze(entries, { winner = 'last' } = {}) {
  const owners = new Map();
  entries.forEach((e, i) => {
    const seen = new Set();
    for (const f of e.files || []) {
      if (META.test(f)) continue;
      const k = norm(f); if (seen.has(k)) continue; seen.add(k);
      if (!owners.has(k)) owners.set(k, { path: f.replace(/\\/g, '/'), mods: [] });
      owners.get(k).mods.push(i);
    }
  });
  const groups = new Map();
  let files = 0;
  for (const o of owners.values()) {
    if (o.mods.length < 2) continue;
    files++;
    const key = o.mods.join(',');
    if (!groups.has(key)) groups.set(key, { mods: o.mods, files: [] });
    groups.get(key).files.push(o.path);
  }
  const byMod = {};
  const touch = n => (byMod[n] = byMod[n] || { wins: 0, loses: 0 });
  const out = [];
  for (const g of groups.values()) {
    const names = g.mods.map(i => entries[i].name);
    const w = winner === 'first' ? names[0] : winner === 'last' ? names[names.length - 1] : null;
    for (const n of names) { const b = touch(n); if (w === null) continue; if (n === w) b.wins += g.files.length; else b.loses += g.files.length; }
    out.push({ mods: names, winner: w, count: g.files.length, files: g.files.sort().slice(0, 200) });
  }
  out.sort((a, b) => b.count - a.count);
  return { groups: out, files, byMod, winnerRule: winner };
}

// pliki wewnątrz archiwum (.scs, .zip)
function zipFiles(file) {
  try { const AdmZip = require('adm-zip'); return new AdmZip(file).getEntries().filter(e => !e.isDirectory).map(e => e.entryName); } catch { return []; }
}
function dirFiles(dir, strip) {
  return U.walk(dir, { maxFiles: 40000 }).map(r => (strip ? r.replace(strip, '') : r));
}

// Reguły dla gier: skąd brać pliki moda i kto wygrywa
const RULES = {
  witcher3: { winner: 'first', note: 'Wiedźmin 3 ładuje mody alfabetycznie (lub według priorytetu w mods.settings) – wygrywa mod ładowany jako pierwszy.', files: m => dirFiles(m.file).filter(r => /^content\//i.test(r)), sort: (a, b) => (pri(a) - pri(b)) || a.name.localeCompare(b.name) },
  projectzomboid: { winner: 'last', note: 'Project Zomboid: wygrywa mod ładowany później (niżej na liście modów).', files: m => dirFiles(m.file, /^(42(\.\d+)*|common)\//i).filter(r => /^media\//i.test(r)) },
  paradox: { winner: 'last', note: 'Gry Paradox: wygrywa mod ładowany później w launcherze.', files: m => dirFiles(m.file) },
  transportfever2: { winner: null, note: 'Transport Fever 2: wygrywa mod wyżej na liście w menu modów gry.', files: m => dirFiles(m.file).filter(r => /^res\//i.test(r)) },
  ets2: { winner: null, note: 'Euro Truck Simulator 2: wygrywa mod umieszczony wyżej w Menedżerze modów.', files: m => (U.isDir(m.file) ? U.listFiles(m.file, ['.scs', '.zip']).flatMap(zipFiles) : /\.(scs|zip)$/i.test(m.file) ? zipFiles(m.file) : []) },
  garrysmod: { winner: null, note: "Garry's Mod: przy wspólnych plikach wynik zależy od kolejności montowania dodatków.", files: m => (U.isDir(m.file) ? dirFiles(m.file).filter(r => /^(lua|materials|models|sound)\//i.test(r)) : []) },
};
function pri(m) { const x = String(m.version || '').match(/priorytet (\d+)/); return x ? +x[1] : 9999; }

/**
 * Konflikty w raporcie zgodności gry (mody-foldery) oraz między modami zainstalowanymi z archiwów (rejestr).
 * game: definicja gry, mods: mody z raportu, registry: wpisy z plikami (files) dla gry.
 */
function forGame(game, mods, registry = []) {
  const rule = RULES[game.checker] || RULES[game.id];
  const parts = [];
  let supported = false;
  if (rule) {
    supported = true;
    let list = mods.filter(m => m.enabled && m.file && (U.isDir(m.file) || /\.(scs|zip)$/i.test(m.file)));
    if (rule.sort) list = list.slice().sort(rule.sort);
    const entries = list.map(m => ({ name: m.name, files: rule.files(m) }));
    const r = analyze(entries, { winner: rule.winner });
    parts.push({ source: 'Mody w folderach', note: rule.note, ...r });
  }
  const reg = registry.filter(e => e.files && e.files.length).sort((a, b) => (a.installedAt || 0) - (b.installedAt || 0));
  if (reg.length) {
    supported = true;
    const r = analyze(reg.map(e => ({ name: e.name || String(e.modId), files: e.files })), { winner: 'last' });
    parts.push({ source: 'Mody zainstalowane z archiwów', note: 'Pliki zostały nadpisane przez mod zainstalowany później.', ...r });
  }
  return { supported, parts, total: parts.reduce((a, p) => a + p.files, 0) };
}

module.exports = { analyze, forGame, RULES, zipFiles, META };
