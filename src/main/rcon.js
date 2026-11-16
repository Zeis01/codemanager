// Klienci zdalnej konsoli: Source RCON (TCP) i Quake/FiveM RCON (UDP). WebRCON (Rust) działa w interfejsie przez WebSocket.
'use strict';
const net = require('net');
const dgram = require('dgram');

const SERVERDATA_AUTH = 3, SERVERDATA_EXECCOMMAND = 2, SERVERDATA_AUTH_RESPONSE = 2, SERVERDATA_RESPONSE_VALUE = 0;

function packet(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0); buf.writeInt32LE(id, 4); buf.writeInt32LE(type, 8); b.copy(buf, 12);
  return buf;
}

class SourceRcon {
  constructor({ host, port, password, timeout = 5000 }) { Object.assign(this, { host, port: +port, password, timeout }); this.buf = Buffer.alloc(0); this.pending = new Map(); this.nextId = 10; this.connected = false; }
  connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      this.sock = sock;
      const t = setTimeout(() => { sock.destroy(); reject(new Error('Przekroczono czas połączenia – sprawdź adres, port i czy RCON jest włączony.')); }, this.timeout);
      sock.on('error', e => { clearTimeout(t); this.connected = false; reject(new Error(e.code === 'ECONNREFUSED' ? 'Połączenie odrzucone – serwer nie działa lub RCON jest wyłączony.' : e.message)); });
      sock.on('close', () => { this.connected = false; for (const p of this.pending.values()) p.reject(new Error('Połączenie zamknięte')); this.pending.clear(); this.onClose && this.onClose(); });
      sock.on('data', d => this.onData(d));
      sock.on('connect', () => {
        const id = this.nextId++;
        this.authCb = ok => { clearTimeout(t); if (ok) { this.connected = true; resolve(true); } else { sock.destroy(); reject(new Error('Nieprawidłowe hasło RCON.')); } };
        this.authId = id;
        sock.write(packet(id, SERVERDATA_AUTH, this.password || ''));
      });
    });
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const size = this.buf.readInt32LE(0);
      if (this.buf.length < size + 4) break;
      const id = this.buf.readInt32LE(4), type = this.buf.readInt32LE(8);
      const body = this.buf.toString('utf8', 12, 4 + size - 2);
      this.buf = this.buf.subarray(4 + size);
      if (this.authCb && type === SERVERDATA_AUTH_RESPONSE) { const cb = this.authCb; this.authCb = null; cb(id !== -1 && id === this.authId); continue; }
      const p = this.pending.get(id);
      if (p) { p.parts.push(body); clearTimeout(p.timer); p.timer = setTimeout(() => this.finish(id), 180); }
      else if (this.endMarker && this.endMarker.has(id)) { const real = this.endMarker.get(id); this.endMarker.delete(id); this.finish(real); }
    }
  }
  finish(id) { const p = this.pending.get(id); if (!p) return; this.pending.delete(id); clearTimeout(p.timer); clearTimeout(p.hard); p.resolve(p.parts.join('')); }
  exec(cmd) {
    if (!this.connected) return Promise.reject(new Error('Brak połączenia RCON'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const p = { parts: [], resolve, reject, timer: null };
      p.hard = setTimeout(() => this.finish(id), this.timeout);
      this.pending.set(id, p);
      this.sock.write(packet(id, SERVERDATA_EXECCOMMAND, cmd));
    });
  }
  close() { try { this.sock && this.sock.destroy(); } catch { /* */ } }
}

// Quake-style (FiveM/RedM): pakiet UDP "\xFF\xFF\xFF\xFFrcon <hasło> <polecenie>"
class QuakeRcon {
  constructor({ host, port, password, timeout = 3000 }) { Object.assign(this, { host, port: +port, password, timeout }); this.connected = true; }
  async connect() { const r = await this.exec('status'); if (/bad rcon/i.test(r)) throw new Error('Nieprawidłowe hasło RCON.'); return true; }
  exec(cmd) {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket('udp4'); const parts = []; let timer;
      const done = () => { try { s.close(); } catch { /* */ } resolve(parts.join('').replace(/^\xff{4}print\n?/gm, '')); };
      s.on('message', m => { parts.push(m.toString('latin1').replace(/^�{0,4}/, '').replace(/^\xff\xff\xff\xffprint\n?/, '')); clearTimeout(timer); timer = setTimeout(done, 200); });
      s.on('error', e => { try { s.close(); } catch { /* */ } reject(e); });
      const msg = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from(`rcon ${this.password} ${cmd}`, 'latin1')]);
      s.send(msg, this.port, this.host, err => { if (err) reject(err); });
      timer = setTimeout(() => { if (!parts.length) { try { s.close(); } catch { /* */ } reject(new Error('Brak odpowiedzi serwera (UDP).')); } else done(); }, this.timeout);
    });
  }
  close() {}
}

class RconManager {
  constructor() { this.conns = new Map(); }
  async connect(id, opts) {
    this.disconnect(id);
    const c = opts.protocol === 'quake' ? new QuakeRcon(opts) : new SourceRcon(opts);
    await c.connect();
    c.onClose = () => this.conns.delete(id);
    this.conns.set(id, c);
    return true;
  }
  async exec(id, cmd) { const c = this.conns.get(id); if (!c) throw new Error('Brak połączenia – połącz się ponownie.'); return c.exec(cmd); }
  disconnect(id) { const c = this.conns.get(id); if (c) { c.close(); this.conns.delete(id); } }
  status(id) { return this.conns.has(id); }
  closeAll() { for (const id of [...this.conns.keys()]) this.disconnect(id); }
}

module.exports = { SourceRcon, QuakeRcon, RconManager, packet };
