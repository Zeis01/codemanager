// Minimalny klient Discorda: gateway (WebSocket) + REST API v10. Bez zewnętrznych bibliotek poza „ws”.
'use strict';
const WebSocket = require('ws');
const EventEmitter = require('events');

const API = 'https://discord.com/api/v10';
const GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = { GUILDS: 1 << 0, GUILD_MEMBERS: 1 << 1, GUILD_MESSAGES: 1 << 9, GUILD_MESSAGE_REACTIONS: 1 << 10, DIRECT_MESSAGES: 1 << 12, MESSAGE_CONTENT: 1 << 15 };
const PERMS = { ADMINISTRATOR: 1n << 3n, MANAGE_GUILD: 1n << 5n, KICK_MEMBERS: 1n << 1n, BAN_MEMBERS: 1n << 2n, MANAGE_ROLES: 1n << 28n, MODERATE_MEMBERS: 1n << 40n, MANAGE_MESSAGES: 1n << 13n };

class DiscordClient extends EventEmitter {
  constructor({ token, intents = INTENTS.GUILDS, fetchImpl = fetch, WS = WebSocket, log = () => {} }) {
    super();
    this.token = token; this.intents = intents; this.fetch = fetchImpl; this.WS = WS; this.log = log;
    this.ws = null; this.seq = null; this.session = null; this.resumeUrl = null; this.hb = null; this.acked = true; this.closed = false; this.user = null; this.appId = null; this.retries = 0;
  }
  async rest(method, route, body, { query, reason } = {}) {
    const url = API + route + (query ? '?' + new URLSearchParams(query) : '');
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await this.fetch(url, { method, headers: { Authorization: 'Bot ' + this.token, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://github.com/Zeis01/codemanager, 1.8)', ...(reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise(res => setTimeout(res, Math.min(10000, (j.retry_after || 1) * 1000))); continue; }
      if (r.status === 204) return null;
      const j = await r.json().catch(() => null);
      if (!r.ok) { const msg = j && (j.message || JSON.stringify(j.errors || j)); const e = new Error(`Discord ${r.status}: ${msg || r.statusText}`); e.status = r.status; e.code = j && j.code; throw e; }
      return j;
    }
    throw new Error('Discord: za dużo zapytań (limit).');
  }
  connect() {
    this.closed = false;
    const ws = this.ws = new this.WS(this.resumeUrl ? this.resumeUrl + '/?v=10&encoding=json' : GATEWAY);
    ws.on('message', raw => { let p; try { p = JSON.parse(raw); } catch { return; } this.onPayload(p); });
    ws.on('close', code => this.onClose(code));
    ws.on('error', e => this.log('Błąd połączenia: ' + e.message));
  }
  send(op, d) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op, d })); }
  onPayload({ op, d, s, t }) {
    if (s != null) this.seq = s;
    if (op === 10) {
      clearInterval(this.hb); this.acked = true;
      this.hb = setInterval(() => { if (!this.acked) { this.log('Brak odpowiedzi serwera Discord – łączę ponownie…'); try { this.ws.close(4000); } catch { /* */ } return; } this.acked = false; this.send(1, this.seq); }, d.heartbeat_interval);
      if (this.session && this.resumeUrl) this.send(6, { token: this.token, session_id: this.session, seq: this.seq });
      else this.send(2, { token: this.token, intents: this.intents, properties: { os: process.platform, browser: 'CodeManager', device: 'CodeManager' } });
    } else if (op === 11) this.acked = true;
    else if (op === 1) this.send(1, this.seq);
    else if (op === 7) { try { this.ws.close(4000); } catch { /* */ } }
    else if (op === 9) { this.session = null; this.resumeUrl = null; setTimeout(() => { try { this.ws.close(4000); } catch { /* */ } }, 1500); }
    else if (op === 0) {
      if (t === 'READY') { this.session = d.session_id; this.resumeUrl = d.resume_gateway_url; this.user = d.user; this.appId = d.application && d.application.id; this.retries = 0; }
      if (t === 'RESUMED') this.retries = 0;
      this.emit(t, d);
      this.emit('dispatch', t, d);
    }
  }
  onClose(code) {
    clearInterval(this.hb);
    if (this.closed) { this.emit('closed', code); return; }
    const fatal = { 4004: 'Nieprawidłowy token bota.', 4010: 'Nieprawidłowy shard.', 4011: 'Bot jest na zbyt wielu serwerach (wymagany sharding).', 4013: 'Nieprawidłowe uprawnienia (intents).', 4014: 'Bot nie ma włączonych uprzywilejowanych uprawnień (Server Members / Message Content) w panelu Discord Developer.' };
    if (fatal[code]) { this.closed = true; this.emit('fatal', fatal[code]); return; }
    if ([4007, 4009].includes(code)) { this.session = null; this.resumeUrl = null; }
    const delay = Math.min(60000, 1000 * 2 ** Math.min(this.retries++, 6));
    this.log(`Połączenie zamknięte (${code}) – ponowna próba za ${Math.round(delay / 1000)} s`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
  close() { this.closed = true; clearInterval(this.hb); clearTimeout(this.reconnectTimer); try { this.ws && this.ws.close(1000); } catch { /* */ } }
}

module.exports = { DiscordClient, INTENTS, PERMS, API };
