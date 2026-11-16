// Modrinth API v2: wyszukiwanie, instalacja z zależnościami, aktualizacje, import .mrpack
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const U = require('../util');
const N = require('../net');

const API = 'https://api.modrinth.com/v2';
const HEADERS = { 'User-Agent': 'CodeManager/1.1 (mod manager; contact: codemanager.app)', 'Content-Type': 'application/json' };

async function req(url, opts = {}) {
  const r = await fetch(url.startsWith('http') ? url : API + url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
  if (r.status === 404) return null;
  if (r.status === 429) throw new Error('Modrinth: zbyt wiele zapytań – spróbuj za minutę.');
  if (!r.ok) throw new Error(`Modrinth: HTTP ${r.status}`);
  return r.json();
}
const sha1 = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

// Loadery akceptowane dla profilu (Quilt wczytuje mody Fabric; Paper wczytuje Spigot/Bukkit)
function loadersFor(loader) {
  switch ((loader || '').toLowerCase()) {
    case 'quilt': return ['quilt', 'fabric'];
    case 'paper': return ['paper', 'spigot', 'bukkit'];
    case 'purpur': return ['purpur', 'paper', 'spigot', 'bukkit'];
    case 'velocity': return ['velocity'];
    case 'bungeecord': return ['bungeecord', 'waterfall'];
    default: return loader ? [loader.toLowerCase()] : [];
  }
}

async function search(query, { mcVersion, loader, type = 'mod', limit = 20, offset = 0, sort = 'relevance' } = {}) {
  const facets = [];
  if (type === 'plugin') facets.push(['project_type:plugin', 'project_type:mod']); else facets.push([`project_type:${type}`]);
  const ls = loadersFor(loader);
  if (ls.length && (type === 'mod' || type === 'plugin' || type === 'modpack')) facets.push(ls.map(l => `categories:${l}`));
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  const q = new URLSearchParams({ query: query || '', limit: String(limit), offset: String(offset), index: sort, facets: JSON.stringify(facets) });
  const r = await req('/search?' + q);
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, author: h.author, downloads: h.downloads, icon: h.icon_url, updated: h.date_modified, categories: h.categories, client: h.client_side, server: h.server_side, url: `https://modrinth.com/${h.project_type}/${h.slug}` })),
  };
}

async function versions(projectId, { mcVersion, loader } = {}) {
  const q = new URLSearchParams();
  const ls = loadersFor(loader);
  if (ls.length) q.set('loaders', JSON.stringify(ls));
  if (mcVersion) q.set('game_versions', JSON.stringify([mcVersion]));
  return (await req(`/project/${encodeURIComponent(projectId)}/version?${q}`)) || [];
}
async function project(idOrSlug) { return req(`/project/${encodeURIComponent(idOrSlug)}`); }

function primaryFile(v) { return v.files.find(f => f.primary) || v.files[0]; }

// Mapa zainstalowanych plików → wersje Modrinth (po SHA1)
async function installedIndex(modsDir) {
  const files = U.listFiles(modsDir).filter(f => /\.jar(\.disabled)?$/i.test(f));
  const byHash = {}; for (const f of files) byHash[sha1(f)] = f;
  const keys = Object.keys(byHash);
  if (!keys.length) return { byHash, known: {}, projects: new Map() };
  const known = (await req('/version_files', { method: 'POST', body: JSON.stringify({ hashes: keys, algorithm: 'sha1' }) })) || {};
  const projects = new Map();
  for (const [h, v] of Object.entries(known)) projects.set(v.project_id, { file: byHash[h], version: v, hash: h });
  return { byHash, known, projects };
}

async function downloadVerified(file, dest, progress) {
  await N.download(file.url, dest, progress);
  if (file.hashes && file.hashes.sha1 && sha1(dest) !== file.hashes.sha1) { fs.rmSync(dest, { force: true }); throw new Error('Suma kontrolna pobranego pliku się nie zgadza: ' + file.filename); }
  return dest;
}

/**
 * Instaluje projekt (najnowszą zgodną wersję) wraz z wymaganymi zależnościami.
 * ctx: { modsDir, mcVersion, loader, log, progress }
 */
async function install(projectId, ctx, { versionId, _seen, _index } = {}) {
  const seen = _seen || new Set();
  if (seen.has(projectId)) return [];
  seen.add(projectId);
  const idx = _index || await installedIndex(ctx.modsDir);
  const installed = [];
  let v;
  if (versionId) v = await req(`/version/${versionId}`);
  else {
    const list = await versions(projectId, ctx);
    v = list.find(x => x.version_type === 'release') || list[0];
  }
  if (!v) throw new Error(`Brak wersji projektu ${projectId} dla ${ctx.loader || ''} ${ctx.mcVersion || ''}`.trim());
  const already = idx.projects.get(v.project_id);
  if (already && already.version.id === v.id) { ctx.log && ctx.log(`✔ ${primaryFile(v).filename} już zainstalowany`); }
  else {
    const f = primaryFile(v);
    fs.mkdirSync(ctx.modsDir, { recursive: true });
    ctx.log && ctx.log(`Pobieranie ${f.filename}…`);
    await downloadVerified(f, path.join(ctx.modsDir, f.filename), ctx.progress);
    if (already && already.file !== path.join(ctx.modsDir, f.filename)) { backupAndRemove(already.file, ctx); }
    idx.projects.set(v.project_id, { file: path.join(ctx.modsDir, f.filename), version: v });
    installed.push({ name: f.filename, version: v.version_number, project: v.project_id });
  }
  for (const d of v.dependencies || []) {
    if (d.dependency_type !== 'required' || !d.project_id) continue;
    if (idx.projects.has(d.project_id)) continue;
    ctx.log && ctx.log(`→ zależność ${d.project_id}`);
    try { installed.push(...await install(d.project_id, ctx, { versionId: d.version_id || undefined, _seen: seen, _index: idx })); }
    catch (e) { ctx.log && ctx.log('⚠ ' + e.message); }
  }
  return installed;
}

function backupAndRemove(file, ctx) {
  if (!U.exists(file)) return;
  const bdir = path.join(ctx.backupRoot || path.join(path.dirname(file), '.codemanager-old'), new Date().toISOString().slice(0, 10));
  fs.mkdirSync(bdir, { recursive: true });
  fs.renameSync(file, path.join(bdir, path.basename(file)));
  ctx.log && ctx.log(`Stara wersja przeniesiona do ${bdir}`);
}

// Aktualizacja wszystkich modów jednym przyciskiem
async function updateAll(ctx) {
  const files = U.listFiles(ctx.modsDir).filter(f => /\.jar$/i.test(f));
  const byHash = {}; for (const f of files) byHash[sha1(f)] = f;
  const keys = Object.keys(byHash);
  const result = { updated: [], upToDate: 0, unknown: [] };
  if (!keys.length) return result;
  const body = { hashes: keys, algorithm: 'sha1', loaders: loadersFor(ctx.loader), game_versions: ctx.mcVersion ? [ctx.mcVersion] : undefined };
  const ups = (await req('/version_files/update', { method: 'POST', body: JSON.stringify(body) })) || {};
  const known = (await req('/version_files', { method: 'POST', body: JSON.stringify({ hashes: keys, algorithm: 'sha1' }) })) || {};
  for (const h of keys) {
    const old = byHash[h];
    if (!known[h]) { result.unknown.push(path.basename(old)); continue; }
    const nv = ups[h];
    if (!nv || nv.id === known[h].id) { result.upToDate++; continue; }
    const f = primaryFile(nv);
    const dest = path.join(ctx.modsDir, f.filename);
    ctx.log && ctx.log(`Aktualizacja ${path.basename(old)} → ${f.filename}`);
    try {
      await downloadVerified(f, dest, ctx.progress);
      if (path.resolve(dest) !== path.resolve(old)) backupAndRemove(old, ctx);
      result.updated.push({ from: path.basename(old), to: f.filename, version: nv.version_number });
    } catch (e) { ctx.log && ctx.log('✖ ' + e.message); }
  }
  return result;
}

// Odnajdź projekt po ID moda (np. "fabric-api", "cloth-config")
async function findByModId(modId, ctx) {
  const direct = await project(modId).catch(() => null);
  if (direct) return direct.id;
  const s = await search(modId.replace(/[_-]/g, ' '), { ...ctx, limit: 5 });
  const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = s.hits.find(h => norm(h.slug) === norm(modId) || norm(h.title) === norm(modId)) || s.hits.find(h => norm(h.slug).includes(norm(modId)));
  return hit ? hit.id : null;
}

// Zamień mod na wersję dla właściwego loadera/wersji gry
async function replaceFile(file, ctx) {
  const h = sha1(file);
  const v = await req(`/version_file/${h}?algorithm=sha1`);
  if (!v) throw new Error('Tego pliku nie ma na Modrinth – poszukaj właściwej wersji ręcznie.');
  const res = await install(v.project_id, ctx);
  if (res.length) { backupAndRemove(file, ctx); }
  return res;
}

// ---------- .mrpack ----------
function readMrpack(file) {
  const zip = new AdmZip(file);
  const e = zip.getEntry('modrinth.index.json');
  if (!e) throw new Error('To nie jest paczka .mrpack (brak modrinth.index.json)');
  const idx = JSON.parse(e.getData().toString('utf8'));
  const deps = idx.dependencies || {};
  const loader = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : 'vanilla';
  const loaderVersion = deps['fabric-loader'] || deps['quilt-loader'] || deps.neoforge || deps.forge || null;
  return { zip, idx, name: idx.name, version: idx.versionId, mcVersion: deps.minecraft, loader, loaderVersion, files: idx.files || [] };
}
async function importMrpack(file, targetDir, { side = 'client', log, progress } = {}) {
  const pack = readMrpack(file);
  fs.mkdirSync(targetDir, { recursive: true });
  const list = pack.files.filter(f => !f.env || f.env[side] !== 'unsupported');
  let i = 0;
  for (const f of list) {
    i++;
    const rel = f.path.replace(/\\/g, '/');
    if (rel.includes('..') || path.isAbsolute(rel)) { log && log('⚠ Pominięto podejrzaną ścieżkę: ' + rel); continue; }
    const dest = path.join(targetDir, rel);
    log && log(`[${i}/${list.length}] ${rel}`);
    let ok = false;
    for (const url of f.downloads || []) {
      try { await downloadVerified({ url, hashes: f.hashes, filename: rel }, dest, null); ok = true; break; } catch (e) { log && log('  ⚠ ' + e.message); }
    }
    if (!ok) log && log('  ✖ Nie udało się pobrać ' + rel);
    progress && progress({ pct: Math.round(i / list.length * 90) });
  }
  const overrideDirs = ['overrides', side === 'client' ? 'client-overrides' : 'server-overrides'];
  for (const od of overrideDirs) {
    if (pack.zip.getEntries().some(e => e.entryName.startsWith(od + '/'))) { N.extractZip(file, targetDir, { subdir: od }); log && log(`Rozpakowano ${od}/`); }
  }
  progress && progress({ pct: 100 });
  return { name: pack.name, mcVersion: pack.mcVersion, loader: pack.loader, loaderVersion: pack.loaderVersion, count: list.length };
}

module.exports = { search, versions, project, install, updateAll, findByModId, replaceFile, readMrpack, importMrpack, installedIndex, loadersFor, sha1 };
