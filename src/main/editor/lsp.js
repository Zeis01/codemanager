// Serwery języka (LSP) dla edytora: diagnostyka, przejdź do definicji, użycia, zmiana nazw, formatowanie.
// Lua – lua-language-server (z bibliotekami API gier), Python – Pyright, C# – csharp-ls, Java – Eclipse JDT LS.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const U = require('../util');

// ---------- JSON-RPC przez stdio ----------
class RpcConnection {
  constructor(proc, { onNotify, onRequest, log }) {
    this.proc = proc; this.onNotify = onNotify; this.onRequest = onRequest; this.log = log || (() => {});
    this.buf = Buffer.alloc(0); this.id = 0; this.pending = new Map();
    proc.stdout.on('data', d => this.feed(d));
    proc.stderr.on('data', d => this.log(String(d).trim()));
  }
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n'); if (sep < 0) return;
      const head = this.buf.slice(0, sep).toString('ascii'); const m = head.match(/Content-Length:\s*(\d+)/i);
      if (!m) { this.buf = this.buf.slice(sep + 4); continue; }
      const len = +m[1]; if (this.buf.length < sep + 4 + len) return;
      const body = this.buf.slice(sep + 4, sep + 4 + len).toString('utf8'); this.buf = this.buf.slice(sep + 4 + len);
      let msg; try { msg = JSON.parse(body); } catch { continue; }
      this.dispatch(msg);
    }
  }
  dispatch(msg) {
    if (msg.id != null && (msg.result !== undefined || msg.error) && !msg.method) {
      const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.rej(new Error(msg.error.message || 'Błąd serwera języka')); else p.res(msg.result);
    } else if (msg.method && msg.id != null) {
      Promise.resolve(this.onRequest ? this.onRequest(msg.method, msg.params) : null).then(result => this.write({ jsonrpc: '2.0', id: msg.id, result: result === undefined ? null : result }), e => this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }));
    } else if (msg.method && this.onNotify) this.onNotify(msg.method, msg.params);
  }
  write(obj) { const s = JSON.stringify(obj); try { this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`); } catch { /* proces zamknięty */ } }
  request(method, params, timeout = 20000) {
    const id = ++this.id;
    return new Promise((res, rej) => { const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('Serwer języka nie odpowiada')); }, timeout); this.pending.set(id, { res, rej, timer }); this.write({ jsonrpc: '2.0', id, method, params }); });
  }
  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }
  close() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.rej(new Error('Serwer języka zamknięty')); } this.pending.clear(); }
}

const exe = (w, n) => (U.isWin ? w : n);
const LUA_VERSION = { fivem: 'Lua 5.4', redm: 'Lua 5.4', gmod: 'LuaJIT', mta: 'Lua 5.1', pz: 'Lua 5.1', dst: 'Lua 5.1', factorio: 'Lua 5.2', beammp: 'Lua 5.3', stormworks: 'Lua 5.3', teardown: 'Lua 5.1' };

class LspManager {
  constructor({ userData, emit = () => {}, net, luaApi, getTeardownPath, log = () => {} }) {
    this.dir = path.join(userData, 'lsp'); this.emit = emit; this.net = net; this.luaApi = luaApi; this.getTeardownPath = getTeardownPath || (() => null); this.log = log;
    this.servers = new Map(); // klucz lang|root|profil → { conn, proc, ready, caps }
  }
  // ---------- definicje serwerów ----------
  defs() {
    const luaBin = path.join(this.dir, 'lua-language-server', 'bin', exe('lua-language-server.exe', 'lua-language-server'));
    const pyr = path.join(this.dir, 'pyright', 'package', 'langserver.index.js');
    const jdtls = path.join(this.dir, 'jdtls');
    return {
      lua: { name: 'Lua (lua-language-server)', installed: U.exists(luaBin), cmd: () => ({ cmd: luaBin, args: [] }), size: '≈ 10 MB' },
      python: { name: 'Python (Pyright)', installed: U.exists(pyr), cmd: () => ({ cmd: process.execPath, args: [pyr, '--stdio'], env: { ELECTRON_RUN_AS_NODE: '1' } }), size: '≈ 20 MB' },
      csharp: { name: 'C# (csharp-ls)', installed: !!this.which('csharp-ls'), cmd: () => ({ cmd: this.which('csharp-ls') || 'csharp-ls', args: [] }), size: 'wymaga .NET SDK', needs: 'dotnet' },
      java: { name: 'Java (Eclipse JDT LS)', installed: U.isDir(path.join(jdtls, 'plugins')), cmd: root => this.jdtlsCmd(jdtls, root), size: '≈ 60 MB, wymaga Javy 21', needs: 'java' },
    };
  }
  which(name) {
    const dirs = (process.env.PATH || '').split(path.delimiter).concat(path.join(os.homedir(), '.dotnet', 'tools'));
    for (const d of dirs) for (const ext of U.isWin ? ['.exe', '.cmd', ''] : ['']) { const p = path.join(d, name + ext); if (U.exists(p)) return p; }
    return null;
  }
  jdtlsCmd(dir, root) {
    const launcher = U.listFiles(path.join(dir, 'plugins')).find(f => /org\.eclipse\.equinox\.launcher_.*\.jar$/.test(f));
    if (!launcher) throw new Error('Niekompletna instalacja JDT LS – zainstaluj ponownie.');
    const data = path.join(this.dir, 'jdtls-data', Buffer.from(root).toString('base64url').slice(-40));
    return { cmd: this.javaPath || 'java', args: ['-Declipse.application=org.eclipse.jdt.ls.core.id1', '-Dosgi.bundles.defaultStartLevel=4', '-Declipse.product=org.eclipse.jdt.ls.core.product', '-Xmx1G', '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED', '--add-opens', 'java.base/java.lang=ALL-UNNAMED', '-jar', launcher, '-configuration', path.join(dir, exe('config_win', process.platform === 'darwin' ? 'config_mac' : 'config_linux')), '-data', data] };
  }
  status() { const d = this.defs(); return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { name: v.name, installed: v.installed, size: v.size, running: [...this.servers.keys()].some(x => x.startsWith(k + '|')) }])); }

  // ---------- instalacja ----------
  async install(lang, { log = () => {}, progress } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    const N = this.net;
    if (lang === 'lua') {
      const rel = await N.githubLatest('LuaLS/lua-language-server', U.isWin ? /win32-x64\.zip$/i : process.platform === 'darwin' ? /darwin-x64\.tar\.gz$/i : /linux-x64\.tar\.gz$/i);
      log(`Pobieranie ${rel.name}…`);
      const f = await N.download(rel.url, N.tempFile(rel.name), progress);
      const dest = path.join(this.dir, 'lua-language-server'); fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
      if (/\.zip$/i.test(rel.name)) N.extractZip(f, dest); else await N.extractTar(f, dest);
      if (!U.isWin) try { fs.chmodSync(path.join(dest, 'bin', 'lua-language-server'), 0o755); } catch { /* */ }
      return rel.tag;
    }
    if (lang === 'python') {
      const meta = await N.getJSON('https://registry.npmjs.org/pyright/latest');
      log(`Pobieranie Pyright ${meta.version}…`);
      const f = await N.download(meta.dist.tarball, N.tempFile(`pyright-${meta.version}.tgz`), progress);
      const dest = path.join(this.dir, 'pyright'); fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
      await N.extractTar(f, dest);
      return meta.version;
    }
    if (lang === 'csharp') {
      const dotnet = this.which('dotnet'); if (!dotnet) throw new Error('Do C# potrzebny jest .NET SDK (dotnet.microsoft.com/download). Zainstaluj go i spróbuj ponownie.');
      log('dotnet tool install --global csharp-ls');
      await new Promise((res, rej) => execFile(dotnet, ['tool', 'update', '--global', 'csharp-ls'], { windowsHide: true, timeout: 300000 }, (e, out, err) => { log(String(out || '') + String(err || '')); e ? rej(new Error('Instalacja csharp-ls nie powiodła się: ' + (err || e.message))) : res(); }));
      return 'csharp-ls';
    }
    if (lang === 'java') {
      log('Pobieranie Eclipse JDT Language Server…');
      const f = await N.download('https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz', N.tempFile('jdtls.tar.gz'), progress);
      const dest = path.join(this.dir, 'jdtls'); fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
      await N.extractTar(f, dest);
      return 'jdtls';
    }
    throw new Error('Nieznany język: ' + lang);
  }

  // ---------- biblioteki API gier dla lua-language-server ----------
  luaLibrary(profile) {
    if (!profile || profile === 'lua') return [];
    if (profile === 'teardown') { const p = this.getTeardownPath(); return p && U.exists(path.join(p, 'data', 'script_defs.lua')) ? [path.join(p, 'data')] : []; }
    const db = this.luaApi && this.luaApi.load(profile); if (!db) return [];
    const dir = path.join(this.dir, 'lua-libs', profile);
    const file = path.join(dir, profile + '.lua');
    if (!U.exists(file) || (db.built && U.readText(path.join(dir, '.built'), '') !== db.built)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, stubsFromDb(db));
      fs.writeFileSync(path.join(dir, '.built'), db.built || '');
    }
    return [dir];
  }

  // ---------- uruchamianie ----------
  key(lang, root, profile) { return `${lang}|${root}|${profile || ''}`; }
  async ensure(lang, root, profile) {
    const k = this.key(lang, root, profile);
    if (this.servers.has(k)) return this.servers.get(k).ready;
    const def = this.defs()[lang]; if (!def) throw new Error('Brak serwera języka dla ' + lang);
    if (!def.installed) throw new Error('Serwer języka nie jest zainstalowany.');
    const c = def.cmd(root);
    const proc = spawn(c.cmd, c.args, { cwd: root, env: { ...process.env, ...(c.env || {}) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const entry = { proc, lang, root, profile, docs: new Set() };
    const settings = this.settingsFor(lang, profile);
    entry.conn = new RpcConnection(proc, {
      log: m => this.log(`[${lang}] ${m}`),
      onNotify: (method, params) => { if (method === 'textDocument/publishDiagnostics') this.emit('lsp:diagnostics', { lang, uri: params.uri, diagnostics: params.diagnostics }); },
      onRequest: (method, params) => {
        if (method === 'workspace/configuration') return (params.items || []).map(it => { const sec = it.section || ''; return sec.split('.').reduce((o, p) => (o == null ? o : o[p]), settings) ?? null; });
        if (method === 'workspace/workspaceFolders') return [{ uri: pathToFileURL(root).href, name: path.basename(root) }];
        return null;
      },
    });
    proc.on('error', e => { this.log(`[${lang}] ${e.message}`); this.servers.delete(k); });
    proc.on('exit', () => { entry.conn.close(); this.servers.delete(k); this.emit('lsp:stopped', { lang, root }); });
    this.servers.set(k, entry);
    entry.ready = (async () => {
      const init = await entry.conn.request('initialize', {
        processId: process.pid, rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
        initializationOptions: lang === 'lua' ? { } : undefined,
        capabilities: {
          textDocument: { synchronization: { didSave: true, dynamicRegistration: false }, publishDiagnostics: { relatedInformation: true }, hover: { contentFormat: ['markdown', 'plaintext'] }, definition: {}, references: {}, rename: { prepareSupport: false }, formatting: {}, completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } }, signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } } },
          workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
        },
      }, 60000);
      entry.caps = init.capabilities || {};
      entry.conn.notify('initialized', {});
      entry.conn.notify('workspace/didChangeConfiguration', { settings });
      return { capabilities: entry.caps };
    })();
    entry.ready.catch(() => { try { proc.kill(); } catch { /* */ } this.servers.delete(k); });
    return entry.ready;
  }
  settingsFor(lang, profile) {
    if (lang === 'lua') return { Lua: { runtime: { version: LUA_VERSION[profile] || 'Lua 5.4' }, workspace: { library: this.luaLibrary(profile), checkThirdParty: false }, diagnostics: { globals: profile === 'fivem' || profile === 'redm' ? ['source', 'exports', 'GlobalState', 'LocalPlayer', 'Player', 'Entity', 'vector2', 'vector3', 'vector4', 'quat', 'vec', 'mat'] : profile === 'gmod' ? ['GM', 'GAMEMODE', 'ENT', 'SWEP', 'TOOL', 'EFFECT', 'PANEL', 'CLIENT', 'SERVER'] : [] }, telemetry: { enable: false }, hint: { enable: true } } };
    if (lang === 'python') return { python: { analysis: { typeCheckingMode: 'basic', autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly' } } };
    return {};
  }
  entry(lang, root, profile) { return this.servers.get(this.key(lang, root, profile)); }
  async open(lang, root, profile, file, text, languageId) {
    await this.ensure(lang, root, profile);
    const e = this.entry(lang, root, profile); const uri = pathToFileURL(file).href;
    if (e.docs.has(uri)) { e.conn.notify('textDocument/didChange', { textDocument: { uri, version: Date.now() }, contentChanges: [{ text }] }); return uri; }
    e.docs.add(uri); e.conn.notify('textDocument/didOpen', { textDocument: { uri, languageId: languageId || lang, version: 1, text } });
    return uri;
  }
  change(lang, root, profile, file, text) { const e = this.entry(lang, root, profile); if (!e) return false; const uri = pathToFileURL(file).href; if (!e.docs.has(uri)) return false; e.conn.notify('textDocument/didChange', { textDocument: { uri, version: Date.now() }, contentChanges: [{ text }] }); return true; }
  close(lang, root, profile, file) { const e = this.entry(lang, root, profile); if (!e) return; const uri = pathToFileURL(file).href; if (e.docs.delete(uri)) e.conn.notify('textDocument/didClose', { textDocument: { uri } }); }
  async request(lang, root, profile, method, params) { await this.ensure(lang, root, profile); return this.entry(lang, root, profile).conn.request(method, params); }
  stopAll() { for (const e of this.servers.values()) { try { e.conn.request('shutdown', null, 2000).finally(() => { e.conn.notify('exit'); setTimeout(() => { try { e.proc.kill(); } catch { /* */ } }, 500); }); } catch { /* */ } } this.servers.clear(); }
}

// zmiany WorkspaceEdit w plikach, które nie są otwarte w edytorze
function applyTextEdits(text, edits) {
  const lines = text.split('\n'); const offs = [0]; for (const l of lines) offs.push(offs[offs.length - 1] + l.length + 1);
  const at = p => Math.min(text.length, (offs[p.line] ?? text.length) + p.character);
  for (const e of [...edits].sort((a, b) => at(b.range.start) - at(a.range.start))) text = text.slice(0, at(e.range.start)) + e.newText + text.slice(at(e.range.end));
  return text;
}
function applyWorkspaceEdit(edit, skipUris = []) {
  const changes = {};
  if (edit.changes) Object.assign(changes, edit.changes);
  for (const dc of edit.documentChanges || []) if (dc.textDocument) changes[dc.textDocument.uri] = (changes[dc.textDocument.uri] || []).concat(dc.edits);
  const done = [];
  for (const [uri, edits] of Object.entries(changes)) {
    if (skipUris.includes(uri)) continue;
    const file = fileURLToPath(uri);
    fs.writeFileSync(file, applyTextEdits(U.readText(file, ''), edits)); done.push(file);
  }
  return done;
}

// ---------- baza podpowiedzi → pliki ---@meta dla lua-language-server ----------
function stubsFromDb(db) {
  const out = ['---@meta', `-- Definicje API: ${db.name || db.id} (wygenerowane przez CodeManager z bazy podpowiedzi)`, ''];
  const ident = n => /^[A-Za-z_]\w*$/.test(n);
  const doc = d => (d ? String(d).split('\n').slice(0, 12).map(l => '---' + l) : []);
  const looseNatives = ['fivem', 'redm'].includes(db.id); // natywne funkcje CFX przyjmują pominięte argumenty jako nil
  const fn = (owner, sep, name, e) => {
    const sig = String(e[1] || '()'); const m = sig.match(/^\((.*)\)(?::\s*(.+))?$/); const params = m ? splitTop(m[1]) : [];
    const names = [];
    const lines = doc(e[3]);
    params.forEach((p, i) => { const mm = p.trim().match(/^(\.\.\.|[A-Za-z_]\w*)(\?)?\s*(?::\s*(.+))?$/); const n = mm ? mm[1] : 'arg' + (i + 1); names.push(n); lines.push(`---@param ${n}${(mm && mm[2]) || (looseNatives && !owner) ? '?' : ''} ${luaType(mm && mm[3])}`); });
    if (m && m[2]) lines.push(`---@return ${luaType(m[2])}`);
    if (e[5]) lines.push('---@deprecated');
    lines.push(`function ${owner ? owner + sep : ''}${name}(${names.join(', ')}) end`, '');
    return lines;
  };
  for (const [t, members] of Object.entries(db.tables || {})) {
    if (!t.split('.').every(ident)) continue;
    out.push(...doc(members.__doc), `${t} = ${t} or {}`, '');
    for (const [n, e] of Object.entries(members)) { if (n === '__doc' || !ident(n)) continue; if (e[0] === 'f') out.push(...fn(t, '.', n, e)); else if (e[0] !== 't') out.push(...doc(e[3]), `---@type ${luaType(e[2]) || 'any'}`, `${t}.${n} = nil`, ''); }
  }
  for (const [c, def] of Object.entries(db.classes || {})) {
    if (!ident(c)) continue;
    out.push(`---@class ${c}${def.b && ident(def.b) ? ' : ' + def.b : ''}`);
    for (const [n, e] of Object.entries(def.m || {})) if (e[0] !== 'f' && ident(n)) out.push(`---@field ${n} ${luaType(e[2]) || 'any'}`);
    out.push(`local ${c} = {}`, '');
    for (const [n, e] of Object.entries(def.m || {})) if (e[0] === 'f' && ident(n)) out.push(...fn(c, db.dot ? '.' : ':', n, e));
  }
  for (const [n, e] of Object.entries(db.globals || {})) {
    if (!ident(n) || (db.tables || {})[n]) continue;
    if (e[0] === 'f') out.push(...fn(null, '', n, e)); else out.push(...doc(e[3]), `---@type ${luaType((db.vars || {})[n] || e[2]) || 'any'}`, `${n} = nil`, '');
  }
  return out.join('\n');
}
function splitTop(s) { const out = []; let d = 0; let cur = ''; for (const ch of s) { if ('([{<'.includes(ch)) d++; if (')]}>'.includes(ch)) d--; if (ch === ',' && !d) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
function luaType(t) { t = String(t || '').trim(); if (!t) return 'any'; return t.replace(/\bvoid\b/g, 'nil').replace(/\bundefined\b/g, 'nil').replace(/\bfunction\b(?!\()/g, 'function').replace(/[^\w.|[\]<>, ?]/g, '').slice(0, 80) || 'any'; }

module.exports = { LspManager, RpcConnection, stubsFromDb, applyTextEdits, applyWorkspaceEdit, LUA_VERSION };
