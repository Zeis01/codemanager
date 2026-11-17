// Duplikaty modów: ten sam mod w dwóch wersjach albo pod dwiema nazwami
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('../util');

// „sodium-fabric-0.5.8+mc1.20.1.jar” → „sodium”
function baseName(name) {
  let s = String(name || '').toLowerCase().replace(/\.disabled$/, '').replace(/\.(jar|zip|dll|pak|scs|esp|esm|esl|7z|rar|ws|archive|lua|cs|tmod|gma)$/, '');
  s = s.replace(/[[(][^\])]*[\])]/g, ' ');
  s = s.replace(/[-_ +.]*(mc|minecraft)?[-_ ]?\d+\.\d+(\.\d+)*[a-z0-9.+-]*/g, ' ');
  s = s.replace(/\b(fabric|forge|neoforge|quilt|bukkit|paper|spigot|universal|client|server|all|final|release|beta|alpha|v)\b/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  return s;
}
function fileHash(f) {
  try { const st = fs.statSync(f); if (!st.isFile() || st.size > 300 * 1024 * 1024) return null; return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return null; }
}
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

function find(mods) {
  const groups = []; const used = new Set();
  const add = (reason, list) => {
    const key = list.map(m => m.key || m.file || m.name).sort().join('|');
    if (list.length < 2 || used.has(key)) return;
    used.add(key);
    const items = list.map(m => ({ name: m.name, file: m.file || null, version: m.version || null, enabled: !!m.enabled, toggleable: !!m.toggleable, key: m.key, mtime: m.file ? mtime(m.file) : 0 }));
    const newest = items.slice().sort((a, b) => (U.cmpVer(b.version || '0', a.version || '0')) || (b.mtime - a.mtime))[0];
    groups.push({ reason, items, keep: newest.file || newest.name });
  };
  const by = fn => { const m = new Map(); for (const x of mods) { const k = fn(x); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  // 1. ten sam identyfikator
  for (const [k, l] of by(m => (m.id ? String(m.id).toLowerCase() : null))) if (l.length > 1 && new Set(l.map(x => x.file || x.name)).size > 1) add(`Ten sam identyfikator „${k}”`, l);
  // 2. identyczna zawartość pliku
  for (const [, l] of by(m => (m.file && U.isFile(m.file) ? fileHash(m.file) : null))) if (l.length > 1) add('Identyczne pliki pod różnymi nazwami', l);
  // 3. ta sama nazwa bez numeru wersji
  for (const [k, l] of by(m => { const b = baseName(m.file ? path.basename(m.file) : m.name); return b.length >= 3 ? b : null; })) if (l.length > 1 && new Set(l.map(x => x.version || x.file)).size > 1) add(`Ta sama nazwa „${k}” w różnych wersjach`, l);
  return groups;
}

module.exports = { find, baseName };
