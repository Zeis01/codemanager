// Parsery formatów binarnych: wersja PE (exe/dll), GMA (Garry's Mod), TMOD (tModLoader), SMX (SourceMod)
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ---------- PE: VS_FIXEDFILEINFO ----------
const SIG = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
const peCache = new Map();
function peVersion(file) {
  try {
    const st = fs.statSync(file);
    const key = file + ':' + st.mtimeMs;
    if (peCache.has(key)) return peCache.get(key);
    // zasoby zwykle są na końcu pliku – czytamy od końca w kawałkach
    const fd = fs.openSync(file, 'r');
    const CH = 4 * 1024 * 1024;
    let pos = st.size; let result = null;
    while (pos > 0 && !result) {
      const start = Math.max(0, pos - CH);
      const len = pos - start + (pos < st.size ? 64 : 0);
      const buf = Buffer.alloc(Math.min(len, st.size - start));
      fs.readSync(fd, buf, 0, buf.length, start);
      let idx = buf.lastIndexOf(SIG);
      while (idx >= 0 && !result) {
        if (idx + 52 <= buf.length && buf.readUInt32LE(idx + 4) >= 0x00010000 && buf.readUInt32LE(idx + 4) <= 0x00010001) {
          const fMS = buf.readUInt32LE(idx + 8), fLS = buf.readUInt32LE(idx + 12);
          const pMS = buf.readUInt32LE(idx + 16), pLS = buf.readUInt32LE(idx + 20);
          result = {
            file: `${fMS >>> 16}.${fMS & 0xffff}.${fLS >>> 16}.${fLS & 0xffff}`,
            product: `${pMS >>> 16}.${pMS & 0xffff}.${pLS >>> 16}.${pLS & 0xffff}`,
          };
        } else idx = idx > 0 ? buf.lastIndexOf(SIG, idx - 1) : -1;
      }
      pos = start;
      if (st.size - pos > 64 * 1024 * 1024) break;
    }
    fs.closeSync(fd);
    peCache.set(key, result);
    return result;
  } catch { return null; }
}

// Wyszukiwanie ciągów ASCII / UTF-16 w pliku (np. referencje assembly w DLL)
function fileContains(file, needles, maxBytes = 64 * 1024 * 1024) {
  try {
    const st = fs.statSync(file);
    if (st.size > maxBytes) return {};
    const buf = fs.readFileSync(file);
    const res = {};
    for (const n of needles) {
      res[n] = buf.indexOf(Buffer.from(n, 'latin1')) >= 0 || buf.indexOf(Buffer.from(n, 'utf16le')) >= 0;
    }
    return res;
  } catch { return {}; }
}

// ---------- Czytnik binarny ----------
class Reader {
  constructor(buf, off = 0) { this.b = buf; this.o = off; }
  u8() { return this.b[this.o++]; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  u64() { const v = Number(this.b.readBigUInt64LE(this.o)); this.o += 8; return v; }
  bytes(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  cstr() { const e = this.b.indexOf(0, this.o); const s = this.b.toString('utf8', this.o, e < 0 ? this.b.length : e); this.o = (e < 0 ? this.b.length : e) + 1; return s; }
  // .NET BinaryWriter string: długość 7-bit encoded
  dstr() {
    let len = 0, shift = 0, b;
    do { b = this.u8(); len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && shift < 35);
    const s = this.b.toString('utf8', this.o, this.o + len); this.o += len; return s;
  }
}

// ---------- GMA ----------
function parseGMA(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    const headLen = Math.min(st.size, 8 * 1024 * 1024);
    const buf = Buffer.alloc(headLen);
    fs.readSync(fd, buf, 0, headLen, 0);
    if (buf.toString('latin1', 0, 4) !== 'GMAD') return { error: 'To nie jest plik GMA (może być skompresowany LZMA)' };
    const r = new Reader(buf, 4);
    const version = r.u8();
    r.u64(); r.u64();
    if (version > 1) { while (r.cstr() !== '') { /* required content */ } }
    const name = r.cstr(); const desc = r.cstr(); const author = r.cstr();
    r.i32();
    const files = [];
    for (;;) {
      if (r.o + 4 > buf.length) break;
      const num = r.u32(); if (num === 0) break;
      const fname = r.cstr(); const size = r.u64(); r.u32();
      files.push({ name: fname.toLowerCase(), size });
    }
    let meta = {};
    try { meta = JSON.parse(desc); } catch { meta = { description: desc }; }
    return { name, author, meta, files };
  } finally { fs.closeSync(fd); }
}

// ---------- TMOD (tModLoader) ----------
function parseTMOD(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'TMOD') return { error: 'Nieprawidłowy plik .tmod' };
  const r = new Reader(buf, 4);
  const tmlVersion = r.dstr();
  r.bytes(20); r.bytes(256);
  r.u32();
  const name = r.dstr();
  const version = r.dstr();
  const out = { name, version, tmlVersion, modReferences: [], weakReferences: [], side: null };
  try {
    const count = r.i32();
    const entries = [];
    for (let i = 0; i < count && i < 100000; i++) {
      const path = r.dstr(); const len = r.i32(); const clen = r.i32();
      entries.push({ path, len, clen });
    }
    let off = r.o;
    for (const e of entries) {
      if (e.path === 'Info') {
        let data = buf.subarray(off, off + e.clen);
        if (e.clen !== e.len) data = zlib.inflateRawSync(data);
        Object.assign(out, parseTmodInfo(data));
        break;
      }
      off += e.clen;
    }
  } catch { /* stare formaty – zostają podstawowe dane */ }
  return out;
}
function parseTmodInfo(data) {
  const r = new Reader(data);
  const res = { modReferences: [], weakReferences: [] };
  const LISTS = new Set(['dllReferences', 'modReferences', 'weakReferences', 'sortAfter', 'sortBefore']);
  const VALUES = new Set(['author', 'version', 'displayName', 'homepage', 'description', 'eacPath', 'buildVersion', 'side', 'languageVersion']);
  try {
    while (r.o < data.length) {
      const tag = r.dstr();
      if (tag === '') break;
      if (LISTS.has(tag)) { const l = []; for (;;) { const s = r.dstr(); if (s === '') break; l.push(s); } res[tag] = l; }
      else if (VALUES.has(tag)) {
        if (tag === 'side') res.side = ['Both', 'Client', 'Server', 'NoSync'][r.u8()] || null;
        else res[tag] = r.dstr();
      }
      // pozostałe tagi to flagi bez wartości
    }
  } catch { /* ignoruj */ }
  return res;
}

// ---------- SMX (SourceMod) ----------
function parseSMX(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.readUInt32LE(0) !== 0x53504646) return { error: 'Nieprawidłowy plik .smx' };
  const version = buf.readUInt16LE(4);
  const compression = buf.readUInt8(6);
  const imagesize = buf.readUInt32LE(11);
  const sections = buf.readUInt8(15);
  const stringtab = buf.readUInt32LE(16);
  const dataoffs = buf.readUInt32LE(20);
  let image = buf;
  if (compression === 1) {
    try {
      const body = zlib.inflateSync(buf.subarray(dataoffs));
      image = Buffer.concat([buf.subarray(0, dataoffs), body]);
    } catch { return { version, error: 'Nie udało się rozpakować pliku .smx' }; }
  }
  const secs = {};
  for (let s = 0; s < sections; s++) {
    const o = 24 + s * 12;
    const nameoffs = image.readUInt32LE(o), off = image.readUInt32LE(o + 4), size = image.readUInt32LE(o + 8);
    const nm = image.toString('latin1', stringtab + nameoffs, image.indexOf(0, stringtab + nameoffs));
    secs[nm] = { off, size };
  }
  const names = secs['.names'];
  const readName = off => names ? image.toString('latin1', names.off + off, image.indexOf(0, names.off + off)) : '';
  const extensions = []; const libraries = []; const natives = [];
  if (secs['.pubvars']) {
    for (let o = secs['.pubvars'].off; o < secs['.pubvars'].off + secs['.pubvars'].size; o += 8) {
      const nm = readName(image.readUInt32LE(o + 4));
      if (nm.startsWith('__ext_')) extensions.push(nm.slice(6));
      else if (nm.startsWith('__pl_')) libraries.push(nm.slice(5));
    }
  }
  if (secs['.natives']) {
    for (let o = secs['.natives'].off; o < secs['.natives'].off + secs['.natives'].size; o += 4) natives.push(readName(image.readUInt32LE(o)));
  }
  let pluginName = null;
  const mi = image.indexOf(Buffer.from('myinfo'));
  return { version, imagesize, extensions, libraries, natives, pluginName, hasMyinfo: mi >= 0 };
}

module.exports = { peVersion, fileContains, parseGMA, parseTMOD, parseSMX, Reader };
