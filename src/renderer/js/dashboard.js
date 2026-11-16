// Przegląd
'use strict';
App.views = App.views || {};
App.views.dashboard = {
  crumb: () => '<b>Przegląd</b>',
  render(el) {
    const { h, $, icon, esc, gameBadge, api } = App;
    const st = App.state;
    const det = st.detected;
    const found = det ? st.defs.games.filter(g => det.games[g.id] && det.games[g.id].found) : [];
    const running = st.servers.filter(s => s.status === 'running');
    const reports = Object.values(st.reports);
    const errs = reports.reduce((a, r) => a + (r.counts ? r.counts.error : 0), 0);
    const checked = reports.length;
    el.innerHTML = `
      <div class="head"><div class="grow"><h1>Przegląd</h1></div>
        <div class="row"><button class="btn" data-detect>${icon('refresh')}Wykryj gry</button><button class="btn" data-go="servers">${icon('plus')}Nowy serwer</button></div></div>
      <div class="kv">
        <div><div class="v">${det ? found.length : '…'}</div><div class="k">wykrytych gier z ${st.defs.games.length}</div></div>
        <div><div class="v">${running.length} / ${st.servers.length}</div><div class="k">serwerów działa</div></div>
        <div><div class="v" style="${errs ? 'color:var(--error)' : ''}">${checked ? errs : '–'}</div><div class="k">${checked ? `błędów zgodności (${checked} sprawdzonych gier)` : 'gry nie były sprawdzane'}</div></div>
        <div><div class="v">${esc((st.update && st.update.current) || '')}</div><div class="k">${st.update && st.update.state === 'available' ? `dostępna wersja ${esc(st.update.latest)}` : 'wersja programu'}</div></div>
      </div>
      <div class="overview">
        <div class="panel flush"><div class="panel-head"><h2>Gry</h2><button class="btn sm ghost" data-go="games">Wszystkie</button></div>
          <table class="table"><thead><tr><th class="ic-cell"></th><th>Nazwa</th><th>Źródło</th><th>Mody</th><th>Stan</th></tr></thead><tbody data-games></tbody></table></div>
        <div>
          <div class="panel flush"><div class="panel-head"><h2>Serwery</h2><button class="btn sm ghost" data-go="servers">Zarządzaj</button></div>
            <table class="table"><thead><tr><th class="ic-cell"></th><th>Nazwa</th><th>Stan</th><th>Port</th></tr></thead><tbody data-servers></tbody></table></div>
          <div class="panel flush" style="margin-top:12px"><div class="panel-head"><h2>Narzędzia</h2></div>
            <div class="linklist">
              <button data-go="analyzer">${icon('pulse')}<span>Analizator błędów<small>Wyjaśnia, dlaczego gra lub serwer się wyłącza</small></span></button>
              <button data-go="installers">${icon('download')}<span>Instalatory<small>BepInEx, MelonLoader, RedLoader, Fabric, Forge, NeoForge, Quilt</small></span></button>
              <button data-go="editor">${icon('code')}<span>Edytor plików<small>Konfiguracje i skrypty z podświetlaniem składni</small></span></button>
              <button data-go="rcon">${icon('terminal')}<span>Konsola RCON<small>Polecenia dla serwerów lokalnych i zdalnych</small></span></button>
            </div></div>
        </div>
      </div>`;
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => App.go(b.dataset.go));
    $('[data-detect]', el).onclick = async e => { e.currentTarget.disabled = true; App.state.detected = await api('games:detect'); App.renderRail(); App.loadIcons(); App.refreshCurrent(); };
    const gt = $('[data-games]', el);
    if (!det) gt.innerHTML = '<tr><td colspan="5" class="muted">Wyszukiwanie gier…</td></tr>';
    else if (!found.length) gt.innerHTML = '<tr><td colspan="5" class="muted">Nie wykryto obsługiwanych gier. Otwórz „Znalezione gry”, aby wskazać folder ręcznie.</td></tr>';
    for (const g of found) {
      const info = det.games[g.id]; const rep = st.reports[g.id];
      const stan = g.compat === 'none' ? '<span class="dim">instalacja ręczna</span>' : !rep ? '<span class="dim">nie sprawdzono</span>' : rep.counts.error ? `<span class="chip error">${App.plural(rep.counts.error, 'błąd', 'błędy', 'błędów')}</span>` : rep.counts.warn ? `<span class="chip warn">${App.plural(rep.counts.warn, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń')}</span>` : '<span class="chip ok">zgodne</span>';
      const tr = h(`<tr style="cursor:pointer"><td class="ic-cell">${gameBadge(g)}</td><td class="nm">${esc(g.name)} ${App.compatMark(g)}</td><td class="muted">${esc(g.id === 'minecraft' ? `${info.instances.length} inst.` : info.source)}</td><td>${rep ? rep.mods.length : '<span class="dim">–</span>'}</td><td>${stan}</td></tr>`);
      tr.onclick = () => App.go('games', { id: g.id });
      gt.appendChild(tr);
    }
    const STATUS = { running: 'działa', stopped: 'zatrzymany', installing: 'instalacja…', stopping: 'zatrzymywanie…', error: 'błąd' };
    const sv = $('[data-servers]', el);
    if (!st.servers.length) sv.innerHTML = '<tr><td colspan="4" class="muted">Brak serwerów. Kliknij „Nowy serwer”, aby utworzyć pierwszy.</td></tr>';
    for (const s of st.servers) {
      const tr = h(`<tr style="cursor:pointer"><td class="ic-cell">${gameBadge({ color: s.color, short: (App.SRV_SHORT || {})[s.type] || '?', name: s.typeName || '', iconData: st.icons && st.icons.servers && st.icons.servers[s.type] })}</td><td><div class="nm">${esc(s.name)}</div><div class="sub">${esc(s.typeName || '')}</div></td><td><span class="row" style="gap:6px"><span class="dot ${s.status}"></span>${STATUS[s.status] || s.status}</span></td><td class="mono">${s.port}</td></tr>`);
      tr.onclick = () => App.go('servers', { id: s.id });
      sv.appendChild(tr);
    }
  },
};
