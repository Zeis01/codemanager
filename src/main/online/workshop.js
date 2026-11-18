// Warsztat Steam: szczegóły przedmiotów (bez klucza), wyszukiwanie (klucz Steam Web API),
// pobieranie przez SteamCMD i kopiowanie do folderu modów gry
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('../util');

const API = 'https://api.steampowered.com';
const cache = new Map(); // id → { t, data }
const TTL = 6 * 3600000;

function parseId(input) {
  const s = String(input || '').trim();
  const m = s.match(/[?&]id=(\d{6,})/) || s.match(/filedetails\/?\?.*?(\d{6,})/) || s.match(/^(\d{6,})$/);
  return m ? m[1] : null;
}

function mapItem(d) {
  return {
    id: String(d.publishedfileid), title: d.title || `Przedmiot #${d.publishedfileid}`, description: d.short_description || d.file_description || d.description || '',
    preview: d.preview_url || null, size: +d.file_size || 0, updated: (+d.time_updated || 0) * 1000, created: (+d.time_created || 0) * 1000,
    subscriptions: +d.subscriptions || +d.lifetime_subscriptions || 0, favorited: +d.favorited || 0, appid: +d.consumer_app_id || +d.consumer_appid || null,
    banned: !!d.banned, result: d.result, tags: (d.tags || []).map(t => (typeof t === 'string' ? t : t.tag)).filter(Boolean),
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${d.publishedfileid}`,
  };
}

// szczegóły wielu przedmiotów – publiczne API, bez klucza
async function details(ids, fetchImpl = fetch) {
  const want = [...new Set(ids.map(String).filter(x => /^\d+$/.test(x)))];
  const out = {}; const missing = [];
  for (const id of want) { const c = cache.get(id); if (c && Date.now() - c.t < TTL) out[id] = c.data; else missing.push(id); }
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const body = new URLSearchParams({ itemcount: String(chunk.length) });
    chunk.forEach((id, j) => body.set(`publishedfileids[${j}]`, id));
    const r = await fetchImpl(`${API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CodeManager' }, body: body.toString() });
    if (!r.ok) throw new Error('Steam: HTTP ' + r.status);
    const j = await r.json();
    for (const d of (j.response && j.response.publishedfiledetails) || []) {
      if (+d.result !== 1) continue;
      const it = mapItem(d); cache.set(it.id, { t: Date.now(), data: it }); out[it.id] = it;
    }
  }
  return out;
}

const SORTS = { trend: 3, top: 0, subscriptions: 9, newest: 1, updated: 21, text: 12 };
// wyszukiwanie wymaga darmowego klucza Steam Web API (steamcommunity.com/dev/apikey)
async function search(appid, { key, text = '', sort = 'trend', page = 1, perPage = 24 } = {}, fetchImpl = fetch) {
  if (!key) throw new Error('Do przeglądania Warsztatu potrzebny jest darmowy klucz Steam Web API (Ustawienia → Warsztat Steam). Bez klucza wklej link lub ID przedmiotu.');
  const q = new URLSearchParams({ key, appid: String(appid), numperpage: String(perPage), page: String(page), return_details: 'true', return_previews: 'true', return_short_description: 'true', return_tags: 'true', query_type: String(text ? SORTS.text : (SORTS[sort] ?? SORTS.trend)), search_text: text || '', days: '30', strip_description_bbcode: 'true' });
  const r = await fetchImpl(`${API}/IPublishedFileService/QueryFiles/v1/?${q}`, { headers: { 'User-Agent': 'CodeManager' } });
  if (r.status === 403 || r.status === 401) throw new Error('Steam odrzucił klucz Web API – sprawdź go w Ustawieniach.');
  if (!r.ok) throw new Error('Steam: HTTP ' + r.status);
  const j = await r.json(); const res = j.response || {};
  const items = (res.publishedfiledetails || []).filter(d => +d.result === 1 || d.title).map(mapItem);
  items.forEach(it => cache.set(it.id, { t: Date.now(), data: it }));
  return { total: +res.total || items.length, page, perPage, items };
}

// gdzie gra trzyma lokalne mody i jak skopiować do nich przedmiot Warsztatu
function installItem(game, itemDir, id, modsDir) {
  const out = [];
  const cp = (src, dst) => { U.copyRecursive(src, dst); out.push(dst); };
  switch (game.checker) {
    case 'projectzomboid': { // przedmiot zawiera mods/<NazwaModa>
      const md = path.join(itemDir, 'mods');
      for (const d of U.listDirs(U.isDir(md) ? md : itemDir)) cp(d, path.join(modsDir, path.basename(d)));
      break;
    }
    case 'dst': cp(itemDir, path.join(modsDir, 'workshop-' + id)); break;
    case 'garrysmod': for (const f of U.walk(itemDir)) { if (/\.gma$/i.test(f)) cp(path.join(itemDir, f), path.join(modsDir, `${id}_${path.basename(f)}`)); } if (!out.length) cp(itemDir, path.join(modsDir, id)); break;
    case 'tmodloader': for (const f of U.walk(itemDir)) { if (/\.tmod$/i.test(f)) cp(path.join(itemDir, f), path.join(modsDir, path.basename(f))); } break;
    case 'ets2': for (const f of U.walk(itemDir)) { if (/\.(scs|zip)$/i.test(f)) cp(path.join(itemDir, f), path.join(modsDir, `${id}_${path.basename(f)}`)); } break;
    case 'vpk': for (const f of U.walk(itemDir)) { if (/\.vpk$/i.test(f)) cp(path.join(itemDir, f), path.join(modsDir, 'workshop', `${id}.vpk`)); } break;
    case 'transportfever2': cp(itemDir, path.join(modsDir, `workshop_${id}_1`)); break;
    case 'paradox': {
      const dst = path.join(modsDir, 'ugc_' + id); cp(itemDir, dst);
      const desc = U.readText(path.join(itemDir, 'descriptor.mod'), `name="Warsztat ${id}"\n`);
      fs.writeFileSync(path.join(modsDir, `ugc_${id}.mod`), desc.replace(/^\s*path\s*=.*$/m, '').trim() + `\npath="${dst.replace(/\\/g, '/')}"\nremote_file_id="${id}"\n`);
      out.push(path.join(modsDir, `ugc_${id}.mod`));
      break;
    }
    default: cp(itemDir, path.join(modsDir, id));
  }
  if (!out.length) throw new Error('Przedmiot nie zawiera plików, które da się skopiować do folderu modów.');
  return out;
}

// numer przedmiotu z ścieżki pliku w folderze Warsztatu (…/workshop/content/<appid>/<id>/…)
function idFromPath(p) { const m = String(p || '').replace(/\\/g, '/').match(/\/workshop\/content\/\d+\/(\d+)(\/|$)/i); return m ? m[1] : null; }
function annotate(rep) {
  for (const m of rep.mods || []) {
    const id = idFromPath(m.file) || idFromPath(m.key) || ((String(m.source || '').match(/Warsztat\s*#\s*(\d{6,})/) || [])[1]);
    if (id) m.workshopId = id;
  }
  return rep;
}
function localMtime(p) {
  try { const st = fs.statSync(p); if (st.isFile()) return st.mtimeMs; let max = st.mtimeMs; for (const r of U.walk(p, { maxFiles: 400 })) { try { max = Math.max(max, fs.statSync(path.join(p, r)).mtimeMs); } catch { /* */ } } return max; } catch { return 0; }
}

module.exports = { parseId, details, search, installItem, idFromPath, annotate, localMtime, mapItem, SORTS };
