// Parsery formatów tekstowych: VDF (Valve KeyValues), Lua (tabele), Paradox (Clausewitz), SII (SCS), INI
'use strict';

// ---------- VDF / KeyValues ----------
function parseVDF(text) {
  let i = 0;
  const n = text.length;
  function skipWs() {
    while (i < n) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; }
      else if (/\s/.test(c)) i++;
      else break;
    }
  }
  function readToken() {
    skipWs();
    if (i >= n) return null;
    if (text[i] === '{' || text[i] === '}') return text[i++];
    if (text[i] === '"') {
      i++; let s = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) { const e = text[i + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; i += 2; }
        else s += text[i++];
      }
      i++; return { s };
    }
    let s = '';
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return { s };
  }
  function parseObj() {
    const obj = {};
    for (;;) {
      const k = readToken();
      if (k === null || k === '}') return obj;
      if (k === '{') continue;
      const v = readToken();
      if (v === '{') obj[k.s] = parseObj();
      else if (v && v.s !== undefined) {
        obj[k.s] = v.s;
        // pomiń warunki typu [$WIN32]
        skipWs();
        if (text[i] === '[') { while (i < n && text[i] !== ']') i++; i++; }
      } else return obj;
    }
  }
  return parseObj();
}
// klucze case-insensitive
function vget(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    const found = Object.keys(cur).find(x => x.toLowerCase() === String(k).toLowerCase());
    cur = found === undefined ? undefined : cur[found];
  }
  return cur;
}

// ---------- Lua (bezpieczny parser bez wykonywania kodu) ----------
function luaTokenize(src) {
  const toks = [];
  let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '-' && src[i + 1] === '-') {
      i += 2;
      const m = src.slice(i).match(/^\[(=*)\[/);
      if (m) { const close = ']' + m[1] + ']'; const e = src.indexOf(close, i); i = e < 0 ? n : e + close.length; }
      else { while (i < n && src[i] !== '\n') i++; }
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let s = ''; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') {
          const e = src[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === '\n' ? '\n' : e; i += 2;
        } else if (src[i] === '\n') break; else s += src[i++];
      }
      i++; toks.push({ t: 'str', v: s }); continue;
    }
    if (c === '[') {
      const m = src.slice(i).match(/^\[(=*)\[/);
      if (m) {
        const close = ']' + m[1] + ']';
        const start = i + m[0].length; const e = src.indexOf(close, start);
        let s = src.slice(start, e < 0 ? n : e); if (s[0] === '\n') s = s.slice(1);
        toks.push({ t: 'str', v: s }); i = e < 0 ? n : e + close.length; continue;
      }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      const m = src.slice(i).match(/^(0[xX][0-9a-fA-F]+|[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?)/);
      toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      toks.push({ t: 'name', v: m[0] }); i += m[0].length; continue;
    }
    const three = src.substr(i, 3), two = src.substr(i, 2);
    if (three === '...') { toks.push({ t: 'sym', v: three }); i += 3; continue; }
    if (['==', '~=', '<=', '>=', '..', '::'].includes(two)) { toks.push({ t: 'sym', v: two }); i += 2; continue; }
    toks.push({ t: 'sym', v: c }); i++;
  }
  return toks;
}

const BLOCK_OPEN = new Set(['function', 'if', 'do', 'repeat']);
const BLOCK_CLOSE = new Set(['end', 'until']);

function parseLua(src) {
  const toks = luaTokenize(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const isSym = (t, v) => t && t.t === 'sym' && t.v === v;
  const isName = (t, v) => t && t.t === 'name' && (v === undefined || t.v === v);

  function skipBlock() { // po słowie otwierającym
    let depth = 1;
    while (p < toks.length && depth > 0) {
      const t = toks[p++];
      if (t.t === 'name') {
        if (t.v === 'function' || t.v === 'if' || t.v === 'repeat') depth++;
        else if (t.v === 'do') { depth++; }
        else if (t.v === 'while' || t.v === 'for') { // ich 'do' zostanie policzone
        }
        else if (BLOCK_CLOSE.has(t.v)) depth--;
      }
    }
  }
  function skipBalanced(open, close) {
    let depth = 0;
    do {
      const t = toks[p++];
      if (!t) return;
      if (isSym(t, open)) depth++; else if (isSym(t, close)) depth--;
    } while (depth > 0 && p < toks.length);
  }
  function parseSimple() {
    const t = peek();
    if (!t) return undefined;
    if (t.t === 'str' || t.t === 'num') { p++; return t.v; }
    if (isSym(t, '-') && peek(1) && peek(1).t === 'num') { p += 2; return -toks[p - 1].v; }
    if (isName(t, 'true')) { p++; return true; }
    if (isName(t, 'false')) { p++; return false; }
    if (isName(t, 'nil')) { p++; return null; }
    if (isSym(t, '{')) return parseTable();
    if (isName(t, 'function')) { p++; skipBlock(); return { __function: true }; }
    if (isSym(t, '(')) { p++; const v = parseExpr(); if (isSym(peek(), ')')) p++; return v; }
    if (t.t === 'name') {
      // wywołanie typu _("tekst") / T"tekst" / zmienna
      p++;
      let name = t.v;
      while (isSym(peek(), '.') || isSym(peek(), ':')) { p++; if (peek() && peek().t === 'name') name += '.' + toks[p++].v; }
      if (isSym(peek(), '(')) {
        p++; const args = [];
        while (p < toks.length && !isSym(peek(), ')')) { args.push(parseExpr()); if (isSym(peek(), ',')) p++; else if (!isSym(peek(), ')')) p++; }
        p++;
        return typeof args[0] === 'string' ? args[0] : { __call: name, args };
      }
      if (peek() && (peek().t === 'str' || isSym(peek(), '{'))) { const a = parseSimple(); return typeof a === 'string' ? a : { __call: name, args: [a] }; }
      if (isSym(peek(), '[')) { skipBalanced('[', ']'); }
      return { __ref: name };
    }
    p++; return undefined;
  }
  const BIN = new Set(['..', '+', '-', '*', '/', '%', '^', '==', '~=', '<', '>', '<=', '>=']);
  function parseExpr() {
    if (isName(peek(), 'not') || isSym(peek(), '#')) p++;
    let v = parseSimple();
    while (peek() && ((peek().t === 'sym' && BIN.has(peek().v)) || isName(peek(), 'and') || isName(peek(), 'or'))) {
      const op = toks[p++].v;
      const r = parseSimple();
      if (op === '..' && (typeof v === 'string' || typeof v === 'number') && (typeof r === 'string' || typeof r === 'number')) v = String(v) + String(r);
      else if (op === 'or' && (v === undefined || v === null)) v = r;
      else if (typeof v === 'number' && typeof r === 'number' && '+-*/'.includes(op)) v = op === '+' ? v + r : op === '-' ? v - r : op === '*' ? v * r : v / r;
    }
    return v;
  }
  function parseTable() {
    p++; // {
    const obj = {}; const arr = [];
    while (p < toks.length && !isSym(peek(), '}')) {
      if (isSym(peek(), '[')) {
        p++; const k = parseExpr(); if (isSym(peek(), ']')) p++;
        if (isSym(peek(), '=')) p++;
        obj[k] = parseExpr();
      } else if (peek().t === 'name' && isSym(peek(1), '=') && !isSym(peek(2), '=')) {
        const k = toks[p].v; p += 2; obj[k] = parseExpr();
      } else {
        const v = parseExpr(); if (v !== undefined) arr.push(v);
      }
      if (isSym(peek(), ',') || isSym(peek(), ';')) p++;
      else if (!isSym(peek(), '}')) p++;
    }
    p++; // }
    if (arr.length && Object.keys(obj).length === 0) return arr;
    if (arr.length) arr.forEach((v, idx) => { obj[idx + 1] = v; });
    return obj;
  }

  const assigns = {}; const calls = []; const returns = []; const functions = {};
  while (p < toks.length) {
    const t = peek();
    if (isName(t, 'local')) { p++; continue; }
    if (isName(t, 'function')) {
      p++;
      let fname = '';
      while (peek() && (peek().t === 'name' || isSym(peek(), '.') || isSym(peek(), ':'))) fname += toks[p++].v;
      // zapamiętaj zwracane tabele wewnątrz funkcji (np. TF2 data())
      const start = p; skipBlock(); const end = p;
      const sub = toks.slice(start, end);
      const ri = sub.findIndex((x, idx) => isName(x, 'return') && isSym(sub[idx + 1], '{'));
      if (ri >= 0) { const save = p; p = start + ri + 1; functions[fname] = parseTable(); p = save; }
      continue;
    }
    if (isName(t, 'return')) { p++; returns.push(parseExpr()); continue; }
    if (t.t === 'name' && (isSym(peek(1), '=') && !isSym(peek(2), '='))) {
      const k = t.v; p += 2; assigns[k] = parseExpr(); continue;
    }
    if (t.t === 'name' && (peek(1) && (peek(1).t === 'str' || isSym(peek(1), '{')))) {
      const name = t.v; p++; calls.push({ name, args: [parseSimple()] }); continue;
    }
    if (t.t === 'name' && isSym(peek(1), '(')) {
      const name = t.v; p += 2; const args = [];
      while (p < toks.length && !isSym(peek(), ')')) { args.push(parseExpr()); if (isSym(peek(), ',')) p++; else if (!isSym(peek(), ')')) p++; }
      p++; calls.push({ name, args }); continue;
    }
    if (t.t === 'name' && BLOCK_OPEN.has(t.v)) { p++; skipBlock(); continue; }
    p++;
  }
  return { assigns, calls, returns, functions };
}

// ---------- Paradox / Clausewitz ----------
function parseParadox(text) {
  let i = 0; const n = text.length;
  function skip() {
    while (i < n) {
      if (text[i] === '#') { while (i < n && text[i] !== '\n') i++; }
      else if (/\s/.test(text[i])) i++; else break;
    }
  }
  function token() {
    skip(); if (i >= n) return null;
    const c = text[i];
    if ('{}='.includes(c)) { i++; return { sym: c }; }
    if ('<>!'.includes(c)) { let s = c; i++; if (text[i] === '=') { s += '='; i++; } return { sym: s }; }
    if (c === '"') { i++; let s = ''; while (i < n && text[i] !== '"') { if (text[i] === '\\' && text[i + 1] === '"') { s += '"'; i += 2; } else s += text[i++]; } i++; return { v: s, q: true }; }
    let s = ''; while (i < n && !/[\s{}=<>!#"]/.test(text[i])) s += text[i++];
    return { v: s };
  }
  function block() {
    const obj = {}; const list = [];
    for (;;) {
      const t = token();
      if (!t || t.sym === '}') break;
      if (t.sym === '{') { list.push(block()); continue; }
      if (t.v === undefined) continue;
      const save = i; const nx = token();
      if (nx && nx.sym && nx.sym !== '{' && nx.sym !== '}') {
        const val = token();
        const v = val && val.sym === '{' ? block() : val ? val.v : null;
        if (obj[t.v] === undefined) obj[t.v] = v;
        else { if (!Array.isArray(obj[t.v]) || !obj[t.v].__multi) { const a = [obj[t.v]]; a.__multi = true; obj[t.v] = a; } obj[t.v].push(v); }
      } else { i = save; list.push(t.v); }
    }
    if (list.length && !Object.keys(obj).length) return list;
    if (list.length) obj.__list = list;
    return obj;
  }
  return block();
}

// ---------- SII (SCS Software: manifest.sii, versions.sii) ----------
function parseSII(text) {
  const units = [];
  const re = /([a-z_][a-z0-9_]*)\s*:\s*([.\w]+)\s*\{([\s\S]*?)\n\s*\}/gi;
  let m;
  while ((m = re.exec(text))) {
    const props = {};
    for (const line of m[3].split(/\r?\n/)) {
      const lm = line.match(/^\s*([a-z_][a-z0-9_]*)(\[\d*\])?\s*:\s*(.+?)\s*$/i);
      if (!lm) continue;
      let val = lm[3].replace(/^"(.*)"$/, '$1');
      if (lm[2] !== undefined) { (props[lm[1]] = props[lm[1]] || []).push(val); }
      else props[lm[1]] = val;
    }
    units.push({ type: m[1], name: m[2], props });
  }
  return units;
}

// ---------- INI / key=value ----------
function parseIni(text) {
  const out = { __root: {} }; let sec = out.__root;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const s = line.match(/^\[(.+)\]$/);
    if (s) { sec = out[s[1]] = out[s[1]] || {}; continue; }
    const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kv) {
      if (sec[kv[1]] !== undefined) { if (!Array.isArray(sec[kv[1]])) sec[kv[1]] = [sec[kv[1]]]; sec[kv[1]].push(kv[2]); }
      else sec[kv[1]] = kv[2];
    }
  }
  return out;
}

module.exports = { parseVDF, vget, parseLua, luaTokenize, parseParadox, parseSII, parseIni };
