// Manager serwerów
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast, modal, gameBadge, renderIssues, healthBar } = App;
  let types = null;
  const STATUS = { running: 'Działa', stopped: 'Zatrzymany', installing: 'Instalowanie…', stopping: 'Zatrzymywanie…', error: 'Błąd', starting: 'Uruchamianie…' };
  const SHORT = { minecraft: 'MC', rust: 'RUST', cs2: 'CS2', dayz: 'DZ', valheim: 'VH', projectzomboid: 'PZ', tf2: 'TF2', armareforger: 'AR', terraria: 'TS', fivem: '5M', mta: 'MTA', beammp: 'BMP', palworld: 'PAL', ark: 'ARK', satisfactory: 'SAT', enshrouded: 'ENS', spaceengineers: 'SE', mcproxy: 'PRX' };
  App.SRV_SHORT = SHORT;
  const badge = s => gameBadge({ color: s.color, short: SHORT[s.type], name: s.typeName || '' });

  async function loadTypes() { if (!types) types = await api('servers:types'); return types; }
  async function refreshList() { App.state.servers = await api('servers:list'); App.renderRail(); }

  // ===================== LISTA =====================
  async function renderList(el) {
    await loadTypes(); await refreshList();
    el.innerHTML = `<div class="head"><div class="grow"><h1>Serwery</h1><p class="lead">Instaluj pliki serwerów, uruchamiaj je z konsolą i sprawdzaj zgodność pluginów oraz modów.</p></div>
      <div class="row"><button class="btn" data-import>${icon('folder')}Importuj istniejący</button><button class="btn primary" data-new>${icon('plus')}Nowy serwer</button></div></div><div data-list></div>`;
    $('[data-new]', el).onclick = () => wizard(false);
    $('[data-import]', el).onclick = () => wizard(true);
    const list = $('[data-list]', el);
    if (!App.state.servers.length) {
      list.innerHTML = `<div class="panel empty"><h2>Nie masz jeszcze serwerów</h2><p>Wybierz grę, a CodeManager pobierze pliki serwera (SteamCMD, oficjalne API) i przygotuje konfigurację.</p><button class="btn primary">${icon('plus')}Utwórz pierwszy serwer</button>
        <div class="row" style="justify-content:center;margin-top:22px;gap:6px">${types.map(t => `<span class="chip">${esc(t.name)}</span>`).join('')}</div></div>`;
      $('button', list).onclick = () => wizard(false);
      return;
    }
    const wrap = h('<div class="srv-list"></div>');
    for (const s of App.state.servers) {
      const row = h(`<div class="srv" tabindex="0" role="button">${badge(s)}<div style="min-width:0"><div style="font-weight:600">${esc(s.name)}</div><div class="dim" style="font-size:12.5px">${esc(s.typeName)}${s.variant ? ' · ' + esc(s.variant) : ''}${s.version ? ' ' + esc(s.version) : ''} · port ${s.port}${s.exists ? '' : ' · <span style="color:var(--coral)">folder nie istnieje</span>'}</div></div>
        <div class="st"><span class="dot ${s.status}"></span>${STATUS[s.status] || s.status}</div>
        <div class="row">${s.status === 'running' ? `<button class="btn sm" data-a="stop">${icon('stop')}Zatrzymaj</button>` : `<button class="btn sm primary" data-a="start" ${s.status === 'installing' ? 'disabled' : ''}>${icon('play')}Uruchom</button>`}</div></div>`);
      row.onclick = async e => {
        const a = e.target.closest('[data-a]');
        if (!a) return App.go('servers', { id: s.id });
        e.stopPropagation();
        if (a.dataset.a === 'start') { await api('servers:start', s.id); App.go('servers', { id: s.id }); }
        if (a.dataset.a === 'stop') { await api('servers:stop', s.id); }
      };
      row.onkeydown = e => { if (e.key === 'Enter') App.go('servers', { id: s.id }); };
      wrap.appendChild(row);
    }
    list.appendChild(wrap);
    App.onServerStatus = () => { if (App.current() === 'servers' && !document.querySelector('[data-srv-detail]')) renderList(el); };
  }

  // ===================== KREATOR =====================
  async function wizard(importMode) {
    await loadTypes();
    let sel = null;
    const body = h(`<div>
      <div class="field"><label>Gra</label><div class="type-grid">${types.map(t => `<button class="type-opt" data-t="${t.id}">${gameBadge({ color: t.color, short: SHORT[t.id], name: t.name })}<span>${esc(t.name)}</span></button>`).join('')}</div></div>
      <div data-form></div></div>`);
    const form = $('[data-form]', body);
    const pick = async id => {
      sel = types.find(t => t.id === id);
      $$('.type-opt', body).forEach(b => b.classList.toggle('sel', b.dataset.t === id));
      const settings = App.state.settings;
      form.innerHTML = `
        <div class="grid" style="grid-template-columns:2fr 1fr;gap:12px">
          <div class="field"><label>Nazwa</label><input class="input" data-k="name" value="${esc(sel.name)}"></div>
          <div class="field"><label>Port</label><input class="input" data-k="port" type="number" value="${sel.port}"></div>
        </div>
        ${sel.variants ? `<div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div class="field"><label>Silnik</label><select class="input" data-k="variant">${sel.variants.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Wersja</label><select class="input" data-k="version"><option>Wczytywanie…</option></select></div>
          <div class="field"><label>Pamięć RAM (MB)</label><input class="input" data-k="ram" type="number" value="4096" step="512"></div></div>` : ''}
        ${sel.fields.filter(f => f.id === 'note').map(f => `<div class="note" style="margin-bottom:14px">${esc(f.def)}</div>`).join('')}
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px">${sel.fields.filter(f => f.id !== 'note').map(f => `<div class="field"><label>${esc(f.label)}</label><input class="input" data-s="${f.id}" value="${esc(f.def)}"></div>`).join('')}</div>
        <div class="field"><label>${importMode ? 'Istniejący folder serwera' : 'Folder instalacji'}</label><div class="inline-input"><input class="input mono" data-k="path" placeholder="${importMode ? 'Wskaż folder…' : esc((settings.serversPath || 'Domyślnie: ~/CodeManager-Servers') + '/' + sel.name)}"><button class="btn" data-browse>${icon('folder')}</button></div>
        ${!importMode && sel.steamApp ? `<span class="hint">Pliki zostaną pobrane przez SteamCMD (aplikacja ${sel.steamApp}${sel.needsLogin ? ', wymaga konta Steam z grą' : ', bez logowania'}).</span>` : ''}</div>
        ${sel.needsEula && !importMode ? `<label class="check"><input type="checkbox" data-k="eula"><span>Akceptuję <a href="#" data-eula>EULA Minecraft</a> (wymagane do uruchomienia serwera).</span></label>` : ''}`;
      $('[data-browse]', form).onclick = async () => { const p = await api('dialog:folder', 'Folder serwera'); if (p) $('[data-k="path"]', form).value = p; };
      const eu = $('[data-eula]', form); if (eu) eu.onclick = e => { e.preventDefault(); api('shell:external', 'https://www.minecraft.net/eula'); };
      if (sel.needsVersion) {
        const vs = $('[data-k="version"]', form);
        try { const vers = await App.apiQuiet('servers:versions', sel.id); vs.innerHTML = vers.map(v => `<option>${esc(v)}</option>`).join(''); }
        catch { vs.outerHTML = '<input class="input" data-k="version" placeholder="np. 1.21.1">'; toast('Nie udało się pobrać listy wersji – wpisz wersję ręcznie.', 'warn'); }
      }
    };
    $$('.type-opt', body).forEach(b => b.onclick = () => pick(b.dataset.t));
    modal({
      title: importMode ? 'Importuj istniejący serwer' : 'Nowy serwer', wide: true, body,
      actions: [{ label: 'Anuluj' }, {
        label: importMode ? 'Importuj' : 'Utwórz i zainstaluj', primary: true, icon: importMode ? 'folder' : 'download',
        onClick: async () => {
          if (!sel) { toast('Wybierz grę', 'warn'); return false; }
          const data = { type: sel.id, settings: {} };
          $$('[data-k]', form).forEach(i => { data[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
          $$('[data-s]', form).forEach(i => { data.settings[i.dataset.s] = i.value.trim(); });
          if (!data.path) delete data.path;
          if (importMode && !data.path) { toast('Wskaż folder istniejącego serwera', 'warn'); return false; }
          const s = await window.cm.call(importMode ? 'servers:import' : 'servers:create', data).catch(e => { toast(e.message, 'error', 8000); throw new Error(''); });
          await refreshList();
          App.go('servers', { id: s.id, tab: 'console' });
        },
      }],
    });
  }

  // ===================== SZCZEGÓŁY =====================
  async function renderDetail(el, params) {
    await loadTypes(); await refreshList();
    const s = App.state.servers.find(x => x.id === params.id);
    if (!s) return App.go('servers');
    const t = types.find(x => x.id === s.type);
    const content = await api('servers:content', s.id);
    App.setCrumb(`Serwery / <b>${esc(s.name)}</b>`);
    let tab = params.tab || 'console';
    el.innerHTML = `<div data-srv-detail>
      <button class="back" data-back>${icon('back')}Serwery</button>
      <div class="detail-hero">${badge(s)}<div style="flex:1;min-width:0"><h1>${esc(s.name)}</h1><div class="row" style="margin-top:6px"><span class="st muted" style="display:flex;gap:8px;align-items:center"><span class="dot ${s.status}" data-dot></span><span data-stt>${STATUS[s.status]}</span></span><span class="dim">·</span><span class="muted">${esc(s.typeName)}${s.variant ? ' ' + esc(s.variant) : ''}${s.version ? ' ' + esc(s.version) : ''}</span><span class="dim">·</span><span class="muted">port ${s.port}</span></div></div>
        <div class="row" data-ctl></div></div>
      <div class="tabs"><button data-tab="console">Konsola</button><button data-tab="content">${esc(content.label)}</button><button data-tab="config">Konfiguracja</button>${t.frameworks.length ? '<button data-tab="fw">Frameworki</button>' : ''}<button data-tab="backup">Kopie i harmonogram</button>${t.rcon ? '<button data-tab="rcon">RCON</button>' : ''}<button data-tab="settings">Ustawienia</button></div>
      <div data-c></div></div>`;
    $('[data-back]', el).onclick = () => App.go('servers');
    const ctl = $('[data-ctl]', el);
    const drawCtl = st => {
      ctl.innerHTML = st === 'running' || st === 'stopping'
        ? `<button class="btn" data-a="restart">${icon('refresh')}Restart</button><button class="btn" data-a="stop" ${st === 'stopping' ? 'disabled' : ''}>${icon('stop')}Zatrzymaj</button><button class="btn danger sm" data-a="kill" title="Wymuś zamknięcie">Zabij</button>`
        : `<button class="btn" data-a="update" ${st === 'installing' ? 'disabled' : ''}>${icon('update')}Aktualizuj</button><button class="btn primary" data-a="start" ${st === 'installing' ? 'disabled' : ''}>${icon('play')}Uruchom</button>`;
      $('[data-dot]', el).className = 'dot ' + st; $('[data-stt]', el).textContent = STATUS[st] || st;
    };
    drawCtl(s.status);
    ctl.onclick = async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const act = a.dataset.a;
      if (act === 'start') { await api('servers:start', s.id); tab = 'console'; show(); }
      if (act === 'stop') await api('servers:stop', s.id);
      if (act === 'kill') await api('servers:kill', s.id);
      if (act === 'restart') { await api('servers:stop', s.id); const off = setInterval(async () => { const l = await api('servers:list'); const x = l.find(y => y.id === s.id); if (x && x.status === 'stopped') { clearInterval(off); api('servers:start', s.id); } }, 1000); }
      if (act === 'update') { tab = 'console'; show(); api('servers:update', s.id).catch(() => {}); }
    };
    App.onServerStatus = d => { if (d.id === s.id) { s.status = d.status; drawCtl(d.status); } };
    const c = $('[data-c]', el);
    const show = () => {
      $$('.tabs button', el).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      App.onServerLog = null; App.onServerProgress = null;
      if (tab === 'console') tabConsole(c, s);
      if (tab === 'content') tabContent(c, s, content);
      if (tab === 'config') tabConfig(c, s);
      if (tab === 'fw') tabFrameworks(c, s);
      if (tab === 'settings') tabSettings(c, s, t);
      if (tab === 'backup') tabBackup(c, s, t);
      if (tab === 'rcon') tabRcon(c, s);
    };
    $$('.tabs button', el).forEach(b => b.onclick = () => { tab = b.dataset.tab; show(); });
    show();
  }

  function lineClass(l) {
    if (/^(=== |✔)/.test(l)) return /✔/.test(l) ? 'l-ok' : 'l-head';
    if (/^> /.test(l)) return 'l-cmd';
    if (/(✖|error|exception|failed|fatal|severe)/i.test(l)) return 'l-err';
    if (/(warn|⚠)/i.test(l)) return 'l-warn';
    return '';
  }
  async function tabConsole(c, s) {
    c.innerHTML = `<div class="progress hidden" data-prog style="margin-bottom:8px"><i></i></div><div class="console-wrap"><div class="console" data-con></div><div class="console-input"><span>›</span><input placeholder="Wpisz polecenie i naciśnij Enter (np. help, say Cześć)" data-cmd></div></div>
      <div class="row" style="margin-top:8px"><span class="dim" style="font-size:12.5px;flex:1">Strzałki ↑/↓ – historia poleceń. Logi z instalacji (SteamCMD) też pojawiają się tutaj; w razie prośby o hasło Steam wpisz je w polu poleceń.</span><button class="btn sm ghost" data-clear>Wyczyść widok</button><button class="btn sm ghost" data-folder>${icon('folder')}Folder serwera</button></div>`;
    const con = $('[data-con]', c);
    const add = l => { const d = document.createElement('div'); d.className = lineClass(l); d.textContent = l; con.appendChild(d); if (con.childElementCount > 3000) con.firstChild.remove(); };
    const stick = () => { con.scrollTop = con.scrollHeight; };
    (await api('servers:log', s.id)).forEach(add); stick();
    if (!con.childElementCount) add('Serwer nie był jeszcze uruchamiany w tej sesji.');
    App.onServerLog = d => { if (d.id !== s.id) return; const atBottom = con.scrollHeight - con.scrollTop - con.clientHeight < 40; add(d.line); if (atBottom) stick(); };
    const prog = $('[data-prog]', c);
    App.onServerProgress = d => { if (d.id !== s.id) return; prog.classList.remove('hidden'); if (d.pct != null) $('i', prog).style.width = d.pct + '%'; if (d.pct >= 100) setTimeout(() => prog.classList.add('hidden'), 1500); };
    const hist = []; let hi = -1;
    const inp = $('[data-cmd]', c);
    inp.onkeydown = async e => {
      if (e.key === 'Enter' && inp.value.trim()) { const v = inp.value; hist.unshift(v); hi = -1; inp.value = ''; try { await window.cm.call('servers:command', s.id, v); } catch (err) { toast(err.message, 'warn'); } }
      if (e.key === 'ArrowUp' && hist.length) { hi = Math.min(hi + 1, hist.length - 1); inp.value = hist[hi]; e.preventDefault(); }
      if (e.key === 'ArrowDown') { hi = Math.max(hi - 1, -1); inp.value = hi >= 0 ? hist[hi] : ''; e.preventDefault(); }
    };
    $('[data-clear]', c).onclick = () => { con.innerHTML = ''; };
    $('[data-folder]', c).onclick = () => api('shell:open', s.path);
    inp.focus();
  }

  async function tabContent(c, s, content) {
    c.innerHTML = '<div class="panel"><p class="muted" style="margin-top:0">Sprawdzam zgodność…</p><div class="progress indet"><i></i></div></div>';
    let rep;
    try { rep = await api('servers:check', s.id); } catch { c.innerHTML = ''; return; }
    App.state.reports['srv:' + s.id] = rep;
    c.innerHTML = `
      <div class="summary-strip">
        <div class="e"><div class="n">${rep.counts.error}</div><div class="l">błędy</div></div>
        <div class="w"><div class="n">${rep.counts.warn}</div><div class="l">ostrzeżenia</div></div>
        <div class="o"><div class="n">${rep.mods.filter(m => m.enabled).length}</div><div class="l">aktywne</div></div>
        <div class="grow" style="min-width:140px">${healthBar(rep.mods)}</div>
        ${s.type === 'dayz' ? `<button class="btn" data-ws>${icon('download')}Dodaj z Warsztatu</button>` : ''}
        ${['cs2', 'valheim', 'minecraft'].includes(s.type) ? `<button class="btn" data-online>${icon('globe')}Sprawdź online</button>` : ''}
        ${(s.type === 'minecraft' && s.variant !== 'vanilla') || s.type === 'mcproxy' || s.type === 'valheim' ? `<button class="btn" data-upall>${icon('update')}Aktualizuj wszystko</button><button class="btn" data-get>${icon('download')}Pobierz</button>` : ''}
        ${s.type === 'minecraft' && ['fabric', 'quilt', 'forge', 'neoforge'].includes(s.variant) ? `<button class="btn" data-mrpack>${icon('archive')}.mrpack</button>` : ''}
        <button class="btn" data-add>${icon('plus')}Dodaj pliki</button>
        <button class="btn" data-open>${icon('folder')}Otwórz folder</button>
        <button class="btn primary" data-re>${icon('refresh')}Sprawdź ponownie</button>
      </div>
      <div class="grid" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start">
        <div class="table-wrap" style="max-height:calc(100vh - 380px)"><table class="table"><thead><tr><th style="width:52px">Wł.</th><th>Nazwa</th><th>Wersja</th><th>Stan</th></tr></thead><tbody></tbody></table></div>
        <div><div data-iss></div><div data-onl></div><div class="panel" style="margin-top:12px"><dl class="meta-list">${Object.entries(rep.meta).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></div>
      </div>`;
    const tb = $('tbody', c);
    if (!rep.mods.length) tb.innerHTML = `<tr><td colspan="4"><div class="empty" style="padding:30px"><p>Brak pozycji. Dodaj pliki do <span class="path">${esc(content.dir)}</span>.</p></div></td></tr>`;
    for (const m of rep.mods) {
      const st = { ok: ['ok', 'Zgodny'], warn: ['warn', 'Ostrzeżenie'], error: ['error', 'Błąd'], disabled: ['', 'Wyłączony'] }[m.status] || ['', '-'];
      const tr = h(`<tr class="${m.enabled ? '' : 'off'}"><td><label class="switch"><input type="checkbox" ${m.enabled ? 'checked' : ''} ${m.toggleable ? '' : 'disabled'}><span></span></label></td><td><div class="nm">${esc(m.name)}</div>${m.source ? `<div class="sub">${esc(m.source)}</div>` : ''}</td><td class="mono">${esc(m.version || '-')}</td><td><span class="chip ${st[0]}">${st[1]}</span></td></tr>`);
      if (m.toggleable) $('input', tr).onchange = async () => { await api('servers:toggle', m); tabContent(c, s, content); };
      tb.appendChild(tr);
    }
    $('[data-iss]', c).appendChild(renderIssues(rep.issues, { serverId: s.id }, () => {}));
    const ua = $('[data-upall]', c); if (ua) ua.onclick = () => App.updateAll(null, () => tabContent(c, s, content), { serverId: s.id });
    const gt = $('[data-get]', c); if (gt) gt.onclick = () => {
      const body = h('<div></div>');
      App.modal({ title: s.type === 'valheim' ? 'Pobierz mody (Thunderstore)' : 'Pobierz z Modrinth', wide: true, body, onClose: () => tabContent(c, s, content) });
      if (s.type === 'valheim') App.getThunderstore(body, { g: { thunderstore: 'valheim' } }, { serverId: s.id });
      else App.getModrinth(body, null, { serverId: s.id }, { mcVersion: s.version, loader: s.variant, type: ['paper', 'purpur'].includes(s.variant) || s.type === 'mcproxy' ? 'plugin' : 'mod' });
    };
    const mp = $('[data-mrpack]', c); if (mp) mp.onclick = async () => {
      const f = (await api('dialog:files', 'Paczka .mrpack', [{ name: 'Modrinth', extensions: ['mrpack'] }]))[0]; if (!f) return;
      const r = await App.runJob('Import paczki na serwer', jobId => window.cm.call('import:mrpackServer', jobId, s.id, f), { doneMsg: x => `Zaimportowano ${x.count} plików (tylko serwerowe). Paczka jest dla MC ${x.mcVersion} / ${x.loader}.` });
      if (r) tabContent(c, s, content);
    };
    $('[data-re]', c).onclick = () => tabContent(c, s, content);
    $('[data-open]', c).onclick = async () => { await api('fs:mkdir', content.dir); api('shell:open', content.dir); };
    $('[data-add]', c).onclick = async () => { const f = await api('dialog:files', 'Wybierz pliki'); if (f.length) { await api('mods:add', content.dir, f); toast(`Dodano ${f.length} plik(ów)`); tabContent(c, s, content); } };
    const ws = $('[data-ws]', c);
    if (ws) ws.onclick = async () => {
      const id = await App.promptBox('Dodaj mod z Warsztatu DayZ', 'ID przedmiotu Warsztatu (z adresu strony moda)');
      if (!id || !/^\d+$/.test(id.trim())) return;
      App.go('servers', { id: s.id, tab: 'console' });
      try { const name = await window.cm.call('servers:workshop', s.id, id.trim()); toast(`Dodano ${name}`); } catch (e) { toast(e.message, 'error'); }
    };
    const on = $('[data-online]', c);
    if (on) on.onclick = async () => { on.disabled = true; try { const r = await api('servers:online', s.id); const box = $('[data-onl]', c); box.innerHTML = '<div class="section-title"><h2>Wyniki online</h2></div>'; box.appendChild(renderIssues(r)); } finally { on.disabled = false; } };
  }

  async function tabConfig(c, s) {
    const files = await api('servers:configs', s.id);
    c.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start"><div class="panel"><h2 style="margin-bottom:10px">Pliki konfiguracyjne</h2><div class="cfg-list"></div></div>
      <div class="panel"><h3>Edytor</h3><p class="muted" style="font-size:13px">Pliki otwierają się w edytorze CodeManager z podświetlaniem składni i wykrywaniem błędów JSON.</p><button class="btn" data-folder>${icon('code')}Otwórz cały folder w edytorze</button></div></div>`;
    const list = $('.cfg-list', c);
    for (const f of files) {
      const b = h(`<button class="${f.exists ? '' : 'missing'}">${icon('file')}<span style="flex:1" class="mono">${esc(f.rel)}</span>${f.exists ? '' : '<span class="chip">jeszcze nie istnieje</span>'}</button>`);
      b.onclick = () => { if (!f.exists) { toast('Plik powstanie po pierwszym uruchomieniu serwera. Możesz go też utworzyć w edytorze.', 'warn'); } App.go('editor', { folder: s.path, file: f.path, create: !f.exists }); };
      list.appendChild(b);
    }
    if (!files.length) list.innerHTML = '<p class="muted">Brak znanych plików konfiguracyjnych.</p>';
    $('[data-folder]', c).onclick = () => App.go('editor', { folder: s.path });
  }

  async function tabFrameworks(c, s) {
    const fws = await api('servers:frameworks', s.id);
    c.innerHTML = `<p class="lead" style="margin:0 0 14px">Frameworki dodają obsługę pluginów. Zatrzymaj serwer przed instalacją.</p><div data-l></div>`;
    for (const f of fws) {
      const row = h(`<div class="fw">${icon('puzzle')}<div class="grow"><h3>${esc(f.name)}</h3><div class="muted" style="font-size:13px">${esc(f.desc)}</div></div>${f.installed ? `<span class="chip ok">${icon('check')}Zainstalowany</span>` : '<span class="chip">Brak</span>'}<button class="btn ${f.installed ? '' : 'primary'}">${icon('download')}${f.installed ? 'Przeinstaluj' : 'Zainstaluj'}</button></div>`);
      $('button', row).onclick = async () => {
        App.go('servers', { id: s.id, tab: 'console' });
        try { await window.cm.call('servers:installFramework', s.id, f.id); toast(`Zainstalowano ${f.name}`); } catch (e) { toast(e.message, 'error', 8000); }
      };
      $('[data-l]', c).appendChild(row);
    }
  }

  function tabSettings(c, s, t) {
    c.innerHTML = `<div class="panel" style="max-width:780px">
      <div class="grid" style="grid-template-columns:2fr 1fr 1fr;gap:12px">
        <div class="field"><label>Nazwa</label><input class="input" data-k="name" value="${esc(s.name)}"></div>
        <div class="field"><label>Port</label><input class="input" data-k="port" type="number" value="${s.port}"></div>
        ${s.type === 'minecraft' ? `<div class="field"><label>RAM (MB)</label><input class="input" data-k="ram" type="number" value="${s.ram || 4096}" step="512"></div>` : '<div></div>'}
      </div>
      ${s.type === 'minecraft' ? `<div class="grid" style="grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label>Wersja Minecraft</label><input class="input" data-k="version" value="${esc(s.version || '')}"></div><div class="field"><label>Ścieżka Javy</label><input class="input mono" data-k="java" value="${esc(s.java || '')}" placeholder="java"></div></div>` : ''}
      ${t.fields.map(f => `<div class="field"><label>${esc(f.label)}</label><input class="input" data-s="${f.id}" value="${esc(s.settings[f.id] || '')}"></div>`).join('')}
      <div class="field"><label>Folder</label><div class="inline-input"><input class="input mono" readonly value="${esc(s.path)}"><button class="btn" data-open>${icon('folder')}</button></div></div>
      <div class="row"><button class="btn primary" data-save>${icon('save')}Zapisz</button><button class="btn" data-reinstall>${icon('download')}Zainstaluj pliki ponownie</button><span style="flex:1"></span><button class="btn danger" data-del>${icon('trash')}Usuń serwer</button></div></div>`;
    $('[data-open]', c).onclick = () => api('shell:open', s.path);
    $('[data-save]', c).onclick = async () => {
      const patch = { settings: {} };
      $$('[data-k]', c).forEach(i => { patch[i.dataset.k] = i.type === 'number' ? +i.value : i.value.trim(); });
      $$('[data-s]', c).forEach(i => { patch.settings[i.dataset.s] = i.value.trim(); });
      await api('servers:patch', s.id, patch); toast('Zapisano. Zmiany zadziałają po restarcie serwera.'); App.go('servers', { id: s.id, tab: 'settings' });
    };
    $('[data-reinstall]', c).onclick = async () => { App.go('servers', { id: s.id, tab: 'console' }); window.cm.call('servers:install', s.id).catch(e => toast(e.message, 'error')); };
    $('[data-del]', c).onclick = () => {
      modal({ title: `Usunąć serwer „${s.name}”?`, body: `<p class="muted" style="margin-top:0">Serwer zniknie z listy CodeManager.</p><label class="check"><input type="checkbox" data-files><span>Przenieś też folder serwera do kosza<br><span class="path">${esc(s.path)}</span></span></label>`,
        actions: [{ label: 'Anuluj' }, { label: 'Usuń serwer', danger: true, onClick: async ({ body }) => { await api('servers:remove', s.id, $('[data-files]', body).checked); toast('Usunięto serwer'); App.go('servers'); } }] });
    };
  }


  async function tabBackup(c, s, t) {
    const sc = s.schedule || {};
    const b = sc.backup || {}; const r = sc.restart || {}; const a = sc.autoRestart || {};
    const [list, dir, worlds, next] = await Promise.all([api('backup:list', s.id), api('backup:dir', s.id), api('backup:worlds', s.id), api('schedule:next', s.id)]);
    c.innerHTML = `<div class="grid two" style="align-items:start">
      <div class="panel">
        <h2 style="margin-bottom:6px">Kopie zapasowe świata</h2>
        <p class="muted" style="font-size:13px;margin:0 0 12px">${worlds.length ? 'Kopiowane: ' + worlds.map(w => `<span class="mono">${esc(window.cm.path.basename(w))}</span>`).join(', ') : 'Świat jeszcze nie istnieje – uruchom serwer raz.'}</p>
        <div class="row" style="margin-bottom:14px"><button class="btn primary" data-now ${worlds.length ? '' : 'disabled'}>${icon('archive')}Zrób kopię teraz</button><button class="btn" data-dir>${icon('folder')}Folder kopii</button></div>
        <div class="backups">${list.length ? list.map(x => `<div class="bk"><div style="flex:1;min-width:0"><div class="mono" style="font-size:12.5px">${esc(x.name)}</div><div class="dim" style="font-size:12px">${new Date(x.time).toLocaleString('pl-PL')} · ${App.fmtSize(x.size)}</div></div><button class="btn sm" data-restore="${esc(x.path)}">Przywróć</button><button class="btn sm ghost icon danger" data-del="${esc(x.path)}" title="Usuń">${icon('trash')}</button></div>`).join('') : '<p class="dim" style="font-size:13px">Brak kopii.</p>'}</div>
      </div>
      <div class="panel">
        <h2 style="margin-bottom:14px">Harmonogram</h2>
        <label class="check"><input type="checkbox" data-k="backup.enabled" ${b.enabled ? 'checked' : ''}><span>Automatyczne kopie zapasowe</span></label>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px;margin:8px 0 6px 26px"><div class="field"><label>Co ile godzin</label><input class="input" type="number" min="1" data-k="backup.everyHours" value="${b.everyHours || 6}"></div><div class="field"><label>Ile kopii trzymać</label><input class="input" type="number" min="1" data-k="keep" value="${sc.keep || 10}"></div></div>
        <label class="check" style="margin:0 0 16px 26px"><input type="checkbox" data-k="backup.whenStopped" ${b.whenStopped ? 'checked' : ''}><span>Także gdy serwer jest wyłączony</span></label>
        <label class="check"><input type="checkbox" data-k="restart.enabled" ${r.enabled ? 'checked' : ''}><span>Zaplanowane restarty (z ostrzeżeniem graczy 5 i 1 min wcześniej${t.id === 'valheim' || t.id === 'satisfactory' || t.id === 'enshrouded' ? ' – ta gra nie obsługuje komunikatów' : ''})</span></label>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px;margin:8px 0 6px 26px">
          <div class="field"><label>Tryb</label><select class="input" data-k="restart.mode"><option value="daily" ${r.mode !== 'interval' ? 'selected' : ''}>O godzinie</option><option value="interval" ${r.mode === 'interval' ? 'selected' : ''}>Co X godzin</option></select></div>
          <div class="field" data-daily><label>Godziny (np. 05:00, 17:00)</label><input class="input" data-k="restart.time" value="${esc(r.time || '05:00')}"></div>
          <div class="field" data-interval><label>Co ile godzin</label><input class="input" type="number" min="1" data-k="restart.everyHours" value="${r.everyHours || 6}"></div>
        </div>
        <label class="check" style="margin:0 0 16px 26px"><input type="checkbox" data-k="restart.backupBefore" ${r.backupBefore ? 'checked' : ''}><span>Zrób kopię przed restartem</span></label>
        <label class="check"><input type="checkbox" data-k="autoRestart.enabled" ${a.enabled ? 'checked' : ''}><span>Uruchom ponownie po awarii (maks. 3 razy na godzinę)</span></label>
        <p class="dim" style="font-size:12.5px;margin:14px 0">${next ? `Następny restart: ${new Date(next).toLocaleString('pl-PL')}` : 'Harmonogram działa, gdy CodeManager jest otwarty.'}</p>
        <button class="btn primary" data-save>${icon('save')}Zapisz harmonogram</button>
      </div></div>`;
    const modeSel = $('[data-k="restart.mode"]', c);
    const syncMode = () => { $('[data-daily]', c).classList.toggle('hidden', modeSel.value === 'interval'); $('[data-interval]', c).classList.toggle('hidden', modeSel.value !== 'interval'); };
    modeSel.onchange = syncMode; syncMode();
    $('[data-dir]', c).onclick = async () => { await api('fs:mkdir', dir); api('shell:open', dir); };
    $('[data-now]', c).onclick = async e => { e.currentTarget.disabled = true; try { await api('backup:run', s.id); toast('Kopia zapasowa gotowa'); } finally { tabBackup(c, s, t); } };
    c.querySelectorAll('[data-restore]').forEach(btn => btn.onclick = async () => {
      if (!(await App.confirmBox('Przywrócić kopię?', 'Obecny świat zostanie zastąpiony (przed tym CodeManager zrobi jego kopię). Serwer musi być zatrzymany.', 'Przywróć', true))) return;
      await api('backup:restore', s.id, btn.dataset.restore); toast('Przywrócono kopię'); tabBackup(c, s, t);
    });
    c.querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => { await api('backup:delete', btn.dataset.del); tabBackup(c, s, t); });
    $('[data-save]', c).onclick = async () => {
      const sch = { backup: {}, restart: {}, autoRestart: {} };
      c.querySelectorAll('[data-k]').forEach(i => {
        const v = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value.trim();
        const [k1, k2] = i.dataset.k.split('.'); if (k2) sch[k1][k2] = v; else sch[k1] = v;
      });
      sch.backupDir = (s.schedule || {}).backupDir;
      await api('servers:patch', s.id, { schedule: sch }); s.schedule = sch; toast('Zapisano harmonogram'); tabBackup(c, s, t);
    };
  }

  async function tabRcon(c, s) {
    const r = await api('servers:rconInfo', s.id);
    if (!r.info) { c.innerHTML = `<div class="panel empty"><h2>RCON nie jest skonfigurowany</h2><p>${esc(r.hint || 'Ten serwer nie ma ustawionego hasła RCON.')}</p></div>`; return; }
    c.innerHTML = '';
    if (s.status !== 'running') c.appendChild(h('<div class="note warn" style="margin-bottom:10px">Serwer nie działa – RCON połączy się dopiero po uruchomieniu.</div>'));
    c.appendChild(App.rconConsole({ id: 'srv-' + s.id, name: s.name, ...r.info }));
  }

  App.views.servers = {
    crumb: () => '<b>Serwery</b>',
    render(el, params) { App.onServerLog = null; App.onServerProgress = null; App.onServerStatus = null; if (params.id) renderDetail(el, params); else renderList(el); },
  };
})();
