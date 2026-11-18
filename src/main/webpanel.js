// Panel webowy: zarządzanie serwerami z przeglądarki lub telefonu (w tej samej sieci albo przez tunel).
// Dostęp chroniony kodem PIN; po zalogowaniu przeglądarka dostaje losowy token sesji.
'use strict';
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const MAX_BODY = 64 * 1024;

class WebPanel {
  constructor({ servers, monitor, getSettings, saveSettings, scheduler, log = () => {} }) {
    this.servers = servers; this.monitor = monitor; this.getSettings = getSettings; this.saveSettings = saveSettings; this.scheduler = scheduler; this.log = log;
    this.srv = null; this.tokens = new Map(); this.clients = new Set(); this.fails = new Map();
  }
  pin() { const s = this.getSettings(); if (!s.webPanelPin) { s.webPanelPin = String(crypto.randomInt(100000, 999999)); this.saveSettings(); } return s.webPanelPin; }
  urls() { const port = this.port || +this.getSettings().webPanelPort || 8790; const out = [`http://localhost:${port}`]; for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`); return out; }
  status() { return { running: !!this.srv, port: this.port || null, urls: this.srv ? this.urls() : [], pin: this.pin(), clients: this.clients.size }; }
  start(port = +this.getSettings().webPanelPort || 8790) {
    if (this.srv) return Promise.resolve(this.status());
    this.pin();
    return new Promise((res, rej) => {
      const srv = http.createServer((req, resp) => this.handle(req, resp).catch(e => this.send(resp, 500, { error: e.message })));
      srv.on('error', e => { this.srv = null; rej(new Error(e.code === 'EADDRINUSE' ? `Port ${port} jest zajęty – wybierz inny w ustawieniach.` : e.message)); });
      srv.listen(port, '0.0.0.0', () => { this.srv = srv; this.port = port; this.log(`Panel webowy działa na porcie ${port}`); res(this.status()); });
    });
  }
  stop() { if (!this.srv) return this.status(); for (const c of this.clients) { try { c.end(); } catch { /* */ } } this.clients.clear(); this.srv.close(); this.srv = null; this.tokens.clear(); return this.status(); }
  newPin() { const s = this.getSettings(); s.webPanelPin = String(crypto.randomInt(100000, 999999)); this.saveSettings(); this.tokens.clear(); return s.webPanelPin; }
  // wywoływane przez CodeManager przy każdej linii konsoli / zmianie stanu
  push(ev, data) { const msg = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of this.clients) { if (c.filter && data.id && c.filter !== data.id) continue; try { c.write(msg); } catch { /* */ } } }

  send(resp, code, body, headers = {}) {
    const isStr = typeof body === 'string';
    resp.writeHead(code, { 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', ...headers });
    resp.end(isStr ? body : JSON.stringify(body));
  }
  body(req) { return new Promise((res, rej) => { let b = ''; req.on('data', d => { b += d; if (b.length > MAX_BODY) { rej(new Error('Za duże żądanie')); req.destroy(); } }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { res({}); } }); }); }
  authed(req) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)cmtoken=([a-f0-9]{48})/); const t = m && m[1];
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const tok = t || (/^[a-f0-9]{48}$/.test(auth) ? auth : null);
    return tok && this.tokens.has(tok);
  }
  async handle(req, resp) {
    const url = new URL(req.url, 'http://x'); const p = url.pathname;
    const ip = req.socket.remoteAddress || '';
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return this.send(resp, 200, PAGE);
    if (req.method === 'GET' && p === '/manifest.webmanifest') return this.send(resp, 200, { name: 'CodeManager', short_name: 'CodeManager', start_url: '/', display: 'standalone', background_color: '#1e1f22', theme_color: '#2f9e5b' }, { 'Content-Type': 'application/manifest+json' });
    if (req.method === 'POST' && p === '/api/login') {
      const f = this.fails.get(ip) || { n: 0, until: 0 };
      if (Date.now() < f.until) return this.send(resp, 429, { error: 'Za dużo prób – spróbuj za minutę.' });
      const b = await this.body(req);
      const ok = String(b.pin || '').length === this.pin().length && crypto.timingSafeEqual(Buffer.from(String(b.pin)), Buffer.from(this.pin()));
      if (!ok) { f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } this.fails.set(ip, f); return this.send(resp, 401, { error: 'Zły kod PIN.' }); }
      this.fails.delete(ip);
      const tok = crypto.randomBytes(24).toString('hex'); this.tokens.set(tok, { ip, t: Date.now() });
      return this.send(resp, 200, { ok: true, token: tok }, { 'Set-Cookie': `cmtoken=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
    }
    if (!p.startsWith('/api/')) return this.send(resp, 404, { error: 'Nie znaleziono' });
    if (!this.authed(req)) return this.send(resp, 401, { error: 'Zaloguj się kodem PIN.' });
    if (req.method === 'POST' && p === '/api/logout') { const m = (req.headers.cookie || '').match(/cmtoken=([a-f0-9]+)/); if (m) this.tokens.delete(m[1]); return this.send(resp, 200, { ok: true }, { 'Set-Cookie': 'cmtoken=; Path=/; Max-Age=0' }); }
    if (req.method === 'GET' && p === '/api/servers') {
      return this.send(resp, 200, this.servers.list().map(s => { const st = this.monitor ? this.monitor.st(s.id) : null; const last = st && st.history.length ? st.history[st.history.length - 1] : null; return { id: s.id, name: s.name, type: s.typeName || s.type, color: s.color, status: s.status, port: s.port, players: this.monitor ? this.monitor.count(s.id) : null, playerList: this.monitor ? [...(this.monitor.st(s.id).players || [])] : [], cpu: last ? last.cpu : null, mem: last ? last.mem : null }; }));
    }
    const m = p.match(/^\/api\/servers\/([\w-]+)\/(start|stop|restart|kill|command|console|stream|backup)$/);
    if (!m) return this.send(resp, 404, { error: 'Nie znaleziono' });
    const [, id, act] = m;
    this.servers.get(id); // rzuca błąd, gdy brak
    if (act === 'stream' && req.method === 'GET') {
      resp.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      resp.write(`event: hello\ndata: {}\n\n`);
      resp.filter = id; this.clients.add(resp);
      const ka = setInterval(() => { try { resp.write(': ping\n\n'); } catch { /* */ } }, 25000);
      req.on('close', () => { clearInterval(ka); this.clients.delete(resp); });
      return undefined;
    }
    if (act === 'console' && req.method === 'GET') return this.send(resp, 200, { lines: this.servers.getLog(id).slice(-400) });
    if (req.method !== 'POST') return this.send(resp, 405, { error: 'Zła metoda' });
    if (act === 'start') { this.servers.start(id); return this.send(resp, 200, { ok: true }); }
    if (act === 'stop') { this.servers.stop(id); return this.send(resp, 200, { ok: true }); }
    if (act === 'kill') { this.servers.kill(id); return this.send(resp, 200, { ok: true }); }
    if (act === 'restart') { this.servers.restart(id).catch(e => this.servers.log(id, '✖ ' + e.message)); return this.send(resp, 200, { ok: true }); }
    if (act === 'command') { const b = await this.body(req); const cmd = String(b.cmd || '').slice(0, 500); if (!cmd) return this.send(resp, 400, { error: 'Puste polecenie' }); this.servers.log(id, '[panel webowy] ' + cmd); this.servers.command(id, cmd); return this.send(resp, 200, { ok: true }); }
    if (act === 'backup') { if (!this.scheduler) return this.send(resp, 501, { error: 'Kopie niedostępne' }); this.scheduler.backup(id, 'panel webowy').catch(() => {}); return this.send(resp, 200, { ok: true }); }
    return this.send(resp, 404, { error: 'Nie znaleziono' });
  }
}

const PAGE = `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>CodeManager – panel</title><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#1e1f22">
<style>
:root{--bg:#1e1f22;--p:#2b2d31;--p2:#313338;--t:#e8e9eb;--t2:#a5a8ad;--a:#2f9e5b;--e:#d64545;--w:#d9a23a;--r:10px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #0003;position:sticky;top:0;background:var(--bg);z-index:2}header h1{font-size:17px;margin:0;flex:1}
button{font:inherit;border:0;border-radius:8px;padding:9px 14px;background:var(--p2);color:var(--t);cursor:pointer}button.p{background:var(--a);color:#fff}button.d{background:var(--e);color:#fff}button:disabled{opacity:.5}
input{font:inherit;background:var(--p2);color:var(--t);border:1px solid #0005;border-radius:8px;padding:10px 12px;width:100%}
main{padding:12px;max-width:900px;margin:0 auto}.card{background:var(--p);border-radius:var(--r);padding:14px;margin-bottom:10px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grow{flex:1}.dim{color:var(--t2);font-size:13px}
.dot{width:10px;height:10px;border-radius:50%;background:#777;display:inline-block}.dot.running{background:var(--a)}.dot.stopping,.dot.starting{background:var(--w)}
.name{font-weight:600}.badge{font-size:12px;padding:2px 8px;border-radius:99px;background:var(--p2);color:var(--t2)}
pre{background:#111214;border-radius:8px;padding:10px;height:55vh;overflow:auto;font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;margin:10px 0}
.login{max-width:340px;margin:18vh auto;text-align:center}.login input{text-align:center;font-size:26px;letter-spacing:8px;margin:14px 0}
.err{color:var(--e);min-height:20px}.players{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.players span{background:var(--p2);border-radius:6px;padding:2px 8px;font-size:13px}
</style></head><body>
<div id="app"></div>
<script>
const $=s=>document.querySelector(s);const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const api=async(p,o={})=>{const r=await fetch(p,{method:o.method||'GET',headers:{'Content-Type':'application/json'},body:o.body?JSON.stringify(o.body):undefined,credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(r.status===401&&p!=='/api/login'){login();throw new Error('auth')}if(!r.ok)throw new Error(j.error||r.status);return j};
const fmtMem=b=>b?(b/1073741824).toFixed(2)+' GB':'–';
function login(msg){$('#app').innerHTML='<div class="login card"><h2>CodeManager</h2><div class="dim">Wpisz kod PIN z Ustawień → Panel webowy</div><input id="pin" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><div class="err" id="err">'+esc(msg||'')+'</div><button class="p" id="go" style="width:100%">Zaloguj</button></div>';
const go=async()=>{try{await api('/api/login',{method:'POST',body:{pin:$('#pin').value.trim()}});list()}catch(e){$('#err').textContent=e.message}};$('#go').onclick=go;$('#pin').onkeydown=e=>{if(e.key==='Enter')go()};$('#pin').focus()}
let es=null,timer=null;
async function list(){if(es){es.close();es=null}clearInterval(timer);
$('#app').innerHTML='<header><h1>Serwery</h1><button id="out">Wyloguj</button></header><main id="m"><div class="dim">Wczytywanie…</div></main>';$('#out').onclick=async()=>{await api('/api/logout',{method:'POST'});login()};
const draw=async()=>{let l;try{l=await api('/api/servers')}catch{return}
$('#m').innerHTML=l.length?l.map(s=>'<div class="card"><div class="row"><span class="dot '+s.status+'"></span><span class="name grow">'+esc(s.name)+'</span><span class="badge">'+esc(s.type)+'</span></div><div class="dim" style="margin:6px 0 10px">'+({running:'Działa',stopped:'Zatrzymany',stopping:'Zatrzymywanie…'}[s.status]||s.status)+(s.status==='running'?' · graczy: '+(s.players??'?')+' · CPU '+(s.cpu??'–')+'% · RAM '+fmtMem(s.mem):'')+'</div><div class="row">'+(s.status==='running'?'<button data-a="stop" data-id="'+s.id+'">Zatrzymaj</button><button data-a="restart" data-id="'+s.id+'">Restart</button>':'<button class="p" data-a="start" data-id="'+s.id+'">Uruchom</button>')+'<button data-a="open" data-id="'+s.id+'">Konsola</button></div></div>').join(''):'<div class="card dim">Brak serwerów w CodeManager.</div>'};
$('#m').onclick=async e=>{const b=e.target.closest('[data-a]');if(!b)return;if(b.dataset.a==='open')return server(b.dataset.id);b.disabled=true;try{await api('/api/servers/'+b.dataset.id+'/'+b.dataset.a,{method:'POST'})}catch(x){alert(x.message)}setTimeout(draw,1200)};
draw();timer=setInterval(draw,5000)}
async function server(id){clearInterval(timer);const all=await api('/api/servers');const s=all.find(x=>x.id===id)||{name:id};
$('#app').innerHTML='<header><button id="back">‹</button><h1>'+esc(s.name)+'</h1></header><main><div class="row"><button class="p" data-a="start">Uruchom</button><button data-a="stop">Zatrzymaj</button><button data-a="restart">Restart</button><button data-a="backup">Kopia</button><button class="d" data-a="kill">Wymuś</button></div><div class="players" id="pl"></div><pre id="con"></pre><div class="row"><input id="cmd" class="grow" placeholder="Polecenie (np. say Cześć)" autocapitalize="off"><button class="p" id="send">Wyślij</button></div></main>';
$('#back').onclick=list;const con=$('#con');const add=l=>{const atEnd=con.scrollTop+con.clientHeight>=con.scrollHeight-30;con.textContent+=l+'\\n';if(con.textContent.length>200000)con.textContent=con.textContent.slice(-150000);if(atEnd)con.scrollTop=con.scrollHeight};
const c=await api('/api/servers/'+id+'/console');c.lines.forEach(add);con.scrollTop=con.scrollHeight;$('#pl').innerHTML=(s.playerList||[]).map(n=>'<span>'+esc(n)+'</span>').join('');
document.querySelector('main .row').onclick=async e=>{const b=e.target.closest('[data-a]');if(!b)return;if(b.dataset.a==='kill'&&!confirm('Wymusić zatrzymanie?'))return;try{await api('/api/servers/'+id+'/'+b.dataset.a,{method:'POST'})}catch(x){alert(x.message)}};
const send=async()=>{const v=$('#cmd').value.trim();if(!v)return;try{await api('/api/servers/'+id+'/command',{method:'POST',body:{cmd:v}});$('#cmd').value=''}catch(x){alert(x.message)}};$('#send').onclick=send;$('#cmd').onkeydown=e=>{if(e.key==='Enter')send()};
es=new EventSource('/api/servers/'+id+'/stream');es.addEventListener('log',e=>add(JSON.parse(e.data).line));es.addEventListener('status',()=>{})}
api('/api/servers').then(list).catch(e=>{if(e.message!=='auth')login()});
</script></body></html>`;

module.exports = { WebPanel, PAGE };
