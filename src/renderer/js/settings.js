// Ustawienia
'use strict';
App.views = App.views || {};
App.views.settings = {
  async render(el) {
    const { $, $$, icon, esc, api, toast } = App;
    const s = App.state.settings;
    const info = await api('app:info');
    el.innerHTML = `<div class="head"><div class="grow"><h1>Ustawienia</h1></div></div>
      <div class="grid two" style="align-items:start">
        <div class="panel">
          <h2 style="margin-bottom:14px">Ścieżki</h2>
          <div class="field"><label>Folder Steam (opcjonalnie)</label><div class="inline-input"><input class="input mono" data-k="steamPath" value="${esc(s.steamPath || '')}" placeholder="wykrywany automatycznie"><button class="btn" data-b="steamPath">${icon('folder')}</button></div><span class="hint">Podaj, jeśli Steam jest w nietypowym miejscu.</span></div>
          <div class="field"><label>Domyślny folder serwerów</label><div class="inline-input"><input class="input mono" data-k="serversPath" value="${esc(s.serversPath || '')}" placeholder="~/CodeManager-Servers"><button class="btn" data-b="serversPath">${icon('folder')}</button></div></div>
          <div class="field"><label>Java (dla Minecrafta)</label><div class="inline-input"><input class="input mono" data-k="javaPath" value="${esc(s.javaPath || '')}" placeholder="wykrywana automatycznie"><button class="btn" data-java>${icon('search')}Znajdź</button></div><span class="hint" data-javares>MC 1.20.5+ wymaga Javy 21, 1.18–1.20.4 Javy 17.</span></div>
          <div class="field"><label>Folder nowych instancji Minecraft (import .mrpack)</label><div class="inline-input"><input class="input mono" data-k="instancesPath" value="${esc(s.instancesPath || '')}" placeholder="~/CodeManager-Instances"><button class="btn" data-b="instancesPath">${icon('folder')}</button></div></div>
          <button class="btn primary" data-save>${icon('save')}Zapisz</button>
          <h2 style="margin:26px 0 10px">Nexus Mods</h2>
          <div data-nexus></div>
        </div>
        <div class="panel">
          <h2 style="margin-bottom:14px">Edytor</h2>
          <div class="field"><label>Rozmiar czcionki</label><input class="input" type="number" data-k="editorFontSize" value="${esc(s.editorFontSize || 14)}" min="10" max="28"></div>
          <label class="check" style="margin-bottom:10px"><input type="checkbox" data-k="editorMinimap" ${s.editorMinimap !== false ? 'checked' : ''}><span>Minimapa</span></label>
          <label class="check" style="margin-bottom:10px"><input type="checkbox" data-k="editorWrap" ${s.editorWrap ? 'checked' : ''}><span>Zawijanie wierszy</span></label>
          <label class="check"><input type="checkbox" data-k="editorAutosave" ${s.editorAutosave ? 'checked' : ''}><span>Autozapis po 1 s bezczynności</span></label>
          <h2 style="margin:24px 0 10px">Aktualizacje programu</h2>
          <div data-upd></div>
          <h2 style="margin:24px 0 10px">O programie</h2>
          <dl class="meta-list"><dt>Wersja</dt><dd>${esc(info.version)}</dd><dt>Electron</dt><dd>${esc(info.electron)}</dd><dt>Dane aplikacji</dt><dd class="path">${esc(info.userData)}</dd></dl>
          <div class="row" style="margin-top:12px"><button class="btn" data-ud>${icon('folder')}Otwórz dane aplikacji</button></div>
          <p class="dim" style="font-size:12.5px;margin:14px 0 0">Kopie zapasowe plików nadpisanych przez instalatory trafiają do podfolderu <span class="mono">backups</span>.</p>
        </div>
      </div>`;
    $$('[data-b]', el).forEach(b => b.onclick = async () => { const p = await api('dialog:folder'); if (p) $(`[data-k="${b.dataset.b}"]`, el).value = p; });
    $('[data-ud]', el).onclick = () => api('shell:open', info.userData);
    $('[data-java]', el).onclick = async () => {
      const r = $('[data-javares]', el); r.textContent = 'Szukam…';
      const list = await api('java:list');
      r.innerHTML = list.length ? list.map(j => `Java ${j.major} – <span class="mono">${esc(j.path)}</span>`).join('<br>') : 'Nie znaleziono Javy. Pobierz Eclipse Temurin z adoptium.net.';
      if (list.length && !$('[data-k="javaPath"]', el).value) $('[data-k="javaPath"]', el).value = list.sort((a, b) => b.major - a.major)[0].path;
    };
    $('[data-save]', el).onclick = save;
    const nxBox = $('[data-nexus]', el);
    const drawNx = async () => {
      const st = await api('nexus:status');
      nxBox.innerHTML = st.connected
        ? `<p style="margin:0 0 10px">Połączono jako <b>${esc(st.user ? st.user.name : '?')}</b>${st.user && st.user.premium ? ' <span class="chip ok">Premium</span>' : ' <span class="chip">konto darmowe</span>'}</p>
           <p class="dim" style="font-size:12.5px;margin:0 0 10px">${st.user && st.user.premium ? 'Mody pobierają się bezpośrednio z CodeManager.' : 'Na koncie darmowym pobierasz przyciskiem „Mod Manager Download” na stronie moda – link trafi do CodeManager.'}</p>
           <div class="row"><button class="btn" data-nxm>${icon('link')}${st.nxmRegistered ? 'Linki nxm:// obsługuje CodeManager' : 'Obsługuj linki nxm://'}</button><button class="btn danger" data-out>Odłącz</button></div>`
        : `<div class="field"><label>Osobisty klucz API</label><div class="inline-input"><input class="input mono" type="password" data-key placeholder="wklej klucz"><button class="btn primary" data-con>Połącz</button></div><span class="hint">nexusmods.com → Ustawienia konta → API Keys. Klucz jest szyfrowany i nie opuszcza komputera (poza zapytaniami do Nexus Mods).</span></div><button class="btn sm ghost" data-site>${icon('globe')}Otwórz stronę z kluczem</button>`;
      const c = $('[data-con]', nxBox); if (c) c.onclick = async () => { const u = await api('nexus:setKey', $('[data-key]', nxBox).value); toast(`Połączono jako ${u.name}`); drawNx(); };
      const o = $('[data-out]', nxBox); if (o) o.onclick = async () => { await api('nexus:setKey', null); drawNx(); };
      const n = $('[data-nxm]', nxBox); if (n) n.onclick = async () => { await api('nexus:registerNxm'); toast('CodeManager obsługuje linki nxm://'); drawNx(); };
      const si = $('[data-site]', nxBox); if (si) si.onclick = () => api('shell:external', 'https://www.nexusmods.com/users/myaccount?tab=api');
    };
    drawNx();
    const upBox = $('[data-upd]', el);
    const drawUp = async () => {
      const c = await api('update:config');
      const st = App.updateStatusText(c);
      upBox.innerHTML = `
        <div class="upd-state ${c.state}"><div style="flex:1"><div style="font-weight:600">${esc(st.title)}</div><div class="dim" style="font-size:12.5px">${esc(st.sub)}</div></div>${st.action ? `<button class="btn ${c.state === 'available' || c.state === 'downloaded' ? 'primary' : ''} sm" data-act>${esc(st.action)}</button>` : ''}</div>
        ${c.state === 'downloading' ? `<div class="progress" style="margin:8px 0"><i style="width:${c.progress || 0}%"></i></div>` : ''}
        ${c.state === 'available' && c.notes ? `<details class="notes" open><summary>Co nowego w ${esc(c.latest)}</summary><pre>${esc(c.notes)}</pre></details>` : ''}
        <label class="check" style="margin:12px 0"><input type="checkbox" data-auto ${c.auto ? 'checked' : ''}><span>Sprawdzaj automatycznie (przy starcie i co 6 godzin)</span></label>
        <div class="row"><button class="btn" data-check>${icon('refresh')}Sprawdź teraz</button><button class="btn ghost sm" data-rel>${icon('globe')}Wszystkie wydania</button></div>`;
      const act = $('[data-act]', upBox); if (act) act.onclick = () => App.updateAction(c);
      $('[data-check]', upBox).onclick = async () => { try { await window.cm.call('update:check'); } catch (e) { toast(e.message, 'warn', 7000); } drawUp(); };
      $('[data-auto]', upBox).onchange = async e => { await api('update:configure', { auto: e.target.checked }); toast(e.target.checked ? 'Automatyczne sprawdzanie włączone' : 'Automatyczne sprawdzanie wyłączone'); };
      $('[data-rel]', upBox).onclick = () => api('shell:external', 'https://github.com/Zeis01/codemanager/releases');
    };
    drawUp();
    App.onUpdateStatus = () => { if (App.current() === 'settings' && document.body.contains(upBox)) drawUp(); };
    $$('input[type=checkbox][data-k], input[type=number][data-k]', el).forEach(i => i.onchange = save);
    async function save() {
      const patch = {};
      $$('[data-k]', el).forEach(i => { patch[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value.trim(); });
      App.state.settings = await api('settings:set', patch);
      toast('Zapisano ustawienia');
    }
  },
};
