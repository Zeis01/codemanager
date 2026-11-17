// Ostrzeżenie przed instalacją: czy nowy mod będzie w konflikcie z już zainstalowanymi
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const U = require('../util');
const META = require('./conflicts').META;

// pliki archiwum, które trafią w miejsca zajęte przez inne mody (dopasowanie po końcówce ścieżki, min. 2 człony)
function overlaps(entries, registry) {
  const owners = new Map();
  for (const r of registry) for (const f of r.files || []) owners.set(f.toLowerCase().replace(/\\/g, '/'), r.name || String(r.modId));
  const hits = new Map();
  for (const raw of entries) {
    const e = raw.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
    if (!e || META.test(e)) continue;
    const parts = e.split('/');
    for (let i = 0; i <= parts.length - 2; i++) {
      const suffix = parts.slice(i).join('/');
      let found = null;
      for (const [f, owner] of owners) if (f === suffix || f.endsWith('/' + suffix)) { found = owner; break; }
      if (found) { if (!hits.has(found)) hits.set(found, []); hits.get(found).push(raw); break; }
    }
  }
  return [...hits].map(([mod, files]) => ({ mod, count: files.length, files: files.slice(0, 20) }));
}

function listArchive(file) {
  if (/\.zip$/i.test(file)) { try { return new (require('adm-zip'))(file).getEntries().filter(e => !e.isDirectory).map(e => e.entryName); } catch { return []; } }
  if (/\.7z$/i.test(file)) {
    return new Promise(res => {
      let out = '';
      let bin; try { bin = require('../net').sevenZipBin ? require('../net').sevenZipBin() : require('7zip-bin').path7za; } catch { return res([]); }
      const p = spawn(bin, ['l', '-slt', '-ba', file], { windowsHide: true });
      p.stdout.on('data', d => { out += d; }); p.on('error', () => res([]));
      p.on('close', () => { const files = []; for (const blk of out.split(/\r?\n\r?\n/)) { const pm = blk.match(/^Path = (.+)$/m); const dir = /^Folder = \+$/m.test(blk) || /^Attributes = D/m.test(blk); if (pm && !dir) files.push(pm[1].trim()); } res(files); });
    });
  }
  return [];
}

function flattenPreview(node, base = '') {
  const out = [];
  for (const c of (node && node.children) || []) {
    const p = c.path || (base ? base + '/' + c.name : c.name);
    if (c.type === 'directory') out.push(...flattenPreview(c, p)); else out.push(p);
  }
  return out;
}

/**
 * Modrinth: deklarowane niezgodności (w obie strony) i zastąpienie istniejącej wersji.
 * mr: moduł online/modrinth (wstrzykiwany – testy podstawiają atrapę)
 */
async function modrinth(projectId, ctx, mr) {
  const list = await mr.versions(projectId, ctx);
  const v = list.find(x => x.version_type === 'release') || list[0];
  if (!v) return { warnings: [{ level: 'error', text: `Brak wersji dla ${ctx.loader || 'tego loadera'} ${ctx.mcVersion || ''}`.trim() }] };
  const idx = await mr.installedIndex(ctx.modsDir);
  const warnings = [];
  const ids = new Set();
  const incompatible = (v.dependencies || []).filter(d => d.dependency_type === 'incompatible' && d.project_id && idx.projects.has(d.project_id));
  incompatible.forEach(d => ids.add(d.project_id));
  const reverse = [];
  for (const [pid, it] of idx.projects) if ((it.version.dependencies || []).some(d => d.dependency_type === 'incompatible' && d.project_id === v.project_id)) { reverse.push(pid); ids.add(pid); }
  const names = {};
  if (ids.size && mr.projectsInfo) { try { for (const p of await mr.projectsInfo([...ids])) names[p.id] = p.title; } catch { /* */ } }
  const nm = pid => names[pid] || path.basename((idx.projects.get(pid) || {}).file || pid);
  for (const d of incompatible) warnings.push({ level: 'error', text: `Nowy mod deklaruje niezgodność z zainstalowanym „${nm(d.project_id)}”.` });
  for (const pid of reverse) warnings.push({ level: 'error', text: `Zainstalowany „${nm(pid)}” deklaruje niezgodność z tym modem.` });
  const cur = idx.projects.get(v.project_id);
  if (cur && cur.version.id !== v.id) warnings.push({ level: 'info', text: `Zastąpi zainstalowaną wersję ${cur.version.version_number} (${path.basename(cur.file)}) wersją ${v.version_number}.` });
  return { version: v.version_number, warnings };
}

module.exports = { overlaps, listArchive, flattenPreview, modrinth };
