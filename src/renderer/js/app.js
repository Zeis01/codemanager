// Nawigacja i start aplikacji
'use strict';
(function () {
  const { h, $, icon, api, esc } = App;
  const NAV = [
    { id: 'dashboard', label: 'Pulpit', icon: 'home' },
    { id: 'games', label: 'Znalezione gry', icon: 'games', count: () => { const d = App.state.detected; return d ? Object.values(d.games).filter(g => g.found).length : ''; } },
    { id: 'servers', label: 'Serwery', icon: 'server', count: () => { const r = App.state.servers.filter(s => s.status === 'running').length; return r ? { v: r + ' online', live: true } : (App.state.servers.length || ''); } },
    { id: 'analyzer', label: 'Analizator błędów', icon: 'pulse' },
    { id: 'editor', label: 'Edytor', icon: 'code' },
    { id: 'rcon', label: 'RCON', icon: 'terminal' },
    { id: 'installers', label: 'Instalatory', icon: 'download' },
    { id: 'settings', label: 'Ustawienia', icon: 'settings' },
  ];
  let current = null; let currentParams = null;

  function renderRail() {
    const rail = $('#rail'); rail.innerHTML = '';
    for (const n of NAV) {
      const c = n.count ? n.count() : '';
      const cv = typeof c === 'object' ? c.v : c;
      const b = h(`<button class="nav ${current === n.id ? 'active' : ''}" data-id="${n.id}">${icon(n.icon)}<span>${n.label}</span>${cv !== '' && cv != null ? `<span class="count ${c && c.live ? 'live' : ''}">${esc(cv)}</span>` : ''}</button>`);
      b.onclick = () => App.go(n.id);
      rail.appendChild(b);
    }
    rail.appendChild(h('<div class="spacer"></div>'));
    const u = App.state.update;
    if (u && (u.state === 'available' || u.state === 'downloading' || u.state === 'downloaded')) {
      const b = h(`<button class="upd-banner">${icon('update')}<span><b>${u.state === 'downloaded' ? 'Aktualizacja gotowa' : u.state === 'downloading' ? `Pobieranie ${u.progress || 0}%` : `Nowa wersja ${esc(u.latest)}`}</b><small>${u.state === 'downloaded' ? 'Kliknij, aby zainstalować' : u.state === 'downloading' ? 'Możesz dalej pracować' : 'Kliknij, aby zobaczyć zmiany'}</small></span></button>`);
      b.onclick = () => (u.state === 'downloaded' ? App.updateAction(u) : App.go('settings'));
      rail.appendChild(b);
    }
    rail.appendChild(h(`<div class="foot">CodeManager ${esc((App.state.update && App.state.update.current) || '')}<br>Mody · serwery · edytor</div>`));
  }
  App.renderRail = renderRail;

  App.go = function (id, params = {}) {
    if (current === 'editor' && id !== 'editor' && App.views.editor.leave) App.views.editor.leave();
    current = id; currentParams = params;
    const main = $('#main');
    const view = App.views[id];
    main.innerHTML = '';
    const el = h(`<div class="view ${view.full ? 'full' : ''}"></div>`);
    main.appendChild(el);
    main.scrollTop = 0;
    $('#crumb').innerHTML = view.crumb ? view.crumb(params) : `<b>${esc(NAV.find(n => n.id === id).label)}</b>`;
    renderRail();
    view.render(el, params);
  };
  App.refreshCurrent = () => App.go(current, currentParams);
  App.updateStatusText = c => {
    switch (c.state) {
      case 'unconfigured': return { title: 'Aktualizacje nie są skonfigurowane', sub: 'Podaj repozytorium GitHub, z którego publikujesz wydania.' };
      case 'checking': return { title: 'Sprawdzanie…', sub: 'Łączenie z GitHub' };
      case 'none': return { title: `Masz najnowszą wersję (${c.current})`, sub: c.checkedAt ? 'Sprawdzono ' + App.timeAgo(c.checkedAt) : '', action: 'Sprawdź' };
      case 'available': return { title: `Dostępna wersja ${c.latest}${c.prerelease ? ' (beta)' : ''}`, sub: `Masz ${c.current}${c.published ? ' · wydano ' + new Date(c.published).toLocaleDateString('pl-PL') : ''}${c.asset ? ' · ' + App.fmtSize(c.asset.size) : ''}`, action: 'Pobierz i zainstaluj' };
      case 'downloading': return { title: `Pobieranie aktualizacji… ${c.progress || 0}%`, sub: 'Możesz dalej korzystać z programu' };
      case 'downloaded': return { title: `Wersja ${c.latest} jest gotowa`, sub: c.mode === 'installer' ? 'Zainstaluje się teraz albo przy zamknięciu programu' : 'Program zamknie się, podmieni pliki i uruchomi ponownie', action: 'Uruchom ponownie i zainstaluj' };
      case 'error': return { title: 'Nie udało się sprawdzić aktualizacji', sub: c.error || '', action: 'Spróbuj ponownie' };
      default: return { title: `Wersja ${c.current || ''}`, sub: 'Aktualizacje nie były jeszcze sprawdzane', action: 'Sprawdź' };
    }
  };
  App.updateAction = async c => {
    try {
      if (c.state === 'available') {
        if (c.mode === 'dev') { App.api('shell:external', c.url); return; }
        await window.cm.call('update:download');
      } else if (c.state === 'downloaded') {
        const running = App.state.servers.filter(s => s.status === 'running');
        if (running.length && !(await App.confirmBox('Zainstalować teraz?', `Działa ${running.length} serwer(ów) – zostaną zatrzymane razem z programem.`, 'Zainstaluj i uruchom ponownie', true))) return;
        await window.cm.call('update:install');
      } else await window.cm.call('update:check');
    } catch (e) { App.toast(e.message, 'error', 8000); }
  };
  App.current = () => current;
  App.setCrumb = html => { $('#crumb').innerHTML = html; };

  async function init() {
    $('#wMin').onclick = () => api('win:minimize');
    $('#wMax').onclick = () => api('win:maximize');
    $('#wClose').onclick = () => api('win:close');
    const [defs, cfg] = await Promise.all([api('games:defs'), api('config:get')]);
    App.state.defs = defs; App.state.settings = cfg.settings; App.state.gameConfig = cfg.games;
    App.state.servers = await api('servers:list');
    window.cm.on('server:status', d => {
      const s = App.state.servers.find(x => x.id === d.id); if (s) s.status = d.status;
      renderRail();
      if (App.onServerStatus) App.onServerStatus(d);
    });
    window.cm.on('server:log', d => App.onServerLog && App.onServerLog(d));
    // pobieranie z linków nxm:// (przycisk „Mod Manager Download” na Nexus Mods)
    window.cm.on('nxm:start', d => { App._nxm = App.jobModal('Pobieranie z Nexus Mods'); App._nxmId = d.jobId; });
    window.cm.on('job:log', d => { if (App._nxm && d.jobId === App._nxmId) App._nxm.log(d.line); });
    window.cm.on('nxm:done', d => { if (App._nxm) App._nxm.done(d.ok ? `Zainstalowano ${d.name}.` : 'Nie udało się: ' + d.error, d.ok); App.state.reports = {}; });
    window.cm.on('server:progress', d => App.onServerProgress && App.onServerProgress(d));
    // aktualizacje programu
    App.state.update = await window.cm.call('update:status').catch(() => null);
    window.cm.on('update:status', u => {
      const prev = App.state.update && App.state.update.state;
      App.state.update = u; renderRail();
      if (u.state === 'available' && prev !== 'available') App.toast(`Dostępna nowa wersja CodeManager ${u.latest}`, 'ok', 6000);
      if (u.state === 'downloaded' && prev !== 'downloaded') App.toast('Aktualizacja pobrana – kliknij baner po lewej, aby zainstalować.', 'ok', 8000);
      if (App.onUpdateStatus) App.onUpdateStatus(u);
    });
    App.go('dashboard');
    // pierwsze wykrywanie w tle
    try {
      App.state.detected = await window.cm.call('games:detected');
      renderRail();
      if (current === 'dashboard' || current === 'games') App.refreshCurrent();
    } catch (e) { App.toast('Wykrywanie gier nie powiodło się: ' + e.message, 'error'); }
  }
  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '8') { e.preventDefault(); App.go(NAV[+e.key - 1].id); }
  });
})();
