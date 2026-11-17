// Udostępnianie profilu modów: eksport listy do kodu lub pliku i import u znajomego
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('../util');

const PREFIX = 'CM1:';
const normName = s => String(s || '').replace(/\.(disabled|old)$/i, '').toLowerCase();
const sha1 = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

/**
 * Buduje opis profilu z raportu modów.
 * extra: { thunder: Map(dirLower → full-version), nexus: [{modId, name, files/paths}], mcVersion, loader }
 */
function build(game, profileName, mods, extra = {}) {
  const list = [];
  for (const m of mods) {
    if (!m.file && !m.id) continue;
    const e = { n: m.name, e: !!m.enabled };
    if (m.version && m.version !== '-') e.v = String(m.version);
    if (m.id) e.id = String(m.id);
    if (m.file) e.f = path.basename(m.file).replace(/\.disabled$/i, '');
    if (game.checker === 'minecraft' && m.file && /\.jar(\.disabled)?$/i.test(m.file) && U.isFile(m.file)) { try { e.h = sha1(m.file); } catch { /* */ } }
    if (extra.thunder && m.file) { const t = extra.thunder.get(path.resolve(m.file).toLowerCase()); if (t) e.ts = t; }
    if (extra.nexus && m.file) { const n = extra.nexus.find(x => (x.paths || []).some(p => path.resolve(p).toLowerCase() === path.resolve(m.file).toLowerCase())); if (n) e.nx = n.modId; }
    list.push(e);
  }
  return { v: 1, game: game.id, name: profileName || 'Profil', mc: extra.mcVersion ? { version: extra.mcVersion, loader: extra.loader } : undefined, mods: list, createdAt: Date.now() };
}

function encode(profile) { return PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(profile), 'utf8'), { level: 9 }).toString('base64url'); }
function decode(input) {
  const s = String(input || '').trim();
  let obj;
  if (s.startsWith(PREFIX)) {
    try { obj = JSON.parse(zlib.inflateRawSync(Buffer.from(s.slice(PREFIX.length).replace(/\s+/g, ''), 'base64url')).toString('utf8')); } catch { throw new Error('Kod profilu jest uszkodzony lub niepełny.'); }
  } else if (s.startsWith('{')) { try { obj = JSON.parse(s); } catch { throw new Error('To nie jest prawidłowy plik profilu.'); } }
  else throw new Error('To nie jest kod profilu CodeManager (powinien zaczynać się od „CM1:”).');
  if (!obj || !Array.isArray(obj.mods) || !obj.game) throw new Error('Kod nie zawiera listy modów.');
  return obj;
}

/**
 * Porównuje profil z obecnymi modami: co włączyć/wyłączyć lokalnie, a co trzeba pobrać.
 */
function plan(profile, mods) {
  const byKey = new Map();
  for (const m of mods) {
    for (const k of [m.id && 'id:' + normName(m.id), m.file && 'f:' + normName(path.basename(m.file)), 'n:' + normName(m.name)]) if (k && !byKey.has(k)) byKey.set(k, m);
  }
  const toggle = []; const download = []; const same = [];
  for (const e of profile.mods) {
    const local = (e.id && byKey.get('id:' + normName(e.id))) || (e.f && byKey.get('f:' + normName(e.f))) || byKey.get('n:' + normName(e.n));
    if (local) {
      if (!!local.enabled !== !!e.e && local.toggleable) toggle.push({ mod: local, want: e.e }); else same.push(e);
      if (local.version && e.v && String(local.version) !== String(e.v)) local.__versionDiff = e.v;
    } else if (e.e) download.push(e);
  }
  const wanted = new Set(profile.mods.map(e => e.id ? 'id:' + normName(e.id) : 'f:' + normName(e.f || e.n)));
  const extra = mods.filter(m => m.enabled && m.toggleable && !wanted.has(m.id ? 'id:' + normName(m.id) : 'f:' + normName(path.basename(m.file || m.name))) && !profile.mods.some(e => normName(e.n) === normName(m.name)));
  return { toggle, download, same, extra };
}

module.exports = { build, encode, decode, plan, PREFIX };
