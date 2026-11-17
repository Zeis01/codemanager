// Odczyt metadanych modów/pluginów Minecraft z plików .jar
'use strict';
const AdmZip = require('adm-zip');
const TOML = require('@iarna/toml');
const YAML = require('yaml');

function safeEntryText(zip, name) {
  const e = zip.getEntry(name);
  if (!e) return null;
  try { let t = e.getData().toString('utf8'); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); return t; } catch { return null; }
}
function lenientJSON(t) {
  try { return JSON.parse(t); } catch {
    try { return JSON.parse(t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1').replace(/[\u0000-\u0019]+/g, ' ')); } catch { return null; }
  }
}
function parseManifestMF(t) {
  const out = {};
  if (!t) return out;
  for (const l of t.split(/\r?\n/)) { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) out[m[1]] = m[2]; }
  return out;
}
function tomlLenient(t) {
  try { return TOML.parse(t); } catch {
    // niektóre mods.toml mają drobne błędy składni – próba naprawy
    try { return TOML.parse(t.replace(/^\s*#.*$/gm, '').replace(/\t/g, ' ')); } catch { return null; }
  }
}

function readFromZip(zip, fileName, depth = 0) {
  const result = { file: fileName, entries: [], plugin: null, problems: [] };
  // ---- Fabric ----
  const fab = safeEntryText(zip, 'fabric.mod.json');
  if (fab) {
    const j = lenientJSON(fab);
    if (!j) result.problems.push('Uszkodzony fabric.mod.json');
    else {
      const m = {
        loader: 'fabric', id: j.id, name: j.name || j.id, version: String(j.version || '?'),
        environment: j.environment || '*', depends: j.depends || {}, recommends: j.recommends || {},
        breaks: j.breaks || {}, conflicts: j.conflicts || {}, provides: j.provides || [], nested: [],
      };
      for (const jar of j.jars || []) {
        const e = zip.getEntry(jar.file);
        if (e && depth < 3) {
          try { const sub = readFromZip(new AdmZip(e.getData()), jar.file, depth + 1); sub.entries.forEach(s => m.nested.push(s)); } catch { /* ignore */ }
        }
      }
      result.entries.push(m);
    }
  }
  // ---- Quilt ----
  const qu = safeEntryText(zip, 'quilt.mod.json');
  if (qu) {
    const j = lenientJSON(qu);
    const ql = j && j.quilt_loader;
    if (ql) {
      const deps = {}; const breaks = {};
      const conv = (arr, target) => (arr || []).forEach(d => {
        if (typeof d === 'string') target[d] = '*';
        else if (d && d.id) { if (d.optional) return; target[d.id] = d.versions || '*'; }
        else if (Array.isArray(d)) d.forEach(x => conv([x], target));
      });
      conv(ql.depends, deps); conv(ql.breaks, breaks);
      const prov = (ql.provides || []).map(p => typeof p === 'string' ? p : p.id);
      result.entries.push({
        loader: 'quilt', id: ql.id, name: (ql.metadata && ql.metadata.name) || ql.id, version: String(ql.version || '?'),
        environment: (j.minecraft && j.minecraft.environment) || '*', depends: deps, breaks, conflicts: {}, provides: prov, nested: [],
      });
    }
  }
  // ---- NeoForge / Forge (mods.toml) ----
  for (const [path, loader] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']]) {
    const t = safeEntryText(zip, path);
    if (!t) continue;
    const toml = tomlLenient(t);
    if (!toml) { result.problems.push(`Uszkodzony ${path}`); continue; }
    const mf = parseManifestMF(safeEntryText(zip, 'META-INF/MANIFEST.MF'));
    for (const mod of toml.mods || []) {
      let version = String(mod.version || '?');
      if (version.includes('${file.jarVersion}')) version = mf['Implementation-Version'] || version;
      const depsRaw = (toml.dependencies && (toml.dependencies[mod.modId] || [])) || [];
      const depends = {}; const optional = {}; const breaks = {};
      let sideOnly = null;
      for (const d of depsRaw) {
        const type = d.type ? String(d.type).toLowerCase() : (d.mandatory === false ? 'optional' : 'required');
        const id = d.modId;
        if (!id) continue;
        if (type === 'required') depends[id] = d.versionRange || '*';
        else if (type === 'incompatible') breaks[id] = d.versionRange || '*';
        else optional[id] = d.versionRange || '*';
        if ((id === 'minecraft' || id === 'forge' || id === 'neoforge') && d.side && d.side !== 'BOTH') sideOnly = d.side;
      }
      // "displayTest" = IGNORE_ALL_VERSION często oznacza mod tylko-serwer/tylko-klient
      result.entries.push({
        loader: loader === 'forge' && (depends.neoforge || optional.neoforge) ? 'neoforge' : loader,
        id: mod.modId, name: mod.displayName || mod.modId, version, environment: sideOnly ? sideOnly.toLowerCase() : '*',
        clientSideOnly: toml.clientSideOnly === true || mod.clientSideOnly === true,
        depends, optional, breaks, conflicts: {}, provides: mod.provides || [], nested: [], loaderVersion: toml.loaderVersion,
      });
    }
    // Jar-in-jar (META-INF/jarjar/metadata.json)
    const jj = lenientJSON(safeEntryText(zip, 'META-INF/jarjar/metadata.json') || 'null');
    if (jj && jj.jars && depth < 3) {
      for (const j of jj.jars) {
        const e = zip.getEntry(j.path);
        if (e) { try { const sub = readFromZip(new AdmZip(e.getData()), j.path, depth + 1); result.entries.forEach(m => sub.entries.forEach(s => m.nested.push(s))); } catch { /* */ } }
      }
    }
    break;
  }
  // ---- Stary Forge (mcmod.info, <=1.12) ----
  if (!result.entries.length) {
    const mi = safeEntryText(zip, 'mcmod.info');
    if (mi) {
      let j = lenientJSON(mi);
      if (j && j.modList) j = j.modList;
      if (Array.isArray(j)) {
        for (const m of j) {
          const deps = {};
          (m.requiredMods || m.dependencies || []).forEach(d => { const [id, ver] = String(d).split('@'); deps[id.replace(/^required-(after|before):/, '')] = ver || '*'; });
          result.entries.push({ loader: 'forge-legacy', id: m.modid, name: m.name || m.modid, version: String(m.version || '?'), mcversion: m.mcversion, environment: '*', depends: deps, breaks: {}, conflicts: {}, provides: [], nested: [] });
        }
      }
    }
  }
  // ---- Pluginy Bukkit/Spigot/Paper/Bungee/Velocity ----
  const py = safeEntryText(zip, 'paper-plugin.yml') || safeEntryText(zip, 'plugin.yml');
  if (py) {
    try {
      const y = YAML.parse(py) || {};
      const isPaper = !!safeEntryText(zip, 'paper-plugin.yml');
      let depend = [].concat(y.depend || []); let softdepend = [].concat(y.softdepend || []);
      if (isPaper && y.dependencies && y.dependencies.server) {
        for (const [k, v] of Object.entries(y.dependencies.server)) { if (v && v.required === false) softdepend.push(k); else depend.push(k); }
      }
      result.plugin = { type: isPaper ? 'paper' : 'bukkit', name: String(y.name || fileName), version: String(y.version ?? '?'), apiVersion: y['api-version'] != null ? String(y['api-version']) : null, depend, softdepend, main: y.main, folia: y['folia-supported'] === true };
    } catch { result.problems.push('Uszkodzony plugin.yml'); }
  }
  const bungee = safeEntryText(zip, 'bungee.yml');
  if (bungee && !result.plugin) { try { const y = YAML.parse(bungee); result.plugin = { type: 'bungee', name: y.name, version: String(y.version ?? '?'), depend: [].concat(y.depends || []), softdepend: [] }; } catch { /* */ } }
  const velo = safeEntryText(zip, 'velocity-plugin.json');
  if (velo && !result.plugin) { const j = lenientJSON(velo); if (j) result.plugin = { type: 'velocity', name: j.name || j.id, version: String(j.version || '?'), depend: (j.dependencies || []).filter(d => !d.optional).map(d => d.id), softdepend: [] }; }
  return result;
}

// pamięć podręczna: plik jest czytany ponownie tylko, gdy zmienił się jego rozmiar lub data modyfikacji
const jarCache = new Map();
function readJar(file) {
  let st = null; try { st = require('fs').statSync(file); } catch { /* */ }
  const key = st ? `${st.size}:${st.mtimeMs}` : null;
  const c = jarCache.get(file);
  if (c && key && c.key === key) return structuredClone(c.data);
  const data = readJarRaw(file);
  if (key) { jarCache.set(file, { key, data: structuredClone(data) }); if (jarCache.size > 5000) jarCache.delete(jarCache.keys().next().value); }
  return data;
}
function readJarRaw(file) {
  try {
    const zip = new AdmZip(file);
    return readFromZip(zip, require('path').basename(file));
  } catch (e) {
    return { file: require('path').basename(file), entries: [], plugin: null, problems: ['Plik .jar jest uszkodzony lub nie jest archiwum ZIP'] };
  }
}

module.exports = { readJar, readFromZip, lenientJSON };
