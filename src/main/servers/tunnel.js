// Tunel bez przekierowania portów: znajomi wchodzą na serwer bez ustawiania routera.
// - bore (bore.pub) – bez konta, tylko TCP (Minecraft, Terraria, Factorio TCP, panele www)
// - playit.gg – TCP i UDP (większość gier Steam, FiveM), darmowe konto, agent łączony raz przez przeglądarkę
// - Tailscale / ZeroTier – sieć prywatna (znajomi też instalują program); tylko pokazujemy adres
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const U = require('../util');

const BORE_VER = 'v0.6.0';
const BORE_HOST = 'bore.pub';
const PLAYIT_VER = 'v0.15.26'; // wersja z poleceniami claim/tunnels (nowsze agenty to sam demon)
const ansi = s => String(s).replace(/\x1b(\[[0-9;?]*[A-Za-z]|[78])/g, '');
const exe = n => (U.isWin ? n + '.exe' : n);

function boreAsset() {
  if (U.isWin) return `bore-${BORE_VER}-x86_64-pc-windows-msvc.zip`;
  if (process.platform === 'darwin') return `bore-${BORE_VER}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin.tar.gz`;
  return `bore-${BORE_VER}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl.tar.gz`;
}
function playitAsset() {
  if (U.isWin) return 'playit-windows-x86_64-signed.exe';
  if (process.platform === 'darwin') return null;
  return process.arch === 'arm64' ? 'playit-linux-aarch64' : 'playit-linux-amd64';
}

// "listening at bore.pub:41234"
function parseBore(line) { const m = String(line).match(/listening at ([\w.-]+):(\d+)/i); return m ? { host: m[1], port: +m[2], address: `${m[1]}:${m[2]}` } : null; }
// adresy tuneli playit w wyjściu agenta, np. "abc-def.gl.joinmc.link => 127.0.0.1:25565 (minecraft-java)"
function parsePlayit(line) {
  const s = ansi(line);
  const m = s.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:joinmc\.link|ply\.gg|playit\.gg|playit\.plus))(?::(\d+))?\s*(?:=>|->)\s*(?:[\d.]+|localhost):(\d+)/i);
  if (m) return { address: m[1] + (m[2] ? ':' + m[2] : ''), local: +m[3] };
  const claim = s.match(/(https:\/\/playit\.gg\/claim\/[\w-]+)/i); if (claim) return { claimUrl: claim[1] };
  return null;
}

// "[tunnel-id] [port-type] [port-count] [public-address]" (+ opcjonalnie nazwa)
function parsePlayitList(text) {
  const out = [];
  for (const raw of ansi(text).split(/\r?\n/)) {
    const l = raw.trim(); const m = l.match(/^([0-9a-f-]{8,})\s+(tcp|udp|both)\s+(\d+)\s+(\S+)(?:\s+(\S+))?/i);
    if (m) out.push({ id: m[1], portType: m[2].toLowerCase(), count: +m[3], address: m[4], name: m[5] || null });
  }
  return out;
}

class TunnelManager {
  constructor({ userData, net, emit = () => {}, enc = x => x, dec = x => x, getSettings = () => ({}), saveSettings = () => {}, log = () => {} }) {
    this.dir = path.join(userData, 'tunnels'); this.net = net; this.emit = emit; this.enc = enc; this.dec = dec; this.getSettings = getSettings; this.saveSettings = saveSettings; this.log = log;
    this.active = new Map(); // serverId → { provider, procs, addresses, status, error }
  }
  bin(p) { return path.join(this.dir, p, p === 'bore' ? exe('bore') : exe('playit')); }
  installed(p) { return U.exists(this.bin(p)); }
  status() {
    const s = this.getSettings();
    return {
      providers: {
        bore: { name: 'bore.pub', installed: this.installed('bore'), tcpOnly: true, account: false },
        playit: { name: 'playit.gg', installed: this.installed('playit'), tcpOnly: false, account: true, linked: !!s.playitSecret, supported: !!playitAsset() },
      },
      active: Object.fromEntries([...this.active].map(([id, t]) => [id, { provider: t.provider, addresses: t.addresses, status: t.status, error: t.error || null, claimUrl: t.claimUrl || null }])),
    };
  }
  async install(provider, { log = () => {}, progress } = {}) {
    const N = this.net; const dest = path.join(this.dir, provider); fs.mkdirSync(dest, { recursive: true });
    if (provider === 'bore') {
      const asset = boreAsset();
      log(`Pobieranie ${asset}…`);
      const f = await N.download(`https://github.com/ekzhang/bore/releases/download/${BORE_VER}/${asset}`, N.tempFile(asset), progress);
      if (/\.zip$/.test(asset)) N.extractZip(f, dest); else await N.extractTar(f, dest);
    } else if (provider === 'playit') {
      const asset = playitAsset(); if (!asset) throw new Error('playit.gg nie ma agenta dla macOS – użyj bore albo Tailscale.');
      log(`Pobieranie ${asset}…`);
      await N.download(`https://github.com/playit-cloud/playit-agent/releases/download/${PLAYIT_VER}/${asset}`, this.bin('playit'), progress);
    } else throw new Error('Nieznany tunel: ' + provider);
    if (!U.isWin) try { fs.chmodSync(this.bin(provider), 0o755); } catch { /* */ }
    if (!this.installed(provider)) throw new Error('Nie udało się zainstalować programu tunelu.');
    return true;
  }
  run(bin, args, timeout = 15000) { return new Promise((res, rej) => execFile(bin, args, { windowsHide: true, timeout }, (e, out, err) => (e ? rej(new Error(ansi(String(err || e.message)).trim().split('\n').pop())) : res(ansi(String(out)).trim())))); }
  secretArgs() { const s = this.getSettings().playitSecret; return s ? ['--secret', this.dec(s)] : []; }
  // połączenie agenta playit z kontem (raz): kod → link w przeglądarce → sekret
  async linkPlayit(openUrl) {
    if (!this.installed('playit')) throw new Error('Najpierw zainstaluj playit.gg.');
    const code = (await this.run(this.bin('playit'), ['claim', 'generate'])).match(/[0-9a-f]{6,}/i);
    if (!code) throw new Error('Agent playit nie wygenerował kodu.');
    const url = (await this.run(this.bin('playit'), ['claim', 'url', code[0]])).match(/https?:\/\/[^\s\x1b]+/);
    if (!url) throw new Error('Agent playit nie zwrócił linku.');
    openUrl(url[0]);
    this.emit('tunnel:claim', { url: url[0] });
    const out = await this.run(this.bin('playit'), ['claim', 'exchange', '--wait', '600', code[0]], 11 * 60 * 1000);
    const secret = (out.match(/[0-9a-f]{32,}/i) || [''])[0];
    if (!/^[0-9a-f]{32,}$/i.test(secret)) throw new Error('Nie udało się połączyć agenta z kontem playit.gg.');
    const s = this.getSettings(); s.playitSecret = this.enc(secret); this.saveSettings();
    return true;
  }
  // tworzy brakujące tunele (po jednym na port) i odczytuje ich publiczne adresy
  async preparePlayit(server, ports, t) {
    const sa = this.secretArgs();
    for (const p of ports) {
      const proto = /TCP\/UDP|both/i.test(p.proto) ? 'both' : /UDP/i.test(p.proto) ? 'udp' : 'tcp';
      const args = [...sa, 'tunnels', 'prepare', proto, '1', '--name', `cm-${server.id}-${p.port}`];
      if (server.type === 'minecraft' && proto === 'tcp' && p.port === (server.port || 25565)) args.push('--type', 'minecraft-java');
      await this.run(this.bin('playit'), args, 30000);
    }
    const list = await this.run(this.bin('playit'), [...sa, 'tunnels', 'list'], 30000);
    for (const r of parsePlayitList(list)) {
      if (!r.name || !r.name.startsWith(`cm-${server.id}-`)) { if (r.name) continue; }
      if (!t.addresses.some(a => a.address === r.address)) t.addresses.push({ address: r.address, label: r.portType + (r.name ? ' · port ' + r.name.split('-').pop() : '') });
    }
    if (t.addresses.length && t.status === 'starting') t.status = 'online';
  }
  unlinkPlayit() { const s = this.getSettings(); delete s.playitSecret; this.saveSettings(); }

  /** ports: [{ port, proto: 'TCP'|'UDP'|'TCP/UDP', label }] */
  start(server, provider, ports, { spawnImpl = spawn } = {}) {
    this.stop(server.id);
    if (!this.installed(provider) && !spawnImpl.fake) throw new Error('Najpierw zainstaluj ' + (provider === 'bore' ? 'bore' : 'playit.gg') + '.');
    const t = { provider, procs: [], addresses: [], status: 'starting', warnings: [] };
    this.active.set(server.id, t);
    const upd = () => this.emit('tunnel:status', { id: server.id, ...this.status().active[server.id] });
    const watch = (p, parse, label) => {
      let buf = '';
      const onData = d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); this.log(server.id, `[tunel] ${line.trim()}`); const r = parse(line); if (r && r.address) { if (!t.addresses.some(a => a.address === r.address)) t.addresses.push({ address: r.address, label: label || r.label || (r.local ? `port ${r.local}` : ''), local: r.local }); t.status = 'online'; upd(); } else if (r && r.claimUrl) { t.claimUrl = r.claimUrl; upd(); } } };
      p.stdout.on('data', onData); p.stderr.on('data', onData);
      p.on('exit', code => { if (this.active.get(server.id) !== t) return; t.procs = t.procs.filter(x => x !== p); if (!t.procs.length) { t.status = t.stopping ? 'stopped' : 'error'; if (!t.stopping) t.error = `Tunel się zamknął (kod ${code}). Sprawdź połączenie z internetem.`; upd(); } });
      p.on('error', e => { t.status = 'error'; t.error = e.message; upd(); });
      t.procs.push(p);
    };
    if (provider === 'bore') {
      const tcp = ports.filter(p => /TCP/i.test(p.proto || 'TCP'));
      const udpOnly = ports.filter(p => !/TCP/i.test(p.proto || 'TCP'));
      if (!tcp.length) { this.active.delete(server.id); throw new Error('Ten serwer używa tylko portów UDP – bore obsługuje tylko TCP. Wybierz playit.gg.'); }
      if (udpOnly.length) t.warnings.push(`Porty UDP (${udpOnly.map(p => p.port).join(', ')}) nie przejdą przez bore – jeśli gra ich wymaga, użyj playit.gg.`);
      for (const p of tcp) watch(spawnImpl(this.bin('bore'), ['local', String(p.port), '--to', BORE_HOST], { windowsHide: true }), parseBore, p.label || `port ${p.port}`);
    } else if (provider === 'playit') {
      const secret = this.getSettings().playitSecret ? this.dec(this.getSettings().playitSecret) : null;
      if (!secret && !spawnImpl.fake) { this.active.delete(server.id); throw new Error('Połącz najpierw agenta z kontem playit.gg (przycisk „Połącz konto”).'); }
      t.warnings.push('Jeśli adres nie działa, na stronie playit.gg → Tunnels sprawdź, czy tunel kieruje na właściwy port lokalny serwera.');
      watch(spawnImpl(this.bin('playit'), ['--secret', secret || '', '--stdout', 'start'], { windowsHide: true }), parsePlayit);
      if (!spawnImpl.fake) this.preparePlayit(server, ports, t).then(upd).catch(e => { t.warnings.push('Nie udało się utworzyć tunelu automatycznie: ' + e.message); upd(); });
    }
    upd();
    return this.status().active[server.id];
  }
  stop(id) {
    const t = this.active.get(id); if (!t) return;
    t.stopping = true; for (const p of t.procs) { try { p.kill(); } catch { /* */ } }
    this.active.delete(id); this.emit('tunnel:status', { id, status: 'stopped', addresses: [] });
  }
  stopAll() { for (const id of [...this.active.keys()]) this.stop(id); }
  address(id) { const t = this.active.get(id); return t && t.addresses[0] ? t.addresses[0].address : null; }
}

// sieci prywatne zainstalowane na komputerze
function vpnInfo(run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (e, out) => res(e ? null : String(out))))) {
  const ts = U.isWin ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
  const zt = U.isWin ? 'C:\\ProgramData\\ZeroTier\\One\\zerotier-one_x64.exe' : 'zerotier-cli';
  return Promise.all([
    run(ts, ['ip', '-4']).then(o => (o && /\d+\.\d+\.\d+\.\d+/.test(o) ? { id: 'tailscale', name: 'Tailscale', ip: o.match(/\d+\.\d+\.\d+\.\d+/)[0] } : null)),
    run(zt, U.isWin ? ['-q', 'listnetworks'] : ['listnetworks']).then(o => { if (!o) return null; const m = o.match(/(\d+\.\d+\.\d+\.\d+)\/\d+/); return m ? { id: 'zerotier', name: 'ZeroTier', ip: m[1] } : null; }),
  ]).then(r => r.filter(Boolean));
}

module.exports = { TunnelManager, parseBore, parsePlayit, parsePlayitList, vpnInfo, boreAsset, ansi };
