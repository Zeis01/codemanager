// Zdalna konsola RCON (Source RCON, FiveM UDP, Rust WebRCON)
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast } = App;
  const PRESETS = [
    { label: 'Minecraft', protocol: 'source', port: 25575 }, { label: 'CS2 / TF2 / gry Source', protocol: 'source', port: 27015 }, { label: 'Rust (WebRCON)', protocol: 'webrcon', port: 28016 },
    { label: 'ARK', protocol: 'source', port: 27020 }, { label: 'Palworld', protocol: 'source', port: 25575 }, { label: 'Project Zomboid', protocol: 'source', port: 27015 }, { label: 'FiveM', protocol: 'quake', port: 30120 },
  ];
  const sessions = new Map(); // id -> { ws?, log: [] }

  // Konsola RCON wielokrotnego użytku: conn = { id, host, port, password, protocol, name }
  function consolePanel(conn) {
    const sess = sessions.get(conn.id) || { log: [], connected: false };
    sessions.set(conn.id, sess);
    const el = h(`<div class="console-wrap" style="height:calc(100vh - 330px)">
      <div class="rcon-bar"><span class="dot ${sess.connected ? 'running' : ''}" data-dot></span><span data-st>${sess.connected ? 'Połączono' : 'Rozłączono'}</span><span class="dim mono" style="margin-left:8px">${esc(conn.host)}:${esc(conn.port)} · ${esc({ source: 'Source RCON', quake: 'FiveM (UDP)', webrcon: 'Rust WebRCON' }[conn.protocol])}</span><span style="flex:1"></span>
        <button class="btn sm" data-c>${icon('link')}${sess.connected ? 'Połącz ponownie' : 'Połącz'}</button><button class="btn sm ghost" data-d>Rozłącz</button></div>
      <div class="console" data-con></div>
      <div class="console-input"><span>›</span><input placeholder="Polecenie RCON (np. list, status, players)" data-cmd></div></div>`);
    const con = $('[data-con]', el);
    const add = (line, cls = '') => { sess.log.push([line, cls]); if (sess.log.length > 2000) sess.log.shift(); const d = document.createElement('div'); d.className = cls; d.textContent = line; con.appendChild(d); con.scrollTop = con.scrollHeight; };
    sess.log.forEach(([l, c]) => { const d = document.createElement('div'); d.className = c; d.textContent = l; con.appendChild(d); });
    con.scrollTop = con.scrollHeight;
    const setSt = ok => { sess.connected = ok; $('[data-dot]', el).className = 'dot ' + (ok ? 'running' : ''); $('[data-st]', el).textContent = ok ? 'Połączono' : 'Rozłączono'; };
    const connect = async () => {
      add(`Łączenie z ${conn.host}:${conn.port}…`, 'l-head');
      try {
        if (conn.protocol === 'webrcon') {
          if (sess.ws) try { sess.ws.close(); } catch { /* */ }
          await new Promise((res, rej) => {
            const ws = new WebSocket(`ws://${conn.host}:${conn.port}/${encodeURIComponent(conn.password || '')}`);
            const t = setTimeout(() => { ws.close(); rej(new Error('Przekroczono czas połączenia')); }, 6000);
            ws.onopen = () => { clearTimeout(t); sess.ws = ws; res(); };
            ws.onerror = () => { clearTimeout(t); rej(new Error('Nie udało się połączyć (sprawdź port i hasło RCON).')); };
            ws.onclose = () => { setSt(false); };
            ws.onmessage = ev => { try { const j = JSON.parse(ev.data); if (j.Message) add(j.Message, j.Type === 'Error' ? 'l-err' : j.Type === 'Warning' ? 'l-warn' : ''); } catch { add(String(ev.data)); } };
          });
        } else await window.cm.call('rcon:connect', conn.id, { host: conn.host, port: conn.port, password: conn.password, protocol: conn.protocol });
        setSt(true); add('✔ Połączono', 'l-ok');
      } catch (e) { setSt(false); add('✖ ' + e.message, 'l-err'); }
    };
    $('[data-c]', el).onclick = connect;
    $('[data-d]', el).onclick = () => { if (sess.ws) sess.ws.close(); api('rcon:disconnect', conn.id); setSt(false); add('Rozłączono', 'l-head'); };
    const hist = []; let hi = -1;
    const inp = $('[data-cmd]', el);
    inp.onkeydown = async e => {
      if (e.key === 'Enter' && inp.value.trim()) {
        const cmd = inp.value.trim(); hist.unshift(cmd); hi = -1; inp.value = '';
        add('> ' + cmd, 'l-cmd');
        try {
          if (conn.protocol === 'webrcon') { if (!sess.ws || sess.ws.readyState !== 1) throw new Error('Brak połączenia'); sess.ws.send(JSON.stringify({ Identifier: Date.now() % 100000, Message: cmd, Name: 'CodeManager' })); }
          else { const r = await window.cm.call('rcon:exec', conn.id, cmd); add(r && r.trim() ? r.trim() : '(brak odpowiedzi)'); }
        } catch (err) { add('✖ ' + err.message, 'l-err'); }
      }
      if (e.key === 'ArrowUp' && hist.length) { hi = Math.min(hi + 1, hist.length - 1); inp.value = hist[hi]; e.preventDefault(); }
      if (e.key === 'ArrowDown') { hi = Math.max(hi - 1, -1); inp.value = hi >= 0 ? hist[hi] : ''; e.preventDefault(); }
    };
    if (!sess.connected) setTimeout(connect, 50);
    return el;
  }
  App.rconConsole = consolePanel;

  async function render(el) {
    const saved = await api('rcon:saved');
    let current = saved[0] || null;
    el.innerHTML = `<div class="head"><div class="grow"><h1>Zdalna konsola RCON</h1><p class="lead">Wysyłaj polecenia do serwerów – także tych na innych komputerach i hostingach. Obsługiwane: Source RCON (Minecraft, CS2, TF2, ARK, Palworld, Project Zomboid), Rust WebRCON i FiveM.</p></div><button class="btn primary" data-new>${icon('plus')}Nowe połączenie</button></div>
      <div class="grid" style="grid-template-columns:280px minmax(0,1fr);align-items:start"><div class="panel" style="padding:10px"><div data-list></div></div><div data-main></div></div>`;
    const list = $('[data-list]', el); const main = $('[data-main]', el);
    const drawList = () => {
      list.innerHTML = '';
      const local = App.state.servers.filter(s => s.status === 'running');
      if (local.length) list.appendChild(h('<div class="dim" style="font-size:12px;padding:4px 8px">Twoje działające serwery</div>'));
      for (const s of local) {
        const b = h(`<button class="logitem"><span class="dot running"></span><span style="flex:1">${esc(s.name)}</span></button>`);
        b.onclick = async () => { const r = await api('servers:rconInfo', s.id); if (!r.info) { toast(r.hint || 'Ten serwer nie obsługuje RCON – użyj konsoli w zakładce Serwery.', 'warn', 7000); return; } current = { id: 'srv-' + s.id, name: s.name, host: r.info.host, port: r.info.port, password: r.info.password, protocol: r.info.protocol }; drawMain(); };
        list.appendChild(b);
      }
      list.appendChild(h('<div class="dim" style="font-size:12px;padding:10px 8px 4px">Zapisane połączenia</div>'));
      if (!saved.length) list.appendChild(h('<p class="dim" style="font-size:12.5px;padding:0 8px">Brak – dodaj przyciskiem „Nowe połączenie”.</p>'));
      for (const c of saved) {
        const b = h(`<button class="logitem ${current && current.id === c.id ? 'sel' : ''}"><span>${icon('terminal')}</span><span style="flex:1;min-width:0"><span style="display:block">${esc(c.name)}</span><span class="dim mono" style="font-size:11px">${esc(c.host)}:${esc(c.port)}</span></span></button>`);
        b.onclick = () => { current = c; drawList(); drawMain(); };
        list.appendChild(b);
      }
    };
    const drawMain = () => {
      main.innerHTML = '';
      if (!current) { main.innerHTML = '<div class="panel empty"><h2>Wybierz lub dodaj połączenie</h2><p>Potrzebujesz adresu serwera, portu RCON i hasła.</p></div>'; return; }
      const head = h(`<div class="row" style="margin-bottom:10px"><h2 style="flex:1">${esc(current.name)}</h2>${saved.find(x => x.id === current.id) ? `<button class="btn sm ghost" data-ed>${icon('edit')}Edytuj</button><button class="btn sm ghost danger" data-rm>${icon('trash')}</button>` : ''}</div>`);
      const ed = $('[data-ed]', head); if (ed) ed.onclick = () => editConn(current);
      const rm = $('[data-rm]', head); if (rm) rm.onclick = async () => { const n = await api('rcon:remove', current.id); saved.splice(0, saved.length, ...n); current = saved[0] || null; drawList(); drawMain(); };
      main.appendChild(head); main.appendChild(consolePanel(current));
    };
    const editConn = c => {
      const body = h(`<div><div class="field"><label>Typ serwera</label><select class="input" data-pre><option value="">— wybierz, aby uzupełnić port —</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}</select></div>
        <div class="grid" style="grid-template-columns:2fr 1fr;gap:0 12px"><div class="field"><label>Nazwa</label><input class="input" data-k="name" value="${esc(c ? c.name : '')}"></div><div class="field"><label>Protokół</label><select class="input" data-k="protocol"><option value="source">Source RCON</option><option value="webrcon">Rust WebRCON</option><option value="quake">FiveM (UDP)</option></select></div>
        <div class="field"><label>Adres (IP lub domena)</label><input class="input mono" data-k="host" value="${esc(c ? c.host : '127.0.0.1')}"></div><div class="field"><label>Port</label><input class="input" type="number" data-k="port" value="${esc(c ? c.port : 25575)}"></div></div>
        <div class="field"><label>Hasło RCON</label><input class="input mono" type="password" data-k="password" value="${esc(c ? c.password : '')}"><span class="hint">Hasło jest zapisywane lokalnie w konfiguracji CodeManager.</span></div></div>`);
      if (c) $('[data-k="protocol"]', body).value = c.protocol;
      $('[data-pre]', body).onchange = e => { const p = PRESETS[e.target.value]; if (!p) return; $('[data-k="port"]', body).value = p.port; $('[data-k="protocol"]', body).value = p.protocol; if (!$('[data-k="name"]', body).value) $('[data-k="name"]', body).value = p.label; };
      App.modal({ title: c ? 'Edytuj połączenie' : 'Nowe połączenie RCON', body, actions: [{ label: 'Anuluj' }, { label: 'Zapisz', primary: true, onClick: async () => {
        const o = { id: c ? c.id : 'r' + Date.now().toString(36) }; $$('[data-k]', body).forEach(i => { o[i.dataset.k] = i.type === 'number' ? +i.value : i.value.trim(); });
        if (!o.host || !o.port) { toast('Podaj adres i port', 'warn'); return false; }
        if (!o.name) o.name = `${o.host}:${o.port}`;
        const n = await api('rcon:save', o); saved.splice(0, saved.length, ...n); sessions.delete(o.id); current = o; drawList(); drawMain();
      } }] });
    };
    $('[data-new]', el).onclick = () => editConn(null);
    drawList(); drawMain();
  }

  App.views.rcon = { crumb: () => '<b>RCON</b>', render };
})();
