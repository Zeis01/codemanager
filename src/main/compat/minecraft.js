// Zgodność modów i pluginów Minecraft (klient i serwer)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('../util');
const { readJar } = require('../parsers/minecraft');
const { matchSemverRange, matchMavenRange, describeRange } = require('../parsers/versions');
const { Report, collect } = require('./common');

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', 'forge-legacy': 'Forge (stary)', vanilla: 'Vanilla', paper: 'Paper', spigot: 'Spigot', purpur: 'Purpur' };
const PLATFORM_IDS = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'forge', 'neoforge', 'fml', 'javafml', 'mixinextras']);

function requiredJava(mc) {
  if (!mc) return null;
  if (U.cmpVer(mc, '1.20.5') >= 0) return 21;
  if (U.cmpVer(mc, '1.18') >= 0) return 17;
  if (U.cmpVer(mc, '1.17') >= 0) return 16;
  return 8;
}

function matchRange(loader, range, version) {
  if (version == null || range == null) return true;
  return (loader === 'forge' || loader === 'neoforge' || loader === 'forge-legacy') ? matchMavenRange(range, version) : matchSemverRange(range, version);
}

function pickEntry(entries, loader) {
  if (!entries.length) return null;
  const pref = {
    fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge', 'forge-legacy'], neoforge: ['neoforge', 'forge'],
  }[loader] || [];
  for (const l of pref) { const e = entries.find(x => x.loader === l); if (e) return e; }
  return entries[0];
}

function loaderCompatible(modLoader, profileLoader, mc, installedIds) {
  if (modLoader === profileLoader) return { ok: true };
  if (profileLoader === 'quilt' && modLoader === 'fabric') return { ok: true, note: 'Mod Fabric na Quilt – zwykle działa dzięki warstwie zgodności Quilt.' };
  if (profileLoader === 'neoforge' && modLoader === 'forge' && mc && U.cmpVer(mc, '1.20.1') <= 0) return { ok: true, note: 'NeoForge dla 1.20.1 wczytuje mody Forge.' };
  if ((profileLoader === 'forge' || profileLoader === 'neoforge') && modLoader === 'fabric' && installedIds.has('connector')) return { ok: true, warn: 'Mod Fabric uruchamiany przez Sinytra Connector – może działać niestabilnie.' };
  if (modLoader === 'forge-legacy' && profileLoader === 'forge') return { ok: true };
  return { ok: false };
}

/**
 * ctx: { modsDir, mcVersion, loader, loaderVersion, side: 'client'|'server', title }
 */
function checkMods(ctx) {
  const rep = new Report(ctx.title || 'Minecraft');
  const loader = (ctx.loader || '').toLowerCase() || null;
  const mc = ctx.mcVersion || null;
  rep.meta = { 'Wersja gry': mc || 'nieznana', 'Loader': loader ? (LOADER_NAMES[loader] || loader) + (ctx.loaderVersion ? ' ' + ctx.loaderVersion : '') : 'nieznany', 'Folder modów': ctx.modsDir };
  if (mc) rep.meta['Wymagana Java'] = requiredJava(mc) + '+';
  if (!U.isDir(ctx.modsDir)) {
    rep.warn('Folder "mods" nie istnieje', { detail: ctx.modsDir, fix: 'Utwórz folder lub zainstaluj loader modów (zakładka Modloader).' });
    return rep.finish();
  }
  if (!mc) rep.warn('Nie znam wersji Minecrafta dla tego profilu', { fix: 'Ustaw wersję gry i loader w ustawieniach profilu – inaczej sprawdzanie wersji zostanie pominięte.' });
  if (!loader || loader === 'vanilla') rep.warn('Profil nie ma loadera modów (vanilla)', { fix: 'Zainstaluj Fabric, Quilt, Forge lub NeoForge, albo popraw loader w ustawieniach profilu.' });

  const files = collect(ctx.modsDir, ['.jar']);
  const parsed = files.map(f => ({ ...f, data: readJar(f.file) }));
  // indeks dostępnych ID
  const index = new Map(); // id -> [{version, file, enabled}]
  const addId = (id, version, file, enabled) => { if (!id) return; const k = String(id).toLowerCase(); if (!index.has(k)) index.set(k, []); index.get(k).push({ version, file, enabled }); };
  const chosen = new Map();
  for (const p of parsed) {
    const e = pickEntry(p.data.entries, loader);
    chosen.set(p.file, e);
    if (!e) continue;
    addId(e.id, e.version, p.name, p.enabled);
    (e.provides || []).forEach(pid => addId(pid, e.version, p.name, p.enabled));
    for (const n of e.nested || []) { addId(n.id, n.version, p.name + ' → ' + n.id, p.enabled); (n.provides || []).forEach(pid => addId(pid, n.version, p.name, p.enabled)); }
  }
  // fabric-api "fabric" alias
  if (index.has('fabric-api') && !index.has('fabric')) index.set('fabric', index.get('fabric-api'));
  if (index.has('quilted_fabric_api')) { if (!index.has('fabric-api')) index.set('fabric-api', index.get('quilted_fabric_api')); if (!index.has('fabric')) index.set('fabric', index.get('quilted_fabric_api')); }
  const installedIds = new Set([...index.keys()].filter(k => index.get(k).some(x => x.enabled)));

  const platformVersion = id => {
    switch (id) {
      case 'minecraft': return mc;
      case 'fabricloader': case 'fabric-loader': return (loader === 'fabric' || loader === 'quilt') ? (ctx.loaderVersion || null) : undefined;
      case 'quilt_loader': return loader === 'quilt' ? (ctx.loaderVersion || null) : undefined;
      case 'forge': return loader === 'forge' ? (ctx.loaderVersion || null) : undefined;
      case 'neoforge': return loader === 'neoforge' ? (ctx.loaderVersion || null) : undefined;
      case 'java': return null;
      default: return undefined;
    }
  };

  for (const p of parsed) {
    const e = chosen.get(p.file);
    const d = p.data;
    const mod = rep.addMod({
      key: p.name, file: p.file, name: e ? e.name : (d.plugin ? d.plugin.name : p.name.replace(/\.jar(\.disabled)?$/i, '')),
      version: e ? e.version : d.plugin ? d.plugin.version : '?', enabled: p.enabled, toggleable: true,
      loader: e ? (LOADER_NAMES[e.loader] || e.loader) : d.plugin ? 'Plugin ' + d.plugin.type : '?', id: e && e.id, size: fs.statSync(p.file).size,
    });
    d.problems.forEach(pr => rep.error(pr, { mod: mod.key }));
    if (!p.enabled) continue;
    if (!e) {
      if (d.plugin) rep.error(`${mod.name} to plugin serwera (${d.plugin.type}), a nie mod`, { mod: mod.key, fix: 'Pluginy działają tylko na serwerach Paper/Spigot/Purpur. Usuń go z folderu mods.' });
      else if (!d.problems.length) rep.warn(`Nie rozpoznano typu moda ${p.name}`, { mod: mod.key, detail: 'Brak fabric.mod.json, quilt.mod.json, mods.toml i mcmod.info. Może to być biblioteka lub mod dla innej platformy.' });
      continue;
    }
    // loader
    if (loader && loader !== 'vanilla') {
      const lc = loaderCompatible(e.loader, loader, mc, installedIds);
      if (!lc.ok) {
        const others = d.entries.map(x => LOADER_NAMES[x.loader] || x.loader).join(', ');
        rep.error(`${mod.name} jest dla ${others}, a profil używa ${LOADER_NAMES[loader] || loader}`, { mod: mod.key, fix: `Pobierz wersję moda dla ${LOADER_NAMES[loader] || loader}.`, action: { type: 'modrinth-replace', file: p.file, label: 'Pobierz właściwą wersję' } });
        continue;
      }
      if (lc.note) rep.note(lc.note, { mod: mod.key });
      if (lc.warn) rep.warn(lc.warn, { mod: mod.key });
    }
    // strona (klient/serwer)
    const env = String(e.environment || '*').toLowerCase();
    if (ctx.side === 'server' && (env === 'client' || e.clientSideOnly)) rep.error(`${mod.name} działa tylko po stronie klienta`, { mod: mod.key, fix: 'Usuń ten mod z serwera – może powodować awarię przy starcie.' });
    if (ctx.side === 'client' && env === 'server') rep.warn(`${mod.name} jest przeznaczony tylko dla serwera`, { mod: mod.key });
    // stary Forge – mcversion
    if (e.mcversion && mc && !String(e.mcversion).split(/[,\s]+/).some(v => v === mc || matchMavenRange(v, mc))) rep.error(`${mod.name} jest dla Minecraft ${e.mcversion}, profil: ${mc}`, { mod: mod.key });
    // zależności
    for (const [depIdRaw, range] of Object.entries(e.depends || {})) {
      const depId = depIdRaw.toLowerCase();
      const pv = platformVersion(depId);
      if (pv !== undefined) {
        if (pv && !matchRange(e.loader, range, pv)) {
          const what = depId === 'minecraft' ? 'Minecraft' : depId;
          rep.error(`${mod.name} wymaga ${what} ${describeRange(range)} (masz ${pv})`, { mod: mod.key, fix: depId === 'minecraft' ? 'Pobierz wersję moda dla Twojej wersji gry.' : 'Zaktualizuj loader modów.', action: depId === 'minecraft' ? { type: 'modrinth-replace', file: p.file, label: 'Pobierz wersję dla mojej gry' } : null });
        }
        continue;
      }
      if (PLATFORM_IDS.has(depId)) continue;
      const avail = (index.get(depId) || []).filter(x => x.enabled);
      if (!avail.length) {
        const disabled = (index.get(depId) || []).length > 0;
        rep.error(`${mod.name} wymaga moda "${depIdRaw}" ${range && range !== '*' ? '(' + describeRange(range) + ')' : ''}`, { mod: mod.key, fix: disabled ? 'Ten mod jest wyłączony – włącz go.' : 'Zainstaluj brakujący mod.', action: disabled ? null : { type: 'modrinth-dep', modId: depIdRaw, label: `Zainstaluj ${depIdRaw}` } });
      } else if (!avail.some(x => matchRange(e.loader, range, x.version))) {
        rep.error(`${mod.name} wymaga ${depIdRaw} ${describeRange(range)}, zainstalowano ${avail.map(a => a.version).join(', ')}`, { mod: mod.key, fix: `Zaktualizuj lub zmień wersję ${depIdRaw}.`, action: { type: 'modrinth-dep', modId: depIdRaw, label: `Zaktualizuj ${depIdRaw}` } });
      }
    }
    for (const [depId, range] of Object.entries(e.recommends || {})) {
      if (!installedIds.has(depId.toLowerCase()) && !PLATFORM_IDS.has(depId)) rep.note(`${mod.name} zaleca mod "${depId}"`, { mod: mod.key });
    }
    for (const [kind, map] of [['breaks', e.breaks], ['conflicts', e.conflicts]]) {
      for (const [bid, range] of Object.entries(map || {})) {
        const avail = (index.get(bid.toLowerCase()) || []).filter(x => x.enabled && x.file !== p.name);
        const hit = avail.filter(x => matchRange(e.loader, range, x.version));
        if (hit.length) {
          if (kind === 'breaks') rep.error(`${mod.name} jest niezgodny z ${bid} ${range !== '*' ? describeRange(range) : ''}`, { mod: mod.key, files: hit.map(h => h.file), fix: 'Usuń lub wyłącz jeden z tych modów.' });
          else rep.warn(`${mod.name} może konfliktować z ${bid}`, { mod: mod.key, files: hit.map(h => h.file) });
        }
      }
    }
  }
  // duplikaty
  for (const p of parsed) {
    if (!p.enabled) continue;
    const e = chosen.get(p.file); if (!e || !e.id) continue;
    const same = parsed.filter(o => o.enabled && o !== p && chosen.get(o.file) && chosen.get(o.file).id === e.id);
    if (same.length && parsed.indexOf(p) < parsed.indexOf(same[0])) {
      const all = [p, ...same].sort((a, b) => U.cmpVer(chosen.get(a.file).version, chosen.get(b.file).version));
      rep.error(`Zduplikowany mod "${e.id}"`, { mod: p.name, files: [p.name, ...same.map(s => s.name)], fix: 'Zostaw tylko jedną (najnowszą) wersję.', action: { type: 'disable', files: all.slice(0, -1).map(x => x.file), label: 'Wyłącz starsze kopie' } });
      same.forEach(s => rep.error(`Zduplikowany mod "${e.id}"`, { mod: s.name }));
    }
  }
  // Fabric bez Fabric API – częsty błąd
  const needsFapi = parsed.some(p => p.enabled && chosen.get(p.file) && Object.keys(chosen.get(p.file).depends || {}).some(k => k === 'fabric-api' || k === 'fabric'));
  if (needsFapi && !installedIds.has('fabric-api') && !installedIds.has('fabric')) rep.error('Brak Fabric API, którego wymagają niektóre mody', { fix: 'Pobierz Fabric API dla swojej wersji gry (Modrinth / CurseForge).', action: { type: 'modrinth-dep', modId: 'fabric-api', label: 'Zainstaluj Fabric API' } });
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok(`Nie wykryto problemów w ${parsed.filter(p => p.enabled).length} modach`);
  return rep.finish();
}

// Pluginy Paper/Spigot/Purpur
function checkPlugins(ctx) {
  const rep = new Report(ctx.title || 'Pluginy Minecraft');
  const dir = ctx.pluginsDir;
  rep.meta = { 'Silnik': LOADER_NAMES[ctx.loader] || ctx.loader, 'Wersja serwera': ctx.mcVersion || '?', 'Folder pluginów': dir };
  if (!U.isDir(dir)) { rep.note('Folder plugins jeszcze nie istnieje (powstanie po pierwszym uruchomieniu).'); return rep.finish(); }
  const files = collect(dir, ['.jar']);
  const parsed = files.map(f => ({ ...f, data: readJar(f.file) }));
  const names = new Map();
  parsed.forEach(p => { if (p.enabled && p.data.plugin) { const k = p.data.plugin.name.toLowerCase(); names.set(k, [...(names.get(k) || []), p.name]); } });
  const mcMinor = ctx.mcVersion ? ctx.mcVersion.split('.').slice(0, 2).join('.') : null;
  for (const p of parsed) {
    const pl = p.data.plugin;
    const mod = rep.addMod({ key: p.name, file: p.file, name: pl ? pl.name : p.name, version: pl ? pl.version : '?', enabled: p.enabled, toggleable: true, loader: pl ? pl.type : '?' });
    if (!p.enabled) continue;
    p.data.problems.forEach(x => rep.error(x, { mod: mod.key }));
    if (!pl) {
      if (p.data.entries.length) rep.error(`${p.name} to mod (${p.data.entries[0].loader}), a nie plugin`, { mod: mod.key, fix: 'Mody wymagają serwera Fabric/Forge/NeoForge, nie Paper.' });
      else rep.warn(`${p.name} nie zawiera plugin.yml`, { mod: mod.key, detail: 'Może to być biblioteka lub plik dla innej platformy.' });
      continue;
    }
    if (pl.type === 'bungee' || pl.type === 'velocity') { rep.error(`${pl.name} jest pluginem proxy (${pl.type}), nie serwera`, { mod: mod.key }); continue; }
    if (pl.apiVersion && mcMinor && U.cmpVer(pl.apiVersion, mcMinor) > 0) rep.error(`${pl.name} wymaga API ${pl.apiVersion}, serwer to ${ctx.mcVersion}`, { mod: mod.key, fix: 'Zaktualizuj serwer lub pobierz starszą wersję pluginu.' });
    if (!pl.apiVersion && mcMinor && U.cmpVer(mcMinor, '1.13') >= 0) rep.note(`${pl.name} nie deklaruje api-version (tryb zgodności legacy)`, { mod: mod.key });
    if (pl.type === 'paper' && ctx.loader === 'spigot') rep.error(`${pl.name} to paper-plugin – nie działa na Spigot`, { mod: mod.key });
    for (const d of pl.depend) if (!names.has(String(d).toLowerCase())) rep.error(`${pl.name} wymaga pluginu "${d}"`, { mod: mod.key, fix: 'Zainstaluj brakujący plugin.', action: { type: 'modrinth-dep', modId: d, plugin: true, label: `Szukaj ${d} na Modrinth` } });
    for (const d of pl.softdepend) if (!names.has(String(d).toLowerCase())) rep.note(`${pl.name} może korzystać z "${d}" (opcjonalnie)`, { mod: mod.key });
    const dup = names.get(pl.name.toLowerCase()) || [];
    if (dup.length > 1 && dup[0] === p.name) rep.error(`Zduplikowany plugin "${pl.name}"`, { mod: mod.key, files: dup, fix: 'Usuń starsze kopie.' });
  }
  // ostatni log – błędy ładowania
  const log = U.readText(path.join(path.dirname(dir), 'logs', 'latest.log'), '');
  const errs = [...log.matchAll(/(?:Could not load|Error occurred while enabling|Ambiguous plugin name|UnknownDependencyException)[^\n]*/g)].slice(0, 15);
  errs.forEach(m => rep.warn('Log serwera: ' + m[0].slice(0, 220)));
  if (!rep.issues.some(i => i.level === 'error' || i.level === 'warn')) rep.ok('Pluginy wyglądają na zgodne');
  return rep.finish();
}

// ---------- Modrinth (online) ----------
async function modrinthCheck(ctx) {
  const files = collect(ctx.modsDir, ['.jar']).filter(f => f.enabled);
  const hashes = {};
  for (const f of files) hashes[crypto.createHash('sha1').update(fs.readFileSync(f.file)).digest('hex')] = f.name;
  const keys = Object.keys(hashes);
  const results = [];
  if (!keys.length) return results;
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'CodeManager/1.0 (mod compatibility checker)' };
  const known = await (await fetch('https://api.modrinth.com/v2/version_files', { method: 'POST', headers, body: JSON.stringify({ hashes: keys, algorithm: 'sha1' }) })).json();
  let updates = {};
  if (ctx.mcVersion && ctx.loader) {
    try {
      updates = await (await fetch('https://api.modrinth.com/v2/version_files/update', { method: 'POST', headers, body: JSON.stringify({ hashes: keys, algorithm: 'sha1', loaders: [ctx.loader], game_versions: [ctx.mcVersion] }) })).json();
    } catch { updates = {}; }
  }
  for (const h of keys) {
    const file = hashes[h]; const v = known[h]; const up = updates[h];
    if (!v) { results.push({ level: 'info', mod: file, title: `${file}: brak na Modrinth (nie można sprawdzić online)` }); continue; }
    if (ctx.mcVersion && !v.game_versions.includes(ctx.mcVersion)) results.push({ level: 'warn', mod: file, title: `${file}: wg Modrinth ta wersja jest dla MC ${v.game_versions.slice(-4).join(', ')}` });
    if (ctx.loader && !v.loaders.includes(ctx.loader) && !(ctx.loader === 'quilt' && v.loaders.includes('fabric'))) results.push({ level: 'error', mod: file, title: `${file}: wg Modrinth loadery to ${v.loaders.join(', ')}` });
    if (up && up.id !== v.id) results.push({ level: 'info', mod: file, title: `${file}: dostępna nowsza zgodna wersja ${up.version_number}`, url: `https://modrinth.com/project/${up.project_id}/version/${up.id}` });
    else if (ctx.mcVersion && ctx.loader && !up) results.push({ level: 'warn', mod: file, title: `${file}: Modrinth nie ma wersji dla ${ctx.loader} ${ctx.mcVersion}` });
  }
  return results;
}

module.exports = { checkMods, checkPlugins, modrinthCheck, requiredJava, LOADER_NAMES };
