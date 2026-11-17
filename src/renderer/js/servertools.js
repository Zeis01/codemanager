// Narzędzia serwerów: gracze, statystyki, mapa (Chunky), synchronizacja z graczem, sieć/porty,
// formularz konfiguracji, zadania harmonogramu, szablony
'use strict';
(function () {
  const { h, $, $$, icon, esc, api, toast, modal } = App;
  const st = App.st = {};

  // ---------- gracze ----------
  st.playersTab = async (c, s) => {
    const r = await api('servers:players', s.id);
    const can = a => r.actions.includes(a);
    c.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start">
      <div class="panel"><div class="panel-head"><h2>Gracze online <span class="dim" data-cnt></span></h2>${can('kick') || r.actions.length ? `<button class="btn sm" data-refresh>${icon('refresh')}Odśwież</button>` : ''}</div><div data-list></div>
      <p class="dim" style="font-size:12px;margin:12px 0 0">Lista powstaje z konsoli serwera (wejścia i wyjścia graczy)${s.type === 'minecraft' ? ' oraz polecenia list' : ''}. Po restarcie programu odśwież ją, gdy serwer działa.</p></div>
      <div class="panel"><h3 style="margin-bottom:10px">Gracz spoza listy</h3>${r.actions.length ? `<div class="field"><label>Nick gracza</label><input class="input" data-name placeholder="np. Steve"></div><div class="row" style="flex-wrap:wrap;gap:6px">${r.actions.map(a => `<button class="btn sm ${a === 'ban' ? 'danger' : ''}" data-act="${a}">${esc(r.labels[a] || a)}</button>`).join('')}</div>` : '<p class="muted" style="font-size:13px">Ten serwer nie przyjmuje poleceń dotyczących graczy przez konsolę. Użyj plików konfiguracyjnych (np. adminlist.txt, bannedlist.txt) w zakładce Konfiguracja.</p>'}</div></div>`;
    const list = $('[data-list]', c);
    const draw = d => {
      $('[data-cnt]', c).textContent = `(${d.count || 0})`;
      if (!d.players.length) { list.innerHTML = `<p class="muted">${s.status === 'running' ? (d.count ? `Na serwerze jest ${d.count} graczy (gra nie podaje ich nicków).` : 'Nikogo nie ma na serwerze.') : 'Serwer nie działa.'}</p>`; return; }
      list.innerHTML = ''; for (const p of d.players.sort((a, b) => a.localeCompare(b))) {
        const row = h(`<div class="player"><span class="avatar">${esc(p.slice(0, 1).toUpperCase())}</span><span style="flex:1;font-weight:600">${esc(p)}</span>${r.actions.filter(a => ['kick', 'ban', 'op'].includes(a)).map(a => `<button class="btn sm ${a === 'ban' ? 'danger' : 'ghost'}" data-a="${a}">${esc(r.labels[a])}</button>`).join('')}${r.actions.length > 3 ? `<button class="btn sm ghost icon" data-more title="Więcej">⋯</button>` : ''}</div>`);
        row.onclick = async e => {
          const b = e.target.closest('[data-a]'); if (b) return act(b.dataset.a, p);
          if (e.target.closest('[data-more]')) modal({ title: p, body: `<div class="row" style="flex-wrap:wrap;gap:6px">${r.actions.map(a => `<button class="btn ${a === 'ban' ? 'danger' : ''}" data-x="${a}">${esc(r.labels[a])}</button>`).join('')}</div>` }) && setTimeout(() => $$('[data-x]').forEach(x => x.onclick = () => { act(x.dataset.x, p); $$('.modal-back').forEach(m => m.remove()); }), 0);
        };
        list.appendChild(row);
      }
    };
    const act = async (a, name) => {
      if (a === 'ban' && !(await App.confirmBox(`Zbanować ${name}?`, 'Gracz nie będzie mógł wejść na serwer, dopóki go nie odbanujesz.', 'Zbanuj', true))) return;
      try { const cmd = await window.cm.call('servers:playerAction', s.id, a, name); toast(`Wysłano: ${cmd}`); } catch (e) { toast(e.message, 'error'); }
    };
    draw(r);
    App.onServerPlayers = d => { if (d.id === s.id && c.isConnected) draw(d); };
    const rf = $('[data-refresh]', c); if (rf) rf.onclick = async () => { await api('servers:refreshPlayers', s.id); toast('Wysłano zapytanie o listę graczy'); };
    $$('[data-act]', c).forEach(b => b.onclick = () => { const n = $('[data-name]', c).value.trim(); if (!n) { toast('Podaj nick gracza', 'warn'); return; } act(b.dataset.act, n); });
    if (s.status === 'running' && s.type === 'minecraft') api('servers:refreshPlayers', s.id).catch(() => {});
  };

  // ---------- statystyki: trzy osobne wykresy (CPU, RAM, gracze) ----------
  const RANGES = [['15m', 15 * 60000, '15 min'], ['1h', 3600000, '1 godz.'], ['6h', 6 * 3600000, '6 godz.'], ['24h', 86400000, '24 godz.']];
  function lineChart(el, points, { key, fmt, max, title }) {
    const W = el.clientWidth || 600, H = 150, P = { l: 52, r: 12, t: 10, b: 22 };
    const pts = points.filter(p => p[key] != null);
    if (pts.length < 2) { el.innerHTML = `<div class="chart-empty">Za mało danych – wykres pojawi się po minucie działania serwera.</div>`; return; }
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const vmax = Math.max(max || 0, ...pts.map(p => p[key])) || 1;
    const nice = (() => { const e = Math.pow(10, Math.floor(Math.log10(vmax))); const f = vmax / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; })();
    const x = t => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
    const y = v => P.t + (1 - v / nice) * (H - P.t - P.b);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    const grid = [0, 0.5, 1].filter(f => key !== 'players' || Number.isInteger(nice * f)).map(f => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(nice * f)}" y2="${y(nice * f)}" class="grid"/><text x="${P.l - 6}" y="${y(nice * f) + 4}" class="ax" text-anchor="end">${esc(fmt(nice * f, true))}</text>`).join('');
    const tl = t => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="${esc(title)}">${grid}<text x="${P.l}" y="${H - 5}" class="ax">${tl(t0)}</text><text x="${W - P.r}" y="${H - 5}" class="ax" text-anchor="end">${tl(t1)}</text><path d="${d}" class="line"/><line class="xh hidden" y1="${P.t}" y2="${H - P.b}"/><circle class="dotp hidden" r="4"/><rect x="${P.l}" y="${P.t}" width="${W - P.l - P.r}" height="${H - P.t - P.b}" fill="transparent" class="hit"/></svg><div class="tip hidden"></div>`;
    const svg = $('svg', el), tip = $('.tip', el), xh = $('.xh', el), dot = $('.dotp', el);
    $('.hit', el).onmousemove = e => {
      const r = svg.getBoundingClientRect(); const mx = e.clientX - r.left;
      const t = t0 + ((mx - P.l) / (W - P.l - P.r)) * (t1 - t0);
      let best = pts[0]; for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      const px = x(best.t), py = y(best[key]);
      xh.setAttribute('x1', px); xh.setAttribute('x2', px); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      [xh, dot, tip].forEach(n => n.classList.remove('hidden'));
      tip.innerHTML = `<b>${esc(fmt(best[key]))}</b><span>${new Date(best.t).toLocaleTimeString('pl-PL')}</span>`;
      tip.style.left = Math.min(px + 10, W - 120) + 'px'; tip.style.top = Math.max(0, py - 40) + 'px';
    };
    $('.hit', el).onmouseleave = () => [xh, dot, tip].forEach(n => n.classList.add('hidden'));
  }
  st.statsTab = async (c, s) => {
    let range = '1h';
    c.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="seg">${RANGES.map(r => `<button data-r="${r[0]}">${r[2]}</button>`).join('')}</div><span style="flex:1"></span><span class="dim" style="font-size:12.5px" data-now></span></div>
      <div class="stat-grid"><div class="panel"><div class="panel-head"><h2>Procesor</h2><span class="stat-v" data-v="cpu">–</span></div><div class="chart" data-c="cpu"></div></div>
      <div class="panel"><div class="panel-head"><h2>Pamięć RAM</h2><span class="stat-v" data-v="mem">–</span></div><div class="chart" data-c="mem"></div></div>
      <div class="panel"><div class="panel-head"><h2>Gracze online</h2><span class="stat-v" data-v="players">–</span></div><div class="chart" data-c="players"></div></div></div>
      <p class="dim" style="font-size:12px">Pomiary co 10 sekund, gdy serwer działa (proces serwera razem z procesami potomnymi). CPU w % całego procesora. Historia jest przechowywana do zamknięcia programu.</p>`;
    let hist = (await api('servers:stats', s.id)).history || [];
    const fmts = { cpu: (v, axis) => `${axis ? Math.round(v) : v.toFixed(v < 10 ? 1 : 0)}%`, mem: (v, axis) => (axis ? (v ? `${(v / 1024 ** 3).toFixed(v < 1024 ** 3 ? 2 : 1)} GB` : '0') : v >= 1024 ** 3 ? `${(v / 1024 ** 3).toFixed(2)} GB` : App.fmtSize(v)), players: (v, axis) => (axis ? String(Math.round(v)) : App.plural(Math.round(v), 'gracz', 'graczy', 'graczy')) };
    const draw = () => {
      $$('[data-r]', c).forEach(b => b.classList.toggle('active', b.dataset.r === range));
      const ms = RANGES.find(r => r[0] === range)[1]; const pts = hist.filter(p => p.t >= Date.now() - ms);
      const last = hist[hist.length - 1];
      for (const k of ['cpu', 'mem', 'players']) { lineChart($(`[data-c="${k}"]`, c), pts, { key: k, fmt: fmts[k], max: k === 'cpu' ? 10 : k === 'players' ? 4 : 0, title: k }); $(`[data-v="${k}"]`, c).textContent = last && last[k] != null ? fmts[k](last[k]) : '–'; }
      $('[data-now]', c).textContent = s.status === 'running' ? (last ? 'Ostatni pomiar ' + new Date(last.t).toLocaleTimeString('pl-PL') : 'Czekam na pierwszy pomiar…') : 'Serwer nie działa';
    };
    $$('[data-r]', c).forEach(b => b.onclick = () => { range = b.dataset.r; draw(); });
    draw();
    App.onServerStats = d => { if (d.id !== s.id || !c.isConnected) return; hist.push(d); draw(); };
  };

  // ---------- mapa: Chunky ----------
  st.mapTab = async (c, s) => {
    const r = await api('chunky:status', s.id);
    c.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start"><div class="panel"><h2 style="margin-bottom:6px">Pre-generowanie mapy (Chunky)</h2>
      <p class="muted" style="font-size:13px;margin:0 0 14px">Wygenerowanie terenu przed wpuszczeniem graczy usuwa lagi przy eksploracji. Na dużym promieniu trwa to od kilkunastu minut do kilku godzin.</p>
      ${r.installed ? '' : `<div class="note warn" style="margin-bottom:12px">Chunky nie jest zainstalowany. <button class="btn sm primary" data-inst style="margin-left:8px">${icon('download')}Zainstaluj z Modrinth</button><br><span class="dim" style="font-size:12px">Po instalacji zrestartuj serwer.</span></div>`}
      <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:0 12px">
        <div class="field"><label>Świat</label><input class="input" data-w value="world"></div>
        <div class="field"><label>Promień (bloki)</label><input class="input" type="number" data-r value="3000" min="100" step="500"></div>
        <div class="field"><label>Kształt</label><select class="input" data-sh><option value="square">Kwadrat</option><option value="circle">Koło</option></select></div></div>
      <div class="field"><label>Środek (X Z)</label><input class="input" data-cen value="0 0"></div>
      <div class="row"><button class="btn primary" data-go ${r.installed && r.running ? '' : 'disabled'}>${icon('play')}Start</button><button class="btn" data-c="pause">Pauza</button><button class="btn" data-c="continue">Wznów</button><button class="btn danger" data-c="cancel">Anuluj</button></div>
      ${r.running ? '' : '<p class="dim" style="font-size:12.5px">Uruchom serwer, aby zacząć.</p>'}</div>
      <div class="panel"><h3 style="margin-bottom:10px">Postęp</h3><div data-prog></div></div></div>
      <div class="panel" style="margin-top:12px" data-webmap></div>`;
    st.webmap($('[data-webmap]', c), s);
    const prog = $('[data-prog]', c);
    const draw = p => {
      if (!p) { prog.innerHTML = '<p class="muted" style="font-size:13px">Nic nie jest generowane.</p>'; return; }
      prog.innerHTML = `<div class="progress" style="margin-bottom:8px"><i style="width:${Math.min(100, p.pct || 0)}%"></i></div><dl class="meta-list"><dt>Świat</dt><dd>${esc(p.world || '')}</dd><dt>Postęp</dt><dd>${(p.pct || 0).toFixed(2)}%</dd>${p.chunks ? `<dt>Chunki</dt><dd>${p.chunks.toLocaleString('pl-PL')}</dd>` : ''}${p.eta && p.running ? `<dt>Pozostało</dt><dd>${esc(p.eta)}</dd>` : ''}<dt>Stan</dt><dd>${p.running ? 'trwa' : p.finished ? 'zakończono' : 'zatrzymano'}</dd></dl>`;
    };
    draw(r.progress);
    App.onServerChunky = d => { if (d.id === s.id && c.isConnected) draw(d); };
    const inst = $('[data-inst]', c); if (inst) inst.onclick = async () => { const x = await App.runJob('Instalacja Chunky', jobId => window.cm.call('chunky:install', jobId, s.id), { doneMsg: 'Zainstalowano. Zrestartuj serwer.' }); if (x) st.mapTab(c, s); };
    $('[data-go]', c).onclick = async () => { await api('chunky:start', s.id, { world: $('[data-w]', c).value, radius: $('[data-r]', c).value, shape: $('[data-sh]', c).value, center: $('[data-cen]', c).value }); toast('Generowanie rozpoczęte – postęp widać też w konsoli'); };
    $$('[data-c]', c).forEach(b => b.onclick = () => api('chunky:control', s.id, b.dataset.c).then(() => toast('Wysłano polecenie')));
  };

  // ---------- podgląd mapy: BlueMap / squaremap / Dynmap ----------
  st.webmap = async (box, s) => {
    const r = await api('webmap:status', s.id);
    const m = r.map;
    if (!m) {
      box.innerHTML = `<h2 style="margin-bottom:6px">Podgląd mapy świata</h2><p class="muted" style="font-size:13px;margin:0 0 12px">Mapa w przeglądarce, na której widać teren i graczy. Zainstaluj jeden z modów/pluginów – CodeManager pokaże mapę tutaj.</p>
        <div class="grid two"><div class="tpl" style="cursor:default"><b>BlueMap</b><span class="muted">Mapa 3D z prawdziwymi teksturami. Wymaga zgody na pobranie plików gry od Mojang (do tekstur). Paper, Fabric, NeoForge, Forge.</span><button class="btn sm primary" data-inst="bluemap">${icon('download')}Zainstaluj BlueMap</button></div>
        <div class="tpl" style="cursor:default"><b>squaremap</b><span class="muted">Lekka mapa 2D z góry, szybko się generuje. Paper i Fabric.</span><button class="btn sm primary" data-inst="squaremap" ${['paper', 'purpur', 'fabric'].includes(r.variant) ? '' : 'disabled title="Niedostępny dla tego silnika"'}>${icon('download')}Zainstaluj squaremap</button></div></div>`;
      $$('[data-inst]', box).forEach(b => b.onclick = async () => { const x = await App.runJob(`Instalacja: ${b.dataset.inst}`, jobId => window.cm.call('webmap:install', jobId, s.id, b.dataset.inst), { doneMsg: 'Zainstalowano. Zrestartuj serwer, aby mapa się uruchomiła.' }); if (x) st.webmap(box, s); });
      return;
    }
    const url = `http://127.0.0.1:${m.port}/`;
    box.innerHTML = `<div class="panel-head"><h2>Podgląd mapy – ${esc(m.name)}</h2><span class="dim mono" style="font-size:12px">${esc(url)}</span><button class="btn sm" data-ext>${icon('globe')}Otwórz w przeglądarce</button><button class="btn sm ghost" data-re>${icon('refresh')}</button></div>
      ${m.kind === 'bluemap' && !m.accepted ? `<div class="note warn" style="margin-bottom:10px">${m.configured ? 'BlueMap czeka na zgodę na pobranie plików Minecrafta od Mojang (potrzebne do tekstur mapy). Klikając, akceptujesz warunki Mojang dotyczące tych plików.' : 'Uruchom serwer raz, aby BlueMap utworzył konfigurację.'} ${m.configured ? `<button class="btn sm primary" data-accept style="margin-left:8px">Zgadzam się i włącz mapę</button>` : ''}</div>` : ''}
      ${r.running ? `<iframe class="webmap" src="${esc(url)}" title="Mapa świata"></iframe><p class="dim" style="font-size:12px;margin:8px 0 0">Jeśli mapa jest pusta, poczekaj chwilę – pierwsze renderowanie świata trwa. Znajomym możesz udostępnić port ${m.port} (zakładka Sieć).</p>` : '<p class="muted" style="font-size:13px">Uruchom serwer, aby zobaczyć mapę.</p>'}`;
    $('[data-ext]', box).onclick = () => api('shell:external', url);
    $('[data-re]', box).onclick = () => st.webmap(box, s);
    const ac = $('[data-accept]', box); if (ac) ac.onclick = async () => { await api('webmap:accept', s.id); toast('Zgoda zapisana. Zrestartuj serwer, aby BlueMap zaczął rysować mapę.'); st.webmap(box, s); };
  };

  // ---------- synchronizacja z graczem ----------
  st.syncTab = async (c, s) => {
    const det = App.state.detected;
    let tgt = {};
    let picker = '';
    if (s.type === 'minecraft') {
      const inst = det && det.games.minecraft && det.games.minecraft.found ? det.games.minecraft.instances : [];
      if (!inst.length) { c.innerHTML = '<div class="empty"><h2>Nie wykryto instancji Minecrafta</h2><p>Synchronizacja porównuje mody serwera z instancją gry na tym komputerze.</p></div>'; return; }
      const best = inst.find(i => i.mcVersion === s.version && i.loader === s.variant) || inst[0];
      tgt = { profileId: best.id };
      picker = `<div class="field" style="max-width:520px"><label>Instancja gracza</label><select class="input" data-inst>${inst.map(i => `<option value="${esc(i.id)}" ${i.id === best.id ? 'selected' : ''}>${esc(i.name)}${i.mcVersion ? ` – ${esc(i.mcVersion)} ${esc(i.loader || '')}` : ''}</option>`).join('')}</select></div>`;
    }
    c.innerHTML = `<p class="lead" style="margin:0 0 12px">Porównanie modów serwera z modami gracza na tym komputerze. Brakujące mody możesz od razu skopiować do gry albo spakować w ZIP dla znajomego.</p>${picker}<div data-out><div class="progress indet"><i></i></div></div>`;
    const out = $('[data-out]', c);
    const run = async () => {
      out.innerHTML = '<div class="progress indet"><i></i></div>';
      let r; try { r = await App.apiQuiet('sync:compare', s.id, tgt); } catch (e) { out.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
      const sec = (t, l, cls, fmt) => `<div class="panel"><h3 style="margin-bottom:8px">${esc(t)} <span class="dim">(${l.length})</span></h3><div class="files ${cls}" style="max-height:300px;overflow:auto">${l.length ? l.map(fmt).join('<br>') : '<span class="dim">—</span>'}</div></div>`;
      const need = r.missing.length + r.mismatch.length;
      out.innerHTML = `<div class="summary-strip"><div class="e"><div class="n">${r.missing.length}</div><div class="l">brakuje u gracza</div></div><div class="w"><div class="n">${r.mismatch.length}</div><div class="l">inna wersja</div></div><div class="o"><div class="n">${r.ok.length}</div><div class="l">zgodne</div></div><span style="flex:1"></span>
        ${r.kind !== 'projectzomboid' ? `<button class="btn" data-pack ${need ? '' : 'disabled'}>${icon('archive')}Utwórz paczkę ZIP</button><button class="btn primary" data-inst2 ${need ? '' : 'disabled'}>${icon('download')}Skopiuj do gry</button>` : ''}<button class="btn" data-re>${icon('refresh')}Porównaj ponownie</button></div>
        <p class="dim" style="font-size:12.5px;margin:0 0 12px">${esc(r.note || '')}</p>
        <div class="grid three">${sec('Brakuje u gracza', r.missing, '', m => `${esc(m.name)} ${m.version ? `<span class="dim">${esc(m.version)}</span>` : ''}`)}${sec('Inna wersja', r.mismatch, '', m => `${esc(m.name)} <span class="dim">serwer ${esc(m.version)} · gracz ${esc(m.clientVersion)}</span>`)}${sec(r.kind === 'minecraft' ? 'Gracz ma, serwer nie (mogą być wymagane)' : 'Zgodne', r.kind === 'minecraft' ? r.extra : r.ok, '', m => `${esc(m.name)} ${m.version ? `<span class="dim">${esc(m.version)}</span>` : ''}`)}</div>`;
      $('[data-re]', out).onclick = run;
      const pk = $('[data-pack]', out); if (pk) pk.onclick = async () => { const f = await api('sync:pack', s.id, tgt); if (f) { toast('Zapisano paczkę'); api('shell:show', f); } };
      const ins = $('[data-inst2]', out); if (ins) ins.onclick = async () => { if (!(await App.confirmBox('Skopiować mody do gry?', `Brakujące mody (${need}) trafią do folderu gry gracza. Mody w innej wersji zostaną zastąpione (stare trafią do kopii zapasowej).`, 'Skopiuj'))) return; const x = await api('sync:install', s.id, tgt); toast(`Skopiowano ${x.installed.length} modów`); App.state.reports = {}; run(); };
    };
    const si = $('[data-inst]', c); if (si) si.onchange = () => { tgt = { profileId: si.value }; run(); };
    run();
  };

  // ---------- sieć: porty, UPnP ----------
  st.networkTab = async (c, s) => {
    const r = await api('ports:list', s.id);
    c.innerHTML = `<div class="grid two" style="align-items:start"><div class="panel"><h2 style="margin-bottom:6px">Porty serwera</h2><p class="muted" style="font-size:13px;margin:0 0 12px">Żeby znajomi spoza Twojej sieci mogli dołączyć, router musi przekierować te porty na ten komputer${r.local[0] ? ` (<span class="mono">${esc(r.local[0].address)}</span>)` : ''}.</p>
      <table class="table"><thead><tr><th>Port</th><th>Protokół</th><th>Do czego</th><th>Z internetu</th></tr></thead><tbody data-ports>${r.ports.map(p => `<tr data-k="${p.port}/${p.proto}"><td class="mono">${p.port}</td><td>${p.proto}</td><td class="muted">${esc(p.label)}</td><td data-res><span class="dim">–</span></td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:12px"><button class="btn" data-check>${icon('globe')}Sprawdź z internetu</button></div>
      <p class="dim" style="font-size:12px;margin:10px 0 0">Sprawdzane są porty TCP (przez ifconfig.co); port musi mieć działający serwer. Portów UDP nie da się wiarygodnie sprawdzić z zewnątrz – po ich otwarciu poproś znajomego o próbę połączenia.</p></div>
      <div class="panel"><h2 style="margin-bottom:6px">Automatycznie (UPnP)</h2><p class="muted" style="font-size:13px;margin:0 0 12px">Większość domowych routerów pozwala programom otworzyć porty samodzielnie (UPnP). Jeśli to wyłączone w routerze, przekieruj porty ręcznie w jego panelu.</p>
      <div data-upnp><button class="btn" data-find>${icon('search')}Znajdź router</button></div></div></div>`;
    const setRes = (p, html) => { const tr = $(`[data-k="${p.port}/${p.proto}"] [data-res]`, c); if (tr) tr.innerHTML = html; };
    $('[data-check]', c).onclick = async e => {
      e.currentTarget.disabled = true;
      try { const x = await api('ports:check', s.id); if (!x.running) toast('Serwer nie działa – zamknięty port może wynikać po prostu z tego.', 'warn', 6000); for (const p of x.results) setRes(p, { open: '<span class="chip ok">otwarty</span>', closed: '<span class="chip error">zamknięty</span>', unknown: '<span class="dim">UDP – nie da się sprawdzić</span>', error: `<span class="chip warn" title="${esc(p.error || '')}">błąd</span>` }[p.result]); }
      finally { e.target.disabled = false; }
    };
    const up = $('[data-upnp]', c);
    $('[data-find]', c).onclick = async () => {
      up.innerHTML = '<div class="progress indet"><i></i></div><p class="dim" style="font-size:12.5px">Szukam routera w sieci…</p>';
      let g; try { g = await App.apiQuiet('ports:upnpInfo'); } catch (e) { up.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
      const mine = g.mappings.filter(m => r.ports.some(p => p.port === m.port && p.proto === m.proto));
      up.innerHTML = `<dl class="meta-list"><dt>Router</dt><dd>${esc(g.router)}</dd><dt>Adres zewnętrzny</dt><dd class="mono">${esc(g.externalIp || 'nieznany')}</dd><dt>Ten komputer</dt><dd class="mono">${esc(g.local || '')}</dd><dt>Otwarte dla serwera</dt><dd>${mine.length}/${r.ports.length}</dd></dl>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-open>${icon('check')}Otwórz porty</button><button class="btn" data-close>Zamknij porty</button></div>
        ${g.externalIp ? `<p class="dim" style="font-size:12.5px;margin:10px 0 0">Znajomi łączą się na adres <span class="mono">${esc(g.externalIp)}:${s.port}</span>.</p>` : ''}`;
      $('[data-open]', up).onclick = async () => { const x = await api('ports:upnpOpen', s.id); const bad = x.filter(y => !y.ok); toast(bad.length ? `Nie udało się otworzyć ${bad.length} portów: ${bad[0].error}` : 'Porty otwarte', bad.length ? 'warn' : 'ok', 7000); $('[data-find]', c) || null; };
      $('[data-close]', up).onclick = async () => { await api('ports:upnpClose', s.id); toast('Porty zamknięte'); };
    };
  };

  // ---------- formularz konfiguracji ----------
  st.configForm = async (box, s) => {
    let f; try { f = await App.apiQuiet('servers:configForm', s.id); } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return false; }
    if (!f) return false;
    box.innerHTML = `<div class="panel"><div class="panel-head"><h2>Ustawienia serwera</h2><span class="dim mono" style="font-size:12px">${esc(f.rel)}</span></div>
      ${f.exists ? '' : '<div class="note warn" style="margin-bottom:12px">Plik jeszcze nie istnieje – zwykle powstaje przy pierwszym uruchomieniu serwera. Zapis utworzy go z wybranymi ustawieniami.</div>'}
      <div data-groups></div><div class="row" style="margin-top:6px"><button class="btn primary" data-save>${icon('save')}Zapisz ustawienia</button><span class="dim" style="font-size:12.5px">Zmiany zadziałają po restarcie serwera. Poprzednia wersja pliku: .bak</span></div></div>`;
    const gbox = $('[data-groups]', box);
    for (const g of f.groups) {
      const sec = h(`<fieldset class="cfg-group"><legend>${esc(g.title)}</legend><div class="cfg-grid"></div></fieldset>`);
      for (const fl of g.fields) {
        const v = fl.value;
        let input;
        if (fl.t === 'bool') input = `<label class="check" ${fl.present ? '' : 'title="Nie ustawiono w pliku – serwer używa wartości domyślnej"'}><input type="checkbox" data-k="${esc(fl.k)}" ${v ? 'checked' : ''} ${fl.present ? '' : 'data-unset'}><span>${esc(fl.l)}</span></label>`;
        else if (fl.t === 'select') input = `<label>${esc(fl.l)}</label><select class="input" data-k="${esc(fl.k)}">${v == null ? '<option value="" selected>domyślnie</option>' : ''}${v != null && !fl.o.some(o => o[0] === v) ? `<option value="${esc(v)}">${esc(v)}</option>` : ''}${fl.o.map(o => `<option value="${esc(o[0])}" ${o[0] === v ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
        else input = `<label>${esc(fl.l)}</label><input class="input" data-k="${esc(fl.k)}" type="${fl.t === 'number' ? 'number' : fl.t === 'password' ? 'password' : 'text'}" ${fl.min != null ? `min="${fl.min}"` : ''} ${fl.max != null ? `max="${fl.max}"` : ''} step="any" value="${esc(v == null ? '' : v)}" placeholder="${v == null ? 'domyślnie' : ''}">`;
        sec.querySelector('.cfg-grid').appendChild(h(`<div class="field ${fl.t === 'bool' ? 'bool' : ''}">${input}${fl.d ? `<span class="hint">${esc(fl.d)}</span>` : ''}</div>`));
      }
      gbox.appendChild(sec);
    }
    $$('[data-unset]', box).forEach(i => { i.indeterminate = true; });
    const val = i => (i.type === 'checkbox' ? (i.indeterminate ? 'unset' : i.checked) : i.value);
    const orig = {}; $$('[data-k]', box).forEach(i => { orig[i.dataset.k] = val(i); });
    $('[data-save]', box).onclick = async () => {
      const vals = {};
      $$('[data-k]', box).forEach(i => { const v = val(i); if (v !== orig[i.dataset.k] && v !== 'unset' && !(i.tagName === 'SELECT' && v === '')) vals[i.dataset.k] = v; });
      if (!Object.keys(vals).length) { toast('Nic nie zmieniono', 'warn'); return; }
      const r = await api('servers:configFormSave', s.id, vals); toast(`Zapisano ${App.plural(r.changed, 'ustawienie', 'ustawienia', 'ustawień')}`); Object.assign(orig, vals);
    };
    return true;
  };

  // ---------- zadania harmonogramu ----------
  const KINDS = [['command', 'Polecenie konsoli'], ['say', 'Ogłoszenie na czacie'], ['backup', 'Kopia zapasowa'], ['restart', 'Restart'], ['stop', 'Zatrzymanie'], ['start', 'Uruchomienie']];
  const DAYS = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
  st.tasksEditor = (box, s, onSave) => {
    let tasks = JSON.parse(JSON.stringify((s.schedule && s.schedule.tasks) || []));
    const draw = () => {
      box.innerHTML = `<div class="panel-head" style="margin-top:0"><h2>Zadania</h2><button class="btn sm" data-add>${icon('plus')}Dodaj zadanie</button></div>
        ${tasks.length ? '' : '<p class="dim" style="font-size:13px">Brak zadań. Przykłady: ogłoszenie co 30 min, save-all o pełnej godzinie, czyszczenie mapy w nocy.</p>'}<div data-list></div>
        ${tasks.length ? `<button class="btn primary" data-save style="margin-top:8px">${icon('save')}Zapisz zadania</button>` : ''}`;
      const list = $('[data-list]', box);
      tasks.forEach((t, i) => {
        const row = h(`<div class="task"><div class="task-top"><label class="switch sm"><input type="checkbox" data-f="enabled" ${t.enabled !== false ? 'checked' : ''}><span></span></label>
          <select class="input" data-f="kind">${KINDS.map(k => `<option value="${k[0]}" ${t.kind === k[0] ? 'selected' : ''}>${k[1]}</option>`).join('')}</select>
          <select class="input" data-f="mode"><option value="at" ${!t.every ? 'selected' : ''}>O godzinie</option><option value="every" ${t.every ? 'selected' : ''}>Co X minut</option></select>
          <input class="input" data-f="${t.every ? 'every' : 'at'}" value="${esc(t.every || t.at || '')}" placeholder="${t.every ? '30' : '04:00, 16:00'}" style="width:130px">
          <button class="btn sm ghost icon danger" data-del title="Usuń">${icon('trash')}</button></div>
          ${['command', 'say'].includes(t.kind) ? `<textarea class="input mono" rows="${t.kind === 'command' ? 2 : 1}" data-f="value" placeholder="${t.kind === 'command' ? 'save-all\\n(każda linia to osobne polecenie)' : 'Treść ogłoszenia'}">${esc(t.value || '')}</textarea>` : ''}
          <div class="days">${DAYS.map((d, j) => `<label><input type="checkbox" data-day="${j}" ${!t.days || !t.days.length || t.days.includes(j) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>`);
        row.oninput = row.onchange = e => {
          const f = e.target.dataset.f;
          if (f === 'enabled') t.enabled = e.target.checked;
          else if (f === 'kind') { t.kind = e.target.value; draw(); return; }
          else if (f === 'mode') { if (e.target.value === 'every') { t.every = 30; delete t.at; } else { delete t.every; t.at = '04:00'; } draw(); return; }
          else if (f === 'every') t.every = +e.target.value || 1;
          else if (f) t[f] = e.target.value;
          if (e.target.dataset.day != null) { const all = $$('[data-day]', row).filter(x => x.checked).map(x => +x.dataset.day); t.days = all.length === 7 ? [] : all; }
        };
        $('[data-del]', row).onclick = () => { tasks.splice(i, 1); draw(); };
        list.appendChild(row);
      });
      $('[data-add]', box).onclick = () => { tasks.push({ id: 't' + Date.now().toString(36), enabled: true, kind: 'say', at: '18:00', value: '' }); draw(); };
      const sv = $('[data-save]', box); if (sv) sv.onclick = async () => {
        for (const t of tasks) if (!t.every && !/^\d{1,2}:\d{2}(\s*,\s*\d{1,2}:\d{2})*$/.test(String(t.at || '').trim())) { toast(`Nieprawidłowa godzina „${t.at}” – użyj formatu GG:MM`, 'warn'); return; }
        const sch = { ...(s.schedule || {}), tasks }; await api('servers:patch', s.id, { schedule: sch }); s.schedule = sch; toast('Zapisano zadania'); onSave && onSave();
      };
    };
    draw();
  };

  // ---------- szablony w kreatorze ----------
  st.templatePicker = async (onPick) => {
    const list = await api('servers:templates');
    const body = h(`<div class="tpl-list">${list.map(t => `<button class="tpl" data-t="${t.id}"><b>${esc(t.name)}</b><span class="muted">${esc(t.desc)}</span><span class="chip">${esc(t.typeName)}${t.variant ? ' · ' + esc(t.variant) : ''}</span></button>`).join('')}</div>`);
    const m = modal({ title: 'Nowy serwer z szablonu', wide: true, body });
    body.onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; m.close(); onPick(list.find(t => t.id === b.dataset.t)); };
  };

  // ---------- konsola: filtr i wyszukiwanie ----------
  st.consoleFilter = (con, type) => {
    const bar = h(`<div class="con-filter"><div class="seg sm">${[['all', 'Wszystko'], ['err', 'Błędy'], ['warn', 'Ostrzeżenia'], ['chat', 'Czat'], ['players', 'Gracze']].map(f => `<button data-f="${f[0]}" class="${f[0] === 'all' ? 'active' : ''}">${f[1]}</button>`).join('')}</div><div class="searchbox sm">${icon('search')}<input class="input" placeholder="Szukaj w konsoli" data-q></div><span class="dim" data-n></span></div>`);
    let mode = 'all', q = '';
    const P = { join: /joined the game|has joined|fully-connected|joined the server|joined this ARK|logged in|connected|Got character ZDOID/i, leave: /left the game|has left|\[disconnect\]|left the server|left this ARK|Remove Player|disconnected/i, chat: /<[^>]{2,24}>\s|\[chat\]|\[CHAT\]|" say "|^CHAT:/i };
    const match = d => {
      const t = d.textContent;
      if (mode === 'err' && !d.classList.contains('l-err')) return false;
      if (mode === 'warn' && !d.classList.contains('l-warn')) return false;
      if (mode === 'chat' && !P.chat.test(t)) return false;
      if (mode === 'players' && !P.join.test(t) && !P.leave.test(t)) return false;
      if (q && !t.toLowerCase().includes(q)) return false;
      return true;
    };
    const mark = d => {
      const ok = match(d); d.classList.toggle('hidden', !ok);
      if (ok && q && !d.dataset.raw) { d.dataset.raw = d.textContent; }
      if (d.dataset.raw) { const raw = d.dataset.raw; if (q) { const i = raw.toLowerCase().indexOf(q); d.innerHTML = i < 0 ? esc(raw) : esc(raw.slice(0, i)) + '<mark>' + esc(raw.slice(i, i + q.length)) + '</mark>' + esc(raw.slice(i + q.length)); } else { d.textContent = raw; delete d.dataset.raw; } }
    };
    const apply = () => { let n = 0; for (const d of con.children) { mark(d); if (!d.classList.contains('hidden')) n++; } $('[data-n]', bar).textContent = mode === 'all' && !q ? '' : `${n} wierszy`; };
    bar.onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; mode = b.dataset.f; $$('[data-f]', bar).forEach(x => x.classList.toggle('active', x === b)); apply(); };
    let t; $('[data-q]', bar).oninput = e => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); apply(); }, 200); };
    return { bar, onAdd: d => { if (mode !== 'all' || q) mark(d); }, active: () => mode !== 'all' || !!q };
  };
})();
