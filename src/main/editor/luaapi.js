// Wykrywanie, do jakiej gry należy plik Lua (profil podpowiedzi), oraz definicje czytane z plików gry (Teardown)
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');
const L = require('./luacats');

const PROFILES = ['fivem', 'redm', 'beammp', 'gmod', 'mta', 'pz', 'dst', 'factorio', 'stormworks', 'teardown'];

// szuka plików-znaczników w folderze pliku i folderach nadrzędnych
function detect(file) {
  if (!file) return { id: null };
  const p = file.replace(/\\/g, '/');
  const low = p.toLowerCase();
  let dir = path.dirname(file);
  for (let i = 0; i < 7 && dir && dir !== path.dirname(dir); i++, dir = path.dirname(dir)) {
    const fx = U.firstExisting([path.join(dir, 'fxmanifest.lua'), path.join(dir, '__resource.lua')]);
    if (fx) { const t = U.readText(fx, ''); return { id: /\bgames?\s*[({]?\s*\{?[^\n]*rdr3/.test(t) || /rdr3_warning/.test(t) ? 'redm' : 'fivem', by: path.basename(fx), root: dir }; }
    if (U.exists(path.join(dir, 'meta.xml')) && /<meta\b/i.test(U.readText(path.join(dir, 'meta.xml'), ''))) return { id: 'mta', by: 'meta.xml', root: dir };
    if (U.exists(path.join(dir, 'info.json')) && ['data.lua', 'control.lua', 'settings.lua', 'data-updates.lua'].some(f => U.exists(path.join(dir, f)))) return { id: 'factorio', by: 'info.json', root: dir };
    if (U.exists(path.join(dir, 'modinfo.lua')) && /dst_compatible|api_version/.test(U.readText(path.join(dir, 'modinfo.lua'), ''))) return { id: 'dst', by: 'modinfo.lua', root: dir };
    if (U.exists(path.join(dir, 'mod.info')) || (path.basename(dir) === 'media' && U.isDir(path.join(dir, 'lua')))) return { id: 'pz', by: 'mod.info', root: dir };
    if (U.exists(path.join(dir, 'addon.json')) || U.exists(path.join(dir, 'addon.txt'))) return { id: 'gmod', by: 'addon.json', root: dir };
    if (U.exists(path.join(dir, 'info.txt')) && /teardown/i.test(low)) return { id: 'teardown', by: 'info.txt', root: dir };
  }
  if (/\/resources\/(server|client)\//i.test(p)) return { id: 'beammp', by: 'Resources/Server' };
  if (/garrysmod\//.test(low) || /\/lua\/(autorun|entities|weapons|effects|vgui)\//.test(low)) return { id: 'gmod', by: 'ścieżka' };
  if (/mods\/deathmatch\/resources\//.test(low)) return { id: 'mta', by: 'ścieżka' };
  if (/zomboid\//.test(low) || /\/media\/lua\/(client|server|shared)\//.test(low)) return { id: 'pz', by: 'ścieżka' };
  if (/dont ?starve/.test(low)) return { id: 'dst', by: 'ścieżka' };
  if (/factorio\/(mods|scenarios)\//.test(low)) return { id: 'factorio', by: 'ścieżka' };
  if (/stormworks\//.test(low)) return { id: 'stormworks', by: 'ścieżka' };
  if (/teardown\//.test(low)) return { id: 'teardown', by: 'ścieżka' };
  if (/beamng|beammp/.test(low)) return { id: 'beammp', by: 'ścieżka' };
  if (/\/resources\/\[?/.test(low) && /fivem|txdata|cfx/.test(low)) return { id: 'fivem', by: 'ścieżka' };
  return { id: null };
}

// Teardown dołącza definicje LuaCATS do gry: data/script_defs.lua
const memo = new Map();
function localDefs(id, gamePath) {
  if (id !== 'teardown' || !gamePath) return null;
  const files = ['script_defs.lua', 'voxscript_defs.lua', 'td_vscode_plugin.lua'].map(f => path.join(gamePath, 'data', f)).filter(f => U.exists(f) && f.endsWith('defs.lua'));
  if (!files.length) return null;
  const key = files.map(f => f + ':' + fs.statSync(f).mtimeMs).join('|');
  if (memo.has(key)) return memo.get(key);
  const db = { globals: {}, tables: {}, classes: {}, vars: {}, events: {} };
  for (const f of files) L.parse(U.readText(f, ''), db);
  const res = { id, name: 'Teardown', source: 'Definicje z gry: ' + files.map(f => path.basename(f)).join(', '), ...db };
  memo.set(key, res);
  return res;
}

// wbudowane bazy (src/renderer/lua-api/<id>.json.gz) – rozpakowane w procesie głównym
const zlib = require('zlib');
const loaded = new Map();
function load(id) {
  if (!/^[a-z0-9]+$/.test(String(id))) return null;
  if (loaded.has(id)) return loaded.get(id);
  const f = path.join(__dirname, '..', '..', 'renderer', 'lua-api', id + '.json.gz');
  let db = null;
  try { db = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); } catch { db = null; }
  loaded.set(id, db);
  return db;
}

module.exports = { detect, localDefs, load, PROFILES };
