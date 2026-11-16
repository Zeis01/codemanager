// Pulpit
'use strict';
App.views = App.views || {};
App.views.dashboard = {
  render(el) {
    const { h, icon, esc, gameBadge } = App;
    const st = App.state;
    const det = st.detected;
    const found = det ? Object.entries(det.games).filter(([, g]) => g.found) : [];
    const running = st.servers.filter(s => s.status === 'running');
    const reports = Object.values(st.reports);
    const errs = reports.reduce((a, r) => a + (r.counts ? r.counts.error : 0), 0);
    el.innerHTML = `
      <div class="dash-hero">
        <div class="welcome">
          <svg class="rings" viewBox="0 0 200 200" fill="none" stroke="#4fd18b" stroke-width="1">
            <circle cx="100" cy="100" r="96" opacity=".18"/><circle cx="100" cy="100" r="74" opacity=".26"/><circle cx="100" cy="100" r="52" opacity=".34"/><circle cx="100" cy="100" r="30" opacity=".5"/>
          </svg>
          <h1>Mody, serwery i konfiguracje w jednym miejscu</h1>
          <p class="lead">CodeManager wykrywa Twoje gry, sprawdza, czy mody do siebie pasują, i stawia serwery jednym kliknięciem.</p>
          <div class="row">
            <button class="btn primary" data-go="games">${icon('shield')}Sprawdź zgodność modów</button>
            <button class="btn" data-go="servers">${icon('plus')}Nowy serwer</button>
          </div>
        </div>
        <div class="stat-col">
          <div class="stat"><div class="big">${det ? found.length : '…'}</div><div><div>Wykryte gry</div><div class="lbl">${det ? `z ${st.defs.games.length} obsługiwanych` : 'Szukam w bibliotekach Steam i na dyskach…'}</div></div></div>
          <div class="stat"><div class="big" style="color:${running.length ? 'var(--jade)' : 'inherit'}">${running.length}<span class="muted" style="font-size:20px">/${st.servers.length}</span></div><div><div>Serwery online</div><div class="lbl">${st.servers.length ? 'Kliknij Serwery, aby zarządzać' : 'Nie masz jeszcze serwerów'}</div></div></div>
        </div>
      </div>
      <div class="grid two">
        <div class="panel">
          <div class="row" style="margin-bottom:12px"><h2 style="flex:1">Twoje gry</h2><button class="btn sm ghost" data-go="games">Wszystkie</button></div>
          <div data-games></div>
        </div>
        <div class="panel">
          <h2 style="margin-bottom:8px">Szybkie akcje</h2>
          <div class="quick">
            <button data-go="installers">${icon('download')}<span>Zainstaluj modloader<small>BepInEx, MelonLoader, RedLoader, Fabric, Forge, NeoForge, Quilt</small></span></button>
            <button data-go="servers">${icon('server')}<span>Postaw serwer<small>Minecraft, Rust, CS2, DayZ, FiveM, Palworld, ARK i 11 innych</small></span></button>
            <button data-go="editor">${icon('code')}<span>Edytuj konfigurację<small>Edytor z podświetlaniem Lua, SQF, SourcePawn, Paradox, TOML…</small></span></button>
            <button data-detect>${icon('refresh')}<span>Wykryj gry ponownie<small>Przeszukaj biblioteki Steam, Epic i launchery Minecrafta</small></span></button>
          </div>
          ${errs ? `<div class="note warn" style="margin-top:12px">Ostatnie sprawdzenia znalazły ${errs} błędów zgodności.</div>` : ''}
        </div>
      </div>`;
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => App.go(b.dataset.go));
    el.querySelector('[data-detect]').onclick = async () => { App.toast('Wykrywanie gier…', 'ok', 2000); App.state.detected = await App.api('games:detect'); App.renderRail(); App.refreshCurrent(); };
    const gl = el.querySelector('[data-games]');
    if (!det) { gl.innerHTML = '<div class="progress indet"><i></i></div>'; return; }
    if (!found.length) { gl.innerHTML = `<div class="empty" style="padding:20px"><p>Nie znaleziono żadnej z obsługiwanych gier.</p><button class="btn" data-go2>Wskaż folder gry</button></div>`; gl.querySelector('[data-go2]').onclick = () => App.go('games'); return; }
    for (const [id] of found.slice(0, 7)) {
      const g = st.defs.games.find(x => x.id === id);
      const rep = st.reports[id];
      const row = h(`<button class="quick-row" style="display:flex;gap:12px;align-items:center;width:100%;background:none;border:0;padding:8px;border-radius:9px;cursor:pointer;text-align:left;color:inherit">${gameBadge(g, 32)}<div style="flex:1;min-width:0"><div style="font-weight:500">${esc(g.name)}</div><div class="dim" style="font-size:12px">${rep ? `${rep.mods.length} modów · ${rep.counts.error} błędów` : 'Nie sprawdzono'}</div></div>${rep ? `<div style="width:90px">${App.healthBar(rep.mods)}</div>` : ''}</button>`);
      row.onmouseenter = () => row.style.background = 'var(--pine-800)'; row.onmouseleave = () => row.style.background = 'none';
      row.onclick = () => App.go('games', { id });
      gl.appendChild(row);
    }
  },
};
