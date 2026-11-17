// Przekierowanie portów: porty serwerów, sprawdzanie z zewnątrz i otwieranie przez UPnP
'use strict';
const dgram = require('dgram');
const http = require('http');
const os = require('os');

const range = (p, n, proto, label) => Array.from({ length: n }, (_, i) => ({ port: p + i, proto, label }));
const PORTS = {
  minecraft: s => [{ port: +s.port, proto: 'TCP', label: 'Gra' }],
  mcproxy: s => [{ port: +s.port, proto: 'TCP', label: 'Proxy' }],
  rust: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }],
  cs2: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }, { port: +s.port, proto: 'TCP', label: 'RCON / gra' }],
  tf2: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }, { port: +s.port, proto: 'TCP', label: 'RCON / gra' }],
  dayz: s => range(+s.port, 4, 'UDP', 'Gra'),
  valheim: s => range(+s.port, 3, 'UDP', 'Gra i zapytania Steam'),
  projectzomboid: s => range(+s.port, 2, 'UDP', 'Gra'),
  armareforger: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }],
  terraria: s => [{ port: +s.port, proto: 'TCP', label: 'Gra' }],
  fivem: s => [{ port: +s.port, proto: 'TCP', label: 'Gra' }, { port: +s.port, proto: 'UDP', label: 'Gra' }],
  mta: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }, { port: +s.port + 2, proto: 'TCP', label: 'HTTP (pobieranie zasobów)' }, { port: +s.port + 123, proto: 'UDP', label: 'Lista serwerów (ASE)' }],
  beammp: s => [{ port: +s.port, proto: 'TCP', label: 'Gra' }, { port: +s.port, proto: 'UDP', label: 'Gra' }],
  palworld: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }],
  ark: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }],
  satisfactory: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }, { port: +s.port, proto: 'TCP', label: 'API serwera' }, { port: 8888, proto: 'TCP', label: 'Niezawodne wiadomości' }],
  enshrouded: s => range(+s.port, 2, 'UDP', 'Gra i zapytania'),
  spaceengineers: s => [{ port: +s.port, proto: 'UDP', label: 'Gra' }],
};
function portsFor(s) { return (PORTS[s.type] || (x => [{ port: +x.port, proto: 'TCP', label: 'Gra' }, { port: +x.port, proto: 'UDP', label: 'Gra' }]))(s).filter(p => p.port > 0 && p.port < 65536); }

function isPrivate(ip) { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip); }
function localIps() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && isPrivate(a.address)) out.push({ name, address: a.address, netmask: a.netmask });
  return out;
}
function sameSubnet(a, b, mask) { const n = s => s.split('.').reduce((x, y) => (x << 8) + +y, 0) >>> 0; return (n(a) & n(mask)) === (n(b) & n(mask)); }
function localIpFor(host) { const l = localIps(); const m = l.find(x => sameSubnet(x.address, host, x.netmask)); return (m || l[0] || {}).address || null; }

// ---------- UPnP IGD ----------
const xmlVal = (xml, tag) => { const m = String(xml).match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i')); return m ? m[1].trim() : null; };
function parseDescription(xml, location) {
  const base = xmlVal(xml, 'URLBase') || location;
  const services = [...String(xml).matchAll(/<service>([\s\S]*?)<\/service>/gi)].map(m => ({ type: xmlVal(m[1], 'serviceType'), control: xmlVal(m[1], 'controlURL') }));
  const svc = services.find(s => /WANIPConnection/i.test(s.type || '')) || services.find(s => /WANPPPConnection/i.test(s.type || ''));
  if (!svc || !svc.control) return null;
  return { serviceType: svc.type, controlURL: new URL(svc.control, base).toString(), name: xmlVal(xml, 'friendlyName') || 'Router' };
}
function httpReq(url, { method = 'GET', headers = {}, body = null, timeout = 5000 } = {}) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const r = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers, timeout }, resp => {
      let d = ''; resp.setEncoding('utf8'); resp.on('data', c => { d += c; }); resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('timeout', () => r.destroy(new Error('Router nie odpowiada')));
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}
function soapBody(serviceType, action, args) {
  return `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${Object.entries(args).map(([k, v]) => `<${k}>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
}

class Upnp {
  constructor({ timeout = 3000 } = {}) { this.timeout = timeout; this.gw = null; }
  discover() {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const found = new Set();
      const done = async () => {
        try { sock.close(); } catch { /* */ }
        for (const loc of found) {
          try { const r = await httpReq(loc); const d = parseDescription(r.body, loc); if (d) { this.gw = { ...d, location: loc, host: new URL(loc).hostname }; return resolve(this.gw); } } catch { /* następny */ }
        }
        reject(new Error('Nie znaleziono routera z włączonym UPnP. Włącz UPnP w ustawieniach routera albo przekieruj porty ręcznie.'));
      };
      sock.on('message', msg => { const m = String(msg).match(/^location:\s*(.+)$/im); if (m) found.add(m[1].trim()); });
      sock.on('error', () => done());
      sock.bind(0, () => {
        for (const st of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', 'urn:schemas-upnp-org:service:WANIPConnection:1']) {
          const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
          sock.send(msg, 0, msg.length, 1900, '239.255.255.250');
        }
        setTimeout(done, this.timeout);
      });
    });
  }
  async gateway() { return this.gw || this.discover(); }
  async soap(action, args = {}) {
    const g = await this.gateway();
    const r = await httpReq(g.controlURL, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${g.serviceType}#${action}"` }, body: soapBody(g.serviceType, action, args) });
    if (r.status !== 200) { const desc = xmlVal(r.body, 'errorDescription'); const code = xmlVal(r.body, 'errorCode'); const e = new Error(`Router odrzucił ${action}: ${desc || 'HTTP ' + r.status}${code ? ` (kod ${code})` : ''}`); e.code = code; throw e; }
    return r.body;
  }
  async externalIp() { return xmlVal(await this.soap('GetExternalIPAddress'), 'NewExternalIPAddress'); }
  async add({ port, proto, desc = 'CodeManager', client }) {
    const g = await this.gateway();
    const ip = client || localIpFor(g.host);
    if (!ip) throw new Error('Nie udało się ustalić adresu tego komputera w sieci lokalnej.');
    await this.soap('AddPortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto, NewInternalPort: port, NewInternalClient: ip, NewEnabled: 1, NewPortMappingDescription: desc, NewLeaseDuration: 0 });
    return { port, proto, client: ip };
  }
  async remove({ port, proto }) { await this.soap('DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: proto }); return true; }
  async list(max = 64) {
    const out = [];
    for (let i = 0; i < max; i++) {
      let b; try { b = await this.soap('GetGenericPortMappingEntry', { NewPortMappingIndex: i }); } catch { break; }
      out.push({ port: +xmlVal(b, 'NewExternalPort'), proto: xmlVal(b, 'NewProtocol'), client: xmlVal(b, 'NewInternalClient'), desc: xmlVal(b, 'NewPortMappingDescription'), enabled: xmlVal(b, 'NewEnabled') === '1' });
    }
    return out;
  }
}

// sprawdzenie z internetu (tylko TCP – UDP nie da się wiarygodnie sprawdzić z zewnątrz)
async function checkExternal(port, fetchImpl = fetch) {
  const r = await fetchImpl(`https://ifconfig.co/port/${port}`, { headers: { Accept: 'application/json', 'User-Agent': 'CodeManager' } });
  if (!r.ok) throw new Error('Usługa sprawdzania portów nie odpowiada (HTTP ' + r.status + ').');
  const j = await r.json();
  return { ip: j.ip, port: j.port, reachable: !!j.reachable };
}

module.exports = { portsFor, Upnp, checkExternal, localIps, localIpFor, parseDescription, soapBody, isPrivate };
