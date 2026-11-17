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
      try { App.state.detected = await api('games:detect'); toast('Wykrywanie zakończone'); App.loadIcons(); } finally { App.renderRail(); renderList(el); }
    };
    $('[data-addmc]', el).onclick = addMcInstance;
    $('[data-import]', el).onclick = importDialog;
    const body = $('[data-body]', el);
    if (!det) { body.innerHTML = '<div class="panel"><p class="muted">Przeszukuję biblioteki Steam i dyski…</p><div class="progress indet"><i></i></div></div>'; return; }
    const found = App.state.defs.games.filter(g => det.games[g.id] && det.games[g.id].found);
    const missing = App.state.defs.games.filter(g => !det.games[g.id] || !det.games[g.id].found);
    if (det.steam && det.steam.libraries.length) body.appendChild(h(`<p class="dim" style="margin:-6px 0 6px;font-size:12px">Biblioteki Steam: ${det.steam.libraries.map(esc).join(', ')}</p>`));
    else body.appendChild(h(`<div class="note warn" style="margin-bottom:16px">Nie znaleziono Steama. Jeśli jest zainstalowany w nietypowym miejscu, wskaż go w Ustawieniach.</div>`));
    body.appendChild(h(`<p class="dim" style="margin:0 0 12px;font-size:12px"><span class="star">★</span> najlepsza zgodność – pełne sprawdzanie zależności, wersji i konfliktów. Gry oznaczone „Instalacja ręczna” obsługują instalowanie i włączanie modów, ale bez sprawdzania zgodności.</p>`));
    const grid = h('<div class="grid games"></div>');
    for (const g of found) grid.appendChild(card(g, det.games[g.id]));
    body.appendChild(grid);
    if (missing.length) {
      body.appendChild(h(`<div class="section-title"><h2>Nie znaleziono</h2><span class="dim">${missing.length} gier – wskaż folder, jeśli masz je zainstalowane</span></div>`));
      const g2 = h('<div class="grid games"></div>');
      for (const g of missing) g2.appendChild(card(g, null));
      body.appendChild(g2);
    }
    const uns = App.state.defs.unsupported || [];
    if (uns.length) body.appendChild(h(`<div class="panel" style="margin-top:28px"><h3>Pominięte z mod managera</h3><p class="muted" style="margin:6px 0 10px;font-size:13px">Te gry nie mają danych, na podstawie których da się rzetelnie sprawdzić zgodność modów:</p>${uns.map(u => `<p style="margin:4px 0;font-size:13px"><b>${esc(u.name)}</b> <span class="muted">– ${esc(u.reason)}</span></p>`).join('')}</div>`));
  }

  function card(g, info) {
    const rep = App.state.reports[g.id];
    if (!info) {
      const c = h(`<div class="gcard missing"><div class="top">${gameBadge(g)}<div><div class="name">${esc(g.name)} ${App.compatMark(g)}</div><div class="src">Nie wykryto${g.compat === 'none' ? ' · instalacja ręczna' : ''}</div></div></div>
        <div class="actions"><button class="btn sm">${icon('folder')}Wskaż folder</button></div></div>`);
      $('button', c).onclick = e => { e.stopPropagation(); changePath(g.id); };
      if (g.id === 'minecraft') $('button', c).onclick = e => { e.stopPropagation(); addMcInstance(); };
      return c;
    }
    const sub = g.id === 'minecraft' ? `${info.instances.length} ${info.instances.length === 1 ? 'instancja' : 'instancji'}` : info.source;
    const c = h(`<div class="gcard" tabindex="0" role="button">
      <div class="top">${gameBadge(g)}<div style="min-width:0"><div class="name">${esc(g.name)} ${App.compatMark(g)}</div><div class="src">${esc(sub)}</div></div></div>
      ${g.compat === 'none' ? '<span class="chip">Instalacja ręczna</span>' : ''}
      <div class="path">${esc(info.path || '')}</div>
      ${info.warning ? `<div class="chip warn" title="${esc(info.warning)}">${icon('alert')}Sprawdź lokalizację</div>` : ''}
      ${App.mt.playLine(g.id) ? `<div class="playtime">${icon('clock')}${App.mt.playLine(g.id)}</div>` : ''}
      ${rep ? `${healthBar(rep.mods)}<div class="health-legend"><span>${rep.mods.length} modów</span>${rep.counts.error ? `<span class="e">${App.plural(rep.counts.error, 'błąd', 'błędy', 'błędów')}</span>` : ''}${rep.counts.warn ? `<span class="w">${App.plural(rep.counts.warn, 'ostrzeżenie', 'ostrzeżenia', 'ostrzeżeń')}</span>` : ''}${!rep.counts.error && !rep.counts.warn ? '<span class="o">Wszystko gra</span>' : ''}</div>` : ''}
      <div class="actions">
        ${g.compat === 'none' ? `<button class="btn sm primary" data-a="mods">${icon('puzzle')}Mody</button>` : `<button class="btn sm primary" data-a="check">${icon('shield')}${rep ? 'Sprawdź ponownie' : 'Sprawdź zgodność'}</button>`}
        <button class="btn sm icon" data-a="play" title="Uruchom grę">${icon('play')}</button>
        ${g.id !== 'minecraft' ? `<button class="btn sm icon" data-a="path" title="Zmień lokalizację">${icon('edit')}</button>` : ''}
        <button class="btn sm icon" data-a="open" title="Otwórz folder">${icon('folder')}</button>
      </div></div>`);
    c.onclick = e => {
      const a = e.target.closest('[data-a]');
      if (!a) return App.go('games', { id: g.id });
      e.stopPropagation();
      if (a.dataset.a === 'check') App.go('games', { id: g.id, tab: 'compat', run: true });
      if (a.dataset.a === 'mods') App.go('games', { id: g.id, tab: 'mods' });
      if (a.dataset.a === 'path') changePath(g.id);
      if (a.dataset.a === 'play') App.mt.launch(g);
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
    if (g.compat === 'none' && tab === 'compat') tab = 'mods';
    el.innerHTML = `
      <button class="back" data-back>${icon('back')}Znalezione gry</button>
      <div class="detail-hero">${gameBadge(g)}<div style="flex:1;min-width:0"><h1>${esc(g.name)} ${App.compatMark(g)}</h1><p class="lead" style="margin-top:2px">${esc(g.desc)}</p>${App.mt.playLine(g.id) ? `<div class="playtime">${icon('clock')}${App.mt.playLine(g.id)}</div>` : ''}</div><button class="btn primary" data-play>${icon('play')}Uruchom</button>${App.state.icons && App.state.icons.games[g.id] && App.state.icons.games[g.id].header ? `<img class="cover" src="${esc(App.state.icons.games[g.id].header)}" alt="">` : ''}</div>
      ${profiles.length > 1 || g.id === 'minecraft' ? `<div class="profile-bar"><label class="muted" for="prof">${g.id === 'minecraft' ? 'Instancja' : 'Profil'}</label><select class="input" id="prof">${profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.mcVersion ? ` – ${esc(p.mcVersion)} ${esc(p.loader || '')}` : ''}</option>`).join('')}</select><span class="path" data-ppath></span></div>` : ''}
      <div class="tabs" role="tablist">
        <button data-tab="mods">Mody</button>${g.compat === 'none' ? '' : '<button data-tab="compat">Zgodność</button>'}<button data-tab="conflicts">Konflikty</button>${['bethesda', 'rimworld'].includes(g.checker) ? '<button data-tab="order">Kolejność ładowania</button>' : ''}<button data-tab="get">Pobierz mody</button>
        ${(g.loaders && g.loaders.length) ? '<button data-tab="loader">Modloader</button>' : ''}
        ${g.id === 'minecraft' ? '<button data-tab="packs">Zasoby i shadery</button>' : ''}<button data-tab="saves">Zapisy gry</button><button data-tab="snaps">Migawki</button>
        <button data-tab="settings">Ustawienia</button>
      </div>
      <div data-content></div>`;
    $('[data-back]', el).onclick = () => App.go('games');
    $('[data-play]', el).onclick = () => App.mt.launch(g, profileId);
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
      if (tab === 'conflicts') App.mt.conflictsTab(content, ctx);
      if (tab === 'order') App.mt.loadOrderTab(content, ctx);
      if (tab === 'saves') App.mt.savesTab(content, ctx);
      if (tab === 'snaps') App.mt.snapshotsTab(content, ctx);
      if (tab === 'packs') App.mt.packsTab(content, ctx);
    };
    $$('.tabs button', el).forEach(b => b.onclick = () => { if (App.leaveGuard && !App.leaveGuard()) return; App.leaveGuard = null; tab = b.dataset.tab; show(); });
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
    const notes = await App.mt.loadNotes(ctx.g.id);
    let filter = ''; let tagFilter = '';
    let ws = {}; // dane z Warsztatu Steam: tytuł, opis, czy lokalna kopia jest nieaktualna
    c.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <div class="searchbox">${icon('search')}<input class="input" placeholder="Szukaj modu" data-q></div>
        <select class="input" style="width:auto" data-tagf><option value="">Wszystkie tagi</option>${notes.tags.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <span class="dim" style="flex:1;white-space:nowrap">${rep.mods.length} pozycji · ${rep.mods.filter(m => m.enabled).length} włączonych</span>
        <button class="btn" data-update>${icon('update')}Aktualizuj wszystko</button>
        <button class="btn" data-add>${icon('plus')}Dodaj mody</button>
        <button class="btn" data-open>${icon('folder')}Folder modów</button>
        ${ctx.g.compat === 'none' ? '' : `<button class="btn primary" data-check>${icon('shield')}Sprawdź zgodność</button>`}
      </div>
      ${ctx.g.compat === 'none' ? `<div class="note" style="margin-bottom:10px">Sprawdzanie zgodności jest wyłączone dla tej gry. Mody możesz instalować${App.state.defs.games.find(x => x.id === ctx.g.id).nexus ? ' z Nexus Mods (zakładka „Pobierz mody”),' : ''} z archiwum lub przeciągając pliki na listę, a także włączać i wyłączać je przełącznikiem.</div>` : ''}
      <div class="table-wrap" data-drop><table class="table"><thead><tr><th style="width:52px">Wł.</th><th>Nazwa</th><th>Wersja</th><th>Źródło</th><th>Stan</th><th style="width:156px"></th></tr></thead><tbody></tbody></table></div>
      <p class="dim" style="font-size:12.5px;margin-top:8px">Przeciągnij pliki modów na listę, aby je dodać do: <span class="path">${esc(target)}</span>. Mody z Warsztatu Steam włączasz i wyłączasz w grze.</p>`;
    const tbody = $('tbody', c);
    const again = () => { delete App.state.reports[ctx.g.id]; tabMods(c, ctx); };
    c.insertBefore(App.mt.toolsRow(ctx, rep, again), c.firstChild);
    c.insertBefore(profileBar(ctx, rep, again), c.firstChild);
    const deps = ctx.g.compat === 'none' ? null : App.mt.depsBanner(rep, ctx, again); if (deps) c.insertBefore(deps, c.firstChild);
    App.mt.bisectBanner(c, ctx, again).then(b => { if (b && c.isConnected) c.insertBefore(b, c.firstChild); });
    if (ctx.g.compat === 'none' && !App.state.defs.games.find(x => x.id === ctx.g.id).nexus) $('[data-update]', c).remove();
    else $('[data-update]', c).onclick = () => updateAll(ctx, () => { delete App.state.reports[ctx.g.id]; tabMods(c, ctx); });
    const draw = () => {
      tbody.innerHTML = '';
      const list = rep.mods.filter(m => (!filter || (m.name + ' ' + (m.id || '') + ' ' + (m.key || '') + ' ' + ((notes.notes[App.mt.noteKey(m)] || {}).note || '')).toLowerCase().includes(filter)) && (!tagFilter || ((notes.notes[App.mt.noteKey(m)] || {}).tags || []).includes(tagFilter)));
      if (!list.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty" style="padding:30px"><h2>${rep.mods.length ? 'Brak wyników' : 'Brak modów'}</h2><p>${rep.mods.length ? 'Zmień wyszukiwaną frazę.' : 'Dodaj mody przyciskiem powyżej lub przeciągnij pliki tutaj.'}</p></div></td></tr>`; return; }
      for (const m of list) {
        const st = ctx.g.compat === 'none' ? (m.enabled ? ['', 'Włączony'] : ['', 'Wyłączony']) : ({ ok: ['ok', 'Zgodny'], warn: ['warn', 'Ostrzeżenie'], error: ['error', 'Błąd'], disabled: ['', 'Wyłączony'] }[m.status] || ['', '-']);
        const tr = h(`<tr class="${m.enabled ? '' : 'off'}">
          <td>${m.toggleable ? `<label class="switch" title="${m.enabled ? 'Wyłącz' : 'Włącz'}"><input type="checkbox" ${m.enabled ? 'checked' : ''}><span></span></label>` : `<label class="switch" title="Zarządzane przez grę lub Steam"><input type="checkbox" ${m.enabled ? 'checked' : ''} disabled><span></span></label>`}</td>
          <td><div class="nm">${esc(m.name)} ${ws[m.workshopId] && ws[m.workshopId].outdated ? '<span class="chip warn" title="Na Warsztacie jest nowsza wersja niż na dysku. Steam zaktualizuje subskrybowany mod przy następnym uruchomieniu, kopię z „Pobierz” pobierz ponownie.">nieaktualny</span> ' : ''}${App.mt.tagChips(notes.notes[App.mt.noteKey(m)])}${(notes.notes[App.mt.noteKey(m)] || {}).lock ? `<span class="tag lock" title="Wersja zablokowana – pomijany przy „Aktualizuj wszystko”">${icon('key')}zablokowany</span>` : ''}</div>${m.id && m.id !== m.name ? `<div class="sub">${esc(m.id)}</div>` : ''}${ws[m.workshopId] && ws[m.workshopId].title !== m.name ? `<div class="sub">Warsztat: ${esc(ws[m.workshopId].title)}</div>` : ''}</td>
          <td class="mono">${esc(m.version || '-')}</td>
          <td><span class="sub">${esc(m.loader ? m.loader + ' · ' : '')}${esc(m.source || '')}${m.size ? ' · ' + fmtSize(m.size) : ''}</span></td>
          <td><span class="chip ${st[0]}">${st[1]}</span></td>
          <td style="text-align:right"><button class="btn sm ghost icon ${(notes.notes[App.mt.noteKey(m)] || {}).lock ? 'on' : ''}" data-a="lock" title="${(notes.notes[App.mt.noteKey(m)] || {}).lock ? 'Odblokuj aktualizacje' : 'Zablokuj wersję (nie aktualizuj)'}">${icon('key')}</button><button class="btn sm ghost icon" data-a="note" title="Notatka i tagi">${icon('edit')}</button>${m.workshopId ? `<button class="btn sm ghost icon" data-a="ws" title="Strona w Warsztacie Steam">${icon('globe')}</button>` : ''}${m.file ? `<button class="btn sm ghost icon" data-a="show" title="Pokaż w folderze">${icon('folder')}</button>` : ''}${m.toggleable ? `<button class="btn sm ghost icon danger" data-a="del" title="Przenieś do kosza">${icon('trash')}</button>` : ''}</td></tr>`);
        const sw = $('input', tr);
        if (m.toggleable) sw.onchange = async () => { try { await api('mods:toggle', m, ctx.g.id); delete App.state.reports[ctx.g.id]; tabMods(c, ctx); } catch { sw.checked = !sw.checked; } };
        tr.onclick = async e => {
          const a = e.target.closest('[data-a]'); if (!a) return;
          if (a.dataset.a === 'show') api('shell:show', m.file);
          if (a.dataset.a === 'ws') api('shell:external', `https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}`);
          if (a.dataset.a === 'note') App.mt.editNote(ctx.g.id, m, notes, draw);
          if (a.dataset.a === 'lock') { const k = App.mt.noteKey(m); const on = !(notes.notes[k] || {}).lock; await api('notes:lock', ctx.g.id, m, on); notes.notes[k] = { ...(notes.notes[k] || { tags: [], note: '' }), lock: on || undefined }; toast(on ? `${m.name}: wersja zablokowana` : `${m.name}: aktualizacje odblokowane`); draw(); }
          if (a.dataset.a === 'del' && await App.confirmBox('Usunąć mod?', `<b>${esc(m.name)}</b> trafi do kosza ${App.state.settings.programTrash === false ? 'systemowego' : 'CodeManager – przywrócisz go przez 30 dni (Narzędzia → Kosz)'}.`, 'Przenieś do kosza', true)) { await api('mods:remove', m.file, ctx.g.id, m.name); delete App.state.reports[ctx.g.id]; tabMods(c, ctx); }
        };
        // wiersz klikalny → pokaż problemy moda
        tr.ondblclick = () => {
          const iss = rep.issues.filter(i => i.mod === m.key || i.mod === m.name);
          const w = ws[m.workshopId];
          const mb = h(`<div>${w ? `<div class="ws-info">${w.preview ? `<img src="${esc(w.preview)}" alt="">` : ''}<div><div class="t">${esc(w.title)}${w.outdated ? ' <span class="chip warn">nieaktualny</span>' : ''}</div><div class="d">${esc((w.description || '').slice(0, 600))}</div><div class="sub">Warsztat #${esc(m.workshopId)} · ${fmtN(w.subscriptions)} subskrypcji · aktualizacja ${w.updated ? new Date(w.updated).toLocaleDateString('pl-PL') : '?'}</div></div></div>` : ''}<div data-iss></div><div class="row" style="margin-top:12px"><button class="btn sm" data-aim>${icon('bulb')}Co robi ten mod? (AI)</button></div><div data-ai style="margin-top:10px"></div></div>`);
          $('[data-iss]', mb).appendChild(iss.length ? renderIssues(iss) : h('<p class="muted">Brak problemów dla tego moda.</p>'));
          $('[data-aim]', mb).onclick = () => App.mt.aiPanel($('[data-ai]', mb), { title: m.name, ask: history => window.cm.call('ai:explainMod', ctx.g.id, { name: w ? w.title : m.name, id: m.id || m.workshopId, version: m.version, description: w ? w.description : '' }, history) });
          modal({ title: m.name, wide: true, body: mb });
        };
        tbody.appendChild(tr);
      }
    };
    draw();
    const wsItems = rep.mods.filter(m => m.workshopId).map(m => ({ id: m.workshopId, file: m.file }));
    if (wsItems.length) App.apiQuiet('workshop:local', wsItems).then(r => { ws = r || {}; if (c.isConnected) draw(); }).catch(() => {});
    $('[data-q]', c).oninput = e => { filter = e.target.value.toLowerCase(); draw(); };
    $('[data-tagf]', c).onchange = e => { tagFilter = e.target.value; draw(); };
    $('[data-open]', c).onclick = async () => { await api('fs:mkdir', target); api('shell:open', target); };
    if ($('[data-check]', c)) $('[data-check]', c).onclick = () => { delete App.state.reports[ctx.g.id]; App.go('games', { id: ctx.g.id, tab: 'compat', profile: ctx.profileId, run: true }); };
    const addFiles = async files => { if (!files.length) return;
      const archives = files.filter(f => /\.(zip|7z|rar)$/i.test(f) && !['minecraft', 'factorio'].includes(ctx.g.id));
      if (archives.length) { if (!(await App.mt.archiveWarn(ctx.g.id, archives))) return; await api('nexus:installLocal', ctx.g.id, ctx.profileId, archives); files = files.filter(f => !archives.includes(f)); }
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
          <button class="btn" data-aimods title="Ocena zestawu modów przez sztuczną inteligencję (Twój klucz API)">${icon('bulb')}Zapytaj AI</button>
          <button class="btn primary" data-run>${icon('refresh')}Sprawdź ponownie</button>
        </div>
        <div data-aislot></div>
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
      $('[data-aimods]', c).onclick = () => App.mt.aiPanel($('[data-aislot]', c), { title: 'Ocena modów przez AI', ask: history => window.cm.call('ai:explainMods', { gameId: ctx.g.id, profileId: ctx.profileId }, history) });
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
      <h2 style="margin-bottom:12px">Uruchamianie</h2>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 12px">
        <div class="field"><label>Sposób uruchamiania</label><select class="input" data-l="launchMethod"><option value="auto">Automatycznie</option><option value="steam" ${gs.launchMethod === 'steam' ? 'selected' : ''}>Przez Steam</option><option value="exe" ${gs.launchMethod === 'exe' ? 'selected' : ''}>Bezpośrednio (plik .exe)</option></select></div>
        <div class="field"><label>Profil modów przed uruchomieniem</label><select class="input" data-l="launchProfile" data-lprof><option value="">— nie zmieniaj —</option></select></div>
      </div>
      <div class="field"><label>Parametry uruchamiania</label><input class="input mono" data-l="launchArgs" value="${esc(gs.launchArgs || '')}" placeholder="np. -windowed -skipintro"><span class="hint">Przekazywane do gry (przez Steam lub bezpośrednio do pliku .exe).</span></div>
      ${['skyrimse', 'fallout4'].includes(g.id) ? `<label class="check" style="margin-bottom:12px"><input type="checkbox" data-l="useLoader" ${gs.useLoader !== false ? 'checked' : ''}><span>Uruchamiaj przez ${g.id === 'skyrimse' ? 'skse64_loader.exe' : 'f4se_loader.exe'}, jeśli jest zainstalowany</span></label>` : ''}
      <div class="row" style="margin-bottom:22px"><button class="btn primary" data-savel>${icon('save')}Zapisz ustawienia uruchamiania</button><button class="btn" data-playnow>${icon('play')}Uruchom teraz</button></div>
      ${VERSION_HINT[g.id] ? `<h2 style="margin-bottom:12px">Wersja gry</h2><div class="field"><label>Ręczna wersja (opcjonalnie)</label><div class="inline-input"><input class="input" data-ver value="${esc(gs.gameVersion || '')}" placeholder="automatycznie"><button class="btn primary" data-savever>Zapisz</button></div><span class="hint">${esc(VERSION_HINT[g.id])}</span></div>` : ''}
    </div>`);
    $('[data-change]', panel).onclick = () => changePath(g.id);
    api('profiles:list', g.id, ctx.profileId || 'game').then(d => { const s2 = $('[data-lprof]', panel); s2.innerHTML += d.profiles.map(p => `<option value="${p.id}" ${gs.launchProfile === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join(''); });
    $('[data-playnow]', panel).onclick = () => App.mt.launch(g, ctx.profileId);
    $('[data-savel]', panel).onclick = async () => {
      const patch = {}; $$('[data-l]', panel).forEach(i => { patch[i.dataset.l] = i.type === 'checkbox' ? i.checked : (i.value.trim() || undefined); });
      const saved = await api('games:settings', g.id, patch); App.state.gameConfig[g.id] = { ...(App.state.gameConfig[g.id] || {}), settings: saved }; toast('Zapisano ustawienia uruchamiania');
    };
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
      <button class="btn sm" data-apply disabled>Przełącz</button><button class="btn sm ghost" data-save title="Zapisz obecny zestaw jako nowy profil">${icon('plus')}Nowy z obecnych</button><button class="btn sm ghost" data-tagp title="Kolekcja z modów oznaczonych tagiem – zestaw liczy się od nowa przy każdym przełączeniu">${icon('profile')}Z tagu…</button><button class="btn sm ghost" data-upd disabled title="Nadpisz wybrany profil obecnym zestawem">${icon('save')}Zapisz</button><button class="btn sm ghost icon danger" data-del disabled title="Usuń profil">${icon('trash')}</button></div>`);
    const sel = $('[data-p]', bar);
    const load = async () => {
      const d = await api('profiles:list', ctx.g.id, scope);
      sel.innerHTML = '<option value="">— bieżący zestaw —</option>' + d.profiles.map(p => `<option value="${p.id}" ${d.active === p.id ? 'selected' : ''}>${esc(p.name)} ${p.tag ? `(kolekcja z tagu „${esc(p.tag)}”)` : `(${p.enabled.length} modów)`}</option>`).join('');
      upd();
    };
    const upd = () => { const on = !!sel.value; ['apply', 'upd', 'del'].forEach(k => { $(`[data-${k}]`, bar).disabled = !on; }); };
    sel.onchange = upd;
    $('[data-save]', bar).onclick = async () => { const n = await App.promptBox('Nowy profil modów', 'Nazwa profilu (np. „Tylko optymalizacja”, „Pełna paczka”)'); if (!n) return; await api('profiles:create', ctx.g.id, scope, n, rep.mods); toast(`Zapisano profil „${n}”`); load(); };
    $('[data-tagp]', bar).onclick = async () => {
      const nd = await App.mt.loadNotes(ctx.g.id);
      const used = [...new Set(Object.values(nd.notes).flatMap(n => n.tags || []))];
      if (!used.length) { toast('Najpierw oznacz mody tagami (przycisk ołówka przy modzie).', 'warn'); return; }
      const body = App.h(`<div><div class="field"><label>Tag</label><select class="input" data-t>${used.map(t => `<option>${esc(t)}</option>`).join('')}</select></div><div class="field"><label>Nazwa kolekcji</label><input class="input" data-n placeholder="np. Tylko klient"></div><p class="dim" style="font-size:12.5px;margin:0">Po przełączeniu włączone będą tylko mody z tym tagiem. Gdy dodasz tag kolejnym modom, kolekcja uwzględni je automatycznie.</p></div>`);
      modal({ title: 'Kolekcja z tagu', body, actions: [{ label: 'Anuluj' }, { label: 'Utwórz', primary: true, onClick: async ({ body: b }) => { const t = $('[data-t]', b).value; await api('profiles:fromTag', ctx.g.id, scope, t, $('[data-n]', b).value.trim() || `Tag: ${t}`); toast('Utworzono kolekcję'); load(); } }] });
    };
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
    if (g.workshop) parts.push('workshop');
    if (!parts.length) {
      c.innerHTML = `<div class="empty"><h2>Brak serwisu z modami dla tej gry</h2><p>${g.id === 'factorio' ? 'Mody Factorio pobierzesz w grze (menu Mody). CodeManager zaktualizuje je przyciskiem „Aktualizuj wszystko”.' : 'Dla tej gry nie ma serwisu z modami, z którego CodeManager mógłby pobierać.'}</p></div>`;
      return;
    }
    let src = parts[0];
    c.innerHTML = `<div class="row" style="margin-bottom:14px"><div class="seg">${parts.map(p => `<button data-src="${p}">${{ modrinth: 'Modrinth', thunderstore: 'Thunderstore', nexus: 'Nexus Mods', workshop: 'Warsztat Steam' }[p]}</button>`).join('')}</div><span style="flex:1"></span>${domain ? `<button class="btn sm" data-local>${icon('archive')}Zainstaluj z archiwum…</button>` : ''}</div><div data-body></div>`;
    const body = $('[data-body]', c);
    const local = $('[data-local]', c);
    if (local) local.onclick = async () => { const f = await api('dialog:files', 'Wybierz archiwa modów (.zip, .7z)', [{ name: 'Archiwa', extensions: ['zip', '7z', 'rar'] }]); if (!f.length) return; if (!(await App.mt.archiveWarn(g.id, f))) return; const r = await api('nexus:installLocal', g.id, ctx.profileId, f); toast(`Zainstalowano (${r.length} elementów)`); delete App.state.reports[g.id]; };
    const show = () => {
      $$('[data-src]', c).forEach(b => b.classList.toggle('active', b.dataset.src === src));
      if (src === 'modrinth') getModrinth(body, ctx, { gameId: g.id, profileId: ctx.profileId }, { mcVersion: ctx.prof && ctx.prof.mcVersion, loader: ctx.prof && ctx.prof.loader });
      if (src === 'thunderstore') getThunderstore(body, ctx, { gameId: g.id, profileId: ctx.profileId });
      if (src === 'nexus') getNexus(body, ctx, domain, nx);
      if (src === 'workshop') getWorkshop(body, ctx);
    };
    $$('[data-src]', c).forEach(b => b.onclick = () => { src = b.dataset.src; show(); });
    show();
  }

  // ---------- wspólne: przełącznik stron i karta ----------
  const fmtN = n => Intl.NumberFormat('pl-PL', { notation: 'compact' }).format(n || 0);
  function pager(box, { page, total, perPage, onPage }) {
    const pages = Math.max(1, Math.ceil((total || 0) / perPage));
    box.innerHTML = pages <= 1 ? '' : `<div class="pager"><button class="btn sm" data-p="prev" ${page <= 1 ? 'disabled' : ''}>${icon('back')}Poprzednia</button><span class="dim">Strona ${page} z ${pages.toLocaleString('pl-PL')} · ${(total || 0).toLocaleString('pl-PL')} wyników</span><button class="btn sm" data-p="next" ${page >= pages ? 'disabled' : ''}>Następna${icon('chevron')}</button></div>`;
    box.onclick = e => { const b = e.target.closest('[data-p]'); if (!b || b.disabled) return; onPage(b.dataset.p === 'prev' ? page - 1 : page + 1); };
  }
  App.pager = pager;
  // okno ze stroną moda: obrazek, opis, statystyki i przyciski
  function modPage({ title, image, gallery = [], meta = [], text, md, actions = [], url }) {
    const body = h(`<div class="modpage">${image || gallery.length ? `<div class="mp-gallery">${[image, ...gallery].filter(Boolean).slice(0, 5).map(u => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''}
      ${meta.length ? `<div class="mp-meta">${meta.map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join('')}</div>` : ''}
      <div class="mp-text ai-msg">${md ? App.mt.md(md) : `<p>${esc(text || '').replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`}</div></div>`);
    return modal({ title, wide: true, body, actions: [...actions, ...(url ? [{ label: 'Otwórz w przeglądarce', icon: 'globe', onClick: () => { api('shell:external', url); return false; } }] : []), { label: 'Zamknij' }] });
  }

  async function installModrinth(target, id, title, channel) {
    if (!channel && !(await App.mt.modrinthWarn(target, id, title))) return;
    const r2 = await App.runJob(`Instalacja: ${title}`, jobId => (channel ? channel(jobId, id) : window.cm.call('modrinth:install', jobId, target, id)), { doneMsg: x => `Zainstalowano ${x.length} plik(ów)${channel ? '' : ' (z zależnościami)'}.` });
    if (r2) { delete App.state.reports[target.gameId]; }
    return r2;
  }
  App.installModrinth = installModrinth;
  function getModrinth(body, ctx, target, opts) {
    const type = opts.type || 'mod';
    const PER = 20; let page = 1;
    body.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="searchbox">${icon('search')}<input class="input" style="width:340px" placeholder="${type === 'shader' ? 'Szukaj shaderów na Modrinth' : type === 'resourcepack' ? 'Szukaj paczek zasobów na Modrinth' : 'Szukaj na Modrinth (np. sodium, create, worldedit)'}" data-q></div>
      <select class="input" style="width:auto" data-sort><option value="relevance">Trafność</option><option value="downloads">Pobrania</option><option value="follows">Obserwujący</option><option value="updated">Ostatnio aktualizowane</option><option value="newest">Najnowsze</option></select>
      <span class="dim">Filtr: ${esc(opts.loader || 'dowolny loader')} · ${esc(opts.mcVersion || 'dowolna wersja')}</span></div><div class="results" data-res></div><div data-pager></div>`;
    const res = $('[data-res]', body); const q = $('[data-q]', body); const sort = $('[data-sort]', body);
    let timer;
    const run = async () => {
      res.innerHTML = '<div class="progress indet"><i></i></div>';
      let r; try { r = await App.apiQuiet('modrinth:search', q.value.trim(), { mcVersion: opts.mcVersion, loader: opts.loader, type, sort: sort.value, limit: PER, offset: (page - 1) * PER }); } catch (e) { res.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
      res.innerHTML = r.hits.length ? '' : '<p class="muted">Brak wyników dla tej wersji i loadera.</p>';
      if (!q.value.trim() && page === 1 && (type === 'mod' || type === 'plugin')) App.mt.recommendBox(res, target, id => installModrinth(target, id, id));
      for (const m of r.hits) {
        const card = h(`<div class="mcard">${m.icon ? `<img src="${esc(m.icon)}" alt="">` : `<div class="mcard-ph">${esc(m.title.slice(0, 1))}</div>`}<div class="mcard-b"><div class="mcard-t"><a href="#" data-d>${esc(m.title)}</a> <span class="dim">· ${esc(m.author)}</span></div><div class="mcard-d">${esc(m.description)}</div>
          <div class="mcard-m"><span>${App.icon('download')}${fmtN(m.downloads)}</span>${m.client === 'required' && m.server === 'unsupported' ? '<span class="chip">tylko klient</span>' : ''}${m.server === 'required' && m.client === 'unsupported' ? '<span class="chip">tylko serwer</span>' : ''}</div></div>
          <div class="mcard-a"><button class="btn sm primary" data-i>${icon('download')}Zainstaluj</button><button class="btn sm ghost" data-o title="Otwórz stronę">${icon('globe')}</button></div></div>`);
        $('[data-o]', card).onclick = () => api('shell:external', m.url);
        $('[data-i]', card).onclick = () => installModrinth(target, m.id, m.title, opts.installCh);
        $('[data-d]', card).onclick = async e => {
          e.preventDefault();
          try {
            const pg = await App.apiQuiet('modrinth:page', m.id);
            const md = modPage({ title: pg.title, image: pg.icon, gallery: pg.gallery, meta: [['Pobrania', fmtN(pg.downloads)], ['Obserwujący', fmtN(pg.followers)], ['Aktualizacja', new Date(pg.updated).toLocaleDateString('pl-PL')]], md: pg.body || pg.description, url: pg.url,
              actions: [{ label: 'Zainstaluj', primary: true, icon: 'download', onClick: () => { setTimeout(() => installModrinth(target, m.id, m.title, opts.installCh), 0); } }] });
            return md;
          } catch (err) { toast(err.message, 'warn'); }
        };
        res.appendChild(card);
      }
      pager($('[data-pager]', body), { page, total: r.total, perPage: PER, onPage: p => { page = p; run(); body.scrollIntoView({ block: 'start' }); } });
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; run(); }, 350); };
    sort.onchange = () => { page = 1; run(); };
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

  // ---------- Nexus Mods: przeglądanie ze stronami (także bez klucza), strona moda, pliki ----------
  function getNexus(body, ctx, domain, nx) {
    const PER = 20; let page = 1;
    const premium = nx.user && nx.user.premium;
    body.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="searchbox">${icon('search')}<input class="input" style="width:340px" placeholder="Szukaj na Nexus Mods" data-q></div>
      <select class="input" style="width:auto" data-sort><option value="endorsements">Najwięcej polubień</option><option value="downloads">Najwięcej pobrań</option><option value="updated">Ostatnio aktualizowane</option><option value="newest">Najnowsze</option></select>
      ${nx.connected ? `<button class="btn" data-upd>${icon('update')}Sprawdź aktualizacje</button>` : ''}<span class="dim">${nx.connected ? `${esc(nx.user ? nx.user.name : '')}${premium ? ' · Premium' : ' · konto darmowe'}` : ''}</span></div>
      ${!nx.connected ? `<div class="note" style="margin-bottom:12px">Przeglądasz bez konta. Do pobierania i podglądu plików połącz konto Nexus Mods: <div class="inline-input" style="margin-top:8px;max-width:520px"><input class="input mono" type="password" placeholder="Klucz API (nexusmods.com → Ustawienia konta → API Keys)" data-k><button class="btn primary" data-save>Połącz</button><button class="btn" data-open title="Strona z kluczami">${icon('globe')}</button></div></div>` : !premium ? `<div class="note" style="margin-bottom:12px">Na koncie darmowym Nexus wymaga kliknięcia „Mod Manager Download” na stronie moda. ${nx.nxmRegistered ? 'CodeManager obsługuje te linki – pobieranie zacznie się automatycznie.' : '<a href="#" data-nxm>Ustaw CodeManager jako obsługę linków nxm://</a>, aby pobrania trafiały prosto tutaj.'}</div>` : ''}
      <div data-note></div><div class="results" data-res></div><div data-pager></div>`;
    const sv = $('[data-save]', body); if (sv) sv.onclick = async () => { const u = await api('nexus:setKey', $('[data-k]', body).value); toast(`Połączono jako ${u.name}${u.premium ? ' (Premium)' : ''}`); getNexus(body, ctx, domain, await api('nexus:status')); };
    const op = $('[data-open]', body); if (op) op.onclick = () => api('shell:external', 'https://www.nexusmods.com/users/myaccount?tab=api');
    const nxml = $('[data-nxm]', body); if (nxml) nxml.onclick = async e => { e.preventDefault(); await api('nexus:registerNxm'); toast('CodeManager obsługuje teraz linki nxm://'); getNexus(body, ctx, domain, await api('nexus:status')); };
    const up = $('[data-upd]', body); if (up) up.onclick = async () => { const r = await api('nexus:updates', ctx.g.id); modal({ title: 'Aktualizacje z Nexus Mods', wide: true, body: renderIssues(r) }); };
    const res = $('[data-res]', body); const q = $('[data-q]', body); const sort = $('[data-sort]', body);
    let timer;
    const needKey = () => { toast('Połącz konto Nexus Mods (klucz API powyżej), aby pobierać mody.', 'warn', 6000); const k = $('[data-k]', body); if (k) k.focus(); };
    const run = async () => {
      res.innerHTML = '<div class="progress indet"><i></i></div>';
      let r; try { r = await App.apiQuiet('nexus:browse', ctx.g.id, { text: q.value.trim(), sort: sort.value, page, perPage: PER }); } catch (e) { res.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
      $('[data-note]', body).innerHTML = r.note ? `<p class="dim" style="font-size:12.5px">${esc(r.note)}</p>` : '';
      res.innerHTML = r.items.length ? '' : '<p class="muted">Brak wyników.</p>';
      for (const m of r.items) {
        const card = h(`<div class="mcard">${m.picture && !m.adult ? `<img src="${esc(m.picture)}" alt="" style="object-fit:cover">` : `<div class="mcard-ph">${esc((m.name || '?').slice(0, 1))}</div>`}<div class="mcard-b"><div class="mcard-t"><a href="#" data-d>${esc(m.name)}</a> <span class="dim">· ${esc(m.author || '')} · v${esc(m.version || '?')}</span>${m.adult ? ' <span class="chip warn">18+</span>' : ''}</div><div class="mcard-d">${esc(m.summary || '')}</div>
          <div class="mcard-m"><span>${icon('download')}${fmtN(m.downloads)}</span><span>♥ ${fmtN(m.endorsements)}</span>${m.updated ? `<span class="dim">${new Date(m.updated).toLocaleDateString('pl-PL')}</span>` : ''}</div></div>
          <div class="mcard-a"><button class="btn sm primary" data-i>${icon('download')}Pliki</button><button class="btn sm ghost" data-o title="Otwórz stronę">${icon('globe')}</button></div></div>`);
        $('[data-o]', card).onclick = () => api('shell:external', m.url);
        $('[data-i]', card).onclick = () => (nx.connected ? nexusFiles(ctx, m) : needKey());
        $('[data-d]', card).onclick = async e => {
          e.preventDefault();
          let pg = null; if (nx.connected) { try { pg = await App.apiQuiet('nexus:modPage', ctx.g.id, m.id); } catch { pg = null; } }
          modPage({ title: m.name, image: pg ? pg.picture : (m.adult ? null : m.picture), meta: [['Pobrania', fmtN((pg || m).downloads)], ['Polubienia', fmtN((pg || m).endorsements)], ['Wersja', (pg || m).version || '?'], ['Autor', (pg || m).author || '?']], text: pg ? pg.description : `${m.summary || ''}\n\nPełny opis zobaczysz po połączeniu konta Nexus Mods albo w przeglądarce.`, url: m.url,
            actions: [{ label: 'Pliki do pobrania', primary: true, icon: 'download', onClick: () => { setTimeout(() => (nx.connected ? nexusFiles(ctx, m) : needKey()), 0); } }] });
        };
        res.appendChild(card);
      }
      pager($('[data-pager]', body), { page, total: r.total, perPage: r.perPage || PER, onPage: p => { page = p; run(); body.scrollIntoView({ block: 'start' }); } });
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; run(); }, 450); };
    sort.onchange = () => { page = 1; run(); };
    run();
  }
  async function nexusFiles(ctx, m) {
    const files = await api('nexus:files', ctx.g.id, m.id);
    const body = h(`<div class="issues">${files.slice(0, 25).map(f => `<div class="issue info" style="grid-template-columns:1fr auto"><div><div class="t">${esc(f.name)} <span class="chip">${esc(f.category_name || '')}</span></div><div class="d">v${esc(f.version || '?')} · ${(f.size_kb / 1024).toFixed(1)} MB · ${new Date(f.uploaded_timestamp * 1000).toLocaleDateString('pl-PL')}</div></div><button class="btn sm primary" data-f="${f.file_id}">${icon('download')}Zainstaluj</button></div>`).join('') || '<p class="muted">Brak plików.</p>'}</div>`);
    const md = modal({ title: m.name, wide: true, body });
    body.onclick = async e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      if (!(await App.mt.nexusWarn(ctx.g.id, m.id, +b.dataset.f))) return;
      md.close();
      const r = await App.runJob(`Instalacja: ${m.name}`, jobId => window.cm.call('nexus:install', jobId, ctx.g.id, ctx.profileId, m.id, +b.dataset.f), { doneMsg: x => x.needsBrowser ? 'Otwieram stronę Nexus – kliknij tam „Mod Manager Download”.' : `Zainstalowano ${x.name}.` });
      if (r && r.needsBrowser) api('shell:external', r.url);
      else if (r) delete App.state.reports[ctx.g.id];
    };
  }

  // ---------- Warsztat Steam ----------
  async function getWorkshop(body, ctx) {
    const st = await api('workshop:status', ctx.g.id);
    const PER = 20; let page = 1;
    body.innerHTML = `<div class="row" style="margin-bottom:12px">${st.hasKey ? `<div class="searchbox">${icon('search')}<input class="input" style="width:300px" placeholder="Szukaj w Warsztacie" data-q></div><select class="input" style="width:auto" data-sort><option value="trend">Popularne (30 dni)</option><option value="top">Najwyżej oceniane</option><option value="subscriptions">Najwięcej subskrypcji</option><option value="updated">Ostatnio aktualizowane</option><option value="newest">Najnowsze</option></select>` : ''}
      <div class="inline-input" style="flex:1;min-width:280px;max-width:520px"><input class="input" placeholder="Link lub numer przedmiotu Warsztatu" data-link><button class="btn" data-go>${icon('search')}Pokaż</button></div></div>
      ${st.hasKey ? '' : `<div class="note" style="margin-bottom:12px">Wklej link do moda z Warsztatu, aby go pobrać lub zasubskrybować. Żeby przeglądać i wyszukiwać mody tutaj, dodaj darmowy klucz Steam Web API w <a href="#" data-wsset>Ustawieniach</a>.</div>`}
      <p class="dim" style="font-size:12.5px;margin:0 0 10px">„Subskrybuj w Steam” otwiera stronę w kliencie Steam. Steam pobierze mod, a CodeManager wykryje go i sprawdzi w zakładkach Mody i Zgodność. „Pobierz” używa SteamCMD bez logowania – działa tylko dla gier, które na to pozwalają.</p>
      <div class="results ws-grid" data-res></div><div data-pager></div>`;
    const res = $('[data-res]', body);
    const wss = $('[data-wsset]', body); if (wss) wss.onclick = e => { e.preventDefault(); App.go('settings', { section: 'workshop' }); };
    const card = it => {
      const el = h(`<div class="mcard">${it.preview ? `<img src="${esc(it.preview)}" alt="" style="object-fit:cover">` : `<div class="mcard-ph">${esc(it.title.slice(0, 1))}</div>`}<div class="mcard-b"><div class="mcard-t"><a href="#" data-d>${esc(it.title)}</a></div><div class="mcard-d">${esc((it.description || '').slice(0, 220))}</div>
        <div class="mcard-m"><span>${icon('download')}${fmtN(it.subscriptions)}</span>${it.size ? `<span class="dim">${App.fmtSize(it.size)}</span>` : ''}${it.updated ? `<span class="dim">${new Date(it.updated).toLocaleDateString('pl-PL')}</span>` : ''}</div></div>
        <div class="mcard-a"><button class="btn sm primary" data-sub>${icon('link')}Subskrybuj w Steam</button><button class="btn sm" data-dl>${icon('download')}Pobierz</button><button class="btn sm ghost" data-o title="Otwórz stronę">${icon('globe')}</button></div></div>`);
      $('[data-o]', el).onclick = () => api('shell:external', it.url);
      $('[data-sub]', el).onclick = async () => { await api('workshop:subscribe', it.id); toast('Otwieram Steam – kliknij „Subskrybuj”. Po pobraniu odśwież zakładkę Mody.'); };
      $('[data-dl]', el).onclick = async () => { const r = await App.runJob(`Warsztat: ${it.title}`, jobId => window.cm.call('workshop:download', jobId, ctx.g.id, ctx.profileId, it.id), { doneMsg: x => `Zainstalowano ${x.name}.` }); if (r) delete App.state.reports[ctx.g.id]; };
      $('[data-d]', el).onclick = e => { e.preventDefault(); modPage({ title: it.title, image: it.preview, meta: [['Subskrypcje', fmtN(it.subscriptions)], ['Rozmiar', App.fmtSize(it.size) || '?'], ['Aktualizacja', it.updated ? new Date(it.updated).toLocaleDateString('pl-PL') : '?']], text: it.description || '', url: it.url, actions: [{ label: 'Subskrybuj w Steam', primary: true, icon: 'link', onClick: () => { api('workshop:subscribe', it.id); return false; } }] }); };
      return el;
    };
    $('[data-go]', body).onclick = async () => {
      const v = $('[data-link]', body).value.trim(); if (!v) return;
      res.innerHTML = '<div class="progress indet"><i></i></div>'; $('[data-pager]', body).innerHTML = '';
      try { const it = await App.apiQuiet('workshop:item', v); res.innerHTML = ''; if (it.appid && st.appid && it.appid !== st.appid) res.appendChild(h('<div class="note warn" style="margin-bottom:8px">Ten przedmiot jest z Warsztatu innej gry.</div>')); res.appendChild(card(it)); }
      catch (e) { res.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
    };
    $('[data-link]', body).onkeydown = e => { if (e.key === 'Enter') $('[data-go]', body).click(); };
    if (!st.hasKey) return;
    const q = $('[data-q]', body); const sort = $('[data-sort]', body); let timer;
    const run = async () => {
      res.innerHTML = '<div class="progress indet"><i></i></div>';
      let r; try { r = await App.apiQuiet('workshop:search', ctx.g.id, { text: q.value.trim(), sort: sort.value, page, perPage: PER }); } catch (e) { res.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; return; }
      res.innerHTML = r.items.length ? '' : '<p class="muted">Brak wyników.</p>';
      r.items.forEach(it => res.appendChild(card(it)));
      pager($('[data-pager]', body), { page, total: r.total, perPage: PER, onPage: p => { page = p; run(); body.scrollIntoView({ block: 'start' }); } });
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; run(); }, 450); };
    sort.onchange = () => { page = 1; run(); };
    run();
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
