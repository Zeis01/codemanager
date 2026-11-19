// Debugger w edytorze (Debug Adapter Protocol): Python przez debugpy, Lua przez wbudowany host (fengari, Lua 5.3).
// Interfejs dostaje zdarzenia debug:event i woła debug:* (kontynuuj, krok, zmienne, konsola…).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

// ---------- klient DAP: ramki Content-Length albo wiersze JSON ----------
class DapClient extends EventEmitter {
  constructor(proc, { framing = 'content-length', log = () => {} } = {}) {
    super(); this.proc = proc; this.framing = framing; this.log = log; this.seq = 0; this.pending = new Map(); this.buf = Buffer.alloc(0);
    proc.stdout.on('data', d => this.feed(d));
    proc.on('exit', code => { for (const p of this.pending.values()) p.rej(new Error('Debugger się zakończył')); this.pending.clear(); this.emit('exit', code); });
  }
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.framing === 'lines') {
      let i; while ((i = this.buf.indexOf(10)) >= 0) { const line = this.buf.slice(0, i).toString('utf8'); this.buf = this.buf.slice(i + 1); if (line.trim()) { try { this.dispatch(JSON.parse(line)); } catch { this.emit('output', line + '\n'); } } }
      return;
    }
    for (;;) {
      const h = this.buf.indexOf('\r\n\r\n'); if (h < 0) return;
      const m = this.buf.slice(0, h).toString().match(/Content-Length:\s*(\d+)/i); if (!m) { this.buf = this.buf.slice(h + 4); continue; }
      const len = +m[1]; if (this.buf.length < h + 4 + len) return;
      const body = this.buf.slice(h + 4, h + 4 + len).toString('utf8'); this.buf = this.buf.slice(h + 4 + len);
      try { this.dispatch(JSON.parse(body)); } catch { /* */ }
    }
  }
  dispatch(msg) {
    if (msg.type === 'response') { const p = this.pending.get(msg.request_seq); if (p) { this.pending.delete(msg.request_seq); clearTimeout(p.t); msg.success ? p.res(normalize(msg.body || {})) : p.rej(new Error(msg.message || 'Błąd debuggera')); } }
    else if (msg.type === 'event') this.emit('event', msg);
    else if (msg.type === 'request') this.emit('reverse', msg);
  }
  write(obj) { const s = JSON.stringify(obj); try { this.proc.stdin.write(this.framing === 'lines' ? s + '\n' : `Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); } catch { /* */ } }
  request(command, args, timeout = 30000) {
    const seq = ++this.seq;
    return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(seq); rej(new Error(`Debugger nie odpowiedział (${command})`)); }, timeout); this.pending.set(seq, { res, rej, t }); this.write({ seq, type: 'request', command, arguments: args || {} }); });
  }
  respond(req, body, success = true, message) { this.write({ seq: ++this.seq, type: 'response', request_seq: req.seq, command: req.command, success, message, body: body || {} }); }
}
// puste tablice z Lua przychodzą jako {}
function normalize(b) { for (const k of ['variables', 'stackFrames', 'scopes', 'breakpoints', 'threads']) if (b[k] && !Array.isArray(b[k])) b[k] = Object.values(b[k]); return b; }

const LANGS = { python: 'Python', lua: 'Lua' };
function langFor(file) { const e = path.extname(file).toLowerCase(); return e === '.py' ? 'python' : e === '.lua' ? 'lua' : null; }

class DebugManager {
  constructor({ emit = () => {}, pyIntel, run, hostScript = path.join(__dirname, 'luadbg-host.js'), log = () => {} }) {
    this.emitRaw = emit; this.pyIntel = pyIntel; this.run = run; this.hostScript = hostScript; this.log = log;
    this.s = null; // bieżąca sesja
    this.breakpoints = new Map(); // plik → [wiersze]
  }
  emit(type, body = {}) { this.emitRaw('debug:event', { type, ...body }); }
  status() { return this.s ? { running: true, lang: this.s.lang, program: this.s.program, state: this.s.state } : { running: false }; }
  async pythonStatus() {
    const py = this.pyIntel && await this.pyIntel.find(); if (!py) return { python: false, debugpy: false };
    const r = await this.run(py.cmd, [...py.pre, '-c', 'import debugpy;print(debugpy.__version__)'], { timeout: 15000, cwd: os.tmpdir() });
    return { python: true, version: py.version, debugpy: !!(r.ok && /\d/.test(r.stdout)), debugpyVersion: r.ok ? r.stdout.trim() : null };
  }
  async installDebugpy(log = () => {}) {
    const py = this.pyIntel && await this.pyIntel.find(); if (!py) throw new Error('Nie znaleziono Pythona. Zainstaluj go z python.org (zaznacz „Add to PATH”) albo wskaż w Ustawieniach → Edytor.');
    log(`${py.cmd} -m pip install --user debugpy`);
    const r = await this.run(py.cmd, [...py.pre, '-m', 'pip', 'install', '--user', '--upgrade', 'debugpy'], { timeout: 300000, cwd: os.tmpdir() });
    log((r.stdout || '') + (r.stderr || ''));
    if (!r.ok) throw new Error('Instalacja debugpy nie powiodła się – szczegóły w dzienniku.');
    return true;
  }
  setBreakpoints(file, lines) {
    this.breakpoints.set(path.resolve(file), [...new Set(lines)].sort((a, b) => a - b));
    if (!lines.length) this.breakpoints.delete(path.resolve(file));
    if (!this.s) return Promise.resolve(lines.map(l => ({ line: l, verified: true })));
    if (this.s.lang === 'lua' && this.s.state === 'running') { this.writeCtl({}); return Promise.resolve(lines.map(l => ({ line: l, verified: true }))); }
    return this.s.dap.request('setBreakpoints', { source: { path: path.resolve(file) }, breakpoints: lines.map(line => ({ line })) }).then(b => b.breakpoints || []).catch(() => []);
  }
  bpObject() { return Object.fromEntries([...this.breakpoints]); }
  writeCtl(extra) { if (this.s && this.s.ctl) fs.writeFileSync(this.s.ctl, JSON.stringify({ breakpoints: this.bpObject(), ...extra, t: Date.now() })); }

  async start({ program, cwd, args = [], stopOnEntry = false, lang }) {
    if (this.s) this.stop();
    lang = lang || langFor(program);
    if (!LANGS[lang]) throw new Error('Debugowanie działa dla plików .py (Python) i .lua (Lua).');
    if (!fs.existsSync(program)) throw new Error('Zapisz plik przed debugowaniem.');
    cwd = cwd || path.dirname(program);
    const s = { lang, program, cwd, state: 'starting', threadId: 1 };
    this.s = s;
    try {
      if (lang === 'lua') await this.startLua(s, args, stopOnEntry);
      else await this.startPython(s, args, stopOnEntry);
    } catch (e) { this.stop(); throw e; }
    return this.status();
  }
  wire(s) {
    s.dap.on('event', m => this.onEvent(s, m));
    s.dap.on('output', t => this.emit('output', { category: 'stdout', output: t }));
    s.dap.on('reverse', req => s.dap.respond(req, {}, false, 'Nieobsługiwane'));
    s.dap.on('exit', () => { if (this.s === s) { this.s = null; this.emit('terminated', {}); } });
    s.proc.stderr.on('data', d => this.emit('output', { category: 'stderr', output: String(d) }));
  }
  async startLua(s, args, stopOnEntry) {
    s.ctl = path.join(os.tmpdir(), `cm-luadbg-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(s.ctl, JSON.stringify({ breakpoints: this.bpObject(), stopOnEntry }));
    s.proc = spawn(process.execPath, [this.hostScript, s.program, s.ctl, s.cwd, ...args], { cwd: s.cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
    s.dap = new DapClient(s.proc, { framing: 'lines' });
    this.wire(s);
    s.state = 'running'; this.emit('started', { lang: 'lua', program: s.program });
  }
  async startPython(s, args, stopOnEntry) {
    const st = await this.pythonStatus();
    if (!st.python) throw new Error('Nie znaleziono Pythona. Zainstaluj go z python.org albo wskaż w Ustawieniach → Edytor.');
    if (!st.debugpy) throw Object.assign(new Error('Do debugowania Pythona potrzebny jest pakiet debugpy.'), { code: 'NO_DEBUGPY' });
    const py = await this.pyIntel.find();
    s.proc = spawn(py.cmd, [...py.pre, '-m', 'debugpy.adapter'], { cwd: s.cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    s.dap = new DapClient(s.proc);
    this.wire(s);
    const initialized = new Promise(res => { s.onInit = res; });
    await s.dap.request('initialize', { clientID: 'codemanager', clientName: 'CodeManager', adapterID: 'debugpy', pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsRunInTerminalRequest: false, locale: 'pl' });
    // launch odpowiada dopiero po configurationDone
    const launched = s.dap.request('launch', { name: 'CodeManager', type: 'python', request: 'launch', program: s.program, cwd: s.cwd, args, console: 'internalConsole', redirectOutput: true, justMyCode: true, stopOnEntry, python: [py.cmd, ...py.pre], env: { PYTHONIOENCODING: 'utf-8' } }, 60000);
    await Promise.race([initialized, new Promise((_, rej) => setTimeout(() => rej(new Error('debugpy nie wystartował')), 30000))]);
    for (const [file, lines] of this.breakpoints) if (/\.py$/i.test(file)) await s.dap.request('setBreakpoints', { source: { path: file }, breakpoints: lines.map(line => ({ line })) }).catch(() => {});
    await s.dap.request('setExceptionBreakpoints', { filters: ['uncaught'] }).catch(() => {});
    await s.dap.request('configurationDone', {});
    await launched;
    s.state = 'running'; this.emit('started', { lang: 'python', program: s.program });
  }
  async onEvent(s, m) {
    if (this.s !== s) return;
    const b = m.body || {};
    switch (m.event) {
      case 'initialized': if (s.onInit) s.onInit(); break;
      case 'output': if (b.category !== 'telemetry') this.emit('output', { category: b.category || 'stdout', output: b.output || '' }); break;
      case 'stopped': {
        s.state = 'stopped'; s.threadId = b.threadId || s.threadId || 1;
        let frames = [];
        try { frames = (await s.dap.request('stackTrace', { threadId: s.threadId, startFrame: 0, levels: 50 })).stackFrames || []; } catch { /* */ }
        s.frames = frames;
        this.emit('stopped', { reason: b.reason, text: b.text || b.description || null, frames: frames.map(f => ({ id: f.id, name: f.name, line: f.line, column: f.column, file: f.source && f.source.path ? path.resolve(f.source.path) : null })) });
        break;
      }
      case 'continued': s.state = 'running'; this.emit('continued', {}); break;
      case 'exited': this.emit('output', { category: 'console', output: `\nProgram zakończył się (kod ${b.exitCode}).\n` }); break;
      case 'terminated': this.stop(true); break;
    }
  }
  async cmd(action) {
    const s = this.s; if (!s) throw new Error('Debugowanie nie jest uruchomione.');
    if (action === 'pause') { if (s.lang === 'lua') this.writeCtl({ pause: true }); else await s.dap.request('pause', { threadId: s.threadId }); return true; }
    if (s.state !== 'stopped') return false;
    const map = { continue: 'continue', next: 'next', stepIn: 'stepIn', stepOut: 'stepOut' };
    if (!map[action]) throw new Error('Nieznana akcja: ' + action);
    s.state = 'running'; this.emit('continued', {});
    await s.dap.request(map[action], { threadId: s.threadId });
    return true;
  }
  async scopes(frameId) { const s = this.s; if (!s || s.state !== 'stopped') return []; return ((await s.dap.request('scopes', { frameId })).scopes || []).map(x => ({ name: x.name, ref: x.variablesReference, expensive: !!x.expensive })); }
  async variables(ref) { const s = this.s; if (!s || s.state !== 'stopped') return []; return ((await s.dap.request('variables', { variablesReference: ref })).variables || []).map(v => ({ name: v.name, value: v.value, type: v.type || '', ref: v.variablesReference || 0 })); }
  async evaluate(expression, frameId) {
    const s = this.s; if (!s) throw new Error('Debugowanie nie jest uruchomione.');
    const r = await s.dap.request('evaluate', { expression, frameId, context: 'repl' });
    return { result: r.result, type: r.type || '', ref: r.variablesReference || 0 };
  }
  stop(fromAdapter) {
    const s = this.s; if (!s) return;
    this.s = null;
    if (!fromAdapter) { try { s.dap.request('disconnect', { terminateDebuggee: true }, 2000).catch(() => {}); } catch { /* */ } }
    setTimeout(() => { try { s.proc.kill(); } catch { /* */ } }, fromAdapter ? 200 : 800);
    if (s.ctl) setTimeout(() => fs.rm(s.ctl, { force: true }, () => {}), 1000);
    this.emit('terminated', {});
  }
}

module.exports = { DebugManager, DapClient, langFor };
