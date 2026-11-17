// Powiadomienia: webhook Discord i powiadomienia systemowe Windows
'use strict';

const WEBHOOK = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const EVENTS = {
  start: { label: 'Serwer uruchomiony', color: 0x4cb877, discord: true, system: false },
  stop: { label: 'Serwer zatrzymany', color: 0x8a8f98, discord: true, system: false },
  crash: { label: 'Serwer padł', color: 0xe5534b, discord: true, system: true },
  join: { label: 'Gracz dołączył', color: 0x3d8bd9, discord: false, system: false },
  leave: { label: 'Gracz wyszedł', color: 0x6b7280, discord: false, system: false },
  backup: { label: 'Kopia zapasowa gotowa', color: 0x4cb877, discord: true, system: true },
  'backup-failed': { label: 'Kopia zapasowa nie powiodła się', color: 0xe5534b, discord: true, system: true },
  alarm: { label: 'Serwer przekracza limit zasobów', color: 0xd6a443, discord: true, system: true },
  update: { label: 'Dostępna aktualizacja CodeManager', color: 0x4cb877, discord: false, system: true },
};

function message(kind, server, data = {}) {
  const n = server ? `**${server.name}**` : 'CodeManager';
  switch (kind) {
    case 'start': return `${n} działa${server && server.port ? ` (port ${server.port})` : ''}.`;
    case 'stop': return `${n} został zatrzymany.`;
    case 'crash': return `${n} niespodziewanie się wyłączył${data.code != null ? ` (kod ${data.code})` : ''}.${data.restart ? ' Automatyczny restart za 10 s.' : ''}`;
    case 'join': return `${data.player} dołączył do ${n}${data.count != null ? ` – graczy online: ${data.count}` : ''}.`;
    case 'leave': return `${data.player} opuścił ${n}${data.count != null ? ` – graczy online: ${data.count}` : ''}.`;
    case 'backup': return `Kopia ${n} zapisana${data.size ? ` (${(data.size / 1048576).toFixed(1)} MB)` : ''}.`;
    case 'backup-failed': return `Kopia ${n} nie powiodła się: ${data.error || 'nieznany błąd'}.`;
    case 'update': return `Dostępna jest wersja ${data.version}.`;
    case 'alarm': return `${n}: ${data.kind === 'cpu' ? `procesor ${Math.round(data.value)}% (limit ${data.limit}%)` : `pamięć ${(data.value / 1048576).toFixed(0)} MB (limit ${data.limit} MB)`} od ${data.minutes} min.`;
    default: return String(kind);
  }
}
const plain = s => s.replace(/\*\*/g, '');

function payload(kind, server, data) {
  const ev = EVENTS[kind] || { label: kind, color: 0x4cb877 };
  return { username: 'CodeManager', embeds: [{ title: ev.label, description: message(kind, server, data), color: ev.color, timestamp: new Date().toISOString(), footer: server ? { text: server.typeName || server.type || '' } : undefined }] };
}

class Notifier {
  constructor({ getSettings, system, fetchImpl }) {
    this.getSettings = getSettings; this.system = system || (() => {}); this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.queue = []; this.busy = false; this.last = 0; this.sent = [];
  }
  enabled(channel, kind, server) {
    const s = this.getSettings() || {};
    if (channel === 'system') {
      const n = s.notifications || {};
      if (n.enabled === false) return false;
      return n.events && n.events[kind] !== undefined ? !!n.events[kind] : !!(EVENTS[kind] || {}).system;
    }
    const d = s.discord || {}; const sd = (server && server.discord) || {};
    if (sd.disabled) return null;
    const url = sd.url || d.url;
    if (!url || !WEBHOOK.test(url)) return null;
    const ev = (sd.events && sd.events[kind] !== undefined) ? sd.events[kind] : (d.events && d.events[kind] !== undefined) ? d.events[kind] : (EVENTS[kind] || {}).discord;
    return ev ? url : null;
  }
  event(kind, server, data = {}) {
    if (this.enabled('system', kind, server)) { try { this.system((EVENTS[kind] || {}).label || kind, plain(message(kind, server, data))); } catch { /* */ } }
    const url = this.enabled('discord', kind, server);
    if (url) this.post(url, payload(kind, server, data));
  }
  post(url, body) { return new Promise(res => { this.queue.push({ url, body, res }); this.pump(); }); }
  async pump() {
    if (this.busy) return; this.busy = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        const wait = Math.max(0, 1100 - (Date.now() - this.last)); if (wait) await new Promise(r => setTimeout(r, wait));
        let ok = false, error = null;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            const r = await this.fetch(job.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.body) });
            this.last = Date.now();
            if (r.status === 429) { let after = 2; try { after = (await r.json()).retry_after || 2; } catch { /* */ } await new Promise(x => setTimeout(x, Math.min(after, 30) * 1000)); continue; }
            ok = r.ok || r.status === 204; if (!ok) error = `HTTP ${r.status}`;
            break;
          } catch (e) { error = e.message; await new Promise(x => setTimeout(x, 1500)); }
        }
        this.sent.push({ t: Date.now(), ok, error }); if (this.sent.length > 50) this.sent.shift();
        job.res({ ok, error });
      }
    } finally { this.busy = false; }
  }
  async test(url) {
    if (!WEBHOOK.test(String(url || ''))) throw new Error('To nie jest adres webhooka Discord (https://discord.com/api/webhooks/…).');
    const r = await this.post(url, { username: 'CodeManager', content: 'Test powiadomień z CodeManager – webhook działa.' });
    if (!r.ok) throw new Error('Discord odrzucił wiadomość: ' + (r.error || 'nieznany błąd'));
    return true;
  }
}

module.exports = { Notifier, EVENTS, WEBHOOK, message, payload };
