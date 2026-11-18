// Zaproszenie „jedno kliknięcie dla znajomych”: link codemanager://join/… z grą, adresem serwera i listą modów.
// Znajomy otwiera link → CodeManager instaluje brakujące mody (kod profilu) i łączy z serwerem.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const U = require('./util');

const PREFIX = 'CMJ1:';
const SCHEME = 'codemanager';

function encode(inv) {
  const data = { v: 1, g: inv.gameId, n: inv.serverName || '', a: inv.address || '', p: inv.profileCode || '', m: inv.message || '', from: inv.from || '', t: Date.now(), mc: inv.mcVersion || '', l: inv.loader || '', pw: inv.password || '' };
  return zlib.deflateRawSync(Buffer.from(JSON.stringify(data), 'utf8'), { level: 9 }).toString('base64url');
}
function build(inv) { const b = encode(inv); return { link: `${SCHEME}://join/${b}`, code: PREFIX + b }; }
function parse(input) {
  const s = String(input || '').trim();
  const m = s.match(/^codemanager:\/\/join\/([A-Za-z0-9_-]+)\/?$/i) || s.match(/^CMJ1:([A-Za-z0-9_-]+)$/) || s.match(/[?&]invite=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('To nie jest zaproszenie CodeManager (link codemanager://join/… albo kod CMJ1:…).');
  let d; try { d = JSON.parse(zlib.inflateRawSync(Buffer.from(m[1], 'base64url')).toString('utf8')); } catch { throw new Error('Zaproszenie jest uszkodzone – poproś o nowy link.'); }
  if (d.v !== 1 || !d.g) throw new Error('Nieobsługiwana wersja zaproszenia – zaktualizuj CodeManager.');
  return { gameId: d.g, serverName: d.n, address: d.a, profileCode: d.p, message: d.m, from: d.from, created: d.t, mcVersion: d.mc, loader: d.l, password: d.pw };
}

// jak połączyć grę z serwerem
const STEAM_CONNECT = new Set(['garrysmod', 'l4d', 'l4d2', 'tf2', 'cs2', 'rust', 'unturned', 'dayz', 'sevendays', 'projectzomboid', 'valheim', 'ark']);
function connectFor(gameId, address, password) {
  if (!address) return null;
  if (['fivem', 'gta5', 'gtav', 'gtaV'].includes(gameId)) return { url: `fivem://connect/${address}`, label: 'Połącz przez FiveM' };
  if (gameId === 'redm' || gameId === 'rdr2') return { url: `redm://connect/${address}`, label: 'Połącz przez RedM' };
  if (gameId === 'mta' || gameId === 'gtasa') return { url: `mtasa://${address}`, label: 'Połącz przez MTA:SA' };
  if (gameId === 'minecraft') return { serversDat: true, label: 'Dodaj do listy serwerów Minecrafta' };
  if (STEAM_CONNECT.has(gameId)) return { url: `steam://connect/${address}${password ? '/' + encodeURIComponent(password) : ''}`, label: 'Połącz przez Steam' };
  return null;
}

// ---------- servers.dat Minecrafta (NBT bez kompresji) ----------
function nbtRead(buf) {
  let o = 0;
  const u8 = () => buf[o++]; const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; }; const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  const payload = t => {
    switch (t) {
      case 1: return { t, v: buf.readInt8(o++) };
      case 2: return { t, v: i16() };
      case 3: return { t, v: i32() };
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return { t, v }; }
      case 5: { const v = buf.readFloatBE(o); o += 4; return { t, v }; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return { t, v }; }
      case 7: { const n = i32(); const v = buf.slice(o, o + n); o += n; return { t, v }; }
      case 8: return { t, v: str() };
      case 9: { const et = u8(); const n = i32(); const v = []; for (let i = 0; i < n; i++) v.push(payload(et)); return { t, et, v }; }
      case 10: { const v = []; for (;;) { const ct = u8(); if (ct === 0) break; const name = str(); v.push({ name, ...payload(ct) }); } return { t, v }; }
      case 11: { const n = i32(); const v = []; for (let i = 0; i < n; i++) v.push(i32()); return { t, v }; }
      case 12: { const n = i32(); const v = []; for (let i = 0; i < n; i++) { v.push(buf.readBigInt64BE(o)); o += 8; } return { t, v }; }
      default: throw new Error('Nieznany znacznik NBT ' + t);
    }
  };
  const t = u8(); const name = str(); return { name, ...payload(t) };
}
function nbtWrite(tag) {
  const parts = [];
  const b = n => { const x = Buffer.alloc(n); parts.push(x); return x; };
  const str = s => { const d = Buffer.from(s, 'utf8'); b(2).writeUInt16BE(d.length); parts.push(d); };
  const payload = tg => {
    switch (tg.t) {
      case 1: b(1).writeInt8(tg.v); break; case 2: b(2).writeInt16BE(tg.v); break; case 3: b(4).writeInt32BE(tg.v); break;
      case 4: b(8).writeBigInt64BE(BigInt(tg.v)); break; case 5: b(4).writeFloatBE(tg.v); break; case 6: b(8).writeDoubleBE(tg.v); break;
      case 7: b(4).writeInt32BE(tg.v.length); parts.push(Buffer.from(tg.v)); break;
      case 8: str(tg.v); break;
      case 9: b(1).writeUInt8(tg.et || (tg.v[0] ? tg.v[0].t : 0)); b(4).writeInt32BE(tg.v.length); tg.v.forEach(payload); break;
      case 10: for (const c of tg.v) { b(1).writeUInt8(c.t); str(c.name); payload(c); } b(1).writeUInt8(0); break;
      case 11: b(4).writeInt32BE(tg.v.length); tg.v.forEach(x => b(4).writeInt32BE(x)); break;
      case 12: b(4).writeInt32BE(tg.v.length); tg.v.forEach(x => b(8).writeBigInt64BE(BigInt(x))); break;
    }
  };
  b(1).writeUInt8(tag.t); str(tag.name || ''); payload(tag);
  return Buffer.concat(parts);
}
// dopisuje serwer do servers.dat (na początek listy); zwraca true, gdy dodano
function addMinecraftServer(gameDir, name, ip) {
  const f = path.join(gameDir, 'servers.dat');
  let root = { name: '', t: 10, v: [] };
  if (U.exists(f)) { try { root = nbtRead(fs.readFileSync(f)); } catch { fs.copyFileSync(f, f + '.cm-backup'); } }
  let list = root.v.find(c => c.name === 'servers');
  if (!list) { list = { name: 'servers', t: 9, et: 10, v: [] }; root.v.push(list); }
  if (list.v.some(s => (s.v.find(c => c.name === 'ip') || {}).v === ip)) return false;
  list.et = 10;
  list.v.unshift({ t: 10, v: [{ name: 'ip', t: 8, v: ip }, { name: 'name', t: 8, v: name || ip }] });
  if (U.exists(f)) fs.copyFileSync(f, f + '.cm-backup');
  fs.writeFileSync(f, nbtWrite(root));
  return true;
}
function minecraftServers(gameDir) { const f = path.join(gameDir, 'servers.dat'); if (!U.exists(f)) return []; const r = nbtRead(fs.readFileSync(f)); const l = r.v.find(c => c.name === 'servers'); return l ? l.v.map(s => ({ ip: (s.v.find(c => c.name === 'ip') || {}).v, name: (s.v.find(c => c.name === 'name') || {}).v })) : []; }

module.exports = { build, parse, encode, connectFor, addMinecraftServer, minecraftServers, nbtRead, nbtWrite, SCHEME, PREFIX };
