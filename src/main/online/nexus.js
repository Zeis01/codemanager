// Nexus Mods API (v1 REST + v2 GraphQL): konto, przeglądanie, pliki, pobieranie (premium / nxm://), aktualizacje
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('../util');
const N = require('../net');

const API = 'https://api.nexusmods.com';
let apiKey = null;
let lastLimits = null;
function setKey(k) { apiKey = k || null; }
function headers() {
  if (!apiKey) throw new Error('Brak klucza API Nexus Mods – wklej go w Ustawieniach (nexusmods.com → Konto → API).');
  return { apikey: apiKey, 'Application-Name': 'CodeManager', 'Application-Version': '1.1.0', 'User-Agent': 'CodeManager/1.1', Accept: 'application/json' };
}
async function get(p) {
  const r = await fetch(API + p, { headers: headers() });
  lastLimits = { daily: r.headers.get('x-rl-daily-remaining'), hourly: r.headers.get('x-rl-hourly-remaining') };
  if (r.status === 401) throw new Error('Nexus Mods odrzucił klucz API – sprawdź go w Ustawieniach.');
  if (r.status === 403) throw new Error('Nexus Mods: brak uprawnień (bezpośrednie pobieranie wymaga konta Premium – użyj przycisku „Pobierz przez Nexus”).');
  if (r.status === 404) return null;
  if (r.status === 429) throw new Error('Nexus Mods: wyczerpano limit zapytań na tę godzinę.');
  if (!r.ok) throw new Error('Nexus Mods: HTTP ' + r.status);
  return r.json();
}

// Domeny gier na Nexus Mods
const DOMAINS = {
  projectzomboid: 'projectzomboid', ets2: 'eurotrucksimulator2', sotf: 'sonsoftheforest', lethalcompany: 'lethalcompany', repo: 'repo', contentwarning: 'contentwarning',
  schedule1: 'schedule1', peopleplayground: 'peopleplayground', transportfever2: 'transportfever2', hoi4: 'heartsofironiv', garrysmod: 'garrysmod', dst: 'dontstarvetogether',
  gta5: 'gta5', terraria: 'terraria', rimworld: 'rimworld', stardew: 'stardewvalley', skyrimse: 'skyrimspecialedition', fallout4: 'fallout4', sevendays: '7daystodie',
  cyberpunk2077: 'cyberpunk2077', witcher3: 'witcher3', payday2: 'payday2', payday3: 'payday3', mysummercar: 'mysummercar', mywintercar: 'mywintercar', teardown: 'teardown',
  stalkersoc: 'stalkershadowofchernobyl', stalkercs: 'stalkerclearsky', stalkercop: 'stalkercallofpripyat', stalker2: 'stalker2heartofchornobyl',
  metro2033redux: 'metro2033redux', metrolastlightredux: 'metrolastlightredux', metroexodus: 'metroexodus', readyornot: 'readyornot',
  citiesskylines: 'citiesskylines', citiesskylines2: 'citiesskylines2',
};

async function validate() { return get('/v1/users/validate.json'); }
async function modInfo(domain, id) { return get(`/v1/games/${domain}/mods/${id}.json`); }
async function files(domain, id) { const r = await get(`/v1/games/${domain}/mods/${id}/files.json`); return r ? r.files : []; }
async function lists(domain, kind) { return (await get(`/v1/games/${domain}/mods/${kind}.json`)) || []; }
async function md5Search(domain, file) {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
  return (await get(`/v1/games/${domain}/mods/md5_search/${md5}.json`)) || [];
}

// Wyszukiwanie po nazwie (GraphQL v2); jeśli niedostępne – lista popularnych
async function search(domain, text) {
  if (!text) return mapList(await lists(domain, 'trending'));
  const query = `query($filter: ModsFilter, $count: Int) { mods(filter: $filter, count: $count, sort: [{ endorsements: { direction: DESC } }]) { nodes { modId name summary version author pictureUrl endorsements downloads updatedAt } } }`;
  try {
    const r = await fetch(API + '/v2/graphql', { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { count: 30, filter: { gameDomainName: [{ value: domain, op: 'EQUALS' }], name: [{ value: text, op: 'WILDCARD' }] } } }) });
    const j = await r.json();
    if (j.errors || !j.data) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'brak danych');
    return j.data.mods.nodes.map(m => ({ id: m.modId, name: m.name, summary: m.summary, version: m.version, author: m.author, picture: m.pictureUrl, endorsements: m.endorsements, downloads: m.downloads, url: `https://www.nexusmods.com/${domain}/mods/${m.modId}` }));
  } catch (e) {
    const all = mapList([...(await lists(domain, 'trending')), ...(await lists(domain, 'latest_updated'))]);
    const t = text.toLowerCase();
    const f = all.filter(m => (m.name || '').toLowerCase().includes(t));
    f.note = 'Wyszukiwarka Nexus jest niedostępna – pokazuję pasujące mody z list popularnych i aktualizowanych.';
    return f;
  }
}
// Przeglądanie ze stronami (GraphQL v2 – działa także bez klucza API)
const NX_SORT = { endorsements: 'endorsements', downloads: 'downloads', updated: 'updatedAt', newest: 'createdAt' };
async function browse(domain, { text = '', sort = 'endorsements', page = 1, perPage = 24 } = {}, fetchImpl = fetch) {
  const query = `query($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) { mods(filter: $filter, sort: $sort, offset: $offset, count: $count) { totalCount nodes { modId name summary version author pictureUrl thumbnailUrl endorsements downloads updatedAt createdAt adultContent } } }`;
  const filter = { gameDomainName: [{ value: domain, op: 'EQUALS' }] };
  if (text) filter.name = [{ value: text, op: 'WILDCARD' }];
  const h = { 'Content-Type': 'application/json', 'Application-Name': 'CodeManager', 'User-Agent': 'CodeManager', Accept: 'application/json' };
  if (apiKey) h.apikey = apiKey;
  const r = await fetchImpl(API + '/v2/graphql', { method: 'POST', headers: h, body: JSON.stringify({ query, variables: { filter, sort: [{ [NX_SORT[sort] || 'endorsements']: { direction: 'DESC' } }], offset: (page - 1) * perPage, count: perPage } }) });
  let j = null; try { j = await r.json(); } catch { /* */ }
  if (!r.ok || !j || j.errors || !j.data || !j.data.mods) {
    if (apiKey && !text) { const l = mapList(await lists(domain, sort === 'newest' ? 'latest_added' : sort === 'updated' ? 'latest_updated' : 'trending')); return { total: l.length, page: 1, perPage: l.length, items: l, note: 'Pokazuję listę z API v1 (bez stron).' }; }
    throw new Error('Nexus Mods: ' + ((j && j.errors && j.errors[0] && j.errors[0].message) || 'HTTP ' + r.status));
  }
  const m = j.data.mods;
  return { total: m.totalCount || 0, page, perPage, items: m.nodes.map(x => ({ id: x.modId, name: x.name, summary: x.summary, version: x.version, author: x.author, picture: x.thumbnailUrl || x.pictureUrl, endorsements: x.endorsements, downloads: x.downloads, updated: x.updatedAt, adult: !!x.adultContent, url: `https://www.nexusmods.com/${domain}/mods/${x.modId}` })) };
}
// opis moda (BBCode → zwykły tekst z akapitami)
function bbToText(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/\[(?:\/)?(?:b|i|u|s|size|color|font|center|right|left|quote|spoiler|heading|line|img|youtube|url|list|code|table|tr|td|th|hr|email)[^\]]*\]/gi, '').replace(/\[\*\]/g, '• ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}
function mapList(l) {
  const seen = new Set();
  return l.filter(m => m && m.available !== false && !seen.has(m.mod_id) && seen.add(m.mod_id)).map(m => ({ id: m.mod_id, name: m.name, summary: m.summary, version: m.version, author: m.author, picture: m.picture_url, endorsements: m.endorsement_count, downloads: m.mod_downloads, url: `https://www.nexusmods.com/${m.domain_name}/mods/${m.mod_id}` }));
}

function mainFile(list) {
  const pref = ['MAIN', 'UPDATE', 'OPTIONAL', 'MISCELLANEOUS'];
  const sorted = [...list].filter(f => f.category_name !== 'OLD_VERSION' && f.category_name !== 'ARCHIVED').sort((a, b) => pref.indexOf(a.category_name) - pref.indexOf(b.category_name) || b.uploaded_timestamp - a.uploaded_timestamp);
  return sorted[0] || null;
}

async function downloadLink(domain, modId, fileId, nxm) {
  const q = nxm && nxm.key ? `?key=${encodeURIComponent(nxm.key)}&expires=${encodeURIComponent(nxm.expires)}` : '';
  const r = await get(`/v1/games/${domain}/mods/${modId}/files/${fileId}/download_link.json${q}`);
  if (!r || !r.length) throw new Error('Nexus nie zwrócił linku do pobrania.');
  return r[0].URI;
}

function parseNxm(url) {
  // nxm://skyrimspecialedition/mods/266/files/12345?key=...&expires=...&user_id=...
  const u = new URL(url);
  const m = (u.host + u.pathname).match(/^([^/]+)\/mods\/(\d+)\/files\/(\d+)/i);
  if (!m) throw new Error('Nieprawidłowy link nxm://');
  return { domain: m[1].toLowerCase(), modId: +m[2], fileId: +m[3], key: u.searchParams.get('key'), expires: u.searchParams.get('expires') };
}

async function downloadArchive(domain, modId, fileId, nxm, progress) {
  const fl = await files(domain, modId);
  const f = fl.find(x => x.file_id === +fileId) || {};
  const url = await downloadLink(domain, modId, fileId, nxm);
  const name = f.file_name || decodeURIComponent(new URL(url).pathname.split('/').pop());
  const dest = N.tempFile(name);
  await N.download(url, dest, progress);
  return { archive: dest, file: f, name };
}

function limits() { return lastLimits; }

module.exports = { browse, bbToText, NX_SORT, hasKey: () => !!apiKey, setKey, validate, modInfo, files, lists, search, md5Search, mainFile, downloadLink, parseNxm, downloadArchive, DOMAINS, limits };
