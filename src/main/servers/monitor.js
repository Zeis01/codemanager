// Monitor serwerów: zużycie CPU/RAM, liczba graczy, zdarzenia z konsoli (wejścia, czat, postęp Chunky)
'use strict';
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// ---------- gracze z logów ----------
const PATTERNS = {
  minecraft: { join: /:\s(\.?[A-Za-z0-9_]{2,16})\sjoined the game/, leave: /:\s(\.?[A-Za-z0-9_]{2,16})\sleft the game/, chat: /:\s<([^>]{2,16})>\s(.*)$/, list: /There are (\d+) of a max(?: of)? \d+ players online:\s*(.*)$/ },
  projectzomboid: { join: /\[fully-connected\].*?username="([^"]+)"/, leave: /\[disconnect\].*?username="([^"]+)"/, chat: /\[chat\].*?author='([^']+)'.*?text='([^']*)'/i },
  terraria: { join: /^(?:\[[^\]]*\]\s*)?(.+?) has joined\.?$/, leave: /^(?:\[[^\]]*\]\s*)?(.+?) has left\.?$/, chat: /^<([^>]+)>\s(.*)$/ },
  rust: { join: /\/\d{17}\/(.+?) joined \[/, leave: /\/\d{17}\/(.+?) disconnecting/, chat: /^\[CHAT\]\s(.+?)\[\d+\]\s:\s(.*)$/ },
  palworld: { join: /\b(.+?) joined the server/, leave: /\b(.+?) left the server/, chat: /\[CHAT\]\s<([^>]+)>\s(.*)$/ },
  ark: { join: /: (.+?) joined this ARK!/, leave: /: (.+?) left this ARK!/ },
  enshrouded: { join: /Player '(.+?)' logged in/, leave: /Remove Player '(.+?)'/ },
  mta: { join: /CONNECT: (\S+) connected/, leave: /QUIT: (\S+) left the game/, chat: /^CHAT: (\S+): (.*)$/ },
  cs2: { join: /"(.+?)<\d+><[^>]*><[^>]*>" connected/, leave: /"(.+?)<\d+><[^>]*><[^>]*>" disconnected/, chat: /"(.+?)<\d+><[^>]*><[^>]*>" say "(.*)"/ },
  tf2: { join: /"(.+?)<\d+><[^>]*><[^>]*>" connected/, leave: /"(.+?)<\d+><[^>]*><[^>]*>" disconnected/, chat: /"(.+?)<\d+><[^>]*><[^>]*>" say "(.*)"/ },
  l4d2: { join: /"(.+?)<\d+><[^>]*><[^>]*>" connected/, leave: /"(.+?)<\d+><[^>]*><[^>]*>" disconnected/, chat: /"(.+?)<\d+><[^>]*><[^>]*>" say "(.*)"/ },
  unturned: { join: /Connecting: PlayerID: \d+ Name: (.+?) Character:/, leave: /Disconnecting: PlayerID: \d+ Name: (.+?)(?: Character:|$)/, chat: /^\[(?:World|Area|Group)\] (.+?): (.*)$/ },
  valheim: { count: /Connections (\d+) ZDOS/, join: /Got character ZDOID from (.+?) :/ },
  satisfactory: { join: /Join succeeded: (.+)$/, leave: /UNetConnection::Close.*?Name: (.+?),/ },
};
const CHUNKY = /\[Chunky\]\s*Task running for (\S+)\.\s*Processed:\s*([\d,]+)\s*chunks\s*\(([\d.,]+)%\)(?:,\s*ETA:\s*([\d:]+))?/i;
const CHUNKY_DONE = /\[Chunky\]\s*Task (?:finished|cancelled|stopped) for (\S+)/i;

function parseLine(type, line) {
  const p = PATTERNS[type]; const out = [];
  let m;
  if ((m = line.match(CHUNKY))) out.push({ kind: 'chunky', world: m[1], chunks: +m[2].replace(/,/g, ''), pct: +m[3].replace(',', '.'), eta: m[4] || null });
  else if ((m = line.match(CHUNKY_DONE))) out.push({ kind: 'chunky-done', world: m[1], finished: /finished/i.test(line) });
  if (!p) return out;
  if (p.list && (m = line.match(p.list))) out.push({ kind: 'list', count: +m[1], names: m[2].split(',').map(s => s.trim()).filter(Boolean) });
  else if (p.join && (m = line.match(p.join))) out.push({ kind: 'join', name: m[1].trim() });
  else if (p.leave && (m = line.match(p.leave))) out.push({ kind: 'leave', name: m[1].trim() });
  else if (p.chat && (m = line.match(p.chat))) out.push({ kind: 'chat', name: m[1].trim(), text: m[2] });
  if (p.count && (m = line.match(p.count))) out.push({ kind: 'count', count: +m[1] });
  return out;
}
function isChat(type, line) { const p = PATTERNS[type]; return !!(p && p.chat && p.chat.test(line)); }

// ---------- akcje na graczach ----------
const q = n => `"${String(n).replace(/"/g, '')}"`;
const ACTIONS = {
  minecraft: { kick: n => `kick ${n}`, ban: n => `ban ${n}`, pardon: n => `pardon ${n}`, op: n => `op ${n}`, deop: n => `deop ${n}`, wlAdd: n => `whitelist add ${n}`, wlRemove: n => `whitelist remove ${n}`, list: 'list' },
  projectzomboid: { kick: n => `kickuser ${q(n)}`, ban: n => `banuser ${q(n)}`, pardon: n => `unbanuser ${q(n)}`, op: n => `setaccesslevel ${q(n)} admin`, deop: n => `setaccesslevel ${q(n)} none`, wlAdd: n => `addusertowhitelist ${q(n)}`, wlRemove: n => `removeuserfromwhitelist ${q(n)}`, list: 'players' },
  terraria: { kick: n => `kick ${q(n)}`, ban: n => `ban add ${q(n)}`, pardon: n => `ban del ${q(n)}`, list: 'playing' },
  rust: { kick: n => `kick ${q(n)}`, ban: n => `ban ${q(n)}`, pardon: n => `unban ${q(n)}`, list: 'status' },
  cs2: { kick: n => `kick ${q(n)}`, list: 'status' },
  tf2: { kick: n => `kick ${q(n)}`, list: 'status' },
  mta: { kick: n => `kick ${n}`, ban: n => `ban ${n}`, list: 'players' },
  l4d2: { kick: n => `kick ${q(n)}`, list: 'status' },
  unturned: { kick: n => `kick ${n}`, ban: n => `ban ${n}`, pardon: n => `unban ${n}`, op: n => `admin ${n}`, deop: n => `unadmin ${n}`, wlAdd: n => `permit ${n}`, wlRemove: n => `unpermit ${n}`, list: 'players' },
};
const ACTION_LABELS = { kick: 'Wyrzuć', ban: 'Zbanuj', pardon: 'Odbanuj', op: 'Nadaj operatora', deop: 'Odbierz operatora', wlAdd: 'Dodaj do białej listy', wlRemove: 'Usuń z białej listy' };

// ---------- zużycie zasobów ----------
const CLK = 100; // sysconf(_SC_CLK_TCK) na Linuksie
function linuxProcs() {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const rest = st.slice(st.lastIndexOf(')') + 2).split(' ');
      const rss = +fs.readFileSync(`/proc/${d}/statm`, 'utf8').split(' ')[1] * 4096;
      out.push({ pid: +d, ppid: +rest[1], cpuMs: (+rest[11] + +rest[12]) * (1000 / CLK), rss });
    } catch { /* proces zniknął */ }
  }
  return out;
}
function parseWinCsv(text) {
  const lines = text.trim().split(/\r?\n/); const out = [];
  for (const l of lines.slice(1)) {
    const c = l.split(',').map(s => s.replace(/^"|"$/g, ''));
    if (c.length < 5 || !/^\d+$/.test(c[0])) continue;
    out.push({ pid: +c[0], ppid: +c[1], cpuMs: (+c[2] + +c[3]) / 10000, rss: +c[4] });
  }
  return out;
}
function winProcs() {
  return new Promise(res => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize | ConvertTo-Csv -NoTypeInformation'], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => res(err ? [] : parseWinCsv(String(stdout))));
  });
}
// sumy dla procesu i wszystkich jego potomków
function treeTotals(procs, rootPid) {
  const kids = new Map(); for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const self = procs.find(p => p.pid === rootPid); if (!self) return null;
  let cpuMs = 0, rss = 0; const stack = [self]; const seen = new Set();
  while (stack.length) { const p = stack.pop(); if (seen.has(p.pid)) continue; seen.add(p.pid); cpuMs += p.cpuMs; rss += p.rss; for (const k of kids.get(p.pid) || []) stack.push(k); }
  return { cpuMs, rss, count: seen.size };
}

class Monitor {
  constructor({ mgr, emit, interval = 10000, keep = 8640 }) {
    this.mgr = mgr; this.emit = emit; this.interval = interval; this.keep = keep;
    this.state = new Map(); this.prev = new Map(); this.timer = null; this.sampling = false; this.onAlarm = null; this.alarmState = new Map();
  }
  st(id) { if (!this.state.has(id)) this.state.set(id, { players: new Set(), count: null, history: [], chunky: null, chat: [] }); return this.state.get(id); }
  // wywoływane dla każdej linii konsoli
  onLine(id, type, line) {
    const st = this.st(id); const ev = parseLine(type, line); const out = [];
    for (const e of ev) {
      if (e.kind === 'join') { if (!st.players.has(e.name)) { st.players.add(e.name); out.push(e); } }
      else if (e.kind === 'leave') { if (st.players.delete(e.name)) out.push(e); }
      else if (e.kind === 'list') { st.players = new Set(e.names); st.count = e.count; }
      else if (e.kind === 'count') st.count = e.count;
      else if (e.kind === 'chat') { st.chat.push({ t: Date.now(), name: e.name, text: e.text }); if (st.chat.length > 300) st.chat.shift(); }
      else if (e.kind === 'chunky') { st.chunky = { ...e, running: true, at: Date.now() }; this.emit('server:chunky', { id, ...st.chunky }); }
      else if (e.kind === 'chunky-done') { st.chunky = { ...(st.chunky || {}), running: false, finished: e.finished, pct: e.finished ? 100 : (st.chunky || {}).pct }; this.emit('server:chunky', { id, ...st.chunky }); }
    }
    if (ev.some(e => ['join', 'leave', 'list', 'count'].includes(e.kind))) this.emit('server:players', { id, players: [...st.players], count: this.count(id) });
    return out;
  }
  count(id) { const st = this.st(id); return st.count != null && !st.players.size ? st.count : st.players.size; }
  reset(id) { const st = this.st(id); st.players.clear(); st.count = null; this.emit('server:players', { id, players: [], count: 0 }); }
  players(id) { const st = this.st(id); return { players: [...st.players], count: this.count(id), chunky: st.chunky }; }
  history(id) { return this.st(id).history; }

  // alarm: wartość powyżej progu przez zadany czas → jedno powiadomienie, ponowne dopiero po spadku poniżej progu
  checkAlarm(id, point) {
    const srv = (this.mgr.servers || []).find(x => x.id === id); const a = srv && srv.alarm;
    if (!a || !a.enabled) return;
    const minutes = Math.max(1, +a.minutes || 5);
    const st = this.alarmState.get(id) || {}; this.alarmState.set(id, st);
    const checks = [['cpu', point.cpu, +a.cpu], ['mem', point.mem, +a.ramMB ? +a.ramMB * 1048576 : 0]];
    for (const [kind, value, limit] of checks) {
      if (!limit || value == null) continue;
      const s = st[kind] = st[kind] || { since: null, fired: false };
      if (value > limit) {
        if (!s.since) s.since = point.t;
        if (!s.fired && point.t - s.since >= minutes * 60000) { s.fired = true; if (this.onAlarm) this.onAlarm(id, { kind, value, limit: kind === 'mem' ? +a.ramMB : limit, minutes }); }
      } else { s.since = null; s.fired = false; }
    }
  }
  start() { if (!this.timer) this.timer = setInterval(() => this.sample().catch(() => {}), this.interval); }
  stop() { clearInterval(this.timer); this.timer = null; }
  async sample() {
    if (this.sampling) return; const running = [...this.mgr.procs.entries()]; if (!running.length) return;
    this.sampling = true;
    try {
      const procs = process.platform === 'win32' ? await winProcs() : process.platform === 'linux' ? linuxProcs() : [];
      const now = Date.now(); const cores = os.cpus().length || 1;
      for (const [id, p] of running) {
        const tot = treeTotals(procs, p.pid); if (!tot) continue;
        const prev = this.prev.get(id); this.prev.set(id, { t: now, cpuMs: tot.cpuMs });
        const cpu = prev && now > prev.t ? Math.max(0, Math.min(100, ((tot.cpuMs - prev.cpuMs) / (now - prev.t)) * 100 / cores)) : null;
        const point = { t: now, cpu: cpu == null ? null : Math.round(cpu * 10) / 10, mem: tot.rss, players: this.count(id) };
        const h = this.st(id).history; h.push(point); if (h.length > this.keep) h.splice(0, h.length - this.keep);
        this.emit('server:stats', { id, ...point });
        this.checkAlarm(id, point);
      }
    } finally { this.sampling = false; }
  }
}

module.exports = { Monitor, parseLine, isChat, PATTERNS, ACTIONS, ACTION_LABELS, treeTotals, parseWinCsv };
