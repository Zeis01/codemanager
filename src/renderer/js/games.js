// Znalezione gry + szczegóły gry (mody, zgodność, modloader, ustawienia)
'use strict';
App.views = App.views || {};
(function () {
  const { h, $, $$, icon, esc, api, toast, modal, gameBadge, renderIssues, healthBar, fmtSize } = App;
  const VERSION_HINT = {
    projectzomboid: 'Np. 42 lub 41 – nadpisuje automatyczne wykrycie buildu.',
    ets2: 'Np. 1.53.2 – zwykle wykrywana z pliku gry.',
    peopleplayground: 'Np. 1.27.5 – gra nie zapisuje wersji w łatwo dostępnym miejscu.',
    hoi4: 'Np. 1.14.8 – zwykle odczytywana z launcher-settings.json.',
    terraria: 'Wersja tModLoadera, np. 2024.5.3.',
  };

  function gameDef(id) { return App.state.defs.games.find(g => g.id === id); }

  // ===================== LISTA =====================
  function renderList(el) {
    const det = App.state.detected;
    el.innerHTML = `
      <div class="head"><div class="grow"><h1>Znalezione gry</h1><p class="lead">Gry wykryte w bibliotekach Steam, Epic Games, Rockstar i launcherach Minecrafta. Jeśli lokalizacja jest zła, zmień ją albo uruchom wykrywanie jeszcze raz.</p></div>
      <div class="row"><button class="btn" data-import>${icon('import')}Importuj paczkę</button><button class="btn" data-addmc>${icon('plus')}Dodaj instancję Minecraft</button><button class="btn primary" data-detect>${icon('refresh')}Wykryj ponownie</button></div></div>
      <div data-body></div>`;
    $('[data-detect]', el).onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.innerHTML = icon('refresh', 'spin') + 'Wykrywanie…';
      try { App.state.detected = await api('games:detect'); toast('Wykrywanie zakończone'); } finally { App.renderRail(); renderList(el); }
    };
    $('[data-addmc]', el).onclick = addMcInstance;
    $('[data-import]', el).onclick = importDialog;
    const body = $('[data-body]', el);
    if (!det) { body.innerHTML = '<div class="panel"><p class="muted">Przeszukuję biblioteki Steam i dyski…</p><div class="progress indet"><i></i></div></div>'; return; }
    const found = App.state.defs.games.filter(g => det.games[g.id] && det.games[g.id].found);
    const missing = App.state.defs.games.filter(g => !det.games[g.id] || !det.games[g.id].found);
    if (det.steam && det.steam.libraries.length) body.appendChild(h(`<p class="dim" style="margin:-8px 0 16px;font-size:12.5px">Biblioteki Steam: ${det.steam.libraries.map(esc).join(' · ')}</p>`));
    else body.appendChild(h(`<div class="note warn" style="margin-bottom:16px">Nie znaleziono Steama. Jeśli jest zainstalowany w nietypowym miejscu, wskaż go w Ustawieniach.</div>`));
    const grid = h('<div class="grid games"></div>');
    for (const g of found) grid.appendChild(card(g, det.games[g.id]));
    body.appendChild(grid);
    if (missing.length) {
      body.appendChild(h(`<div class="section-title"><h2>Nie znaleziono</h2><span class="dim">${missing.length} gier – wskaż folder, jeśli masz je zainstalowane</span></div>`));
      const g2 = h('<div class="grid games"></div>');
      for (const g of missing) g2.appendChild(card(g, null));
      body.appendChild(g2);
    }
    const uns = App.state.defs.unsupported;
    if (uns.length) body.appendChild(h(`<div class="panel" style="margin-top:28px"><h3>Pominięte z mod managera</h3><p class="muted" style="margin:6px 0 10px;font-size:13px">Te gry nie mają danych, na podstawie których da się rzetelnie sprawdzić zgodność modów:</p>${uns.map(u => `<p style="margin:4px 0;font-size:13px"><b>${esc(u.name)}</b> <span class="muted">– ${esc(u.reason)}</span></p>`).join('')}</div>`));
  }

  function card(g, info) {
    const rep = App.state.reports[g.id];
    if (!info) {
      const c = h(`<div class="gcard missing"><div class="top">${gameBadge(g)}<div><div class="name">${esc(g.name)}</div><div class="src">Nie wykryto</div></div></div>
        <div class="actions"><button class="btn sm">${icon('folder')}Wskaż folder</button></div></div>`);
      $('button', c).onclick = e => { e.stopPropagation(); changePath(g.id); };
      if (g.id === 'minecraft') $('button', c).onclick = e => { e.stopPropagation(); addMcInstance(); };
      return c;
    }
    const sub = g.id === 'minecraft' ? `${info.instances.length} ${info.instances.length === 1 ? 'instancja' : 'instancji'}` : info.source;
    const c = h(`<div class="gcard" tabindex="0" role="button">
      <div class="top">${gameBadge(g)}<div style="min-width:0"><div class="name">${esc(g.name)}</div><div class="src">${esc(sub)}</div></div></div>
      <div class="path">${esc(info.path || '')}</div>
      ${info.warning ? `<div class="chip warn" title="${esc(info.warning)}">${icon('alert')}Sprawdź lokalizację</div>` : ''}
      ${rep ? `${healthBar(rep.mods)}<div class="health-legend"><span>${rep.mods.length} modów</span>${rep.counts.error ? `<span class="e">${App.plural(rep.counts.error, 'błąd', 'błędy', 'błędów')}</span>` : ''}${rep.counts.warn ? `<span class="w">${App.plural(rep.counts.warn, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń')}</span>` : ''}${!rep.counts.error && !rep.counts.warn ? '<span class="o">Wszystko gra</span>' : ''}</div>` : ''}
      <div class="actions">
        <button class="btn sm primary" data-a="check">${icon('shield')}${rep ? 'Sprawdź ponownie' : 'Sprawdź zgodność'}</button>
        ${g.id !== 'minecraft' ? `<button class="btn sm icon" data-a="path" title="Zmień lokalizację">${icon('edit')}</button>` : ''}
        <button class="btn sm icon" data-a="open" title="Otwórz folder">${icon('folder')}</button>
      </div></div>`);
    c.onclick = e => {
      const a = e.target.closest('[data-a]');
      if (!a) return App.go('games', { id: g.id });
      e.stopPropagation();
      if (a.dataset.a === 'check') App.go('games', { id: g.id, tab: 'compat', run: true });
      if (a.dataset.a === 'path') changePath(g.id);
      if (a.dataset.a === 'open') api('shell:open', info.path);
    };
    c.onkeydown = e => { if (e.key === 'Enter') App.go('games', { id: g.id }); };
    return c;
  }

  async function changePath(id) {
    const g = gameDef(id); const cur = App.state.detected.games[id];
    const p = await api('dialog:folder', `Wskaż folder gry: ${g.name}`, cur && cur.path);
    if (!p) return;
    const info = await api('games:setPath', id, p);
    App.state.detected.games[id] = info;
    delete App.state.reports[id];
    toast(info.warning ? info.warning : `Ustawiono lokalizację ${g.name}`, info.warning ? 'warn' : 'ok');
    App.renderRail(); App.refreshCurrent();
  }
  async function addMcInstance() {
    const p = await api('dialog:folder', 'Wskaż folder instancji Minecraft (zawierający folder mods)');
    if (!p) return;
    const info = await api('mc:addInstance', p);
    App.state.detected.games.minecraft = info; App.renderRail(); App.refreshCurrent();
    toast('Dodano instancję. Ustaw jej wersję i loader w zakładce Ustawienia.');
  }

  // ===================== SZCZEGÓŁY =====================
  async function renderDetail(el, params) {
    const g = gameDef(params.id);
    const info = App.state.detected && App.state.detected.games[g.id];
    if (!info || !info.found) { App.go('games'); return; }
    App.setCrumb(`Znalezione gry / <b>${esc(g.name)}</b>`);
    const profiles = await api('mods:profiles', g.id);
    let profileId = params.profile || (profiles[0] && profiles[0].id);
    let tab = params.tab || 'mods';
    el.innerHTML = `
      <button class="back" data-back>${icon('back')}Znalezione gry</button>
      <div class="detail-hero">${gameBadge(g)}<div style="flex:1;min-width:0"><h1>${esc(g.name)}</h1><p class="lead" style="margin-top:4px">${esc(g.desc)}</p></div></div>
      ${profiles.length > 1 || g.id === 'minecraft' ? `<div class="profile-bar"><label class="muted" for="prof">${g.id === 'minecraft' ? 'Instancja' : 'Profil'}</label><select class="input" id="prof">${profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.mcVersion ? ` – ${esc(p.mcVersion)} ${esc(p.loader || '')}` : ''}</option>`).join('')}</select><span class="path" data-ppath></span></div>` : ''}
      <div class="tabs" role="tablist">
        <button data-tab="mods">Mody</button><button data-tab="compat">Zgodność</button><button data-tab="get">Pobierz mody</button>
        ${(g.loaders && g.loaders.length) ? '<button data-tab="loader">Modloader</button>' : ''}
        <button data-tab="settings">Ustawienia</button>
      </div>
      <div data-content></div>`;
    $('[data-back]', el).onclick = () => App.go('games');
    const sel = $('#prof', el);
    const updPath = () => { const p = profiles.find(x => x.id === profileId); const pp = $('[data-ppath]', el); if (pp && p) pp.textContent = p.root; };
    if (sel) { sel.value = profileId; sel.onchange = () => { profileId = sel.value; delete App.state.reports[g.id]; updPath(); show(); }; updPath(); }
    const content = $('[data-content]', el);
    const show = () => {
      $$('.tabs button', el).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      const prof = profiles.find(p => p.id === profileId);
      const ctx = { g, info, prof, profileId, profiles, rerender: () => renderDetail(el, { ...params, tab, profile: profileId, run: false }) };
      if (tab === 'mods') tabMods(content, ctx);
      if (tab === 'compat') tabCompat(content, ctx, params.run); params.run = false;
      if (tab === 'loader') tabLoader(content, ctx);
      if (tab === 'get') tabGet(content, ctx);
      if (tab === 'settings') tabSettings(content, ctx);
    };
    $$('.tabs button', el).forEach(b => b.onclick = () => { tab = b.dataset.tab; show(); });
    show();
  }

  async function runCheck(ctx) {
    const rep = await api('mods:check', ctx.g.id, ctx.profileId);
    App.state.reports[ctx.g.id] = rep;
    return rep;
  }

  // ---------- Mody ----------
  async function tabMods(c, ctx) {
    c.innerHTML = '<div class="progress indet"><i></i></div>';
    let rep = App.state.reports[ctx.g.id];
    try { if (!rep) rep = await runCheck(ctx); } catch { c.innerHTML = ''; return; }
    const target = await api('mods:target', ctx.g.id, ctx.profileId);
    let filter = '';
    c.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <div class="searchbox">${icon('search')}<input class="input" placeholder="Szukaj modu" data-q></div>
        <span class="dim" style="flex:1">${rep.mods.length} pozycji · ${rep.mods.filter(m => m.enabled).length} włączonych</span>
        <button class="btn" data-update>${icon('update')}Aktualizuj wszystko</button>
        <button class="btn" data-add>${icon('plus')}Dodaj mody</button>
        <button class="btn" data-open>${icon('folder')}Folder modów</button>
        <button class="btn primary" data-check>${icon('shield')}Sprawdź zgodność</button>
      </div>
      <div class="table-wrap" data-drop><table class="table"><thead><tr><th style="width:52px">Wł.</th><th>Nazwa</th><th>Wersja</th><th>Źródło</th><th>Stan</th><th style="width:90px"></th></tr></thead><tbody></tbody></table></div>
      <p class="dim" style="font-size:12.5px;margin-top:8px">Przeciągnij pliki modów na listę, aby je dodać do: <span class="path">${esc(target)}</span>. Mody z Warsztatu Steam włączasz i wyłączasz w grze.</p>`;
    const tbody = $('tbody', c);
    c.insertBefore(profileBar(ctx, rep, () => { delete App.state.reports[ctx.g.id]; tabMods(c, ctx); }), c.firstChild);
    $('[data-update]', c).onclick = () => updateAll(ctx, () => { delete App.state.reports[ctx.g.id]; tabMods(c, ctx); });
    const draw = () => {
      tbody.innerHTML = '';
      const list = rep.mods.filter(m => !filter || (m.name + ' ' + (m.id || '') + ' ' + (m.key || '')).toLowerCase().includes(filter));
      if (!list.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty" style="padding:30px"><h2>${rep.mods.length ? 'Brak wyników' : 'Brak modów'}</h2><p>${rep.mods.length ? 'Zmień wyszukiwaną frazę.' : 'Dodaj mody przyciskiem powyżej lub przeciągnij pliki tutaj.'}</p></div></td></tr>`; return; }
      for (const m of list) {
        const st = { ok: ['ok', 'Zgodny'], warn: ['warn', 'Ostrzeżenie'], error: ['error', 'Błąd'], disabled: ['', 'Wyłączony'] }[m.status] || ['', '-'];
        const tr = h(`<tr class="${m.enabled ? '' : 'off'}">
          <td>${m.toggleable ? `<label class="switch" title="${m.enabled ? 'Wyłącz' : 'Włącz'}"><input type="checkbox" ${m.enabled ? 'checked' : ''}><span></span></label>` : `<label class="switch" title="Zarządzane przez grę lub Steam"><input type="checkbox" ${m.enabled ? 'checked' : ''} disabled><span></span></label>`}</td>
          <td><div class="nm">${esc(m.name)}</div>${m.id && m.id !== m.name ? `<div class="sub">${esc(m.id)}</div>` : ''}</td>
          <td class="mono">${esc(m.version || '-')}</td>
          <td><span class="sub">${esc(m.loader ? m.loader + ' · ' : '')}${esc(m.source || '')}${m.size ? ' · ' + fmtSize(m.size) : ''}</span></td>
          <td><span class="chip ${st[0]}">${st[1]}</span></td>
          <td style="text-align:right">${m.file ? `<button class="btn sm ghost icon" data-a="show" title="Pokaż w folderze">${icon('folder')}</button>` : ''}${m.toggleable ? `<button class="btn sm ghost icon danger" data-a="del" title="Przenieś do kosza">${icon('trash')}</button>` : ''}</td></tr>`);
        const sw = $('input', tr);
        if (m.toggleable) sw.onchange = async () => { try { await api('mods:toggle', m, ctx.g.id); delete App.state.reports[ctx.g.id]; tabMods(c, ctx); } catch { sw.checked = !sw.checked; } };
        tr.onclick = async e => {
          const a = e.target.closest('[data-a]'); if (!a) return;
          if (a.dataset.a === 'show') api('shell:show', m.file);
          if (a.dataset.a === 'del' && await App.confirmBox('Usunąć mod?', `<b>${esc(m.name)}</b> trafi do kosza systemowego.`, 'Przenieś do kosza', true)) { await api('mods:remove', m.file); delete App.state.reports[ctx.g.id]; tabMods(c, ctx); }
        };
        // wiersz klikalny → pokaż problemy moda
        tr.ondblclick = () => {
          const iss = rep.issues.filter(i => i.mod === m.key || i.mod === m.name);
          modal({ title: m.name, wide: true, body: iss.length ? renderIssues(iss) : h('<p class="muted">Brak problemów dla tego moda.</p>') });
        };
        tbody.appendChild(tr);
      }
    };
    draw();
    $('[data-q]', c).oninput = e => { filter = e.target.value.toLowerCase(); draw(); };
    $('[data-open]', c).onclick = async () => { await api('fs:mkdir', target); api('shell:open', target); };
    $('[data-check]', c).onclick = () => { delete App.state.reports[ctx.g.id]; App.go('games', { id: ctx.g.id, tab: 'compat', profile: ctx.profileId, run: true }); };
    const addFiles = async files => { if (!files.length) return;
      const archives = files.filter(f => /\.(zip|7z|rar)$/i.test(f) && !['minecraft', 'factorio'].includes(ctx.g.id));
      if (archives.length) { await api('nexus:installLocal', ctx.g.id, ctx.profileId, archives); files = files.filter(f => !archives.includes(f)); }
      if (files.length) await api('mods:add', target, files); toast(`Dodano ${files.length} plik(ów)`); delete App.state.reports[ctx.g.id]; tabMods(c, ctx); };
    $('[data-add]', c).onclick = async () => addFiles(await api('dialog:files', 'Wybierz pliki modów'));
    const drop = $('[data-drop]', c);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--jade)'; });
    drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor = ''; addFiles([...e.dataTransfer.files].map(f => window.cm.pathForFile(f))); });
  }

  // ---------- Zgodność ----------
  async function tabCompat(c, ctx, run) {
    let rep = App.state.reports[ctx.g.id];
    const draw = () => {
      if (!rep) { c.innerHTML = `<div class="empty"><h2>Nie sprawdzono jeszcze zgodności</h2><p>CodeManager przeanalizuje mody i ich metadane – zależności, wersje gry, loader i konflikty.</p><button class="btn primary" data-run>${icon('shield')}Sprawdź teraz</button></div>`; $('[data-run]', c).onclick = go; return; }
      let filter = 'all';
      c.innerHTML = `
        <div class="summary-strip">
          <div class="e"><div class="n">${rep.counts.error}</div><div class="l">błędy</div></div>
          <div class="w"><div class="n">${rep.counts.warn}</div><div class="l">ostrzeżenia</div></div>
          <div><div class="n">${rep.counts.info}</div><div class="l">informacje</div></div>
          <div class="o"><div class="n">${rep.mods.filter(m => m.enabled).length}</div><div class="l">aktywne mody</div></div>
          <div class="grow" style="min-width:160px">${healthBar(rep.mods)}</div>
          ${['minecraft', 'lethalcompany', 'repo', 'contentwarning', 'factorio'].includes(ctx.g.id) ? `<button class="btn" data-online>${icon('globe')}Sprawdź online</button>` : ''}
          <button class="btn primary" data-run>${icon('refresh')}Sprawdź ponownie</button>
        </div>
        <div class="grid" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start">
          <div><div class="filter-chips"><button data-f="all" class="active">Wszystkie</button><button data-f="error">Błędy</button><button data-f="warn">Ostrzeżenia</button><button data-f="info">Informacje</button></div><div data-list></div><div data-onlineres></div></div>
          <div class="panel"><h3 style="margin-bottom:10px">Kontekst sprawdzenia</h3><dl class="meta-list">${Object.entries(rep.meta).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
          <p class="dim" style="font-size:12px;margin:12px 0 0">Sprawdzono ${new Date(rep.checkedAt).toLocaleTimeString('pl-PL')}. Kliknij dwukrotnie mod na liście Mody, aby zobaczyć tylko jego problemy.</p></div>
        </div>`;
      const list = $('[data-list]', c);
      const target = { gameId: ctx.g.id, profileId: ctx.profileId };
      api('analyzer:summary', rep).then(sum => list.parentNode.insertBefore(summaryBox(sum, rep, target, go), list.parentNode.firstChild));
      const drawList = () => { list.innerHTML = ''; const iss = rep.issues.filter(i => filter === 'all' || i.level === filter); list.appendChild(iss.length ? renderIssues(iss, target, () => { delete App.state.reports[ctx.g.id]; }) : h('<p class="muted">Brak pozycji w tej kategorii.</p>')); };
      drawList();
      $$('[data-f]', c).forEach(b => b.onclick = () => { filter = b.dataset.f; $$('[data-f]', c).forEach(x => x.classList.toggle('active', x === b)); drawList(); });
      $('[data-run]', c).onclick = go;
      const ob = $('[data-online]', c);
      if (ob) ob.onclick = async () => {
        ob.disabled = true; ob.innerHTML = icon('refresh', 'spin') + 'Sprawdzanie…';
        try {
          const res = await api('mods:online', ctx.g.id, ctx.profileId);
          const box = $('[data-onlineres]', c); box.innerHTML = '';
          box.appendChild(h(`<div class="section-title"><h2>Wyniki online</h2><span class="dim">${ctx.g.id === 'minecraft' ? 'Modrinth' : ctx.g.id === 'factorio' ? 'Portal modów Factorio' : 'Thunderstore'}</span></div>`));
          box.appendChild(renderIssues(res.map(r => ({ ...r, level: r.level }))));
        } finally { ob.disabled = false; ob.innerHTML = icon('globe') + 'Sprawdź online'; }
      };
    };
    const go = async () => {
      c.innerHTML = '<div class="panel"><p class="muted" style="margin-top:0">Analizuję mody…</p><div class="progress indet"><i></i></div></div>';
      try { rep = await runCheck(ctx); } catch { rep = null; }
      draw();
      if (rep) toast(rep.counts.error ? `Znaleziono ${App.plural(rep.counts.error, 'błąd', 'błędy', 'błędów')} zgodności` : 'Nie wykryto błędów zgodności', rep.counts.error ? 'warn' : 'ok');
    };
    if (run || !rep) { if (run) return go(); }
    draw();
  }

  // ---------- Modloader ----------
  async function tabLoader(c, ctx) {
    const loaders = (await api('loaders:list')).filter(l => (ctx.g.loaders || []).includes(l.id));
    const root = ctx.prof ? ctx.prof.root : ctx.info.path;
    c.innerHTML = '';
    if (ctx.g.id === 'minecraft') {
      const isLauncherManaged = ctx.prof && ctx.prof.launcher && ctx.prof.launcher !== 'Minecraft Launcher' && ctx.prof.launcher !== 'Ręcznie';
      c.appendChild(h(`<div class="note ${isLauncherManaged ? 'warn' : ''}" style="margin-bottom:14px">${isLauncherManaged
        ? `Ta instancja należy do launchera <b>${esc(ctx.prof.launcher)}</b> – loader zmienisz najwygodniej w jego ustawieniach. Instalatory poniżej działają dla oficjalnego launchera (.minecraft).`
        : 'Loader zostanie zainstalowany do wybranego folderu jako nowy profil oficjalnego launchera Minecraft. Wymagana jest Java.'}</div>`));
    }
    const grid = h('<div class="grid three"></div>');
    for (const l of loaders) {
      const st = await apiQuietSafe('loaders:status', l.id, root);
      const card = h(`<div class="loader-card"><div class="row"><h2 style="flex:1">${esc(l.name)}</h2>${st.installed === true ? `<span class="chip ok">${icon('check')}Zainstalowany${st.version ? ' ' + esc(st.version) : ''}</span>` : st.installed === false ? '<span class="chip">Brak</span>' : ''}</div><p>${esc(l.desc)}</p>
        <div class="row">${ctx.g.id === 'minecraft' ? `<input class="input" style="width:120px" placeholder="np. 1.21.1" data-mc value="${esc((ctx.prof && ctx.prof.mcVersion) || '')}">` : ''}<button class="btn ${st.installed ? '' : 'primary'}" data-i>${icon(l.kind === 'link' ? 'link' : 'download')}${l.kind === 'link' ? 'Otwórz' : st.installed ? 'Zainstaluj ponownie' : 'Zainstaluj'}</button></div></div>`);
      $('[data-i]', card).onclick = () => installLoader(l, { root, mcVersion: $('[data-mc]', card) ? $('[data-mc]', card).value.trim() : null }, ctx.rerender);
      grid.appendChild(card);
    }
    c.appendChild(grid);
  }
  async function apiQuietSafe(ch, ...a) { try { return await App.apiQuiet(ch, ...a); } catch { return {}; } }

  async function installLoader(l, opts, after) {
    if (l.kind === 'link') { await api('shell:external', l.url); return; }
    if (l.kind === 'minecraft' && !opts.mcVersion) { toast('Podaj wersję Minecrafta', 'warn'); return; }
    if (!opts.root) { toast('Najpierw wskaż folder gry', 'warn'); return; }
    if (!(await App.confirmBox(`Zainstalować ${l.name}?`, `Pliki zostaną pobrane i rozpakowane do:<br><span class="path">${esc(opts.root)}</span><br><br>Nadpisane pliki trafią do kopii zapasowej.`, 'Zainstaluj'))) return;
    const job = App.jobModal(`Instalacja: ${l.name}`);
    try {
      const r = await window.cm.call('loaders:install', job.jobId, l.id, opts);
      job.done(`Zainstalowano ${l.name}${r && r.version ? ' ' + r.version : ''}.`);
      if (App.state.detected) App.state.detected = await api('games:detected');
      after && after();
    } catch (e) { job.log('✖ ' + e.message); job.done('Instalacja nie powiodła się.', false); }
  }
  App.installLoader = installLoader;

  // ---------- Ustawienia ----------
  function tabSettings(c, ctx) {
    const { g, info } = ctx;
    const gs = (App.state.gameConfig[g.id] || {}).settings || {};
    c.innerHTML = '';
    if (g.id === 'minecraft') {
      const p = ctx.prof;
      const panel = h(`<div class="panel" style="max-width:760px"><h2 style="margin-bottom:6px">Instancja: ${esc(p.name)}</h2><p class="path" style="margin:0 0 16px">${esc(p.root)}</p>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="field"><label>Wersja Minecraft</label><input class="input" data-k="mcVersion" value="${esc(p.mcVersion || '')}" placeholder="1.21.1"></div>
          <div class="field"><label>Loader</label><select class="input" data-k="loader">${['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map(l => `<option ${p.loader === l ? 'selected' : ''} value="${l}">${l}</option>`).join('')}</select></div>
          <div class="field"><label>Wersja loadera</label><input class="input" data-k="loaderVersion" value="${esc(p.loaderVersion || '')}" placeholder="opcjonalnie"></div>
        </div>
        <p class="dim" style="font-size:12.5px;margin-top:0">Dane wykryto z launchera (${esc(p.launcher || '?')}). Popraw je, jeśli są błędne – od nich zależy sprawdzanie wersji modów.</p>
        <div class="row"><button class="btn primary" data-save>${icon('save')}Zapisz</button><button class="btn" data-open>${icon('folder')}Otwórz folder</button>${p.launcher === 'Ręcznie' ? `<button class="btn danger" data-rm>${icon('trash')}Usuń z listy</button>` : ''}</div></div>`);
      $('[data-save]', panel).onclick = async () => {
        const patch = {}; $$('[data-k]', panel).forEach(i => { patch[i.dataset.k] = i.value.trim() || undefined; });
        App.state.detected.games.minecraft = await api('mc:setInstance', p.id, patch);
        delete App.state.reports.minecraft; toast('Zapisano ustawienia instancji'); ctx.rerender();
      };
      $('[data-open]', panel).onclick = () => api('shell:open', p.root);
      const rm = $('[data-rm]', panel); if (rm) rm.onclick = async () => { App.state.detected.games.minecraft = await api('mc:removeInstance', p.id); App.go('games', { id: 'minecraft' }); };
      c.appendChild(panel);
      return;
    }
    const panel = h(`<div class="panel" style="max-width:760px">
      <h2 style="margin-bottom:14px">Lokalizacja gry</h2>
      <div class="field"><label>Folder gry</label><div class="inline-input"><input class="input mono" readonly value="${esc(info.path)}"><button class="btn" data-change>${icon('folder')}Zmień</button></div>
      <span class="hint">Źródło: ${esc(info.source)}${info.appid ? ` · Steam AppID ${info.appid}` : ''}${info.buildid ? ` · build ${esc(info.buildid)}` : ''}</span></div>
      ${info.warning ? `<div class="note warn" style="margin-bottom:14px">${esc(info.warning)}</div>` : ''}
      ${info.workshop && info.workshop.length ? `<div class="field"><label>Warsztat Steam</label>${info.workshop.map(w => `<span class="path">${esc(w)}</span>`).join('<br>')}</div>` : ''}
      <div class="row" style="margin-bottom:22px"><button class="btn" data-reset>${icon('refresh')}Wykryj automatycznie</button><button class="btn" data-open>${icon('folder')}Otwórz folder</button><button class="btn" data-edit>${icon('code')}Otwórz w edytorze</button></div>
      ${VERSION_HINT[g.id] ? `<h2 style="margin-bottom:12px">Wersja gry</h2><div class="field"><label>Ręczna wersja (opcjonalnie)</label><div class="inline-input"><input class="input" data-ver value="${esc(gs.gameVersion || '')}" placeholder="automatycznie"><button class="btn primary" data-savever>Zapisz</button></div><span class="hint">${esc(VERSION_HINT[g.id])}</span></div>` : ''}
    </div>`);
    $('[data-change]', panel).onclick = () => changePath(g.id);
    $('[data-open]', panel).onclick = () => api('shell:open', info.path);
    $('[data-edit]', panel).onclick = () => App.go('editor', { folder: info.path });
    $('[data-reset]', panel).onclick = async () => { App.state.detected.games[g.id] = await api('games:resetPath', g.id); delete App.state.reports[g.id]; toast('Przywrócono automatyczne wykrywanie'); ctx.rerender(); };
    const sv = $('[data-savever]', panel);
    if (sv) sv.onclick = async () => { const v = $('[data-ver]', panel).value.trim(); await api('games:settings', g.id, { gameVersion: v || undefined }); App.state.gameConfig[g.id] = { ...(App.state.gameConfig[g.id] || {}), settings: { ...gs, gameVersion: v || undefined } }; delete App.state.reports[g.id]; toast('Zapisano wersję gry'); };
    c.appendChild(panel);
  }


  // ---------- streszczenie dla laika ----------
  function summaryBox(sum, rep, target, rerun) {
    const fixable = rep.issues.filter(i => i.action);
    const el = h(`<div class="explain ${sum.tone}">
      <div class="explain-ic">${icon(sum.tone === 'ok' ? 'ok' : sum.tone === 'warn' ? 'alert' : 'bulb')}</div>
      <div style="flex:1"><div class="explain-t">${esc(sum.text)}</div>
      ${sum.steps.length ? `<ol class="explain-steps">${sum.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      ${fixable.length ? `<div class="row" style="margin-top:10px"><button class="btn primary sm" data-fixall>${icon('wrench')}Napraw automatycznie (${fixable.length})</button><span class="dim" style="font-size:12.5px">Pobierze brakujące mody i wymieni złe wersje tam, gdzie to możliwe.</span></div>` : ''}</div></div>`);
    const fa = $('[data-fixall]', el);
    if (fa) fa.onclick = async () => {
      fa.disabled = true;
      await App.runJob('Naprawa automatyczna', async jobId => {
        const seen = new Set();
        for (const i of fixable) {
          const key = JSON.stringify(i.action); if (seen.has(key)) continue; seen.add(key);
          try { await window.cm.call('fix:run', jobId, i.action, target); } catch (e) { /* zapisane w logu */ }
        }
      }, { doneMsg: 'Zakończono. Sprawdzam zgodność ponownie…' });
      rerun && rerun();
    };
    return el;
  }

  // ---------- profile modów ----------
  function profileBar(ctx, rep, refresh) {
    const scope = ctx.profileId || 'game';
    const bar = h(`<div class="modprofiles"><span class="muted">${icon('profile')}Profil modów</span><select class="input" data-p><option value="">— bieżący zestaw —</option></select>
      <button class="btn sm" data-apply disabled>Przełącz</button><button class="btn sm ghost" data-save title="Zapisz obecny zestaw jako nowy profil">${icon('plus')}Nowy z obecnych</button><button class="btn sm ghost" data-upd disabled title="Nadpisz wybrany profil obecnym zestawem">${icon('save')}Zapisz</button><button class="btn sm ghost icon danger" data-del disabled title="Usuń profil">${icon('trash')}</button></div>`);
    const sel = $('[data-p]', bar);
    const load = async () => {
      const d = await api('profiles:list', ctx.g.id, scope);
      sel.innerHTML = '<option value="">— bieżący zestaw —</option>' + d.profiles.map(p => `<option value="${p.id}" ${d.active === p.id ? 'selected' : ''}>${esc(p.name)} (${p.enabled.length} modów)</option>`).join('');
      upd();
    };
    const upd = () => { const on = !!sel.value; ['apply', 'upd', 'del'].forEach(k => { $(`[data-${k}]`, bar).disabled = !on; }); };
    sel.onchange = upd;
    $('[data-save]', bar).onclick = async () => { const n = await App.promptBox('Nowy profil modów', 'Nazwa profilu (np. „Tylko optymalizacja”, „Pełna paczka”)'); if (!n) return; await api('profiles:create', ctx.g.id, scope, n, rep.mods); toast(`Zapisano profil „${n}”`); load(); };
    $('[data-upd]', bar).onclick = async () => { await api('profiles:update', ctx.g.id, scope, sel.value, rep.mods); toast('Zaktualizowano profil'); load(); };
    $('[data-del]', bar).onclick = async () => { if (await App.confirmBox('Usunąć profil?', 'Mody nie zostaną usunięte – tylko zapisany zestaw.', 'Usuń', true)) { await api('profiles:remove', ctx.g.id, scope, sel.value); load(); } };
    $('[data-apply]', bar).onclick = async () => {
      const r = await api('profiles:apply', ctx.g.id, scope, sel.value, rep.mods);
      toast(`Profil „${r.name}”: zmieniono ${r.changed} modów${r.missing.length ? `, brakuje ${r.missing.length}` : ''}`, r.errors.length || r.missing.length ? 'warn' : 'ok', 6000);
      if (r.missing.length) modal({ title: 'Brakujące mody profilu', body: `<p class="muted" style="margin-top:0">Tych modów z profilu nie ma już w folderze:</p><div class="files" style="font-family:var(--mono);font-size:12px">${r.missing.map(esc).join('<br>')}</div>` });
      refresh();
    };
    load();
    return bar;
  }

  // ---------- aktualizacja jednym przyciskiem ----------
  async function updateAll(ctx, after, target) {
    const t = target || { gameId: ctx.g.id, profileId: ctx.profileId };
    const r = await App.runJob('Aktualizacja modów', jobId => window.cm.call('updates:run', jobId, t), {
      doneMsg: r => r.kind === 'list' ? 'Sprawdzono dostępne aktualizacje.' : `Zaktualizowano ${r.updated.length}, aktualne: ${r.upToDate}${r.unknown.length ? `, nieznane w serwisie: ${r.unknown.length}` : ''}.`,
    });
    if (!r) return;
    if (r.kind === 'list') modal({ title: 'Aktualizacje', wide: true, body: renderIssues(r.items) });
    else if (r.updated.length) toast(`Zaktualizowano ${r.updated.length} modów. Stare wersje są w kopii zapasowej.`);
    after && after();
  }
  App.updateAll = updateAll;

  // ---------- pobieranie modów ----------
  async function tabGet(c, ctx) {
    const g = ctx.g;
    const domain = await api('nexus:domain', g.id);
    const nx = await api('nexus:status');
    const parts = [];
    if (g.id === 'minecraft') parts.push('modrinth');
    if (g.checker === 'bepinex') parts.push('thunderstore');
    if (domain) parts.push('nexus');
    if (!parts.length) {
      c.innerHTML = `<div class="empty"><h2>Brak serwisu z modami dla tej gry</h2><p>${g.id === 'factorio' ? 'Mody Factorio pobierzesz w grze (menu Mody). CodeManager zaktualizuje je przyciskiem „Aktualizuj wszystko”.' : 'Mody do tej gry pobierzesz z Warsztatu Steam – CodeManager wykryje je automatycznie.'}</p></div>`;
      return;
    }
    let src = parts[0];
    c.innerHTML = `<div class="row" style="margin-bottom:14px"><div class="seg">${parts.map(p => `<button data-src="${p}">${{ modrinth: 'Modrinth', thunderstore: 'Thunderstore', nexus: 'Nexus Mods' }[p]}</button>`).join('')}</div><span style="flex:1"></span>${domain ? `<button class="btn sm" data-local>${icon('archive')}Zainstaluj z archiwum…</button>` : ''}</div><div data-body></div>`;
    const body = $('[data-body]', c);
    const local = $('[data-local]', c);
    if (local) local.onclick = async () => { const f = await api('dialog:files', 'Wybierz archiwa modów (.zip, .7z)', [{ name: 'Archiwa', extensions: ['zip', '7z', 'rar'] }]); if (!f.length) return; const r = await api('nexus:installLocal', g.id, ctx.profileId, f); toast(`Zainstalowano (${r.length} elementów)`); delete App.state.reports[g.id]; };
    const show = () => {
      $$('[data-src]', c).forEach(b => b.classList.toggle('active', b.dataset.src === src));
      if (src === 'modrinth') getModrinth(body, ctx, { gameId: g.id, profileId: ctx.profileId }, { mcVersion: ctx.prof && ctx.prof.mcVersion, loader: ctx.prof && ctx.prof.loader });
      if (src === 'thunderstore') getThunderstore(body, ctx, { gameId: g.id, profileId: ctx.profileId });
      if (src === 'nexus') getNexus(body, ctx, domain, nx);
    };
    $$('[data-src]', c).forEach(b => b.onclick = () => { src = b.dataset.src; show(); });
    show();
  }

  function getModrinth(body, ctx, target, opts) {
    const type = opts.type || 'mod';
    body.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="searchbox">${icon('search')}<input class="input" style="width:340px" placeholder="Szukaj na Modrinth (np. sodium, create, worldedit)" data-q></div>
      <select class="input" style="width:auto" data-sort><option value="relevance">Trafność</option><option value="downloads">Pobrania</option><option value="updated">Ostatnio aktualizowane</option><option value="newest">Najnowsze</option></select>
      <span class="dim">Filtr: ${esc(opts.loader || 'dowolny loader')} · ${esc(opts.mcVersion || 'dowolna wersja')}</span></div><div class="results" data-res></div>`;
    const res = $('[data-res]', body); const q = $('[data-q]', body); const sort = $('[data-sort]', body);
    let timer;
    const run = async () => {
      res.innerHTML = '<div class="progress indet"><i></i></div>';
      let r; try { r = await App.apiQuiet('modrinth:search', q.value.trim(), { mcVersion: opts.mcVersion, loader: opts.loader, type, sort: sort.value, limit: 30 }); } catch (e) { res.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
      res.innerHTML = r.hits.length ? '' : '<p class="muted">Brak wyników dla tej wersji i loadera.</p>';
      for (const m of r.hits) {
        const card = h(`<div class="mcard">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : `<div class="mcard-ph">${esc(m.title.slice(0, 1))}</div>`}<div class="mcard-b"><div class="mcard-t">${esc(m.title)} <span class="dim">· ${esc(m.author)}</span></div><div class="mcard-d">${esc(m.description)}</div>
          <div class="mcard-m"><span>${App.icon('download')}${Intl.NumberFormat('pl-PL', { notation: 'compact' }).format(m.downloads)}</span>${m.client === 'required' && m.server === 'unsupported' ? '<span class="chip">tylko klient</span>' : ''}${m.server === 'required' && m.client === 'unsupported' ? '<span class="chip">tylko serwer</span>' : ''}</div></div>
          <div class="mcard-a"><button class="btn sm primary" data-i>${icon('download')}Zainstaluj</button><button class="btn sm ghost" data-o>${icon('globe')}</button></div></div>`);
        $('[data-o]', card).onclick = () => api('shell:external', m.url);
        $('[data-i]', card).onclick = async () => {
          const r2 = await App.runJob(`Instalacja: ${m.title}`, jobId => window.cm.call('modrinth:install', jobId, target, m.id), { doneMsg: x => `Zainstalowano ${x.length} plik(ów) (z zależnościami).` });
          if (r2) { delete App.state.reports[target.gameId]; }
        };
        res.appendChild(card);
      }
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
    sort.onchange = run;
    run();
  }
  App.getModrinth = getModrinth;

  function getThunderstore(body, ctx, target) {
    body.innerHTML = `<div class="panel" style="max-width:760px"><h3>Zainstaluj paczkę z Thunderstore</h3><p class="muted" style="font-size:13px">Wklej nazwę paczki w formacie <span class="mono">Autor-Nazwa</span> albo adres strony paczki. Zależności zostaną doinstalowane automatycznie.</p>
      <div class="inline-input"><input class="input" placeholder="np. notnotnotswipez-MoreCompany albo https://thunderstore.io/c/lethal-company/p/…" data-in><button class="btn primary" data-go>${icon('download')}Zainstaluj</button></div>
      <div class="row" style="margin-top:16px"><button class="btn" data-r2>${icon('import')}Importuj profil r2modman (kod lub plik)</button><button class="btn" data-site>${icon('globe')}Przeglądaj Thunderstore</button></div></div>`;
    $('[data-go]', body).onclick = async () => {
      const v = $('[data-in]', body).value.trim(); if (!v) return;
      const r = await App.runJob('Instalacja z Thunderstore', jobId => window.cm.call('thunderstore:install', jobId, target, v), { doneMsg: x => `Zainstalowano ${x.length} paczek.` });
      if (r) delete App.state.reports[target.gameId];
    };
    $('[data-r2]', body).onclick = () => importR2(target);
    $('[data-site]', body).onclick = () => api('shell:external', `https://thunderstore.io/c/${ctx.g.thunderstore || ''}/`);
  }
  App.getThunderstore = getThunderstore;

  function getNexus(body, ctx, domain, nx) {
    if (!nx.connected) {
      body.innerHTML = `<div class="panel" style="max-width:720px"><h3>Połącz konto Nexus Mods</h3><p class="muted" style="font-size:13px">Aby przeglądać i aktualizować mody z Nexus Mods, wklej osobisty klucz API (nexusmods.com → Ustawienia konta → API Keys). Klucz jest przechowywany zaszyfrowany na tym komputerze.</p>
        <div class="inline-input"><input class="input mono" type="password" placeholder="Klucz API" data-k><button class="btn primary" data-save>Połącz</button></div><button class="btn sm ghost" style="margin-top:10px" data-open>${icon('globe')}Otwórz stronę z kluczami</button></div>`;
      $('[data-open]', body).onclick = () => api('shell:external', 'https://www.nexusmods.com/users/myaccount?tab=api');
      $('[data-save]', body).onclick = async () => { const u = await api('nexus:setKey', $('[data-k]', body).value); toast(`Połączono jako ${u.name}${u.premium ? ' (Premium)' : ''}`); getNexus(body, ctx, domain, await api('nexus:status')); };
      return;
    }
    body.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="searchbox">${icon('search')}<input class="input" style="width:340px" placeholder="Szukaj na Nexus Mods" data-q></div><button class="btn" data-upd>${icon('update')}Sprawdź aktualizacje</button>
      <span class="dim">${esc(nx.user ? nx.user.name : '')}${nx.user && nx.user.premium ? ' · Premium' : ' · konto darmowe: pobieranie przez przycisk na stronie Nexus'}${nx.nxmRegistered ? '' : ''}</span></div>
      ${!nx.user || !nx.user.premium ? `<div class="note" style="margin-bottom:12px">Na koncie darmowym Nexus wymaga kliknięcia „Mod Manager Download” na stronie moda. ${nx.nxmRegistered ? 'CodeManager jest ustawiony do obsługi tych linków – pobieranie zacznie się automatycznie.' : '<a href="#" data-nxm>Ustaw CodeManager jako obsługę linków nxm://</a>, aby takie pobrania trafiały prosto tutaj.'}</div>` : ''}
      <div data-note></div><div class="results" data-res></div>`;
    const nxml = $('[data-nxm]', body); if (nxml) nxml.onclick = async e => { e.preventDefault(); await api('nexus:registerNxm'); toast('CodeManager obsługuje teraz linki nxm://'); getNexus(body, ctx, domain, await api('nexus:status')); };
    $('[data-upd]', body).onclick = async () => { const r = await api('nexus:updates', ctx.g.id); modal({ title: 'Aktualizacje z Nexus Mods', wide: true, body: renderIssues(r) }); };
    const res = $('[data-res]', body); const q = $('[data-q]', body);
    let timer;
    const run = async () => {
      res.innerHTML = '<div class="progress indet"><i></i></div>';
      let list; try { list = await App.apiQuiet('nexus:search', ctx.g.id, q.value.trim()); } catch (e) { res.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
      $('[data-note]', body).innerHTML = list.note ? `<p class="dim" style="font-size:12.5px">${esc(list.note)}</p>` : '';
      res.innerHTML = list.length ? '' : '<p class="muted">Brak wyników.</p>';
      for (const m of list) {
        const card = h(`<div class="mcard">${m.picture ? `<img src="${esc(m.picture)}" alt="" style="object-fit:cover">` : `<div class="mcard-ph">${esc((m.name || '?').slice(0, 1))}</div>`}<div class="mcard-b"><div class="mcard-t">${esc(m.name)} <span class="dim">· ${esc(m.author || '')} · v${esc(m.version || '?')}</span></div><div class="mcard-d">${esc(m.summary || '')}</div>
          <div class="mcard-m"><span>${icon('download')}${Intl.NumberFormat('pl-PL', { notation: 'compact' }).format(m.downloads || 0)}</span><span>♥ ${Intl.NumberFormat('pl-PL', { notation: 'compact' }).format(m.endorsements || 0)}</span></div></div>
          <div class="mcard-a"><button class="btn sm primary" data-i>${icon('download')}Pliki</button><button class="btn sm ghost" data-o>${icon('globe')}</button></div></div>`);
        $('[data-o]', card).onclick = () => api('shell:external', m.url);
        $('[data-i]', card).onclick = () => nexusFiles(ctx, m);
        res.appendChild(card);
      }
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 450); };
    run();
  }
  async function nexusFiles(ctx, m) {
    const files = await api('nexus:files', ctx.g.id, m.id);
    const body = h(`<div class="issues">${files.slice(0, 25).map(f => `<div class="issue info" style="grid-template-columns:1fr auto"><div><div class="t">${esc(f.name)} <span class="chip">${esc(f.category_name || '')}</span></div><div class="d">v${esc(f.version || '?')} · ${(f.size_kb / 1024).toFixed(1)} MB · ${new Date(f.uploaded_timestamp * 1000).toLocaleDateString('pl-PL')}</div></div><button class="btn sm primary" data-f="${f.file_id}">${icon('download')}Zainstaluj</button></div>`).join('') || '<p class="muted">Brak plików.</p>'}</div>`);
    const md = modal({ title: m.name, wide: true, body });
    body.onclick = async e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      md.close();
      const r = await App.runJob(`Instalacja: ${m.name}`, jobId => window.cm.call('nexus:install', jobId, ctx.g.id, ctx.profileId, m.id, +b.dataset.f), { doneMsg: x => x.needsBrowser ? 'Otwieram stronę Nexus – kliknij tam „Mod Manager Download”.' : `Zainstalowano ${x.name}.` });
      if (r && r.needsBrowser) api('shell:external', r.url);
      else if (r) delete App.state.reports[ctx.g.id];
    };
  }

  // ---------- importy ----------
  function importDialog() {
    modal({ title: 'Importuj paczkę modów', body: `<div class="quick">
      <button data-k="mrpack">${icon('archive')}<span>Paczka Modrinth (.mrpack)<small>Tworzy nową instancję Minecraft ze wszystkimi modami i ustawieniami</small></span></button>
      <button data-k="r2">${icon('import')}<span>Profil r2modman / Thunderstore<small>Kod udostępniania albo plik .r2z – Lethal Company, R.E.P.O., Content Warning</small></span></button></div>` });
    setTimeout(() => {
      $$('.modal [data-k]').forEach(b => b.onclick = async () => {
        $$('.modal-back').forEach(x => x.remove());
        if (b.dataset.k === 'mrpack') importMrpack();
        else {
          const games = App.state.defs.games.filter(g => g.checker === 'bepinex' && App.state.detected.games[g.id] && App.state.detected.games[g.id].found);
          if (!games.length) { toast('Nie wykryto żadnej gry z BepInEx', 'warn'); return; }
          const id = games.length === 1 ? games[0].id : await new Promise(res => modal({ title: 'Do której gry?', body: `<select class="input" data-g>${games.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>`, actions: [{ label: 'Anuluj', onClick: () => res(null) }, { label: 'Dalej', primary: true, onClick: ({ body }) => res($('[data-g]', body).value) }], onClose: () => res(null) }));
          if (id) importR2({ gameId: id, profileId: 'game' });
        }
      });
    }, 0);
  }
  async function importMrpack() {
    const f = (await api('dialog:files', 'Wybierz paczkę .mrpack', [{ name: 'Modrinth', extensions: ['mrpack', 'zip'] }]))[0];
    if (!f) return;
    const info = await api('import:mrpackInfo', f);
    modal({ title: `Import: ${info.name}`, body: `<dl class="meta-list"><dt>Wersja paczki</dt><dd>${esc(info.version || '-')}</dd><dt>Minecraft</dt><dd>${esc(info.mcVersion)}</dd><dt>Loader</dt><dd>${esc(info.loader)} ${esc(info.loaderVersion || '')}</dd><dt>Pliki</dt><dd>${info.files}</dd></dl>
      <label class="check" style="margin-top:14px"><input type="checkbox" data-loader checked><span>Zainstaluj też loader (${esc(info.loader)}) jako profil oficjalnego launchera</span></label>`,
      actions: [{ label: 'Anuluj' }, { label: 'Importuj', primary: true, onClick: async ({ body }) => {
        const withLoader = $('[data-loader]', body).checked;
        setTimeout(async () => {
          const r = await App.runJob(`Import paczki ${info.name}`, jobId => window.cm.call('import:mrpack', jobId, f, null, { installLoader: withLoader }), { doneMsg: x => `Utworzono instancję w ${x.dir}` });
          if (r) { App.state.detected = await api('games:detected'); App.go('games', { id: 'minecraft', profile: r.instanceId }); }
        }, 0);
      } }] });
  }
  async function importR2(target) {
    const body = h(`<div><div class="field"><label>Kod profilu r2modman</label><input class="input mono" placeholder="np. 018f2c1a-…" data-code></div><p class="muted" style="text-align:center;margin:4px 0 10px">albo</p><button class="btn" data-file>${icon('file')}Wybierz plik .r2z</button><span class="path" data-fname style="margin-left:8px"></span>
      <div class="note warn" style="margin-top:14px">Mody zostaną zainstalowane do ${target.serverId ? 'folderu serwera' : 'folderu gry'}. Istniejące paczki w innych wersjach trafią do kopii zapasowej.</div></div>`);
    let file = null;
    $('[data-file]', body).onclick = async () => { file = (await api('dialog:files', 'Plik eksportu r2modman', [{ name: 'r2modman', extensions: ['r2z'] }]))[0] || null; $('[data-fname]', body).textContent = file || ''; };
    modal({ title: 'Importuj profil r2modman', body, actions: [{ label: 'Anuluj' }, { label: 'Importuj', primary: true, onClick: () => {
      const src = file || $('[data-code]', body).value.trim(); if (!src) { toast('Podaj kod lub plik', 'warn'); return false; }
      setTimeout(async () => { const r = await App.runJob('Import profilu r2modman', jobId => window.cm.call('import:r2', jobId, target, src), { doneMsg: x => `Profil „${x.name}”: zainstalowano ${x.installed} z ${x.total} paczek.` }); if (r && target.gameId) delete App.state.reports[target.gameId]; }, 0);
    } }] });
  }
  App.importR2 = importR2;

  App.views.games = {
    crumb: p => p.id ? `Znalezione gry / <b>${esc(gameDef(p.id).name)}</b>` : '<b>Znalezione gry</b>',
    render(el, params) { if (params.id) renderDetail(el, params); else renderList(el); },
  };
})();
