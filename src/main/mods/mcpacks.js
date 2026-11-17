// Paczki zasobów i shadery Minecrafta: lista, włączanie (options.txt) i wybór shadera (Iris / OptiFine)
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');

function packInfo(p) {
  let meta = null;
  try {
    if (U.isDir(p)) meta = U.readJSON(path.join(p, 'pack.mcmeta'));
    else if (/\.zip$/i.test(p)) { const z = new (require('adm-zip'))(p); const e = z.getEntry('pack.mcmeta'); if (e) meta = JSON.parse(e.getData().toString('utf8').replace(/^﻿/, '')); }
  } catch { meta = null; }
  const d = meta && meta.pack && meta.pack.description;
  const desc = typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => (typeof x === 'string' ? x : x.text || '')).join('') : d && d.text ? d.text : '';
  return { format: meta && meta.pack ? meta.pack.pack_format : null, description: desc.replace(/§./g, '') };
}

function readOptions(root) { return U.readText(path.join(root, 'options.txt'), ''); }
function optList(text, key) {
  const m = text.match(new RegExp(`^${key}:(.*)$`, 'm')); if (!m) return [];
  try { return JSON.parse(m[1]); } catch { return []; }
}
function setOptList(text, key, list) {
  const line = `${key}:${JSON.stringify(list)}`;
  return new RegExp(`^${key}:.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}:.*$`, 'm'), line) : text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n';
}

function shaderState(root) {
  const iris = path.join(root, 'config', 'iris.properties');
  const of = path.join(root, 'optionsshaders.txt');
  const it = U.readText(iris), ot = U.readText(of);
  const get = (t, k) => { const m = t && t.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : null; };
  const irisMod = U.listFiles(path.join(root, 'mods')).some(f => /^iris|oculus/i.test(path.basename(f)) && /\.jar$/i.test(f));
  if (it != null || irisMod) return { engine: 'iris', file: iris, active: get(it, 'enableShaders') === 'false' ? null : get(it, 'shaderPack') };
  if (ot != null) { const a = get(ot, 'shaderPack'); return { engine: 'optifine', file: of, active: a && a !== 'OFF' ? a : null }; }
  return { engine: null, file: null, active: null };
}

function list(root) {
  const opts = readOptions(root);
  const enabled = optList(opts, 'resourcePacks');
  const rpDir = path.join(root, 'resourcepacks'); const shDir = path.join(root, 'shaderpacks');
  const packs = U.listDir(rpDir).filter(d => d.isDirectory() || /\.zip$/i.test(d.name)).map(d => {
    const p = path.join(rpDir, d.name); const key = 'file/' + d.name; const idx = enabled.indexOf(key);
    return { name: d.name, path: p, key, enabled: idx >= 0, order: idx, ...packInfo(p) };
  }).sort((a, b) => (b.enabled - a.enabled) || (b.order - a.order) || a.name.localeCompare(b.name));
  const sh = shaderState(root);
  const shaders = U.listDir(shDir).filter(d => (d.isDirectory() || /\.zip$/i.test(d.name)) && !/\.txt$/i.test(d.name)).map(d => ({ name: d.name, path: path.join(shDir, d.name), active: sh.active === d.name }));
  return { root, rpDir, shDir, optionsExists: !!opts, packs, shaders, shaderEngine: sh.engine, activeShader: sh.active };
}

function togglePack(root, name, enable) {
  const f = path.join(root, 'options.txt'); let t = readOptions(root);
  let l = optList(t, 'resourcePacks'); const key = 'file/' + name;
  if (!l.length) l = ['vanilla'];
  l = l.filter(x => x !== key);
  if (enable) l.push(key); // ostatnia pozycja ma najwyższy priorytet
  if (U.exists(f)) fs.copyFileSync(f, f + '.bak');
  t = setOptList(t, 'resourcePacks', l);
  t = setOptList(t, 'incompatibleResourcePacks', optList(t, 'incompatibleResourcePacks').filter(x => enable || x !== key));
  fs.writeFileSync(f, t);
  return l;
}
function movePack(root, name, dir) {
  const f = path.join(root, 'options.txt'); let t = readOptions(root);
  const l = optList(t, 'resourcePacks'); const key = 'file/' + name; const i = l.indexOf(key);
  const j = i + (dir > 0 ? 1 : -1);
  if (i < 0 || j < 0 || j >= l.length || l[j] === 'vanilla' || l[j] === 'fabric') return l;
  [l[i], l[j]] = [l[j], l[i]];
  fs.writeFileSync(f, setOptList(t, 'resourcePacks', l));
  return l;
}

function setShader(root, name) {
  const st = shaderState(root);
  const engine = st.engine || 'iris';
  if (engine === 'iris') {
    const f = path.join(root, 'config', 'iris.properties'); let t = U.readText(f, '');
    const set = (k, v) => { t = new RegExp(`^${k}=.*$`, 'm').test(t) ? t.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : t + (t && !t.endsWith('\n') ? '\n' : '') + `${k}=${v}\n`; };
    if (name) set('shaderPack', name);
    set('enableShaders', name ? 'true' : 'false');
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t);
  } else {
    const f = path.join(root, 'optionsshaders.txt'); let t = U.readText(f, '');
    t = /^shaderPack=.*$/m.test(t) ? t.replace(/^shaderPack=.*$/m, `shaderPack=${name || 'OFF'}`) : t + `shaderPack=${name || 'OFF'}\n`;
    fs.writeFileSync(f, t);
  }
  return { engine, active: name || null };
}

module.exports = { list, togglePack, movePack, setShader, packInfo, optList, setOptList };
